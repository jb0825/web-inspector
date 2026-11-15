import { describe, expect, it } from 'vitest';
import type { CollectedElement } from '@/server/collect/types';
import { buildLayoutMap, cleanLabel } from '@/server/layout/buildLayoutMap';
import { LAYOUT_MAX_BLOCKS, LAYOUT_MAX_HEIGHT } from '@/server/layout/constants';
import { collected, el, r, shuffled, type ElementSpec } from './helpers/collected';

// DETECTION_RULES 16장: 페이지 구성 도면

type Extra = {
  id?: string;
  attrs?: Record<string, string>;
  text?: string;
  layoutAttrs?: CollectedElement['layoutAttrs'];
};

function node(spec: ElementSpec & Extra): CollectedElement {
  const base = el(spec);
  return {
    ...base,
    identity: { ...base.identity, ...(spec.id ? { id: spec.id } : {}) },
    sourceHints: {
      ...base.sourceHints,
      stableAttributes: { ...(spec.attrs ?? {}) },
      ...(spec.text ? { textSnippet: spec.text } : {}),
    },
    ...(spec.layoutAttrs ? { layoutAttrs: spec.layoutAttrs } : {}),
  };
}

const bordered = { backgroundColor: 'rgb(240, 240, 240)' };

function samplePage(): CollectedElement[] {
  return [
    node({ index: 1, tag: 'header', rect: r(0, 0, 1440, 72) }),
    node({ index: 2, ancestors: [1], tag: 'img', rect: r(40, 20, 120, 52), layoutAttrs: { alt: '  회사\n로고  ' } }),
    node({ index: 3, ancestors: [1], tag: 'a', rect: r(1260, 18, 130, 36), flags: { interactive: true }, style: bordered, text: '무료로 시작하기 버튼입니다 아주 긴 이름' }),
    node({ index: 4, tag: 'section', id: 'hero', rect: r(0, 72, 1440, 800) }),
    node({ index: 5, ancestors: [4], tag: 'h1', rect: r(140, 190, 620, 110), flags: { heading: true }, text: '모든 팀을 위한 폼 빌더' }),
    node({ index: 6, ancestors: [4], tag: 'p', rect: r(140, 320, 560, 70), textRects: [r(140, 320, 560, 24), r(140, 346, 400, 24)] }),
    node({ index: 7, ancestors: [4], tag: 'input', rect: r(140, 420, 300, 40), layoutAttrs: { type: 'email', placeholder: '이메일' }, style: bordered, flags: { interactive: true } }),
    node({ index: 8, ancestors: [4], tag: 'input', rect: r(460, 420, 120, 40), layoutAttrs: { type: 'submit' }, style: bordered, flags: { interactive: true } }),
    node({ index: 9, tag: 'section', rect: r(0, 872, 1440, 920) }),
    node({ index: 10, ancestors: [9], tag: 'h2', rect: r(140, 930, 520, 56), flags: { heading: true }, text: '주요 기능' }),
    node({ index: 11, ancestors: [9], tag: 'div', rect: r(140, 1020, 360, 320), style: bordered }),
    node({ index: 12, tag: 'footer', attrs: { 'aria-label': '사이트 정보' }, rect: r(0, 1792, 1440, 200) }),
  ];
}

