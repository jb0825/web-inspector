'use client';

import { ArrowLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { AnalysisBadges, AnalysisContent } from '@/components/inspection/AnalysisContent';
import { ConfidenceText, PriorityBadge, ViewportTagBadge } from '@/components/inspection/badges';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { Inspection, Issue } from '@/types/inspection';
import { taskForIssue } from '../crop';
import { EvidenceBlock } from './EvidenceBlock';
import { SourceHints } from './SourceHints';

// WIREFRAME 6장. 넓은 화면(≥1024px): 오른쪽 고정 패널(480px, 본문은 왼쪽에서 계속 스크롤)
// Tablet: 오른쪽 오버레이 패널(shadow-lg), Mobile: 전체 화면 시트("← 결과로") — DESIGN_GUIDE 6.7

interface IssueDetailPanelProps {
  inspection: Inspection;
  issue: Issue;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  /** 닫은 뒤 포커스를 돌려줄 요소를 찾는다 (선택했던 목록 항목) */
  findReturnTarget?: (issueId: string) => HTMLElement | null;
}

function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-h3 font-semibold">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function IssueDetailPanel({ inspection, issue, onClose, onOpenTask, findReturnTarget }: IssueDetailPanelProps) {
  const titleId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // 처음 열 때 패널을 연 요소를 기억한다(닫을 때 목록 항목이 없으면 이 요소로 돌아간다)
  useEffect(() => {
    openerRef.current = document.activeElement;
  }, []);

  // 열 때와 다른 이슈로 바뀔 때 패널 제목으로 포커스를 옮기고 맨 위로 스크롤한다
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [issue.id]);

  const issueId = issue.id;
  function close() {
    const target = findReturnTarget?.(issueId) ?? (openerRef.current instanceof HTMLElement ? openerRef.current : null);
    onCloseRef.current();
    requestAnimationFrame(() => target?.focus());
  }
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const analyzing = inspection.status === 'analyzing';
  const task = taskForIssue(inspection.tasks, issue.id);

  return (
    <aside
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex flex-col bg-surface sm:left-auto sm:w-120 sm:border-l sm:border-border sm:shadow-lg lg:shadow-none"
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
        <button
          type="button"
          onClick={close}
          className="inline-flex min-h-11 items-center gap-1 rounded-md text-body font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid sm:hidden"
        >
          <ArrowLeft aria-hidden size={16} strokeWidth={1.75} />
          결과로
        </button>
        <span className="hidden text-body-sm font-medium text-text-secondary sm:inline">이슈 상세</span>
        <button
          type="button"
          onClick={close}
          aria-label="이슈 상세 닫기"
          className="hidden size-11 items-center justify-center rounded-md text-text-secondary hover:bg-background-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid sm:inline-flex sm:size-8"
        >
          <X aria-hidden size={16} strokeWidth={1.75} />
        </button>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-4 sm:px-6">
        <header className="flex flex-col gap-2">
          <p className="font-mono text-caption text-text-secondary">{issue.id}</p>
          <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-h2 font-semibold wrap-anywhere focus:outline-none">
            {issue.title}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={issue.priority} />
            <ViewportTagBadge tag={issue.viewportTag} />
            <ConfidenceText confidence={issue.confidence} always />
            {issue.needsReview ? <span className="text-caption text-text-secondary">검토 필요</span> : null}
          </div>
        </header>

        <Section title="Evidence" aside={<span className="text-caption text-text-secondary">브라우저에서 측정한 값</span>}>
          <div className="flex flex-col gap-6">
            {issue.occurrences.map((occurrence) => (
              <EvidenceBlock key={occurrence.viewport} occurrence={occurrence} screenshot={inspection.viewports[occurrence.viewport]} priority={issue.priority} />
            ))}
          </div>
          {issue.affectedDescendants !== undefined && issue.affectedDescendants > 0 ? (
            <p className="text-body-sm text-text-secondary">
              이 요소 때문에 함께 넘친 하위 요소 <span className="tabular-nums text-text-primary">{issue.affectedDescendants}</span>개
            </p>
          ) : null}
        </Section>

        <Section title="소스에서 찾기">
          <SourceHints hints={issue.sourceHints} />
        </Section>

        {/* 측정 영역과 다른 배경으로 추정임을 구분한다(DESIGN_GUIDE 6.13) */}
        <section className="flex flex-col gap-3 rounded-lg bg-background-secondary p-4" aria-label="원인 분석">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-h3 font-semibold">원인 분석</h3>
            {issue.analysis ? <AnalysisBadges analysis={issue.analysis} /> : null}
          </div>
          <AnalysisContent issue={issue} analyzing={analyzing} />
        </section>

        <Section title="관련 개발 태스크">
          {task ? (
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-background-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
            >
              <span className="font-mono text-caption text-text-secondary">{task.id}</span>
              <span className="min-w-0 flex-1 text-body wrap-anywhere">{task.title}</span>
              <PriorityBadge priority={task.priority} />
              <ChevronRight aria-hidden size={16} strokeWidth={1.75} className="shrink-0 text-text-tertiary" />
            </button>
          ) : analyzing ? (
            <p className="flex items-center gap-2 text-body-sm text-text-secondary" role="status">
              <Spinner size={14} />
              태스크 생성 중
            </p>
          ) : (
            <p className="text-body-sm text-text-secondary">이 이슈가 속한 태스크가 없습니다.</p>
          )}
        </Section>
      </div>
    </aside>
  );
}
