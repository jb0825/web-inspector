import { unionBoxes, type Box } from './rect';

// 크롭·도면으로 "무엇을 보여줄지" 정하는 기준 박스 (DETECTION_RULES 8.3). 순수 함수다.
// 서버의 cropRect 계산(src/server/evidence/crop.ts)과 화면의 이슈 도면(features/issue-detail/diagram.ts)이 같은 기준을 쓰도록
// 공용으로 둔다(features는 server를 import할 수 없다, AGENTS.md 3.1). 저장된 Issue/IssueOccurrence 값만으로 계산한다.

export interface CropBasisInput {
  type: string;
  subtype: string;
  boundingBox: Box;
  measured: Readonly<Record<string, number>>;
  /** Overlap의 대표 상대 요소(relatedElements[0]) rect */
  partner?: Box;
}

/**
 * - Overlap: 대상 rect ∪ 대표 상대 요소 rect
 * - Viewport Overflow: 가로를 [elementLeft, elementRight](넘침 범위)까지 넓힌다. page-scroll처럼 elementLeft가 없으면 boundingBox의 왼쪽
 * - spill: 넘친 텍스트 범위 [textLeft, textRight] × [textTop, textBottom]까지 넓힌다. 넘친 방향의 값만 있으므로 없는 쪽은 boundingBox 경계
 * - clipped: 잘린 글자는 화면에 보이지 않으므로 넓히지 않는다
 */
export function cropBasis(input: CropBasisInput): Box {
  const box = input.boundingBox;
  const m = input.measured;
  const extend = (left?: number, right?: number, top?: number, bottom?: number): Box =>
    unionBoxes([
      box,
      {
        x: left ?? box.x,
        y: top ?? box.y,
        width: (right ?? box.x + box.width) - (left ?? box.x),
        height: (bottom ?? box.y + box.height) - (top ?? box.y),
      },
    ]) ?? box;
  if (input.type === 'element-overlap') return input.partner ? (unionBoxes([box, input.partner]) ?? box) : { ...box };
  if (input.type === 'viewport-overflow') return extend(m.elementLeft, m.elementRight);
  if (input.subtype === 'spill') return extend(m.textLeft, m.textRight, m.textTop, m.textBottom);
  return { ...box };
}
