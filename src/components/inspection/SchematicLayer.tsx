import type { ReactNode } from 'react';
import { formatPx } from '@/lib/format';
import {
  chipWidth,
  continuedLabel,
  fitLabel,
  gridLines,
  labelFits,
  placeChips,
  projectBlock,
  SCHEMATIC_COLORS as C,
  textBars,
  toScreenX,
  toScreenY,
  type SchematicFrame,
} from '@/lib/schematic';
import type { LayoutBlock, LayoutBlockKind } from '@/types/inspection';

// 측정값으로 그린 배치도의 SVG 내용 (WIREFRAME 5.6, 6.4). 시안 schematic-v2-mock.html의 schematic()과 같은 결과를 낸다.
// 페이지에서 가져온 label은 SVG <text>의 문자열로만 넣는다(AGENTS.md 8장).

const STRUCT_KINDS: ReadonlySet<LayoutBlockKind> = new Set(['header', 'nav', 'main', 'section', 'footer', 'aside', 'form']);
const MEDIA_KINDS: ReadonlySet<LayoutBlockKind> = new Set(['canvas', 'video', 'iframe']);

export const isStructBlock = (kind: LayoutBlockKind) => STRUCT_KINDS.has(kind);

/** pattern id. 한 페이지에 SVG가 여러 개이고 숨긴 탭의 SVG를 참조하면 그려지지 않으므로 SVG마다 따로 둔다 */
export const patternIds = (prefix: string) => ({ hatch: `${prefix}-hatch`, media: `${prefix}-media` });

export function SchematicDefs({ idPrefix }: { idPrefix: string }) {
  const ids = patternIds(idPrefix);
  return (
    <defs>
      <pattern id={ids.hatch} width={7} height={7} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={7} height={7} fill={C.problemFill} />
        <line x1={0} y1={0} x2={0} y2={7} stroke={C.problem} strokeWidth={2.2} opacity={0.55} />
      </pattern>
      <pattern id={ids.media} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={8} height={8} fill={C.mediaFill} />
        <line x1={0} y1={0} x2={0} y2={8} stroke={C.blue} strokeWidth={1.2} opacity={0.45} />
      </pattern>
    </defs>
  );
}

function SvgText({ x, y, children, size = 10, fill = C.chipText, weight = 400, anchor = 'start' }: { x: number; y: number; children: string; size?: number; fill?: string; weight?: number; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} fontSize={size} fill={fill} fontWeight={weight} textAnchor={anchor} fontFamily="inherit">
      {children}
    </text>
  );
}

/** 흰 바탕 칩 + 글자. 위치는 칩 왼쪽 위 */
function Chip({ x, y, text, size = 9.5, height = 15, color = C.chipText, stroke = C.chipStroke, weight = 400, round = 3 }: { x: number; y: number; text: string; size?: number; height?: number; color?: string; stroke?: string; weight?: number; round?: number }) {
  const width = chipWidth(text, size);
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={round} fill="#fff" stroke={stroke} />
      <SvgText x={x + width / 2} y={y + height / 2 + size * 0.36} size={size} fill={color} weight={weight} anchor="middle">
        {text}
      </SvgText>
    </g>
  );
}

/** 오른쪽 끝에 붙는 파란 칩 (첫 화면 끝, 여기부터 배치도 등). right는 칩 오른쪽 끝, cy는 세로 중심 */
export function BlueChip({ right, cy, text, size = 10, weight = 600 }: { right: number; cy: number; text: string; size?: number; weight?: number }) {
  const width = chipWidth(text, size) + 8;
  const height = size + 8;
  return <Chip x={right - width} y={cy - height / 2} text={text} size={size} height={height} color={C.blue} stroke={C.blue} weight={weight} round={height / 2} />;
}

export function DashedLine({ x1, y1, x2, y2, color = C.blue, width = 1.5, dash = '7 5' }: { x1: number; y1: number; x2: number; y2: number; color?: string; width?: number; dash?: string }) {
  return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeDasharray={dash} />;
}

