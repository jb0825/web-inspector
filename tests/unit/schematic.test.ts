import { describe, expect, it } from 'vitest';
import { evidenceView, tagOfSnippet } from '@/features/issue-detail/diagram';
import { isCanvasLarge, previewFooter, previewGeometry, previewMode } from '@/features/report/logic/preview';
import { cropBasisFitsScreenshot } from '@/lib/cropBasis';
import { formatPx } from '@/lib/format';
import {
  chipWidth,
  continuedLabel,
  fitLabel,
  gridLines,
  labelFits,
  placeChips,
  projectBlock,
  schematicFallback,
  textBars,
  toScreenBox,
} from '@/lib/schematic';
import type { IssueOccurrence, LayoutBlock, LayoutMap, ViewportResult } from '@/types/inspection';

// 배치도 그리기와 판정 (WIREFRAME 5.6, 6.4, DETECTION_RULES 8.3)

const block = (kind: LayoutBlock['kind'], x: number, y: number, width: number, height: number, label?: string): LayoutBlock => ({
  kind,
  rect: { x, y, width, height },
  ...(label ? { label } : {}),
  depth: 0,
});

const map = (blocks: LayoutBlock[], overrides: Partial<LayoutMap> = {}): LayoutMap => ({ width: 390, scrollWidth: 390, height: 4800, truncated: false, blocks, ...overrides });

function vr(overrides: Partial<ViewportResult> = {}): ViewportResult {
  return {
    width: 390,
    height: 844,
    innerWidth: 390,
    layoutWidth: 390,
    hasMetaViewport: true,
    documentHeight: 4800,
    screenshotUrl: 'https://blob.example/m.png',
    screenshotWidth: 390,
    screenshotHeight: 844,
    screenshotTruncated: true,
    elementsInspected: 10,
    elementsTruncated: false,
    hasCanvas: false,
    overlaysDetected: [],
    layoutMap: map([block('section', 0, 844, 390, 980, 'section#features'), block('heading', 24, 880, 240, 40, '주요 기능')]),
    ...overrides,
  };
}

describe('previewMode / previewGeometry (3장)', () => {
  it('스크린샷 전체 → 사진', () => {
    const result = vr({ documentHeight: 844, screenshotTruncated: false });
    expect(previewMode(result)).toBe('photo');
    const g = previewGeometry(result, []);
    expect(g).toMatchObject({ mode: 'photo', width: 390, height: 844, schematicFrom: 844, fallback: null });
  });

  it('스크린샷 일부 → 사진 + 아래쪽 도면 (같은 좌표계, 페이지 끝까지)', () => {
    const g = previewGeometry(vr(), [{ x: 40, y: 1050, width: 278, height: 30 }]);
    expect(g).toMatchObject({ mode: 'hybrid', width: 390, height: 4800, schematicFrom: 844, firstScreen: null, fallback: null });
    expect(g.photo).toEqual({ url: 'https://blob.example/m.png', width: 390, height: 844 });
  });

  it('사진 + 도면의 너비는 max(screenshotWidth, layoutMap.width) (Mobile 축소 스크린샷)', () => {
    expect(previewGeometry(vr({ screenshotWidth: 616 }), []).width).toBe(616);
    expect(previewGeometry(vr({ screenshotWidth: 300 }), []).width).toBe(390);
  });

  it('스크린샷 없음 → 도면 (첫 화면 경계, 화면 밖 이슈 박스까지 넓힘)', () => {
    const result = vr({ screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false });
    expect(previewMode(result)).toBe('schematic');
    const g = previewGeometry(result, [{ x: 16, y: 4700, width: 600, height: 200 }]);
    expect(g).toMatchObject({ mode: 'schematic', width: 616, height: 4900, schematicFrom: 0, firstScreen: 844, photo: null });
  });

  it('사진 | 배치도 전환으로 스크린샷이 있어도 도면을 볼 수 있다', () => {
    expect(previewGeometry(vr(), [], true).mode).toBe('schematic');
  });

  it('도면 높이 상한에 걸리면 layoutEnd', () => {
    const result = vr({ documentHeight: 12_000, layoutMap: map([block('image', 0, 0, 100, 100)], { height: 10_000, truncated: true }) });
    expect(previewGeometry(result, []).layoutEnd).toBe(10_000);
    expect(previewGeometry(vr(), []).layoutEnd).toBeNull();
  });

  it('사진이 도면 상한까지 덮는 긴 페이지는 그 아래에 이유를 알린다', () => {
    const result = vr({ screenshotHeight: 10_000, documentHeight: 14_000, layoutMap: map([block('image', 0, 0, 100, 100)], { height: 10_000, truncated: true }) });
    const g = previewGeometry(result, []);
    expect(g.mode).toBe('hybrid');
    expect(g.layoutEnd).toBeNull();
    expect(g.fallback?.lines).toEqual(['문서가 길어 10,000px 아래는 배치도를 그리지 않았습니다.']);
  });

  it('카드 하단 문구', () => {
    expect(previewFooter(previewGeometry(vr(), []), 4800, 3, formatPx)).toBe('이슈 3 · 스크린샷 0~844px, 이후 배치도');
    const noShot = vr({ screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false, documentHeight: 5200 });
    expect(previewFooter(previewGeometry(noShot, []), 5200, 3, formatPx)).toBe('이슈 3 · 측정값으로 그린 배치도 · 문서 높이 5,200px');
    expect(previewFooter({ mode: 'photo', photo: null }, 844, 0, formatPx)).toBe('이슈 0');
  });
});

