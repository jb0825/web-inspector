import { describe, expect, it } from 'vitest';
import { correctLineHeight, detectOverlap, parseLineHeightPx } from '@/server/detect/overlap';
import { collected, el, r } from './helpers/collected';

// DETECTION_RULES 5장, 12.1 overlap

const img = (index: number, rect: ReturnType<typeof r>, ancestors: number[] = []) =>
  el({ index, ancestors, tag: 'img', rect });
const text = (index: number, rect: ReturnType<typeof r>, ancestors: number[] = [], extra: Parameters<typeof el>[0] = { index, rect }) =>
  el({ ...extra, index, ancestors, tag: extra.tag ?? 'p', rect, textRects: extra.textRects ?? [rect] });

describe('overlap (DETECTION_RULES 12.1)', () => {
  it('버튼 두 개 → interactive, Confidence 1.0', () => {
    const actions = el({ index: 1, rect: r(0, 0, 300, 60), style: { position: 'relative' } });
    const save = el({
      index: 2,
      ancestors: [1],
      tag: 'button',
      rect: r(0, 0, 91, 44),
      textRects: [r(16, 12, 59, 20)],
      flags: { interactive: true },
      style: { position: 'absolute' },
    });
    const cancel = el({
      index: 3,
      ancestors: [1],
      tag: 'button',
      rect: r(64, 8, 91, 44),
      textRects: [r(80, 20, 59, 20)],
      flags: { interactive: true },
      style: { position: 'absolute' },
    });
    const { issues } = detectOverlap(collected('desktop', [actions, save, cancel]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      type: 'element-overlap',
      subtype: 'interactive',
      elementIndex: 2,
      relatedIndex: 3,
      confidence: 1,
      boundingBox: r(0, 0, 91, 44),
      relatedElements: [{ role: 'overlap-target', index: 3 }],
      expected: { minRatioPercent: 20, minAreaPx2: 100 },
      delta: {},
    });
    // (91 - 64) × (44 - 8) = 972, 작은 쪽 91 × 44 = 4004 → 24.28%
    expect(issues[0].measured).toEqual({ intersectionArea: 972, overlapRatioPercent: 24.28, overlapTargetCount: 1 });
  });

  it('absolute 배지(부모 안) → 0.4', () => {
    const card = el({ index: 1, rect: r(0, 0, 300, 300), style: { position: 'relative' } });
    const image = img(2, r(0, 0, 300, 200), [1]);
    const badge = text(3, r(10, 180, 80, 40), [1], {
      index: 3,
      rect: r(10, 180, 80, 40),
      tag: 'span',
      style: { position: 'absolute', backgroundColor: 'rgb(0, 0, 0)' },
    });
    const { issues } = detectOverlap(collected('desktop', [card, image, badge]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ subtype: 'other', elementIndex: 2, relatedIndex: 3, confidence: 0.4 });
  });

  it('조상/자손 제외', () => {
    // 인터랙티브 요소는 텍스트 자손이 있어도 비교 대상이다(5.1). 둘은 조상/자손이라 비교되지 않는다.
    const button = el({ index: 1, tag: 'button', rect: r(0, 0, 120, 40), flags: { interactive: true } });
    const label = text(2, r(10, 10, 100, 20), [1], { index: 2, rect: r(10, 10, 100, 20), tag: 'span' });
    expect(detectOverlap(collected('desktop', [button, label])).issues).toEqual([]);
  });

  it('img 위 텍스트 제외', () => {
    const hero = img(1, r(0, 0, 1440, 600));
    const title = text(2, r(100, 200, 600, 60));
    const bg = el({ index: 3, rect: r(0, 700, 800, 300), style: { backgroundImage: 'url("/a.png")' }, textRects: [r(0, 700, 800, 300)] });
    const caption = text(4, r(100, 800, 300, 40));
    expect(detectOverlap(collected('desktop', [hero, title, bg, caption])).issues).toEqual([]);
  });

  it('sticky와 일반 요소 제외', () => {
    const header = text(1, r(0, 0, 1440, 60), [], { index: 1, rect: r(0, 0, 1440, 60), flags: { fixedOrSticky: true } });
    const body = text(2, r(0, 30, 600, 60));
    expect(detectOverlap(collected('desktop', [header, body])).issues).toEqual([]);
  });

  it('fixed끼리 탐지', () => {
    const a = text(1, r(0, 0, 200, 40), [], { index: 1, rect: r(0, 0, 200, 40), flags: { fixedOrSticky: true, fixedRoot: true } });
    const b = text(2, r(100, 0, 200, 40), [], { index: 2, rect: r(100, 0, 200, 40), flags: { fixedOrSticky: true, fixedRoot: true } });
    const { issues } = detectOverlap(collected('desktop', [a, b]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ subtype: 'text', elementIndex: 1, relatedIndex: 2, confidence: 1 });
  });

  it('30% overlay 기록과 제외', () => {
    // Desktop 기준 면적 1440 × 900. 모달 1000 × 500 = 38.6%
    const modal = el({ index: 1, rect: r(220, 200, 1000, 500), flags: { fixedOrSticky: true, fixedRoot: true } });
    const modalText = text(2, r(260, 240, 400, 40), [1], {
      index: 2,
      rect: r(260, 240, 400, 40),
      flags: { fixedOrSticky: true },
    });
    const toast = text(3, r(300, 250, 300, 40), [], { index: 3, rect: r(300, 250, 300, 40), flags: { fixedOrSticky: true, fixedRoot: true } });
    const page = text(4, r(240, 230, 600, 60));
    const result = detectOverlap(collected('desktop', [modal, modalText, toast, page]));
    expect(result.overlaysDetected).toEqual(['[data-testid="el-1"]']);
    expect(result.issues).toEqual([]);
  });

  it('line-height 보정으로 인접 줄 오탐 없음', () => {
    // Noto Sans KR의 텍스트 rect는 line box보다 2px 높다(T03 실측). 보정 없이는 2px × 300 = 600px² 겹침
    const first = text(1, r(0, 0, 300, 26), [], { index: 1, rect: r(0, 0, 300, 26), style: { lineHeight: '24px' } });
    const second = text(2, r(0, 24, 300, 26), [], { index: 2, rect: r(0, 24, 300, 26), style: { lineHeight: '24px' } });
    expect(detectOverlap(collected('desktop', [first, second])).issues).toEqual([]);
    const unknown = (index: number, y: number) =>
      text(index, r(0, y, 300, 26), [], { index, rect: r(0, y, 300, 26), style: { lineHeight: 'normal' } });
    expect(detectOverlap(collected('desktop', [unknown(1, 0), unknown(2, 24)])).issues).toHaveLength(1);
  });

  it('20%와 100px² 경계값', () => {
    const base = img(1, r(0, 0, 50, 50));
    // 면적 정확히 100 (비율 4%) → 탐지
    expect(detectOverlap(collected('desktop', [base, img(2, r(40, 40, 50, 50))])).issues).toHaveLength(1);
    // 면적 99 미만, 비율 20% 미만 → 없음
    expect(detectOverlap(collected('desktop', [base, img(2, r(40.1, 40, 50, 50))])).issues).toEqual([]);
    // 작은 쪽 25px²의 정확히 20%(5px²) → 탐지
    expect(detectOverlap(collected('desktop', [base, img(2, r(49, 0, 5, 5))])).issues).toHaveLength(1);
    // 19.8% → 없음
    expect(detectOverlap(collected('desktop', [base, img(2, r(49.01, 0, 5, 5))])).issues).toEqual([]);
  });

  it('line-clamp로 숨겨진 줄과 아래 요소는 겹침 아님', () => {
    const desc = el({
      index: 1,
      tag: 'p',
      rect: r(0, 0, 300, 48),
      textRects: [r(0, 0, 300, 24), r(0, 24, 300, 24), r(0, 48, 300, 24)],
      style: { overflowX: 'hidden', overflowY: 'hidden', webkitLineClamp: '2', lineHeight: '24px' },
    });
    const below = text(2, r(0, 56, 300, 24));
    expect(detectOverlap(collected('desktop', [desc, below])).issues).toEqual([]);
  });

  it('overflow hidden 카드 밖으로 잘린 img는 잘린 영역만 비교', () => {
    const card = el({ index: 1, rect: r(0, 0, 300, 300), style: { overflowX: 'hidden', overflowY: 'hidden' } });
    const image = img(2, r(-45, 0, 390, 200), [1]);
    const neighbor = text(3, r(310, 0, 200, 40));
    expect(detectOverlap(collected('mobile', [card, image, neighbor])).issues).toEqual([]);
    // 카드 안에서 보이는 부분과 겹치면 탐지한다
    const inside = text(3, r(250, 150, 200, 40));
    expect(detectOverlap(collected('mobile', [card, image, inside])).issues).toHaveLength(1);
  });

  it('완전히 잘린 요소는 비교 대상 아님', () => {
    const box = el({ index: 1, rect: r(0, 0, 100, 100), style: { overflowX: 'hidden', overflowY: 'hidden' } });
    const hidden = img(2, r(200, 0, 100, 100), [1]);
    const other = text(3, r(200, 0, 100, 100));
    expect(detectOverlap(collected('desktop', [box, hidden, other])).issues).toEqual([]);
  });

  it('대상 요소 기준 묶기: 대표는 교차 면적 최대, relatedElements 최대 5개, overlapTargetCount', () => {
    // 넓은 이미지 a(index 1)가 서로 떨어진 이미지 7개(index 2~8)와 아래쪽 50px씩 겹친다
    const base = img(1, r(0, 0, 1000, 100));
    const widths = [10, 20, 20, 5, 30, 15, 25];
    const others = widths.map((w, i) => img(2 + i, r(i * 140, 50, w * 4, 100)));
    const { issues } = detectOverlap(collected('desktop', [base, ...others]));
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    // 교차 면적 = 너비(w × 4) × 50 → 30(6번) > 25(8번) > 20(3번, 4번) > 15(7번) > 10 > 5
    expect(issue.relatedIndex).toBe(6);
    expect(issue.relatedElements.map((e) => e.index)).toEqual([6, 8, 3, 4, 7]);
    expect(issue.relatedElements.every((e) => e.role === 'overlap-target')).toBe(true);
    expect(issue.measured).toEqual({ intersectionArea: 6000, overlapRatioPercent: 50, overlapTargetCount: 7 });
  });

  it('대상 요소 기준 묶기: subtype이 다르면 따로 만든다', () => {
    const button = el({ index: 1, tag: 'button', rect: r(0, 0, 200, 40), flags: { interactive: true }, textRects: [r(10, 10, 100, 20)] });
    const other = el({ index: 2, tag: 'button', rect: r(100, 0, 200, 40), flags: { interactive: true }, textRects: [r(110, 10, 100, 20)] });
    const image = img(3, r(150, 20, 200, 100));
    const { issues } = detectOverlap(collected('desktop', [button, other, image]));
    expect(issues.map((i) => `${i.elementIndex}:${i.subtype}:${i.relatedIndex}`)).toEqual(['1:interactive:2', '1:other:3', '2:other:3']);
  });

  it('lineHeight 파싱', () => {
    expect(parseLineHeightPx('24px')).toBe(24);
    expect(parseLineHeightPx('normal')).toBeNull();
    expect(parseLineHeightPx('1.5')).toBeNull();
    expect(correctLineHeight(r(0, 0, 10, 26), '24px')).toEqual(r(0, 1, 10, 24));
    expect(correctLineHeight(r(0, 0, 10, 20), '24px')).toEqual(r(0, 0, 10, 20));
  });
});
