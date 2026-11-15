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
      ['button', '무료로 시작하기 버튼입니다…', 1],
      ['section', 'section#hero', 0],
      ['heading', '모든 팀을 위한 폼 빌더', 1],
      ['text', null, 1],
      ['input', '이메일', 1],
      ['button', null, 1],
      // 구조 블록 label에 heading 텍스트를 쓰지 않는다
      ['section', 'section', 0],
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
        // 같은 크기 구조 블록끼리는 하나로 합친다 (아래 별도 테스트)
        node({ index: 7, ancestors: [2, 1], tag: 'nav', rect: r(0, 400, 1440, 100) }),
        node({ index: 8, ancestors: [7, 2, 1], tag: 'form', rect: r(0, 400, 1440, 100) }),
      ]),
    );
    expect(map.blocks.map((b) => [b.kind, b.rect.x, b.depth, b.label ?? null])).toEqual([
      ['section', 0, 0, 'section'],
      ['image', 101, 1, '이미지'],
      ['card', 600, 1, null],
      ['nav', 0, 1, 'nav · form'],
    ]);
  });

  it('canvas만 있는 페이지도 canvas 블록이 나온다 (canvas는 layoutCanvases로만 만든다)', () => {
    const map = buildLayoutMap(
      collected('desktop', [node({ index: 1, tag: 'canvas', rect: r(0, 0, 1440, 900) }), node({ index: 2, tag: 'iframe', rect: r(0, 900, 300, 200) })], {
        hasCanvas: true,
        layoutCanvases: [{ index: 1, ancestorIndices: [], rect: r(0, 0, 1440, 900) }],
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

describe('buildLayoutMap: 쪼갠 텍스트, canvas, 구조 블록 합치기', () => {
  const inline = { display: 'inline-block' };
  const withDisplay = (spec: ElementSpec & Extra, display: string): CollectedElement => ({ ...node(spec), computedStyle: { display } });

  it('inline 요소는 text 블록을 만들지 않고, 블록 레벨 부모가 inline 자손의 텍스트를 합쳐 하나를 만든다', () => {
    // 단어마다 span으로 쪼갠 문단 (p는 직접 텍스트가 없다)
    const words = Array.from({ length: 6 }, (_, i) =>
      withDisplay({ index: 11 + i, ancestors: [10], tag: 'span', rect: r(100 + i * 60, 200, 50, 20), textRects: [r(100 + i * 60, 200, 50, 20)] }, inline.display),
    );
    const map = buildLayoutMap(collected('desktop', [withDisplay({ index: 10, tag: 'p', rect: r(100, 200, 600, 20) }, 'block'), ...words]));
    expect(map.blocks).toEqual([{ kind: 'text', rect: r(100, 200, 350, 20), depth: 0 }]);
  });

  it('inline 사슬이 블록 레벨에서 끊기면 그 블록이 owner다 (display: contents도 inline으로 본다)', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        withDisplay({ index: 1, tag: 'div', rect: r(0, 0, 800, 100) }, 'block'),
        withDisplay({ index: 2, ancestors: [1], tag: 'span', rect: r(0, 0, 400, 20) }, 'contents'),
        withDisplay({ index: 3, ancestors: [2, 1], tag: 'em', rect: r(0, 0, 200, 20), textRects: [r(0, 0, 200, 20)] }, 'inline'),
        withDisplay({ index: 4, ancestors: [1], tag: 'p', rect: r(0, 50, 300, 20), textRects: [r(0, 50, 300, 20)] }, 'block'),
      ]),
    );
    expect(map.blocks.map((b) => [b.kind, b.rect])).toEqual([
      ['text', r(0, 0, 200, 20)],
      // div가 text로 골라졌으므로 그 자손 p는 text를 만들지 않는다
    ]);
  });

  it('글자 단위로 쪼갠 heading은 heading 하나만 남고 자손 text·heading·button을 만들지 않는다', () => {
    const chars = Array.from({ length: 8 }, (_, i) =>
      withDisplay({ index: 3 + i, ancestors: [2, 1], tag: 'span', rect: r(300 + i * 40, 300, 36, 80), textRects: [r(300 + i * 40, 300, 36, 80)] }, inline.display),
    );
    const map = buildLayoutMap(
      collected('desktop', [
        withDisplay({ index: 1, tag: 'h1', rect: r(300, 300, 800, 200), flags: { heading: true }, attrs: { 'aria-label': 'Create beyond imagination.' }, text: 'Create beyondimagination.' }, 'block'),
        withDisplay({ index: 2, ancestors: [1], tag: 'span', rect: r(300, 300, 800, 80) }, 'block'),
        ...chars,
        withDisplay({ index: 20, ancestors: [1], tag: 'h2', rect: r(300, 400, 500, 60), flags: { heading: true }, text: '부제' }, 'block'),
        withDisplay({ index: 21, ancestors: [1], tag: 'button', rect: r(300, 460, 100, 30), text: '버튼' }, 'inline-block'),
      ]),
    );
    expect(map.blocks.map((b) => [b.kind, b.label ?? null])).toEqual([['heading', 'Create beyond imaginati…']]);
  });

  it('버튼 안의 단어 span은 text 블록을 만들지 않는다', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        withDisplay({ index: 1, tag: 'a', rect: r(50, 700, 150, 50), flags: { interactive: true }, style: bordered, text: 'Start creating ↗' }, 'inline-flex'),
        withDisplay({ index: 2, ancestors: [1], tag: 'span', rect: r(60, 712, 100, 24), textRects: [r(60, 712, 100, 24)] }, 'block'),
        withDisplay({ index: 3, ancestors: [1], tag: 'span', rect: r(170, 712, 20, 24), textRects: [r(170, 712, 20, 24)] }, 'block'),
      ]),
    );
    expect(map.blocks.map((b) => [b.kind, b.label ?? null])).toEqual([['button', 'Start creating ↗']]);
  });

  it('canvas는 opacity 0 또는 aria-hidden 래퍼 안에 있어도(후보가 아니어도) 포함하고 구조 블록 depth를 센다', () => {
    const map = buildLayoutMap(
      collected('desktop', [node({ index: 3, tag: 'main', rect: r(0, 0, 1440, 2000) }), node({ index: 4, ancestors: [3], tag: 'section', rect: r(0, 0, 1440, 900) })], {
        hasCanvas: true,
        // 9, 8은 후보가 아닌 래퍼(opacity 0, aria-hidden)
        layoutCanvases: [{ index: 10, ancestorIndices: [9, 8, 4, 3, 2], rect: r(39.6, 35.8, 1360.7, 850.4) }],
      }),
    );
    expect(map.blocks.map((b) => [b.kind, b.rect, b.depth, b.label])).toEqual([
      ['main', r(0, 0, 1440, 2000), 0, 'main'],
      ['section', r(0, 0, 1440, 900), 1, 'section'],
      ['canvas', r(40, 36, 1360, 850), 2, 'canvas'],
    ]);
  });

  it('사방 8px 이내로 같은 크기인 구조 블록은 바깥쪽 하나로 합치고 이름을 최대 2개까지 묶는다', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        node({ index: 1, tag: 'main', rect: r(0, 0, 1440, 900) }),
        node({ index: 2, ancestors: [1], tag: 'section', id: 'hero', rect: r(0, 6, 1440, 890) }),
        node({ index: 3, ancestors: [2, 1], tag: 'div', attrs: { role: 'region', 'aria-label': '소개' }, rect: r(4, 8, 1432, 888) }),
        node({ index: 4, ancestors: [3, 2, 1], tag: 'h2', rect: r(100, 100, 400, 40), flags: { heading: true }, text: '제목' }),
        // 크기가 다르면 합치지 않는다
        node({ index: 5, tag: 'footer', rect: r(0, 900, 1440, 200) }),
        node({ index: 6, ancestors: [5], tag: 'nav', rect: r(0, 900, 1440, 100) }),
      ]),
    );
    expect(map.blocks.map((b) => [b.kind, b.rect, b.depth, b.label ?? null])).toEqual([
      ['main', r(0, 0, 1440, 900), 0, 'main · section#hero +1'],
      ['heading', r(100, 100, 400, 40), 1, '제목'],
      ['footer', r(0, 900, 1440, 200), 0, 'footer'],
      ['nav', r(0, 900, 1440, 100), 1, 'nav'],
    ]);
  });

  it('구조 label은 태그#id → 태그 "aria-label" → 태그 순서이고 heading 텍스트를 쓰지 않는다', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        node({ index: 1, tag: 'section', id: 'a', attrs: { 'aria-label': '무시' }, rect: r(0, 0, 1440, 300) }),
        node({ index: 2, tag: 'section', attrs: { 'aria-label': '  소개\n영역 ' }, rect: r(0, 300, 1440, 300) }),
        node({ index: 3, tag: 'section', rect: r(0, 600, 1440, 300) }),
        node({ index: 4, ancestors: [3], tag: 'h2', rect: r(0, 620, 400, 40), flags: { heading: true }, text: '첫 제목' }),
        node({ index: 5, tag: 'div', attrs: { role: 'contentinfo' }, rect: r(0, 900, 1440, 100) }),
      ]),
    );
    expect(map.blocks.filter((b) => b.kind !== 'heading').map((b) => b.label)).toEqual(['section#a', 'section "소개 영역"', 'section', 'footer']);
  });

  it('heading label은 aria-label → innerText(layoutAttrs.text) → textSnippet 순서다', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        node({ index: 1, tag: 'h2', rect: r(0, 0, 800, 40), flags: { heading: true }, text: 'Ideas needa place.', layoutAttrs: { text: 'Ideas need a place.' } }),
        node({ index: 2, tag: 'h2', rect: r(0, 100, 800, 40), flags: { heading: true }, text: '스니펫' }),
      ]),
    );
    expect(map.blocks.map((b) => b.label)).toEqual(['Ideas need a place.', '스니펫']);
  });

  it('heading label은 24자, button label은 16자로 자른다', () => {
    const map = buildLayoutMap(
      collected('desktop', [
        node({ index: 1, tag: 'h2', rect: r(0, 0, 800, 40), flags: { heading: true }, text: '가'.repeat(30) }),
        node({ index: 2, tag: 'button', rect: r(0, 100, 200, 40), text: 'abcdefghijklmnopqrstuvwxyz' }),
      ]),
    );
    expect(map.blocks.map((b) => b.label)).toEqual([`${'가'.repeat(23)}…`, 'abcdefghijklmno…']);
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
