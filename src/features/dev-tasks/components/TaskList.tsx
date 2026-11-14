import { PriorityBadge, ViewportTagBadge } from '@/components/inspection/badges';
import { TASK_TAB_MESSAGES } from '@/components/inspection/labels';
import { cn } from '@/lib/utils';
import type { DevTask } from '@/types/inspection';

// WIREFRAME 7.4, DESIGN_GUIDE 6.8 Selected

function TaskItem({ task, selected, showTemplateMark, onSelect }: { task: DevTask; selected: boolean; showTemplateMark: boolean; onSelect: (id: string) => void }) {
  return (
    <li className="border-b border-border">
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(task.id)}
        className={cn(
          'flex w-full min-w-0 flex-col gap-1 border-l-3 py-3 pr-3 pl-3 text-left',
          'transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-solid',
          selected ? 'border-accent-solid bg-accent-tint' : 'border-transparent hover:bg-background-secondary',
        )}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-caption text-text-secondary">{task.id}</span>
          <PriorityBadge priority={task.priority} />
          {showTemplateMark && task.titleSource === 'template' ? <span className="text-caption text-text-tertiary">{TASK_TAB_MESSAGES.templateTitle}</span> : null}
        </span>
        <span className={cn('text-body font-medium wrap-anywhere', task.needsReview && 'text-text-secondary')}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-2 text-caption text-text-secondary">
          이슈 <span className="tabular-nums">{task.issueIds.length}</span>
          <ViewportTagBadge tag={task.viewportTag} hideWhenNull />
        </span>
      </button>
    </li>
  );
}

interface TaskListProps {
  regular: readonly DevTask[];
  needsReview: readonly DevTask[];
  selectedId: string | null;
  showTemplateMark: boolean;
  onSelect: (id: string) => void;
}

export function TaskList({ regular, needsReview, selectedId, showTemplateMark, onSelect }: TaskListProps) {
  return (
    <nav aria-label="태스크 목록" className="flex flex-col">
      <ul className="flex flex-col border-t border-border">
        {regular.map((task) => (
          <TaskItem key={task.id} task={task} selected={task.id === selectedId} showTemplateMark={showTemplateMark} onSelect={onSelect} />
        ))}
      </ul>
      {needsReview.length > 0 ? (
        <>
          <p className="mt-4 border-t-2 border-border-strong pt-2 pb-1 text-body-sm font-medium text-text-secondary">검토 필요 태스크</p>
          <ul className="flex flex-col border-t border-border">
            {needsReview.map((task) => (
              <TaskItem key={task.id} task={task} selected={task.id === selectedId} showTemplateMark={showTemplateMark} onSelect={onSelect} />
            ))}
          </ul>
        </>
      ) : null}
    </nav>
  );
}
