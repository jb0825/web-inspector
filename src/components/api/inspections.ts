import { z } from 'zod';
import { inspectionStatusSchema } from '@/schemas/enums';
import type { ApiError, CreateInspectionRequest, CreateInspectionResponse } from '@/types/api';
import type { Inspection } from '@/types/inspection';

// 클라이언트에서 쓰는 API 호출(PRD 8.3). Home과 Progress(다시 검사), polling 훅이 함께 쓴다.
// feature끼리는 import할 수 없어(AGENTS.md 3.1) components/에 둔다.

const apiErrorSchema = z.object({ code: z.string(), message: z.string() });
const createResponseSchema = z.object({ id: z.string().min(1) }) satisfies z.ZodType<CreateInspectionResponse>;

/** 문서 전체 검증은 서버(store/schemas.ts)가 이미 했다. 화면이 분기에 쓰는 필드만 확인한다 */
const inspectionShapeSchema = z.looseObject({ id: z.string(), url: z.string(), status: inspectionStatusSchema });

export type CreateInspectionResult =
  | { ok: true; id: string }
  /** code가 없으면 응답을 받지 못했거나 본문을 읽지 못한 경우 */
  | { ok: false; status: number | null; code?: string; message?: string };

export async function createInspection(url: string, fetchImpl: typeof fetch = fetch): Promise<CreateInspectionResult> {
  const body: CreateInspectionRequest = { url };
  let response: Response;
  try {
    response = await fetchImpl('/api/inspections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: null };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.status === 202) {
    const parsed = createResponseSchema.safeParse(json);
    return parsed.success ? { ok: true, id: parsed.data.id } : { ok: false, status: response.status };
  }
  const error = apiErrorSchema.safeParse(json);
  return error.success
    ? { ok: false, status: response.status, code: error.data.code as ApiError['code'], message: error.data.message }
    : { ok: false, status: response.status };
}

/** GET /api/inspections/:id 결과를 polling이 쓰는 사건으로 바꾼다 (API_SPEC 7장) */
export type FetchInspectionResult =
  | { type: 'success'; inspection: Inspection }
  | { type: 'not-found' }
  /** retryable: 네트워크 오류, 5xx, 읽을 수 없는 본문. 그 밖의 4xx는 다시 시도해도 같으므로 false */
  | { type: 'failure'; retryable: boolean }
  /** 호출한 쪽이 취소한 요청 */
  | { type: 'aborted' };

export async function fetchInspection(id: string, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<FetchInspectionResult> {
  try {
    const response = await fetchImpl(`/api/inspections/${encodeURIComponent(id)}`, { signal, cache: 'no-store' });
    if (response.status === 404) return { type: 'not-found' };
    if (!response.ok) return { type: 'failure', retryable: response.status >= 500 };
    const json: unknown = await response.json();
    const parsed = inspectionShapeSchema.safeParse(json);
    // 필요한 필드만 확인했다. 나머지 필드는 서버 스키마(Inspection)를 따른다
    return parsed.success ? { type: 'success', inspection: parsed.data as unknown as Inspection } : { type: 'failure', retryable: true };
  } catch {
    if (signal.aborted) return { type: 'aborted' };
    return { type: 'failure', retryable: true };
  }
}

/** POST /api/inspections/:id/cancel 결과 (API_SPEC 6A장) */
export type CancelInspectionResult =
  | { ok: true; inspection: Inspection }
  /** status 409: 이미 끝났거나 결과를 정리하는 중. null: 응답을 받지 못함 */
  | { ok: false; status: number | null; message?: string };

export async function cancelInspection(id: string, fetchImpl: typeof fetch = fetch): Promise<CancelInspectionResult> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/inspections/${encodeURIComponent(id)}/cancel`, { method: 'POST', cache: 'no-store' });
  } catch {
    return { ok: false, status: null };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = inspectionShapeSchema.safeParse(json);
    return parsed.success ? { ok: true, inspection: parsed.data as unknown as Inspection } : { ok: false, status: response.status };
  }
  const error = apiErrorSchema.safeParse(json);
  return { ok: false, status: response.status, message: error.success ? error.data.message : undefined };
}
