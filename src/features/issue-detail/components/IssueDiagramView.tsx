'use client';

import { useRef } from 'react';
import { useElementWidth } from '@/components/ui/useElementWidth';
import { cn } from '@/lib/utils';
import type { Issue, IssueOccurrence, Priority } from '@/types/inspection';
import { CROP_MAX_HEIGHT_PX } from '../crop';
import { buildIssueDiagram, type DiagramShapeKind } from '../diagram';

// WIREFRAME 6.4: 스크린샷이 없는 viewport(SCREENSHOT_FAILED)의 하이라이트 자리. 저장된 측정값으로 그린 배치도다.
// 실제 화면 모습이 아니므로 안내 문구를 붙이고, 도형의 뜻은 범례로 알린다(색에만 의존하지 않는다, DESIGN_GUIDE 6.10).

const OVERFLOW_FILL: Record<Priority, string> = {
  P0: 'fill-p0-solid/25 stroke-p0-solid',
  P1: 'fill-p1-solid/25 stroke-p1-solid',
  P2: 'fill-p2-solid/25 stroke-p2-solid',
  P3: 'fill-p3-solid/25 stroke-p3-solid',
};

const SHAPE_CLASS = (kind: DiagramShapeKind, priority: Priority): string =>
  ({
    related: 'fill-transparent stroke-text-tertiary',
    target: 'fill-accent-solid/12 stroke-accent-solid',
    overflow: OVERFLOW_FILL[priority],
    intersection: OVERFLOW_FILL[priority],
  })[kind];

const SHAPE_DASH: Partial<Record<DiagramShapeKind, string>> = { related: '5 4', overflow: '3 3' };

export function IssueDiagramView({
  issue,
  occurrence,
  layoutWidth,
  label,
}: {
  issue: Pick<Issue, 'type' | 'subtype' | 'priority'>;
  occurrence: IssueOccurrence;
  layoutWidth: number;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const diagram = buildIssueDiagram(issue, occurrence, layoutWidth);
  const { region } = diagram;
  const scale = width > 0 ? Math.min(width / region.width, CROP_MAX_HEIGHT_PX / region.height) : 0;
  // 범례는 같은 뜻의 도형을 한 번만 보여준다
  const legend = diagram.shapes.filter((shape, index, all) => all.findIndex((s) => s.kind === shape.kind && s.label === shape.label) === index);

  return (
    <figure ref={containerRef} className="flex w-full flex-col gap-2">
      {scale > 0 ? (
        <svg
          role="img"
          aria-label={`${label} 이슈 배치도: ${legend.map((s) => s.label).join(', ')}`}
          viewBox={`${region.x} ${region.y} ${region.width} ${region.height}`}
          width={region.width * scale}
          height={region.height * scale}
          className="mx-auto rounded-md border border-border bg-background-tertiary"
        >
          {/* 화면(layout viewport) 안쪽. 바깥은 회색 배경으로 남는다 */}
          <rect x={0} y={region.y} width={layoutWidth} height={region.height} className="fill-background" />
          {[0, layoutWidth].map((x) => (
            <line key={x} x1={x} y1={region.y} x2={x} y2={region.y + region.height} className="stroke-text-tertiary" strokeWidth={1.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          ))}
          {diagram.shapes.map((shape, index) => (
            <rect
              key={index}
              x={shape.box.x}
              y={shape.box.y}
              width={shape.box.width}
              height={shape.box.height}
              className={SHAPE_CLASS(shape.kind, issue.priority)}
              strokeWidth={shape.kind === 'target' ? 2.5 : 1.5}
              strokeDasharray={SHAPE_DASH[shape.kind]}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : (
        <div className="h-40 rounded-md bg-background-secondary" />
      )}
      <figcaption className="flex flex-col gap-1.5 text-caption text-text-secondary">
        <span>측정값으로 그린 배치도입니다. 스크린샷을 찍지 못했습니다(SCREENSHOT_FAILED).</span>
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-3 w-0 border-l-[1.5px] border-dashed border-text-tertiary" />
            화면 경계 (0 ~ {layoutWidth}px)
          </li>
          {legend.map((shape) => (
            <li key={`${shape.kind}-${shape.label}`} className="flex items-center gap-1.5">
              <svg aria-hidden width={14} height={10} className="shrink-0">
                <rect x={1} y={1} width={12} height={8} className={cn(SHAPE_CLASS(shape.kind, issue.priority))} strokeWidth={1.5} strokeDasharray={SHAPE_DASH[shape.kind] ? '2 2' : undefined} />
              </svg>
              {shape.label}
            </li>
          ))}
        </ul>
        {diagram.notes.map((note) => (
          <span key={note}>{note}</span>
        ))}
      </figcaption>
    </figure>
  );
}
