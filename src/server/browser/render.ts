import 'server-only';
import type { Browser } from 'playwright-core';
import { collectViewport, COLLECT_TIMEOUT_MS } from '@/server/collect/collect';
import type { CollectedViewport } from '@/server/collect/types';
import { InspectionError } from '@/server/errors';
import type { RouteGuardOptions } from '@/server/security/routeGuard';
import type { Viewport } from '@/types/inspection';
import { createViewportContext } from './devices';
import { captureFullPage, SCREENSHOT_DEADLINE_MARGIN_MS, type CapturedScreenshot, type ScreenshotAttemptFailure } from './screenshot';
import { DEFAULT_STABILIZE_BUDGET, openAndStabilize, type StabilizeBudget } from './stabilize';
import { CONTEXT_TIMEOUT_MS, HARD_TIMEOUT_GRACE_MS, withHardTimeout } from './timeouts';

// viewport 1개: context(guard) → 페이지 열기·안정화(PRD 5.2.2) → 수집 → 스크린샷.
// 모든 단계에 강제 시간 제한을 둔다. 시간이 지나면 Playwright 응답을 기다리지 않고 InspectionError로 끝내고,
// 정리는 호출한 쪽이 브라우저를 닫아서 한다(session.ts: 필요하면 강제 종료). context는 브라우저와 함께 닫힌다.

/** PRD 8.1.3: viewport당 측정과 스크린샷 */
export const MEASURE_AND_SCREENSHOT_BUDGET_MS = 20_000;

export interface RenderedViewport {
  collected: CollectedViewport;
  screenshot: CapturedScreenshot;
  finalUrl: string;
  /** 로그용 단계별 소요 시간(ms) */
  timings: Record<string, number>;
}

export interface RenderLimits extends StabilizeBudget {
  contextMs: number;
  measureMs: number;
}

export const DEFAULT_RENDER_LIMITS: RenderLimits = {
  ...DEFAULT_STABILIZE_BUDGET,
  contextMs: CONTEXT_TIMEOUT_MS,
  measureMs: MEASURE_AND_SCREENSHOT_BUDGET_MS,
};

export interface RenderOptions {
  /** 이 검사의 route guard 설정(PRD 8.6). 운영은 allowHosts 없는 checker, Fixture 하네스만 로컬 서버를 허용한다 */
  guard: RouteGuardOptions;
  /** 이 viewport에 쓸 수 있는 남은 시간. 넘으면 TIME_BUDGET_EXCEEDED */
  timeLimitMs: number;
  /**
   * 단계를 시작할 때 호출한다(로그용). viewport가 멈췄을 때 어느 단계에서 멈췄는지 운영 로그로 알 수 있게 한다.
   * 결과를 기다리지 않고 바로 남기므로, 끝나지 않은 단계도 기록된다.
   */
  onStep?: (step: string) => void;
  /** 스크린샷 촬영이 실패해 줄여서 다시 찍을 때마다 호출한다(로그용, T14) */
  onScreenshotFailed?: (failure: ScreenshotAttemptFailure) => void;
  /** 단계별 제한. 테스트에서 줄인다 */
  limits?: Partial<RenderLimits>;
}

export async function renderViewport(browser: Browser, viewport: Viewport, url: string, options: RenderOptions): Promise<RenderedViewport> {
  const limits: RenderLimits = { ...DEFAULT_RENDER_LIMITS, ...options.limits };
  const { onStep } = options;
  const deadline = Date.now() + options.timeLimitMs;
  const timings: Record<string, number> = {};

  /**
   * 단계 하나를 limitMs와 이 viewport의 남은 시간 중 짧은 쪽으로 제한한다.
   * 남은 시간이 먼저 끝나면 TIME_BUDGET_EXCEEDED, 단계 제한이 먼저면 onLimit()의 오류로 끝낸다.
   */
  const phase = async <T>(step: string, run: () => Promise<T>, limitMs: number, onLimit: () => InspectionError): Promise<T> => {
    onStep?.(step);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new InspectionError('TIME_BUDGET_EXCEEDED', `Viewport time budget exceeded before ${step}`);
    const budgetBound = remaining < limitMs;
    const start = Date.now();
    const result = await withHardTimeout(run(), Math.min(limitMs, remaining), () =>
      budgetBound ? new InspectionError('TIME_BUDGET_EXCEEDED', `Viewport time budget exceeded during ${step}`) : onLimit(),
    );
    timings[`${step}Ms`] = Date.now() - start;
    return result;
  };

  const context = await phase(
    'context',
    () => createViewportContext(browser, viewport, options.guard),
    limits.contextMs,
    () => new InspectionError('BROWSER_CRASH', `Browser context did not open within ${limits.contextMs}ms`),
  );

  // openAndStabilize 안에서 newPage, goto, 2~6단계를 각각 강제 제한한다. 여기서는 그 합계로 한 번 더 감싼다
  const openLimit = limits.pageOpenMs + limits.navigationMs + limits.stabilizeMs + 3 * limits.hardGraceMs;
  const { page, meta } = await phase(
    'open-and-stabilize',
    () =>
      openAndStabilize(context, url, {
        ...limits,
        navigationMs: Math.min(limits.navigationMs, Math.max(1, deadline - Date.now())),
      }),
    openLimit,
    () => new InspectionError('TIME_BUDGET_EXCEEDED', `Open and stabilize did not finish within ${openLimit}ms`),
  );
  for (const step of meta.steps) timings[`${step.step}Ms`] = step.durationMs;

  // PRD 8.1.3: 측정과 스크린샷은 합계 20초. 수집 자체 제한(COLLECT_TIMEOUT_MS)도 이 안에 둔다
  const measureDeadline = Date.now() + limits.measureMs;
  const measureLeft = () => Math.max(0, measureDeadline - Date.now());
  const measureExceeded = () => new InspectionError('TIME_BUDGET_EXCEEDED', `Measure and screenshot exceeded ${limits.measureMs}ms`);
  const collected = await phase(
    'collect',
    () => collectViewport(page, viewport, { timeoutMs: Math.min(COLLECT_TIMEOUT_MS, limits.measureMs) }),
    measureLeft() + HARD_TIMEOUT_GRACE_MS,
    measureExceeded,
  );
  // 수집 직후 같은 page로 찍는다(T07)
  const screenshot = await phase(
    'screenshot',
    () =>
      captureFullPage(page, viewport, collected, {
        onAttemptFailed: options.onScreenshotFailed,
        // 시도마다 Playwright 시간 제한이 단계 제한보다 먼저 끝나게 해서, 뒤 방식으로 넘어갈 시간을 남긴다
        deadline: measureDeadline - SCREENSHOT_DEADLINE_MARGIN_MS,
      }),
    measureLeft(),
    measureExceeded,
  );
  return { collected, screenshot, finalUrl: meta.finalUrl, timings };
}
