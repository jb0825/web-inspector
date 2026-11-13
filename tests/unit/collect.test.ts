import { describe, expect, it } from 'vitest';
import { isHttpErrorStatus } from '@/server/browser/stabilize';
import {
  IN_PAGE_ARGS,
  buildInPageExpression,
  normalizeCollected,
  parseInPageResult,
  roundMeasure,
} from '@/server/collect/collect';
import type { CollectedElement, InPageArgs, InPageResult } from '@/server/collect/types';
import { COMPUTED_STYLE_WHITELIST, MAX_CANDIDATES } from '@/server/detect/constants';
import { InspectionError } from '@/server/errors';

function element(index: number, overrides: Partial<CollectedElement> = {}): CollectedElement {
  return {
    index,
    parentIndex: null,
    ancestorIndices: [],
    tag: 'div',
    rect: { x: 16.004, y: 197.375, width: 600.0049, height: 105.8 },
    paddingBox: { x: 17.004, y: 198.375, width: 598.0049, height: 103.8 },
    textRects: [{ x: 33.333333, y: 214.38, width: -0.0001, height: 20.666666 }],
    scrollWidth: 600,
    clientWidth: 598,
    scrollHeight: 104,
    clientHeight: 104,
    style: {
      position: 'static',
      overflowX: 'visible',
      overflowY: 'visible',
      textOverflow: 'clip',
      webkitLineClamp: 'none',
      whiteSpace: 'normal',
      lineHeight: '24px',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      borderWidthSum: 4.0001,
      paddingSum: 32,
    },
    flags: { interactive: false, heading: false, inNav: false, fixedOrSticky: false, fixedRoot: false },
    computedStyle: { display: 'block' },
    selector: `[data-testid="el-${index}"]`,
    sourceHints: { htmlSnippet: '<div>', stableAttributes: {}, ancestorPath: 'body' },
    identity: { testId: `el-${index}` },
    ...overrides,
  };
}

function raw(elements: CollectedElement[], totalCandidates = elements.length): InPageResult {
  return {
    innerWidth: 390,
    innerHeight: 844,
    layoutWidth: 390,
    documentScrollWidth: 616.004,
    documentHeight: 1333.995,
    hasMetaViewport: true,
    rootOverflowX: { html: 'visible', body: 'hidden' },
    hasCanvas: false,
    totalCandidates,
    elements,
  };
}

describe('roundMeasure (PRD 5.3.1)', () => {
  it('소수 둘째 자리로 반올림한다', () => {
    expect(roundMeasure(197.375)).toBe(197.38);
    expect(roundMeasure(180.666666)).toBe(180.67);
    expect(roundMeasure(16)).toBe(16);
  });

  it('-0은 0으로 둔다', () => {
    expect(Object.is(roundMeasure(-0.0001), 0)).toBe(true);
    expect(JSON.stringify(roundMeasure(-0.001))).toBe('0');
  });
});

