import { describe, expect, it } from 'vitest';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import { MAX_CANDIDATES, MAX_ISSUES } from '@/server/detect/constants';
import { formatIssueId } from '@/server/detect/order';
import { buildIssues } from '@/server/detect/pipeline';
import type { Viewport } from '@/types/inspection';
import { collected, el, r, shuffled } from './helpers/collected';

// DETECTION_RULES 1.3 파이프라인, 7장, 11장 결정성

/** 두 viewport에 같은 testId로 같은 구성을 둔 페이지. Mobile에서만 600px 박스가 넘친다 */
function site(viewport: Viewport): CollectedViewport {
  const mobile = viewport === 'mobile';
  const elements: CollectedElement[] = [
    // 고정 너비 박스와 자손 (Mobile에서만 page-scroll)
    el({ index: 1, rect: r(16, 100, 600, 100), testId: 'box' }),
    el({ index: 2, ancestors: [1], rect: r(420, 110, 180, 60), textRects: [r(430, 120, 150, 20)], testId: 'box-child' }),
    // 겹친 버튼 두 개 (양쪽)
    el({ index: 3, tag: 'button', rect: r(16, 300, 100, 44), textRects: [r(30, 312, 60, 20)], flags: { interactive: true }, testId: 'save' }),
    el({ index: 4, tag: 'button', rect: r(80, 304, 100, 44), textRects: [r(94, 316, 60, 20)], flags: { interactive: true }, testId: 'cancel' }),
    // spill 카드 (양쪽, 첫 화면 밖)
    el({ index: 5, rect: r(16, 1500, 300, 100), style: { backgroundColor: 'rgb(255, 248, 197)', paddingSum: 32 }, testId: 'card' }),
    el({ index: 6, ancestors: [5], tag: 'p', rect: r(32, 1516, 268, 120), textRects: [r(32, 1516, 260, 24), r(32, 1610, 200, 24)], testId: 'card-text' }),
  ];
  return collected(viewport, elements, mobile ? { documentScrollWidth: 616 } : {});
}

const summary = (result: ReturnType<typeof buildIssues>) =>
  result.issues.map((i) => `${i.id} ${i.type}/${i.subtype} ${i.priority} ${i.viewportTag} @${i.occurrences.map((o) => `${o.viewport[0]}${o.elementIndex}`).join(',')}`);

