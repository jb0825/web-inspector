'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ERROR_MESSAGES, errorDetail, VIEWPORT_LABELS } from '@/components/inspection/labels';
import { BlueChip, DashedLine, SchematicDefs, SchematicLayer } from '@/components/inspection/SchematicLayer';
import { Spinner } from '@/components/ui/Spinner';
import { useElementWidth } from '@/components/ui/useElementWidth';
import { formatPx } from '@/lib/format';
import { PHOTO_FADE_PX, PRIORITY_COLORS, SCHEMATIC_COLORS } from '@/lib/schematic';
import { cn } from '@/lib/utils';
import type { InspectionErrorInfo, Viewport, ViewportResult } from '@/types/inspection';
import type { IssueListModel } from '../logic/issues';
import { layoutMarkers, occurrenceOf, type Marker } from '../logic/markers';
import { previewFooter, previewGeometry, PREVIEW_MODE_LABELS, type PreviewGeometry } from '../logic/preview';

// WIREFRAME 5.6, DESIGN_GUIDE 9.1~9.2. 미리보기는 사진 / 사진 + 아래쪽 도면 / 도면 중 하나이고, 어떤 경우에도 페이지 끝까지 보인다.
// 사진과 도면, 마커가 같은 좌표계(문서 px × 배율)를 쓴다. 도면의 선과 글자는 화면 px로 고정한다(src/lib/schematic.ts).

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
  list: Pick<IssueListModel, 'regular' | 'needsReview'>;
  includeNeedsReview: boolean;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
  className?: string;
}

