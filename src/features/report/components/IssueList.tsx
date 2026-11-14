import { ChevronDown, ChevronRight } from 'lucide-react';
import { ConfidenceText, IssueTypeLabel, PriorityBadge, ViewportTagBadge } from '@/components/inspection/badges';
import { cn } from '@/lib/utils';
import { issueTarget, type ListedIssue } from '../logic/issues';

// WIREFRAME 5.9~5.10, DESIGN_GUIDE 6.8, 6.11

/** Issue Detail 패널을 닫으면 이 속성으로 선택했던 항목을 찾아 포커스를 돌려준다 */
export const ISSUE_ROW_ATTRIBUTE = 'data-issue-row';

interface ItemProps {
  listed: ListedIssue;
  selected: boolean;
  muted?: boolean;
  onSelect: (issueId: string) => void;
}

export function IssueListItem({ listed, selected, muted = false, onSelect }: ItemProps) {
  const { issue, number } = listed;
  const target = issueTarget(issue);
  const evidence = issue.occurrences[0]?.evidenceText ?? '';
  return (
    <li className="border-b border-border">
      <button
        type="button"
        {...{ [ISSUE_ROW_ATTRIBUTE]: issue.id }}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(issue.id)}
        className={cn(
          'flex w-full min-w-0 items-start gap-3 border-l-3 py-3 pr-3 pl-2 text-left',
          'transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-solid',
          selected ? 'border-accent-solid bg-accent-tint' : 'border-transparent hover:bg-background-secondary',
        )}
      >
        <span
          aria-label={`마커 ${number}`}
          className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-label font-medium text-background tabular-nums', selected ? 'bg-accent' : 'bg-text-primary', muted && !selected && 'opacity-60')}
        >
          {number}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body', muted ? 'text-text-secondary' : 'text-text-primary')}>
            <PriorityBadge priority={issue.priority} />
            <IssueTypeLabel type={issue.type} subtype={issue.subtype} className="font-medium" />
            <span title={target.full} className="min-w-0 flex-1 basis-40 truncate font-mono text-code">
              {target.label}
            </span>
            <ViewportTagBadge tag={issue.viewportTag} hideWhenNull />
            <ConfidenceText confidence={issue.confidence} always={issue.needsReview} />
            <span className="sr-only">({issue.id})</span>
          </span>
          <span title={evidence} className="truncate text-body-sm text-text-secondary">
            {evidence}
          </span>
        </span>
        <ChevronRight aria-hidden size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-text-tertiary" />
      </button>
    </li>
  );
}

export function IssueList({ items, selectedIssueId, onSelect }: { items: readonly ListedIssue[]; selectedIssueId: string | null; onSelect: (id: string) => void }) {
  return (
    <ul className="flex flex-col border-t border-border">
      {items.map((listed) => (
        <IssueListItem key={listed.issue.id} listed={listed} selected={listed.issue.id === selectedIssueId} onSelect={onSelect} />
      ))}
    </ul>
  );
}

interface NeedsReviewGroupProps {
  id: string;
  items: readonly ListedIssue[];
  total: number;
  open: boolean;
  onToggle: () => void;
  selectedIssueId: string | null;
  onSelect: (id: string) => void;
}

/** 기본으로 접혀 있다. Confidence를 항상 표시한다 */
export function NeedsReviewGroup({ id, items, total, open, onToggle, selectedIssueId, onSelect }: NeedsReviewGroupProps) {
  if (total === 0) return null;
  const panelId = `${id}-items`;
  return (
    <section id={id} aria-label="검토 필요" className="flex scroll-mt-4 flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-11 items-center gap-2 rounded-md text-left text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
      >
        {open ? <ChevronDown aria-hidden size={16} strokeWidth={1.75} /> : <ChevronRight aria-hidden size={16} strokeWidth={1.75} />}
        <span className="font-medium">
          검토 필요 <span className="tabular-nums">{items.length === total ? total : `${items.length}/${total}`}</span>
        </span>
        <span className="text-body-sm text-text-secondary">— 의도된 디자인일 수 있는 항목</span>
      </button>
      {open ? (
        items.length > 0 ? (
          <ul id={panelId} className="flex flex-col border-t border-border">
            {items.map((listed) => (
              <IssueListItem key={listed.issue.id} listed={listed} muted selected={listed.issue.id === selectedIssueId} onSelect={onSelect} />
            ))}
          </ul>
        ) : (
          <p id={panelId} className="py-3 text-body-sm text-text-secondary">
            조건에 맞는 검토 필요 항목이 없습니다.
          </p>
        )
      ) : null}
    </section>
  );
}
