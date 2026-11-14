import 'server-only';
import type { Browser } from 'playwright-core';
import { launchBrowser, type LaunchedBrowser } from '@/server/browser/launch';
import { renderViewport, type RenderedViewport, type RenderOptions } from '@/server/browser/render';
import { inspectViewportInFreshBrowser } from '@/server/browser/session';
import { BROWSER_CLOSE_TIMEOUT_MS, BROWSER_KILL_TIMEOUT_MS } from '@/server/browser/timeouts';
import { buildIssues, type BuildIssuesResult } from '@/server/detect/pipeline';
import { getInternalEnv } from '@/server/env';
import { InspectionError, isInspectionError } from '@/server/errors';
import { buildViewportResult, finalizeIssues } from '@/server/evidence/finalize';
import { describeFailure, logEvent, type Logger } from '@/server/log';
import { createHostChecker, type HostChecker } from '@/server/security/ssrf';
import { browserStageError, browserStageStatus, toFailedDocument, withSkippedReasons } from '@/server/status';
import { createBlobStorage, type ScreenshotStorage } from '@/server/store/blob';
import { getInspectionStore, InspectionCancelledError, type InspectionStore } from '@/server/store/redis';
import type { InspectionStep } from '@/server/store/schemas';
import type { Inspection, InspectionErrorInfo, Issue, Viewport, ViewportResult } from '@/types/inspection';

// 브라우저 검사 오케스트레이션 (PRD 8.1.2, 8.1.3, DOMAIN_MODEL 4.2). POST /api/inspections의 after()에서 실행한다.
// 탐지 코드에는 시각을 넘기지 않는다. 시계(now)는 시간 예산과 문서 시각에만 쓴다(AGENTS.md 불변 조건 5).

/** PRD 8.1.3: 전체 검사 상한 */
export const INSPECTION_TIME_BUDGET_MS = 180_000;
/** API_SPEC 4.2: analyze 호출 1회의 응답 대기 */
export const ANALYZE_CALL_TIMEOUT_MS = 10_000;
/** API_SPEC 4.2: 실패하면 1회 다시 시도 → 최대 2회 */
export const ANALYZE_CALL_ATTEMPTS = 2;
/**
 * viewport가 스스로 끝나지 못할 때 오케스트레이터가 더 기다리는 시간.
 * 단계 강제 제한 뒤 브라우저 정상 종료(BROWSER_CLOSE_TIMEOUT_MS)와 강제 종료(BROWSER_KILL_TIMEOUT_MS)를 기다릴 여유다
 */
const RENDER_GRACE_MS = BROWSER_CLOSE_TIMEOUT_MS + BROWSER_KILL_TIMEOUT_MS + 1_000;

const VIEWPORT_LIST: readonly Viewport[] = ['desktop', 'mobile'];

export interface InspectionDeps {
  store: InspectionStore;
  screenshots: ScreenshotStorage;
  /** viewport마다 한 번 부른다(AGENTS.md 7장) */
  launchBrowser(): Promise<LaunchedBrowser>;
  renderViewport(browser: Browser, viewport: Viewport, url: string, options: RenderOptions): Promise<RenderedViewport>;
  /** 검사 1회용 host checker. allowHosts를 넘기지 않는다(PRD 8.6) */
  createChecker(): HostChecker;
  /** /analyze 내부 호출. 202가 아니면 던진다(재시도는 runInspection이 한다) */
  triggerAnalyze(id: string): Promise<void>;
  now(): number;
  log: Logger;
  /** 검사 중지 요청을 확인하는 간격. 기본값 CANCEL_POLL_MS (테스트에서 줄인다) */
  cancelPollMs?: number;
}