describe('빈 화면 방지 (5장)', () => {
  it('블록이 있으면 정상 도면, 없거나 layoutMap이 없으면 최소 도면 안내', () => {
    expect(schematicFallback(3, false)).toBeNull();
    expect(schematicFallback(0, false)?.lines).toEqual(['표시할 구조 요소를 찾지 못했습니다.']);
    expect(schematicFallback(null, false)?.lines).toEqual(['표시할 구조 요소를 찾지 못했습니다.']);
    expect(schematicFallback(null, true)?.lines.join(' ')).toBe('이 페이지는 대부분 canvas로 그려져 있어 구조를 표시할 수 없습니다. canvas 내부는 검사하지 않습니다.');
  });

  it('예전 문서(layoutMap 없음)의 스크린샷 없는 viewport는 최소 도면', () => {
    const old = vr({ screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false, layoutMap: undefined, hasCanvas: true });
    const g = previewGeometry(old, []);
    expect(g.mode).toBe('schematic');
    expect(g.blocks).toEqual([]);
    expect(g.fallback?.lines[0]).toBe('이 페이지는 대부분 canvas로 그려져 있어');
  });

  it('사진 + 도면에서 도면 구간에 걸친 블록이 없으면 최소 도면 안내', () => {
    const g = previewGeometry(vr({ layoutMap: map([block('image', 0, 0, 100, 100)]) }), []);
    expect(g.fallback?.lines).toEqual(['표시할 구조 요소를 찾지 못했습니다.']);
  });

  it('canvas가 첫 화면의 절반 이상을 덮으면 canvas가 큰 페이지', () => {
    expect(isCanvasLarge(vr({ layoutMap: map([block('canvas', 0, 56, 390, 788)]) }))).toBe(true);
    expect(isCanvasLarge(vr({ layoutMap: map([block('canvas', 0, 56, 390, 200)]) }))).toBe(false);
    expect(isCanvasLarge(vr({ layoutMap: undefined }))).toBe(false);
  });
});

describe('좌표 변환과 label', () => {
  const frame = { scale: 0.5, originX: 0, originY: 560 };

  it('문서 좌표에 배율을 곱한 화면 좌표', () => {
    expect(toScreenBox(frame, { x: 40, y: 1050, width: 278, height: 30 })).toEqual({ x: 20, y: 245, width: 139, height: 15 });
  });

  it('도면 구간 [from, to]에 걸친 부분만 그리고, 위쪽이 잘리면 continued', () => {
    // section#features(844~1824)가 도면 시작(900)보다 위에서 시작한다
    expect(projectBlock({ x: 0, y: 844, width: 390, height: 980 }, frame, 900, 4800)).toEqual({ box: { x: 0, y: 170, width: 195, height: 462 }, continued: true });
    expect(projectBlock({ x: 0, y: 950, width: 390, height: 100 }, frame, 900, 4800)?.continued).toBe(false);
    expect(projectBlock({ x: 0, y: 100, width: 390, height: 100 }, frame, 900, 4800)).toBeNull();
    expect(projectBlock({ x: 0, y: 5000, width: 390, height: 100 }, frame, 900, 4800)).toBeNull();
    expect(continuedLabel('section#features', true)).toBe('section#features (계속)');
    expect(continuedLabel('section#features', false)).toBe('section#features');
  });

  it('label이 블록보다 길면 말줄임하고, 60×14px보다 작은 블록은 생략한다', () => {
    expect(fitLabel('조건부 로직과 자동화', 200, 10)).toBe('조건부 로직과 자동화');
    expect(fitLabel('Imogen Rose — 3D Portfolio', 95, 10)).toBe('Imogen Ro…');
    expect(fitLabel('abc', 5, 10)).toBe('…');
    expect(labelFits({ x: 0, y: 0, width: 60, height: 14 })).toBe(true);
    expect(labelFits({ x: 0, y: 0, width: 59, height: 30 })).toBe(false);
    expect(labelFits({ x: 0, y: 0, width: 100, height: 13 })).toBe(false);
  });

  it('구조 label 칩이 겹치면 오른쪽으로, 끝을 넘으면 아래로 비켜 놓는다', () => {
    const chip = (x: number, y: number, width = 60) => ({ x, y, width, height: 15 });
    expect(placeChips([chip(6, 4), chip(6, 4), chip(100, 50)], 400)).toEqual([chip(6, 4), chip(70, 4), chip(100, 50)]);
    expect(placeChips([chip(6, 4, 100), chip(6, 4, 100)], 150)).toEqual([chip(6, 4, 100), chip(6, 21, 100)]);
  });

  it('칩 너비는 한글을 더 넓게 잰다', () => {
    expect(chipWidth('header', 10)).toBeLessThan(chipWidth('헤더헤더헤더', 10));
  });

  it('text 막대: 1~4줄, 마지막 줄은 62%', () => {
    const bars = textBars({ x: 0, y: 0, width: 100, height: 36 });
    expect(bars).toHaveLength(4);
    expect(bars[3].width).toBeCloseTo(62);
    expect(textBars({ x: 0, y: 0, width: 100, height: 5 })).toEqual([{ x: 0, y: 1, width: 100, height: 3 }]);
  });

  it('격자: 문서 기준 40px', () => {
    expect(gridLines(100, 50, 170)).toEqual({ xs: [0, 40, 80], ys: [80, 120, 160] });
  });
});

