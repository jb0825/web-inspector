import { ArrowLeft, ChevronRight } from 'lucide-react';
import { AnalysisBadges, AnalysisContent } from '@/components/inspection/AnalysisContent';
import { IssueTypeLabel, PriorityBadge, ViewportTagBadge } from '@/components/inspection/badges';
import { InlineCodeText } from '@/components/ui/MarkdownText';
import type { DevTask, Issue } from '@/types/inspection';
import { PromptEditor } from './PromptEditor';

// WIREFRAME 7.5

interface TaskDetailProps {
  task: DevTask;
  issues: readonly Issue[];
  analyzing: boolean;
  onOpenIssue: (issueId: string) => void;
  /** 좁은 화면의 "← 태스크 목록" */
  onBack: () => void;
}

export function TaskDetail({ task, issues, analyzing, onOpenIssue, onBack }: TaskDetailProps) {
  const related = task.issueIds.map((id) => issues.find((issue) => issue.id === id)).filter((issue): issue is Issue => issue !== undefined);

  return (
    <article aria-labelledby={`${task.id}-title`} className="flex min-w-0 flex-col gap-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-md text-body font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid lg:hidden"
      >
        <ArrowLeft aria-hidden size={16} strokeWidth={1.75} />
        태스크 목록
      </button>

      <header className="flex flex-col gap-2">
        <p className="font-mono text-caption text-text-secondary">{task.id}</p>
        <h2 id={`${task.id}-title`} className="text-h2 font-semibold wrap-anywhere">
          {task.title}
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-text-secondary">
          <PriorityBadge priority={task.priority} />
          <ViewportTagBadge tag={task.viewportTag} />
          <span>
            이슈 <span className="tabular-nums">{task.issueIds.length}</span>개
          </span>
          {task.needsReview ? <span>검토 필요 태스크</span> : null}
        </div>
      </header>

      <section className="flex flex-col gap-2">
        <h3 className="text-h3 font-semibold">문제 설명</h3>
        <p className="text-body whitespace-pre-line text-text-primary">
          <InlineCodeText text={task.description} />
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-h3 font-semibold">관련 이슈</h3>
        <ul className="flex flex-col border-t border-border">
          {related.map((issue) => (
            <li key={issue.id} className="border-b border-border">
              <button
                type="button"
                onClick={() => onOpenIssue(issue.id)}
                className="flex min-h-11 w-full min-w-0 items-center gap-2 px-2 py-2 text-left hover:bg-background-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-solid"
              >
                <span className="font-mono text-caption text-text-secondary">{issue.id}</span>
                <PriorityBadge priority={issue.priority} />
                <IssueTypeLabel type={issue.type} subtype={issue.subtype} className="min-w-0 truncate text-body" />
                <ChevronRight aria-hidden size={16} strokeWidth={1.75} className="ml-auto shrink-0 text-text-tertiary" />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-h3 font-semibold">이슈별 원인과 수정 제안</h3>
        <div className="flex flex-col gap-2">
          {related.map((issue) => (
            <details key={issue.id} className="group rounded-lg bg-background-secondary">
              <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 rounded-lg px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid">
                <ChevronRight aria-hidden size={16} strokeWidth={1.75} className="shrink-0 transition-transform duration-(--duration-fast) group-open:rotate-90" />
                <span className="font-mono text-caption text-text-secondary">{issue.id}</span>
                <IssueTypeLabel type={issue.type} subtype={issue.subtype} className="text-body-sm" />
                {issue.analysis ? <AnalysisBadges analysis={issue.analysis} /> : null}
              </summary>
              <div className="px-4 pb-4">
                <AnalysisContent issue={issue} analyzing={analyzing} compact />
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-h3 font-semibold">Acceptance Criteria</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body">
          {task.acceptanceCriteria.map((criterion, index) => (
            <li key={index}>
              <InlineCodeText text={criterion} />
            </li>
          ))}
        </ul>
      </section>

      <PromptEditor key={task.id} prompt={task.prompt} />
    </article>
  );
}
