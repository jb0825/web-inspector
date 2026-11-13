import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import type { Rect } from '@/types/inspection';
import { TOLERANCE_PX } from './constants';

// 보이는 영역 계산과 rect 기본 연산 (DETECTION_RULES 3.6). 순수 함수만 둔다.

// ── rect 기본 연산 ──

export const right = (r: Rect): number => r.x + r.width;
export const bottom = (r: Rect): number => r.y + r.height;
export const area = (r: Rect): number => Math.max(0, r.width) * Math.max(0, r.height);
export const totalArea = (rects: readonly Rect[]): number => rects.reduce((sum, r) => sum + area(r), 0);

/** 교집합. 너비나 높이가 0 이하이면 null */
export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(right(a), right(b)) - x;
  const height = Math.min(bottom(a), bottom(b)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

/** 모든 rect를 감싸는 가장 작은 rect. 빈 배열이면 null */
export function union(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    r = Math.max(r, right(rect));
    b = Math.max(b, bottom(rect));
  }
  return { x: left, y: top, width: r - left, height: b - top };
}

/** outer가 inner를 포함한다. PRD 5.3.1의 1px 허용치를 둔다 */
export function contains(outer: Rect, inner: Rect, tolerance: number = TOLERANCE_PX): boolean {
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    right(inner) <= right(outer) + tolerance &&
    bottom(inner) <= bottom(outer) + tolerance
  );
}

// ── 요소 조회 ──

export interface ElementLookup {
  /** index 오름차순(문서 순서). 입력 배열의 순서와 관계없다 */
  readonly sorted: readonly CollectedElement[];
  get(index: number): CollectedElement | undefined;
}

// 같은 CollectedViewport에 대해 세 탐지 함수가 조회 구조를 한 번만 만들도록 기억한다.
// WeakMap은 순회하지 않으므로 출력 순서에 영향을 주지 않는다(DETECTION_RULES 11장).
const lookupCache = new WeakMap<CollectedViewport, ElementLookup>();

export function buildLookup(collected: CollectedViewport): ElementLookup {
  const cached = lookupCache.get(collected);
  if (cached) return cached;
  const sorted = [...collected.elements].sort((a, b) => a.index - b.index);
  const byIndex = new Map<number, CollectedElement>();
  for (const el of sorted) byIndex.set(el.index, el);
  const lookup: ElementLookup = { sorted, get: (index) => byIndex.get(index) };
  lookupCache.set(collected, lookup);
  return lookup;
}

/** el이 ancestor의 (후보) 자손이다 */
export function isDescendantOf(el: CollectedElement, ancestorIndex: number): boolean {
  return el.ancestorIndices.includes(ancestorIndex);
}

/** 후보 조상 목록 (가까운 순). 조회되지 않는 index는 건너뛴다(잘린 후보 등) */
export function ancestorsOf(el: CollectedElement, lookup: ElementLookup): CollectedElement[] {
  const out: CollectedElement[] = [];
  for (const index of el.ancestorIndices) {
    const ancestor = lookup.get(index);
    if (ancestor) out.push(ancestor);
  }
  return out;
}

// ── 보이는 영역 (DETECTION_RULES 3.6) ──

/**
 * 잘라 낼 요소 목록 (가까운 순).
 * position: fixed인 요소(자신 포함)를 만나면 그 요소까지만 포함하고 멈춘다. fixed 요소는 조상의 overflow에 잘리지 않는다.
 */
export function clipChain(el: CollectedElement, includeSelf: boolean, lookup: ElementLookup): CollectedElement[] {
  const chain: CollectedElement[] = [];
  if (includeSelf) chain.push(el);
  if (el.style.position === 'fixed') return chain;
  for (const ancestor of ancestorsOf(el, lookup)) {
    chain.push(ancestor);
    if (ancestor.style.position === 'fixed') break;
  }
  return chain;
}

/** 체인의 각 요소가 overflow가 visible이 아닌 축에서 rect를 paddingBox로 자른다. 비게 된 rect는 버린다. */
export function clipRects(rects: readonly Rect[], chain: readonly CollectedElement[]): Rect[] {
  const out: Rect[] = [];
  for (const rect of rects) {
    let left = rect.x;
    let top = rect.y;
    let r = right(rect);
    let b = bottom(rect);
    for (const c of chain) {
      if (c.style.overflowX !== 'visible') {
        left = Math.max(left, c.paddingBox.x);
        r = Math.min(r, right(c.paddingBox));
      }
      if (c.style.overflowY !== 'visible') {
        top = Math.max(top, c.paddingBox.y);
        b = Math.min(b, bottom(c.paddingBox));
      }
    }
    if (r - left > 0 && b - top > 0) out.push({ x: left, y: top, width: r - left, height: b - top });
  }
  return out;
}

export function visibleTextRects(el: CollectedElement, lookup: ElementLookup): Rect[] {
  return clipRects(el.textRects, clipChain(el, true, lookup));
}

/** 요소 자신의 overflow는 자기 border box를 자르지 않는다 */
export function visibleRect(el: CollectedElement, lookup: ElementLookup): Rect | null {
  return clipRects([el.rect], clipChain(el, false, lookup))[0] ?? null;
}
