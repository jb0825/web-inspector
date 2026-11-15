import { describe, expect, it } from 'vitest';
import { buildScopeNotices } from '@/features/report/logic/scope';
import { buildViewportResult } from '@/server/evidence/finalize';
import { viewportResultViolations } from '@/server/store/invariants';
import type { ViewportResult } from '@/types/inspection';
import { pendingDoc } from './helpers/inspection';
import { site } from './helpers/site';

// T14 / PRD 5.2.4: 스크린샷만 실패한 viewport. 결과는 남고 스크린샷 값은 null이다.

const detection = { overlaysDetected: [] };
const shot = { screenshotWidth: 1440, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false };

describe('buildViewportResult: 스크린샷 없음', () => {
  it('스크린샷 값은 모두 null, 잘림은 false, documentHeight는 수집 값이다', () => {
    const collected = site('desktop');
    const result = buildViewportResult(collected, null, detection, null);
    expect(result).toMatchObject({ screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false, documentHeight: collected.documentHeight });
    expect(viewportResultViolations('desktop', result)).toEqual([]);
  });

  it('스크린샷이 있으면 기존과 같다', () => {
    const result = buildViewportResult(site('desktop'), shot, detection, 'https://blob.example/d.png');
    expect(result).toMatchObject({ screenshotUrl: 'https://blob.example/d.png', screenshotWidth: 1440, screenshotHeight: 2000 });
    expect(viewportResultViolations('desktop', result)).toEqual([]);
  });
});

describe('불변 조건 V-2: 스크린샷 없음은 세 값이 함께 null이고 잘림 표시가 없다', () => {
  const base = buildViewportResult(site('desktop'), null, detection, null);
  it.each<[string, Partial<ViewportResult>]>([
    ['너비만 남음', { screenshotWidth: 1440 }],
    ['URL만 남음', { screenshotUrl: 'https://blob.example/d.png' }],
    ['잘림 표시', { screenshotTruncated: true }],
  ])('%s → V-2', (_, overrides) => {
    expect(viewportResultViolations('desktop', { ...base, ...overrides }).map((v) => v.id)).toContain('V-2');
  });
});

describe('검사 범위 안내: 스크린샷 없음', () => {
  it('viewport 실패가 아니라 screenshot-missing으로 알린다', () => {
    const desktop = buildViewportResult(site('desktop'), null, detection, null);
    const doc = pendingDoc({ status: 'completed', viewports: { desktop, mobile: null }, analysis: { status: 'completed', analyzedIssueCount: 0 } });
    const notices = buildScopeNotices(doc);
    expect(notices.map((n) => [n.kind, n.text])).toContainEqual([
      'screenshot-missing',
      'Desktop 화면을 저장하지 못해 측정값으로 그린 배치도로 표시합니다. 측정과 이슈는 정상입니다.',
    ]);
    expect(notices.some((n) => n.kind === 'viewport-failed' || n.kind === 'screenshot-truncated')).toBe(false);
  });

  it('두 viewport 모두 없으면 한 문장으로 알린다', () => {
    const desktop = buildViewportResult(site('desktop'), null, detection, null);
    const mobile = buildViewportResult(site('mobile'), null, detection, null);
    const doc = pendingDoc({ status: 'completed', viewports: { desktop, mobile }, analysis: { status: 'completed', analyzedIssueCount: 0 } });
    const missing = buildScopeNotices(doc).filter((n) => n.kind === 'screenshot-missing');
    expect(missing.map((n) => n.text)).toEqual(['Desktop과 Mobile 화면을 저장하지 못해 측정값으로 그린 배치도로 표시합니다. 측정과 이슈는 정상입니다.']);
  });
});
