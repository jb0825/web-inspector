import 'server-only';
import type { CollectedViewport } from '@/server/collect/types';
import { buildLookup } from '@/server/detect/geometry';
import type { RawIssue } from '@/server/detect/types';
import type { IssueType } from '@/types/inspection';
import { subjectLabel } from './sentences';

// Issue Title (PRD 5.4.4, DETECTION_RULES 8.2). 코드가 템플릿으로 만든다.

export const TYPE_LABEL: Record<IssueType, string> = {
  'text-overflow': 'Text Overflow',
  'element-overlap': 'Element Overlap',
  'viewport-overflow': 'Viewport Overflow',
};

/**
 * `{type 라벨} · {subtype} — {대상}`.
 * Element Overlap은 `Element Overlap — {a 대상} ↔ {b 대상}`(subtype은 점수표 구분용이라 넣지 않는다).
 * 대상은 occurrences[0]의 요소다. c는 그 viewport의 수집 데이터.
 */
export function issueTitle(first: RawIssue, c: CollectedViewport): string {
  const lookup = buildLookup(c);
  const label = (index: number) => {
    const el = lookup.get(index);
    if (!el) throw new Error(`Element ${index} not found in ${c.viewport}`);
    return subjectLabel(el);
  };
  if (first.type === 'element-overlap') {
    return `${TYPE_LABEL[first.type]} — ${label(first.elementIndex)} ↔ ${label(first.relatedIndex)}`;
  }
  return `${TYPE_LABEL[first.type]} · ${first.subtype} — ${label(first.elementIndex)}`;
}
