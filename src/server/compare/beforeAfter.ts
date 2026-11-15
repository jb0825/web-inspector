import 'server-only';
import type { Issue, IssueType, Priority, SourceHints, Viewport } from '@/types/inspection';

// Before/After 검사 결과의 이슈 매칭 (T14). 순수 함수라 /showcase 페이지(빌드 시 정적 생성)와
// scripts/compare-inspections.ts가 함께 쓴다. 같은 입력에는 항상 같은 결과를 낸다(정렬 기준을 명시한다).
// Issue ID는 검사마다 다시 붙으므로(PRD 5.3.6) 매칭에 쓰지 않는다. 유형, subtype, 대상 요소로 같은 이슈를 찾는다.
// DETECTION_RULES에는 Before/After 매칭 규칙이 없다(7.2는 viewport 간 매칭). 기준은 이 파일과 tests/unit/compareInspections.test.ts다.

export const PRIORITIES: readonly Priority[] = ['P0', 'P1', 'P2', 'P3'];
export const ISSUE_TYPES: readonly IssueType[] = ['text-overflow', 'element-overlap', 'viewport-overflow'];
export const VIEWPORTS: readonly Viewport[] = ['desktop', 'mobile'];

/**
 * 대상 요소를 가리키는 키 목록. 하나라도 같으면 같은 요소로 본다.
 * - selector: occurrence마다 (viewport별 selector가 다를 수 있다)
 * - sourceHints: 안정 속성(id, data-testid 등) 전체, 또는 landmark + textSnippet
 *   수정하면서 class나 DOM 위치가 바뀌어 selector가 달라져도 같은 요소를 찾기 위해서다
 */
export function elementKeys(issue: Issue): string[] {
  const keys = new Set<string>();
  for (const o of issue.occurrences) keys.add(`selector:${o.selector}`);
  keys.add(`selector:${issue.selector}`);
  for (const hints of [issue.sourceHints, ...issue.occurrences.map((o) => o.sourceHints)]) {
    for (const key of hintKeys(hints)) keys.add(key);
  }
  return [...keys].sort();
}

function hintKeys(hints: SourceHints): string[] {
  const out: string[] = [];
  const attrs = Object.entries(hints.stableAttributes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (attrs.length > 0) out.push(`attrs:${JSON.stringify(attrs)}`);
  if (hints.textSnippet) out.push(`text:${hints.landmark ?? ''}:${hints.textSnippet}`);
  return out;
}

export function sameIssue(a: Issue, b: Issue): boolean {
  if (a.type !== b.type || a.subtype !== b.subtype) return false;
  const keys = new Set(elementKeys(a));
  return elementKeys(b).some((k) => keys.has(k));
}

export interface MatchedPair {
  before: Issue;
  after: Issue;
}

export interface InspectionComparison {
  /** Before에만 있는 이슈 */
  resolved: Issue[];
  /** After에만 있는 이슈 */
  added: Issue[];
  /** 양쪽에 있는 이슈 */
  remaining: MatchedPair[];
}

/**
 * 1:1 매칭. Before 이슈를 문서 순서(ID 순)로 돌며, 아직 짝이 없는 After 이슈 중 첫 번째 일치 항목과 짝짓는다.
 * selector가 같은 짝을 먼저 찾고, 없을 때만 sourceHints로 찾는다(더 확실한 근거를 먼저 쓴다).
 */
export function compareIssues(before: readonly Issue[], after: readonly Issue[]): InspectionComparison {
  const used = new Set<number>();
  const pairs: MatchedPair[] = [];
  const resolved: Issue[] = [];
  const bySelector = (a: Issue, b: Issue) => {
    if (a.type !== b.type || a.subtype !== b.subtype) return false;
    const sa = new Set(elementKeys(a).filter((k) => k.startsWith('selector:')));
    return elementKeys(b).some((k) => k.startsWith('selector:') && sa.has(k));
  };
  const pending: Issue[] = [];
  for (const b of before) {
    const index = after.findIndex((a, i) => !used.has(i) && bySelector(b, a));
    if (index >= 0) {
      used.add(index);
      pairs.push({ before: b, after: after[index]! });
    } else pending.push(b);
  }
  for (const b of pending) {
    const index = after.findIndex((a, i) => !used.has(i) && sameIssue(b, a));
    if (index >= 0) {
      used.add(index);
      pairs.push({ before: b, after: after[index]! });
    } else resolved.push(b);
  }
  const added = after.filter((_, i) => !used.has(i));
  const order = new Map(before.map((issue, i) => [issue, i]));
  pairs.sort((x, y) => order.get(x.before)! - order.get(y.before)!);
  return { resolved, added, remaining: pairs };
}

export interface CountRow {
  label: string;
  before: number;
  after: number;
}

/** 확정 이슈(needsReview: false)의 Priority별, 유형별, viewport별 개수와 Needs Review 개수 */
export function countRows(before: readonly Issue[], after: readonly Issue[]): { priority: CountRow[]; type: CountRow[]; viewport: CountRow[]; total: CountRow[] } {
  const regular = (list: readonly Issue[]) => list.filter((i) => !i.needsReview);
  const row = (label: string, pick: (i: Issue) => boolean): CountRow => ({
    label,
    before: regular(before).filter(pick).length,
    after: regular(after).filter(pick).length,
  });
  return {
    priority: PRIORITIES.map((p) => row(p, (i) => i.priority === p)),
    type: ISSUE_TYPES.map((t) => row(t, (i) => i.type === t)),
    viewport: VIEWPORTS.map((v) => row(v === 'desktop' ? 'Desktop' : 'Mobile', (i) => i.viewports.includes(v))),
    total: [
      row('확정 이슈 (needsReview: false)', () => true),
      { label: 'Needs Review', before: before.filter((i) => i.needsReview).length, after: after.filter((i) => i.needsReview).length },
    ],
  };
}
