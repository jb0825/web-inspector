import type { DevTask } from '@/types/inspection';

// 개발 태스크 탭의 표시 규칙 (WIREFRAME 7장). 순수 함수만 둔다.

/**
 * "자동 제목" 표시 방식 (WIREFRAME 7.4와 다르게 정한 부분):
 * - 'notice': 모든 태스크가 template이면 목록 위에 한 번만 안내한다. 지금(규칙 기반 분석)은 항상 이 경우라, 항목마다 붙이면 같은 표시가 반복된다.
 * - 'per-item': AI 제목과 섞여 있을 때만 template 항목에 표시한다.
 * - 'none': 태스크가 없거나 모두 AI 제목이다.
 */
export type TitleSourceDisplay = 'none' | 'notice' | 'per-item';

export function titleSourceDisplay(tasks: readonly Pick<DevTask, 'titleSource'>[]): TitleSourceDisplay {
  if (tasks.length === 0) return 'none';
  const templates = tasks.filter((task) => task.titleSource === 'template').length;
  if (templates === 0) return 'none';
  return templates === tasks.length ? 'notice' : 'per-item';
}

export interface TaskListModel {
  regular: DevTask[];
  /** 토글을 켰을 때만 채운다 */
  needsReview: DevTask[];
  /** 토글과 관계없는 Needs Review 태스크 수 (토글 표시 여부) */
  needsReviewTotal: number;
  /** 보이는 태스크와 그 이슈 수 ("태스크 N개 · 이슈 N개") */
  visibleTaskCount: number;
  visibleIssueCount: number;
}

/** 서버가 PRD 5.8.1 순서(needsReview → Priority → 가장 작은 Issue ID)로 저장했으므로 순서를 바꾸지 않는다 */
export function buildTaskList(tasks: readonly DevTask[], showNeedsReview: boolean): TaskListModel {
  const regular = tasks.filter((task) => !task.needsReview);
  const reviewAll = tasks.filter((task) => task.needsReview);
  const needsReview = showNeedsReview ? reviewAll : [];
  const visible = [...regular, ...needsReview];
  return {
    regular,
    needsReview,
    needsReviewTotal: reviewAll.length,
    visibleTaskCount: visible.length,
    visibleIssueCount: visible.reduce((sum, task) => sum + task.issueIds.length, 0),
  };
}

/**
 * 상세에 보여줄 태스크. 명시적으로 고른 태스크가 보이는 목록에 있으면 그것, 아니면 첫 번째 태스크(WIREFRAME 7.4).
 * Needs Review 태스크를 고른 채 토글을 끄면 첫 번째로 돌아간다.
 */
export function resolveSelectedTask(list: TaskListModel, selectedId: string | null): DevTask | null {
  const visible = [...list.regular, ...list.needsReview];
  return visible.find((task) => task.id === selectedId) ?? visible[0] ?? null;
}
