import 'server-only';
import { errors, type BrowserContext, type Page } from 'playwright-core';
import { InspectionError, isBrowserGone } from '@/server/errors';
import { getRouteGuard, type RouteGuard } from '@/server/security/routeGuard';
import { HARD_TIMEOUT_GRACE_MS, PAGE_OPEN_TIMEOUT_MS, withHardTimeout } from './timeouts';

// PRD 5.2.2 렌더링 안정화 절차, 시간 제한은 PRD 8.1.3.

/** PRD 8.1.3: viewport당 페이지 로드(goto) */
export const NAVIGATION_TIMEOUT_MS = 30_000;
/** PRD 8.1.3: viewport당 안정화(2~6단계 합계) */
export const STABILIZE_BUDGET_MS = 20_000;
/** PRD 5.2.2 2단계: networkidle은 최대 5초까지만 기다린다 */
export const NETWORK_IDLE_TIMEOUT_MS = 5_000;
/** PRD 5.2.2 4단계: 자동 스크롤 상한 */
export const AUTO_SCROLL_MAX_STEPS = 20;
export const AUTO_SCROLL_MAX_DISTANCE_PX = 15_000;
/** PRD에 없는 값: 한 단계에 화면 높이만큼 스크롤한다(lazy loading의 IntersectionObserver가 빠짐없이 걸리도록) */
export const AUTO_SCROLL_STEP_VIEWPORT_RATIO = 1;
/** PRD에 없는 값: 스크롤 단계 사이 대기. lazy 이미지 요청이 시작될 시간을 준다 */
export const AUTO_SCROLL_STEP_DELAY_MS = 100;
/** PRD 5.2.2 6단계 */
export const SETTLE_DELAY_MS = 500;

/** PRD 5.2.2 5단계 */
const DISABLE_MOTION_CSS =
  '*, *::before, *::after { animation: none !important; transition: none !important; }';

export const STABILIZE_STEPS = ['networkidle', 'fonts', 'autoScroll', 'disableMotion', 'settle'] as const;
export type StabilizeStep = (typeof STABILIZE_STEPS)[number];

export interface StabilizeBudget {
  navigationMs: number;
  stabilizeMs: number;
  /** context.newPage 강제 제한 */
  pageOpenMs: number;
  /**
   * Playwright 자체 제한(goto timeout, 단계별 남은 예산)이 동작하지 않을 때를 대비한 강제 제한의 여유.
   * goto는 navigationMs + hardGraceMs, 2~6단계는 stabilizeMs + hardGraceMs를 넘기면 응답을 기다리지 않고 끝낸다.
   */
  hardGraceMs: number;
}

export const DEFAULT_STABILIZE_BUDGET: StabilizeBudget = {
  navigationMs: NAVIGATION_TIMEOUT_MS,
  stabilizeMs: STABILIZE_BUDGET_MS,
  pageOpenMs: PAGE_OPEN_TIMEOUT_MS,
  hardGraceMs: HARD_TIMEOUT_GRACE_MS,
};

/**
 * - completed: 끝까지 실행
 * - timed-out: 단계 제한(networkidle 5초) 또는 남은 예산을 넘겨 중단. 실패가 아니다
 * - skipped: 예산이 남지 않아 시작하지 않음
 */
export type StepOutcome = 'completed' | 'timed-out' | 'skipped';

export interface StepTiming {
  step: 'goto' | StabilizeStep;
  durationMs: number;
  outcome: StepOutcome;
}

export interface StabilizeMeta {
  finalUrl: string;
  httpStatus: number | null;
  steps: StepTiming[];
  skippedSteps: StabilizeStep[];
  /** 자동 스크롤 결과 (진단용) */
  autoScroll: { steps: number; distancePx: number } | null;
}

export interface StabilizedPage {
  page: Page;
  meta: StabilizeMeta;
}

/** PRD 6.2.4: HTTP_ERROR는 최상위 문서 응답이 400 이상일 때 */
export function isHttpErrorStatus(status: number): boolean {
  return status >= 400;
}

class StepTimeout extends Error {}

async function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout()), Math.max(0, ms));
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    clearTimeout(timer);
  }
}


/** PRD 5.1: 최상위 문서가 차단되면 BLOCKED_TARGET. 메시지에는 호스트도 넣지 않는다(사유만) */
function assertNotBlocked(guard: RouteGuard): void {
  const block = guard.topLevelBlock;
  if (block) throw new InspectionError('BLOCKED_TARGET', `Top-level document blocked (${block.reason}${block.viaRedirect ? ', redirect' : ''})`);
}

