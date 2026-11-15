'use client';

import { useRef } from 'react';
import { useElementWidth } from '@/components/ui/useElementWidth';
import type { IssueOccurrence, Priority, ViewportResult } from '@/types/inspection';
import { boxInCrop, computeCropView } from '../crop';

// PRD 5.4.1, DESIGN_GUIDE 9.3: 전체 스크린샷을 cropRect 영역만 보이게 잘라 표시하고 대상 박스를 그린다.
// 대상은 Selected 스타일, Overlap의 상대 요소는 기본 스타일(Priority 색)로 함께 그린다.

const STROKE: Record<Priority, string> = { P0: 'stroke-p0-solid', P1: 'stroke-p1-solid', P2: 'stroke-p2-solid', P3: 'stroke-p3-solid' };

export function CropView({ occurrence, screenshot, priority, label }: { occurrence: IssueOccurrence; screenshot: ViewportResult | null; priority: Priority; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const crop = occurrence.cropRect;

  const image =
    screenshot && screenshot.screenshotUrl !== null && screenshot.screenshotWidth !== null && screenshot.screenshotHeight !== null
      ? { url: screenshot.screenshotUrl, width: screenshot.screenshotWidth, height: screenshot.screenshotHeight }
      : null;

  // 사진 / 배치도 판정(evidenceView)이 사진일 때만 이 컴포넌트를 쓴다. 크롭이 없으면 그리지 않는다
  if (!crop || !image) return null;

  const view = computeCropView(crop, { width: image.width, height: image.height }, width);
  const target = view ? boxInCrop(occurrence.boundingBox, crop, view.scale) : null;
  const partners = view
    ? occurrence.relatedElements
        .filter((r) => r.role === 'overlap-target')
        .slice(0, 1)
        .map((r) => boxInCrop(r.boundingBox, crop, view.scale))
        .filter((b) => b !== null)
    : [];

  return (
    <div ref={containerRef} className="w-full">
      {view ? (
        <div className="relative mx-auto overflow-hidden rounded-md border border-border bg-background-secondary" style={{ width: view.width, height: view.height }}>
          {/* 크롭 이미지를 따로 만들지 않고 전체 스크린샷을 옮겨 보여준다. next/image 최적화를 쓰지 않는다(T12 2.3) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            width={image.width}
            height={image.height}
            loading="lazy"
            decoding="async"
            alt={`${label} 하이라이트`}
            className="absolute max-w-none"
            style={{ left: view.image.left, top: view.image.top, width: view.image.width, height: view.image.height }}
          />
          <svg aria-hidden width={view.width} height={view.height} className="absolute inset-0">
            {partners.map((box, index) => (
              <g key={index}>
                <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="none" className="stroke-background" strokeWidth={4} />
                <rect x={box.x} y={box.y} width={box.width} height={box.height} fill="none" className={STROKE[priority]} strokeWidth={2} />
              </g>
            ))}
            {target ? (
              <g>
                <rect x={target.x} y={target.y} width={target.width} height={target.height} fill="none" className="stroke-background" strokeWidth={5} />
                <rect x={target.x} y={target.y} width={target.width} height={target.height} className="fill-accent-solid/12 stroke-accent-solid" strokeWidth={3} />
              </g>
            ) : null}
          </svg>
        </div>
      ) : (
        <div className="h-40 rounded-md bg-background-secondary" />
      )}
    </div>
  );
}
