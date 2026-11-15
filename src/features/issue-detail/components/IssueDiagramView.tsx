'use client';

import { useId, useRef } from 'react';
import { DashedLine, patternIds, SchematicChips, SchematicDefs, SchematicLayer } from '@/components/inspection/SchematicLayer';
import { useElementWidth } from '@/components/ui/useElementWidth';
import { intersectBox } from '@/lib/rect';
import { fitLabel, SCHEMATIC_COLORS as C, toScreenBox, type SchematicFrame } from '@/lib/schematic';
import type { Issue, IssueOccurrence, ViewportResult } from '@/types/inspection';
import { CROP_MAX_HEIGHT_PX } from '../crop';
import { buildIssueDiagram, tagOfSnippet, type DiagramShape } from '../diagram';

// WIREFRAME 6.4: 크롭 기준 박스가 스크린샷 안에 완전히 들어오지 않을 때 하이라이트 자리에 그리는 배치도.
// 이슈 영역과 겹치는 layoutMap 블록을 함께 그리고, 유형별 문제 영역(빗금)과 치수를 표시한다(시안 schematic-issue-types.png).
// 페이지에서 가져온 문자열(textSnippet, label)은 SVG <text>의 문자열로만 넣는다(AGENTS.md 8장).

/** 문제 영역 아래 치수 문구 자리 (화면 px) */
const MARK_SPACE_PX = 24;

