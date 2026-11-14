import { cropBasis } from '@/lib/cropBasis';
import { intersectBox, unionBoxes, type Box } from '@/lib/rect';
import type { Issue, IssueOccurrence } from '@/types/inspection';

// 이슈 도면 (WIREFRAME 6.4). 스크린샷이 없는 viewport(SCREENSHOT_FAILED, PRD 5.2.4)의 하이라이트 자리에
// 저장된 측정값만으로 그린 배치도를 보여준다. 데이터 모델(PRD 8.2)은 바꾸지 않는다. 순수 함수다.
// 좌표는 모두 문서 기준 CSS px다(boundingBox와 같다).

/** cropRect와 같은 여백과 최소 크기 (DETECTION_RULES 8.3의 CROP_PADDING_PX, CROP_MIN_WIDTH_PX, CROP_MIN_HEIGHT_PX) */
export const DIAGRAM_PADDING_PX = 24;
export const DIAGRAM_MIN_WIDTH_PX = 320;
export const DIAGRAM_MIN_HEIGHT_PX = 160;

export type DiagramShapeKind =
  /** 이슈 대상 요소 (boundingBox) */
  | 'target'
  /** 관련 요소 (relatedElements: 겹친 상대, 테두리 조상 등) */
  | 'related'
  /** 넘친 부분: 화면 밖(viewport-overflow), 컨테이너 밖 텍스트(spill), 잘린 내용(clipped) */
  | 'overflow'
  /** 겹친 영역 (element-overlap) */
  | 'intersection';

export interface DiagramShape {
  kind: DiagramShapeKind;
  box: Box;
  /** 범례에 쓰는 설명 */
  label: string;
}

export interface IssueDiagram {
  /** 도면이 보여주는 문서 영역 */
  region: Box;
  /** 화면(layout viewport) 너비. 0과 이 값에 점선을 긋는다 */
  layoutWidth: number;
  shapes: DiagramShape[];
  /** 저장된 값으로 정확히 그릴 수 없는 부분의 안내 */
  notes: string[];
}

const px = (value: number) => `${Math.round(value * 100) / 100}px`;

/** 한 축: 최소 길이 보장(중심 기준). 화면 경계로 자르지 않는다(넘친 부분을 보여주려는 도면이다) */
function padAxis(start: number, length: number, minLength: number): [number, number] {
  const s = start - DIAGRAM_PADDING_PX;
  const len = length + DIAGRAM_PADDING_PX * 2;
  return len >= minLength ? [s, len] : [s - (minLength - len) / 2, minLength];
}

/** 대상 박스 중 [0, layoutWidth] 밖으로 나간 부분 (가로) */
function outsideScreen(box: Box, layoutWidth: number, label: (overflow: number) => string): DiagramShape[] {
  const shapes: DiagramShape[] = [];
  const left = box.x;
  const right = box.x + box.width;
  if (left < 0) shapes.push({ kind: 'overflow', box: { x: left, y: box.y, width: Math.min(0, right) - left, height: box.height }, label: label(-left) });
  if (right > layoutWidth) {
    const start = Math.max(layoutWidth, left);
    shapes.push({ kind: 'overflow', box: { x: start, y: box.y, width: right - start, height: box.height }, label: label(right - layoutWidth) });
  }
  return shapes;
}

function viewportOverflowShapes(occurrence: Pick<IssueOccurrence, 'boundingBox' | 'measured'>, layoutWidth: number): DiagramShape[] {
  const box = occurrence.boundingBox;
  const m = occurrence.measured;
  // DETECTION_RULES 6장: 넘침 범위는 [elementLeft, elementRight]. page-scroll은 elementLeft가 없어 boundingBox 왼쪽을 쓴다
  const extent: Box = {
    x: m.elementLeft ?? box.x,
    y: box.y,
    width: (m.elementRight ?? box.x + box.width) - (m.elementLeft ?? box.x),
    height: box.height,
  };
  return outsideScreen(extent, layoutWidth, (overflow) => `화면 밖 ${px(overflow)}`);
}

function spillShapes(occurrence: Pick<IssueOccurrence, 'measured' | 'expected' | 'relatedElements'>): DiagramShape[] {
  const container = occurrence.relatedElements.find((r) => r.role === 'bordered-ancestor')?.boundingBox;
  if (!container) return [];
  const m = occurrence.measured;
  const shapes: DiagramShape[] = [];
  const top = container.y;
  const bottom = container.y + container.height;
  const left = container.x;
  const right = container.x + container.width;
  // DETECTION_RULES 4.2: 넘친 방향의 값만 기록된다. 그 방향의 컨테이너 밖 띠를 그린다
  if (m.textRight !== undefined && m.textRight > right) {
    shapes.push({ kind: 'overflow', box: { x: right, y: top, width: m.textRight - right, height: container.height }, label: `오른쪽으로 넘친 텍스트 ${px(m.textRight - right)}` });
  }
  if (m.textLeft !== undefined && m.textLeft < left) {
    shapes.push({ kind: 'overflow', box: { x: m.textLeft, y: top, width: left - m.textLeft, height: container.height }, label: `왼쪽으로 넘친 텍스트 ${px(left - m.textLeft)}` });
  }
  if (m.textBottom !== undefined && m.textBottom > bottom) {
    shapes.push({ kind: 'overflow', box: { x: left, y: bottom, width: container.width, height: m.textBottom - bottom }, label: `아래로 넘친 텍스트 ${px(m.textBottom - bottom)}` });
  }
  if (m.textTop !== undefined && m.textTop < top) {
    shapes.push({ kind: 'overflow', box: { x: left, y: m.textTop, width: container.width, height: top - m.textTop }, label: `위로 넘친 텍스트 ${px(top - m.textTop)}` });
  }
  return shapes;
}

