import { devices } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { buildContextOptions, VIEWPORTS } from '@/server/browser/devices';

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
