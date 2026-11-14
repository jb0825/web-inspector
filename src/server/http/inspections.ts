import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { inspectionRequestSchema } from '@/schemas/inspectionRequest';
import { isInspectionError } from '@/server/errors';
import { describeFailure, type Logger } from '@/server/log';
import { HOST_LOOKUP_FAILED_MESSAGE, validateInspectionUrl } from '@/server/security/url';
import type { HostChecker } from '@/server/security/ssrf';
import { isCancellable, toFailedDocument } from '@/server/status';
import { StoredInspectionInvalidError, type InspectionStore } from '@/server/store/redis';
import type { AnalyzeResponse, ApiError, ApiErrorCode, CancelInspectionResponse, CreateInspectionResponse } from '@/types/api';
import type { Inspection } from '@/types/inspection';

// API 요청 처리 (PRD 8.3, API_SPEC 3·5·6장). route 파일은 이 함수에 의존성을 넣어 호출만 한다(AGENTS.md 3.1).
// after()와 저장소를 주입받아 Next.js 밖(Vitest)에서도 응답 형식을 테스트할 수 있게 한다.

/** API_SPEC 3.1: 요청 본문 4 KB 이하 */
export const MAX_REQUEST_BODY_BYTES = 4096;

/** API_SPEC 2.3: 사용자에게 보여줄 문구. 스택, 내부 경로, 비밀 값, 입력 URL을 넣지 않는다 */
export const API_MESSAGES = {
  INVALID_URL: '올바른 http:// 또는 https:// 주소를 입력해 주세요.',
  HOST_NOT_FOUND: '주소를 찾을 수 없습니다. URL을 확인해 주세요.',
  BLOCKED_TARGET: '보안상 검사할 수 없는 주소입니다.',
  TOO_MANY_INSPECTIONS: '다른 검사가 진행 중입니다. 잠시 후 다시 시도해 주세요.',
  NOT_FOUND: '검사 결과를 찾을 수 없습니다. 결과는 7일 동안 보관됩니다.',
  UNAUTHORIZED: '인증이 필요합니다.',
  INVALID_STATE: '이미 처리 중이거나 처리할 수 없는 상태입니다.',
  CANCEL_NOT_ALLOWED: '이미 끝났거나 결과를 정리하는 중이라 검사를 중지할 수 없습니다.',
  STORAGE_FAILED: '검사를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL_ERROR: '일시적인 오류가 발생했습니다.',
} as const;

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export function jsonResponse(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function apiError(status: number, code: ApiErrorCode, message: string): Response {
  return jsonResponse(status, { code, message } satisfies ApiError);
}

const idSchema = z.uuid();

export interface CreateDeps {
  store: InspectionStore;
  createChecker(): HostChecker;
  maxConcurrentInspections(): number;
  newId(): string;
  now(): number;
  /** after(). 응답을 보낸 뒤 실행할 작업을 등록한다 */
  schedule(task: () => Promise<void>): void;
  /** runInspection(id, …). finally에서 슬롯을 반환한다 */
  startInspection(id: string): Promise<void>;
  log: Logger;
}

/** POST /api/inspections (API_SPEC 3장) */
export async function handleCreateInspection(request: Request, deps: CreateDeps): Promise<Response> {
  // 1. 요청 검증 (3.1)
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_REQUEST_BODY_BYTES) return apiError(413, 'INVALID_URL', API_MESSAGES.INVALID_URL);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return apiError(400, 'INVALID_URL', API_MESSAGES.INVALID_URL);
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_BODY_BYTES) return apiError(413, 'INVALID_URL', API_MESSAGES.INVALID_URL);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, 'INVALID_URL', API_MESSAGES.INVALID_URL);
  }
  const parsed = inspectionRequestSchema.safeParse(body);
  if (!parsed.success) return apiError(400, 'INVALID_URL', API_MESSAGES.INVALID_URL);

  let url: URL;
  try {
    // allowHosts 없이 만든 checker만 쓴다(PRD 8.6)
    url = await validateInspectionUrl(parsed.data.url, deps.createChecker());
  } catch (error) {
    if (isInspectionError(error) && error.code === 'BLOCKED_TARGET') return apiError(400, 'BLOCKED_TARGET', API_MESSAGES.BLOCKED_TARGET);
    if (isInspectionError(error) && error.code === 'INVALID_URL') {
      return apiError(400, 'INVALID_URL', error.message.startsWith(HOST_LOOKUP_FAILED_MESSAGE) ? API_MESSAGES.HOST_NOT_FOUND : API_MESSAGES.INVALID_URL);
    }
    deps.log('create-failed', { code: 'INTERNAL_ERROR', cause: describeFailure(error) });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }

  // 2. 동시 실행 슬롯 (PRD 8.4)
  const id = deps.newId();
  try {
    if (!(await deps.store.acquireSlot(id, deps.maxConcurrentInspections()))) {
      deps.log('create-rejected', { id, host: url.hostname, code: 'TOO_MANY_INSPECTIONS' });
      return apiError(429, 'TOO_MANY_INSPECTIONS', API_MESSAGES.TOO_MANY_INSPECTIONS);
    }
  } catch (error) {
    deps.log('create-failed', { id, host: url.hostname, code: 'STORAGE_FAILED', cause: describeFailure(error) });
    return apiError(500, 'STORAGE_FAILED', API_MESSAGES.STORAGE_FAILED);
  }

  // 3. 문서 생성. 실패하면 슬롯을 반환한다
  const createdAt = new Date(deps.now()).toISOString();
  const inspection: Inspection = {
    id,
    url: url.href,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
    viewports: { desktop: null, mobile: null },
    viewportErrors: { desktop: null, mobile: null },
    analysis: { status: 'pending', analyzedIssueCount: 0 },
    issuesDetected: 0,
    issuesTruncated: false,
    issues: [],
    tasks: [],
  };
  try {
    await deps.store.create(inspection);
  } catch (error) {
    deps.log('create-failed', { id, host: url.hostname, code: 'STORAGE_FAILED', cause: describeFailure(error) });
    await deps.store.releaseSlot(id).catch(() => undefined);
    return apiError(500, 'STORAGE_FAILED', API_MESSAGES.STORAGE_FAILED);
  }

  // 4. 응답 뒤 브라우저 검사 (PRD 8.1.2)
  deps.schedule(() => deps.startInspection(id));
  deps.log('created', { id, host: url.hostname });
  return jsonResponse(202, { id } satisfies CreateInspectionResponse);
}

