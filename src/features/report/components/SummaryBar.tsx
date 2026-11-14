import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Priority } from '@/types/inspection';
import { PRIORITIES, type IssueSummary } from '../logic/issues';

// WIREFRAME 5.5, DESIGN_GUIDE 10.3: 한 줄의 숫자 나열. Needs Review는 모든 개수에서 뺀다(PRD 7.3)

const PRIORITY_TEXT: Record<Priority, string> = { P0: 'text-p0-text', P1: 'text-p1-text', P2: 'text-p2-text', P3: 'text-p3-text' };

interface SummaryBarProps {
  summary: IssueSummary;
  activePriority: Priority | null;
  onPriority: (priority: Priority | null) => void;
  onShowNeedsReview: () => void;
  /** 실패한 viewport는 개수 대신 "-" */
  viewportAvailable: { desktop: boolean; mobile: boolean };
}

const chip =
  'inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 transition-colors duration-(--duration-fast) hover:bg-background-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid sm:min-h-8';

export function SummaryBar({ summary, activePriority, onPriority, onShowNeedsReview, viewportAvailable }: SummaryBarProps) {
  return (
    <section aria-label="이슈 요약" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-y border-border py-2 text-body">
      <span className="inline-flex items-center gap-1.5 px-2">
        <span className="text-text-secondary">전체</span>
        <span className="font-semibold tabular-nums">{formatCount(summary.total)}</span>
      </span>
      {PRIORITIES.map((priority) => {
        const active = activePriority === priority;
        return (
          <button
            key={priority}
            type="button"
            aria-pressed={active}
            aria-label={`${priority} ${summary.byPriority[priority]}개${active ? ', 필터 적용됨' : ''}`}
            onClick={() => onPriority(active ? null : priority)}
            className={cn(chip, active && 'bg-accent-tint hover:bg-accent-tint')}
          >
            <span className={cn('font-mono font-medium', PRIORITY_TEXT[priority])}>{priority}</span>
            <span className={cn('tabular-nums', priority === 'P0' && summary.byPriority.P0 > 0 && 'font-semibold')}>{summary.byPriority[priority]}</span>
          </button>
        );
      })}
      <span aria-hidden className="text-text-disabled">
        ·
      </span>
      {summary.needsReview > 0 ? (
        <button type="button" onClick={onShowNeedsReview} className={cn(chip, 'text-text-secondary')}>
          검토 필요 <span className="tabular-nums text-text-primary">{summary.needsReview}</span>개
        </button>
      ) : (
        <span className="px-2 text-text-secondary">
          검토 필요 <span className="tabular-nums">0</span>개
        </span>
      )}
      <span aria-hidden className="text-text-disabled">
        ·
      </span>
      <span className="px-2 text-text-secondary">
        Desktop <span className="tabular-nums text-text-primary">{viewportAvailable.desktop ? summary.byViewport.desktop : '-'}</span> / Mobile{' '}
        <span className="tabular-nums text-text-primary">{viewportAvailable.mobile ? summary.byViewport.mobile : '-'}</span>
      </span>
    </section>
  );
}
