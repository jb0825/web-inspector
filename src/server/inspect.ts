import 'server-only';
import type { Browser, BrowserContext } from 'playwright-core';
import { createViewportContext } from '@/server/browser/devices';
import { launchBrowser } from '@/server/browser/launch';
import { captureFullPage, type CapturedScreenshot } from '@/server/browser/screenshot';
import { DEFAULT_STABILIZE_BUDGET, openAndStabilize } from '@/server/browser/stabilize';
import { collectViewport, COLLECT_TIMEOUT_MS } from '@/server/collect/collect';
import type { CollectedViewport } from '@/server/collect/types';
import { buildIssues, type BuildIssuesResult } from '@/server/detect/pipeline';
import { getInternalEnv } from '@/server/env';
import { InspectionError, isInspectionError } from '@/server/errors';
import { buildViewportResult, finalizeIssues } from '@/server/evidence/finalize';
import { logEvent, type Logger } from '@/server/log';
import { createHostChecker, type HostChecker } from '@/server/security/ssrf';
import { browserStageError, browserStageStatus, withSkippedReasons } from '@/server/status';
import { createBlobStorage, type ScreenshotStorage } from '@/server/store/blob';
import { getInspectionStore, type InspectionStore } from '@/server/store/redis';
import type { InspectionStep } from '@/server/store/schemas';
import type { Inspection, InspectionErrorInfo, Issue, Viewport, ViewportResult } from '@/types/inspection';

// 브라우저 검사 오케스트레이션 (PRD 8.1.2, 8.1.3, DOMAIN_MODEL 4.2). POST /api/inspections의 after()에서 실행한다.
// 탐지 코드에는 시각을 넘기지 않는다. 시계(now)는 시간 예산과 문서 시각에만 쓴다(AGENTS.md 불변 조건 5).

/** PRD 8.1.3: 전체 검사 상한 */
export const INSPECTION_TIME_BUDGET_MS = 180_000;
/** PRD 8.1.3: viewport당 측정과 스크린샷 */
export const MEASURE_AND_SCREENSHOT_BUDGET_MS = 20_000;
/** API_SPEC 4.2: analyze 호출 1회의 응답 대기 */
export const ANALYZE_CALL_TIMEOUT_MS = 10_000;
/** API_SPEC 4.2: 실패하면 1회 다시 시도 → 최대 2회 */
export const ANALYZE_CALL_ATTEMPTS = 2;
/** renderViewport가 스스로 멈추지 못할 때 오케스트레이터가 더 기다리는 시간 (context 종료 여유) */
const RENDER_GRACE_MS = 5_000;

const VIEWPORT_LIST: readonly Viewport[] = ['desktop', 'mobile'];

export interface RenderedViewport {
  collected: CollectedViewport;
  screenshot: CapturedScreenshot;
  finalUrl: string;
  /** 로그용 단계별 소요 시간(ms) */
  timings: Record<string, number>;
}

export interface RenderOptions {
  checker: HostChecker;
  /** 이 viewport에 쓸 수 있는 남은 시간. 넘으면 TIME_BUDGET_EXCEEDED */
  timeLimitMs: number;
}

export interface InspectionDeps {
  store: InspectionStore;
  screenshots: ScreenshotStorage;
  launchBrowser(): Promise<Browser>;
  renderViewport(browser: Browser, viewport: Viewport, url: string, options: RenderOptions): Promise<RenderedViewport>;
  /** 검사 1회용 host checker. allowHosts를 넘기지 않는다(PRD 8.6) */
  createChecker(): HostChecker;
  /** /analyze 내부 호출. 202가 아니면 던진다(재시도는 runInspection이 한다) */
  triggerAnalyze(id: string): Promise<void>;
  now(): number;
  log: Logger;
}

const iso = (ms: number) => new Date(ms).toISOString();

function errorInfo(error: unknown): InspectionErrorInfo {
  if (isInspectionError(error)) return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'Unexpected error' };
}

const sleepReject = (ms: number, error: () => Error) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), Math.max(0, ms));
  });
  return { promise, cancel: () => clearTimeout(timer) };
};

// ---------------------------------------------------------------------------
// viewport 1개: context(guard) → 안정화 → 수집 → 스크린샷 → context 종료

/**
 * 시간 제한을 넘기면 context를 닫아 진행 중인 Playwright 호출을 끊고 TIME_BUDGET_EXCEEDED를 던진다.
 * 제한은 두 개다: 이 viewport에 남은 전체 시간(timeLimitMs), 측정과 스크린샷 합계 20초(PRD 8.1.3).
 */