export interface ReadDeps {
  store: InspectionStore;
  log: Logger;
}

/** GET /api/inspections/:id (API_SPEC 5장). 저장된 문서를 멈춘 검사 처리만 거쳐 그대로 돌려준다 */
export async function handleGetInspection(id: string, deps: ReadDeps): Promise<Response> {
  if (!idSchema.safeParse(id).success) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);
  let inspection: Inspection | null;
  try {
    inspection = await deps.store.read(id);
  } catch (error) {
    // 로그에는 검사 ID만 남긴다(DOMAIN_MODEL 6.1)
    deps.log(error instanceof StoredInspectionInvalidError ? 'read-invalid' : 'read-failed', {
      id,
      ...(error instanceof StoredInspectionInvalidError ? {} : { cause: describeFailure(error) }),
    });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }
  if (!inspection) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);
  return jsonResponse(200, inspection);
}

export interface AnalyzeDeps {
  store: InspectionStore;
  /** INTERNAL_API_SECRET. 설정이 없으면 던진다 */
  internalSecret(): string;
  schedule(task: () => Promise<void>): void;
  startAnalysis(id: string): Promise<void>;
  log: Logger;
}

/** 비밀값은 헤더로만 받는다. 길이가 다르면 바로 거부하고, 같으면 상수 시간으로 비교한다(API_SPEC 8장) */
export function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** POST /api/inspections/:id/analyze (API_SPEC 6장, 내부 전용) */
export async function handleAnalyze(request: Request, id: string, deps: AnalyzeDeps): Promise<Response> {
  let secret: string;
  try {
    secret = deps.internalSecret();
  } catch {
    deps.log('analyze-config-missing', { id: idSchema.safeParse(id).success ? id : undefined });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }
  if (!isAuthorized(request.headers.get('x-internal-secret'), secret)) return apiError(401, 'UNAUTHORIZED', API_MESSAGES.UNAUTHORIZED);
  if (!idSchema.safeParse(id).success) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);

  let inspection: Inspection | null;
  try {
    inspection = await deps.store.read(id);
  } catch {
    deps.log('analyze-read-failed', { id });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }
  if (!inspection) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);
  // PRD 8.1.2: analyzing이고 analysis.status가 pending일 때만 작업한다
  if (inspection.status !== 'analyzing' || inspection.analysis.status !== 'pending') {
    return apiError(409, 'INVALID_STATE', API_MESSAGES.INVALID_STATE);
  }
  try {
    if (!(await deps.store.acquireAnalyzeLock(id))) return apiError(409, 'INVALID_STATE', API_MESSAGES.INVALID_STATE);
  } catch {
    deps.log('analyze-lock-failed', { id });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }

  deps.schedule(() => deps.startAnalysis(id));
  return jsonResponse(202, {} satisfies AnalyzeResponse);
}

