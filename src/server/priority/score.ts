import 'server-only';
import type { CollectedViewport } from '@/server/collect/types';
import { buildLookup } from '@/server/detect/geometry';
import type { MergedIssue, ScoredIssue } from '@/server/detect/types';
import type { Issue, Priority, Viewport } from '@/types/inspection';
import { PRIORITY_THRESHOLDS, REACH_MAX, SCORE_RULES, SCORE_WEIGHTS, type ScoreRule } from './rules';

// Priority 계산 (PRD 5.5, DETECTION_RULES 9장). 정수 연산만 쓴다.

export function scoreRuleFor(type: string, subtype: string, interactiveOrNav: boolean): ScoreRule {
  const rule = SCORE_RULES.find(
    (r) => r.type === type && r.subtype === subtype && (!r.requiresInteractiveOrNav || interactiveOrNav),
  );
  // RawIssue 타입이 type/subtype 조합을 제한하므로 실제로는 일어나지 않는다
  if (!rule) throw new Error(`No score rule for ${type}/${subtype}`);
  return rule;
}

/** PRD 5.5.2: S × 35 + I × 35 + R × 30. 부동소수점 곱셈(S × 0.35)을 쓰지 않는다 */
export function toScore100(S: number, I: number, R: number): number {
  return S * SCORE_WEIGHTS.S + I * SCORE_WEIGHTS.I + R * SCORE_WEIGHTS.R;
}

export function priorityOf(score100: number): Priority {
  return PRIORITY_THRESHOLDS.find((t) => score100 >= t.min)?.priority ?? 'P3';
}

/**
 * Reach 보정 (DETECTION_RULES 9.2). 첫 화면 판정은 viewportSize.height 기준이다(3.1.1).
 * innerHeight는 Mobile에서 페이지가 축소되면 커지므로 쓰지 않는다.
 */
export function reachOf(baseR: number, issue: Pick<MergedIssue, 'occurrences'>, viewportHeights: Record<Viewport, number>): number {
  let R = baseR;
  if (issue.occurrences.some((o) => o.boundingBox.y < viewportHeights[o.viewport])) R += 1;
  if (issue.occurrences.length === 2) R += 1;
  return Math.min(R, REACH_MAX);
}

/** 대상 요소가 인터랙티브 영역(자신 또는 후보 조상이 인터랙티브, 3.3)이거나 nav 안 */
function isInteractiveOrNav(issue: MergedIssue, collected: CollectedViewport): boolean {
  const lookup = buildLookup(collected);
  const el = lookup.get(issue.occurrences[0].elementIndex);
  if (!el) throw new Error(`Element ${issue.occurrences[0].elementIndex} not found in ${collected.viewport}`);
  if (el.flags.inNav || el.flags.interactive) return true;
  return el.ancestorIndices.some((index) => lookup.get(index)?.flags.interactive === true);
}

/**
 * 병합된 이슈의 S, I, R, score100, priority. "추가 조건"은 occurrences[0]의 요소로 판정한다(9.1).
 * Priority는 Confidence와 관계없이 계산한다(9.4).
 */
export function scoreIssue(
  issue: MergedIssue,
  collected: Record<Viewport, CollectedViewport | null>,
): Pick<ScoredIssue, 'scores' | 'priority'> {
  const first = collected[issue.occurrences[0].viewport];
  if (!first) throw new Error(`Missing collected data for ${issue.occurrences[0].viewport}`);
  const heights: Record<Viewport, number> = {
    desktop: collected.desktop?.viewportSize.height ?? 0,
    mobile: collected.mobile?.viewportSize.height ?? 0,
  };
  const rule = scoreRuleFor(issue.type, issue.subtype, isInteractiveOrNav(issue, first));
  const R = reachOf(rule.R, issue, heights);
  const score100 = toScore100(rule.S, rule.I, R);
  const scores: Issue['scores'] = { S: rule.S, I: rule.I, R, score100 };
  return { scores, priority: priorityOf(score100) };
}
