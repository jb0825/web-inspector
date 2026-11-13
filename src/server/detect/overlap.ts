import 'server-only';
import { roundMeasure } from '@/server/collect/round';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import type { Rect } from '@/types/inspection';
import {
  ABSOLUTE_IN_PARENT_CONFIDENCE,
  DEFAULT_CONFIDENCE,
  MAX_OVERLAP_TARGETS,
  OVERLAP_MIN_AREA_PX2,
  OVERLAP_MIN_RATIO,
  OVERLAY_MIN_VIEWPORT_RATIO,
} from './constants';
import {
  area,
  bottom,
  buildLookup,
  clipChain,
  clipRects,
  contains,
  intersect,
  isDescendantOf,
  right,
  totalArea,
  visibleRect,
  type ElementLookup,
} from './geometry';
import { compareRawIssues, type OverlapIssue, type SubtypeByType } from './types';

// Element Overlap (PRD 5.3.3, DETECTION_RULES 5장)

const MEDIA_TAGS = ['img', 'video', 'canvas'];

interface Item {
  el: CollectedElement;
  rects: Rect[];
  area: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  // 쌍마다 다시 계산하지 않도록 요소별 값을 미리 구해 둔다(최악의 경우 쌍 수백만 개, 5.4)
  /** 제외 조건 2의 포함하는 쪽 박스. 미디어나 배경 이미지가 아니면 null */
  overlayBox: Rect | null;
  interactiveArea: boolean;
  absoluteInParent: boolean;
}

const isTextElement = (el: CollectedElement): boolean => el.textRects.length > 0;
const isMedia = (el: CollectedElement): boolean => MEDIA_TAGS.includes(el.tag);

