import { describe, expect, it } from 'vitest';
import type { CollectedViewport } from '@/server/collect/types';
import type { RawIssue } from '@/server/detect/types';
import { PRIORITY_THRESHOLDS, REACH_MAX, SCORE_RULES } from '@/server/priority/rules';
import { priorityOf, reachOf, scoreIssue, toScore100 } from '@/server/priority/score';
import type { Viewport } from '@/types/inspection';
import { collected, el, r } from './helpers/collected';
import { merged, raw } from './helpers/issues';

// PRD 5.5, DETECTION_RULES 9장, 12.1 score

/** 요소 1: 일반 div, 2: button, 3: button 안의 span, 4: nav 안 링크 텍스트 */
function page(viewport: Viewport, overrides: Partial<CollectedViewport> = {}): CollectedViewport {
  return collected(
    viewport,
    [
      el({ index: 1, rect: r(0, 0, 100, 40) }),
      el({ index: 2, tag: 'button', rect: r(0, 0, 100, 40), flags: { interactive: true } }),
      el({ index: 3, ancestors: [2], tag: 'span', rect: r(10, 10, 80, 20) }),
      el({ index: 4, tag: 'span', rect: r(0, 0, 100, 40), flags: { inNav: true } }),
    ],
    overrides,
  );
}

const both = { desktop: page('desktop'), mobile: page('mobile') };

/** 첫 화면 밖(y = 2000), desktop 하나만 → Reach 보정 없음 */
const below = (spec: Omit<Parameters<typeof raw>[0], 'boundingBox'>): RawIssue => raw({ ...spec, boundingBox: r(0, 2000, 100, 40) });

describe('점수표 9행 (9.1)', () => {
  const cases: [string, RawIssue, { S: number; I: number; R: number }][] = [
    ['1. page-scroll', below({ type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1 }), { S: 4, I: 4, R: 5 }],
    ['2. overlap interactive', below({ type: 'element-overlap', subtype: 'interactive', elementIndex: 2 }), { S: 5, I: 4, R: 3 }],
    ['3. clipped + 인터랙티브 요소', below({ type: 'text-overflow', subtype: 'clipped', elementIndex: 2 }), { S: 4, I: 4, R: 3 }],
    ['3. clipped + 인터랙티브 영역(button 안 span)', below({ type: 'text-overflow', subtype: 'clipped', elementIndex: 3 }), { S: 4, I: 4, R: 3 }],
    ['3. clipped + nav 안', below({ type: 'text-overflow', subtype: 'clipped', elementIndex: 4 }), { S: 4, I: 4, R: 3 }],
    ['4. hidden-clip', below({ type: 'viewport-overflow', subtype: 'hidden-clip', elementIndex: 1 }), { S: 3, I: 4, R: 4 }],
    ['5. clipped 그 밖', below({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }), { S: 3, I: 3, R: 3 }],
    ['6. overlap text', below({ type: 'element-overlap', subtype: 'text', elementIndex: 1 }), { S: 3, I: 3, R: 3 }],
    ['7. spill', below({ type: 'text-overflow', subtype: 'spill', elementIndex: 1 }), { S: 2, I: 3, R: 3 }],
    ['8. element-out', below({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 1 }), { S: 2, I: 2, R: 3 }],
    ['9. overlap other', below({ type: 'element-overlap', subtype: 'other', elementIndex: 1 }), { S: 2, I: 2, R: 2 }],
  ];

  it.each(cases)('%s', (_, issue, expected) => {
    const { scores } = scoreIssue(merged(issue), both);
    expect({ S: scores.S, I: scores.I, R: scores.R }).toEqual(expected);
    expect(scores.score100).toBe(expected.S * 35 + expected.I * 35 + expected.R * 30);
  });

  it('PRD 5.5.3 표의 score100과 Priority (보정 전)', () => {
    expect(SCORE_RULES.map((rule) => [toScore100(rule.S, rule.I, rule.R), priorityOf(toScore100(rule.S, rule.I, rule.R))])).toEqual([
      [430, 'P0'],
      [405, 'P0'],
      [370, 'P1'],
      [365, 'P1'],
      [300, 'P1'],
      [300, 'P1'],
      [265, 'P2'],
      [230, 'P2'],
      [200, 'P2'],
    ]);
  });

  it('"추가 조건"은 occurrences[0]의 요소로 판정한다', () => {
    // desktop은 일반 요소(1), mobile은 버튼(2) → desktop 기준이라 5행
    const issue = merged(
      below({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }),
      below({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 2 }),
    );
    expect(scoreIssue(issue, both).scores.S).toBe(3);
  });
});

