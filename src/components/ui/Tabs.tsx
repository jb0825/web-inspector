'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 6.9: 텍스트 탭 + 활성 탭 아래 2px accent-solid 밑줄. WAI-ARIA Tabs 패턴(좌우 방향키, Home/End)

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** 라벨 옆 보조 표시(개수, 진행 표시) */
  extra?: ReactNode;
}

interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** 탭과 패널 id의 접두어. 패널은 `${idPrefix}-panel-${id}`, 탭은 `${idPrefix}-tab-${id}` */
  idPrefix: string;
  label: string;
  className?: string;
  size?: 'md' | 'sm';
}

export function tabId(idPrefix: string, id: string): string {
  return `${idPrefix}-tab-${id}`;
}

export function tabPanelId(idPrefix: string, id: string): string {
  return `${idPrefix}-panel-${id}`;
}

export function Tabs<T extends string>({ items, value, onChange, idPrefix, label, className, size = 'md' }: TabsProps<T>) {
  const refs = useRef(new Map<T, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.id);
    refs.current.get(item.id)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex gap-4 border-b border-border', className)}>
      {items.map((item) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              if (node) refs.current.set(item.id, node);
              else refs.current.delete(item.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, item.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, item.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.id)}
            className={cn(
              '-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 font-medium whitespace-nowrap',
              'transition-colors duration-(--duration-fast) ease-standard',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid',
              size === 'md' ? 'text-body' : 'text-body-sm',
              selected ? 'border-accent-solid text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            {item.label}
            {item.extra}
          </button>
        );
      })}
    </div>
  );
}
