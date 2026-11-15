import { VIEWPORTS } from '@/server/browser/devices';
import type {
  CollectedElement,
  CollectedElementFlags,
  CollectedElementStyle,
  CollectedViewport,
} from '@/server/collect/types';
import type { Rect, Viewport } from '@/types/inspection';

// 탐지 함수 단위 테스트용 CollectedViewport를 만드는 헬퍼. 필요한 필드만 넘기면 나머지는 기본값으로 채운다.

export function r(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export interface ElementSpec {
  index: number;
  /** 후보 조상 index, 가까운 순. parentIndex는 첫 번째 값 */
  ancestors?: number[];
  tag?: string;
  rect: Rect;
  /** 기본값: rect에서 border를 뺀 영역(borderWidth 기준) */
  paddingBox?: Rect;
  /** 사방 border 두께. paddingBox 기본값과 style.borderWidthSum 계산에 쓴다 */
  borderWidth?: number;
  textRects?: Rect[];
  scrollWidth?: number;
  clientWidth?: number;
  scrollHeight?: number;
  clientHeight?: number;
  style?: Partial<CollectedElementStyle>;
  flags?: Partial<CollectedElementFlags>;
  testId?: string;
}

export function el(spec: ElementSpec): CollectedElement {
  const border = spec.borderWidth ?? 0;
  const { rect } = spec;
  const paddingBox =
    spec.paddingBox ?? r(rect.x + border, rect.y + border, rect.width - border * 2, rect.height - border * 2);
  const ancestors = spec.ancestors ?? [];
  const testId = spec.testId ?? `el-${spec.index}`;
  return {
    index: spec.index,
    parentIndex: ancestors.length > 0 ? ancestors[0] : null,
    ancestorIndices: [...ancestors],
    tag: spec.tag ?? 'div',
    rect,
    paddingBox,
    textRects: spec.textRects ?? [],
    scrollWidth: spec.scrollWidth ?? paddingBox.width,
    clientWidth: spec.clientWidth ?? paddingBox.width,
    scrollHeight: spec.scrollHeight ?? paddingBox.height,
    clientHeight: spec.clientHeight ?? paddingBox.height,
    style: {
      position: 'static',
      overflowX: 'visible',
      overflowY: 'visible',
      textOverflow: 'clip',
      webkitLineClamp: 'none',
      whiteSpace: 'normal',
      lineHeight: 'normal',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      backgroundImage: 'none',
      borderWidthSum: border * 4,
      paddingSum: 0,
      ...spec.style,
    },
    flags: {
      interactive: false,
      heading: false,
      inNav: false,
      fixedOrSticky: false,
      fixedRoot: false,
      ...spec.flags,
    },
    computedStyle: {},
    selector: `[data-testid="${testId}"]`,
    sourceHints: { htmlSnippet: `<${spec.tag ?? 'div'}>`, stableAttributes: {}, ancestorPath: 'body' },
    identity: { testId },
  };
}

export function collected(
  viewport: Viewport,
  elements: CollectedElement[],
  overrides: Partial<Omit<CollectedViewport, 'viewport' | 'elements'>> = {},
): CollectedViewport {
  const size = VIEWPORTS[viewport];
  return {
    viewport,
    viewportSize: { width: size.width, height: size.height },
    innerWidth: size.width,
    innerHeight: size.height,
    layoutWidth: size.width,
    documentScrollWidth: size.width,
    documentHeight: 2000,
    hasMetaViewport: true,
    rootOverflowX: { html: 'visible', body: 'visible' },
    hasCanvas: false,
    totalCandidates: elements.length,
    elementsTruncated: false,
    elements,
    layoutCanvases: [],
    ...overrides,
  };
}

/** index는 그대로 두고 배열 순서만 바꾼다 (결정적 순서: 뒤집고 짝/홀 교차) */
export function shuffled<T>(items: readonly T[]): T[] {
  const reversed = [...items].reverse();
  return [...reversed.filter((_, i) => i % 2 === 0), ...reversed.filter((_, i) => i % 2 === 1)];
}