describe('buildLayoutMap', () => {
  it('kind와 label을 순위 규칙대로 정한다', () => {
    const map = buildLayoutMap(collected('desktop', samplePage()));
    expect(map.blocks.map((b) => [b.kind, b.label ?? null, b.depth])).toEqual([
      ['header', 'header', 0],
      ['image', '회사 로고', 1],
      ['button', '무료로 시작하기 버튼입니다 아주 긴…', 1],
      ['section', 'section#hero', 0],
      ['heading', '모든 팀을 위한 폼 빌더', 1],
      ['text', null, 1],
      ['input', '이메일', 1],
      ['button', null, 1],
      ['section', 'section "주요 기능"', 0],
      ['heading', '주요 기능', 1],
      ['card', null, 1],
      ['footer', 'footer "사이트 정보"', 0],
    ]);
    expect(map).toMatchObject({ width: 1440, scrollWidth: 1440, height: 2000, truncated: false });
  });

  it('text 블록의 영역은 보이는 텍스트 rect의 합집합이다', () => {
    const map = buildLayoutMap(collected('desktop', samplePage()));
    expect(map.blocks.find((b) => b.kind === 'text')?.rect).toEqual(r(140, 320, 560, 50));
  });

  it('같은 입력이면 바이트 단위로 같고, 입력 순서를 섞어도 같다', () => {
    const a = JSON.stringify(buildLayoutMap(collected('desktop', samplePage())));
    const b = JSON.stringify(buildLayoutMap(collected('desktop', samplePage())));
    const c = JSON.stringify(buildLayoutMap(collected('desktop', shuffled(samplePage()))));
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('좌표를 정수로 반올림하고 문서 범위 안으로 자른다', () => {
    const map = buildLayoutMap(
      collected('mobile', [node({ index: 1, tag: 'img', rect: r(-10.4, 100.6, 500.2, 80.3) })], { layoutWidth: 390, documentScrollWidth: 450 }),
    );
    expect(map.width).toBe(390);
    expect(map.scrollWidth).toBe(450);
    expect(map.blocks[0].rect).toEqual(r(0, 101, 450, 80));
  });

  it('작은 구조 요소, 작은 이미지, 낮은 텍스트는 넣지 않는다', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        node({ index: 1, tag: 'section', rect: r(0, 0, 1440, 30) }),
        node({ index: 2, tag: 'img', rect: r(0, 100, 40, 40) }),
        node({ index: 3, tag: 'span', rect: r(0, 200, 100, 10), textRects: [r(0, 200, 100, 10)] }),
      ]),
    );
    expect(map.blocks).toEqual([]);
  });

  it('부모와 크기가 거의 같으면 하나만 남긴다 (구조 블록은 유지, 그 밖은 순위가 높은 쪽)', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        node({ index: 1, tag: 'section', rect: r(0, 0, 1440, 600) }),
        // 구조 블록 안의 같은 크기 card는 지운다
        node({ index: 2, ancestors: [1], tag: 'div', rect: r(2, 2, 1436, 596), style: bordered }),
        // card 안의 같은 크기 image는 image를 남긴다
        node({ index: 3, ancestors: [2, 1], tag: 'div', rect: r(100, 100, 400, 300), style: bordered }),
        node({ index: 4, ancestors: [3, 2, 1], tag: 'img', rect: r(101, 101, 398, 298) }),
        // 같은 순위면 바깥쪽
        node({ index: 5, ancestors: [2, 1], tag: 'div', rect: r(600, 100, 400, 300), style: bordered }),
        node({ index: 6, ancestors: [5, 2, 1], tag: 'div', rect: r(603, 103, 394, 294), style: bordered }),
        // 구조 블록끼리는 둘 다 남긴다
        node({ index: 7, ancestors: [2, 1], tag: 'nav', rect: r(0, 400, 1440, 100) }),
        node({ index: 8, ancestors: [7, 2, 1], tag: 'form', rect: r(0, 400, 1440, 100) }),
      ]),
    );
    expect(map.blocks.map((b) => [b.kind, b.rect.x, b.depth])).toEqual([
      ['section', 0, 0],
      ['image', 101, 1],
      ['card', 600, 1],
      ['nav', 0, 1],
      ['form', 0, 2],
    ]);
  });

  it('canvas만 있는 페이지도 canvas 블록이 나온다', () => {
    const map = buildLayoutMap(
      collected('desktop', [node({ index: 1, tag: 'canvas', rect: r(0, 0, 1440, 900) }), node({ index: 2, tag: 'iframe', rect: r(0, 900, 300, 200) })], {
        hasCanvas: true,
      }),
    );
    expect(map.blocks.map((b) => [b.kind, b.label])).toEqual([
      ['canvas', 'canvas'],
      ['iframe', 'iframe (내부 미검사)'],
    ]);
  });

  it('블록 수가 상한을 넘으면 순위 → 면적 → 문서 순서로 고르고 문서 순서로 정렬한다', () => {
    const elements = [
      ...Array.from({ length: 5 }, (_, i) =>
        node({ index: 100 + i, tag: 'p', rect: r(0, i * 40, 300 + i, 20), textRects: [r(0, i * 40, 300 + i, 20)] }),
      ),
      node({ index: 1, tag: 'h2', rect: r(0, 500, 300, 30), flags: { heading: true }, text: '제목' }),
    ];
    const map = buildLayoutMap(collected('desktop', elements), { maxBlocks: 3 });
    expect(map.truncated).toBe(true);
    expect(map.blocks.map((b) => [b.kind, b.rect.width])).toEqual([
      ['heading', 300],
      ['text', 303],
      ['text', 304],
    ]);
  });

  it('기본 블록 상한은 400개다', () => {
    const elements = Array.from({ length: 450 }, (_, i) => node({ index: i + 1, tag: 'img', rect: r(0, i * 20, 60, 60) }));
    const map = buildLayoutMap(collected('desktop', elements, { documentHeight: 9500 }));
    expect(map.blocks).toHaveLength(LAYOUT_MAX_BLOCKS);
    expect(map.truncated).toBe(true);
  });

  it('문서 높이가 상한을 넘으면 그 아래 블록을 버리고 truncated다', () => {
    const map = buildLayoutMap(
      collected('desktop', [node({ index: 1, tag: 'img', rect: r(0, 9_950, 100, 100) }), node({ index: 2, tag: 'img', rect: r(0, 12_000, 100, 100) })], {
        documentHeight: 14_000,
      }),
    );
    expect(map.height).toBe(LAYOUT_MAX_HEIGHT.desktop);
    expect(map.truncated).toBe(true);
    expect(map.blocks.map((b) => b.rect)).toEqual([r(0, 9_950, 100, 50)]);
  });
});

describe('cleanLabel', () => {
  it('공백과 제어 문자를 정리하고 길이를 자른다', () => {
    expect(cleanLabel('  a\n\tb c ', 40)).toBe('a b c');
    expect(cleanLabel('   ', 40)).toBeUndefined();
    expect(cleanLabel('가'.repeat(50), 40)).toBe(`${'가'.repeat(39)}…`);
    // 서로게이트 쌍을 반으로 자르지 않는다
    const cut = cleanLabel('😀'.repeat(30), 40) ?? '';
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith('…')).toBe(true);
    expect(Array.from(cut.slice(0, -1)).every((ch) => ch === '😀')).toBe(true);
  });
});
