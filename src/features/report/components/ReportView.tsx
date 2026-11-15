'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { SHARE_DISCLOSURE } from '@/components/inspection/labels';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';
import type { Inspection, Priority } from '@/types/inspection';
import { buildIssueList, EMPTY_FILTER, isViewportFilterAvailable, summarizeIssues, type IssueFilter } from '../logic/issues';
import { buildScopeNotices } from '../logic/scope';
import type { ReportSelection, ReportTab } from '../logic/selection';
import { IssueFilters } from './IssueFilters';
import { IssueList, NeedsReviewGroup } from './IssueList';
import { ReportHeader } from './ReportHeader';
import { NoIssuesState } from './ReportStates';
import { ScopeNotice } from './ScopeNotice';
import { SummaryBar } from './SummaryBar';
import { ViewportComparison } from './ViewportComparison';

// WIREFRAME 5장. Inspection 문서와 선택 상태를 props로 받아 그리기만 한다(fetch·polling 없음).
// 개발 태스크 탭과 Issue Detail 패널은 다른 feature라 app/ 페이지가 만들어 슬롯으로 넘긴다(AGENTS.md 3.1).

export interface ReportViewProps {
  inspection: Inspection;
  /**
   * 'sample'은 /report/sample(T13), 'showcase'는 /report/showcase/[name](Before/After 사례, T14).
   * 둘 다 정적 문서라 링크 복사와 다시 검사를 숨긴다(WIREFRAME 5.13)
   */
  variant: ReportVariant;
  selection: ReportSelection;
  onSelectionChange: (patch: Partial<ReportSelection>) => void;
  /** 개발 태스크 탭 내용 */
  tasksPanel: ReactNode;
  /** 열린 Issue Detail 패널. 넓은 화면에서는 오른쪽에 고정되므로 본문 오른쪽을 비운다 */
  detailPanel: ReactNode | null;
  /** 헤더 위 안내 (샘플 리포트 안내, Before/After 사례 안내) */
  banner?: ReactNode;
}

export type ReportVariant = 'live' | 'sample' | 'showcase';

const NEEDS_REVIEW_ID = 'needs-review-group';

export function ReportView({ inspection, variant, selection, onSelectionChange, tasksPanel, detailPanel, banner }: ReportViewProps) {
  const [filter, setFilter] = useState<IssueFilter>(EMPTY_FILTER);
  const [needsReviewOpen, setNeedsReviewOpen] = useState(false);

  const viewportFilterAvailable = isViewportFilterAvailable(inspection.viewportErrors);
  // Viewport 필터를 숨긴 검사에서는 그 값을 적용하지 않는다
  const effectiveFilter = useMemo(() => (viewportFilterAvailable ? filter : { ...filter, viewportTag: null }), [filter, viewportFilterAvailable]);
  const summary = useMemo(() => summarizeIssues(inspection.issues), [inspection.issues]);
  const list = useMemo(() => buildIssueList(inspection.issues, effectiveFilter), [inspection.issues, effectiveFilter]);
  const notices = useMemo(() => buildScopeNotices(inspection), [inspection]);

  const analyzing = inspection.status === 'analyzing';
  const regularTasks = inspection.tasks.filter((task) => !task.needsReview).length;
  const hasAnyIssue = list.regularTotal + list.needsReviewTotal > 0;
  const idPrefix = `report-${inspection.id}`;

  const selectIssue = (issueId: string) => onSelectionChange({ issueId });
  const selectTab = (tab: ReportTab) => onSelectionChange({ tab });

  function applyPriority(priority: Priority | null) {
    setFilter((current) => ({ ...current, priority }));
    if (selection.tab !== 'issues') selectTab('issues');
  }

  function showNeedsReview() {
    setNeedsReviewOpen(true);
    if (selection.tab !== 'issues') selectTab('issues');
    // 그룹이 펼쳐진 뒤 위치로 이동한다
    requestAnimationFrame(() => document.getElementById(NEEDS_REVIEW_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-6', detailPanel ? 'lg:pr-120' : null)}>
      {banner}
      <ReportHeader inspection={inspection} variant={variant} />
      <ScopeNotice notices={notices} />
      <SummaryBar
        summary={summary}
        activePriority={effectiveFilter.priority}
        onPriority={applyPriority}
        onShowNeedsReview={showNeedsReview}
        viewportAvailable={{ desktop: inspection.viewports.desktop !== null, mobile: inspection.viewports.mobile !== null }}
      />
      <ViewportComparison inspection={inspection} list={list} includeNeedsReview={needsReviewOpen} selectedIssueId={selection.issueId} onSelectIssue={selectIssue} />

      <div className="flex flex-col gap-4">
        <Tabs
          label="검사 결과"
          idPrefix={idPrefix}
          value={selection.tab}
          onChange={selectTab}
          items={[
            { id: 'issues', label: '이슈', extra: <span className="text-text-secondary tabular-nums">{summary.total}</span> },
            {
              id: 'tasks',
              label: '개발 태스크',
              extra: analyzing ? (
                <span className="inline-flex items-center text-text-secondary">
                  <Spinner size={14} />
                  <span className="sr-only">생성 중</span>
                </span>
              ) : (
                <span className="text-text-secondary tabular-nums">{regularTasks}</span>
              ),
            },
          ]}
        />

        {selection.tab === 'issues' ? (
          <div role="tabpanel" id={tabPanelId(idPrefix, 'issues')} aria-labelledby={tabId(idPrefix, 'issues')} className="flex flex-col gap-4">
            {hasAnyIssue ? (
              <>
                <IssueFilters filter={effectiveFilter} onChange={setFilter} showViewport={viewportFilterAvailable} />
                {list.regular.length > 0 ? (
                  <IssueList items={list.regular} selectedIssueId={selection.issueId} onSelect={selectIssue} />
                ) : list.regularTotal > 0 ? (
                  <div className="flex flex-col items-start gap-2 py-4">
                    <p className="text-body text-text-secondary">조건에 맞는 이슈가 없습니다.</p>
                    <Button variant="secondary" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setFilter(EMPTY_FILTER)}>
                      필터 초기화
                    </Button>
                  </div>
                ) : (
                  <p className="py-4 text-body text-text-secondary">확정된 이슈는 없습니다. 아래 검토 필요 항목을 확인해 주세요.</p>
                )}
                <NeedsReviewGroup
                  id={NEEDS_REVIEW_ID}
                  items={list.needsReview}
                  total={list.needsReviewTotal}
                  open={needsReviewOpen}
                  onToggle={() => setNeedsReviewOpen((open) => !open)}
                  selectedIssueId={selection.issueId}
                  onSelect={selectIssue}
                />
              </>
            ) : (
              <NoIssuesState />
            )}
          </div>
        ) : (
          <div role="tabpanel" id={tabPanelId(idPrefix, 'tasks')} aria-labelledby={tabId(idPrefix, 'tasks')}>
            {tasksPanel}
          </div>
        )}
      </div>

      <p className="border-t border-border pt-4 text-caption text-text-secondary">{SHARE_DISCLOSURE}</p>
      {detailPanel}
    </div>
  );
}
