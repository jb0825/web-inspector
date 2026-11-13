import 'server-only';
import { matchElements } from '@/server/compare/match';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import { scoreIssue } from '@/server/priority/score';
import type { Viewport } from '@/types/inspection';
import { dedupWithinViewport, linkRelated, mergeAcrossViewports } from './dedup';
import { buildLookup } from './geometry';
import { capIssues, orderAndAssignIds } from './order';
import { detectOverlap } from './overlap';
import { detectTextOverflow } from './textOverflow';
import type { DetectedIssue, RawIssue } from './types';
import { detectViewportOverflow } from './viewportOverflow';

// 탐지부터 유형 간 연결까지 (DETECTION_RULES 1.3). Evidence, 제목, cropRect는 T07에서 붙인다.

export interface ViewportDetection {
  /** Dedup 규칙 2까지 끝난 이슈. 출력 순서는 compareRawIssues */
  issues: RawIssue[];
  overlaysDetected: string[];
  unexplainedPageScroll: boolean;
}

/** viewport 하나의 탐지 3종과 Dedup 규칙 2. 예외가 나면 그대로 던진다(호출하는 쪽이 DETECTION_FAILED로 처리, 10장) */
export function detectViewport(c: CollectedViewport): ViewportDetection {
  const text = detectTextOverflow(c);
  const overlap = detectOverlap(c);
  const overflow = detectViewportOverflow(c);
  return {
    issues: dedupWithinViewport([...overflow.issues, ...text.issues, ...overlap.issues]),
    overlaysDetected: overlap.overlaysDetected,
    unexplainedPageScroll: overflow.unexplainedPageScroll,
  };
}

export interface BuildIssuesInput {
  /** 실패한 viewport는 null */
  desktop: CollectedViewport | null;
  mobile: CollectedViewport | null;
}

export interface BuildIssuesResult {
  /** ID 순서 */
  issues: DetectedIssue[];
  /** 실패한 viewport는 null */
  viewports: Record<Viewport, Pick<ViewportDetection, 'overlaysDetected' | 'unexplainedPageScroll'> | null>;
  /** 상한(7.6)을 적용하기 전 이슈 수 */
  issuesDetected: number;
  issuesTruncated: boolean;
}

/** 이슈의 대상 요소만 index 순으로 (매칭은 이슈가 있는 요소에 대해서만 계산한다, 7.2) */
function targetElements(c: CollectedViewport | null, issues: readonly RawIssue[]): CollectedElement[] {
  if (!c) return [];
  const lookup = buildLookup(c);
  const indices = [...new Set(issues.map((i) => i.elementIndex))].sort((a, b) => a - b);
  return indices.map((index) => {
    const el = lookup.get(index);
    if (!el) throw new Error(`Element ${index} not found in ${c.viewport}`);
    return el;
  });
}

export function buildIssues(input: BuildIssuesInput): BuildIssuesResult {
  for (const viewport of ['desktop', 'mobile'] as const) {
    const c = input[viewport];
    if (c && c.viewport !== viewport) throw new Error(`Expected ${viewport} data, got ${c.viewport}`);
  }

  const desktop = input.desktop ? detectViewport(input.desktop) : null;
  const mobile = input.mobile ? detectViewport(input.mobile) : null;

  const matching = matchElements(
    targetElements(input.desktop, desktop?.issues ?? []),
    targetElements(input.mobile, mobile?.issues ?? []),
  );
  const merged = mergeAcrossViewports(desktop?.issues ?? null, mobile?.issues ?? null, matching);
  const scored = merged.map((issue) => ({ ...issue, ...scoreIssue(issue, input) }));
  const { kept, issuesDetected, issuesTruncated } = capIssues(scored);
  const issues = linkRelated(orderAndAssignIds(kept), matching);

  const extra = (d: ViewportDetection | null) =>
    d ? { overlaysDetected: d.overlaysDetected, unexplainedPageScroll: d.unexplainedPageScroll } : null;
  return {
    issues,
    viewports: { desktop: extra(desktop), mobile: extra(mobile) },
    issuesDetected,
    issuesTruncated,
  };
}