describe('buildIssues', () => {
  it('탐지부터 연결까지 실행한다', () => {
    const result = buildIssues({ desktop: site('desktop'), mobile: site('mobile') });
    expect(summary(result)).toEqual([
      'ISS-001 element-overlap/interactive P0 both @d3,m3',
      'ISS-002 text-overflow/spill P2 both @d6,m6',
      'ISS-003 viewport-overflow/page-scroll P0 mobile-only @m1',
    ]);
    // 규칙 1: 원인 박스 하나만, 자손 수 기록
    expect(result.issues[2].affectedDescendants).toBe(1);
    expect(result.issuesDetected).toBe(3);
    expect(result.issuesTruncated).toBe(false);
    expect(result.viewports.mobile).toEqual({ overlaysDetected: [], unexplainedPageScroll: false });
  });

  it('한 viewport가 실패(null)하면 viewportTag는 null이고 부가 정보도 null', () => {
    const result = buildIssues({ desktop: null, mobile: site('mobile') });
    expect(result.issues.every((i) => i.viewportTag === null)).toBe(true);
    expect(result.issues.map((i) => i.viewports)).toEqual([['mobile'], ['mobile'], ['mobile']]);
    expect(result.viewports.desktop).toBeNull();
    expect(buildIssues({ desktop: null, mobile: null })).toEqual({
      issues: [],
      viewports: { desktop: null, mobile: null },
      issuesDetected: 0,
      issuesTruncated: false,
    });
  });

  it('viewport가 바뀐 입력은 거부한다', () => {
    expect(() => buildIssues({ desktop: site('mobile'), mobile: null })).toThrow();
  });

  it('결정성: 입력 순서를 섞어도 JSON이 같다', () => {
    const base = buildIssues({ desktop: site('desktop'), mobile: site('mobile') });
    const d = site('desktop');
    const m = site('mobile');
    const mixed = buildIssues({ desktop: { ...d, elements: shuffled(d.elements) }, mobile: { ...m, elements: shuffled(m.elements) } });
    expect(JSON.stringify(mixed)).toBe(JSON.stringify(base));
    expect(JSON.stringify(buildIssues({ desktop: site('desktop'), mobile: site('mobile') }))).toBe(JSON.stringify(base));
  });

  it('입력을 바꾸지 않는다', () => {
    const input = { desktop: site('desktop'), mobile: site('mobile') };
    const before = JSON.stringify(input);
    buildIssues(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('규칙 4와 상한', () => {
  /**
   * 왼쪽으로 나간 이미지 n개(element-out, 첫 화면 안 → 260)와,
   * 첫 화면 밖에서 왼쪽으로 나가면서 글자가 잘린 버튼 하나(element-out 230 + clipped 370(인터랙티브, 3행), 서로 연결 대상)
   */
  function crowded(n: number): CollectedViewport {
    const images = Array.from({ length: n }, (_, i) => el({ index: i + 1, tag: 'img', rect: r(-30, i * 4, 100, 3) }));
    const button = el({
      index: 1000,
      tag: 'button',
      rect: r(-30, 2000, 100, 40),
      textRects: [r(-20, 2010, 300, 20)],
      scrollWidth: 290,
      clientWidth: 100,
      style: { overflowX: 'hidden', overflowY: 'hidden' },
      flags: { interactive: true },
    });
    return collected('desktop', [...images, button]);
  }

  it('같은 요소의 viewport-overflow와 text-overflow는 서로 연결된다', () => {
    const result = buildIssues({ desktop: crowded(3), mobile: collected('mobile', []) });
    const vo = result.issues.find((i) => i.occurrences[0].elementIndex === 1000 && i.type === 'viewport-overflow');
    const text = result.issues.find((i) => i.type === 'text-overflow');
    expect(vo?.subtype).toBe('element-out');
    expect(text?.subtype).toBe('clipped');
    expect(vo?.relatedIssueIds).toEqual([text?.id]);
    expect(text?.relatedIssueIds).toEqual([vo?.id]);
  });

  it('상한을 넘으면 점수 높은 것부터 남고, ID에 빈 번호가 없고, relatedIssueIds에 없는 ID가 없다', () => {
    const result = buildIssues({ desktop: crowded(210), mobile: collected('mobile', []) });
    expect(result.issuesDetected).toBe(212);
    expect(result.issuesTruncated).toBe(true);
    expect(result.issues).toHaveLength(MAX_ISSUES);
    expect(result.issues.map((i) => i.id)).toEqual(Array.from({ length: MAX_ISSUES }, (_, i) => formatIssueId(i + 1)));

    // clipped(370)이 남고, 버튼의 element-out(230)은 이미지(260)에 밀려 버려진다
    const text = result.issues.find((i) => i.type === 'text-overflow');
    expect(text?.scores.score100).toBe(370);
    expect(result.issues.some((i) => i.occurrences[0].elementIndex === 1000 && i.type === 'viewport-overflow')).toBe(false);
    // 같은 점수의 이미지는 7.4 키(요소 index) 순으로 199개
    const images = result.issues.filter((i) => i.type === 'viewport-overflow').map((i) => i.occurrences[0].elementIndex);
    expect(images).toEqual(Array.from({ length: 199 }, (_, i) => i + 1));

    // 짝이 버려졌으므로 연결하지 않는다 (DOMAIN_MODEL S-6)
    expect(text?.relatedIssueIds).toEqual([]);
    const ids = new Set(result.issues.map((i) => i.id));
    for (const issue of result.issues) {
      for (const id of issue.relatedIssueIds) {
        expect(ids.has(id)).toBe(true);
        expect(id).not.toBe(issue.id);
      }
    }
  });

  it('최악의 입력(후보 3,000개가 모두 서로 겹침)에서도 이슈 수가 상한 안이고 2초 안에 끝난다', () => {
    const images = Array.from({ length: MAX_CANDIDATES }, (_, i) => el({ index: i + 1, tag: 'img', rect: r(i * 0.1, 0, 400, 400) }));
    const desktop = collected('desktop', images);
    const started = performance.now();
    const result = buildIssues({ desktop, mobile: collected('mobile', []) });
    const elapsed = performance.now() - started;
    // 쌍은 약 450만 개지만 대상 요소 기준으로 묶여 이슈는 요소 수 이내다
    expect(result.issuesDetected).toBeGreaterThan(MAX_ISSUES);
    expect(result.issuesDetected).toBeLessThan(MAX_CANDIDATES);
    expect(result.issues).toHaveLength(MAX_ISSUES);
    expect(result.issuesTruncated).toBe(true);
    expect(elapsed).toBeLessThan(2000);
    console.info(`[perf] worst case: ${elapsed.toFixed(0)}ms, issuesDetected ${result.issuesDetected}`);
  });
});
