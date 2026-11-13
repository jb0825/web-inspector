import 'server-only';
import { VIEWPORTS } from '@/server/browser/devices';
import { MAX_CANDIDATES, NEEDS_REVIEW_BELOW, SCREENSHOT_MAX_HEIGHT } from '@/server/detect/constants';
import { formatIssueId } from '@/server/detect/order';
import type { SubtypeByType } from '@/server/detect/types';
import { priorityOf, toScore100 } from '@/server/priority/score';
import type { Inspection, Issue, IssueType, Viewport, ViewportResult } from '@/types/inspection';

// DOMAIN_MODEL 3장 불변 조건. 테스트(단위, Fixture, 샘플 리포트 검증)에서만 실행한다.
// 운영 중 저장할 때는 호출하지 않는다: 코드 버그 하나로 정상적인 검사 결과 전체가 실패 처리되지 않게 하기 위해서다.
//
// 구현 범위: ViewportResult V-1~V-3, Issue S-1~S-13.
// TODO(T10): Inspection I-1~I-11, DevTask T-1~T-8

/**
 * 검사 시점.
 * - browser: 브라우저 단계 결과(AI 단계 전). S-9, S-10 대신 AI 필드가 비어 있는지 확인한다.
 * - final: AI 단계가 끝난 뒤. S-9, S-10을 그대로 확인한다.
 */
export type InvariantStage = 'browser' | 'final';

export interface InvariantViolation {
  /** 조건 ID (예: S-6) */
  id: string;
  message: string;
}

export class InvariantError extends Error {
  constructor(readonly violations: InvariantViolation[]) {
    super(`Invariant violations:\n${violations.map((v) => `- ${v.id}: ${v.message}`).join('\n')}`);
    this.name = 'InvariantError';
  }
}

/** DETECTION_RULES 1.1 (S-12). SubtypeByType과 어긋나면 컴파일 에러가 난다 */
const SUBTYPES = {
  'text-overflow': ['clipped', 'spill'],
  'element-overlap': ['interactive', 'text', 'other'],
  'viewport-overflow': ['page-scroll', 'element-out', 'hidden-clip'],
} as const satisfies { [K in IssueType]: readonly SubtypeByType[K][] };

const VIEWPORT_LIST: Viewport[] = ['desktop', 'mobile'];
/** cropRect 경계 비교의 부동소수점 허용치 */
const EPSILON = 1e-6;

const json = (value: unknown) => JSON.stringify(value);

export function viewportResultViolations(viewport: Viewport, result: ViewportResult): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const at = `viewports.${viewport}`;
  const expected = VIEWPORTS[viewport];
  if (result.width !== expected.width || result.height !== expected.height) {
    out.push({ id: 'V-1', message: `${at}: ${result.width}×${result.height} ≠ 설정값 ${expected.width}×${expected.height}` });
  }
  if (result.screenshotHeight > SCREENSHOT_MAX_HEIGHT[viewport]) {
    out.push({ id: 'V-2', message: `${at}: screenshotHeight ${result.screenshotHeight} > 상한 ${SCREENSHOT_MAX_HEIGHT[viewport]}` });
  }
  const truncated = result.documentHeight > result.screenshotHeight;
  if (result.screenshotTruncated !== truncated) {
    out.push({
      id: 'V-2',
      message: `${at}: screenshotTruncated=${result.screenshotTruncated}, documentHeight ${result.documentHeight} / screenshotHeight ${result.screenshotHeight}`,
    });
  }
  if (result.elementsTruncated && result.elementsInspected !== MAX_CANDIDATES) {
    out.push({ id: 'V-3', message: `${at}: elementsTruncated인데 elementsInspected ${result.elementsInspected} ≠ ${MAX_CANDIDATES}` });
  }
  return out;
}

