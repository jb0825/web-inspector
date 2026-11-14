import { ISSUE_TYPE_LABELS } from '@/components/inspection/labels';
import { Button } from '@/components/ui/Button';
import type { IssueType, Priority, ViewportTag } from '@/types/inspection';
import { ISSUE_TYPES, isFilterActive, PRIORITIES, VIEWPORT_TAGS, type IssueFilter } from '../logic/issues';

// WIREFRAME 5.8: 조합 가능, query에 넣지 않는다. 한 viewport가 실패한 검사는 Viewport 필터를 숨긴다

interface IssueFiltersProps {
  filter: IssueFilter;
  onChange: (filter: IssueFilter) => void;
  showViewport: boolean;
}

const selectClass =
  'h-11 min-w-0 rounded-md border border-border-strong bg-background px-2 text-body-sm text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid sm:h-8';

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T | null) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-body-sm text-text-secondary">
      {label}
      <select className={selectClass} value={value ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : (event.target.value as T))}>
        <option value="">전체</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function IssueFilters({ filter, onChange, showViewport }: IssueFiltersProps) {
  return (
    <div role="group" aria-label="이슈 필터" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <FilterSelect<Priority>
        label="Priority"
        value={filter.priority}
        options={PRIORITIES.map((p) => ({ value: p, label: p }))}
        onChange={(priority) => onChange({ ...filter, priority })}
      />
      <FilterSelect<IssueType>
        label="Category"
        value={filter.type}
        options={ISSUE_TYPES.map((t) => ({ value: t, label: ISSUE_TYPE_LABELS[t] }))}
        onChange={(type) => onChange({ ...filter, type })}
      />
      {showViewport ? (
        <FilterSelect<ViewportTag>
          label="Viewport"
          value={filter.viewportTag}
          options={VIEWPORT_TAGS.map((t) => ({ value: t, label: t }))}
          onChange={(viewportTag) => onChange({ ...filter, viewportTag })}
        />
      ) : null}
      {isFilterActive(filter) ? (
        <Button variant="tertiary" size="sm" className="min-h-11 sm:min-h-8" onClick={() => onChange({ priority: null, type: null, viewportTag: null })}>
          필터 초기화
        </Button>
      ) : null}
    </div>
  );
}
