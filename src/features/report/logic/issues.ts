import type { Issue, IssueType, Priority, Viewport, ViewportTag } from '@/types/inspection';

// 결과 화면의 이슈 개수, 정렬, 필터 (WIREFRAME 5.5, 5.8~5.10). React와 분리한 순수 함수다.

export const PRIORITIES: readonly Priority[] = ['P0', 'P1', 'P2', 'P3'];
export const ISSUE_TYPES: readonly IssueType[] = ['text-overflow', 'element-overlap', 'viewport-overflow'];
export const VIEWPORT_TAGS: readonly ViewportTag[] = ['mobile-only', 'desktop-only', 'both'];

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Priority(P0 → P3) → Issue ID (WIREFRAME 5.9). 입력을 바꾸지 않는다 */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface IssueSummary {
  /** Needs Review 제외 (PRD 7.3) */
  total: number;
  byPriority: Record<Priority, number>;
  byViewport: Record<Viewport, number>;
  needsReview: number;
}

export function summarizeIssues(issues: readonly Issue[]): IssueSummary {
  const byPriority: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byViewport: Record<Viewport, number> = { desktop: 0, mobile: 0 };
  let total = 0;
  let needsReview = 0;
  for (const issue of issues) {
    if (issue.needsReview) {
      needsReview += 1;
      continue;
    }
    total += 1;
    byPriority[issue.priority] += 1;
    for (const viewport of issue.viewports) byViewport[viewport] += 1;
  }
  return { total, byPriority, byViewport, needsReview };
}

/** null은 "전체" */
export interface IssueFilter {
  priority: Priority | null;
  type: IssueType | null;
  viewportTag: ViewportTag | null;
}

export const EMPTY_FILTER: IssueFilter = { priority: null, type: null, viewportTag: null };

export function isFilterActive(filter: IssueFilter): boolean {
  return filter.priority !== null || filter.type !== null || filter.viewportTag !== null;
}

export function matchesFilter(issue: Issue, filter: IssueFilter): boolean {
  if (filter.priority !== null && issue.priority !== filter.priority) return false;
  if (filter.type !== null && issue.type !== filter.type) return false;
  if (filter.viewportTag !== null && issue.viewportTag !== filter.viewportTag) return false;
  return true;
}

/** 한 viewport가 실패한 검사는 비교 태그가 없으므로 Viewport 필터를 숨긴다 (WIREFRAME 5.8, PRD 5.6) */
export function isViewportFilterAvailable(viewportErrors: Record<Viewport, unknown>): boolean {
  return viewportErrors.desktop === null && viewportErrors.mobile === null;
}

export interface ListedIssue {
  issue: Issue;
  /** 마커 번호. 필터를 통과한 목록의 순번(1부터). 일반 이슈 다음에 Needs Review 이슈가 이어진다 */
  number: number;
}

export interface IssueListModel {
  regular: ListedIssue[];
  needsReview: ListedIssue[];
  /** 필터를 적용하기 전 개수 */
  regularTotal: number;
  needsReviewTotal: number;
}

/**
 * 필터 → 정렬 → 번호. Needs Review 이슈도 같은 필터를 적용해 그룹에 모은다(WIREFRAME 5.10).
 * 마커와 목록이 같은 번호를 쓴다(5.6).
 */
export function buildIssueList(issues: readonly Issue[], filter: IssueFilter): IssueListModel {
  const sorted = sortIssues(issues);
  const regularAll = sorted.filter((issue) => !issue.needsReview);
  const reviewAll = sorted.filter((issue) => issue.needsReview);
  const regular = regularAll.filter((issue) => matchesFilter(issue, filter));
  const review = reviewAll.filter((issue) => matchesFilter(issue, filter));
  return {
    regular: regular.map((issue, index) => ({ issue, number: index + 1 })),
    needsReview: review.map((issue, index) => ({ issue, number: regular.length + index + 1 })),
    regularTotal: regularAll.length,
    needsReviewTotal: reviewAll.length,
  };
}

/** 목록의 대상 표시 (WIREFRAME 5.9): 태그 + 텍스트 앞부분, 텍스트가 없으면 selector */
export interface IssueTarget {
  label: string;
  /** title 속성용 전체 문자열 */
  full: string;
}

const TAG_PATTERN = /^<([a-zA-Z][\w-]*)/;
export const TARGET_TEXT_MAX = 24;

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : text;
}

export function issueTarget(issue: Pick<Issue, 'type' | 'selector' | 'sourceHints' | 'occurrences'>): IssueTarget {
  const tag = TAG_PATTERN.exec(issue.sourceHints.htmlSnippet)?.[1]?.toLowerCase() ?? null;
  const text = issue.sourceHints.textSnippet?.replace(/\s+/g, ' ').trim();
  let label: string;
  let full: string;
  if (tag && text) {
    label = `${tag} "${truncate(text, TARGET_TEXT_MAX)}"`;
    full = `${tag} "${text}"`;
  } else {
    label = issue.selector;
    full = issue.selector;
  }
  // Element Overlap은 상대 요소를 함께 보여준다(WIREFRAME 5.2 예시). 상대는 태그만 수집되어 있다
  const partner = issue.type === 'element-overlap' ? issue.occurrences[0]?.relatedElements.find((r) => r.role === 'overlap-target') : undefined;
  if (partner) {
    label = `${label} ↔ ${partner.tag}`;
    full = `${full} ↔ ${partner.selector}`;
  }
  return { label, full };
}