/** 'normal'이거나 px 숫자로 바꿀 수 없으면 null (보정하지 않음) */
export function parseLineHeightPx(value: string): number | null {
  const match = value.trim().match(/^(-?[0-9.]+)px$/);
  if (!match) return null;
  const px = parseFloat(match[1]);
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** DETECTION_RULES 5.2: 글꼴의 위아래 여백 때문에 인접한 줄이 겹쳐 보이지 않도록 rect를 line box 높이로 줄인다 */
export function correctLineHeight(rect: Rect, lineHeight: string): Rect {
  const px = parseLineHeightPx(lineHeight);
  if (px === null || rect.height <= px) return { ...rect };
  return { x: rect.x, y: rect.y + (rect.height - px) / 2, width: rect.width, height: px };
}

/** DETECTION_RULES 5.3 */
function findOverlays(c: CollectedViewport, lookup: ElementLookup): CollectedElement[] {
  // 3.1.1: innerWidth/innerHeight가 아니라 layoutWidth × 설정 height
  const viewportArea = c.layoutWidth * c.viewportSize.height;
  if (viewportArea <= 0) return [];
  return lookup.sorted.filter((el) => el.flags.fixedRoot && area(el.rect) / viewportArea >= OVERLAY_MIN_VIEWPORT_RATIO);
}

/** 자신 또는 후보 조상 중 하나가 인터랙티브 (DETECTION_RULES 3.3) */
function inInteractiveArea(el: CollectedElement, lookup: ElementLookup): boolean {
  if (el.flags.interactive) return true;
  return el.ancestorIndices.some((index) => lookup.get(index)?.flags.interactive === true);
}

/**
 * DETECTION_RULES 5.1: 다른 비교 대상을 자손으로 갖지 않는 요소(말단).
 * 인터랙티브 요소는 자손이 텍스트 요소뿐이면 대상에 넣는다.
 */
function comparisonTargets(lookup: ElementLookup): CollectedElement[] {
  const isBase = (el: CollectedElement) => isTextElement(el) || el.flags.interactive || isMedia(el);
  // 후보 자손에 기본 대상이 있는지, 텍스트 요소가 아닌(인터랙티브, 미디어) 기본 대상이 있는지
  const hasBaseDescendant = new Set<number>();
  const hasNonTextDescendant = new Set<number>();
  for (const el of lookup.sorted) {
    if (!isBase(el)) continue;
    const nonText = el.flags.interactive || isMedia(el);
    for (const ancestor of el.ancestorIndices) {
      hasBaseDescendant.add(ancestor);
      if (nonText) hasNonTextDescendant.add(ancestor);
    }
  }
  return lookup.sorted.filter((el) => {
    if (!isBase(el)) return false;
    if (!hasBaseDescendant.has(el.index)) return true;
    return el.flags.interactive && !hasNonTextDescendant.has(el.index);
  });
}

/** DETECTION_RULES 5.1 영역 */
function regionOf(el: CollectedElement, lookup: ElementLookup): Rect[] {
  if (isTextElement(el) && !el.flags.interactive) {
    const corrected = el.textRects.map((rect) => correctLineHeight(rect, el.style.lineHeight));
    return clipRects(corrected, clipChain(el, true, lookup));
  }
  const visible = visibleRect(el, lookup);
  return visible ? [visible] : [];
}

function toItem(el: CollectedElement, rects: Rect[], lookup: ElementLookup): Item {
  const canContain = isMedia(el) || el.style.backgroundImage !== 'none';
  return {
    el,
    rects,
    area: totalArea(rects),
    top: Math.min(...rects.map((r) => r.y)),
    bottom: Math.max(...rects.map(bottom)),
    left: Math.min(...rects.map((r) => r.x)),
    right: Math.max(...rects.map(right)),
    // 포함하는 쪽은 잘린 뒤의 박스(visibleRect)로 본다(5.5)
    overlayBox: canContain ? visibleRect(el, lookup) : null,
    interactiveArea: inInteractiveArea(el, lookup),
    absoluteInParent: isAbsoluteInParent(el, lookup),
  };
}

function isOverlayOrDescendant(el: CollectedElement, overlayIndices: ReadonlySet<number>): boolean {
  return overlayIndices.has(el.index) || el.ancestorIndices.some((index) => overlayIndices.has(index));
}

/** 제외 조건 2: container가 other의 영역 전체를 포함하고 미디어이거나 배경 이미지가 있음 */
function isIntendedOverlay(container: Item, other: Item): boolean {
  // 포함하는 쪽은 잘린 뒤의 박스(visibleRect, toItem), 포함되는 쪽은 5.1의 영역(자른 뒤)으로 본다.
  const box = container.overlayBox;
  return box !== null && other.rects.every((rect) => contains(box, rect));
}

/** DETECTION_RULES 5.5: 순서대로 확인하고 하나라도 맞으면 제외 */
function excluded(a: Item, b: Item, overlayIndices: ReadonlySet<number>): boolean {
  // 1. PRD 5.3.3: 조상과 자손 관계
  if (isDescendantOf(a.el, b.el.index) || isDescendantOf(b.el, a.el.index)) return true;
  // 2. PRD 5.3.3: 의도된 오버레이 (Hero 이미지 위의 텍스트 등)
  if (isIntendedOverlay(a, b) || isIntendedOverlay(b, a)) return true;
  // 3. PRD 5.3.3: fixed/sticky와 일반 흐름 요소의 겹침은 스크롤에 따라 달라진다 (둘 다 fixed/sticky면 비교)
  if (a.el.flags.fixedOrSticky !== b.el.flags.fixedOrSticky) return true;
  // 4. PRD 5.3.3: 30% 이상을 덮는 overlay와 그 자손
  if (isOverlayOrDescendant(a.el, overlayIndices) || isOverlayOrDescendant(b.el, overlayIndices)) return true;
  return false;
}

function intersectionArea(a: Item, b: Item): number {
  let sum = 0;
  for (const ra of a.rects) {
    for (const rb of b.rects) {
      const overlap = intersect(ra, rb);
      if (overlap) sum += area(overlap);
    }
  }
  return sum;
}

function subtypeOf(a: Item, b: Item): SubtypeByType['element-overlap'] {
  if (a.interactiveArea && b.interactiveArea) return 'interactive';
  if (isTextElement(a.el) && isTextElement(b.el) && !a.interactiveArea && !b.interactiveArea) return 'text';
  return 'other';
}

/** PRD 5.3.3: 부모 컨테이너 안의 absolute 요소 */
function isAbsoluteInParent(el: CollectedElement, lookup: ElementLookup): boolean {
  if (el.style.position !== 'absolute' || el.parentIndex === null) return false;
  const parent = lookup.get(el.parentIndex);
  return parent !== undefined && contains(parent.rect, el.rect);
}

export function detectOverlap(c: CollectedViewport): { issues: OverlapIssue[]; overlaysDetected: string[] } {
  const lookup = buildLookup(c);
  const overlays = findOverlays(c, lookup);
  const overlayIndices = new Set(overlays.map((el) => el.index));

  const items: Item[] = [];
  for (const el of comparisonTargets(lookup)) {
    if (isOverlayOrDescendant(el, overlayIndices)) continue; // DETECTION_RULES 5.3: overlay와 그 자손은 비교 대상이 아니다
    const rects = regionOf(el, lookup);
    if (rects.length === 0) continue; // DETECTION_RULES 5.1: 보이지 않는 요소
    items.push(toItem(el, rects, lookup));
  }

  // DETECTION_RULES 5.4: (top, index) 오름차순 sweep.
  // 쌍 목록을 쌓지 않고 (대상 요소 a, subtype)별로 상위 MAX_OVERLAP_TARGETS개 쌍과 전체 개수만 유지한다(5.6).
  items.sort((x, y) => (x.top !== y.top ? x.top - y.top : x.el.index - y.el.index));
  const groups = new Map<string, OverlapGroup>();
  let active: Item[] = [];
  for (const current of items) {
    active = active.filter((item) => item.bottom > current.top);
    for (const other of active) {
      if (other.right <= current.left || current.right <= other.left) continue;
      if (excluded(current, other, overlayIndices)) continue;
      const overlapArea = intersectionArea(current, other);
      if (overlapArea <= 0) continue;
      const smaller = Math.min(current.area, other.area);
      if (overlapArea < OVERLAP_MIN_AREA_PX2 && overlapArea < smaller * OVERLAP_MIN_RATIO) continue;

      // 대상은 문서 순서가 앞인 요소 a (DETECTION_RULES 5.6)
      const [a, b] = current.el.index < other.el.index ? [current, other] : [other, current];
      const subtype = subtypeOf(a, b);
      let confidence = DEFAULT_CONFIDENCE;
      // PRD 5.3.3 예외: 인터랙티브끼리는 낮추지 않는다
      if (subtype !== 'interactive' && (a.absoluteInParent || b.absoluteInParent)) {
        confidence = ABSOLUTE_IN_PARENT_CONFIDENCE;
      }
      addToGroup(groups, a.el, subtype, {
        index: b.el.index,
        area: overlapArea,
        ratioPercent: smaller > 0 ? (overlapArea / smaller) * 100 : 0,
        confidence,
      });
    }
    active.push(current);
  }

  const issues = [...groups.values()].map((group): OverlapIssue => {
    const representative = group.targets[0];
    return {
      viewport: c.viewport,
      type: 'element-overlap',
      subtype: group.subtype,
      elementIndex: group.el.index,
      relatedIndex: representative.index,
      boundingBox: { ...group.el.rect }, // DETECTION_RULES 5.6: 마커가 요소 위치를 가리키게 한다
      measured: {
        intersectionArea: roundMeasure(representative.area),
        overlapRatioPercent: roundMeasure(representative.ratioPercent),
        overlapTargetCount: group.count,
      },
      expected: {
        minRatioPercent: roundMeasure(OVERLAP_MIN_RATIO * 100),
        minAreaPx2: OVERLAP_MIN_AREA_PX2,
      },
      delta: {},
      relatedElements: group.targets.map((target) => ({ role: 'overlap-target', index: target.index })),
      // 측정값과 같은 쌍의 값을 쓴다(Evidence 문장과 Confidence가 같은 쌍을 가리키게)
      confidence: representative.confidence,
    };
  });

  // Map 순회 순서가 아니라 명시적인 키로 정렬한다(DETECTION_RULES 11장)
  issues.sort(compareRawIssues);
  return { issues, overlaysDetected: overlays.map((el) => el.selector) };
}

interface OverlapTarget {
  index: number;
  area: number;
  ratioPercent: number;
  confidence: number;
}

interface OverlapGroup {
  el: CollectedElement;
  subtype: SubtypeByType['element-overlap'];
  /** 교차 면적 내림차순, 같으면 index 오름차순. 최대 MAX_OVERLAP_TARGETS개 */
  targets: OverlapTarget[];
  /** 전체 상대 요소 수 */
  count: number;
}

/** 대표 상대 요소: 교차 면적이 가장 큰 것, 같으면 index가 작은 것 */
function compareTargets(x: OverlapTarget, y: OverlapTarget): number {
  return x.area !== y.area ? y.area - x.area : x.index - y.index;
}

function addToGroup(
  groups: Map<string, OverlapGroup>,
  el: CollectedElement,
  subtype: SubtypeByType['element-overlap'],
  target: OverlapTarget,
): void {
  const key = `${el.index}|${subtype}`;
  let group = groups.get(key);
  if (!group) {
    group = { el, subtype, targets: [], count: 0 };
    groups.set(key, group);
  }
  group.count += 1;
  // 상위 MAX_OVERLAP_TARGETS개만 정렬된 상태로 유지한다. 가득 찼고 마지막보다 뒤면 넣지 않는다
  const { targets } = group;
  if (targets.length === MAX_OVERLAP_TARGETS && compareTargets(target, targets[targets.length - 1]) >= 0) return;
  let at = targets.length;
  while (at > 0 && compareTargets(target, targets[at - 1]) < 0) at -= 1;
  targets.splice(at, 0, target);
  if (targets.length > MAX_OVERLAP_TARGETS) targets.length = MAX_OVERLAP_TARGETS;
}
