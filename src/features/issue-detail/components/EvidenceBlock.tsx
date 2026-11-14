import { VIEWPORT_LABELS } from '@/components/inspection/labels';
import { CopyButton } from '@/components/ui/CopyButton';
import { formatPx } from '@/lib/format';
import type { IssueOccurrence, Priority, ViewportResult } from '@/types/inspection';
import { CropView } from './CropView';

// WIREFRAME 6.4, DESIGN_GUIDE 9.4: Evidence 문장 → 측정값 표(mono, tabular) → Selector → 관련 요소. 측정한 값만 보여준다

/** PRD 5.3.3: 관련 요소는 최대 5개. overlapTargetCount가 그보다 많으면 나머지 개수를 알린다 */
export const RELATED_ELEMENTS_SHOWN = 5;

const GROUPS = [
  ['measured', 'measured'],
  ['expected', 'expected'],
  ['delta', 'delta'],
] as const;

function MeasurementTable({ occurrence }: { occurrence: IssueOccurrence }) {
  const rows = GROUPS.flatMap(([group, label]) =>
    Object.entries(occurrence[group]).map(([key, value], index) => ({ group: index === 0 ? label : '', key, value, id: `${group}.${key}` })),
  );
  if (rows.length === 0) return null;
  return (
    <table className="w-full table-fixed border-collapse text-body-sm">
      <caption className="sr-only">측정값</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-border last:border-b-0">
            <th scope="row" className="w-18 py-1.5 pr-2 text-left align-top font-mono text-caption sm:w-24 font-normal text-text-tertiary">
              {row.group}
            </th>
            <td className="py-1.5 pr-2 align-top font-mono text-code wrap-anywhere text-text-secondary">{row.key}</td>
            <td className="w-14 py-1.5 text-right align-top font-mono text-code text-text-primary tabular-nums">{formatPx(row.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EvidenceBlock({ occurrence, screenshot, priority }: { occurrence: IssueOccurrence; screenshot: ViewportResult | null; priority: Priority }) {
  const label = VIEWPORT_LABELS[occurrence.viewport];
  const size = screenshot ? `${screenshot.width} × ${screenshot.height}` : null;
  const overlapCount = occurrence.measured.overlapTargetCount;
  const hiddenOverlaps = overlapCount !== undefined && overlapCount > RELATED_ELEMENTS_SHOWN ? overlapCount - RELATED_ELEMENTS_SHOWN : 0;

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-label font-medium tracking-wide text-text-secondary uppercase">
        {label} {size ? <span className="font-mono tabular-nums">{size}</span> : null}
      </h4>
      <CropView occurrence={occurrence} screenshot={screenshot} priority={priority} label={label} />
      <p className="text-body text-text-primary">{occurrence.evidenceText}</p>
      <MeasurementTable occurrence={occurrence} />
      <dl className="flex flex-col gap-2 text-body-sm">
        <div className="flex flex-col gap-1">
          <dt className="text-text-secondary">Selector</dt>
          <dd className="flex items-start gap-2">
            <code className="min-w-0 flex-1 rounded-sm bg-background-secondary px-2 py-1 font-mono text-code wrap-anywhere">{occurrence.selector}</code>
            <CopyButton getText={() => occurrence.selector} iconOnly ariaLabel="Selector 복사" announcement="Selector가 복사되었습니다" className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8" />
          </dd>
        </div>
        {occurrence.relatedElements.length > 0 ? (
          <div className="flex flex-col gap-1">
            <dt className="text-text-secondary">관련 요소</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {occurrence.relatedElements.map((related, index) => (
                  <li key={`${related.selector}-${index}`} className="flex flex-wrap items-baseline gap-x-2">
                    <code className="min-w-0 font-mono text-code wrap-anywhere">{related.selector}</code>
                    <span className="font-mono text-caption text-text-tertiary">({related.role})</span>
                  </li>
                ))}
              </ul>
              {hiddenOverlaps > 0 ? <p className="mt-1 text-text-secondary">외 {hiddenOverlaps}개 요소와도 겹칩니다.</p> : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