describe('Issue Detail 사진 / 도면 판정 (8.3 크롭 완전 포함)', () => {
  const occ = (box: IssueOccurrence['boundingBox'], cropRect: IssueOccurrence['cropRect'] = { x: 0, y: 0, width: 320, height: 160 }) => ({
    boundingBox: box,
    measured: {},
    relatedElements: [],
    cropRect,
  });
  const shot = { screenshotUrl: 'u', screenshotWidth: 390, screenshotHeight: 844 };
  const text = { type: 'text-overflow' as const, subtype: 'clipped' };

  it('기준 박스가 스크린샷 안에 완전히 들어오면 사진', () => {
    expect(evidenceView(text, occ({ x: 40, y: 600, width: 200, height: 44 }), shot)).toEqual({ kind: 'photo' });
  });

  it('범위 밖이거나 일부만 걸치면 도면 + 안내 (cropRect가 남아 있는 예전 문서 포함)', () => {
    expect(evidenceView(text, occ({ x: 40, y: 1050, width: 278, height: 30 }, null), shot)).toEqual({ kind: 'schematic', outOfRange: true });
    expect(evidenceView(text, occ({ x: 40, y: 830, width: 278, height: 30 }), shot)).toEqual({ kind: 'schematic', outOfRange: true });
  });

  it('스크린샷이 없으면 도면, 범위 밖 안내는 생략', () => {
    expect(evidenceView(text, occ({ x: 40, y: 600, width: 200, height: 44 }, null), { screenshotUrl: null, screenshotWidth: null, screenshotHeight: null })).toEqual({
      kind: 'schematic',
      outOfRange: false,
    });
  });

  it('Viewport Overflow는 넘침 범위까지 넓힌 기준 박스로 판정한다', () => {
    const o = { ...occ({ x: 16, y: 85, width: 358, height: 36 }), measured: { elementRight: 493 } };
    expect(evidenceView({ type: 'viewport-overflow', subtype: 'page-scroll' }, o, shot).kind).toBe('schematic');
    expect(evidenceView({ type: 'viewport-overflow', subtype: 'page-scroll' }, o, { ...shot, screenshotWidth: 493 }).kind).toBe('photo');
  });

  it('cropBasisFitsScreenshot: 1px 허용치', () => {
    expect(cropBasisFitsScreenshot({ x: -1, y: 0, width: 391, height: 10 }, { width: 390, height: 844 })).toBe(true);
    expect(cropBasisFitsScreenshot({ x: -1.5, y: 0, width: 10, height: 10 }, { width: 390, height: 844 })).toBe(false);
    expect(cropBasisFitsScreenshot({ x: 0, y: 0, width: 10, height: 10 }, null)).toBe(false);
  });

  it('htmlSnippet에서 태그 이름', () => {
    expect(tagOfSnippet('<h3 class="title">')).toBe('h3');
    expect(tagOfSnippet('  <A href="x">')).toBe('a');
    expect(tagOfSnippet('text')).toBeNull();
  });
});
