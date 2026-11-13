import { describe, expect, it } from 'vitest';
import { matchElements } from '@/server/compare/match';
import type { CollectedElement } from '@/server/collect/types';
import { el, r } from './helpers/collected';

// DETECTION_RULES 7.2, 12.1 dedup / match: 3가지 매칭 기준과 1:1 보장

interface Spec {
  index: number;
  id?: string;
  testId?: string;
  selector?: string;
  tag?: string;
  landmark?: string;
  textSnippet?: string;
}

let uniqueSelector = 0;

/** identity, selector, sourceHints를 직접 정한 요소 (기본값으로는 어떤 기준에도 맞지 않는다) */
function item(spec: Spec): CollectedElement {
  const base = el({ index: spec.index, tag: spec.tag ?? 'div', rect: r(0, 0, 10, 10) });
  return {
    ...base,
    identity: { ...(spec.id ? { id: spec.id } : {}), ...(spec.testId ? { testId: spec.testId } : {}) },
    selector: spec.selector ?? `#unique-${(uniqueSelector += 1)}`,
    sourceHints: {
      ...base.sourceHints,
      ...(spec.landmark !== undefined ? { landmark: spec.landmark } : {}),
      ...(spec.textSnippet !== undefined ? { textSnippet: spec.textSnippet } : {}),
    },
  };
}

const pairs = (desktop: CollectedElement[], mobile: CollectedElement[]) =>
  [...matchElements(desktop, mobile).desktopToMobile.entries()].sort((a, b) => a[0] - b[0]);

describe('matchElements (DETECTION_RULES 7.2)', () => {
  it('기준 1: id가 같음', () => {
    expect(pairs([item({ index: 3, id: 'hero' })], [item({ index: 7, id: 'hero' })])).toEqual([[3, 7]]);
  });

  it('기준 1: data-testid가 같음', () => {
    expect(pairs([item({ index: 3, testId: 'cta' })], [item({ index: 9, testId: 'cta' })])).toEqual([[3, 9]]);
  });

  it('기준 2: selector가 같음', () => {
    expect(pairs([item({ index: 3, selector: 'main > p' })], [item({ index: 4, selector: 'main > p' })])).toEqual([[3, 4]]);
  });

  it('기준 3: landmark, 태그, textSnippet이 모두 같음', () => {
    const d = item({ index: 3, tag: 'h2', landmark: 'pricing', textSnippet: '요금제' });
    expect(pairs([d], [item({ index: 5, tag: 'h2', landmark: 'pricing', textSnippet: '요금제' })])).toEqual([[3, 5]]);
    // 하나라도 다르면 매칭되지 않는다
    expect(pairs([d], [item({ index: 5, tag: 'h3', landmark: 'pricing', textSnippet: '요금제' })])).toEqual([]);
    expect(pairs([d], [item({ index: 5, tag: 'h2', landmark: 'faq', textSnippet: '요금제' })])).toEqual([]);
    // textSnippet이 비어 있으면 기준 3을 쓰지 않는다
    expect(pairs([item({ index: 3, tag: 'div' })], [item({ index: 5, tag: 'div' })])).toEqual([]);
    expect(pairs([item({ index: 3, textSnippet: '' })], [item({ index: 5, textSnippet: '' })])).toEqual([]);
  });

  it('id·testId가 없으면 기준 1로 매칭하지 않는다 (undefined끼리 같다고 보지 않음)', () => {
    expect(pairs([item({ index: 1 })], [item({ index: 2 })])).toEqual([]);
  });

  it('1:1: 후보가 여럿이면 문서 순서상 가장 앞의 것, 짝지어진 요소는 다시 쓰지 않는다', () => {
    const desktop = [item({ index: 10, selector: '.card' }), item({ index: 20, selector: '.card' })];
    const mobile = [item({ index: 40, selector: '.card' }), item({ index: 30, selector: '.card' })];
    expect(pairs(desktop, mobile)).toEqual([
      [10, 30],
      [20, 40],
    ]);
    // mobile 후보가 하나뿐이면 앞의 desktop 요소만 짝을 얻는다
    expect(pairs(desktop, [item({ index: 30, selector: '.card' })])).toEqual([[10, 30]]);
  });

  it('앞 기준의 짝을 먼저 정한다: 기준 1 짝이 기준 2 짝보다 우선', () => {
    // d1은 m1과 selector가 같고, d2는 m1과 testId가 같다
    const d1 = item({ index: 1, selector: '.title' });
    const d2 = item({ index: 2, testId: 'title' });
    const m1 = item({ index: 1, testId: 'title', selector: '.title' });
    expect(pairs([d1, d2], [m1])).toEqual([[2, 1]]);
  });

  it('mobileToDesktop은 desktopToMobile의 역이다', () => {
    const { desktopToMobile, mobileToDesktop } = matchElements(
      [item({ index: 1, id: 'a' }), item({ index: 2, id: 'b' })],
      [item({ index: 8, id: 'b' }), item({ index: 9, id: 'a' })],
    );
    for (const [d, m] of desktopToMobile) expect(mobileToDesktop.get(m)).toBe(d);
    expect(mobileToDesktop.size).toBe(2);
  });
});
