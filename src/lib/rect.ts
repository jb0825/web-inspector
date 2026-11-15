// 사각형 계산 (도메인 로직 없음). 좌표 단위는 호출한 쪽이 정한다.

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 두 사각형의 교집합. 겹치지 않으면(넓이 0 포함) null */
export function intersectBox(a: Box, b: Box): Box | null {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 사각형들을 모두 덮는 가장 작은 사각형. 비어 있으면 null */
export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
