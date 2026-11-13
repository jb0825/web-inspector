import { describe, expect, it } from 'vitest';
import type { RawIssue } from '@/server/detect/types';
import { computeCropRect, cropBasisBox } from '@/server/evidence/crop';
import { r } from './helpers/collected';
import { raw } from './helpers/issues';

// PRD 5.4.1, DETECTION_RULES 8.3, 12.1 crop

describe('computeCropRect', () => {
  it('패딩: 사방 24px', () => {
    expect(computeCropRect(r(100, 200, 400, 300), 1440, 2000)).toEqual(r(76, 176, 448, 348));
  });

  it('최소 크기 320×160을 중심 기준으로 보장한다', () => {
    // 100×20 → 패딩 148×68 → 320×160, 중심 (550, 410) 유지
    expect(computeCropRect(r(500, 400, 100, 20), 1440, 2000)).toEqual(r(390, 330, 320, 160));
  });

  it('경계 안으로 이동: 왼쪽·위쪽', () => {
    expect(computeCropRect(r(10, 5, 100, 20), 1440, 2000)).toEqual(r(0, 0, 320, 160));
  });

  it('경계 안으로 이동: 오른쪽·아래쪽', () => {
    expect(computeCropRect(r(1400, 1980, 30, 10), 1440, 2000)).toEqual(r(1120, 1840, 320, 160));
  });

  it('스크린샷보다 크면 잘라낸다', () => {
    expect(computeCropRect(r(-50, 0, 2000, 100), 1440, 2000)).toEqual(r(0, 0, 1440, 160));
    expect(computeCropRect(r(0, 0, 100, 900), 390, 844)).toEqual(r(0, 0, 320, 844));
  });

  it('화면 밖으로 나간 요소(음수 x)도 경계 안으로 맞춘다', () => {
    // 패딩 (-54, 76, 248×148) → 최소 크기 (-90, 70, 320×160) → x를 0으로
    expect(computeCropRect(r(-30, 100, 200, 100), 390, 844)).toEqual(r(0, 70, 320, 160));
  });

  it('대상이 스크린샷 높이 밖이면 null', () => {
    expect(computeCropRect(r(0, 5000, 100, 40), 390, 5000)).toBeNull();
    expect(computeCropRect(r(0, 6000, 100, 40), 390, 5000)).toBeNull();
    // 걸쳐 있으면 경계 안으로 맞춘다
    expect(computeCropRect(r(0, 4990, 100, 40), 390, 5000)).toEqual(r(0, 4840, 320, 160));
  });

  it('스크린샷 너비가 layoutWidth보다 넓은 경우(Mobile 축소, P-01 실측 616×1334)', () => {
    // P-01 mobile: layoutWidth 390, 저장된 스크린샷 616×1334. 600px 박스는 스크린샷 안에 있다
    const crop = computeCropRect(r(16, 197.38, 600, 105.8), 616, 1334);
    expect(crop).toEqual({ x: 0, y: 170.28, width: 616, height: 160 });
    // layoutWidth(390)를 경계로 썼다면 박스 오른쪽 226px이 잘렸을 것이다
    expect(crop && crop.x + crop.width).toBeGreaterThan(390);
  });

  it('반올림 뒤에도 경계를 넘지 않고 최소 크기를 유지한다', () => {
    // 끝이 경계에 붙는 소수 좌표 (P-06 실측과 같은 모양)
    const crop = computeCropRect(r(16, 85.8, 358, 36.39), 493, 1067);
    expect(crop).toEqual({ x: 0, y: 23.99, width: 406, height: 160 });
    const edge = computeCropRect(r(0.333, 1000.337, 10, 10), 390, 1100.5);
    expect(edge).not.toBeNull();
    if (edge) {
      expect(edge.y + edge.height).toBeLessThanOrEqual(1100.5);
      expect(edge.height).toBe(160);
    }
  });
});

