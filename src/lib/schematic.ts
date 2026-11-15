import type { Box } from './rect';

// 측정값으로 그린 배치도의 좌표 변환과 label 처리 (WIREFRAME 5.6, 6.4). 순수 함수다.
// 결과 화면 미리보기와 Issue Detail이 함께 쓴다(features끼리 import할 수 없다, AGENTS.md 3.1).
// 도면은 컨테이너 너비에 맞춰 축소되지만 선 굵기와 글자 크기는 화면 기준 px로 고정한다.
// 그래서 SVG를 viewBox로 늘리지 않고, 문서 좌표에 배율을 곱한 화면 좌표로 직접 그린다(시안 schematic-v2-mock.html의 schematic()).

/** 시안 색 (docs/assets/mock/schematic-v2-mock.html). DESIGN_GUIDE 토큰보다 시안 값을 우선한다 */
export const SCHEMATIC_COLORS = {
  grid: '#eef0f3',
  pageEdge: '#c9ced6',
  struct: '#9aa3af',
  chipStroke: '#d5dae0',
  chipText: '#6b7380',
  heading: '#e9ecf0',
  headingText: '#3b4350',
  textBar: '#e3e6ea',
  imageFill: '#f1f3f5',
  imageStroke: '#c9ced6',
  imageCross: '#d5dae0',
  buttonFill: '#e8ecf2',
  card: '#d5dae0',
  blue: '#2f6fed',
  mediaFill: '#eaf1ff',
  outside: '#f3f4f6',
  problem: '#e5484d',
  problemFill: '#fdecec',
  partner: '#f5a524',
  ink: '#1b1f24',
} as const;

export const PRIORITY_COLORS = { P0: '#e5484d', P1: '#f5a524', P2: '#8b95a3', P3: '#b8bfc9' } as const;

/** 문서 기준 격자 간격 (px) */
export const SCHEMATIC_GRID_PX = 40;
/** 이보다 작은 블록(화면 기준)은 label을 생략한다 */
export const LABEL_MIN_WIDTH = 60;
export const LABEL_MIN_HEIGHT = 14;
/** 사진 아래쪽을 흐리게 처리하는 높이 (화면 기준 px) */
export const PHOTO_FADE_PX = 60;
/** 이슈 번호 원 반지름 (화면 기준 px) */
export const MARKER_RADIUS = 9;

/**
 * 문서 좌표 → 화면 좌표.
 * - scale: 문서 px당 화면 px
 * - originX, originY: 화면 왼쪽 위에 오는 문서 좌표
 */
export interface SchematicFrame {
  scale: number;
  originX: number;
  originY: number;
}

export const toScreenX = (frame: SchematicFrame, x: number) => (x - frame.originX) * frame.scale;
export const toScreenY = (frame: SchematicFrame, y: number) => (y - frame.originY) * frame.scale;

export function toScreenBox(frame: SchematicFrame, box: Box): Box {
  return { x: toScreenX(frame, box.x), y: toScreenY(frame, box.y), width: box.width * frame.scale, height: box.height * frame.scale };
}

/**
 * 블록 하나를 [from, to] 구간(문서 y)에 그릴 화면 rect. 구간과 겹치지 않으면 null.
 * continued: 블록이 구간 위쪽에서 잘려 시작한다 (구조 블록 label에 "(계속)"을 붙인다)
 */
export function projectBlock(rect: Box, frame: SchematicFrame, from: number, to: number): { box: Box; continued: boolean } | null {
  const top = Math.max(rect.y, from);
  const bottom = Math.min(rect.y + rect.height, to);
  if (bottom <= top) return null;
  return {
    box: { x: toScreenX(frame, rect.x), y: toScreenY(frame, top), width: rect.width * frame.scale, height: (bottom - top) * frame.scale },
    continued: rect.y < from,
  };
}

/** 글자 크기 size(px)로 maxPx 안에 들어가게 말줄임한다. 한글 기준 글자 폭을 size × 0.95로 본다(시안의 fit()) */
export function fitLabel(text: string, maxPx: number, size: number): string {
  const chars = Array.from(text);
  const n = Math.floor(maxPx / (size * 0.95));
  if (chars.length <= n) return text;
  if (n <= 1) return '…';
  return `${chars.slice(0, n - 1).join('')}…`;
}

