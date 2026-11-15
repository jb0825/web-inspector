import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import { buildLookup, isDescendantOf, union, visibleRect, visibleTextRects, type ElementLookup } from '@/server/detect/geometry';
import { isBorderedBox } from '@/server/detect/textOverflow';
import type { LayoutBlock, LayoutBlockKind, LayoutMap, Rect } from '@/types/inspection';
import {
  LAYOUT_BUTTON_MAX_HEIGHT_PX,
  LAYOUT_CARD_MIN_VIEWPORT_RATIO,
  LAYOUT_DEDUP_TOLERANCE_PX,
  LAYOUT_HEADING_LABEL_MAX,
  LAYOUT_IMAGE_MIN_AREA_PX2,
  LAYOUT_LABEL_MAX,
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MAX_HEIGHT,
  LAYOUT_SHORT_LABEL_MAX,
  LAYOUT_STRUCT_MIN_HEIGHT_PX,
  LAYOUT_TEXT_MIN_HEIGHT_PX,
} from './constants';

// 페이지 구성 도면 (DETECTION_RULES 16장). 수집한 후보 요소(CollectedViewport)만으로 만든다. 브라우저에서 새로 측정하지 않는다.
// 같은 입력이면 같은 결과다(DETECTION_RULES 11장): 입력 순서와 관계없이 index 순으로 처리하고, 모든 정렬에 index 동점 처리를 둔다.

const STRUCT_TAGS: Readonly<Record<string, LayoutBlockKind>> = {
  header: 'header',
  nav: 'nav',
  main: 'main',
  section: 'section',
  footer: 'footer',
  aside: 'aside',
  form: 'form',
};
const STRUCT_ROLES: Readonly<Record<string, LayoutBlockKind>> = {
  banner: 'header',
  navigation: 'nav',
  main: 'main',
  region: 'section',
  contentinfo: 'footer',
  complementary: 'aside',
  form: 'form',
};
const MEDIA_TAGS: Readonly<Record<string, LayoutBlockKind>> = { canvas: 'canvas', video: 'video', iframe: 'iframe' };
const BUTTON_INPUT_TYPES = ['submit', 'button', 'reset', 'image'];

/** 1 구조, 2 미디어, 3 heading, 4 button, 5 image, 6 input, 7 card, 8 text (16.1) */
type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface Candidate {
  el: CollectedElement;
  kind: LayoutBlockKind;
  rank: Rank;
  rect: Rect;
}

const area = (r: Rect) => r.width * r.height;
const roleOf = (el: CollectedElement) => el.sourceHints.stableAttributes.role?.trim().toLowerCase();

