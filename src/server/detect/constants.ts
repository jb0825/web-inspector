import type { Viewport } from '@/types/inspection';

// 탐지와 측정의 임계값은 이 파일 한 곳에 둔다(AGENTS.md 6장, DETECTION_RULES 2장).
// 나머지 상수는 해당 기능을 구현하는 작업에서 추가한다.

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