/** 화면 기준 60×14px보다 작은 블록은 label을 생략한다 */
export const labelFits = (box: Box) => box.width >= LABEL_MIN_WIDTH && box.height >= LABEL_MIN_HEIGHT;

/** 구조 블록 label. 위쪽이 잘려 보이면 "(계속)"을 붙인다 */
export const continuedLabel = (label: string, continued: boolean) => (continued ? `${label} (계속)` : label);

/** 흰 바탕 칩의 너비 (시안: 글자 수 × 6.2 + 10). 한글은 더 넓어 글자 크기 기준으로 다시 잰다 */
export function chipWidth(text: string, size: number): number {
  let width = 0;
  for (const ch of Array.from(text)) width += /[ᄀ-ᇿ㄰-㆏가-힯　-鿿]/.test(ch) ? size * 1.02 : size * 0.62;
  return Math.ceil(width + 10);
}

export interface ChipPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 구조 블록 label 칩이 서로 겹치지 않게 놓는다 (중첩된 main과 section처럼 같은 자리에서 시작하는 경우).
 * 입력 순서대로 놓고, 앞의 칩과 겹치면 그 칩 오른쪽(4px 간격)으로, 오른쪽 끝(maxRight)을 넘으면 한 줄 아래로 옮긴다.
 */
export function placeChips(chips: readonly ChipPlacement[], maxRight: number): ChipPlacement[] {
  const placed: ChipPlacement[] = [];
  const overlaps = (a: ChipPlacement, b: ChipPlacement) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (const chip of chips) {
    let next = { ...chip };
    for (let guard = 0; guard < 50; guard += 1) {
      const hit = placed.find((p) => overlaps(p, next));
      if (!hit) break;
      next = { ...next, x: hit.x + hit.width + 4 };
      if (next.x + next.width > maxRight) next = { ...next, x: chip.x, y: hit.y + hit.height + 2 };
    }
    placed.push(next);
  }
  return placed;
}

/** text 블록의 회색 막대 (화면 좌표). 줄 수 1~4, 마지막 줄은 62% 길이 */
export function textBars(box: Box): Box[] {
  const n = Math.max(1, Math.min(4, Math.floor(box.height / 9)));
  const step = box.height / n;
  return Array.from({ length: n }, (_, i) => ({
    x: box.x,
    y: box.y + i * step + 1,
    width: box.width * (i === n - 1 && n > 1 ? 0.62 : 1),
    height: Math.max(3, step - 4),
  }));
}

/** 격자선 위치 (문서 좌표). 세로선은 [0, width], 가로선은 [from, to] 안의 40px 배수 */
export function gridLines(width: number, from: number, to: number, step: number = SCHEMATIC_GRID_PX): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  for (let x = 0; x <= width; x += step) xs.push(x);
  const ys: number[] = [];
  for (let y = Math.ceil(from / step) * step; y <= to; y += step) ys.push(y);
  return { xs, ys };
}

export interface SchematicFallback {
  /** 최소 도면 가운데 흰 카드의 안내 문구 */
  lines: string[];
  /** 두 번째 줄부터 흐린 글자 */
  mutedFrom: number;
}

/**
 * 빈 도면 방지 (5번 규칙). 그릴 블록이 있으면 null(정상 도면), 없으면 최소 도면의 안내 문구.
 * layoutMap이 없는 예전 문서도 최소 도면이다.
 */
export function schematicFallback(blockCount: number | null, hasCanvas: boolean): SchematicFallback | null {
  if (blockCount !== null && blockCount > 0) return null;
  if (hasCanvas) return { lines: ['이 페이지는 대부분 canvas로 그려져 있어', '구조를 표시할 수 없습니다.', 'canvas 내부는 검사하지 않습니다.'], mutedFrom: 2 };
  return { lines: ['표시할 구조 요소를 찾지 못했습니다.'], mutedFrom: 1 };
}
