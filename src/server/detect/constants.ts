import type { Viewport } from '@/types/inspection';

// 탐지와 측정의 임계값은 이 파일 한 곳에 둔다(AGENTS.md 6장, DETECTION_RULES 2장).
// 나머지 상수는 해당 기능을 구현하는 작업에서 추가한다.

/** PRD 5.2.4: 스크린샷 높이 상한 (CSS px). Mobile은 DPR 3이라 디바이스 픽셀 15,000px로 Chromium 최대 텍스처(약 16,384px) 아래다. */
export const SCREENSHOT_MAX_HEIGHT = {
  desktop: 10_000,
  mobile: 5_000,
} as const satisfies Record<Viewport, number>;
