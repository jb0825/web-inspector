import type { Box } from '@/lib/rect';
import { schematicFallback, type SchematicFallback } from '@/lib/schematic';
import type { LayoutBlock, ViewportResult } from '@/types/inspection';

// 결과 화면 미리보기 구성 (WIREFRAME 5.6). 순수 함수다.
// 원칙: 사진이 없는 부분은 항상 도면으로 채운다. 어떤 경우에도 페이지 끝까지 보인다.

export type PreviewMode =
  /** 스크린샷 전체 */
  | 'photo'
  /** 스크린샷이 문서 높이보다 짧다: 사진 + 아래쪽 도면 */
  | 'hybrid'
  /** 스크린샷 없음 (또는 사용자가 배치도로 전환) */
  | 'schematic';

export const PREVIEW_MODE_LABELS: Record<PreviewMode, string> = {
  photo: '스크린샷',
  hybrid: '스크린샷 + 배치도',
  schematic: '배치도 · 스크린샷 없음',
};

export interface PreviewGeometry {
  mode: PreviewMode;
  /** 미리보기 좌표계 크기 (문서 px). 사진과 도면, 마커가 같은 좌표계를 쓴다 */
  width: number;
  height: number;
  /** 사진 (photo, hybrid) */
  photo: { url: string; width: number; height: number } | null;
  /** 도면이 시작하는 문서 y. photo면 height (도면 없음) */
  schematicFrom: number;
  layoutWidth: number;
  /** 첫 화면 경계선 (도면이 문서 맨 위부터일 때만) */
  firstScreen: number | null;
  blocks: readonly LayoutBlock[];
  /** 도면 높이 상한에 걸려 그 아래 블록이 없으면 그 높이 */
  layoutEnd: number | null;
  /** 그릴 블록이 없을 때의 최소 도면 안내 (5번 규칙) */
  fallback: SchematicFallback | null;
}

export function previewMode(result: Pick<ViewportResult, 'screenshotUrl' | 'screenshotWidth' | 'screenshotHeight' | 'documentHeight'>, forceSchematic = false): PreviewMode {
  if (forceSchematic || result.screenshotUrl === null || result.screenshotWidth === null || result.screenshotHeight === null) return 'schematic';
  return result.screenshotHeight < result.documentHeight ? 'hybrid' : 'photo';
}

/**
 * @param issueBoxes 이 viewport에 그릴 이슈 박스 (문서 좌표). 도면은 화면 밖으로 나간 이슈 박스까지 들어가게 넓힌다
 * @param forceSchematic 스크린샷이 있어도 배치도로 보기 (사진 | 배치도 전환)
 */
export function previewGeometry(result: ViewportResult, issueBoxes: readonly Box[], forceSchematic = false): PreviewGeometry {
  const mode = previewMode(result, forceSchematic);
  const map = result.layoutMap;
  const layoutWidth = map?.width ?? result.layoutWidth;
  const blocks = map?.blocks ?? [];
  const layoutEnd = map && map.truncated && map.height < result.documentHeight ? map.height : null;

  if (mode === 'photo' && result.screenshotUrl !== null && result.screenshotWidth !== null && result.screenshotHeight !== null) {
    const photo = { url: result.screenshotUrl, width: result.screenshotWidth, height: result.screenshotHeight };
    return { mode, width: photo.width, height: photo.height, photo, schematicFrom: photo.height, layoutWidth, firstScreen: null, blocks, layoutEnd: null, fallback: null };
  }

  const bottom = Math.max(result.documentHeight, ...issueBoxes.map((b) => b.y + b.height));

  if (mode === 'hybrid' && result.screenshotUrl !== null && result.screenshotWidth !== null && result.screenshotHeight !== null) {
    const photo = { url: result.screenshotUrl, width: result.screenshotWidth, height: result.screenshotHeight };
    const from = photo.height;
    // 너비 기준: 사진과 도면 모두 max(screenshotWidth, layoutMap.width)를 같은 비율로 줄인다 (Mobile 축소 스크린샷)
    const width = Math.max(photo.width, layoutWidth);
    const below = map ? blocks.filter((b) => b.rect.y + b.rect.height > from).length : null;
    // 사진이 도면 상한까지 덮으면(긴 페이지) 그 아래는 도면도 없다. 빈 구간이 아니라 이유를 알린다
    const beyondLayout = layoutEnd !== null && layoutEnd <= from;
    return {
      mode,
      width,
      height: Math.ceil(bottom),
      photo,
      schematicFrom: from,
      layoutWidth,
      firstScreen: null,
      blocks,
      layoutEnd: beyondLayout ? null : layoutEnd,
      fallback: beyondLayout ? layoutLimitFallback(layoutEnd) : schematicFallback(below, result.hasCanvas),
    };
  }

  // 도면만: 페이지 윤곽(문서 가로 범위 × 문서 높이)에 화면 밖으로 나간 이슈 박스까지 넣는다
  const right = Math.max(layoutWidth, map?.scrollWidth ?? 0, ...issueBoxes.map((b) => b.x + b.width));
  return {
    mode: 'schematic',
    width: Math.ceil(right),
    height: Math.ceil(bottom),
    photo: null,
    schematicFrom: 0,
    layoutWidth,
    firstScreen: result.height,
    blocks,
    layoutEnd,
    fallback: schematicFallback(map ? blocks.length : null, result.hasCanvas),
  };
}

function layoutLimitFallback(height: number): SchematicFallback {
  return { lines: [`문서가 길어 ${height.toLocaleString('en-US')}px 아래는 배치도를 그리지 않았습니다.`], mutedFrom: 1 };
}

/** 카드 하단 문구 (3.2) */
export function previewFooter(geometry: Pick<PreviewGeometry, 'mode' | 'photo'>, documentHeight: number, issueCount: number, formatPx: (v: number) => string): string {
  if (geometry.mode === 'hybrid' && geometry.photo) return `이슈 ${issueCount} · 스크린샷 0~${formatPx(geometry.photo.height)}px, 이후 배치도`;
  if (geometry.mode === 'schematic') return `이슈 ${issueCount} · 측정값으로 그린 배치도 · 문서 높이 ${formatPx(documentHeight)}px`;
  return `이슈 ${issueCount}`;
}

/** canvas가 첫 화면 면적의 이 비율 이상을 덮으면 "canvas가 큰 페이지"로 안내한다 */
export const CANVAS_LARGE_RATIO = 0.5;

/** layoutMap의 canvas 블록 면적이 첫 화면(layoutWidth × viewport 높이)의 절반 이상인지. layoutMap이 없으면 false */
export function isCanvasLarge(result: Pick<ViewportResult, 'height' | 'layoutMap'>): boolean {
  const map = result.layoutMap;
  if (!map) return false;
  const canvasArea = map.blocks.filter((b) => b.kind === 'canvas').reduce((sum, b) => sum + b.rect.width * b.rect.height, 0);
  return canvasArea >= map.width * result.height * CANVAS_LARGE_RATIO;
}