const STRUCT_CHIP_SIZE = 9.5;
const STRUCT_CHIP_HEIGHT = 15;
/** heading label 칩. 블록 크기와 관계없이 글자 크기를 고정한다 */
const HEADING_CHIP_SIZE = 10;
const HEADING_CHIP_HEIGHT = 16;

interface LabelChip {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  size: number;
  color: string;
  weight: number;
  stroke?: string;
  round?: number;
}

/** 구조 블록과 heading의 label 칩 (이슈 박스보다 위, 맨 위에 그린다). 구조 블록은 위쪽이 잘려 보이면 "(계속)" */
function labelChip(block: LayoutBlock, frame: SchematicFrame, from: number, to: number): LabelChip | null {
  if (block.label === undefined) return null;
  const projected = projectBlock(block.rect, frame, from, to);
  if (!projected) return null;
  const { box: R, continued } = projected;
  if (isStructBlock(block.kind)) {
    if (R.width < 30 || R.height < STRUCT_CHIP_HEIGHT) return null;
    const text = fitLabel(continuedLabel(block.label, continued), Math.max(10, R.width - 16), 10);
    return { x: R.x + 6, y: R.y + 4, width: chipWidth(text, STRUCT_CHIP_SIZE), height: STRUCT_CHIP_HEIGHT, text, size: STRUCT_CHIP_SIZE, color: C.chipText, weight: 400 };
  }
  if (MEDIA_KINDS.has(block.kind)) {
    // canvas·video·iframe 이름 pill은 블록 가운데. 위에 그린 heading 등에 가리지 않게 칩 층에 둔다
    const text = block.label ?? block.kind;
    const width = Math.max(68, chipWidth(text, 10.5) + 12);
    if (R.width < width || R.height < 22) return null;
    return { x: R.x + R.width / 2 - width / 2, y: R.y + R.height / 2 - 10, width, height: 20, text, size: 10.5, color: C.blue, weight: 700, stroke: C.blue, round: 10 };
  }
  if (block.kind === 'heading') {
    // 위쪽이 잘린 heading은 이어지는 부분이라 label을 다시 쓰지 않는다
    if (continued || R.width < 30 || R.height < 6) return null;
    const text = fitLabel(block.label, Math.max(40, R.width - 8), HEADING_CHIP_SIZE);
    return { x: R.x + 4, y: R.y + 4, width: chipWidth(text, HEADING_CHIP_SIZE), height: HEADING_CHIP_HEIGHT, text, size: HEADING_CHIP_SIZE, color: C.headingText, weight: 700 };
  }
  return null;
}

/** 그리기 순서 (아래부터): 구조 → canvas·video·iframe → image·card → text → heading·button·input. 이슈 박스와 label 칩은 그 위 */
function layerOf(kind: LayoutBlockKind): number {
  if (isStructBlock(kind)) return 0;
  if (MEDIA_KINDS.has(kind)) return 1;
  if (kind === 'image' || kind === 'card') return 2;
  if (kind === 'text') return 3;
  return 4;
}