describe('normalizeCollected', () => {
  it('모든 측정값을 반올림하고 viewport를 붙인다', () => {
    const out = normalizeCollected(raw([element(15)]), 'mobile');
    expect(out.viewport).toBe('mobile');
    expect(out.documentScrollWidth).toBe(616);
    expect(out.documentHeight).toBe(1334);
    const el = out.elements[0];
    expect(el.rect).toEqual({ x: 16, y: 197.38, width: 600, height: 105.8 });
    expect(el.paddingBox).toEqual({ x: 17, y: 198.38, width: 598, height: 103.8 });
    expect(el.textRects[0]).toEqual({ x: 33.33, y: 214.38, width: 0, height: 20.67 });
    expect(el.style.borderWidthSum).toBe(4);
  });

  it('viewportSize는 측정한 innerWidth/innerHeight가 아니라 설정값이다 (DETECTION_RULES 3.1.1)', () => {
    // P-01 mobile 실측: 페이지 축소로 inner 616×1334
    const zoomedOut = { ...raw([]), innerWidth: 616, innerHeight: 1334 };
    const mobile = normalizeCollected(zoomedOut, 'mobile');
    expect(mobile.viewportSize).toEqual({ width: 390, height: 844 });
    expect(mobile.innerWidth).toBe(616);
    expect(normalizeCollected(raw([]), 'desktop').viewportSize).toEqual({ width: 1440, height: 900 });
  });

  it('자르기 전 후보 수와 잘림 여부를 정한다 (DETECTION_RULES 3.2)', () => {
    const elements = [element(1), element(2), element(3)];
    expect(normalizeCollected(raw(elements), 'desktop').elementsTruncated).toBe(false);

    const truncated = normalizeCollected(raw(elements, 5000), 'desktop');
    expect(truncated.totalCandidates).toBe(5000);
    expect(truncated.elementsTruncated).toBe(true);

    const capped = normalizeCollected(raw(elements), 'desktop', { maxCandidates: 2 });
    expect(capped.elements.map((e) => e.index)).toEqual([1, 2]);
    expect(capped.totalCandidates).toBe(3);
    expect(capped.elementsTruncated).toBe(true);
  });

  it('입력 객체의 키 순서와 관계없이 같은 JSON을 만든다 (DETECTION_RULES 11장)', () => {
    const a = element(7);
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as unknown as CollectedElement;
    const first = JSON.stringify(normalizeCollected(raw([a]), 'desktop'));
    const second = JSON.stringify(normalizeCollected(raw([reordered]), 'desktop'));
    expect(second).toBe(first);
  });

  it('입력을 바꾸지 않는다', () => {
    const input = raw([element(1)]);
    const before = JSON.stringify(input);
    normalizeCollected(input, 'desktop');
    expect(JSON.stringify(input)).toBe(before);
  });

  it('없는 선택 필드는 키 자체를 만들지 않는다', () => {
    const out = normalizeCollected(raw([element(1, { identity: {} })]), 'desktop');
    expect(Object.keys(out.elements[0].identity)).toEqual([]);
    expect('textSnippet' in out.elements[0].sourceHints).toBe(false);
  });
});

describe('parseInPageResult (DOMAIN_MODEL 7장)', () => {
  it('올바른 값을 통과시킨다', () => {
    const value = raw([element(1), element(4)]);
    expect(parseInPageResult(value)).toEqual(value);
  });

  it.each([
    ['필드 누락', { ...raw([]), hasCanvas: undefined }],
    ['알 수 없는 필드', { ...raw([]), extra: 1 }],
    ['NaN 좌표', raw([element(1, { rect: { x: Number.NaN, y: 0, width: 1, height: 1 } })])],
    ['문서 순서가 아님', raw([element(4), element(1)])],
    ['후보 수보다 많은 요소', raw([element(1), element(2)], 1)],
    ['배열이 아님', null],
  ])('%s → DETECTION_FAILED', (_, value) => {
    expect(() => parseInPageResult(value)).toThrow(InspectionError);
    try {
      parseInPageResult(value);
    } catch (error) {
      expect((error as InspectionError).code).toBe('DETECTION_FAILED');
    }
  });
});

describe('buildInPageExpression (번들러 shim)', () => {
  it('__name 호출이 들어간 함수도 전역을 건드리지 않고 실행된다', () => {
    // esbuild keepNames가 만드는 형태를 흉내 낸다. 이 파일에는 __name이 정의되어 있지 않다.
    const source = `function collect(args) {
      const helper = __name((x) => x * 2, "helper");
      return { doubled: helper(args.maxCandidates) };
    }`;
    const fn = new Function(`return (${source})`)() as (args: InPageArgs) => unknown;
    const expression = buildInPageExpression(fn, IN_PAGE_ARGS);
    expect((0, eval)(expression)).toEqual({ doubled: MAX_CANDIDATES * 2 });
    expect('__name' in globalThis).toBe(false);
  });

  it('상수를 JSON 인자로 넘긴다', () => {
    const expression = buildInPageExpression((args) => args.computedStyleProperties, IN_PAGE_ARGS);
    expect((0, eval)(expression)).toEqual([...COMPUTED_STYLE_WHITELIST]);
  });
});

describe('isHttpErrorStatus (PRD 6.2.4)', () => {
  it('400 이상이면 HTTP_ERROR 대상이다', () => {
    expect(isHttpErrorStatus(200)).toBe(false);
    expect(isHttpErrorStatus(304)).toBe(false);
    expect(isHttpErrorStatus(399)).toBe(false);
    expect(isHttpErrorStatus(400)).toBe(true);
    expect(isHttpErrorStatus(503)).toBe(true);
  });
});
