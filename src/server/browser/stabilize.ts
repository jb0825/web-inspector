import 'server-only';
import { errors, type BrowserContext, type Page } from 'playwright-core';
import { InspectionError } from '@/server/errors';

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
}

export const DEFAULT_STABILIZE_BUDGET: StabilizeBudget = {
  navigationMs: NAVIGATION_TIMEOUT_MS,
  stabilizeMs: STABILIZE_BUDGET_MS,
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

function isPageCrash(error: unknown): boolean {
  return error instanceof Error && /crash|Target (page, context or browser )?closed/i.test(error.message);
}

async function navigate(page: Page, url: string, timeoutMs: number): Promise<number | null> {
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    return response ? response.status() : null;
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      throw new InspectionError('NAVIGATION_TIMEOUT', `Navigation timed out after ${timeoutMs}ms`, { cause: error });
    }
    if (isPageCrash(error)) {
      throw new InspectionError('BROWSER_CRASH', 'Page crashed during navigation', { cause: error });
    }
    // net::ERR_* 등. PRD 6.2.4에 맞는 코드가 없어 INTERNAL_ERROR로 둔다(보고 대상).
    const reason = error instanceof Error ? (error.message.match(/net::ERR_[A-Z_]+/)?.[0] ?? 'unknown') : 'unknown';
    throw new InspectionError('INTERNAL_ERROR', `Navigation failed: ${reason}`, { cause: error });
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
  const page = await context.newPage();
  try {
    return { page, meta: await stabilize(page, url, budget) };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

async function stabilize(page: Page, url: string, budget: StabilizeBudget): Promise<StabilizeMeta> {
  const steps: StepTiming[] = [];
  const skippedSteps: StabilizeStep[] = [];

  // 1. goto (PRD 5.2.2 1단계)
  const gotoStart = Date.now();
  const httpStatus = await navigate(page, url, budget.navigationMs);
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
      if (isPageCrash(error)) {
        throw new InspectionError('BROWSER_CRASH', `Page crashed during ${step}`, { cause: error });
      }
      throw new InspectionError('INTERNAL_ERROR', `Stabilize step ${step} failed`, { cause: error });
    }
    steps.push({ step, durationMs: Date.now() - start, outcome });
  }

  return { finalUrl: page.url(), httpStatus, steps, skippedSteps, autoScroll: autoScrollResult };
}