function renderBlock(block: LayoutBlock, key: number, frame: SchematicFrame, from: number, to: number, ids: ReturnType<typeof patternIds>): ReactNode {
  const projected = projectBlock(block.rect, frame, from, to);
  if (!projected) return null;
  const { box: R } = projected;
  const label = block.label;
  const showLabel = label !== undefined && labelFits(R);

  if (isStructBlock(block.kind)) {
    return <rect key={key} x={R.x + 2} y={R.y + 2} width={Math.max(0, R.width - 4)} height={Math.max(0, R.height - 4)} fill="none" stroke={C.struct} strokeWidth={1.2} strokeDasharray="5 4" />;
  }

  if (MEDIA_KINDS.has(block.kind)) {
    // 이름 pill은 SchematicChips가 맨 위에 그린다
    return <rect key={key} x={R.x} y={R.y} width={R.width} height={R.height} fill={`url(#${ids.media})`} stroke={C.blue} strokeWidth={1.2} strokeDasharray="6 4" />;
  }

  switch (block.kind) {
    case 'heading':
      // label은 SchematicChips가 흰 칩으로 맨 위에 그린다
      return <rect key={key} x={R.x} y={R.y} width={R.width} height={R.height} rx={2} fill={C.heading} />;
    case 'text':
      return (
        <g key={key}>
          {textBars(R).map((bar, i) => (
            <rect key={i} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={1.5} fill={C.textBar} />
          ))}
        </g>
      );
    case 'image':
      return (
        <g key={key}>
          <rect x={R.x} y={R.y} width={R.width} height={R.height} fill={C.imageFill} stroke={C.imageStroke} />
          <line x1={R.x} y1={R.y} x2={R.x + R.width} y2={R.y + R.height} stroke={C.imageCross} />
          <line x1={R.x + R.width} y1={R.y} x2={R.x} y2={R.y + R.height} stroke={C.imageCross} />
          {showLabel && R.width > 50 && R.height > 16 ? (
            <SvgText x={R.x + R.width / 2} y={R.y + R.height / 2 + 4} anchor="middle">
              {fitLabel(label, R.width - 10, 10)}
            </SvgText>
          ) : null}
        </g>
      );
    case 'button':
      return (
        <g key={key}>
          <rect x={R.x} y={R.y} width={R.width} height={R.height} rx={Math.min(6, R.height / 2)} fill={C.buttonFill} stroke={C.imageStroke} />
          {label !== undefined && R.height >= 12 && R.width >= 24 ? (
            <SvgText x={R.x + R.width / 2} y={R.y + R.height / 2 + 4} anchor="middle" fill={C.headingText} weight={600}>
              {fitLabel(label, R.width - 8, 10)}
            </SvgText>
          ) : null}
        </g>
      );
    case 'input':
      return (
        <g key={key}>
          <rect x={R.x} y={R.y} width={R.width} height={R.height} rx={3} fill="#fff" stroke={C.imageStroke} />
          {showLabel ? (
            <SvgText x={R.x + 6} y={R.y + R.height / 2 + 4}>
              {fitLabel(label, R.width - 12, 10)}
            </SvgText>
          ) : null}
        </g>
      );
    case 'card':
      return <rect key={key} x={R.x} y={R.y} width={R.width} height={R.height} rx={4} fill="none" stroke={C.card} strokeWidth={1.2} />;
    default:
      return null;
  }
}

export interface SchematicLayerProps {
  idPrefix: string;
  frame: SchematicFrame;
  /** 격자와 페이지 윤곽을 그릴 문서 너비 */
  pageWidth: number;
  /** 화면(layout viewport) 너비. pageWidth가 더 넓으면 세로 점선과 "화면 밖"을 그린다 */
  layoutWidth: number;
  /** 그릴 문서 y 구간 */
  from: number;
  to: number;
  blocks: readonly LayoutBlock[];
  /** 첫 화면 경계 (viewport 높이). null이면 그리지 않는다 */
  firstScreen: number | null;
  /** 도면 높이 상한에 걸렸으면 그 높이. 경계선과 "배치도 끝"을 그린다 */
  layoutEnd: number | null;
  /** 오른쪽 칩을 붙일 화면 x (보통 SVG 너비) */
  chipRight: number;
  /** 화면 경계 칩 문구를 쓸지 (미리보기만) */
  showScreenWidthLabel?: boolean;
}

