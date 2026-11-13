import { describe, expect, it } from 'vitest';
import { detectViewportOverflow } from '@/server/detect/viewportOverflow';
import { collected, el, r } from './helpers/collected';

// DETECTION_RULES 6장, 12.1 viewportOverflow (Mobile layoutWidth 390)

describe('viewportOverflow (DETECTION_RULES 12.1)', () => {
  it('page-scroll 원인 1개와 affectedDescendants', () => {
    const table = el({ index: 1, rect: r(16, 200, 600, 106) });
    const plans = [r(33, 214, 180, 72), r(225, 214, 180, 72), r(418, 214, 180, 72)].map((rect, i) =>
      el({ index: 2 + i, ancestors: [1], rect }),
    );
    const label = el({ index: 5, ancestors: [4, 1], rect: r(430, 230, 150, 20), textRects: [r(430, 230, 150, 20)] });
    const result = detectViewportOverflow(collected('mobile', [table, ...plans, label], { documentScrollWidth: 616 }));
    expect(result.unexplainedPageScroll).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      type: 'viewport-overflow',
      subtype: 'page-scroll',
      elementIndex: 1,
      // 225..405와 418..598 카드, 그 안의 label
      affectedDescendants: 3,
      measured: { elementRight: 616, documentScrollWidth: 616 },
      expected: { layoutWidth: 390 },
      delta: { overflowRight: 226 },
      relatedElements: [],
      confidence: 1,
    });
  });

  it('nowrap 텍스트만 넘친 제목이 원인', () => {
    const title = el({
      index: 1,
      tag: 'h1',
      rect: r(16, 100, 358, 40),
      textRects: [r(16, 100, 477, 40)],
      style: { whiteSpace: 'nowrap' },
    });
    const { issues } = detectViewportOverflow(collected('mobile', [title], { documentScrollWidth: 493 }));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ subtype: 'page-scroll', elementIndex: 1, delta: { overflowRight: 103 } });
  });

  it('ellipsis 제목(자신의 overflow hidden)은 이탈 아님', () => {
    const title = el({
      index: 1,
      tag: 'h3',
      rect: r(16, 100, 341, 28),
      textRects: [r(16, 100, 576, 28)],
      style: { overflowX: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    });
    expect(detectViewportOverflow(collected('mobile', [title])).issues).toEqual([]);
  });

  it('캐러셀(overflow-x auto 조상) 제외', () => {
    const track = el({ index: 1, rect: r(16, 100, 358, 200), style: { overflowX: 'auto', overflowY: 'hidden' } });
    const slides = [0, 1, 2, 3].map((i) => el({ index: 2 + i, ancestors: [1], rect: r(16 + i * 276, 100, 260, 200) }));
    const result = detectViewportOverflow(collected('mobile', [track, ...slides]));
    expect(result.issues).toEqual([]);
    expect(result.unexplainedPageScroll).toBe(false);
  });

  it('hidden-clip', () => {
    const image = el({ index: 1, tag: 'img', rect: r(274, 100, 400, 300) });
    const result = detectViewportOverflow(
      collected('mobile', [image], { documentScrollWidth: 674, rootOverflowX: { html: 'visible', body: 'hidden' } }),
    );
    // DETECTION_RULES 6.4: scrollWidth가 넘친 너비를 보고해도 rootClip을 먼저 본다
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      subtype: 'hidden-clip',
      measured: { elementLeft: 274, elementRight: 674 },
      expected: { layoutWidth: 390, minLeft: 0 },
      delta: { overflowRight: 284 },
      affectedDescendants: 0,
    });
    expect(result.unexplainedPageScroll).toBe(false);
  });

  it('왼쪽 이탈은 element-out', () => {
    const image = el({ index: 1, tag: 'img', rect: r(-50, 100, 200, 100) });
    const { issues } = detectViewportOverflow(collected('mobile', [image]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ subtype: 'element-out', delta: { overflowLeft: 50 } });
    expect(Object.keys(issues[0].delta)).toEqual(['overflowLeft']);
  });

  it('fixed 요소는 page-scroll 아님', () => {
    const toast = el({
      index: 1,
      rect: r(200, 700, 300, 60),
      textRects: [r(216, 716, 268, 28)],
      style: { position: 'fixed' },
      flags: { fixedOrSticky: true, fixedRoot: true },
    });
    const result = detectViewportOverflow(collected('mobile', [toast], { documentScrollWidth: 500 }));
    expect(result.issues.map((i) => i.subtype)).toEqual(['element-out']);
    // 문서는 가로로 스크롤되는데 page-scroll 원인이 없다
    expect(result.unexplainedPageScroll).toBe(true);
  });

  it('원인을 찾지 못한 page-scroll은 이슈 없이 unexplainedPageScroll', () => {
    const result = detectViewportOverflow(collected('mobile', [el({ index: 1, rect: r(16, 0, 358, 100) })], { documentScrollWidth: 450 }));
    expect(result).toEqual({ issues: [], unexplainedPageScroll: true });
  });

  it('1px 허용치 안의 넘침은 이탈이 아니다', () => {
    const box = el({ index: 1, rect: r(0, 0, 390.9, 100) });
    expect(detectViewportOverflow(collected('mobile', [box], { documentScrollWidth: 391 })).issues).toEqual([]);
  });
});
