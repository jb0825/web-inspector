import 'server-only';
import type { IssueType, Viewport } from '@/types/inspection';
import { MAX_ISSUES } from './constants';
import { relatedIndexOf, type ScoredIssue } from './types';

// 이슈 수 상한, 정렬, Issue ID (PRD 5.3.6, 5.3.7, DETECTION_RULES 7.4, 7.6). 순수 함수다.

const VIEWPORT_ORDER: Record<Viewport, number> = { desktop: 0, mobile: 1 };
const TYPE_ORDER: Record<IssueType, number> = {
  'viewport-overflow': 0,
  'text-overflow': 1,
  'element-overlap': 2,
};

type Orderable = Pick<ScoredIssue, 'type' | 'subtype' | 'occurrences'>;

/** 7.4 정렬 키 5단계 */
export function compareIssueOrder(a: Orderable, b: Orderable): number {
  const ao = a.occurrences[0];
  const bo = b.occurrences[0];
  if (ao.viewport !== bo.viewport) return VIEWPORT_ORDER[ao.viewport] - VIEWPORT_ORDER[bo.viewport];
  if (ao.elementIndex !== bo.elementIndex) return ao.elementIndex - bo.elementIndex;
  if (a.type !== b.type) return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  // 사전순은 locale에 따라 달라지지 않도록 코드 단위로 비교한다
  if (a.subtype !== b.subtype) return a.subtype < b.subtype ? -1 : 1;
  return relatedIndexOf(ao) - relatedIndexOf(bo);
}

export interface CapResult<T> {
  kept: T[];
  /** 상한을 적용하기 전 이슈 수 (PRD 8.2) */
  issuesDetected: number;
  issuesTruncated: boolean;
}

/**
 * 7.6: 상한을 넘으면 score100 내림차순, 같으면 7.4 정렬 키 순으로 앞에서 limit개만 남긴다.
 * 남은 이슈의 순서는 의미가 없다. ID 순서는 orderAndAssignIds가 정한다.
 */
export function capIssues<T extends Orderable & Pick<ScoredIssue, 'scores'>>(
  issues: readonly T[],
  limit: number = MAX_ISSUES,
): CapResult<T> {
  const issuesDetected = issues.length;
  if (issuesDetected <= limit) return { kept: [...issues], issuesDetected, issuesTruncated: false };
  const kept = [...issues]
    .sort((a, b) => b.scores.score100 - a.scores.score100 || compareIssueOrder(a, b))
    .slice(0, limit);
  return { kept, issuesDetected, issuesTruncated: true };
}

/** ISS-001 형식. 세 자리를 넘으면 그대로 늘린다(ISS-1000) */
export function formatIssueId(n: number): string {
  return `ISS-${String(n).padStart(3, '0')}`;
}

/** 7.4: 정렬 키 순서대로 ISS-001부터 빈 번호 없이 붙인다. 상한을 적용한 뒤에 호출한다 */
export function orderAndAssignIds<T extends Orderable>(issues: readonly T[]): (T & { id: string })[] {
  return [...issues].sort(compareIssueOrder).map((issue, i) => ({ ...issue, id: formatIssueId(i + 1) }));
}
