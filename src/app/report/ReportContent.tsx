'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, type ReactNode } from 'react';
import { DevTasksView } from '@/features/dev-tasks';
import { IssueDetailPanel } from '@/features/issue-detail';
import { ISSUE_ROW_ATTRIBUTE, parseSelection, ReportView, selectionSearch, type ReportSelection, type ReportVariant } from '@/features/report';
import type { Inspection } from '@/types/inspection';

// 결과 화면 본문 조립: query의 선택 상태(?tab=, ?issue=, ?task=)를 읽고 바꾸며 feature들을 연결한다(WIREFRAME 8장).
// feature끼리는 import하지 않으므로 태스크 탭과 Issue Detail 패널은 여기서 만들어 ReportView의 슬롯에 넣는다.
// /report/[id](polling), /report/sample(정적 JSON, T13), /report/showcase/[name](정적 JSON, T14)이 함께 쓴다.

interface ReportContentProps {
  inspection: Inspection;
  variant: ReportVariant;
  selection: ReportSelection;
  banner?: ReactNode;
}

export function ReportContent({ inspection, variant, selection, banner }: ReportContentProps) {
  const pathname = usePathname();

  // 선택 상태는 replace로 바꿔 뒤로 가기 기록이 쌓이지 않게 한다(T12 2.2). Next.js가 replaceState를 useSearchParams에 반영한다
  const updateSelection = useCallback(
    (patch: Partial<ReportSelection>) => {
      const next = { ...selection, ...patch };
      window.history.replaceState(null, '', `${pathname}${selectionSearch(next)}`);
    },
    [selection, pathname],
  );

  const issue = selection.issueId ? inspection.issues.find((i) => i.id === selection.issueId) ?? null : null;

  return (
    <ReportView
      inspection={inspection}
      variant={variant}
      selection={selection}
      onSelectionChange={updateSelection}
      banner={banner}
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
  );
}

/** 이미 받은 문서로 선택 상태를 읽어 그린다 (/report/sample, /report/showcase/[name]) */
export function StaticReportContent({
  inspection,
  banner,
  variant = 'sample',
}: {
  inspection: Inspection;
  banner?: ReactNode;
  variant?: Exclude<ReportVariant, 'live'>;
}) {
  const searchParams = useSearchParams();
  return <ReportContent inspection={inspection} variant={variant} selection={parseSelection(searchParams, inspection)} banner={banner} />;
}
