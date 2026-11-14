import { describe, expect, it } from 'vitest';
import { boxInCrop, computeCropView, CROP_MAX_HEIGHT_PX, taskForIssue } from '@/features/issue-detail/crop';
import type { DevTask } from '@/types/inspection';

describe('computeCropView (PRD 5.4.1, DESIGN_GUIDE 9.3)', () => {
  it('컨테이너 너비 / cropRect.width 비율로 맞춘다', () => {
    // P-01 Mobile: cropRect 616×160, 스크린샷 616×1334, 패널 안쪽 432px
    const view = computeCropView({ x: 0, y: 170.28, width: 616, height: 160 }, { width: 616, height: 1334 }, 432)!;
    expect(view.scale).toBeCloseTo(432 / 616);
    expect(view.width).toBeCloseTo(432);
    expect(view.height).toBeCloseTo(160 * (432 / 616));
    expect(view.image.left).toBeCloseTo(0);
    expect(view.image.top).toBeCloseTo(-170.28 * (432 / 616));
    expect(view.image.width).toBeCloseTo(432);
  });

  it('높이가 최대 높이를 넘으면 높이에 맞춘다', () => {
    // P-04 Desktop: 448×348 → 432 폭이면 높이 335 > 320
    const view = computeCropView({ x: 992, y: 139.39, width: 448, height: 348 }, { width: 1440, height: 900 }, 432)!;
    expect(view.scale).toBeCloseTo(CROP_MAX_HEIGHT_PX / 348);
    expect(view.height).toBeCloseTo(320);
    expect(view.width).toBeLessThan(432);
  });

  it('크기가 0이면 null', () => {
    expect(computeCropView({ x: 0, y: 0, width: 320, height: 160 }, { width: 390, height: 844 }, 0)).toBeNull();
  });
});

describe('boxInCrop (DETECTION_RULES 8.3)', () => {
  it('크롭 안의 박스는 위치만 옮기고 배율을 곱한다', () => {
    expect(boxInCrop({ x: 16, y: 197.38, width: 600, height: 105.8 }, { x: 0, y: 170.28, width: 616, height: 160 }, 0.5)).toEqual({
      x: 8,
      y: expect.closeTo(13.55, 5),
      width: 300,
      height: expect.closeTo(52.9, 5),
    });
  });

  it('P-04: 스크린샷 밖으로 나간 박스는 크롭 안으로 잘라 그린다', () => {
    // Mobile: boundingBox x 274, width 400 (오른쪽 끝 674) / cropRect x 0, width 390
    const box = boxInCrop({ x: 274, y: 188.98, width: 400, height: 300 }, { x: 0, y: 164.98, width: 390, height: 348 }, 1)!;
    expect(box.x).toBeCloseTo(274);
    expect(box.width).toBeCloseTo(116);
    expect(box.x + box.width).toBeCloseTo(390);
  });

  it('겹치지 않으면 null', () => {
    expect(boxInCrop({ x: 500, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 320, height: 160 }, 1)).toBeNull();
  });
});

describe('taskForIssue (WIREFRAME 6.7)', () => {
  it('이슈가 속한 태스크를 찾는다', () => {
    const tasks = [{ id: 'TASK-001', issueIds: ['ISS-001'] }, { id: 'TASK-002', issueIds: ['ISS-002', 'ISS-003'] }] as DevTask[];
    expect(taskForIssue(tasks, 'ISS-003')?.id).toBe('TASK-002');
    expect(taskForIssue(tasks, 'ISS-009')).toBeNull();
  });
});
