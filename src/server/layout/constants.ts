import type { Viewport } from '@/types/inspection';

// 페이지 구성 도면(layoutMap) 상수 (DETECTION_RULES 16장). PRD에 없는 값으로, 이 작업에서 새로 정했다.

/** viewport당 최대 블록 수. 넘치면 순위 → 면적 → 문서 순서로 고른다 */
export const LAYOUT_MAX_BLOCKS = 400;

/** 도면 높이 상한. 넘으면 truncated. Mobile은 글이 세로로 길어지므로 Desktop보다 크게 둔다 */
export const LAYOUT_MAX_HEIGHT = {
  desktop: 10_000,
  mobile: 15_000,
} as const satisfies Record<Viewport, number>;

/** 구조 블록의 최소 면적 = layoutWidth × 이 높이 */
export const LAYOUT_STRUCT_MIN_HEIGHT_PX = 40;
/** image 블록의 최소 면적 (48×48) */
export const LAYOUT_IMAGE_MIN_AREA_PX2 = 48 * 48;
/** card 블록의 최소 면적 = layoutWidth × viewportSize.height × 이 비율 */
export const LAYOUT_CARD_MIN_VIEWPORT_RATIO = 0.02;
/** 이보다 높은 테두리 박스 인터랙티브 요소는 button이 아니라 card로 본다 (카드 전체가 링크인 경우) */
export const LAYOUT_BUTTON_MAX_HEIGHT_PX = 120;
/** text 블록의 최소 높이 */
export const LAYOUT_TEXT_MIN_HEIGHT_PX = 12;
/** 부모와 사방 이 값 이내로 같은 크기면 하나만 남긴다 */
export const LAYOUT_DEDUP_TOLERANCE_PX = 4;

/** 구조 블록끼리 사방 이 값 이내로 같은 크기면 하나로 합친다 (label을 `main · section`처럼 묶는다) */
export const LAYOUT_STRUCT_MERGE_TOLERANCE_PX = 8;
/** 합친 구조 블록 label에 이름을 쓰는 최대 개수. 넘는 수는 `+n`으로 쓴다 */
export const LAYOUT_STRUCT_MERGE_MAX_NAMES = 2;
/** 배치도용 canvas 수집 상한 (후보 조건과 별도로 수집한다) */
export const LAYOUT_MAX_CANVASES = 20;

/** label 최대 길이 (UTF-16 길이 기준. 저장 스키마와 같다) */
export const LAYOUT_LABEL_MAX = 40;
export const LAYOUT_HEADING_LABEL_MAX = 24;
export const LAYOUT_BUTTON_LABEL_MAX = 16;
export const LAYOUT_SHORT_LABEL_MAX = 20;
