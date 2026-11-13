import type { Viewport } from '@/types/inspection';

// 탐지와 측정의 임계값은 이 파일 한 곳에 둔다(AGENTS.md 6장, DETECTION_RULES 2장).
// 나머지 상수는 해당 기능을 구현하는 작업에서 추가한다.

// ── 판정 (PRD 5.3, 5.5.4 / DETECTION_RULES 2장) ──

/** PRD 5.3.1: 모든 크기 비교의 서브픽셀 허용치 */
export const TOLERANCE_PX = 1;
/** PRD 5.3.3: 작은 쪽 면적 대비 겹침 비율 */
export const OVERLAP_MIN_RATIO = 0.2;
/** PRD 5.3.3: 겹침 면적 */
export const OVERLAP_MIN_AREA_PX2 = 100;
/** PRD 5.3.3: viewport 면적 대비 이 비율 이상을 덮는 fixed 요소는 overlay */
export const OVERLAY_MIN_VIEWPORT_RATIO = 0.3;
/** PRD 5.3.3: 부모 안의 absolute 요소가 겹치면 낮추는 Confidence */
export const ABSOLUTE_IN_PARENT_CONFIDENCE = 0.4;
/** PRD 5.5.4: Confidence가 이 값보다 작으면 Needs Review */
export const NEEDS_REVIEW_BELOW = 0.5;
/** 이슈의 기본 Confidence */
export const DEFAULT_CONFIDENCE = 1;
/** DETECTION_RULES 5.6: 겹침 이슈 하나의 relatedElements 최대 개수 (대표 상대 요소 포함) */
export const MAX_OVERLAP_TARGETS = 5;
/** PRD 5.3.7: 검사 1회에 저장하는 이슈 최대 개수 (viewport 간 병합 뒤, score100 순으로 선택) */
export const MAX_ISSUES = 200;

/** PRD 5.4.1: cropRect */
export const CROP_PADDING_PX = 24;
export const CROP_MIN_WIDTH_PX = 320;
export const CROP_MIN_HEIGHT_PX = 160;

// ── 수집 (PRD 5.3.1, 5.4.2, 5.7.2 / DETECTION_RULES 2장, 3장) ──

/** PRD 5.3.1: viewport당 검사 후보 최대 개수 */
export const MAX_CANDIDATES = 3000;
/** PRD 5.3.1: 너비와 높이가 모두 이 값을 넘어야 후보 */
export const MIN_ELEMENT_SIZE_PX = 1;
/** PRD 5.3.1: 측정값 반올림 자릿수 */
export const MEASURE_DECIMALS = 2;

/** PRD 5.4.2 / DETECTION_RULES 3.5 */
export const TEXT_SNIPPET_MAX = 80;
export const LANDMARK_MAX = 60;
export const HTML_SNIPPET_MAX = 300;
export const ANCESTOR_PATH_MAX_DEPTH = 5;
/** DETECTION_RULES 3.5: htmlSnippet의 속성값은 각 80자까지 */
export const HTML_ATTRIBUTE_VALUE_MAX = 80;

/** DETECTION_RULES 3.4: 경로 selector 최대 단계 수, 단계마다 쓰는 안정적인 class 수 */
export const SELECTOR_PATH_MAX_DEPTH = 5;
export const SELECTOR_MAX_CLASSES = 2;
/**
 * DETECTION_RULES 3.4: 생성된 값처럼 보이는 id, 불안정한 class 패턴.
 * page.evaluate 인자로 넘기므로 RegExp가 아니라 source 문자열로 둔다.
 */
export const GENERATED_ID_PATTERNS = [':', '\\d{4,}', '[0-9a-f]{8,}'] as const;
export const UNSTABLE_CLASS_PATTERNS = ['^css-', '^sc-', '^jsx-', '^_', '__', '[0-9a-f]{5,}', '[:\\[]'] as const;

/** PRD 5.7.2: AI 입력에 넣는 computed CSS 화이트리스트 (이 순서대로 수집한다) */
export const COMPUTED_STYLE_WHITELIST = [
  'display',
  'position',
  'width',
  'min-width',
  'max-width',
  'height',
  'flex',
  'flex-wrap',
  'flex-shrink',
  'grid-template-columns',
  'overflow',
  'overflow-x',
  'white-space',
  'word-break',
  'overflow-wrap',
  'text-overflow',
  'font-size',
  'line-height',
  'padding',
  'margin',
  'box-sizing',
  'transform',
  'z-index',
] as const;

/** PRD 5.2.4: 스크린샷 높이 상한 (CSS px). Mobile은 DPR 3이라 디바이스 픽셀 15,000px로 Chromium 최대 텍스처(약 16,384px) 아래다. */
export const SCREENSHOT_MAX_HEIGHT = {
  desktop: 10_000,
  mobile: 5_000,
} as const satisfies Record<Viewport, number>;
