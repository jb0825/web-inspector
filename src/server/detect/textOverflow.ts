import 'server-only';
import { roundMeasure } from '@/server/collect/round';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import type { Rect } from '@/types/inspection';
import { DEFAULT_CONFIDENCE, TOLERANCE_PX } from './constants';
import { ancestorsOf, bottom, buildLookup, isDescendantOf, right, union, type ElementLookup } from './geometry';
import { compareRawIssues, type TextOverflowIssue } from './types';

// Text Overflow (PRD 5.3.2, DETECTION_RULES 4장)

const CLIPPING_OVERFLOW = ['hidden', 'clip'];

/** PRD 5.3.2: ellipsis와 line-clamp는 의도된 잘림 */
export function isIntentionalTruncation(el: CollectedElement): boolean {
  return el.style.textOverflow === 'ellipsis' || (el.style.webkitLineClamp !== 'none' && el.style.webkitLineClamp !== '');
}

/** 'transparent', rgba(…, 0), rgb(… / 0) */
export function isTransparentColor(color: string): boolean {
  const value = color.trim().toLowerCase();
  if (value === 'transparent' || value === '') return true;
  const alpha = value.match(/^rgba?\(.*[,/]\s*([0-9.]+%?)\s*\)$/);
  if (!alpha) return false;
  return parseFloat(alpha[1]) === 0;
}

/** DETECTION_RULES 3.3: 테두리 박스 */
export function isBorderedBox(el: CollectedElement): boolean {
  return (
    !isTransparentColor(el.style.backgroundColor) ||
    el.style.backgroundImage !== 'none' ||
    el.style.borderWidthSum > 0 ||
    el.style.paddingSum > 0
  );
}

/** el 바로 뒤에 이어지는 후보 자손. 후보는 문서 순서(preorder)라 자손이 연속해서 나온다. */
function descendantsOf(el: CollectedElement, position: number, lookup: ElementLookup): CollectedElement[] {
  const out: CollectedElement[] = [];
  for (let i = position + 1; i < lookup.sorted.length; i += 1) {
    const candidate = lookup.sorted[i];
    if (!isDescendantOf(candidate, el.index)) break;
    out.push(candidate);
  }
  return out;
}

interface ClippedCandidate {
  el: CollectedElement;
  axes: ('x' | 'y')[];
  /** 넘친 텍스트 rect를 가진 요소의 index */
  owners: number[];
}

function outsideOnAxis(rect: Rect, box: Rect, axis: 'x' | 'y'): boolean {
  if (axis === 'x') return rect.x < box.x - TOLERANCE_PX || right(rect) > right(box) + TOLERANCE_PX;
  return rect.y < box.y - TOLERANCE_PX || bottom(rect) > bottom(box) + TOLERANCE_PX;
}

function findClippedCandidates(lookup: ElementLookup): ClippedCandidate[] {
  const out: ClippedCandidate[] = [];
  lookup.sorted.forEach((el, position) => {
    if (isIntentionalTruncation(el)) return; // PRD 5.3.2: 의도된 잘림 제외
    const axes: ('x' | 'y')[] = [];
    // overflow auto/scroll은 걸리지 않는다. PRD 5.3.2: 스크롤 영역 제외
    if (CLIPPING_OVERFLOW.includes(el.style.overflowX) && el.scrollWidth > el.clientWidth + TOLERANCE_PX) axes.push('x');
    if (CLIPPING_OVERFLOW.includes(el.style.overflowY) && el.scrollHeight > el.clientHeight + TOLERANCE_PX) axes.push('y');
    if (axes.length === 0) return;

    // 잘리기 전 원시 textRects를 쓴다(DETECTION_RULES 3.6: clipped에는 보이는 영역을 적용하지 않는다).
    const owners: number[] = [];
    for (const owner of [el, ...descendantsOf(el, position, lookup)]) {
      for (const rect of owner.textRects) {
        if (axes.some((axis) => outsideOnAxis(rect, el.paddingBox, axis))) owners.push(owner.index);
      }
    }
    if (owners.length === 0) return; // PRD 5.3.2: 텍스트가 아닌 넘침(이미지 등) 제외
    out.push({ el, axes, owners });
  });
  return out;
}

/**
 * 가장 깊은 요소만 보고한다(DETECTION_RULES 4.1): 넘친 텍스트가 모두 el의 자손 중 다른 clipped 요소
 * (또는 그 자손)에 속하면 el은 보고하지 않는다.
 */
function isShadowedByDeeper(candidate: ClippedCandidate, clippedIndices: ReadonlySet<number>, lookup: ElementLookup): boolean {
  const self = candidate.el.index;
  return candidate.owners.every((ownerIndex) => {
    if (ownerIndex === self) return false;
    if (clippedIndices.has(ownerIndex)) return true;
    const owner = lookup.get(ownerIndex);
    if (!owner) return false;
    // ancestorIndices는 가까운 순이다. el보다 가까운 조상만 el의 자손이다.
    for (const ancestor of owner.ancestorIndices) {
      if (ancestor === self) return false;
      if (clippedIndices.has(ancestor)) return true;
    }
    return false;
  });
}