/** goto 오류 메시지의 net::ERR_* 이름. 없으면 null (순수 함수, 단위 테스트 대상) */
export function navigationNetError(error: unknown): string | null {
  return error instanceof Error ? (error.message.match(/net::ERR_[A-Z_]+/)?.[0] ?? null) : null;
}

async function navigate(guard: RouteGuard, page: Page, url: string, timeoutMs: number): Promise<number | null> {
  try {
    const { response } = await guard.goto(page, url, { timeoutMs });
    assertNotBlocked(guard);
    return response ? response.status() : null;
  } catch (error) {
    assertNotBlocked(guard);
    if (error instanceof InspectionError) throw error;
    if (error instanceof errors.TimeoutError) {
      throw new InspectionError('NAVIGATION_TIMEOUT', `Navigation timed out after ${timeoutMs}ms`, { cause: error });
    }
    if (isBrowserGone(error)) {
      throw new InspectionError('BROWSER_CRASH', 'Page crashed during navigation', { cause: error });
    }
    // PRD 6.2.4: 네트워크 오류(net::ERR_*: DNS 조회 실패, 연결 거부, TLS 오류 등)는 NAVIGATION_FAILED. 메시지에 오류 종류를 넣는다
    const netError = navigationNetError(error);
    if (netError) throw new InspectionError('NAVIGATION_FAILED', `Navigation failed: ${netError}`, { cause: error });
    throw new InspectionError('INTERNAL_ERROR', `Navigation failed: ${error instanceof Error ? error.name : typeof error}`, { cause: error });
  }
}

/** 4단계: Node에서 한 단계씩 스크롤해, 단계마다 남은 예산을 확인할 수 있게 한다. */
async function autoScroll(page: Page, deadline: number): Promise<{ steps: number; distancePx: number; done: boolean }> {
  let steps = 0;
  let distancePx = 0;
  let done = false;

  while (steps < AUTO_SCROLL_MAX_STEPS && distancePx < AUTO_SCROLL_MAX_DISTANCE_PX) {
    if (Date.now() >= deadline) break;
    const result = await page.evaluate(
      ({ ratio, maxDistance }) => {
        const root = document.scrollingElement || document.documentElement;
        const step = Math.max(1, Math.floor(window.innerHeight * ratio));
        const target = Math.min(window.scrollY + step, maxDistance);
        window.scrollTo({ top: target, left: 0, behavior: 'instant' });
        const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 1;
        return { scrollY: window.scrollY, atBottom };
      },
      { ratio: AUTO_SCROLL_STEP_VIEWPORT_RATIO, maxDistance: AUTO_SCROLL_MAX_DISTANCE_PX },
    );
    steps += 1;
    const moved = result.scrollY > distancePx;
    distancePx = Math.max(distancePx, result.scrollY);
    if (result.atBottom || !moved) {
      done = true;
      break;
    }
    const wait = Math.min(AUTO_SCROLL_STEP_DELAY_MS, deadline - Date.now());
    if (wait > 0) await page.waitForTimeout(wait);
  }
  if (steps >= AUTO_SCROLL_MAX_STEPS || distancePx >= AUTO_SCROLL_MAX_DISTANCE_PX) done = true;

  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  return { steps, distancePx, done };
}

/**
 * 새 page를 열어 PRD 5.2.2 절차를 거친 뒤 돌려준다.
 * 실패하면 page를 닫고 InspectionError를 던진다. 성공하면 page를 닫는 것은 호출한 쪽의 책임이다.
 */
export async function openAndStabilize(
  context: BrowserContext,
  url: string,
  budget: StabilizeBudget = DEFAULT_STABILIZE_BUDGET,
): Promise<StabilizedPage> {
  // createViewportContext로 만든 context만 받는다. guard 없이 외부 URL을 열지 않는다(PRD 8.6)
  const guard = getRouteGuard(context);
  if (!guard) throw new InspectionError('INTERNAL_ERROR', 'Route guard is not attached to the browser context');
  const page = await withHardTimeout(
    context.newPage(),
    budget.pageOpenMs,
    () => new InspectionError('BROWSER_CRASH', `Page did not open within ${budget.pageOpenMs}ms`),
  );
  try {
    return { page, meta: await stabilize(guard, page, url, budget) };
  } catch (error) {
    // 멈춘 page는 close도 응답하지 않을 수 있다. 기다리지 않는다(브라우저를 닫을 때 함께 정리된다)
    void page.close().catch(() => undefined);
    throw error;
  }
}

