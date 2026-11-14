import 'server-only';
import type { Browser } from 'playwright-core';
import { InspectionError } from '@/server/errors';
import type { Viewport } from '@/types/inspection';
import type { BrowserCloseResult, LaunchedBrowser } from './launch';
import type { RenderedViewport, RenderOptions } from './render';

// viewport마다 브라우저를 새로 띄운다: 실행 → 검사 → 닫기 (AGENTS.md 7장).
// Vercel의 @sparticuz/chromium은 --single-process로 실행되어 브라우저 하나에 context를 하나만 쓸 수 있다.
// 첫 context를 닫으면 브라우저가 죽거나(로컬) 멈춘다(Vercel, T13 확인). 동시에 떠 있는 브라우저는 항상 하나다.
// runInspection, test:fixtures, 로컬 스크립트가 모두 이 함수를 쓴다.

export interface ViewportSessionDeps {
  launchBrowser(): Promise<LaunchedBrowser>;
  renderViewport(browser: Browser, viewport: Viewport, url: string, options: RenderOptions): Promise<RenderedViewport>;
}

export interface FreshBrowserHooks {
  /** 브라우저를 실행한 직후 (검사 중지가 실행 중인 브라우저를 닫을 수 있게 한다) */
  onLaunched?: (launched: LaunchedBrowser) => void;
  /** 브라우저를 닫은 뒤 (로그용) */
  onClosed?: (result: BrowserCloseResult, durationMs: number) => void;
  onStep?: (step: string) => void;
}

/**
 * 브라우저를 새로 띄워 run을 실행하고, 성공·실패와 관계없이 닫는다(정상 종료가 멈추면 강제 종료, launch.ts).
 * 실행 실패는 BROWSER_CRASH로 던진다. 브라우저 하나에서는 context를 하나만 만든다.
 */
export async function withFreshBrowser<T>(
  launchBrowser: () => Promise<LaunchedBrowser>,
  run: (launched: LaunchedBrowser) => Promise<T>,
  hooks: FreshBrowserHooks = {},
): Promise<T> {
  hooks.onStep?.('launch');
  let launched: LaunchedBrowser;
  try {
    launched = await launchBrowser();
  } catch (error) {
    throw new InspectionError('BROWSER_CRASH', 'Browser launch failed', { cause: error });
  }
  hooks.onLaunched?.(launched);
  try {
    return await run(launched);
  } finally {
    hooks.onStep?.('close-browser');
    const closeStart = Date.now();
    const result = await launched.close();
    hooks.onClosed?.(result, Date.now() - closeStart);
  }
}

export type ViewportSessionOptions = RenderOptions & FreshBrowserHooks;

/**
 * viewport 하나를 새 브라우저에서 검사한다: 실행 → renderViewport → 닫기.
 * 실행에 쓴 시간도 이 viewport의 시간 예산(timeLimitMs)에서 빼고, 결과 timings에 launchMs를 더한다.
 */
export async function inspectViewportInFreshBrowser(
  deps: ViewportSessionDeps,
  viewport: Viewport,
  url: string,
  options: ViewportSessionOptions,
): Promise<RenderedViewport> {
  return withFreshBrowser(
    deps.launchBrowser,
    async (launched) => {
      const rendered = await deps.renderViewport(launched.browser, viewport, url, {
        ...options,
        timeLimitMs: options.timeLimitMs - launched.launchMs,
      });
      rendered.timings.launchMs = launched.launchMs;
      return rendered;
    },
    options,
  );
}