/** 격자, 페이지 윤곽, 블록, 경계선. 이슈 박스와 label 칩(SchematicChips)은 호출한 쪽이 이 순서로 위에 그린다 */
export function SchematicLayer({ idPrefix, frame, pageWidth, layoutWidth, from, to, blocks, firstScreen, layoutEnd, chipRight, showScreenWidthLabel = true }: SchematicLayerProps) {
  const ids = patternIds(idPrefix);
  const X = (x: number) => toScreenX(frame, x);
  const Y = (y: number) => toScreenY(frame, y);
  const { xs, ys } = gridLines(pageWidth, from, to);
  const top = Y(from);
  const bottom = Y(to);
  const outside = pageWidth > layoutWidth;

  // 같은 층 안에서는 문서 순서를 지킨다 (Array.prototype.sort는 안정 정렬)
  const drawn = blocks
    .map((block, i) => ({ block, i }))
    .sort((a, b) => layerOf(a.block.kind) - layerOf(b.block.kind))
    .map(({ block, i }) => renderBlock(block, i, frame, from, to, ids));

  return (
    <g>
      {outside ? <rect x={X(layoutWidth)} y={top} width={X(pageWidth) - X(layoutWidth)} height={bottom - top} fill={C.outside} /> : null}
      {xs.map((x) => (
        <line key={`gx${x}`} x1={X(x)} y1={top} x2={X(x)} y2={bottom} stroke={C.grid} strokeWidth={1} />
      ))}
      {ys.map((y) => (
        <line key={`gy${y}`} x1={X(0)} y1={Y(y)} x2={X(pageWidth)} y2={Y(y)} stroke={C.grid} strokeWidth={1} />
      ))}
      <line x1={X(0) + 1} y1={top} x2={X(0) + 1} y2={bottom} stroke={C.pageEdge} strokeWidth={2} />
      <line x1={X(pageWidth) - 1} y1={top} x2={X(pageWidth) - 1} y2={bottom} stroke={C.pageEdge} strokeWidth={2} />
      {drawn}
      {outside ? (
        <g>
          <DashedLine x1={X(layoutWidth)} y1={top} x2={X(layoutWidth)} y2={bottom} />
          {showScreenWidthLabel ? (
            <>
              <Chip x={X(layoutWidth) + 6} y={top + 6} text={`화면 너비 ${formatPx(layoutWidth)}px`} size={10} height={18} color={C.blue} stroke={C.blue} weight={600} round={9} />
              {X(pageWidth) - X(layoutWidth) > 60 ? (
                <SvgText x={(X(layoutWidth) + X(pageWidth)) / 2} y={top + 44} anchor="middle">
                  화면 밖
                </SvgText>
              ) : null}
            </>
          ) : null}
        </g>
      ) : null}
      {firstScreen !== null && firstScreen >= from && firstScreen <= to ? (
        <g>
          <DashedLine x1={X(0)} y1={Y(firstScreen)} x2={X(pageWidth)} y2={Y(firstScreen)} />
          {/* 문서 끝과 같은 높이면 칩이 잘리지 않게 위로 올린다 */}
          <BlueChip right={Math.min(chipRight, X(pageWidth)) - 8} cy={Math.min(Y(firstScreen), bottom - 10)} text={`첫 화면 끝 (${formatPx(firstScreen)}px)`} />
        </g>
      ) : null}
      {layoutEnd !== null && layoutEnd >= from && layoutEnd < to ? (
        <g>
          <rect x={X(0)} y={Y(layoutEnd)} width={X(pageWidth) - X(0)} height={bottom - Y(layoutEnd)} fill={C.outside} opacity={0.6} />
          <DashedLine x1={X(0)} y1={Y(layoutEnd)} x2={X(pageWidth)} y2={Y(layoutEnd)} color={C.struct} />
          <BlueChip right={Math.min(chipRight, X(pageWidth)) - 8} cy={Math.min(Y(layoutEnd), bottom - 10)} text={`배치도 끝 (${formatPx(layoutEnd)}px)`} />
        </g>
      ) : null}
    </g>
  );
}

export interface SchematicChipsProps {
  frame: SchematicFrame;
  from: number;
  to: number;
  blocks: readonly LayoutBlock[];
  /** 칩이 넘지 않을 오른쪽 끝 (화면 x) */
  chipRight: number;
}

/** 구조 블록과 heading의 label 칩. 이슈 박스 위, 맨 위에 그린다. 칩끼리 겹치면 비켜 놓는다 */
export function SchematicChips({ frame, from, to, blocks, chipRight }: SchematicChipsProps) {
  const raw = blocks.flatMap((block) => {
    const chip = labelChip(block, frame, from, to);
    return chip ? [chip] : [];
  });
  const placed = placeChips(raw, chipRight);
  return (
    <g>
      {placed.map((p, i) => (
        <Chip key={i} x={p.x} y={p.y} text={raw[i].text} size={raw[i].size} height={p.height} color={raw[i].color} weight={raw[i].weight} stroke={raw[i].stroke} round={raw[i].round} />
      ))}
    </g>
  );
}
