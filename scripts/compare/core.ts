// Before/After 검사 결과 비교(scripts/compare-inspections.ts)의 순수 함수 (T14).
// Issue ID는 검사마다 다시 붙으므로(PRD 5.3.6) 매칭에 쓰지 않는다. 유형, subtype, 대상 요소로 같은 이슈를 찾는다.
// 같은 입력에는 항상 같은 결과를 낸다(정렬 기준을 명시한다).

import { inlineCode, singleLine } from '@/server/prompt/markdown';
import type { Inspection, Issue, IssueType, Priority, SourceHints, Viewport } from '@/types/inspection';

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

/** 표 칸에 넣을 문자열. 줄바꿈과 `|`가 표를 깨지 않게 한다 */
export function cell(value: string): string {
  return singleLine(value).replace(/\|/g, '\\|');
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0';
}

function countTable(title: string, rows: CountRow[]): string[] {
  return [
    `| ${title} | Before | After | 변화 |`,
    '|---|---:|---:|---:|',
    ...rows.map((r) => `| ${cell(r.label)} | ${r.before} | ${r.after} | ${signed(r.after - r.before)} |`),
    '',
  ];
}

function target(issue: Issue): string {
  // GFM 표 안에서는 코드 안의 `|`도 \|로 써야 한다
  return cell(inlineCode(issue.selector));
}

function issueLine(issue: Issue): string {
  return `| ${issue.id} | ${issue.type}/${issue.subtype} | ${issue.priority} | ${issue.viewportTag ?? '-'} | ${issue.needsReview ? '예' : ''} | ${target(issue)} | ${cell(issue.title)} |`;
}

const ISSUE_HEADER = ['| ID | 유형 | Priority | Viewport | Needs Review | 대상 요소 | 제목 |', '|---|---|---|---|---|---|---|'];

function issueTable(issues: readonly Issue[]): string[] {
  if (issues.length === 0) return ['없음', ''];
  return [...ISSUE_HEADER, ...issues.map(issueLine), ''];
}

/** 비교 결과 Markdown. 생성 시각 같은 실행마다 바뀌는 값은 넣지 않는다 */
export function renderComparisonMarkdown(before: Inspection, after: Inspection): string {
  const result = compareIssues(before.issues, after.issues);
  const counts = countRows(before.issues, after.issues);
  const lines = [
    '# Before / After 비교',
    '',
    '| | Before | After |',
    '|---|---|---|',
    `| 검사 URL | ${cell(before.url)} | ${cell(after.url)} |`,
    `| 검사 시각 (UTC) | ${before.createdAt} | ${after.createdAt} |`,
    `| 이슈 / 태스크 | ${before.issues.length} / ${before.tasks.length} | ${after.issues.length} / ${after.tasks.length} |`,
    '',
    '## 이슈 수',
    '',
    ...countTable('구분', counts.total),
    ...countTable('Priority', counts.priority),
    ...countTable('유형', counts.type),
    ...countTable('Viewport', counts.viewport),
    'Priority, 유형, Viewport 표는 확정 이슈(needsReview: false)만 센다. 두 viewport에서 모두 나온 이슈는 Desktop과 Mobile에 각각 센다.',
    '',
    `## 해결된 이슈 (Before에만 있음, ${result.resolved.length}개)`,
    '',
    ...issueTable(result.resolved),
    `## 새로 생긴 이슈 (After에만 있음, ${result.added.length}개)`,
    '',
    ...issueTable(result.added),
    `## 남은 이슈 (${result.remaining.length}개)`,
    '',
    ...(result.remaining.length === 0
      ? ['없음', '']
      : [
          '| Before ID | After ID | 유형 | Priority (Before → After) | Viewport (Before → After) | 대상 요소 |',
          '|---|---|---|---|---|---|',
          ...result.remaining.map(
            ({ before: b, after: a }) =>
              `| ${b.id} | ${a.id} | ${b.type}/${b.subtype} | ${b.priority} → ${a.priority} | ${b.viewportTag ?? '-'} → ${a.viewportTag ?? '-'} | ${target(b)} |`,
          ),
          '',
        ]),
    '매칭 기준: `type`, `subtype`이 같고 대상 요소가 같은 이슈. 대상 요소는 selector를 먼저 비교하고, 다르면 Source Hints(안정 속성, 또는 영역 + 텍스트)로 비교한다. Issue ID는 검사마다 다시 붙으므로 쓰지 않는다.',
    '',
  ];
  return lines.join('\n');
}