export async function renderViewport(
  browser: Browser,
  viewport: Viewport,
  url: string,
  { checker, timeLimitMs }: RenderOptions,
): Promise<RenderedViewport> {
  const timings: Record<string, number> = {};
  let context: BrowserContext | null = null;
  let cutReason: string | null = null;
  /** 시간 제한으로 시작한 context 종료. 두 번째 close()는 종료가 끝나기 전에 돌아오므로 이 Promise를 기다린다 */
  let closing: Promise<void> | null = null;
  const closeContext = (): Promise<void> => {
    // context가 아직 없으면(생성 중) 기록하지 않는다. 만든 뒤 finally에서 닫는다
    if (!context) return Promise.resolve();
    closing ??= context.close().catch(() => undefined);
    return closing;
  };
  const timers: ReturnType<typeof setTimeout>[] = [];
  const cutAfter = (ms: number, reason: string) => {
    timers.push(
      setTimeout(() => {
        cutReason ??= reason;
        void closeContext();
      }, Math.max(0, ms)),
    );
  };
  const t0 = Date.now();
  cutAfter(timeLimitMs, 'inspection budget');
  try {
    context = await createViewportContext(browser, viewport, { checker });
    if (cutReason) throw new Error('cut');
    timings.contextMs = Date.now() - t0;

    const stabilizeStart = Date.now();
    const { page, meta } = await openAndStabilize(context, url, {
      ...DEFAULT_STABILIZE_BUDGET,
      navigationMs: Math.min(DEFAULT_STABILIZE_BUDGET.navigationMs, Math.max(1, timeLimitMs - timings.contextMs)),
    });
    for (const step of meta.steps) timings[`${step.step}Ms`] = step.durationMs;
    timings.openAndStabilizeMs = Date.now() - stabilizeStart;

    const measureStart = Date.now();
    cutAfter(MEASURE_AND_SCREENSHOT_BUDGET_MS, 'measure budget');
    const collected = await collectViewport(page, viewport, { timeoutMs: Math.min(COLLECT_TIMEOUT_MS, MEASURE_AND_SCREENSHOT_BUDGET_MS) });
    timings.collectMs = Date.now() - measureStart;
    const shotStart = Date.now();
    // 수집 직후 같은 page로 찍는다(T07)
    const screenshot = await captureFullPage(page, viewport, collected);
    timings.screenshotMs = Date.now() - shotStart;
    return { collected, screenshot, finalUrl: meta.finalUrl, timings };
  } catch (error) {
    if (cutReason) throw new InspectionError('TIME_BUDGET_EXCEEDED', `Viewport stopped: ${cutReason} exceeded`, { cause: error });
    throw error;
  } finally {
    for (const timer of timers) clearTimeout(timer);
    await closeContext();
  }
}

// ---------------------------------------------------------------------------
// 탐지와 Issue 완성. viewport 하나의 데이터 때문에 실패하면 그 viewport만 DETECTION_FAILED로 빼고 다시 만든다.

interface Assembled {
  result: BuildIssuesResult | null;
  issues: Issue[];
}

