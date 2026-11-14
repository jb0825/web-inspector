import { intersectBox, type Box } from '@/lib/rect';
import type { DevTask } from '@/types/inspection';

// PRD 5.4.1, DETECTION_RULES 8.3: 크롭 이미지를 따로 만들지 않고, 전체 스크린샷을 cropRect 영역만 보이게 잘라 표시한다.
// 하이라이트 박스는 요소 rect(boundingBox) 그대로이므로 스크린샷·크롭 밖으로 나갈 수 있다(hidden-clip). 크롭 안으로 잘라 그린다.

/** DESIGN_GUIDE 9.3: 크롭 표시 최대 높이 */
export const CROP_MAX_HEIGHT_PX = 320;

export interface CropView {
  /** 표시 배율 (CSS px당 화면 px) */
  scale: number;
  /** 크롭 영역의 화면 크기 */
  width: number;
  height: number;
  /** 전체 스크린샷 이미지의 화면 위치와 크기 (크롭 영역 기준, 음수 offset) */
  image: { left: number; top: number; width: number; height: number };
}

/**
 * 컨테이너 너비에 맞추되 높이가 maxHeight를 넘으면 높이에 맞춘다. 확대하지 않는 상한은 두지 않는다
 * (cropRect는 최소 320×160이라 패널 폭에서 과도하게 커지지 않는다).
 */
export function computeCropView(
  crop: Box,
  screenshot: { width: number; height: number },
  containerWidth: number,
  maxHeight: number = CROP_MAX_HEIGHT_PX,
): CropView | null {
  if (crop.width <= 0 || crop.height <= 0 || containerWidth <= 0) return null;
  const scale = Math.min(containerWidth / crop.width, maxHeight / crop.height);
  return {
    scale,
    width: crop.width * scale,
    height: crop.height * scale,
    image: { left: -crop.x * scale, top: -crop.y * scale, width: screenshot.width * scale, height: screenshot.height * scale },
  };
}

/** 박스를 크롭 영역 안으로 잘라, 크롭 영역 기준 화면 좌표로 바꾼다. 겹치지 않으면 null */
export function boxInCrop(box: Box, crop: Box, scale: number): Box | null {
  const clipped = intersectBox(box, crop);
  if (!clipped) return null;
  return {
    x: (clipped.x - crop.x) * scale,
    y: (clipped.y - crop.y) * scale,
    width: clipped.width * scale,
    height: clipped.height * scale,
  };
}

/** "관련 개발 태스크"(WIREFRAME 6.7): 이슈가 속한 태스크 1개. PRD 5.8.1에 따라 이슈는 정확히 한 태스크에 속한다 */
export function taskForIssue(tasks: readonly DevTask[], issueId: string): DevTask | null {
  return tasks.find((task) => task.issueIds.includes(issueId)) ?? null;
}
