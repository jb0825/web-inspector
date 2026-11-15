import type { CollectedElement, CollectedViewport, LayoutCanvas } from '@/server/collect/types';
import { buildLookup, union, visibleRect, visibleTextRects, type ElementLookup } from '@/server/detect/geometry';
import { isBorderedBox } from '@/server/detect/textOverflow';
import type { LayoutBlock, LayoutBlockKind, LayoutMap, Rect } from '@/types/inspection';
import {
  LAYOUT_BUTTON_LABEL_MAX,
  LAYOUT_BUTTON_MAX_HEIGHT_PX,
  LAYOUT_CARD_MIN_VIEWPORT_RATIO,
  LAYOUT_DEDUP_TOLERANCE_PX,
  LAYOUT_HEADING_LABEL_MAX,
  LAYOUT_IMAGE_MIN_AREA_PX2,
  LAYOUT_LABEL_MAX,
  LAYOUT_MAX_BLOCKS,
  LAYOUT_MAX_HEIGHT,
  LAYOUT_SHORT_LABEL_MAX,
  LAYOUT_STRUCT_MERGE_MAX_NAMES,
  LAYOUT_STRUCT_MERGE_TOLERANCE_PX,
  LAYOUT_STRUCT_MIN_HEIGHT_PX,
  LAYOUT_TEXT_MIN_HEIGHT_PX,
} from './constants';

// 페이지 구성 도면 (DETECTION_RULES 16장). 수집한 후보 요소(CollectedViewport)와 배치도용 canvas만으로 만든다. 브라우저에서 새로 측정하지 않는다.
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
const MEDIA_TAGS: Readonly<Record<string, LayoutBlockKind>> = { video: 'video', iframe: 'iframe' };
const BUTTON_INPUT_TYPES = ['submit', 'button', 'reset', 'image'];

/** 1 구조, 2 미디어, 3 heading, 4 button, 5 image, 6 input, 7 card, 8 text (16.1) */
type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

interface Candidate {
  index: number;
  ancestorIndices: readonly number[];
  /** 배치도용 canvas(16.1)는 후보 요소가 아니라 없다 */
  el?: CollectedElement;
  kind: LayoutBlockKind;
  rank: Rank;
  rect: Rect;
}

const area = (r: Rect) => r.width * r.height;
const roleOf = (el: CollectedElement) => el.sourceHints.stableAttributes.role?.trim().toLowerCase();

/** display가 inline 계열(inline, inline-block, inline-flex …)이거나 contents. 값이 없으면 블록 레벨로 본다 */
export function isInlineLevel(el: CollectedElement): boolean {
  const display = el.computedStyle.display?.trim().toLowerCase() ?? '';
  return display === 'contents' || display.startsWith('inline');
}

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

/**
 * inline 레벨 후보의 보이는 텍스트 rect를 가장 가까운 블록 레벨 후보 조상(owner)에 모은다(16.1 text).
 * 조상 사슬이 끊기지 않고 inline만 이어질 때만 모은다. preorder라 부모를 먼저 본다.
 */
function inlineTextByOwner(lookup: ElementLookup): Map<number, Rect[]> {
  const ownerOf = new Map<number, number | null>();
  const byOwner = new Map<number, Rect[]>();
  for (const el of lookup.sorted) {
    if (!isInlineLevel(el)) continue;
    const parent = el.parentIndex === null ? undefined : lookup.get(el.parentIndex);
    const owner = parent === undefined ? null : isInlineLevel(parent) ? (ownerOf.get(parent.index) ?? null) : parent.index;
    ownerOf.set(el.index, owner);
    if (owner === null || el.textRects.length === 0) continue;
    const rects = visibleTextRects(el, lookup);
    if (rects.length === 0) continue;
    const list = byOwner.get(owner);
    if (list) list.push(...rects);
    else byOwner.set(owner, [...rects]);
  }
  return byOwner;
}

