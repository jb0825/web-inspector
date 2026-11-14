import { roundMeasure } from '@/server/collect/round';
import { CROP_MIN_HEIGHT_PX, CROP_MIN_WIDTH_PX, CROP_PADDING_PX } from '@/server/detect/constants';
import type { RawIssue } from '@/server/detect/types';
import { cropBasis } from '@/lib/cropBasis';
import type { Rect } from '@/types/inspection';

// cropRect (PRD 5.4.1, DETECTION_RULES 8.3). 순수 함수다. 이미지를 만들지 않는다.

/**
 * 크롭으로 무엇을 보여줄지 정하는 기준 박스 (DETECTION_RULES 8.3). 하이라이트 위치(boundingBox)는 바꾸지 않는다.
 * 계산은 화면의 이슈 도면과 함께 쓰는 src/lib/cropBasis.ts에 있다.
 */
export function cropBasisBox(issue: RawIssue, relatedRect?: Rect): Rect {
  return cropBasis({ type: issue.type, subtype: issue.subtype, boundingBox: issue.boundingBox, measured: issue.measured, partner: relatedRect });
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
