import type { Rect, SourceHints, Viewport } from '@/types/inspection';

// DETECTION_RULES 3.1. 서버 안에서만 쓰는 타입이라 src/types/가 아니라 여기에 둔다(AGENTS.md 3.1).

export interface CollectedElementStyle {
  position: string;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  webkitLineClamp: string;
  whiteSpace: string;
  /** px 값 또는 'normal' */
  lineHeight: string;
  backgroundColor: string;
  backgroundImage: string;
  borderWidthSum: number;
  paddingSum: number;
}

export interface CollectedElementFlags {
  /** DETECTION_RULES 3.3의 인터랙티브 정의, 자신 기준 */
  interactive: boolean;
  heading: boolean;
  inNav: boolean;
  /** 자신 또는 조상이 fixed/sticky */
  fixedOrSticky: boolean;
  /** 자신이 fixed이고 fixed 조상이 없음 */
  fixedRoot: boolean;
}

export interface CollectedElement {
  /** 문서 전체 preorder 순회 index (후보가 아닌 요소 포함) */
  index: number;
  /** 가장 가까운 "후보" 조상의 index */
  parentIndex: number | null;
  /** 후보 조상 index, 가까운 순 */
  ancestorIndices: number[];
  /** 소문자 */
  tag: string;
  /** border box, 문서 기준 */
  rect: Rect;
  /** rect에서 border를 뺀 영역, 문서 기준 */
  paddingBox: Rect;
  /** 직접 포함한 비어 있지 않은 텍스트 노드의 Range.getClientRects(), 문서 기준 */
  textRects: Rect[];
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  style: CollectedElementStyle;
  flags: CollectedElementFlags;
  /** PRD 5.7.2 화이트리스트 */
  computedStyle: Record<string, string>;
  /** DETECTION_RULES 3.4 */
  selector: string;
  /** DETECTION_RULES 3.5 */
  sourceHints: SourceHints;
  identity: { id?: string; testId?: string };
  /**
   * 페이지 구성 도면(layoutMap)의 label 원재료 (DETECTION_RULES 16.2). 속성이 하나라도 있을 때만 있다.
   * type은 input 요소에만 넣는다(소문자).
   */
  layoutAttrs?: { alt?: string; placeholder?: string; type?: string };
}

export interface CollectedViewport {
  viewport: Viewport;
  /** 설정값 (PRD 5.2.1: 1440×900 / 390×844). 판정 기준 크기(DETECTION_RULES 3.1.1). collect.ts가 devices.ts 값으로 채운다 */
  viewportSize: { width: number; height: number };
  /** 기록용. Mobile에서 페이지가 축소되면 커지므로 판정에 쓰지 않는다(DETECTION_RULES 3.1.1) */
  innerWidth: number;
  innerHeight: number;
  /** document.documentElement.clientWidth */
  layoutWidth: number;
  /** document.documentElement.scrollWidth */
  documentScrollWidth: number;
  documentHeight: number;
  hasMetaViewport: boolean;
  rootOverflowX: { html: string; body: string };
  hasCanvas: boolean;
  /** 자르기 전 후보 수 */
  totalCandidates: number;
  /** totalCandidates > MAX_CANDIDATES (DETECTION_RULES 3.2) */
  elementsTruncated: boolean;
  /** 문서 순서, 최대 MAX_CANDIDATES개 */
  elements: CollectedElement[];
}

/** page.evaluate가 돌려주는 값. viewport, viewportSize, elementsTruncated는 Node에서 정한다. */
export type InPageResult = Omit<CollectedViewport, 'viewport' | 'viewportSize' | 'elementsTruncated'>;

/** inpage 수집 함수의 인자. 상수는 모두 인자로 넘긴다(AGENTS.md 7장). */
export interface InPageArgs {
  maxCandidates: number;
  minElementSizePx: number;
  textSnippetMax: number;
  landmarkMax: number;
  htmlSnippetMax: number;
  htmlAttributeValueMax: number;
  ancestorPathMaxDepth: number;
  selectorPathMaxDepth: number;
  selectorMaxClasses: number;
  generatedIdPatterns: readonly string[];
  unstableClassPatterns: readonly string[];
  computedStyleProperties: readonly string[];
}