function classify(el: CollectedElement, collected: CollectedViewport, lookup: ElementLookup, inlineText: Map<number, Rect[]>): Candidate | null {
  const role = roleOf(el);
  const box = visibleRect(el, lookup);
  const layoutWidth = collected.layoutWidth;
  const base = { index: el.index, ancestorIndices: el.ancestorIndices, el };

  const structKind = STRUCT_TAGS[el.tag] ?? (role ? STRUCT_ROLES[role] : undefined);
  if (box && structKind && area(box) >= layoutWidth * LAYOUT_STRUCT_MIN_HEIGHT_PX) return { ...base, kind: structKind, rank: 1, rect: box };

  // canvas는 후보 요소가 아니라 배치도용 canvas(layoutCanvases)로만 만든다(16.1). 후보이기도 하면 겹치지 않게 여기서 뺀다
  if (el.tag === 'canvas') return null;
  const mediaKind = MEDIA_TAGS[el.tag];
  if (box && mediaKind) return { ...base, kind: mediaKind, rank: 2, rect: box };

  if (box && (/^h[1-3]$/.test(el.tag) || role === 'heading')) return { ...base, kind: 'heading', rank: 3, rect: box };

  const inputType = el.layoutAttrs?.type;
  const bordered = isBorderedBox(el);
  if (box && (el.tag === 'button' || (el.tag === 'input' && inputType !== undefined && BUTTON_INPUT_TYPES.includes(inputType)))) {
    return { ...base, kind: 'button', rank: 4, rect: box };
  }
  const formControl = el.tag === 'input' || el.tag === 'select' || el.tag === 'textarea';
  if (box && el.flags.interactive && !formControl && bordered && box.height <= LAYOUT_BUTTON_MAX_HEIGHT_PX) return { ...base, kind: 'button', rank: 4, rect: box };

  const isImage = el.tag === 'img' || el.tag === 'svg' || el.style.backgroundImage.includes('url(');
  if (box && isImage && area(box) >= LAYOUT_IMAGE_MIN_AREA_PX2) return { ...base, kind: 'image', rank: 5, rect: box };

  if (box && formControl && inputType !== 'hidden') {
    return { ...base, kind: 'input', rank: 6, rect: box };
  }

  if (box && bordered && area(box) >= layoutWidth * collected.viewportSize.height * LAYOUT_CARD_MIN_VIEWPORT_RATIO) {
    return { ...base, kind: 'card', rank: 7, rect: box };
  }

  // text는 블록 레벨 요소에서만 만든다. 영역은 자신과 inline 자손의 보이는 텍스트 rect 합집합이다(글자·단어 단위로 쪼갠 span 대비)
  if (!isInlineLevel(el)) {
    const text = union([...visibleTextRects(el, lookup), ...(inlineText.get(el.index) ?? [])]);
    if (text && text.height >= LAYOUT_TEXT_MIN_HEIGHT_PX) return { ...base, kind: 'text', rank: 8, rect: text };
  }
  return null;
}

function canvasCandidate(canvas: LayoutCanvas): Candidate {
  return { index: canvas.index, ancestorIndices: canvas.ancestorIndices, kind: 'canvas', rank: 2, rect: canvas.rect };
}