function assemble(rendered: Record<Viewport, RenderedViewport | null>, errors: Record<Viewport, InspectionErrorInfo | null>): Assembled {
  const tryBuild = (input: Record<Viewport, RenderedViewport | null>): Assembled => {
    const result = buildIssues({ desktop: input.desktop?.collected ?? null, mobile: input.mobile?.collected ?? null });
    const artifacts = (v: Viewport) => {
      const r = input[v];
      return r ? { collected: r.collected, screenshot: r.screenshot } : null;
    };
    return { result, issues: finalizeIssues(result.issues, { desktop: artifacts('desktop'), mobile: artifacts('mobile') }) };
  };
  const detectionFailed = (v: Viewport) => {
    rendered[v] = null;
    errors[v] = { code: 'DETECTION_FAILED', message: 'Issue detection failed' };
  };

  for (;;) {
    const alive = VIEWPORT_LIST.filter((v) => rendered[v] !== null);
    if (alive.length === 0) return { result: null, issues: [] };
    try {
      return tryBuild(rendered);
    } catch {
      if (alive.length === 1) {
        detectionFailed(alive[0]);
        continue;
      }
      // 어느 viewport 때문인지 하나씩 확인한다. 각자는 통과하는데 함께 실패하면 둘 다 실패로 본다
      const failing = alive.filter((v) => {
        try {
          tryBuild({ desktop: v === 'desktop' ? rendered.desktop : null, mobile: v === 'mobile' ? rendered.mobile : null });
          return false;
        } catch {
          return true;
        }
      });
      for (const v of failing.length > 0 ? failing : alive) detectionFailed(v);
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * PRD 8.1.2의 브라우저 검사. 예외를 밖으로 던지지 않는다(after() 안에서 실행된다).
 * finally에서 브라우저 종료와 슬롯 반환을 반드시 한다(PRD 8.4, 8.5).
 */
export async function runInspection(id: string, deps: InspectionDeps): Promise<void> {
  const { store, log, now } = deps;
  const started = now();
  const deadline = started + INSPECTION_TIME_BUDGET_MS;
  let host: string | undefined;
  let browser: Browser | null = null;
  let doc: Inspection | null = null;

  /** step만 바뀌는 저장은 진행 표시용이다. 실패해도 검사를 멈추지 않는다(API_SPEC 4.1) */
  const saveStep = async (next: Inspection): Promise<Inspection> => {
    const at = now();
    try {
      const saved = await store.save(next);
      log('save', { id, host, step: next.step, status: next.status, durationMs: now() - at });
      return saved;
    } catch (error) {
      log('save-failed', { id, host, step: next.step, code: errorInfo(error).code });
      return next;
    }
  };
  const step = async (name: InspectionStep) => {
    if (doc) doc = await saveStep({ ...doc, step: name });
  };

  /** 브라우저 단계의 마지막 저장. 실패하면 STORAGE_FAILED로 failed 저장을 한 번 더 시도한다(API_SPEC 4.1) */
  const saveResult = async (next: Inspection): Promise<Inspection | null> => {
    const at = now();
    try {
      const saved = await store.save(next);
      log('save', { id, host, step: next.step, status: next.status, durationMs: now() - at });
      return saved;
    } catch (error) {
      log('save-failed', { id, host, step: next.step, status: next.status, code: errorInfo(error).code });
      if (next.status === 'failed' && next.error?.code === 'STORAGE_FAILED') return null;
      return saveResult(failedDoc(next, { code: 'STORAGE_FAILED', message: 'Saving results failed' }, now()));
    }
  };

  try {
    const initial = await store.read(id);
    if (!initial || initial.status !== 'pending') {
      log('skip', { id, status: initial?.status ?? 'missing' });
      return;
    }
    host = new URL(initial.url).hostname;
    log('start', { id, host });
    doc = initial;
    doc = await saveStep({ ...doc, status: 'running', startedAt: iso(now()), step: 'initializing_browser' });

    // 1. 브라우저 실행 (렌더링 전 실패 → failed, PRD 6.2.2)
    const checker = deps.createChecker();
    const launchStart = now();
    try {
      browser = await deps.launchBrowser();
    } catch {
      log('launch-failed', { id, host, durationMs: now() - launchStart });
      await saveResult(failedDoc(doc, { code: 'BROWSER_CRASH', message: 'Browser launch failed' }, now()));
      return;
    }
    log('launch', { id, host, durationMs: now() - launchStart });

    // 2. Desktop → Mobile 순서대로 (AGENTS.md 7장). 하나가 실패해도 다른 viewport는 진행한다
    const rendered: Record<Viewport, RenderedViewport | null> = { desktop: null, mobile: null };
    const errors: Record<Viewport, InspectionErrorInfo | null> = { desktop: null, mobile: null };
    for (const viewport of VIEWPORT_LIST) {
      const remaining = deadline - now();
      if (remaining <= 0) {
        errors[viewport] = { code: 'TIME_BUDGET_EXCEEDED', message: 'Inspection time budget exceeded before rendering' };
        log('viewport-skipped', { id, host, viewport, code: 'TIME_BUDGET_EXCEEDED' });
        continue;
      }
      await step(viewport === 'desktop' ? 'rendering_desktop' : 'rendering_mobile');
      const viewportStart = now();
      const guard = sleepReject(remaining + RENDER_GRACE_MS, () => new InspectionError('TIME_BUDGET_EXCEEDED', 'Viewport did not stop in time'));
      try {
        rendered[viewport] = await Promise.race([
          deps.renderViewport(browser, viewport, doc.url, { checker, timeLimitMs: remaining }),
          guard.promise,
        ]);
        log('viewport', { id, host, viewport, durationMs: now() - viewportStart, timings: rendered[viewport]?.timings });
      } catch (error) {
        errors[viewport] = errorInfo(error);
        log('viewport-failed', { id, host, viewport, code: errors[viewport]?.code, durationMs: now() - viewportStart });
      } finally {
        guard.cancel();
      }
    }
    // 측정이 끝나면 브라우저를 먼저 닫아 메모리를 돌려준다
    await closeBrowser(browser);
    browser = null;

    // 3. 탐지 → Dedup → Priority → 상한 → ID → Evidence (PRD 8.1.2)
    await step('detecting_issues');
    const detectStart = now();
    let assembled = assemble(rendered, errors);
    log('detect', { id, host, durationMs: now() - detectStart });

    // 4. 스크린샷 업로드 → ViewportResult → Redis
    await step('saving_results');
    const uploadStart = now();
    const urls: Record<Viewport, string | null> = { desktop: null, mobile: null };
    let uploadFailed = false;
    for (const viewport of VIEWPORT_LIST) {
      const r = rendered[viewport];
      if (!r) continue;
      try {
        urls[viewport] = await deps.screenshots.upload(id, viewport, r.screenshot.png);
      } catch {
        // screenshotUrl이 없는 ViewportResult를 만들지 않는다. 이 viewport는 실패로 처리하고 이슈를 다시 만든다
        rendered[viewport] = null;
        errors[viewport] = { code: 'STORAGE_FAILED', message: `Screenshot upload failed (${viewport})` };
        uploadFailed = true;
      }
    }
    log('upload', { id, host, durationMs: now() - uploadStart });
    if (uploadFailed) assembled = assemble(rendered, errors);

    const viewports: Record<Viewport, ViewportResult | null> = { desktop: null, mobile: null };
    for (const viewport of VIEWPORT_LIST) {
      const r = rendered[viewport];
      const url = urls[viewport];
      const detection = assembled.result?.viewports[viewport];
      if (r && url && detection) viewports[viewport] = buildViewportResult(r.collected, r.screenshot, detection, url);
    }

    if (browserStageStatus(viewports) === 'failed') {
      const error = browserStageError(errors) ?? { code: 'INTERNAL_ERROR', message: 'No viewport result' };
      await saveResult({ ...doc, status: 'failed', error, viewportErrors: errors, completedAt: iso(now()) });
      return;
    }

    const firstOk = VIEWPORT_LIST.find((v) => viewports[v] !== null);
    const analyzing: Inspection = {
      ...doc,
      status: 'analyzing',
      finalUrl: firstOk ? rendered[firstOk]?.finalUrl : undefined,
      viewports,
      viewportErrors: errors,
      analysis: { status: 'pending', analyzedIssueCount: 0 },
      issuesDetected: assembled.result?.issuesDetected ?? 0,
      issuesTruncated: assembled.result?.issuesTruncated ?? false,
      issues: assembled.issues,
    };
    // AGENTS.md 불변 조건 7: 검사 결과를 AI 단계 전에 저장한다
    const saved = await saveResult(analyzing);
    if (!saved || saved.status !== 'analyzing') return;
    doc = saved;
    log('browser-stage', { id, host, status: saved.status, durationMs: now() - started });

    // 5. AI 단계 호출. 이슈가 0개여도 호출한다(skipped 처리는 analyze 쪽 책임, PRD 6.2.2)
    await callAnalyze(id, host, deps);
  } catch (error) {
    // 예상하지 못한 오류. 아직 브라우저 단계가 끝나지 않았다면 failed로 남긴다
    log('unexpected', { id, host, code: errorInfo(error).code });
    if (doc && (doc.status === 'pending' || doc.status === 'running')) {
      await saveResult(failedDoc(doc, { code: 'INTERNAL_ERROR', message: 'Unexpected error' }, now())).catch(() => undefined);
    }
  } finally {
    if (browser) await closeBrowser(browser);
    try {
      await store.releaseSlot(id);
    } catch (error) {
      // 슬롯은 300초 뒤 만료된다(PRD 8.4)
      log('release-slot-failed', { id, code: errorInfo(error).code });
    }
    log('end', { id, host, durationMs: now() - started });
  }
}

async function closeBrowser(browser: Browser): Promise<void> {
  await browser.close().catch(() => undefined);
}

/** 렌더링 결과가 없는 failed 문서. viewport 결과와 이슈는 비운다(DOMAIN_MODEL I-5: 렌더링 전 실패) */
function failedDoc(doc: Inspection, error: InspectionErrorInfo, at: number): Inspection {
  return {
    ...doc,
    status: 'failed',
    error,
    viewports: { desktop: null, mobile: null },
    viewportErrors: { desktop: null, mobile: null },
    issues: [],
    issuesDetected: 0,
    issuesTruncated: false,
    finalUrl: undefined,
    completedAt: iso(at),
  };
}

/** analyze 호출의 응답 대기 시간 초과. analyze가 실제로는 시작되었을 수 있어 확실한 실패와 구분한다 */
export class AnalyzeCallTimeout extends Error {
  constructor(options?: { cause?: unknown }) {
    super(`Analyze call timed out after ${ANALYZE_CALL_TIMEOUT_MS}ms`, options);
    this.name = 'AnalyzeCallTimeout';
  }
}

/**
 * PRD 8.1.2: 202만 확인한다.
 * - 확실한 실패(202가 아닌 응답, 연결 거부 등): 1회 재시도하고, 그래도 실패하면 partial + analysis.failed(AI_FAILED)
 * - 시간 초과: 다시 시도하지 않고 문서도 쓰지 않는다. analyze가 실제로 돌고 있으면 정상 완료되고,
 *   정말 죽었으면 300초 뒤 멈춘 검사 처리(DOMAIN_MODEL 4.4)가 partial로 보여준다
 * partial을 쓰기 전에 문서를 다시 읽어, analysis가 pending이 아니면(analyze가 시작함) 덮어쓰지 않는다.
 */
async function callAnalyze(id: string, host: string | undefined, deps: InspectionDeps): Promise<void> {
  const { log, now, store } = deps;
  for (let attempt = 1; attempt <= ANALYZE_CALL_ATTEMPTS; attempt += 1) {
    const at = now();
    try {
      await deps.triggerAnalyze(id);
      log('analyze-called', { id, host, attempt, durationMs: now() - at });
      return;
    } catch (error) {
      if (error instanceof AnalyzeCallTimeout) {
        log('analyze-call-timeout', { id, host, attempt, durationMs: now() - at });
        return;
      }
      log('analyze-call-failed', { id, host, attempt, code: errorInfo(error).code, durationMs: now() - at });
    }
  }
  try {
    const latest = await store.read(id);
    if (!latest || latest.status !== 'analyzing' || latest.analysis.status !== 'pending') return;
    await store.save({
      ...latest,
      status: 'partial',
      analysis: { status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: 'Analysis could not be started' } },
      issues: withSkippedReasons(latest.issues, 'ai-failed'),
      completedAt: iso(now()),
    });
    log('save', { id, host, status: 'partial', code: 'AI_FAILED' });
  } catch (error) {
    // 저장도 실패하면 GET의 멈춘 검사 처리(300초 뒤 partial)에 맡긴다
    log('save-failed', { id, host, status: 'partial', code: errorInfo(error).code });
  }
}

// ---------------------------------------------------------------------------
// 운영 의존성

/**
 * /analyze 내부 호출 주소의 origin (PRD 8.1.2: 현재 배포의 절대 URL).
 * 1순위는 검사 요청이 들어온 주소(create 함수가 넘긴 요청 origin)다. Vercel의 배포별 생성 주소(VERCEL_URL)는
 * 기본 배포 보호에서 production 배포도 보호 대상이라 내부 호출이 401로 막힐 수 있기 때문이다.
 * 요청 origin을 알 수 없을 때만 VERCEL_URL을 쓴다.
 */
export function resolveInternalOrigin(requestOrigin: string | undefined, vercelUrl: string | undefined): string {
  if (requestOrigin) return requestOrigin;
  if (vercelUrl) return `https://${vercelUrl}`;
  throw new InspectionError('INTERNAL_ERROR', 'Internal call origin is unknown');
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || (error.name === 'AbortError' && /timeout/i.test(String(error.message))));
}

export function createAnalyzeTrigger(requestOrigin: string | undefined): (id: string) => Promise<void> {
  return async (id) => {
    const env = getInternalEnv();
    const origin = resolveInternalOrigin(requestOrigin, env.VERCEL_URL);
    const headers: Record<string, string> = { 'x-internal-secret': env.INTERNAL_API_SECRET };
    // API_SPEC 4.3: 배포 보호를 켠 경우 (Protection Bypass for Automation)
    if (env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    let response: Response;
    try {
      response = await fetch(`${origin}/api/inspections/${id}/analyze`, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(ANALYZE_CALL_TIMEOUT_MS),
        cache: 'no-store',
      });
    } catch (error) {
      if (isTimeout(error)) throw new AnalyzeCallTimeout({ cause: error });
      throw error;
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 202) throw new InspectionError('INTERNAL_ERROR', `Analyze call returned ${response.status}`);
  };
}

export function createInspectionDeps(requestOrigin: string | undefined): InspectionDeps {
  return {
    store: getInspectionStore(),
    screenshots: createBlobStorage(),
    launchBrowser,
    renderViewport,
    createChecker: () => createHostChecker(),
    triggerAnalyze: createAnalyzeTrigger(requestOrigin),
    now: Date.now,
    log: logEvent,
  };
}
