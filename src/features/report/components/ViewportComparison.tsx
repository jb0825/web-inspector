'use client';

import { useState } from 'react';
import { VIEWPORT_LABELS } from '@/components/inspection/labels';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';
import type { Inspection, Viewport } from '@/types/inspection';
import { PRIORITY_COLORS, SCHEMATIC_COLORS as C } from '@/lib/schematic';
import type { IssueListModel } from '../logic/issues';
import { ScreenshotViewer } from './ScreenshotViewer';

// WIREFRAME 5.6, 10장: Desktop(≥1024px)은 좌우 배치(약 2:1), 그보다 좁으면 Desktop / Mobile 탭으로 전환한다

const VIEWPORTS: readonly Viewport[] = ['desktop', 'mobile'];
const DEFAULT_SIZE: Record<Viewport, { width: number; height: number }> = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

interface ViewportComparisonProps {
  inspection: Inspection;
  list: Pick<IssueListModel, 'regular' | 'needsReview'>;
  includeNeedsReview: boolean;
  selectedIssueId: string | null;
  onSelectIssue: (id: string) => void;
}

export function ViewportComparison({ inspection, list, includeNeedsReview, selectedIssueId, onSelectIssue }: ViewportComparisonProps) {
  // 좁은 화면에서 처음 보여줄 쪽: 실패하지 않은 viewport, 둘 다 있으면 Mobile(반응형 문제가 많은 쪽)
  const [active, setActive] = useState<Viewport>(inspection.viewports.mobile ? 'mobile' : 'desktop');
  const idPrefix = `preview-${inspection.id}`;

  return (
    <section aria-label="Desktop / Mobile 비교" className="flex flex-col gap-3">
      <Tabs
        className="lg:hidden"
        size="sm"
        label="미리보기"
        idPrefix={idPrefix}
        value={active}
        onChange={setActive}
        items={VIEWPORTS.map((v) => ({ id: v, label: VIEWPORT_LABELS[v] }))}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {VIEWPORTS.map((v) => (
          <div
            key={v}
            role="tabpanel"
            id={tabPanelId(idPrefix, v)}
            aria-labelledby={tabId(idPrefix, v)}
            className={cn('min-w-0 lg:block', v === 'desktop' ? 'lg:col-span-2' : 'lg:col-span-1', v === active ? 'block' : 'hidden')}
          >
            <ScreenshotViewer
              viewport={v}
              size={inspection.viewports[v] ? { width: inspection.viewports[v].width, height: inspection.viewports[v].height } : DEFAULT_SIZE[v]}
              result={inspection.viewports[v]}
              error={inspection.viewportErrors[v]}
              list={list}
              includeNeedsReview={includeNeedsReview}
              selectedIssueId={selectedIssueId}
              onSelectIssue={onSelectIssue}
            />
          </div>
        ))}
      </div>
      <PreviewLegend />
    </section>
  );
}

/** 3.2 범례 (시안 schematic-v2-mock.html의 .legend) */
function PreviewLegend() {
  const items = [
    { label: '이슈 (색 = Priority)', style: { border: `2px solid ${PRIORITY_COLORS.P0}` } },
    { label: '문제 영역', style: { background: `repeating-linear-gradient(45deg, ${C.problem} 0 2px, ${C.problemFill} 2px 5px)` } },
    { label: '첫 화면 · 화면 경계 · 사진 끝', style: { borderTop: `2px dashed ${C.blue}`, height: 0 } },
    { label: '구조 (section 등)', style: { border: `1.5px dashed ${C.struct}` } },
    { label: 'canvas', style: { background: `repeating-linear-gradient(45deg, ${C.blue} 0 1px, ${C.mediaFill} 1px 5px)` } },
  ];
  return (
    <ul aria-label="미리보기 범례" className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-secondary">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-xs" style={item.style} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
