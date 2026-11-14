import { intersectBox, type Box } from '@/lib/rect';
import type { Issue, Priority, Viewport } from '@/types/inspection';
import type { ListedIssue } from './issues';

// WIREFRAME 5.6 마커 좌표 규칙. SVG viewBox를 스크린샷 실제 크기(screenshotWidth × screenshotHeight)로 두고
// occurrence.boundingBox(문서 기준 CSS px)를 그대로 그린다(DETECTION_RULES 3.1.1). 이미지가 줄어도 같은 비율로 맞는다.

export interface Marker {
  issueId: string;
  number: number;
  priority: Priority;
  needsReview: boolean;
  title: string;
  /** 스크린샷 안으로 잘라낸 박스 (SVG 좌표 = 문서 CSS px) */
  rect: Box;
  /** 스크린샷 밖으로 나가 잘렸는지 (hidden-clip 등, DETECTION_RULES 8.3) */
  clipped: boolean;
}

export interface MarkerLayout {
  viewBox: { width: number; height: number };
  markers: Marker[];
  /** 그리지 못한 이슈 수 (스크린샷 높이 밖, 또는 스크린샷 가로 밖) */
  outOfRange: number;
  /** 이 viewport에 occurrence가 있는 이슈 수 (마커를 그린 것 + 범위 밖) */
  issueCount: number;
}

/** occurrence 박스 하나를 스크린샷 좌표로 바꾼다. 그릴 수 없으면 null */
/** 마커를 그릴 스크린샷 크기. 스크린샷이 없는 viewport(screenshotUrl = null)에는 마커를 그리지 않는다 */
export interface ScreenshotSize {
  screenshotWidth: number;
  screenshotHeight: number;
}

export function placeBox(box: Box, screenshot: ScreenshotSize): { rect: Box; clipped: boolean } | null {
  // PRD 5.4.1: 스크린샷 높이 밖이면 "범위 밖"
  if (box.y >= screenshot.screenshotHeight) return null;
  const inside = box.x >= 0 && box.y >= 0 && box.x + box.width <= screenshot.screenshotWidth && box.y + box.height <= screenshot.screenshotHeight;
  // 안에 있으면 측정값을 그대로 쓴다(뺄셈으로 생기는 부동소수 오차를 만들지 않는다)
  if (inside) return { rect: box, clipped: false };
  const bounds = { x: 0, y: 0, width: screenshot.screenshotWidth, height: screenshot.screenshotHeight };
  const rect = intersectBox(box, bounds);
  return rect ? { rect, clipped: true } : null;
}

export function occurrenceOf(issue: Issue, viewport: Viewport) {
  return issue.occurrences.find((o) => o.viewport === viewport) ?? null;
}

/**
 * 목록 순번을 그대로 마커 번호로 쓴다. Needs Review 마커는 그룹을 펼쳤을 때만 넣는다(5.6).
 * 범위 밖 개수는 그리는 대상(일반 + 펼친 Needs Review)만 센다.
 */
export function layoutMarkers(
  listed: { regular: readonly ListedIssue[]; needsReview: readonly ListedIssue[] },
  viewport: Viewport,
  screenshot: ScreenshotSize,
  options: { includeNeedsReview: boolean },
): MarkerLayout {
  const candidates = options.includeNeedsReview ? [...listed.regular, ...listed.needsReview] : [...listed.regular];
  const markers: Marker[] = [];
  let outOfRange = 0;
  let issueCount = 0;
  for (const { issue, number } of candidates) {
    const occurrence = occurrenceOf(issue, viewport);
    if (!occurrence) continue;
    issueCount += 1;
    const placed = placeBox(occurrence.boundingBox, screenshot);
    if (!placed) {
      outOfRange += 1;
      continue;
    }
    markers.push({ issueId: issue.id, number, priority: issue.priority, needsReview: issue.needsReview, title: issue.title, ...placed });
  }
  return { viewBox: { width: screenshot.screenshotWidth, height: screenshot.screenshotHeight }, markers, outOfRange, issueCount };
}
