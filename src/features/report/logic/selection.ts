import type { Inspection } from '@/types/inspection';

// WIREFRAME 8장: 결과 화면의 선택 상태는 query(?tab=, ?issue=, ?task=)에 둔다. 필터는 넣지 않는다(5.8).

export type ReportTab = 'issues' | 'tasks';

export interface ReportSelection {
  tab: ReportTab;
  /** 열린 Issue Detail 패널. 없는 ID는 무시한다 */
  issueId: string | null;
  /** 명시적으로 고른 태스크. 없으면 넓은 화면은 첫 번째 태스크를 보여준다(WIREFRAME 7.4) */
  taskId: string | null;
}

export const DEFAULT_SELECTION: ReportSelection = { tab: 'issues', issueId: null, taskId: null };

interface ParamsLike {
  get(name: string): string | null;
}

/** query를 읽는다. 문서가 아직 없으면 ID를 확인할 수 없으므로 고르지 않은 것으로 본다 */
export function parseSelection(params: ParamsLike, inspection: Pick<Inspection, 'issues' | 'tasks'> | null): ReportSelection {
  const tab: ReportTab = params.get('tab') === 'tasks' ? 'tasks' : 'issues';
  const issue = params.get('issue');
  const task = params.get('task');
  return {
    tab,
    issueId: issue && inspection?.issues.some((i) => i.id === issue) ? issue : null,
    taskId: task && inspection?.tasks.some((t) => t.id === task) ? task : null,
  };
}

/** 선택 상태를 query 문자열로. 기본값(tab=issues)과 비어 있는 값은 넣지 않는다 */
export function selectionSearch(selection: ReportSelection): string {
  const params = new URLSearchParams();
  if (selection.tab === 'tasks') params.set('tab', 'tasks');
  if (selection.issueId) params.set('issue', selection.issueId);
  if (selection.taskId) params.set('task', selection.taskId);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function updateSelection(current: ReportSelection, patch: Partial<ReportSelection>): ReportSelection {
  return { ...current, ...patch };
}