/** 문서 범위 [0, maxX] × [0, maxY] 안의 정수 rect. 비면 null */
function clampRect(r: Rect, maxX: number, maxY: number): Rect | null {
  const left = Math.max(0, Math.round(r.x));
  const top = Math.max(0, Math.round(r.y));
  const right = Math.min(maxX, Math.round(r.x + r.width));
  const bottom = Math.min(maxY, Math.round(r.y + r.height));
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

const nearWithin = (a: Rect, b: Rect, tolerance: number) =>
  Math.abs(a.x - b.x) <= tolerance &&
  Math.abs(a.y - b.y) <= tolerance &&
  Math.abs(a.x + a.width - (b.x + b.width)) <= tolerance &&
  Math.abs(a.y + a.height - (b.y + b.height)) <= tolerance;

/** 구조(1)와 미디어(2) 블록은 중복 제거로 지우지 않는다 */
const keepAlways = (c: Candidate) => c.rank <= 2;

/** 자손 중복을 막는 종류 (16.1): heading·button·input 안에서는 heading·button·input·text를, text 안에서는 text를 만들지 않는다 */
const STRONG_CLAIM: ReadonlySet<LayoutBlockKind> = new Set(['heading', 'button', 'input']);

/**
 * 부모와 크기가 거의 같은 블록(사방 4px 이내)은 하나만 남긴다(16.1).
 * 구조·미디어 블록은 항상 남긴다. 둘 다 아니면 순위가 높은 쪽, 같으면 바깥쪽을 남긴다.
 */
function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const kept = new Map<number, Candidate>();
  for (const c of candidates) {
    const parentIndex = c.ancestorIndices.find((i) => kept.has(i));
    const parent = parentIndex === undefined ? undefined : kept.get(parentIndex);
    if (parent && nearWithin(parent.rect, c.rect, LAYOUT_DEDUP_TOLERANCE_PX) && !(keepAlways(c) && keepAlways(parent))) {
      if (keepAlways(parent)) continue;
      if (keepAlways(c) || c.rank < parent.rank) kept.delete(parent.index);
      else continue;
    }
    kept.set(c.index, c);
  }
  // Map 순회 순서를 쓰지 않고 입력(문서) 순서로 다시 거른다
  return candidates.filter((c) => kept.get(c.index) === c);
}

/** 구조 블록 하나의 이름: `태그#id` → `태그 "aria-label"` → `태그`. role로 판정했으면 태그 대신 kind (16.2) */
function structName(c: Candidate): string {
  const el = c.el;
  if (!el) return c.kind;
  const name = STRUCT_TAGS[el.tag] ? el.tag : c.kind;
  const id = cleanLabel(el.identity.id, LAYOUT_LABEL_MAX);
  if (id) return cleanLabel(`${name}#${id}`, LAYOUT_LABEL_MAX) ?? name;
  const aria = cleanLabel(el.sourceHints.stableAttributes['aria-label'], LAYOUT_LABEL_MAX);
  if (aria) return cleanLabel(`${name} "${aria}"`, LAYOUT_LABEL_MAX) ?? name;
  return name;
}

interface Selected extends Candidate {
  /** 합친 구조 블록의 이름 (바깥쪽부터). 구조 블록만 있다 */
  structNames?: string[];
}

/**
 * 가장 가까운 남은 구조 조상과 사방 LAYOUT_STRUCT_MERGE_TOLERANCE_PX 이내로 같은 크기인 구조 블록은 그 조상에 합친다(16.1).
 * 남은 블록은 바깥쪽이고, label은 `main · section`처럼 이름을 묶는다(16.2).
 */
function mergeStructs(candidates: readonly Candidate[]): Selected[] {
  const heads = new Map<number, Selected>();
  const out: Selected[] = [];
  for (const c of candidates) {
    if (c.rank !== 1) {
      out.push(c);
      continue;
    }
    const headIndex = c.ancestorIndices.find((i) => heads.has(i));
    const head = headIndex === undefined ? undefined : heads.get(headIndex);
    if (head && nearWithin(head.rect, c.rect, LAYOUT_STRUCT_MERGE_TOLERANCE_PX)) {
      head.structNames?.push(structName(c));
      // 합친 블록의 자손도 같은 head를 찾도록 index를 head에 묶는다
      heads.set(c.index, head);
      continue;
    }
    const selected: Selected = { ...c, structNames: [structName(c)] };
    heads.set(c.index, selected);
    out.push(selected);
  }
  return out;
}

function structLabel(names: readonly string[]): string | undefined {
  const shown = names.slice(0, LAYOUT_STRUCT_MERGE_MAX_NAMES).join(' · ');
  const rest = names.length - LAYOUT_STRUCT_MERGE_MAX_NAMES;
  return cleanLabel(rest > 0 ? `${shown} +${rest}` : shown, LAYOUT_LABEL_MAX);
}