export function ScreenshotViewer({ viewport, size, result, error, list, includeNeedsReview, selectedIssueId, onSelectIssue, className }: ScreenshotViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(scrollRef);
  const [forceSchematic, setForceSchematic] = useState(false);

  const geometry = useMemo(() => {
    if (!result) return null;
    const candidates = includeNeedsReview ? [...list.regular, ...list.needsReview] : list.regular;
    const boxes = candidates.flatMap(({ issue }) => {
      const box = occurrenceOf(issue, viewport)?.boundingBox;
      return box ? [box] : [];
    });
    return previewGeometry(result, boxes, forceSchematic);
  }, [result, list, includeNeedsReview, viewport, forceSchematic]);
  const layout = useMemo(
    () => (geometry ? layoutMarkers(list, viewport, { screenshotWidth: geometry.width, screenshotHeight: geometry.height }, { includeNeedsReview }) : null),
    [geometry, list, viewport, includeNeedsReview],
  );
  const scale = geometry && geometry.width > 0 && width > 0 ? width / geometry.width : 0;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container || !layout || !selectedIssueId || scale === 0) return;
    const marker = layout.markers.find((m) => m.issueId === selectedIssueId);
    if (marker) scrollMarkerIntoView(container, marker, scale);
  }, [selectedIssueId, layout, scale]);

  const title = (
    <h3 className="text-label font-medium tracking-wide text-text-secondary uppercase">
      {VIEWPORT_LABELS[viewport]} <span className="font-mono tabular-nums">{`${size.width} × ${size.height}`}</span>
    </h3>
  );

  if (!result || !geometry || !layout) {
    const detail = error ? errorDetail(error) : null;
    return (
      <section className={cn('flex min-w-0 flex-col gap-2', className)} aria-label={`${VIEWPORT_LABELS[viewport]} 미리보기`}>
        {title}
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

  const hasPhoto = result.screenshotUrl !== null;
  const modeLabel = forceSchematic ? '배치도' : PREVIEW_MODE_LABELS[geometry.mode];

  return (
    <section className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background', className)} aria-label={`${VIEWPORT_LABELS[viewport]} 미리보기`}>
      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        {title}
        <span className="text-label font-semibold text-accent">{modeLabel}</span>
      </div>
      <div ref={scrollRef} className="relative h-120 overflow-x-hidden overflow-y-auto bg-white lg:h-160">
        {scale > 0 ? (
          <PreviewCanvas
            viewport={viewport}
            geometry={geometry}
            scale={scale}
            width={width}
            markers={layout.markers}
            selectedIssueId={selectedIssueId}
            onSelectIssue={onSelectIssue}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
        <p className="text-caption text-text-secondary">
          {previewFooter(geometry, result.documentHeight, layout.issueCount, formatPx)}
          {layout.outOfRange > 0 ? (
            <>
              {' · '}범위 밖 <span className="tabular-nums">{layout.outOfRange}</span>
            </>
          ) : null}
        </p>
        {hasPhoto ? (
          // 6번(Should): 스크린샷이 있는 viewport는 사진과 배치도를 바꿔 볼 수 있다. 기본은 사진
          <div role="group" aria-label="미리보기 방식" className="flex overflow-hidden rounded-md border border-border text-caption">
            {[
              { value: false, label: '사진' },
              { value: true, label: '배치도' },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={forceSchematic === option.value}
                onClick={() => setForceSchematic(option.value)}
                className={cn('min-h-8 px-2 sm:min-h-6', forceSchematic === option.value ? 'bg-background-secondary font-semibold text-text-primary' : 'text-text-secondary')}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PreviewCanvas({
  viewport,
  geometry,
  scale,
  width,
  markers,
  selectedIssueId,
  onSelectIssue,
}: {
  viewport: Viewport;
  geometry: PreviewGeometry;
  scale: number;
  width: number;
  markers: Marker[];
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string) => void;
}) {
  const idPrefix = `schem-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const imageRef = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const height = geometry.height * scale;
  const { photo, mode, schematicFrom: from } = geometry;
  const frame = { scale, originX: 0, originY: 0 };
  const boundary = from * scale;

  // hydration 전에 이미 받은(캐시된) 이미지는 load 이벤트가 오지 않는다
  useEffect(() => {
    if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) setLoaded(true);
  }, []);

  const hoveredMarker = markers.find((m) => m.issueId === hovered) ?? null;
  const pct = (value: number, total: number) => `${(value / total) * 100}%`;
  const vb = { width: geometry.width, height: geometry.height };

  return (
    <div className="relative" style={{ height }}>
      {photo && mode !== 'schematic' ? (
        <>
          {/* 스크린샷은 세로 10,000px까지 커서 next/image 최적화를 쓰지 않는다(Hobby 플랜 사용량, T12 2.3) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={imageRef}
            src={photo.url}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            alt={`${VIEWPORT_LABELS[viewport]} 전체 페이지 스크린샷`}
            onLoad={() => setLoaded(true)}
            onError={() => setFailedToLoad(true)}
            className="absolute top-0 left-0 block max-w-none"
            style={{ width: photo.width * scale, height: photo.height * scale }}
          />
          {!loaded && !failedToLoad ? (
            <div className="absolute inset-x-0 top-0 flex justify-center pt-6 text-text-secondary" role="status">
              <Spinner />
              <span className="sr-only">스크린샷을 불러오는 중입니다</span>
            </div>
          ) : null}
          {failedToLoad ? <p className="absolute inset-x-0 top-0 p-6 text-center text-body-sm text-text-secondary">스크린샷을 불러오지 못했습니다.</p> : null}
        </>
      ) : null}

      {mode !== 'photo' ? (
        <svg
          role="img"
          aria-label={`${VIEWPORT_LABELS[viewport]} 페이지 배치도: 너비 ${formatPx(geometry.layoutWidth)}px, ${mode === 'hybrid' ? `${formatPx(from)}px 아래부터` : '문서 전체'}`}
          width={width}
          height={height}
          className="absolute top-0 left-0 block"
        >
          <SchematicDefs idPrefix={idPrefix} />
          <rect x={0} y={boundary} width={width} height={Math.max(0, height - boundary)} fill="#fff" />
          <SchematicLayer
            idPrefix={idPrefix}
            frame={frame}
            pageWidth={geometry.width}
            layoutWidth={geometry.layoutWidth}
            from={from}
            to={geometry.height}
            blocks={geometry.blocks}
            firstScreen={geometry.firstScreen}
            layoutEnd={geometry.layoutEnd}
            chipRight={width}
          />
        </svg>
      ) : null}

      {mode === 'hybrid' ? (
        <>
          {/* 사진 아래쪽 60px를 흐리게 하고, 경계에 파란 점선과 칩을 둔다 (3.1) */}
          <div aria-hidden className="pointer-events-none absolute left-0" style={{ top: boundary - PHOTO_FADE_PX, height: PHOTO_FADE_PX, width, background: 'linear-gradient(to bottom, rgba(255,255,255,0), #fff)' }} />
          <svg aria-hidden width={width} height={22} className="pointer-events-none absolute left-0" style={{ top: boundary - 11 }}>
            <DashedLine x1={0} y1={11} x2={width} y2={11} />
            <BlueChip right={width - 12} cy={11} text={`여기부터 배치도 (${formatPx(from)}px~)`} size={10.5} weight={700} />
          </svg>
        </>
      ) : null}

      {geometry.fallback && mode !== 'photo' ? (
        <div
          className="pointer-events-none absolute inset-x-4 rounded-lg border border-border bg-white/95 px-3 py-2.5 text-center text-body-sm shadow-xs"
          style={{ top: mode === 'hybrid' ? boundary + 40 : 110, color: SCHEMATIC_COLORS.headingText }}
        >
          {geometry.fallback.lines.map((line, i) => (
            <p key={i} className={i >= geometry.fallback!.mutedFrom ? 'text-text-secondary' : undefined}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* 이슈 박스. 마커는 키보드로 고를 수 없어도 된다. 같은 기능을 이슈 목록이 제공한다(WIREFRAME 11.4) */}
      <svg aria-hidden viewBox={`0 0 ${vb.width} ${vb.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {markers.map((marker) => {
          const selected = marker.issueId === selectedIssueId;
          const hover = marker.issueId === hovered;
          const { x, y, width: w, height: h } = marker.rect;
          const color = marker.needsReview && !selected ? SCHEMATIC_COLORS.struct : PRIORITY_COLORS[marker.priority];
          // 도면 구간의 박스는 시안처럼 12% 채움, 사진 구간은 사진이 보이도록 채우지 않는다
          const inSchematic = y >= from;
          return (
            <g
              key={marker.issueId}
              className={cn('cursor-pointer', marker.needsReview && !selected && 'opacity-60')}
              onClick={() => onSelectIssue(marker.issueId)}
              onMouseEnter={() => setHovered(marker.issueId)}
              onMouseLeave={() => setHovered((current) => (current === marker.issueId ? null : current))}
            >
              {/* 어떤 배경에서도 보이도록 흰색 halo를 먼저 그린다(DESIGN_GUIDE 9.2) */}
              <rect x={x} y={y} width={w} height={h} fill="none" stroke="#fff" strokeWidth={selected || hover ? 5 : 4} vectorEffect="non-scaling-stroke" />
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                vectorEffect="non-scaling-stroke"
                strokeDasharray={marker.needsReview && !selected ? '4 3' : undefined}
                strokeWidth={selected || hover ? 3 : marker.needsReview ? 1.5 : 2}
                stroke={selected ? undefined : color}
                fill={selected ? undefined : color}
                fillOpacity={selected ? undefined : inSchematic ? 0.12 : 0}
                className={selected ? 'fill-accent-solid/12 stroke-accent-solid' : undefined}
                pointerEvents="all"
              />
            </g>
          );
        })}
      </svg>
      {markers.map((marker) => {
        const selected = marker.issueId === selectedIssueId;
        return (
          <span
            key={marker.issueId}
            aria-hidden
            onClick={() => onSelectIssue(marker.issueId)}
            onMouseEnter={() => setHovered(marker.issueId)}
            onMouseLeave={() => setHovered((current) => (current === marker.issueId ? null : current))}
            style={{
              // 왼쪽·위쪽 끝의 박스도 번호가 반쯤 잘리지 않게 한다
              left: `max(10px, ${pct(marker.rect.x, vb.width)})`,
              top: `max(10px, ${pct(marker.rect.y, vb.height)})`,
              backgroundColor: selected ? undefined : marker.needsReview ? SCHEMATIC_COLORS.struct : PRIORITY_COLORS[marker.priority],
            }}
            className={cn(
              'absolute flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-label font-bold text-white tabular-nums ring-1 ring-white',
              selected && 'bg-accent',
              marker.needsReview && !selected && 'opacity-60',
            )}
          >
            {marker.number}
          </span>
        );
      })}
      {hoveredMarker ? <MarkerTooltip marker={hoveredMarker} viewBox={vb} /> : null}
    </div>
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
