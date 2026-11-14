import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectionSchema } from '@/server/store/schemas';
import type { Issue } from '@/types/inspection';
import { cell, compareIssues, countRows, elementKeys, renderComparisonMarkdown, sameIssue } from '../../scripts/compare/core';

// T14: Before/After 비교 매칭 규칙 (scripts/compare/core.ts)

const sample = inspectionSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'sample', 'inspection.json'), 'utf8')));
const issues = sample.issues;
const byId = (id: string) => issues.find((i) => i.id === id)!;

/** 다른 검사에서 같은 이슈가 다른 ID로 나온 것처럼 만든다 */
function renumber(list: readonly Issue[], offset: number): Issue[] {
  return list.map((issue, i) => ({ ...issue, id: `ISS-${String(i + 1 + offset).padStart(3, '0')}`, relatedIssueIds: [] }));
}

function withSelector(issue: Issue, selector: string): Issue {
  return { ...issue, selector, occurrences: issue.occurrences.map((o) => ({ ...o, selector })) };
}

describe('compareIssues', () => {
  it('같은 문서끼리 비교하면 해결 0, 새 이슈 0이다', () => {
    const result = compareIssues(issues, issues);
    expect(result.resolved).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.remaining.map((p) => [p.before.id, p.after.id])).toEqual(issues.map((i) => [i.id, i.id]));
  });

  it('Issue ID가 달라도 유형, subtype, 대상 요소로 매칭한다', () => {
    const after = renumber([...issues].reverse(), 100);
    const result = compareIssues(issues, after);
    expect(result.resolved).toEqual([]);
    expect(result.added).toEqual([]);
    for (const { before, after: a } of result.remaining) {
      expect(a.type).toBe(before.type);
      expect(a.selector).toBe(before.selector);
    }
  });

  it('After에서 빠진 이슈는 해결, 새로 나온 이슈는 새 이슈다', () => {
    const fixed = byId('ISS-005');
    const fresh = withSelector({ ...byId('ISS-004'), sourceHints: { ...byId('ISS-004').sourceHints, stableAttributes: {}, textSnippet: '새 버튼' } }, '[data-testid="new-cta"]');
    const after = [...issues.filter((i) => i !== fixed), fresh];
    const result = compareIssues(issues, after);
    expect(result.resolved.map((i) => i.id)).toEqual(['ISS-005']);
    expect(result.added).toEqual([fresh]);
    expect(result.remaining).toHaveLength(issues.length - 1);
  });

  it('subtype이 다르면 같은 요소여도 다른 이슈다', () => {
    const changed = { ...byId('ISS-004'), subtype: 'spill' };
    const result = compareIssues([byId('ISS-004')], [changed]);
    expect(result.resolved).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  it('selector가 바뀌어도 안정 속성이 같으면 같은 요소로 본다', () => {
    const moved = withSelector(byId('ISS-003'), 'header > nav > a.login');
    expect(sameIssue(byId('ISS-003'), moved)).toBe(true);
    expect(compareIssues([byId('ISS-003')], [moved]).remaining).toHaveLength(1);
  });

  it('selector가 같은 짝을 sourceHints 짝보다 먼저 고른다', () => {
    const target = byId('ISS-003');
    // 안정 속성만 같은 다른 요소가 앞에 있어도, selector가 같은 뒤쪽 이슈와 짝짓는다
    const lookalike = withSelector(target, '#other');
    const result = compareIssues([target], [lookalike, target]);
    expect(result.remaining[0]!.after).toBe(target);
    expect(result.added).toEqual([lookalike]);
  });

  it('elementKeys는 정렬된 결과를 돌려준다 (결정성)', () => {
    const keys = elementKeys(byId('ISS-002'));
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('selector:[data-testid="plan-team-note"]');
  });
});

describe('countRows', () => {
  it('확정 이슈만 Priority, 유형, viewport별로 센다', () => {
    const counts = countRows(issues, []);
    const regular = issues.filter((i) => !i.needsReview);
    expect(counts.priority.reduce((s, r) => s + r.before, 0)).toBe(regular.length);
    expect(counts.type.reduce((s, r) => s + r.before, 0)).toBe(regular.length);
    expect(counts.total).toEqual([
      { label: '확정 이슈 (needsReview: false)', before: regular.length, after: 0 },
      { label: 'Needs Review', before: issues.length - regular.length, after: 0 },
    ]);
    expect(counts.viewport.find((r) => r.label === 'Mobile')!.before).toBe(regular.filter((i) => i.viewports.includes('mobile')).length);
  });
});

describe('renderComparisonMarkdown', () => {
  it('같은 문서 비교 결과를 Markdown으로 낸다', () => {
    const md = renderComparisonMarkdown(sample, sample);
    expect(md).toContain('## 해결된 이슈 (Before에만 있음, 0개)');
    expect(md).toContain('## 새로 생긴 이슈 (After에만 있음, 0개)');
    expect(md).toContain(`## 남은 이슈 (${issues.length}개)`);
    expect(renderComparisonMarkdown(sample, sample)).toBe(md);
  });

  it('표 칸의 줄바꿈과 |를 처리한다', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c');
  });
});