function clippedIssue(c: CollectedViewport, candidate: ClippedCandidate): TextOverflowIssue {
  const { el, axes } = candidate;
  const measured: Record<string, number> = {};
  const expected: Record<string, number> = {};
  const delta: Record<string, number> = {};
  if (axes.includes('x')) {
    measured.scrollWidth = el.scrollWidth;
    expected.clientWidth = el.clientWidth;
    delta.overflowX = roundMeasure(el.scrollWidth - el.clientWidth);
  }
  if (axes.includes('y')) {
    measured.scrollHeight = el.scrollHeight;
    expected.clientHeight = el.clientHeight;
    delta.overflowY = roundMeasure(el.scrollHeight - el.clientHeight);
  }
  return {
    viewport: c.viewport,
    type: 'text-overflow',
    subtype: 'clipped',
    elementIndex: el.index,
    boundingBox: { ...el.rect },
    axes: [...axes],
    measured,
    expected,
    delta,
    relatedElements: [], // 잘림이 el 자신에서 일어난다
    confidence: DEFAULT_CONFIDENCE,
  };
}

function detectClipped(c: CollectedViewport, lookup: ElementLookup): TextOverflowIssue[] {
  const candidates = findClippedCandidates(lookup);
  const clippedIndices = new Set(candidates.map((candidate) => candidate.el.index));
  return candidates
    .filter((candidate) => !isShadowedByDeeper(candidate, clippedIndices, lookup))
    .map((candidate) => clippedIssue(c, candidate));
}

function spillIssue(c: CollectedViewport, text: CollectedElement, box: CollectedElement, out: Rect[]): TextOverflowIssue {
  const u = union(out) as Rect;
  const b = box.rect;
  const measured: Record<string, number> = {};
  const expected: Record<string, number> = {};
  const delta: Record<string, number> = {};
  // 넘친 방향만 기록한다(DETECTION_RULES 4.2)
  if (u.x < b.x - TOLERANCE_PX) {
    measured.textLeft = roundMeasure(u.x);
    expected.containerLeft = b.x;
    delta.overflowLeft = roundMeasure(b.x - u.x);
  }
  if (right(u) > right(b) + TOLERANCE_PX) {
    measured.textRight = roundMeasure(right(u));
    expected.containerRight = roundMeasure(right(b));
    delta.overflowRight = roundMeasure(right(u) - right(b));
  }
  if (u.y < b.y - TOLERANCE_PX) {
    measured.textTop = roundMeasure(u.y);
    expected.containerTop = b.y;
    delta.overflowTop = roundMeasure(b.y - u.y);
  }
  if (bottom(u) > bottom(b) + TOLERANCE_PX) {
    measured.textBottom = roundMeasure(bottom(u));
    expected.containerBottom = roundMeasure(bottom(b));
    delta.overflowBottom = roundMeasure(bottom(u) - bottom(b));
  }
  return {
    viewport: c.viewport,
    type: 'text-overflow',
    subtype: 'spill',
    elementIndex: text.index,
    boundingBox: { ...text.rect },
    measured,
    expected,
    delta,
    relatedElements: [{ role: 'bordered-ancestor', index: box.index }],
    confidence: DEFAULT_CONFIDENCE,
  };
}

function detectSpill(c: CollectedViewport, lookup: ElementLookup): TextOverflowIssue[] {
  const issues: TextOverflowIssue[] = [];
  for (const text of lookup.sorted) {
    if (text.textRects.length === 0) continue;
    if (isIntentionalTruncation(text)) continue; // PRD 5.3.2: 의도된 잘림 (T에 적용)

    // T 자신부터 위로 올라가며 처음 만나는 테두리 박스. body는 후보가 아니므로 닿으면 없음이 된다.
    const path: CollectedElement[] = [];
    let box: CollectedElement | null = null;
    for (const el of [text, ...ancestorsOf(text, lookup)]) {
      path.push(el);
      if (isBorderedBox(el)) {
        box = el;
        break;
      }
    }
    if (!box) continue; // PRD 5.3.2: body까지 테두리 박스가 없으면 판정하지 않음
    // PRD 5.3.2: 경로에 overflow가 visible이 아닌 요소가 있으면 넘친 글자가 보이지 않거나 clipped/스크롤 영역이다
    if (path.some((el) => el.style.overflowX !== 'visible' || el.style.overflowY !== 'visible')) continue;
    if (isIntentionalTruncation(box)) continue; // PRD 5.3.2: 의도된 잘림 (B에 적용)

    const b = box.rect;
    const out = text.textRects.filter(
      (r) =>
        r.x < b.x - TOLERANCE_PX ||
        right(r) > right(b) + TOLERANCE_PX ||
        r.y < b.y - TOLERANCE_PX ||
        bottom(r) > bottom(b) + TOLERANCE_PX,
    );
    if (out.length === 0) continue;
    issues.push(spillIssue(c, text, box, out));
  }
  return issues;
}

export function detectTextOverflow(c: CollectedViewport): { issues: TextOverflowIssue[] } {
  const lookup = buildLookup(c);
  const issues = [...detectClipped(c, lookup), ...detectSpill(c, lookup)].sort(compareRawIssues);
  return { issues };
}
