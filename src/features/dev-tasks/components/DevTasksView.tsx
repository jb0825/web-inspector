'use client';

import { useState } from 'react';
import { TASK_TAB_MESSAGES } from '@/components/inspection/labels';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { Inspection } from '@/types/inspection';
import { buildTaskList, resolveSelectedTask, titleSourceDisplay } from '../logic';
import { TaskDetail } from './TaskDetail';
import { TaskList } from './TaskList';

// WIREFRAME 7장. 넓은 화면(≥1024px)은 목록 + 상세 2열, 좁은 화면은 목록 → 상세 2단계.
// 좁은 화면에서 상세는 태스크를 명시적으로 골랐을 때(?task=)만 보인다.

interface DevTasksViewProps {
  inspection: Inspection;
  /** ?task= 로 고른 태스크. 없으면 넓은 화면은 첫 번째 태스크를 보여준다 */
  selectedTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  onOpenIssue: (issueId: string) => void;
  onShowIssues: () => void;
}

export function DevTasksView({ inspection, selectedTaskId, onSelectTask, onOpenIssue, onShowIssues }: DevTasksViewProps) {
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  const analyzing = inspection.status === 'analyzing';

  // WIREFRAME 7.7 상태
  if (analyzing) {
    return (
      <p className="flex items-center gap-2 py-6 text-body text-text-secondary" role="status">
        <Spinner />
        {TASK_TAB_MESSAGES.analyzing}
      </p>
    );
  }
  if (inspection.issues.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-6">
        <p className="text-body text-text-secondary">{TASK_TAB_MESSAGES.empty}</p>
        <Button variant="secondary" size="sm" className="min-h-11 sm:min-h-8" onClick={onShowIssues}>
          이슈 탭으로 이동
        </Button>
      </div>
    );
  }
  const analysisFailed = inspection.analysis.status === 'failed';
  if (inspection.tasks.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3 py-6">
        <p className="text-body text-text-secondary">{analysisFailed ? TASK_TAB_MESSAGES.analysisFailedNoTasks : TASK_TAB_MESSAGES.empty}</p>
        <Button variant="secondary" size="sm" className="min-h-11 sm:min-h-8" onClick={onShowIssues}>
          이슈 탭으로 이동
        </Button>
      </div>
    );
  }

  const list = buildTaskList(inspection.tasks, showNeedsReview);
  const selected = resolveSelectedTask(list, selectedTaskId);
  const titleDisplay = titleSourceDisplay([...list.regular, ...list.needsReview]);
  const explicit = selectedTaskId !== null && selected?.id === selectedTaskId;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body text-text-secondary">
          태스크 <span className="tabular-nums text-text-primary">{list.visibleTaskCount}</span>개 · 이슈{' '}
          <span className="tabular-nums text-text-primary">{list.visibleIssueCount}</span>개
        </p>
        {list.needsReviewTotal > 0 ? (
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-body-sm sm:min-h-8">
            <input
              type="checkbox"
              checked={showNeedsReview}
              onChange={(event) => setShowNeedsReview(event.target.checked)}
              className="size-4 accent-accent-solid"
            />
            검토 필요 태스크 표시
          </label>
        ) : null}
      </div>
      {analysisFailed ? <Notice tone="warning" title={TASK_TAB_MESSAGES.analysisFailed} /> : null}
      {titleDisplay === 'notice' ? <p className="text-caption text-text-secondary">{TASK_TAB_MESSAGES.allTemplateTitles}</p> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className={cn('min-w-0 lg:col-span-1 lg:block', explicit ? 'hidden' : 'block')}>
          <TaskList regular={list.regular} needsReview={list.needsReview} selectedId={selected?.id ?? null} showTemplateMark={titleDisplay === 'per-item'} onSelect={onSelectTask} />
        </div>
        <div className={cn('min-w-0 lg:col-span-2 lg:block', explicit ? 'block' : 'hidden')}>
          {selected ? <TaskDetail task={selected} issues={inspection.issues} analyzing={analyzing} onOpenIssue={onOpenIssue} onBack={() => onSelectTask(null)} /> : null}
        </div>
      </div>
    </div>
  );
}