/** 공백을 하나로 줄이고 제어 문자를 지운 뒤 max(UTF-16 길이)를 넘으면 말줄임한다. 비면 undefined */
export function cleanLabel(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  if (text.length <= max) return text;
  let out = '';
  for (const ch of Array.from(text)) {
    if (out.length + ch.length > max - 1) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

function classify(el: CollectedElement, collected: CollectedViewport, lookup: ElementLookup): Candidate | null {
  const role = roleOf(el);
  const box = visibleRect(el, lookup);
  const layoutWidth = collected.layoutWidth;

  const structKind = STRUCT_TAGS[el.tag] ?? (role ? STRUCT_ROLES[role] : undefined);
  if (box && structKind && area(box) >= layoutWidth * LAYOUT_STRUCT_MIN_HEIGHT_PX) return { el, kind: structKind, rank: 1, rect: box };

  const mediaKind = MEDIA_TAGS[el.tag];
  if (box && mediaKind) return { el, kind: mediaKind, rank: 2, rect: box };

  if (box && (/^h[1-3]$/.test(el.tag) || role === 'heading')) return { el, kind: 'heading', rank: 3, rect: box };

  const inputType = el.layoutAttrs?.type;
  const bordered = isBorderedBox(el);
  if (box && (el.tag === 'button' || (el.tag === 'input' && inputType !== undefined && BUTTON_INPUT_TYPES.includes(inputType)))) {
    return { el, kind: 'button', rank: 4, rect: box };
  }
  const formControl = el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea';
  if (box && el.flags.interactive && !formControl && bordered && box.height <= LAYOUT_BUTTON_MAX_HEIGHT_PX) return { el, kind: 'button', rank: 4, rect: box };

  const isImage = el.tag === 'img' || el.tag === 'svg' || el.style.backgroundImage.includes('url(');
  if (box && isImage && area(box) >= LAYOUT_IMAGE_MIN_AREA_PX2) return { el, kind: 'image', rank: 5, rect: box };

  if (box && formControl && inputType !== 'hidden') {
    return { el, kind: 'input', rank: 6, rect: box };
  }

  if (box && bordered && area(box) >= layoutWidth * collected.viewportSize.height * LAYOUT_CARD_MIN_VIEWPORT_RATIO) {
    return { el, kind: 'card', rank: 7, rect: box };
  }

  if (el.textRects.length > 0) {
    const text = union(visibleTextRects(el, lookup));
    if (text && text.height >= LAYOUT_TEXT_MIN_HEIGHT_PX) return { el, kind: 'text', rank: 8, rect: text };
  }
  return null;
}

/** 문서 범위 [0, maxX] × [0, maxY] 안의 정수 rect. 비면 null */
function clampRect(r: Rect, maxX: number, maxY: number): Rect | null {
  const left = Math.max(0, Math.round(r.x));
  const top = Math.max(0, Math.round(r.y));
  const right = Math.min(maxX, Math.round(r.x + r.width));
  const bottom = Math.min(maxY, Math.round(r.y + r.height));
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

const near = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) <= LAYOUT_DEDUP_TOLERANCE_PX &&
  Math.abs(a.y - b.y) <= LAYOUT_DEDUP_TOLERANCE_PX &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= LAYOUT_DEDUP_TOLERANCE_PX &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= LAYOUT_DEDUP_TOLERANCE_PX;

/** 구조(1)와 미디어(2) 블록은 중복 제거로 지우지 않는다 */
const keepAlways = (c: Candidate) => c.rank <= 2;

/**
 * 부모와 크기가 거의 같은 블록(사방 4px 이내)은 하나만 남긴다(16.1).
 * 구조·미디어 블록은 항상 남긴다. 둘 다 아니면 순위가 높은 쪽, 같으면 바깥쪽을 남긴다.
 */
function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const kept = new Map<number, Candidate>();
  for (const c of candidates) {
    const parentIndex = c.el.ancestorIndices.find((i) => kept.has(i));
    const parent = parentIndex === undefined ? undefined : kept.get(parentIndex);
    if (parent && near(parent.rect, c.rect) && !(keepAlways(c) && keepAlways(parent))) {
      if (keepAlways(parent)) continue;
      if (keepAlways(c) || c.rank < parent.rank) kept.delete(parent.el.index);
      else continue;
    }
    kept.set(c.el.index, c);
  }
  // Map 순회 순서를 쓰지 않고 입력(문서) 순서로 다시 거른다
  return candidates.filter((c) => kept.get(c.el.index) === c);
}

function structLabel(c: Candidate, lookup: ElementLookup, position: number): string | undefined {
  const { el } = c;
  const name = STRUCT_TAGS[el.tag] ? el.tag : c.kind;
  const id = cleanLabel(el.identity.id, LAYOUT_LABEL_MAX);
  if (id) return cleanLabel(`${name}#${id}`, LAYOUT_LABEL_MAX);
  const aria = cleanLabel(el.sourceHints.stableAttributes['aria-label'], LAYOUT_LABEL_MAX);
  if (aria) return cleanLabel(`${name} "${aria}"`, LAYOUT_LABEL_MAX);
  // 후보는 문서 순서(preorder)라 자손이 바로 뒤에 이어진다
  for (let i = position + 1; i < lookup.sorted.length; i += 1) {
    const d = lookup.sorted[i];
    if (!isDescendantOf(d, el.index)) break;
    if (!d.flags.heading) continue;
    const text = cleanLabel(d.sourceHints.textSnippet, LAYOUT_HEADING_LABEL_MAX);
    if (text) return cleanLabel(`${name} "${text}"`, LAYOUT_LABEL_MAX);
  }
  return name;
}

function labelOf(c: Candidate, lookup: ElementLookup, position: number): string | undefined {
  const { el } = c;
  switch (c.kind) {
    case 'heading':
      return cleanLabel(el.sourceHints.textSnippet, LAYOUT_HEADING_LABEL_MAX);
    case 'button':
      return cleanLabel(el.sourceHints.textSnippet ?? el.sourceHints.stableAttributes['aria-label'], LAYOUT_SHORT_LABEL_MAX);
    case 'text':
    case 'card':
      return undefined;
    case 'image':
      return cleanLabel(el.layoutAttrs?.alt, LAYOUT_SHORT_LABEL_MAX) ?? '이미지';
    case 'canvas':
    case 'video':
      return c.kind;
    case 'iframe':
      return 'iframe (내부 미검사)';
    case 'input':
      return (
        cleanLabel(el.layoutAttrs?.placeholder, LAYOUT_SHORT_LABEL_MAX) ?? cleanLabel(el.sourceHints.stableAttributes.name, LAYOUT_SHORT_LABEL_MAX) ?? '입력'
      );
    default:
      return structLabel(c, lookup, position);
  }
}

/** DETECTION_RULES 16장: 수집한 후보 요소에서 페이지 구성 도면을 만든다. 순수 함수다 */
export function buildLayoutMap(collected: CollectedViewport, options: { maxBlocks?: number } = {}): LayoutMap {
  const maxBlocks = options.maxBlocks ?? LAYOUT_MAX_BLOCKS;
  const lookup = buildLookup(collected);
  const width = Math.round(collected.layoutWidth);
  const scrollWidth = Math.max(width, Math.round(collected.documentScrollWidth));
  const maxHeight = LAYOUT_MAX_HEIGHT[collected.viewport];
  const height = Math.min(Math.round(collected.documentHeight), maxHeight);
  let truncated = collected.documentHeight > maxHeight;

  const positions = new Map<number, number>();
  const candidates: Candidate[] = [];
  lookup.sorted.forEach((el, position) => {
    positions.set(el.index, position);
    const c = classify(el, collected, lookup);
    if (!c) return;
    const rect = clampRect(c.rect, scrollWidth, height);
    if (rect) candidates.push({ ...c, rect });
  });

  let selected = dedupe(candidates);
  if (selected.length > maxBlocks) {
    truncated = true;
    selected = [...selected]
      .sort((a, b) => a.rank - b.rank || area(b.rect) - area(a.rect) || a.el.index - b.el.index)
      .slice(0, maxBlocks)
      .sort((a, b) => a.el.index - b.el.index);
  }

  const structIndices = new Set(selected.filter((c) => c.rank === 1).map((c) => c.el.index));
  const blocks: LayoutBlock[] = selected.map((c) => {
    const label = labelOf(c, lookup, positions.get(c.el.index) ?? 0);
    const depth = c.el.ancestorIndices.filter((i) => structIndices.has(i)).length;
    return { kind: c.kind, rect: c.rect, ...(label !== undefined ? { label } : {}), depth };
  });

  return { width, scrollWidth, height, truncated, blocks };
}
