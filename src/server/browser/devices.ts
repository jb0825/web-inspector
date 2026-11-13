import 'server-only';
import { devices, type Browser, type BrowserContext, type BrowserContextOptions } from 'playwright-core';
import { attachRouteGuard, type RouteGuardOptions } from '@/server/security/routeGuard';
import type { Viewport } from '@/types/inspection';

// PRD 5.2.1 Viewport 설정

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 3 },
} as const satisfies Record<Viewport, { width: number; height: number; deviceScaleFactor: number }>;

/** PRD 5.2.1: Mobile은 Playwright devices['iPhone 14'] 기반 */
const MOBILE_DEVICE = devices['iPhone 14'];

// AGENTS.md 8장, PRD 5.2.2(reducedMotion)
const COMMON_OPTIONS = {
  acceptDownloads: false,
  serviceWorkers: 'block',
  permissions: [],
  reducedMotion: 'reduce',
  locale: 'ko-KR',
} as const satisfies BrowserContextOptions;

/** context 옵션만 만드는 순수 함수. 단위 테스트 대상이다. */
export function buildContextOptions(viewport: Viewport): BrowserContextOptions {
  if (viewport === 'desktop') {
    const { width, height, deviceScaleFactor } = VIEWPORTS.desktop;
    return {
      ...COMMON_OPTIONS,
      viewport: { width, height },
      screen: { width, height },
      deviceScaleFactor,
      isMobile: false,
      hasTouch: false,
    };
  }

  const { width, height, deviceScaleFactor } = VIEWPORTS.mobile;
  return {
    ...COMMON_OPTIONS,
    userAgent: MOBILE_DEVICE.userAgent,
    // devices['iPhone 14']의 viewport는 브라우저 UI를 뺀 높이다. PRD 5.2.1은 390×844를 쓴다.
    viewport: { width, height },
    screen: { width, height },
    deviceScaleFactor,
    isMobile: true,
    hasTouch: true,
  };
}

/**
 * guard는 필수다. 요청 검사 없이 context를 만드는 경로를 두지 않는다(PRD 8.6, AGENTS.md 8장).
 * 연결된 guard는 getRouteGuard(context)로 얻는다.
 */
export async function createViewportContext(
  browser: Browser,
  viewport: Viewport,
  guard: RouteGuardOptions,
): Promise<BrowserContext> {
  const context = await browser.newContext(buildContextOptions(viewport));
  try {
    // page를 만들기 전에 연결한다. routeWebSocket은 연결 뒤에 만든 WebSocket에만 적용된다
    await attachRouteGuard(context, guard);
  } catch (error) {
    await context.close().catch(() => undefined);
    throw error;
  }
  return context;
}