export interface CancelDeps {
  store: InspectionStore;
  now(): number;
  log: Logger;
}

/**
 * POST /api/inspections/:id/cancel (API_SPEC 6A장). 브라우저 단계(pending, running)의 검사만 중지할 수 있다.
 * 1. 중지 요청 표시를 먼저 남긴다. 이후 브라우저 단계의 저장은 모두 거부된다(SAVE_UNLESS_CANCELLED_SCRIPT)
 * 2. 문서를 다시 읽어 아직 브라우저 단계면 failed(CANCELLED)로 저장한다. 그사이 analyzing이 되었으면 409
 * 3. 동시 실행 슬롯을 바로 돌려준다. 실행 중인 검사도 중지 요청을 보고 멈춘 뒤 슬롯을 다시 반환한다(중복 반환은 무해)
 */
export async function handleCancelInspection(id: string, deps: CancelDeps): Promise<Response> {
  if (!idSchema.safeParse(id).success) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);
  let inspection: Inspection | null;
  try {
    inspection = await deps.store.read(id);
  } catch (error) {
    deps.log('cancel-failed', { id, code: 'INTERNAL_ERROR', cause: describeFailure(error) });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }
  if (!inspection) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);
  if (!isCancellable(inspection.status)) return apiError(409, 'INVALID_STATE', API_MESSAGES.CANCEL_NOT_ALLOWED);

  let saved: Inspection;
  try {
    await deps.store.requestCancel(id);
    // 표시를 남긴 뒤 다시 읽는다. 그 전에 끝난 브라우저 단계 저장이 있으면 그 결과를 기준으로 판단한다
    const current = await deps.store.read(id);
    if (!current) return apiError(404, 'NOT_FOUND', API_MESSAGES.NOT_FOUND);
    if (!isCancellable(current.status)) return apiError(409, 'INVALID_STATE', API_MESSAGES.CANCEL_NOT_ALLOWED);
    saved = await deps.store.save(toFailedDocument(current, { code: 'CANCELLED', message: 'Cancelled by user' }, deps.now()));
  } catch (error) {
    deps.log('cancel-failed', { id, code: 'STORAGE_FAILED', cause: describeFailure(error) });
    return apiError(500, 'INTERNAL_ERROR', API_MESSAGES.INTERNAL_ERROR);
  }
  await deps.store.releaseSlot(id).catch(() => undefined);
  deps.log('cancelled-by-user', { id, host: hostOf(saved.url) });
  return jsonResponse(200, saved satisfies CancelInspectionResponse);
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
