import { describe, expect, it } from 'vitest';
import { detectTextOverflow, isBorderedBox, isTransparentColor } from '@/server/detect/textOverflow';
import { collected, el, r } from './helpers/collected';

// DETECTION_RULES 4장, 12.1 textOverflow

/** overflow로 잘리는 버튼: paddingBox 100×40, 텍스트는 오른쪽/아래로 넘친다 */
function clippedButton(options: { x?: boolean; y?: boolean; style?: Parameters<typeof el>[0]['style'] }) {
  return el({
    index: 1,
    tag: 'button',
    rect: r(0, 0, 100, 40),
    textRects: [r(10, 10, options.x ? 180 : 80, options.y ? 60 : 20)],
    scrollWidth: options.x ? 190 : 100,
    clientWidth: 100,
    scrollHeight: options.y ? 70 : 40,
    clientHeight: 40,
    flags: { interactive: true },
    style: { overflowX: 'hidden', overflowY: 'hidden', ...options.style },
  });
}

describe('textOverflow clipped (DETECTION_RULES 12.1)', () => {
  it('clipped x', () => {
    const { issues } = detectTextOverflow(collected('mobile', [clippedButton({ x: true })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: 'text-overflow',
      subtype: 'clipped',
      elementIndex: 1,
      axes: ['x'],
      measured: { scrollWidth: 190 },
      expected: { clientWidth: 100 },
      delta: { overflowX: 90 },
      relatedElements: [],
      confidence: 1,
      boundingBox: r(0, 0, 100, 40),
    });
  });

  it('clipped y', () => {
    const { issues } = detectTextOverflow(collected('mobile', [clippedButton({ y: true })]));
    expect(issues.map((i) => i.type === 'text-overflow' && i.subtype === 'clipped' && i.axes)).toEqual([['y']]);
    expect(issues[0].delta).toEqual({ overflowY: 30 });
  });

  it('clipped 양축', () => {
    const { issues } = detectTextOverflow(collected('mobile', [clippedButton({ x: true, y: true })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ axes: ['x', 'y'], delta: { overflowX: 90, overflowY: 30 } });
  });

  it('이미지만 넘친 overflow hidden 카드는 없음', () => {
    const card = el({
      index: 1,
      rect: r(0, 0, 300, 300),
      scrollWidth: 390,
      clientWidth: 300,
      style: { overflowX: 'hidden', overflowY: 'hidden' },
    });
    const image = el({ index: 2, ancestors: [1], tag: 'img', rect: r(-45, 0, 390, 200) });
    const text = el({ index: 3, ancestors: [1], tag: 'p', rect: r(16, 216, 268, 40), textRects: [r(16, 216, 260, 20)] });
    expect(detectTextOverflow(collected('mobile', [card, image, text])).issues).toEqual([]);
  });

  it('ellipsis/line-clamp 제외', () => {
    const ellipsis = clippedButton({ x: true, style: { textOverflow: 'ellipsis' } });
    const clamp = clippedButton({ y: true, style: { webkitLineClamp: '2' } });
    expect(detectTextOverflow(collected('mobile', [ellipsis])).issues).toEqual([]);
    expect(detectTextOverflow(collected('mobile', [clamp])).issues).toEqual([]);
  });

  it('overflow auto 제외', () => {
    const scroller = clippedButton({ x: true, y: true, style: { overflowX: 'auto', overflowY: 'scroll' } });
    expect(detectTextOverflow(collected('mobile', [scroller])).issues).toEqual([]);
  });

  it('중첩 clipped는 깊은 쪽만', () => {
    const outer = el({
      index: 1,
      rect: r(0, 0, 200, 40),
      scrollWidth: 300,
      clientWidth: 200,
      style: { overflowX: 'hidden', overflowY: 'visible' },
    });
    const inner = el({
      index: 2,
      ancestors: [1],
      rect: r(0, 0, 100, 40),
      textRects: [r(0, 10, 300, 20)],
      scrollWidth: 300,
      clientWidth: 100,
      style: { overflowX: 'hidden', overflowY: 'visible' },
    });
    const { issues } = detectTextOverflow(collected('desktop', [outer, inner]));
    expect(issues.map((i) => i.elementIndex)).toEqual([2]);
  });
});

describe('textOverflow spill (DETECTION_RULES 12.1)', () => {
  const card = (style = {}) =>
    el({ index: 1, rect: r(16, 100, 360, 120), style: { backgroundColor: 'rgb(255, 248, 197)', paddingSum: 32, ...style } });
  const text = (ancestors = [1]) =>
    el({
      index: 3,
      ancestors,
      tag: 'p',
      rect: r(32, 116, 328, 146),
      textRects: [r(32, 116, 320, 24), r(32, 140, 320, 24), r(32, 236, 300, 26)],
    });

  it('spill 기본', () => {
    const { issues } = detectTextOverflow(collected('desktop', [card(), text()]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: 'text-overflow',
      subtype: 'spill',
      elementIndex: 3,
      measured: { textBottom: 262 },
      expected: { containerBottom: 220 },
      delta: { overflowBottom: 42 },
      relatedElements: [{ role: 'bordered-ancestor', index: 1 }],
    });
    expect(Object.keys(issues[0].delta)).toEqual(['overflowBottom']);
  });

  it('테두리 박스 없음', () => {
    const plain = el({ index: 1, rect: r(16, 100, 360, 120) });
    expect(isBorderedBox(plain)).toBe(false);
    expect(detectTextOverflow(collected('desktop', [plain, text()])).issues).toEqual([]);
  });

  it('중간에 overflow hidden 있으면 spill 아님', () => {
    const middle = el({ index: 2, ancestors: [1], rect: r(16, 100, 360, 120), style: { overflowX: 'hidden', overflowY: 'hidden' } });
    expect(detectTextOverflow(collected('desktop', [card(), middle, text([2, 1])])).issues).toEqual([]);
  });

  it('ellipsis/line-clamp는 T와 B 모두에 적용한다', () => {
    expect(detectTextOverflow(collected('desktop', [card({ webkitLineClamp: '3' }), text()])).issues).toEqual([]);
  });

  it('투명색 판정', () => {
    expect(isTransparentColor('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isTransparentColor('transparent')).toBe(true);
    expect(isTransparentColor('rgb(0 0 0 / 0)')).toBe(true);
    expect(isTransparentColor('rgba(0, 0, 0, 0.5)')).toBe(false);
    expect(isTransparentColor('rgb(255, 255, 255)')).toBe(false);
  });
});
