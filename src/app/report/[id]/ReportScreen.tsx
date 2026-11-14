'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { useInspectionPolling } from '@/components/polling/useInspectionPolling';
import { DevTasksView } from '@/features/dev-tasks';
import { NotFoundState } from '@/features/inspection-progress';
import { IssueDetailPanel } from '@/features/issue-detail';
import {
  ISSUE_ROW_ATTRIBUTE,
  parseSelection,
  ReportFailedState,
  ReportLoadError,
  ReportSkeleton,
  ReportView,
  selectionSearch,
  type ReportSelection,
} from '@/features/report';

// 결과 화면 조립: polling으로 문서를 받고, query의 선택 상태를 읽어 feature들에 props로 넘긴다(WIREFRAME 8장).
// feature끼리는 import하지 않으므로 태스크 탭과 Issue Detail 패널은 여기서 만들어 ReportView의 슬롯에 넣는다.
export function ReportScreen({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 종료 상태(completed / partial / failed)가 될 때까지 polling한다(USER_FLOW 5.6)
  const { state, retry } = useInspectionPolling(id);
  const inspection = state.inspection;
  const selection = parseSelection(searchParams, inspection);
  const inProgress = inspection !== null && (inspection.status === 'pending' || inspection.status === 'running');

  useEffect(() => {
    // 결과가 아직 없으면 진행 화면으로 보낸다. 뒤로 가기로 이 화면에 돌아오지 않게 replace
    if (inProgress) router.replace(`/inspections/${encodeURIComponent(id)}`);
  }, [inProgress, id, router]);

  // 선택 상태는 replace로 바꿔 뒤로 가기 기록이 쌓이지 않게 한다(T12 2.2). Next.js가 replaceState를 useSearchParams에 반영한다
  const updateSelection = useCallback(
    (patch: Partial<ReportSelection>) => {
      const next = { ...selection, ...patch };
      window.history.replaceState(null, '', `${pathname}${selectionSearch(next)}`);
    },
    [selection, pathname],
  );

  if (state.phase === 'not-found') return <NotFoundState />;
  if (!inspection) return state.phase === 'error' ? <ReportLoadError onRetry={retry} /> : <ReportSkeleton />;
  if (inProgress) return <ReportSkeleton />;
  if (inspection.status === 'failed') return <ReportFailedState inspection={inspection} />;

  const issue = selection.issueId ? inspection.issues.find((i) => i.id === selection.issueId) ?? null : null;

  return (
    <>
      {state.phase === 'error' ? <ReportLoadError onRetry={retry} /> : null}
      <ReportView
        inspection={inspection}
        variant="live"
        selection={selection}
        onSelectionChange={updateSelection}
        tasksPanel={
          <DevTasksView
            inspection={inspection}
            selectedTaskId={selection.taskId}
            onSelectTask={(taskId) => updateSelection({ taskId })}
            onOpenIssue={(issueId) => updateSelection({ issueId })}
            onShowIssues={() => updateSelection({ tab: 'issues' })}
          />
        }
        detailPanel={
          issue ? (
            <IssueDetailPanel
              inspection={inspection}
              issue={issue}
              onClose={() => updateSelection({ issueId: null })}
              onOpenTask={(taskId) => updateSelection({ tab: 'tasks', taskId, issueId: null })}
              findReturnTarget={(issueId) => document.querySelector<HTMLElement>(`[${ISSUE_ROW_ATTRIBUTE}="${CSS.escape(issueId)}"]`)}
            />
          ) : null
        }
      />
    </>
  );
}
