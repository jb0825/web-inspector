// Before/After 검사 결과 비교(scripts/compare-inspections.ts)의 순수 함수 (T14).

import { compareIssues, countRows, type CountRow } from '@/server/compare/beforeAfter';
import { inlineCode, singleLine } from '@/server/prompt/markdown';
import type { Inspection, Issue } from '@/types/inspection';

// 매칭 함수는 src/server/compare/beforeAfter.ts로 옮겼다(/showcase 페이지와 함께 쓴다). 기존 import를 위해 다시 내보낸다
export { compareIssues, countRows, elementKeys, ISSUE_TYPES, PRIORITIES, sameIssue, VIEWPORTS } from '@/server/compare/beforeAfter';
export type { CountRow, InspectionComparison, MatchedPair } from '@/server/compare/beforeAfter';

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
