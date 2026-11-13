import { describe, expect, it } from 'vitest';
import { MAX_ISSUES } from '@/server/detect/constants';
import { capIssues, compareIssueOrder, formatIssueId, orderAndAssignIds } from '@/server/detect/order';
import { merged, raw, scored } from './helpers/issues';
import { shuffled } from './helpers/collected';

// PRD 5.3.6, 5.3.7, DETECTION_RULES 7.4, 7.6, 12.1 order

const ids = <T extends { id: string }>(issues: T[]) => issues.map((i) => i.id);
const keyOf = (i: ReturnType<typeof scored>) =>
  `${i.occurrences[0].viewport}:${i.occurrences[0].elementIndex}:${i.type}/${i.subtype}:${i.occurrences[0].relatedElements[0]?.index ?? -1}`;

describe('정렬 키 (7.4)', () => {
  it('1. occurrences[0].viewport: desktop < mobile', () => {
    const mobile = scored(merged(raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1 })), 430);
    const desktop = scored(merged(raw({ viewport: 'desktop', type: 'element-overlap', subtype: 'other', elementIndex: 99 })), 200);
    expect(orderAndAssignIds([mobile, desktop]).map(keyOf)).toEqual([keyOf(desktop), keyOf(mobile)]);
  });

  it('병합된 이슈는 desktop occurrence 기준이다', () => {
    const both = scored(
      merged(
        raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 50 }),
        raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 2 }),
      ),
      330,
    );
    const desktop = scored(merged(raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 10 })), 300);
    expect(orderAndAssignIds([both, desktop]).map(keyOf)).toEqual([keyOf(desktop), keyOf(both)]);
  });

  it('2. 대상 요소 index', () => {
    const a = scored(merged(raw({ type: 'element-overlap', subtype: 'other', elementIndex: 3 })), 200);
    const b = scored(merged(raw({ type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 20 })), 430);
    expect(orderAndAssignIds([b, a]).map(keyOf)).toEqual([keyOf(a), keyOf(b)]);
  });

  it('3. type: viewport-overflow < text-overflow < element-overlap', () => {
    const overlap = scored(merged(raw({ type: 'element-overlap', subtype: 'interactive', elementIndex: 5 })), 405);
    const text = scored(merged(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 5 })), 300);
    const vo = scored(merged(raw({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 5 })), 230);
    expect(orderAndAssignIds([overlap, text, vo]).map((i) => i.type)).toEqual(['viewport-overflow', 'text-overflow', 'element-overlap']);
  });

  it('4. subtype 사전순', () => {
    const text = scored(merged(raw({ type: 'element-overlap', subtype: 'text', elementIndex: 5, relatedIndex: 6 })), 300);
    const other = scored(merged(raw({ type: 'element-overlap', subtype: 'other', elementIndex: 5, relatedIndex: 6 })), 200);
    const interactive = scored(merged(raw({ type: 'element-overlap', subtype: 'interactive', elementIndex: 5, relatedIndex: 6 })), 405);
    expect(orderAndAssignIds([text, other, interactive]).map((i) => i.subtype)).toEqual(['interactive', 'other', 'text']);
  });

  it('5. 상대 요소 index (없으면 -1)', () => {
    const far = scored(merged(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 5, relatedIndex: 4 })), 265);
    const none = scored(merged(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 5 })), 265);
    const near = scored(merged(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 5, relatedIndex: 2 })), 265);
    expect(orderAndAssignIds([far, near, none]).map((i) => i.occurrences[0].relatedElements[0]?.index ?? -1)).toEqual([-1, 2, 4]);
    // Overlap은 대표 상대 요소(relatedIndex)
    const a = raw({ type: 'element-overlap', subtype: 'other', elementIndex: 5, relatedIndex: 9 });
    const b = raw({ type: 'element-overlap', subtype: 'other', elementIndex: 5, relatedIndex: 7 });
    expect(compareIssueOrder(merged(a), merged(b))).toBeGreaterThan(0);
  });

  it('입력 순서를 섞어도 같은 ID', () => {
    const issues = [
      scored(merged(raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1 })), 430),
      scored(merged(raw({ type: 'element-overlap', subtype: 'interactive', elementIndex: 4, relatedIndex: 5 })), 405),
      scored(merged(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 4 })), 300),
      scored(merged(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 8, relatedIndex: 2 })), 265),
      scored(merged(raw({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 2 })), 230),
    ];
    const base = orderAndAssignIds(issues);
    expect(JSON.stringify(orderAndAssignIds(shuffled(issues)))).toBe(JSON.stringify(base));
    expect(JSON.stringify(orderAndAssignIds([...issues].reverse()))).toBe(JSON.stringify(base));
    expect(ids(base)).toEqual(['ISS-001', 'ISS-002', 'ISS-003', 'ISS-004', 'ISS-005']);
  });

  it('ID 형식: 세 자리를 넘으면 그대로 늘린다', () => {
    expect(formatIssueId(1)).toBe('ISS-001');
    expect(formatIssueId(42)).toBe('ISS-042');
    expect(formatIssueId(1000)).toBe('ISS-1000');
  });
});

