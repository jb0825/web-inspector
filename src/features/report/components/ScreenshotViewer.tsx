'use client';

import { useEffect, useRef, useState } from 'react';
import { ERROR_MESSAGES, errorDetail, VIEWPORT_LABELS } from '@/components/inspection/labels';
import { Spinner } from '@/components/ui/Spinner';
import { useElementWidth } from '@/components/ui/useElementWidth';
import { formatPx } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { InspectionErrorInfo, Priority, Viewport, ViewportResult } from '@/types/inspection';
import type { Marker, MarkerLayout } from '../logic/markers';

// WIREFRAME 5.6, DESIGN_GUIDE 9.1~9.2. 스크린샷 위에 SVG를 겹치고 viewBox를 스크린샷 실제 크기로 둔다.

const STROKE: Record<Priority, string> = {
  P0: 'stroke-p0-solid',
  P1: 'stroke-p1-solid',
  P2: 'stroke-p2-solid',
  P3: 'stroke-p3-solid',
};

/** 선택한 마커가 보이지 않으면 위에서 1/3 지점에 오도록 스크롤한다 */
function scrollMarkerIntoView(container: HTMLElement, marker: Marker, scale: number) {
  const top = marker.rect.y * scale;
  const bottom = (marker.rect.y + marker.rect.height) * scale;
  const viewTop = container.scrollTop;
  const viewBottom = viewTop + container.clientHeight;
  if (top >= viewTop && bottom <= viewBottom) return;
  container.scrollTo({ top: Math.max(0, top - container.clientHeight / 3), behavior: 'smooth' });
}

interface ScreenshotViewerProps {
  viewport: Viewport;
  /** 설정 크기 (1440×900 / 390×844) */
  size: { width: number; height: number };
  result: ViewportResult | null;
  error: InspectionErrorInfo | null;
  layout: MarkerLayout | null;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  className?: string;
}