function labelOf(c: Selected): string | undefined {
  const { el } = c;
  if (c.rank === 1) return structLabel(c.structNames ?? [c.kind]);
  switch (c.kind) {
    case 'heading':
      // aria-label → innerText → textSnippet. textSnippet은 <br>로 나눈 줄 사이 공백이 사라지고 숨긴 텍스트(반응형 사본)까지 붙는다
      return (
        cleanLabel(el?.sourceHints.stableAttributes['aria-label'], LAYOUT_HEADING_LABEL_MAX) ??
        cleanLabel(el?.layoutAttrs?.text, LAYOUT_HEADING_LABEL_MAX) ??
        cleanLabel(el?.sourceHints.textSnippet, LAYOUT_HEADING_LABEL_MAX)
      );
    case 'button':
      return cleanLabel(el?.sourceHints.stableAttributes['aria-label'], LAYOUT_BUTTON_LABEL_MAX) ?? cleanLabel(el?.sourceHints.textSnippet, LAYOUT_BUTTON_LABEL_MAX);
    case 'text':
    case 'card':
      return undefined;
    case 'image':
      return cleanLabel(el?.layoutAttrs?.alt, LAYOUT_SHORT_LABEL_MAX) ?? '이미지';
    case 'canvas':
    case 'video':
      return c.kind;
    case 'iframe':
      return 'iframe (내부 미검사)';
    case 'input':
      return (
        cleanLabel(el?.layoutAttrs?.placeholder, LAYOUT_SHORT_LABEL_MAX) ?? cleanLabel(el?.sourceHints.stableAttributes.name, LAYOUT_SHORT_LABEL_MAX) ?? '입력'
      );
    default:
      return undefined;
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
  const inlineText = inlineTextByOwner(lookup);

  const raw: Candidate[] = [];
  for (const el of lookup.sorted) {
    const c = classify(el, collected, lookup, inlineText);
    if (c) raw.push(c);
  }
  for (const canvas of collected.layoutCanvases) raw.push(canvasCandidate(canvas));
  raw.sort((a, b) => a.index - b.index);

  // 자손 중복 막기 (16.1). 이미 고른 heading·button·input·text의 자손은 문서 순서상 뒤에 온다
  const strongClaim = new Set<number>();
  const textClaim = new Set<number>();
  const candidates: Candidate[] = [];
  for (const c of raw) {
    const underStrong = c.ancestorIndices.some((i) => strongClaim.has(i));
    if (underStrong && (STRONG_CLAIM.has(c.kind) || c.kind === 'text')) continue;
    if (c.kind === 'text' && c.ancestorIndices.some((i) => textClaim.has(i))) continue;
    const rect = clampRect(c.rect, scrollWidth, height);
    if (!rect) continue;
    if (STRONG_CLAIM.has(c.kind)) strongClaim.add(c.index);
    else if (c.kind === 'text') textClaim.add(c.index);
    candidates.push({ ...c, rect });
  }

  let selected = mergeStructs(dedupe(candidates));
  if (selected.length > maxBlocks) {
    truncated = true;
    selected = [...selected]
      .sort((a, b) => a.rank - b.rank || area(b.rect) - area(a.rect) || a.index - b.index)
      .slice(0, maxBlocks)
      .sort((a, b) => a.index - b.index);
  }

  const structIndices = new Set(selected.filter((c) => c.rank === 1).map((c) => c.index));
  const blocks: LayoutBlock[] = selected.map((c) => {
    const label = labelOf(c);
    const depth = c.ancestorIndices.filter((i) => structIndices.has(i)).length;
    return { kind: c.kind, rect: c.rect, ...(label !== undefined ? { label } : {}), depth };
  });

  return { width, scrollWidth, height, truncated, blocks };
}