function issueViolations(issue: Issue, index: number, inspection: Inspection, stage: InvariantStage, byId: Map<string, Issue>): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const at = issue.id;
  const add = (id: string, message: string) => out.push({ id, message: `${at}: ${message}` });

  // S-1
  if (issue.id !== formatIssueId(index + 1)) add('S-1', `위치 ${index}의 ID는 ${formatIssueId(index + 1)}이어야 한다`);

  // S-2
  const occViewports = issue.occurrences.map((o) => o.viewport);
  if (issue.occurrences.length < 1 || issue.occurrences.length > 2) add('S-2', `occurrences ${issue.occurrences.length}개`);
  else if (issue.occurrences.length === 2 && json(occViewports) !== json(['desktop', 'mobile'])) add('S-2', `occurrence 순서 ${json(occViewports)}`);

  // S-3
  if (json(issue.viewports) !== json(occViewports)) add('S-3', `viewports ${json(issue.viewports)} ≠ occurrences ${json(occViewports)}`);
  for (const v of occViewports) {
    if (inspection.viewports[v] === null) add('S-3', `실패한 viewport ${v}에 occurrence가 있다`);
  }

  // S-4
  const failed = VIEWPORT_LIST.some((v) => inspection.viewports[v] === null);
  const expectedTag = failed ? null : occViewports.length === 2 ? 'both' : occViewports[0] === 'desktop' ? 'desktop-only' : 'mobile-only';
  if (issue.viewportTag !== expectedTag) add('S-4', `viewportTag ${issue.viewportTag} ≠ ${expectedTag}`);

  // S-5
  const first = issue.occurrences[0];
  if (first && (issue.selector !== first.selector || json(issue.sourceHints) !== json(first.sourceHints))) {
    add('S-5', 'selector/sourceHints가 occurrences[0]과 다르다');
  }

  // S-6
  for (const id of issue.relatedIssueIds) {
    const other = byId.get(id);
    if (!other) add('S-6', `없는 ID ${id}`);
    else if (id === issue.id) add('S-6', '자기 자신을 가리킨다');
    else if (!other.relatedIssueIds.includes(issue.id)) add('S-6', `${id}가 ${issue.id}를 가리키지 않는다(비대칭)`);
  }
  const positions = issue.relatedIssueIds.map((id) => [...byId.keys()].indexOf(id));
  if (positions.some((p, i) => i > 0 && p <= positions[i - 1])) add('S-6', `오름차순이 아니다 ${json(issue.relatedIssueIds)}`);

  // S-7
  const { S, I, R, score100 } = issue.scores;
  if (![S, I, R].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) add('S-7', `S/I/R 범위 ${json(issue.scores)}`);
  if (score100 !== toScore100(S, I, R)) add('S-7', `score100 ${score100} ≠ ${toScore100(S, I, R)}`);
  if (issue.priority !== priorityOf(score100)) add('S-7', `priority ${issue.priority} ≠ ${priorityOf(score100)}`);

  // S-8
  const minConfidence = Math.min(...issue.occurrences.map((o) => o.confidence));
  if (issue.confidence !== minConfidence) add('S-8', `confidence ${issue.confidence} ≠ min ${minConfidence}`);
  if (issue.needsReview !== issue.confidence < NEEDS_REVIEW_BELOW) add('S-8', `needsReview ${issue.needsReview}, confidence ${issue.confidence}`);

  // S-9, S-10
  const hasAnalysis = issue.analysis !== undefined;
  const hasSkipped = issue.analysisSkippedReason !== undefined;
  if (stage === 'browser') {
    // AI 단계 전에는 AI 필드가 비어 있어야 한다(DOMAIN_MODEL 4.2)
    if (hasAnalysis || hasSkipped) add('S-9', 'browser 단계인데 analysis/analysisSkippedReason이 있다');
  } else {
    if (issue.needsReview && (hasAnalysis || issue.analysisSkippedReason !== 'needs-review')) {
      add('S-9', `needsReview인데 analysis=${hasAnalysis}, analysisSkippedReason=${issue.analysisSkippedReason}`);
    }
    if (hasAnalysis === hasSkipped) add('S-10', `analysis=${hasAnalysis}, analysisSkippedReason=${issue.analysisSkippedReason} (정확히 하나여야 한다)`);
  }

  // S-11
  for (const o of issue.occurrences) {
    const vr = inspection.viewports[o.viewport];
    if (!o.cropRect || !vr) continue;
    const c = o.cropRect;
    const inside =
      c.x >= -EPSILON && c.y >= -EPSILON && c.width > 0 && c.height > 0 &&
      c.x + c.width <= vr.screenshotWidth + EPSILON && c.y + c.height <= vr.screenshotHeight + EPSILON;
    if (!inside) add('S-11', `${o.viewport} cropRect ${json(c)}가 스크린샷 ${vr.screenshotWidth}×${vr.screenshotHeight} 밖이다`);
  }

  // S-12
  const allowed: readonly string[] = SUBTYPES[issue.type] ?? [];
  if (!allowed.includes(issue.subtype)) add('S-12', `${issue.type}/${issue.subtype} 조합`);

  // S-13
  if (issue.type === 'element-overlap') {
    for (const o of issue.occurrences) {
      const related = o.relatedElements;
      const count = o.measured.overlapTargetCount;
      if (related.length < 1 || related.length > 5 || related.some((r) => r.role !== 'overlap-target') || !(count >= related.length)) {
        add('S-13', `${o.viewport} relatedElements ${related.length}개, overlapTargetCount ${count}`);
      }
    }
  }
  return out;
}

export function findInspectionViolations(inspection: Inspection, stage: InvariantStage): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  for (const v of VIEWPORT_LIST) {
    const result = inspection.viewports[v];
    if (result) out.push(...viewportResultViolations(v, result));
  }
  const byId = new Map(inspection.issues.map((issue) => [issue.id, issue]));
  inspection.issues.forEach((issue, i) => out.push(...issueViolations(issue, i, inspection, stage, byId)));
  // TODO(T10): I-1~I-11 (Inspection), T-1~T-8 (DevTask)
  return out;
}

/** 위반이 있으면 조건 ID와 값을 담은 InvariantError를 던진다 */
export function assertInspectionInvariants(inspection: Inspection, stage: InvariantStage): void {
  const violations = findInspectionViolations(inspection, stage);
  if (violations.length > 0) throw new InvariantError(violations);
}
