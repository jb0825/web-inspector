'use client';

import { useState } from 'react';
import { VIEWPORT_LABELS } from '@/components/inspection/labels';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { cn } from '@/lib/utils';
import type { Inspection, Viewport } from '@/types/inspection';
import type { MarkerLayout } from '../logic/markers';
import { ScreenshotViewer } from './ScreenshotViewer';

// WIREFRAME 5.6, 10장: Desktop(≥1024px)은 좌우 배치(약 2:1), 그보다 좁으면 Desktop / Mobile 탭으로 전환한다

const VIEWPORTS: readonly Viewport[] = ['desktop', 'mobile'];
const DEFAULT_SIZE: Record<Viewport, { width: number; height: number }> = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

interface ViewportComparisonProps {
  inspection: Inspection;
  layouts: Record<Viewport, MarkerLayout | null>;
  selectedIssueId: string | null;
  onSelectIssue: (id: string) => void;
}

export function ViewportComparison({ inspection, layouts, selectedIssueId, onSelectIssue }: ViewportComparisonProps) {
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
              layout={layouts[v]}
              selectedIssueId={selectedIssueId}
              onSelectIssue={onSelectIssue}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