export function ScreenshotViewer({ viewport, size, result, error, layout, selectedIssueId, onSelectIssue, className }: ScreenshotViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const width = useElementWidth(scrollRef);
  const [loaded, setLoaded] = useState(false);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const image =
    result && result.screenshotUrl !== null && result.screenshotWidth !== null && result.screenshotHeight !== null
      ? { url: result.screenshotUrl, width: result.screenshotWidth, height: result.screenshotHeight }
      : null;
  const scale = image && width > 0 ? width / image.width : 0;

  // hydration 전에 이미 받은(캐시된) 이미지는 load 이벤트가 오지 않는다
  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) setLoaded(true);
  }, []);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !layout || !selectedIssueId || scale === 0) return;
    const marker = layout.markers.find((m) => m.issueId === selectedIssueId);
    if (marker) scrollMarkerIntoView(container, marker, scale);
  }, [selectedIssueId, layout, scale]);

  const label = (
    <h3 className="text-label font-medium tracking-wide text-text-secondary uppercase">
      {VIEWPORT_LABELS[viewport]} <span className="font-mono tabular-nums">{`${size.width} × ${size.height}`}</span>
    </h3>
  );

  if (!result) {
    const detail = error ? errorDetail(error) : null;
    return (
      <section className={cn('flex min-w-0 flex-col gap-2', className)} aria-label={`${VIEWPORT_LABELS[viewport]} 미리보기`}>
        {label}
        <div className="flex h-120 flex-col items-center justify-center gap-1 rounded-lg bg-background-secondary px-4 text-center lg:h-160">
          <p className="text-body font-medium text-text-primary">{VIEWPORT_LABELS[viewport]} 검사에 실패했습니다</p>
          {error ? (
            <>
              <p className="text-body-sm text-text-secondary">{ERROR_MESSAGES[error.code]}</p>
              {detail ? <p className="text-body-sm text-text-secondary wrap-anywhere">{detail}</p> : null}
              <code className="font-mono text-caption text-text-tertiary">{error.code}</code>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  if (!image) {
    // 스크린샷만 실패한 viewport(SCREENSHOT_FAILED, PRD 5.2.4). 측정과 이슈는 그대로 있다
    return (
      <section className={cn('flex min-w-0 flex-col gap-2', className)} aria-label={`${VIEWPORT_LABELS[viewport]} 미리보기`}>
        {label}
        <div className="flex h-120 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-background-secondary px-4 text-center lg:h-160">
          <p className="text-body font-medium text-text-primary">{VIEWPORT_LABELS[viewport]} 스크린샷이 없습니다</p>
          <p className="text-body-sm text-text-secondary">{ERROR_MESSAGES.SCREENSHOT_FAILED}</p>
          <code className="font-mono text-caption text-text-tertiary">SCREENSHOT_FAILED</code>
        </div>
      </section>
    );
  }

  const hoveredMarker = layout?.markers.find((m) => m.issueId === hovered) ?? null;
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;

  return (
    <section className={cn('flex min-w-0 flex-col gap-2', className)} aria-label={`${VIEWPORT_LABELS[viewport]} 미리보기`}>
      {label}
      <div ref={scrollRef} className="relative h-120 overflow-x-hidden overflow-y-auto rounded-lg border border-border bg-background-secondary lg:h-160">
        <div className="relative">
          {/* 스크린샷은 세로 10,000px까지 커서 next/image 최적화를 쓰지 않는다(Hobby 플랜 사용량, T12 2.3) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={image.url}
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
            alt={`${VIEWPORT_LABELS[viewport]} 전체 페이지 스크린샷`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailedToLoad(true)}
            className="block h-auto w-full"
          />
          {!loaded && !failedToLoad ? (
            <div className="absolute inset-x-0 top-0 flex justify-center pt-6 text-text-secondary" role="status">
              <Spinner />
              <span className="sr-only">스크린샷을 불러오는 중입니다</span>
            </div>
          ) : null}
          {failedToLoad ? (
            <p className="absolute inset-x-0 top-0 p-6 text-center text-body-sm text-text-secondary">스크린샷을 불러오지 못했습니다.</p>
          ) : null}
          {layout ? (
            <>
              {/* 마커는 키보드로 고를 수 없어도 된다. 같은 기능을 이슈 목록이 제공한다(WIREFRAME 11.4) */}
              <svg
                aria-hidden
                viewBox={`0 0 ${layout.viewBox.width} ${layout.viewBox.height}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
              >
                {layout.markers.map((marker) => {
                  const selected = marker.issueId === selectedIssueId;
                  const hover = marker.issueId === hovered;
                  const { x, y, width: w, height: h } = marker.rect;
                  return (
                    <g
                      key={marker.issueId}
                      className={cn('cursor-pointer', marker.needsReview && !selected && 'opacity-60')}
                      onClick={() => onSelectIssue(marker.issueId)}
                      onMouseEnter={() => setHovered(marker.issueId)}
                      onMouseLeave={() => setHovered((current) => (current === marker.issueId ? null : current))}
                    >
                      {/* 어떤 배경에서도 보이도록 흰색 halo를 먼저 그린다(DESIGN_GUIDE 9.2) */}
                      <rect x={x} y={y} width={w} height={h} fill="none" className="stroke-background" strokeWidth={selected || hover ? 5 : 4} vectorEffect="non-scaling-stroke" />
                      <rect
                        x={x}
                        y={y}
                        width={w}
                        height={h}
                        vectorEffect="non-scaling-stroke"
                        strokeDasharray={marker.needsReview && !selected ? '4 3' : undefined}
                        strokeWidth={selected || hover ? 3 : marker.needsReview ? 1.5 : 2}
                        className={cn(
                          selected ? 'fill-accent-solid/12 stroke-accent-solid' : 'fill-transparent',
                          !selected && (marker.needsReview ? 'stroke-neutral-solid' : STROKE[marker.priority]),
                        )}
                        pointerEvents="all"
                      />
                    </g>
                  );
                })}
              </svg>
              {layout.markers.map((marker) => (
                <span
                  key={marker.issueId}
                  aria-hidden
                  onClick={() => onSelectIssue(marker.issueId)}
                  onMouseEnter={() => setHovered(marker.issueId)}
                  onMouseLeave={() => setHovered((current) => (current === marker.issueId ? null : current))}
                  style={{ left: pct(marker.rect.x, layout.viewBox.width), top: pct(marker.rect.y, layout.viewBox.height) }}
                  className={cn(
                    'absolute flex size-5 cursor-pointer items-center justify-center rounded-full text-label font-medium text-background tabular-nums ring-1 ring-background',
                    marker.issueId === selectedIssueId ? 'bg-accent' : 'bg-text-primary',
                    marker.needsReview && marker.issueId !== selectedIssueId && 'opacity-60',
                  )}
                >
                  {marker.number}
                </span>
              ))}
              {hoveredMarker ? <MarkerTooltip marker={hoveredMarker} viewBox={layout.viewBox} /> : null}
            </>
          ) : null}
        </div>
        {result.screenshotTruncated ? (
          <p className="border-t-2 border-dashed border-border-strong px-3 py-2 text-center text-caption text-text-secondary">
            스크린샷 끝 (<span className="font-mono tabular-nums">{formatPx(image.height)}px</span>)
          </p>
        ) : null}
      </div>
      {layout ? (
        <p className="text-caption text-text-secondary">
          이슈 <span className="tabular-nums">{layout.issueCount}</span>
          {layout.outOfRange > 0 ? (
            <>
              {' · '}범위 밖 <span className="tabular-nums">{layout.outOfRange}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/** DESIGN_GUIDE 6.10: 핵심 정보를 툴팁에만 두지 않는다. 같은 제목이 이슈 목록에 있다 */
function MarkerTooltip({ marker, viewBox }: { marker: Marker; viewBox: { width: number; height: number } }) {
  const { x, y, width, height } = marker.rect;
  const right = x + width / 2 > viewBox.width / 2;
  const style = {
    top: `${((y + height) / viewBox.height) * 100}%`,
    ...(right ? { right: `${(1 - (x + width) / viewBox.width) * 100}%` } : { left: `${(x / viewBox.width) * 100}%` }),
  };
  return (
    <div role="tooltip" style={style} className="pointer-events-none absolute z-10 mt-1 max-w-64 rounded-md bg-text-primary px-2 py-1 text-body-sm text-background shadow-md wrap-anywhere">
      <span className="font-mono tabular-nums">{marker.number}</span> · {marker.title}
    </div>
  );
}