describe('이슈 수 상한 (7.6)', () => {
  /** 요소 index와 점수를 정한 이슈 n개 */
  const many = (n: number, scoreOf: (i: number) => number) =>
    Array.from({ length: n }, (_, i) => scored(merged(raw({ type: 'element-overlap', subtype: 'other', elementIndex: i + 1 })), scoreOf(i + 1)));

  it('상한 이하면 그대로 두고 잘림 없음', () => {
    const result = capIssues(many(MAX_ISSUES, () => 200));
    expect(result.kept).toHaveLength(MAX_ISSUES);
    expect(result.issuesDetected).toBe(MAX_ISSUES);
    expect(result.issuesTruncated).toBe(false);
  });

  it('상한을 넘으면 score100 높은 순으로 남긴다', () => {
    // 뒤쪽 요소일수록 점수가 높다: 요소 1~250 → 점수 1~250
    const result = capIssues(many(250, (i) => i));
    expect(result.issuesDetected).toBe(250);
    expect(result.issuesTruncated).toBe(true);
    expect(result.kept).toHaveLength(MAX_ISSUES);
    const kept = result.kept.map((i) => i.occurrences[0].elementIndex).sort((a, b) => a - b);
    expect(kept[0]).toBe(51);
    expect(kept.at(-1)).toBe(250);
  });

  it('동점이면 7.4 정렬 키 순으로 남긴다', () => {
    // 모두 같은 점수 → 요소 index가 작은 200개
    const result = capIssues(shuffled(many(230, () => 200)));
    const kept = result.kept.map((i) => i.occurrences[0].elementIndex).sort((a, b) => a - b);
    expect(kept).toEqual(Array.from({ length: MAX_ISSUES }, (_, i) => i + 1));
    // 점수 경계에 걸친 동점: 높은 점수 150개 + 같은 점수 100개 중 앞의 50개
    const mixed = capIssues(many(250, (i) => (i > 100 ? 300 : 200)));
    const keptMixed = mixed.kept.map((i) => i.occurrences[0].elementIndex).sort((a, b) => a - b);
    expect(keptMixed.slice(0, 50)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(keptMixed.slice(50)).toEqual(Array.from({ length: 150 }, (_, i) => i + 101));
  });

  it('상한 뒤 ID에 빈 번호가 없다', () => {
    const { kept } = capIssues(many(250, (i) => (i % 2 === 0 ? 300 : 200)));
    expect(ids(orderAndAssignIds(kept))).toEqual(Array.from({ length: MAX_ISSUES }, (_, i) => formatIssueId(i + 1)));
  });

  it('입력 순서를 섞어도 같은 결과', () => {
    const issues = many(260, (i) => [200, 230, 300, 405][i % 4]);
    const a = orderAndAssignIds(capIssues(issues).kept);
    const b = orderAndAssignIds(capIssues(shuffled(issues)).kept);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