async function stabilize(guard: RouteGuard, page: Page, url: string, budget: StabilizeBudget): Promise<StabilizeMeta> {
  const steps: StepTiming[] = [];
  const skippedSteps: StabilizeStep[] = [];

  // 1. goto (PRD 5.2.2 1단계)
  const gotoStart = Date.now();
  const httpStatus = await withHardTimeout(
    navigate(guard, page, url, budget.navigationMs),
    budget.navigationMs + budget.hardGraceMs,
    () => new InspectionError('NAVIGATION_TIMEOUT', `Navigation did not respond within ${budget.navigationMs + budget.hardGraceMs}ms`),
  );
  steps.push({ step: 'goto', durationMs: Date.now() - gotoStart, outcome: 'completed' });
  if (httpStatus !== null && isHttpErrorStatus(httpStatus)) {
    throw new InspectionError('HTTP_ERROR', `HTTP ${httpStatus}`);
  }

  // 2~6단계는 합계 budget.stabilizeMs 안에서 실행한다. 넘으면 남은 단계를 건너뛴다(PRD 8.1.3).
  const deadline = Date.now() + budget.stabilizeMs;
  let autoScrollResult: StabilizeMeta['autoScroll'] = null;

  const runners: Record<StabilizeStep, (remainingMs: number) => Promise<StepOutcome>> = {
    networkidle: async (remainingMs) => {
      const limit = Math.min(NETWORK_IDLE_TIMEOUT_MS, remainingMs);
      try {
        await page.waitForLoadState('networkidle', { timeout: limit });
        return 'completed';
      } catch (error) {
        if (error instanceof errors.TimeoutError) return 'timed-out'; // PRD 5.2.2: 실패가 아니다
        throw error;
      }
    },
    fonts: async (remainingMs) => {
      try {
        await withTimeout(
          page.evaluate(() => document.fonts.ready.then(() => undefined)),
          remainingMs,
        );
        return 'completed';
      } catch (error) {
        if (error instanceof StepTimeout) return 'timed-out';
        throw error;
      }
    },
    autoScroll: async () => {
      const result = await autoScroll(page, deadline);
      autoScrollResult = { steps: result.steps, distancePx: result.distancePx };
      return result.done ? 'completed' : 'timed-out';
    },
    disableMotion: async () => {
      await page.addStyleTag({ content: DISABLE_MOTION_CSS });
      return 'completed';
    },
    settle: async (remainingMs) => {
      const wait = Math.min(SETTLE_DELAY_MS, remainingMs);
      await page.waitForTimeout(wait);
      return wait < SETTLE_DELAY_MS ? 'timed-out' : 'completed';
    },
  };

  const runSteps = async () => {
    for (const step of STABILIZE_STEPS) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        steps.push({ step, durationMs: 0, outcome: 'skipped' });
        skippedSteps.push(step);
        continue;
      }
      const start = Date.now();
      let outcome: StepOutcome;
      try {
        outcome = await runners[step](remainingMs);
      } catch (error) {
        if (isBrowserGone(error)) {
          throw new InspectionError('BROWSER_CRASH', `Page crashed during ${step}`, { cause: error });
        }
        if (error instanceof errors.TimeoutError) {
          throw new InspectionError('TIME_BUDGET_EXCEEDED', `Stabilize step ${step} timed out`, { cause: error });
        }
        throw new InspectionError('INTERNAL_ERROR', `Stabilize step ${step} failed (${error instanceof Error ? error.name : typeof error})`, { cause: error });
      }
      steps.push({ step, durationMs: Date.now() - start, outcome });
    }
  };
  // 단계별 제한은 Playwright 호출이 응답해야 동작한다. 응답이 없으면 예산 + 여유에서 끊는다
  await withHardTimeout(
    runSteps(),
    budget.stabilizeMs + budget.hardGraceMs,
    () => new InspectionError('TIME_BUDGET_EXCEEDED', `Stabilize did not finish within ${budget.stabilizeMs + budget.hardGraceMs}ms`),
  );

  // 안정화 중 스크립트가 메인 프레임을 금지 대상으로 옮기려 한 경우도 최상위 문서 차단이다(PRD 5.1)
  assertNotBlocked(guard);
  return { finalUrl: page.url(), httpStatus, steps, skippedSteps, autoScroll: autoScrollResult };
}
