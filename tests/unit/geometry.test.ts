import { describe, expect, it } from 'vitest';
import {
  buildLookup,
  clipChain,
  contains,
  intersect,
  union,
  visibleRect,
  visibleTextRects,
} from '@/server/detect/geometry';
import { collected, el, r } from './helpers/collected';

// DETECTION_RULES 3.6, 12.1 geometry

describe('rect 기본 연산', () => {
  it('교집합, 합집합, 포함(1px 허용치)', () => {
    expect(intersect(r(0, 0, 10, 10), r(5, 5, 10, 10))).toEqual(r(5, 5, 5, 5));
    expect(intersect(r(0, 0, 10, 10), r(10, 0, 10, 10))).toBeNull();
    expect(union([r(0, 0, 10, 10), r(20, 5, 5, 20)])).toEqual(r(0, 0, 25, 25));
    expect(union([])).toBeNull();
    expect(contains(r(0, 0, 100, 100), r(-0.5, 0, 101, 100))).toBe(true);
    expect(contains(r(0, 0, 100, 100), r(-2, 0, 50, 50))).toBe(false);
  });
});

describe('geometry (DETECTION_RULES 12.1)', () => {
  it('자신의 overflow hidden으로 잘린 텍스트 rect', () => {
    const title = el({
      index: 1,
      rect: r(0, 0, 100, 24),
      textRects: [r(0, 0, 300, 24)],
      style: { overflowX: 'hidden', overflowY: 'hidden', textOverflow: 'ellipsis' },
    });
    const lookup = buildLookup(collected('desktop', [title]));
    expect(visibleTextRects(title, lookup)).toEqual([r(0, 0, 100, 24)]);
  });

  it('조상 체인에 따른 자르기', () => {
    const outer = el({ index: 1, rect: r(0, 0, 100, 100), style: { overflowX: 'hidden', overflowY: 'hidden' } });
    const middle = el({ index: 2, ancestors: [1], rect: r(0, 0, 300, 100) });
    const text = el({ index: 3, ancestors: [2, 1], rect: r(50, 10, 200, 20), textRects: [r(50, 10, 200, 20)] });
    const lookup = buildLookup(collected('desktop', [outer, middle, text]));
    expect(clipChain(text, true, lookup).map((e) => e.index)).toEqual([3, 2, 1]);
    expect(visibleTextRects(text, lookup)).toEqual([r(50, 10, 50, 20)]);
  });

  it('축별 자르기(overflowX만 hidden)', () => {
    const box = el({ index: 1, rect: r(0, 0, 100, 50), style: { overflowX: 'hidden', overflowY: 'visible' } });
    const text = el({ index: 2, ancestors: [1], rect: r(0, 0, 100, 50), textRects: [r(0, 30, 200, 40)] });
    const lookup = buildLookup(collected('desktop', [box, text]));
    // 가로는 0..100으로 잘리고 세로(30..70)는 그대로다
    expect(visibleTextRects(text, lookup)).toEqual([r(0, 30, 100, 40)]);
  });

  it('fixed 요소에서 체인 중단', () => {
    const clipper = el({ index: 1, rect: r(0, 0, 100, 100), style: { overflowX: 'hidden', overflowY: 'hidden' } });
    const fixed = el({ index: 2, ancestors: [1], rect: r(0, 0, 400, 60), style: { position: 'fixed' } });
    const text = el({ index: 3, ancestors: [2, 1], rect: r(0, 0, 300, 20), textRects: [r(0, 0, 300, 20)] });
    const lookup = buildLookup(collected('desktop', [clipper, fixed, text]));
    expect(clipChain(text, true, lookup).map((e) => e.index)).toEqual([3, 2]);
    expect(visibleTextRects(text, lookup)).toEqual([r(0, 0, 300, 20)]);
    // fixed 요소 자신의 박스도 조상의 overflow에 잘리지 않는다
    expect(clipChain(fixed, false, lookup)).toEqual([]);
    expect(visibleRect(fixed, lookup)).toEqual(r(0, 0, 400, 60));
  });

  it('완전히 잘린 rect 제거', () => {
    const box = el({ index: 1, rect: r(0, 0, 100, 40), style: { overflowX: 'hidden', overflowY: 'hidden' } });
    const text = el({
      index: 2,
      ancestors: [1],
      rect: r(0, 0, 100, 60),
      textRects: [r(0, 0, 100, 20), r(0, 20, 100, 20), r(0, 40, 100, 20)],
    });
    const lookup = buildLookup(collected('desktop', [box, text]));
    // 세 번째 줄(40..60)은 paddingBox(0..40) 밖이라 버린다
    expect(visibleTextRects(text, lookup)).toEqual([r(0, 0, 100, 20), r(0, 20, 100, 20)]);
    const hidden = el({ index: 3, ancestors: [1], tag: 'img', rect: r(200, 0, 50, 50) });
    expect(visibleRect(hidden, buildLookup(collected('desktop', [box, hidden])))).toBeNull();
  });

  it('`visibleRect`는 자신의 overflow에 잘리지 않음', () => {
    const parent = el({ index: 1, rect: r(0, 0, 150, 100), style: { overflowX: 'hidden', overflowY: 'visible' } });
    const self = el({
      index: 2,
      ancestors: [1],
      rect: r(0, 0, 200, 100),
      borderWidth: 10,
      style: { overflowX: 'hidden', overflowY: 'hidden' },
    });
    const lookup = buildLookup(collected('desktop', [parent, self]));
    // 자신의 paddingBox(10..190)가 아니라 부모의 paddingBox(0..150)로만 잘린다
    expect(visibleRect(self, lookup)).toEqual(r(0, 0, 150, 100));
  });
});