export function IssueDiagramView({
  issue,
  occurrence,
  result,
  label,
}: {
  issue: Pick<Issue, 'type' | 'subtype' | 'priority'>;
  occurrence: IssueOccurrence;
  /** 이 viewport의 결과. layoutWidth와 layoutMap을 쓴다 */
  result: Pick<ViewportResult, 'layoutWidth' | 'layoutMap'>;
  label: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(containerRef);
  const idPrefix = `issue-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const layoutWidth = result.layoutMap?.width ?? result.layoutWidth;
  const diagram = buildIssueDiagram(issue, occurrence, layoutWidth);
  const { region } = diagram;
  // 치수 문구("잘린 48px" 등)는 문제 영역 아래에 쓰므로 화면 기준 여백을 더 둔다
  const markSpace = diagram.shapes.some((s) => s.mark) ? MARK_SPACE_PX : 0;
  const scale = width > 0 ? Math.min(width / region.width, (CROP_MAX_HEIGHT_PX - markSpace) / region.height) : 0;
  const frame: SchematicFrame = { scale, originX: region.x, originY: region.y };
  const svgWidth = region.width * scale;
  const svgHeight = region.height * scale + markSpace;
  const isViewportOverflow = issue.type === 'viewport-overflow';
  const blocks = (result.layoutMap?.blocks ?? []).filter((b) => intersectBox(b.rect, region) !== null);

  return (
    <figure ref={containerRef} className="flex w-full flex-col gap-1.5">
      {scale > 0 ? (
        <svg
          role="img"
          aria-label={`${label} 이슈 배치도: ${diagram.shapes.map((s) => s.label).join(', ')}`}
          width={svgWidth}
          height={svgHeight}
          className="mx-auto block overflow-hidden rounded-md border border-border"
          style={{ background: isViewportOverflow ? C.outside : '#fff' }}
        >
          <SchematicDefs idPrefix={idPrefix} />
          {/* 화면(layout viewport) 안쪽만 흰 바탕. Viewport Overflow는 바깥을 회색으로 두고 경계에 파란 점선을 긋는다 */}
          <rect x={(0 - region.x) * scale} y={0} width={layoutWidth * scale} height={svgHeight} fill="#fff" />
          <SchematicLayer
            idPrefix={idPrefix}
            frame={frame}
            pageWidth={isViewportOverflow ? Math.max(layoutWidth, region.x + region.width) : layoutWidth}
            layoutWidth={layoutWidth}
            from={region.y}
            to={region.y + region.height + markSpace / scale}
            blocks={blocks}
            firstScreen={null}
            layoutEnd={null}
            chipRight={svgWidth}
            showScreenWidthLabel={false}
          />
          {isViewportOverflow && region.x < 0 ? <DashedLine x1={-region.x * scale} y1={0} x2={-region.x * scale} y2={svgHeight} /> : null}
          <IssueShapes issue={issue} occurrence={occurrence} shapes={diagram.shapes} frame={frame} idPrefix={idPrefix} />
          <SchematicChips frame={frame} from={region.y} to={region.y + region.height + markSpace / scale} blocks={blocks} chipRight={svgWidth} />
        </svg>
      ) : (
        <div className="h-40 rounded-md bg-background-secondary" />
      )}
      <figcaption className="flex flex-col gap-1 text-caption text-text-secondary">
        <span>측정값으로 그린 배치도입니다. 글꼴과 색은 실제 화면과 다를 수 있습니다.</span>
        {diagram.notes.map((note) => (
          <span key={note}>{note}</span>
        ))}
      </figcaption>
    </figure>
  );
}

function IssueShapes({
  issue,
  occurrence,
  shapes,
  frame,
  idPrefix,
}: {
  issue: Pick<Issue, 'type' | 'subtype'>;
  occurrence: IssueOccurrence;
  shapes: DiagramShape[];
  frame: SchematicFrame;
  idPrefix: string;
}) {
  const ids = patternIds(idPrefix);
  const tag = tagOfSnippet(occurrence.sourceHints.htmlSnippet);
  const snippet = occurrence.sourceHints.textSnippet;
  const overlap = issue.type === 'element-overlap';
  const partnerTag = occurrence.relatedElements[0]?.tag;

  const inner = (box: { x: number; y: number; width: number; height: number }, text: string, color: string) =>
    box.height >= 14 && box.width >= 24 ? (
      <text x={box.x + 8} y={box.y + Math.min(box.height / 2 + 4, 18)} fontSize={12} fontWeight={700} fill={color} fontFamily="inherit">
        {fitLabel(text, box.width - 14, 12)}
      </text>
    ) : null;

  return (
    <g>
      {shapes
        .filter((s) => s.kind === 'related')
        .map((s, i) => {
          const R = toScreenBox(frame, s.box);
          if (s.partner) {
            return (
              <g key={`r${i}`}>
                <rect x={R.x} y={R.y} width={R.width} height={R.height} rx={6} fill="#fff" stroke={C.partner} strokeWidth={2} />
                {/* 상대 요소 이름은 겹친 영역을 피해 오른쪽 아래에 쓴다 (시안 schematic-issue-types.png) */}
                {partnerTag && R.height >= 14 && R.width >= 24 ? (
                  <text x={R.x + R.width - 8} y={R.y + R.height - 7} fontSize={12} fontWeight={700} fill={C.partner} textAnchor="end" fontFamily="inherit">
                    {fitLabel(partnerTag, R.width - 14, 12)}
                  </text>
                ) : null}
              </g>
            );
          }
          return <rect key={`r${i}`} x={R.x} y={R.y} width={R.width} height={R.height} rx={4} fill="none" stroke={C.struct} strokeWidth={1.5} strokeDasharray="4 3" />;
        })}
      {shapes
        .filter((s) => s.kind === 'target')
        .map((s, i) => {
          const R = toScreenBox(frame, s.box);
          const text = overlap ? (tag ? `${tag}${snippet ? ` "${snippet}"` : ''}` : snippet) : issue.type === 'text-overflow' ? snippet : undefined;
          return (
            <g key={`t${i}`}>
              <rect
                x={R.x}
                y={R.y}
                width={R.width}
                height={R.height}
                rx={overlap ? 6 : 2}
                fill={issue.type === 'viewport-overflow' ? C.problemFill : '#fff'}
                stroke={C.problem}
                strokeWidth={2}
              />
              {text ? inner(R, text, overlap ? C.problem : C.ink) : null}
              {issue.subtype === 'clipped' && tag && occurrence.expected.clientWidth !== undefined ? (
                <text x={R.x} y={R.y - 6} fontSize={10} fontWeight={700} fill={C.problem} fontFamily="inherit">
                  {`${tag} (컨테이너 ${Math.round(occurrence.expected.clientWidth)}px)`}
                </text>
              ) : null}
            </g>
          );
        })}
      {shapes
        .filter((s) => s.kind === 'overflow' || s.kind === 'intersection')
        .map((s, i) => {
          const R = toScreenBox(frame, s.box);
          return (
            <g key={`o${i}`}>
              <rect x={R.x} y={R.y} width={R.width} height={R.height} fill={`url(#${ids.hatch})`} stroke={C.problem} strokeDasharray="4 3" />
              {s.mark ? (
                <g>
                  <line x1={R.x} y1={R.y + R.height + 6} x2={R.x + R.width} y2={R.y + R.height + 6} stroke={C.problem} strokeWidth={1.5} />
                  <text x={R.x + R.width / 2} y={R.y + R.height + 20} fontSize={11} fontWeight={700} fill={C.problem} textAnchor="middle" fontFamily="inherit">
                    {s.mark}
                  </text>
                </g>
              ) : null}
            </g>
          );
        })}
    </g>
  );
}
