import 'server-only';
import type { ElementMatching } from '@/server/compare/match';
import type { Viewport, ViewportTag } from '@/types/inspection';
import { NEEDS_REVIEW_BELOW } from './constants';
import { compareRawIssues, type DetectedIssue, type MergedIssue, type RawIssue, type ScoredIssue } from './types';

// Dedup 규칙 2~4 (PRD 5.3.5, DETECTION_RULES 7.1, 7.3, 7.5). 규칙 1은 viewportOverflow.ts(6.3)가 처리한다.

/** delta 중 가장 큰 값. 없으면 0 */
function maxDelta(issue: RawIssue): number {
  let max = 0;
  for (const value of Object.values(issue.delta)) if (value > max) max = value;
  return max;
}

/**
 * 규칙 2: 같은 viewport에서 (type, subtype, 대상 요소)가 같은 RawIssue를 하나로 합친다.
 * 측정값은 delta가 큰 쪽을 남기고, 같으면 출력 순서(compareRawIssues)가 앞인 쪽을 남긴다.
 * Overlap은 5.6에서 이미 묶였고 다른 유형도 현재 탐지 로직에서는 겹치지 않는다. 방어용이다.
 */
export function dedupWithinViewport(issues: readonly RawIssue[]): RawIssue[] {
  const sorted = [...issues].sort(compareRawIssues);
  const result: RawIssue[] = [];
  for (const issue of sorted) {
    const last = result.at(-1);
    // subtype 이름은 type 사이에 겹치지 않으므로 (요소, type, subtype)이 같으면 정렬 결과에서 이웃한다
    if (last && last.elementIndex === issue.elementIndex && last.type === issue.type && last.subtype === issue.subtype) {
      if (maxDelta(issue) > maxDelta(last)) result[result.length - 1] = issue;
      continue;
    }
    result.push(issue);
  }
  return result;
}

/** 매칭을 반영한 요소 키. 매칭된 mobile 요소는 짝인 desktop 요소와 같은 키를 갖는다 */
function elementKey(viewport: Viewport, index: number, matching: ElementMatching): string {
  if (viewport === 'desktop') return `d${index}`;
  const desktopIndex = matching.mobileToDesktop.get(index);
  return desktopIndex === undefined ? `m${index}` : `d${desktopIndex}`;
}

function viewportTagOf(viewports: readonly Viewport[], failed: boolean): ViewportTag | null {
  if (failed) return null; // PRD 5.6: 한 viewport가 실패한 검사는 비교 태그를 붙이지 않는다
  if (viewports.length === 2) return 'both';
  return viewports[0] === 'desktop' ? 'desktop-only' : 'mobile-only';
}

function toMerged(occurrences: RawIssue[], failed: boolean): MergedIssue {
  const [first] = occurrences;
  const viewports = occurrences.map((o) => o.viewport);
  const confidence = Math.min(...occurrences.map((o) => o.confidence));
  return {
    type: first.type,
    subtype: first.subtype,
    viewports,
    viewportTag: viewportTagOf(viewports, failed),
    occurrences,
    ...(first.type === 'viewport-overflow' ? { affectedDescendants: first.affectedDescendants } : {}),
    confidence,
    needsReview: confidence < NEEDS_REVIEW_BELOW, // DETECTION_RULES 9.4
  };
}

/**
 * 규칙 3: 같은 (type, subtype)이고 대상 요소가 매칭되면 하나로 합친다(7.3).
 * Overlap도 대상 요소와 subtype만 비교한다. 상대 요소는 viewport마다 다를 수 있고, 각 occurrence가 자기 것을 가진다.
 * 입력이 null이면 그 viewport가 실패한 검사다.
 */
export function mergeAcrossViewports(
  desktop: readonly RawIssue[] | null,
  mobile: readonly RawIssue[] | null,
  matching: ElementMatching,
): MergedIssue[] {
  const failed = desktop === null || mobile === null;
  const keyOf = (issue: RawIssue) =>
    `${issue.type}|${issue.subtype}|${elementKey(issue.viewport, issue.elementIndex, matching)}`;

  const mobileByKey = new Map<string, RawIssue>();
  for (const issue of mobile ?? []) mobileByKey.set(keyOf(issue), issue);

  const merged: MergedIssue[] = [];
  const used = new Set<RawIssue>();
  for (const d of desktop ?? []) {
    const m = mobileByKey.get(keyOf(d));
    if (m) used.add(m);
    merged.push(toMerged(m ? [d, m] : [d], failed));
  }
  for (const m of mobile ?? []) if (!used.has(m)) merged.push(toMerged([m], failed));
  return merged;
}

/**
 * 규칙 4: 같은 대상 요소에 viewport-overflow와 text-overflow가 모두 있으면 서로 연결한다(7.5).
 * 매칭된 요소는 viewport가 달라도 같은 요소로 본다. issues는 ID 순서(order.ts)로 정렬되어 있어야 하고,
 * 상한(7.6)으로 버려진 이슈는 이미 빠져 있으므로 연결되지 않는다.
 */
export function linkRelated<T extends ScoredIssue & { id: string }>(
  issues: readonly T[],
  matching: ElementMatching,
): (T & Pick<DetectedIssue, 'relatedIssueIds'>)[] {
  const keysOf = (issue: T) => new Set(issue.occurrences.map((o) => elementKey(o.viewport, o.elementIndex, matching)));
  const keys = issues.map(keysOf);
  const related: number[][] = issues.map(() => []);

  for (let i = 0; i < issues.length; i += 1) {
    if (issues[i].type !== 'viewport-overflow') continue;
    for (let j = 0; j < issues.length; j += 1) {
      if (issues[j].type !== 'text-overflow') continue;
      if (![...keys[i]].some((key) => keys[j].has(key))) continue;
      related[i].push(j);
      related[j].push(i);
    }
  }

  // 배열 위치가 ID 순서이므로 위치로 정렬하면 ID 오름차순이다(ISS-999 < ISS-1000도 맞다)
  return issues.map((issue, i) => ({
    ...issue,
    relatedIssueIds: [...new Set(related[i])].sort((a, b) => a - b).map((j) => issues[j].id),
  }));
}
