import { roundMeasure } from '@/server/collect/round';
import { CROP_MIN_HEIGHT_PX, CROP_MIN_WIDTH_PX, CROP_PADDING_PX } from '@/server/detect/constants';
import { union } from '@/server/detect/geometry';
import type { RawIssue } from '@/server/detect/types';
import type { Rect } from '@/types/inspection';

// cropRect (PRD 5.4.1, DETECTION_RULES 8.3). 순수 함수다. 이미지를 만들지 않는다.

/**
 * 크롭으로 무엇을 보여줄지 정하는 기준 박스 (DETECTION_RULES 8.3). 하이라이트 위치(boundingBox)는 바꾸지 않는다.
 * - Overlap: 대상 rect ∪ 대표 상대 요소 rect (relatedRect)
 * - Viewport Overflow: 가로를 [elementLeft, elementRight](넘침 범위, 6.1)까지 넓힌다. page-scroll처럼 elementLeft가 없으면 boundingBox의 왼쪽
 * - spill: 넘친 텍스트 범위 [textLeft, textRight] × [textTop, textBottom]까지 넓힌다. 넘친 방향의 값만 있으므로(4.2) 없는 쪽은 boundingBox 경계
 * - clipped: 잘린 글자는 화면에 보이지 않으므로 넓히지 않는다
 */
export function cropBasisBox(issue: RawIssue, relatedRect?: Rect): Rect {
  const box = issue.boundingBox;
  const extend = (left?: number, right?: number, top?: number, bottom?: number): Rect =>
    union([
      box,
      {
        x: left ?? box.x,
        y: top ?? box.y,
        width: (right ?? box.x + box.width) - (left ?? box.x),
        height: (bottom ?? box.y + box.height) - (top ?? box.y),
      },
    ]) ?? box;
  const m = issue.measured;
  if (issue.type === 'element-overlap') return relatedRect ? (union([box, relatedRect]) ?? box) : { ...box };
  if (issue.type === 'viewport-overflow') return extend(m.elementLeft, m.elementRight);
  if (issue.subtype === 'spill') return extend(m.textLeft, m.textRight, m.textTop, m.textBottom);
  return { ...box };
}

/** 한 축: 최소 길이 보장(중심 기준) → [0, limit] 안으로 이동, limit보다 길면 잘라낸다 */
function fitAxis(start: number, length: number, minLength: number, limit: number): [number, number] {
  let s = start;
  let len = length;
  if (len < minLength) {
    s -= (minLength - len) / 2;
    len = minLength;
  }
  if (len >= limit) return [0, limit];
  if (s < 0) s = 0;
  if (s + len > limit) s = limit - len;
  return [s, len];
}

/**
 * box: cropBasisBox의 결과.
 * 경계는 실제 스크린샷 크기다(innerWidth 아님, DETECTION_RULES 3.1.1, DOMAIN_MODEL S-11).
 * 대상이 스크린샷 높이 밖에 있으면 null.
 */
export function computeCropRect(box: Rect, screenshotWidth: number, screenshotHeight: number): Rect | null {
  if (box.y >= screenshotHeight) return null;
  const [x, width] = fitAxis(box.x - CROP_PADDING_PX, box.width + CROP_PADDING_PX * 2, CROP_MIN_WIDTH_PX, screenshotWidth);
  const [y, height] = fitAxis(box.y - CROP_PADDING_PX, box.height + CROP_PADDING_PX * 2, CROP_MIN_HEIGHT_PX, screenshotHeight);
  const [left, w] = roundInside(x, width, screenshotWidth);
  const [top, h] = roundInside(y, height, screenshotHeight);
  return { x: left, y: top, width: w, height: h };
}

/** 반올림한 뒤에도 [0, limit] 안에 있도록, 끝이 넘으면 시작을 당긴다 (최소 크기 320×160을 그대로 유지) */
function roundInside(start: number, length: number, limit: number): [number, number] {
  const len = roundMeasure(length);
  const s = roundMeasure(start);
  return s + len > limit ? [roundMeasure(limit - len), len] : [s, len];
}