function clippedShapes(occurrence: Pick<IssueOccurrence, 'boundingBox' | 'measured' | 'expected'>): DiagramShape[] {
  const box = occurrence.boundingBox;
  const m = occurrence.measured;
  const e = occurrence.expected;
  const shapes: DiagramShape[] = [];
  // DETECTION_RULES 4.1: x축은 scrollWidth − clientWidth, y축은 scrollHeight − clientHeight만큼 내용이 잘렸다.
  // 테두리 두께는 저장하지 않으므로 요소 박스 끝에 잘린 크기만큼 붙여 그린다
  if (m.scrollWidth !== undefined && e.clientWidth !== undefined && m.scrollWidth > e.clientWidth) {
    const overflow = m.scrollWidth - e.clientWidth;
    shapes.push({ kind: 'overflow', box: { x: box.x + box.width, y: box.y, width: overflow, height: box.height }, label: `잘린 내용 가로 ${px(overflow)}` });
  }
  if (m.scrollHeight !== undefined && e.clientHeight !== undefined && m.scrollHeight > e.clientHeight) {
    const overflow = m.scrollHeight - e.clientHeight;
    shapes.push({ kind: 'overflow', box: { x: box.x, y: box.y + box.height, width: box.width, height: overflow }, label: `잘린 내용 세로 ${px(overflow)}` });
  }
  return shapes;
}

const RELATED_LABELS: Record<IssueOccurrence['relatedElements'][number]['role'], string> = {
  'overlap-target': '겹친 요소',
  'clipping-ancestor': '잘라내는 상위 요소',
  'bordered-ancestor': '테두리가 있는 상위 요소',
  'cause-ancestor': '원인 상위 요소',
};

/**
 * occurrence 하나의 도면. 영역은 cropRect와 같은 기준(DETECTION_RULES 8.3의 box)에 그린 도형을 더해 정하고,
 * 같은 여백(24px)과 최소 크기(320×160)를 쓴다. 화면 경계로 자르지 않는다.
 */
export function buildIssueDiagram(
  issue: Pick<Issue, 'type' | 'subtype'>,
  occurrence: Pick<IssueOccurrence, 'boundingBox' | 'measured' | 'expected' | 'relatedElements'>,
  layoutWidth: number,
): IssueDiagram {
  const target: DiagramShape = { kind: 'target', box: occurrence.boundingBox, label: '대상 요소' };
  const related: DiagramShape[] = occurrence.relatedElements.map((r) => ({ kind: 'related', box: r.boundingBox, label: RELATED_LABELS[r.role] }));
  const partner = occurrence.relatedElements.find((r) => r.role === 'overlap-target')?.boundingBox;
  const notes: string[] = [];

  let extra: DiagramShape[] = [];
  if (issue.type === 'viewport-overflow') extra = viewportOverflowShapes(occurrence, layoutWidth);
  else if (issue.type === 'element-overlap') {
    const area = partner ? intersectBox(occurrence.boundingBox, partner) : null;
    extra = area ? [{ kind: 'intersection', box: area, label: '겹친 영역' }] : [];
  } else if (issue.subtype === 'spill') extra = spillShapes(occurrence);
  else if (issue.subtype === 'clipped') {
    extra = clippedShapes(occurrence);
    notes.push('잘린 글자의 실제 위치는 저장되지 않아, 잘린 크기만큼 요소 끝에 붙여 그렸습니다.');
  }

  const basis = cropBasis({ type: issue.type, subtype: issue.subtype, boundingBox: occurrence.boundingBox, measured: occurrence.measured, partner });
  const shapes = [...related, target, ...extra];
  const covered = unionBoxes([basis, ...shapes.map((s) => s.box)]) ?? basis;
  const [x, width] = padAxis(covered.x, covered.width, DIAGRAM_MIN_WIDTH_PX);
  const [y, height] = padAxis(covered.y, covered.height, DIAGRAM_MIN_HEIGHT_PX);
  return { region: { x, y, width, height }, layoutWidth, shapes, notes };
}

/** "개발자 도구에서 찾기"로 복사할 콘솔 코드. selector를 JS 문자열로 안전하게 넣는다 */
export function devtoolsQuery(selector: string): string {
  return `document.querySelector(${JSON.stringify(selector)})`;
}

/** "실제 페이지 열기"에 쓸 주소. http/https만 허용하고 그 밖은 null */
export function openablePageUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}