/** 검사 중지 요청 확인 간격. 검사 1회(최대 300초)에 Redis GET 최대 150번 */
export const CANCEL_POLL_MS = 2_000;

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
  /** 지금 떠 있는 브라우저 (viewport마다 하나). 검사 중지와 finally가 닫는다 */
  let current: LaunchedBrowser | null = null;
  let doc: Inspection | null = null;

  // 검사 중지(POST /api/inspections/:id/cancel): 브라우저 단계의 모든 저장은 중지 요청이 없을 때만 쓴다.
  // 중지 요청이 있으면 저장이 InspectionCancelledError를 던지고, 아래 catch가 아무것도 쓰지 않고 멈춘다.
  // 렌더링 중에는 저장이 없으므로 주기적으로 확인해 브라우저를 닫아 진행 중인 Playwright 호출을 끊는다.
  let cancelled = false;
  let cancelWatch: ReturnType<typeof setInterval> | undefined;
  const throwIfCancelled = () => {
    if (cancelled) throw new InspectionCancelledError(id);
  };

  /** step만 바뀌는 저장은 진행 표시용이다. 실패해도 검사를 멈추지 않는다(API_SPEC 4.1). 중지 요청은 그대로 던진다 */
  const saveStep = async (next: Inspection): Promise<Inspection> => {
    const at = now();
    try {
      const saved = await store.save(next, { unlessCancelled: true });
      log('save', { id, host, step: next.step, status: next.status, durationMs: now() - at });
      return saved;
    } catch (error) {
      if (error instanceof InspectionCancelledError) throw error;
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
      const saved = await store.save(next, { unlessCancelled: true });
      log('save', { id, host, step: next.step, status: next.status, durationMs: now() - at });
      return saved;
    } catch (error) {
      if (error instanceof InspectionCancelledError) throw error;
      log('save-failed', { id, host, step: next.step, status: next.status, code: errorInfo(error).code });
      if (next.status === 'failed' && next.error?.code === 'STORAGE_FAILED') return null;
      return saveResult(toFailedDocument(next, { code: 'STORAGE_FAILED', message: 'Saving results failed' }, now()));
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
    cancelWatch = setInterval(() => {
      if (cancelled) return;
      store.isCancelRequested(id).then(
        (requested) => {
          if (!requested || cancelled) return;
          cancelled = true;
          log('cancel-detected', { id, host, durationMs: now() - started });
          if (current) void current.close();
        },
        () => undefined, // 확인 실패는 다음 주기에 다시 본다
      );
    }, deps.cancelPollMs ?? CANCEL_POLL_MS);
    doc = await saveStep({ ...doc, status: 'running', startedAt: iso(now()), step: 'initializing_browser' });

    // 1~2. Desktop → Mobile 순서대로, viewport마다 브라우저를 새로 띄운다(AGENTS.md 7장, browser/session.ts).
    // 하나가 실패해도(브라우저 실행 실패 포함) 다른 viewport는 진행한다. 둘 다 실패하면 failed다(PRD 6.2.2)
    const guardOptions = { checker: deps.createChecker() };
    const rendered: Record<Viewport, RenderedViewport | null> = { desktop: null, mobile: null };
    const errors: Record<Viewport, InspectionErrorInfo | null> = { desktop: null, mobile: null };
    for (const viewport of VIEWPORT_LIST) {
      throwIfCancelled();
      const remaining = deadline - now();
      if (remaining <= 0) {
        errors[viewport] = { code: 'TIME_BUDGET_EXCEEDED', message: 'Inspection time budget exceeded before rendering' };
        log('viewport-skipped', { id, host, viewport, code: 'TIME_BUDGET_EXCEEDED' });
        continue;
      }
      await step(viewport === 'desktop' ? 'rendering_desktop' : 'rendering_mobile');
      const viewportStart = now();
      // 마지막 안전장치: 단계별 강제 제한(render.ts)과 브라우저 강제 종료(launch.ts)까지 끝났어야 하는 시각
      const guard = sleepReject(remaining + RENDER_GRACE_MS, () => new InspectionError('TIME_BUDGET_EXCEEDED', 'Viewport did not stop in time'));
      try {
        rendered[viewport] = await Promise.race([
          inspectViewportInFreshBrowser(deps, viewport, doc.url, {
            guard: guardOptions,
            timeLimitMs: remaining,
            onStep: (s) => log('viewport-step', { id, host, viewport, step: s, durationMs: now() - viewportStart }),
            // 스크린샷이 실패하면 줄여서 다시 찍는다(browser/screenshot.ts). 실패한 시도마다 크기와 원인을 남긴다
            onScreenshotFailed: (failure) =>
              log('screenshot-retry', {
                id,
                host,
                viewport,
                step: failure.diagnostics.mode,
                durationMs: failure.durationMs,
                screenshot: { ...failure.diagnostics, timeoutMs: failure.timeoutMs },
                cause: describeFailure(failure.error),
              }),
            onLaunched: (launched) => {
              current = launched;
              log('launch', { id, host, viewport, durationMs: launched.launchMs });
              // 실행 중에 중지 요청을 받았으면 바로 닫는다
              if (cancelled) void launched.close();
            },
            onClosed: (result, durationMs) => {
              current = null;
              log(result === 'killed' ? 'browser-killed' : 'browser-closed', { id, host, viewport, durationMs });
            },
          }),
          guard.promise,
        ]);
        const shot = rendered[viewport]?.screenshot;
        log('viewport', {
          id,
          host,
          viewport,
          durationMs: now() - viewportStart,
          timings: rendered[viewport]?.timings,
          ...(shot ? { screenshot: { mode: shot.mode, failedAttempts: shot.failedAttempts, width: shot.screenshotWidth, height: shot.screenshotHeight } } : {}),
        });
      } catch (error) {
        errors[viewport] = errorInfo(error);
        log('viewport-failed', { id, host, viewport, code: errors[viewport]?.code, durationMs: now() - viewportStart, cause: describeFailure(error) });
      } finally {
        guard.cancel();
        // 오케스트레이터가 끊은 경우(위 guard) 브라우저가 아직 떠 있다. 다음 viewport를 띄우기 전에 닫는다(강제 종료 포함).
        // 동시에 떠 있는 브라우저는 하나다. close()는 여러 번 불러도 한 번만 닫는다
        if (current) {
          const leftover: LaunchedBrowser = current;
          current = null;
          await leftover.close();
        }
      }
      throwIfCancelled();
    }

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
    // 검사 중지: 문서는 중지 API가 이미 failed(CANCELLED)로 저장했다. 아무것도 쓰지 않는다
    if (error instanceof InspectionCancelledError || cancelled) {
      log('cancelled', { id, host, durationMs: now() - started });
      return;
    }
    // 예상하지 못한 오류. 아직 브라우저 단계가 끝나지 않았다면 failed로 남긴다
    log('unexpected', { id, host, code: errorInfo(error).code, cause: describeFailure(error) });
    if (doc && (doc.status === 'pending' || doc.status === 'running')) {
      await saveResult(toFailedDocument(doc, { code: 'INTERNAL_ERROR', message: 'Unexpected error' }, now())).catch(() => undefined);
    }
  } finally {
    clearInterval(cancelWatch);
    if (current) await current.close();
    try {
      await store.releaseSlot(id);
    } catch (error) {
      // 슬롯은 300초 뒤 만료된다(PRD 8.4)
      log('release-slot-failed', { id, code: errorInfo(error).code });
    }
    log('end', { id, host, durationMs: now() - started });
  }
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
      log('analyze-call-failed', { id, host, attempt, code: errorInfo(error).code, durationMs: now() - at, cause: describeFailure(error) });
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