describe('Reach 보정 (9.2)', () => {
  const heights = { desktop: 900, mobile: 844 };

  it('첫 화면 +1, 양쪽 발생 +1, 최대 REACH_MAX', () => {
    const top = raw({ type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1, boundingBox: r(0, 100, 10, 10) });
    const topMobile = { ...top, viewport: 'mobile' as const };
    expect(reachOf(3, merged(top), heights)).toBe(4);
    expect(reachOf(3, merged(top, topMobile), heights)).toBe(5);
    // page-scroll 5 + 1 + 1 → 5
    expect(reachOf(5, merged(top, topMobile), heights)).toBe(REACH_MAX);
  });

  it('어느 한 occurrence라도 첫 화면 안이면 +1 (대표 occurrence만 보지 않는다)', () => {
    const d = raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 1, boundingBox: r(0, 1200, 10, 10) });
    const m = raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 1, boundingBox: r(0, 500, 10, 10) });
    expect(reachOf(3, merged(d, m), heights)).toBe(5);
  });

  it('경계: y < viewport height일 때만 첫 화면', () => {
    const at = (y: number) => merged(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1, boundingBox: r(0, y, 10, 10) }));
    expect(reachOf(3, at(899.99), heights)).toBe(4);
    expect(reachOf(3, at(900), heights)).toBe(3);
  });

  it('첫 화면 판정은 innerHeight가 아니라 viewportSize.height 기준이다 (3.1.1)', () => {
    // P-01처럼 페이지가 축소되어 innerHeight가 1334가 된 mobile. y = 900은 844 밖이다
    const zoomed = { desktop: null, mobile: page('mobile', { innerWidth: 616, innerHeight: 1334 }) };
    const issue = merged(raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 1, boundingBox: r(0, 900, 10, 10) }));
    expect(scoreIssue(issue, zoomed).scores.R).toBe(3);
    const inside = merged(raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 1, boundingBox: r(0, 843, 10, 10) }));
    expect(scoreIssue(inside, zoomed).scores.R).toBe(4);
  });
});

describe('점수와 등급 (9.3)', () => {
  it('S=I=R=3 → 300 → P1 (부동소수점이면 2.9999999999999996)', () => {
    expect(3 * 0.35 + 3 * 0.35 + 3 * 0.3).toBeLessThan(3);
    expect(toScore100(3, 3, 3)).toBe(300);
    expect(priorityOf(toScore100(3, 3, 3))).toBe('P1');
  });

  it('경계 399/400, 299/300, 199/200', () => {
    expect(priorityOf(400)).toBe('P0');
    expect(priorityOf(399)).toBe('P1');
    expect(priorityOf(300)).toBe('P1');
    expect(priorityOf(299)).toBe('P2');
    expect(priorityOf(200)).toBe('P2');
    expect(priorityOf(199)).toBe('P3');
    expect(PRIORITY_THRESHOLDS.map((t) => t.min)).toEqual([400, 300, 200]);
  });

  it('Priority는 Confidence와 관계없이 계산한다 (9.4)', () => {
    const issue = below({ type: 'element-overlap', subtype: 'interactive', elementIndex: 2 });
    const low = scoreIssue(merged({ ...issue, confidence: 0.4 }), both);
    const high = scoreIssue(merged(issue), both);
    expect(low).toEqual(high);
  });

  it('Fixture 기대값과 같은 계산: P-02 clipped 버튼, 첫 화면 밖, mobile-only → 370 P1', () => {
    const issue = merged(raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 2, boundingBox: r(0, 1000, 10, 10) }));
    expect(scoreIssue(issue, both)).toEqual({ scores: { S: 4, I: 4, R: 3, score100: 370 }, priority: 'P1' });
  });
});