describe('cropBasisBox (8.3: 크롭으로 보여줄 범위)', () => {
  const withMeasured = (issue: RawIssue, measured: Record<string, number>): RawIssue => ({ ...issue, measured });

  it('P-06처럼 글자가 박스 밖으로 넘친 page-scroll: 가로를 elementRight까지 넓힌다', () => {
    // P-06 mobile 실측: h1 박스 (16, 85.8, 358×36.39), 글자 오른쪽 끝 493, 스크린샷 493×1067
    const issue = withMeasured(
      raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1, boundingBox: r(16, 85.8, 358, 36.39) }),
      { elementRight: 493, documentScrollWidth: 493 },
    );
    const basis = cropBasisBox(issue);
    expect(basis).toEqual({ x: 16, y: 85.8, width: 477, height: 36.39 });
    // boundingBox(하이라이트 위치)는 바뀌지 않는다
    expect(issue.boundingBox).toEqual(r(16, 85.8, 358, 36.39));
    const crop = computeCropRect(basis, 493, 1067);
    expect(crop).toEqual({ x: 0, y: 23.99, width: 493, height: 160 });
    // 넓히기 전에는 오른쪽 끝이 406이라 넘친 글자(~493)가 잘렸다
    expect(computeCropRect(issue.boundingBox, 493, 1067)?.width).toBe(406);
  });

  it('element-out 왼쪽 이탈: [elementLeft, elementRight]', () => {
    const issue = withMeasured(raw({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 1, boundingBox: r(0, 100, 200, 50) }), {
      elementLeft: -40,
      elementRight: 200,
    });
    expect(cropBasisBox(issue)).toEqual({ x: -40, y: 100, width: 240, height: 50 });
  });

  it('spill: 넘친 텍스트 범위까지 넓히고, 값이 없는 방향은 boundingBox 경계', () => {
    // 본문 p (32, 1093.59, 326×120) 아래로 텍스트가 1255까지 넘침 (P-05 모양)
    const down = withMeasured(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 2, relatedIndex: 1, boundingBox: r(32, 1093.59, 326, 120) }), {
      textBottom: 1255,
    });
    const basis = cropBasisBox(down);
    expect(basis).toMatchObject({ x: 32, y: 1093.59, width: 326 });
    expect(basis.height).toBeCloseTo(161.41, 6);
    // 크롭은 넘친 텍스트 끝(1255) + 패딩까지 보여준다. 넓히기 전에는 1237.59까지였다
    expect(computeCropRect(basis, 390, 1537)).toEqual({ x: 8, y: 1069.59, width: 374, height: 209.41 });
    // 오른쪽과 위쪽으로 넘침
    const upRight = withMeasured(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 2, relatedIndex: 1, boundingBox: r(100, 100, 200, 50) }), {
      textRight: 380,
      textTop: 80,
    });
    expect(cropBasisBox(upRight)).toEqual({ x: 100, y: 80, width: 280, height: 70 });
  });

  it('clipped는 넓히지 않는다 (잘린 글자는 화면에 보이지 않음)', () => {
    const issue = withMeasured(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1, boundingBox: r(16, 1232, 180, 44) }), {
      scrollWidth: 227,
    });
    expect(cropBasisBox(issue)).toEqual(r(16, 1232, 180, 44));
  });

  it('Overlap: 대상 ∪ 대표 상대 요소', () => {
    const issue = raw({ type: 'element-overlap', subtype: 'interactive', elementIndex: 1, relatedIndex: 2, boundingBox: r(0, 0, 100, 40) });
    expect(cropBasisBox(issue, r(60, 20, 100, 40))).toEqual({ x: 0, y: 0, width: 160, height: 60 });
  });

  it('boundingBox가 스크린샷 밖으로 나간 hidden-clip: 크롭은 스크린샷 안에 머문다', () => {
    // P-04 desktop: 이미지 (1084, 163.39, 400×300), 오른쪽 끝 1484. rootClip이라 스크린샷 너비는 layoutWidth 1440
    const issue = withMeasured(raw({ type: 'viewport-overflow', subtype: 'hidden-clip', elementIndex: 1, boundingBox: r(1084, 163.39, 400, 300) }), {
      elementLeft: 1084,
      elementRight: 1484,
    });
    const crop = computeCropRect(cropBasisBox(issue), 1440, 900);
    expect(crop).toEqual({ x: 992, y: 139.39, width: 448, height: 348 });
    // 요소 전체가 스크린샷 오른쪽 밖이어도 경계 안으로 당긴다
    const beyond = withMeasured(raw({ type: 'viewport-overflow', subtype: 'hidden-clip', elementIndex: 1, boundingBox: r(1500, 100, 200, 50) }), {
      elementLeft: 1500,
      elementRight: 1700,
    });
    const far = computeCropRect(cropBasisBox(beyond), 1440, 900);
    // 세로: 패딩 (76, 98) → 최소 160 → y = 76 − 31 = 45
    expect(far).toEqual({ x: 1120, y: 45, width: 320, height: 160 });
  });
});
