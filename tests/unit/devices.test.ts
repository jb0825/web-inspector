import { devices } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { Browser } from 'playwright-core';
import { buildContextOptions, createViewportContext, VIEWPORTS } from '@/server/browser/devices';
import { createHostChecker } from '@/server/security/ssrf';

describe('devices (PRD 5.2.1)', () => {
  it('viewport 상수가 PRD 값과 같다', () => {
    expect(VIEWPORTS.desktop).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
    expect(VIEWPORTS.mobile).toEqual({ width: 390, height: 844, deviceScaleFactor: 3 });
  });

  it('Desktop은 1440×900, deviceScaleFactor 1, isMobile false', () => {
    const options = buildContextOptions('desktop');
    expect(options.viewport).toEqual({ width: 1440, height: 900 });
    expect(options.deviceScaleFactor).toBe(1);
    expect(options.isMobile).toBe(false);
    expect(options.hasTouch).toBe(false);
  });

  it('Mobile은 iPhone 14 기반 390×844, isMobile, hasTouch, deviceScaleFactor 3, Mobile UA', () => {
    const options = buildContextOptions('mobile');
    expect(options.viewport).toEqual({ width: 390, height: 844 });
    expect(options.deviceScaleFactor).toBe(3);
    expect(options.isMobile).toBe(true);
    expect(options.hasTouch).toBe(true);
    expect(options.userAgent).toBe(devices['iPhone 14'].userAgent);
    expect(options.userAgent).toMatch(/iPhone/);
  });

  it.each(['desktop', 'mobile'] as const)('%s 공통 옵션: 다운로드·Service Worker·권한 차단, reducedMotion, ko-KR', (viewport) => {
    const options = buildContextOptions(viewport);
    expect(options.acceptDownloads).toBe(false);
    expect(options.serviceWorkers).toBe('block');
    expect(options.permissions).toEqual([]);
    expect(options.reducedMotion).toBe('reduce');
    expect(options.locale).toBe('ko-KR');
  });
});

describe('createViewportContext guard 인자 (PRD 8.6)', () => {
  it('guard 없이 호출하면 타입 오류다 (pnpm typecheck가 확인한다)', () => {
    // 실행하지 않는 함수: @ts-expect-error가 쓸모없어지면(=guard가 선택 인자가 되면) typecheck가 실패한다
    const typeOnly = (browser: Browser) => {
      // @ts-expect-error guard는 필수 인자다
      void createViewportContext(browser, 'desktop');
      void createViewportContext(browser, 'desktop', { checker: createHostChecker() });
    };
    expect(typeof typeOnly).toBe('function');
  });
});
