import 'server-only';
import { VIEWPORTS } from '@/server/browser/devices';
import { MAX_CANDIDATES, MAX_ISSUES, NEEDS_REVIEW_BELOW, SCREENSHOT_MAX_HEIGHT } from '@/server/detect/constants';
import { formatIssueId } from '@/server/detect/order';
import { LAYOUT_MAX_BLOCKS, LAYOUT_MAX_HEIGHT } from '@/server/layout/constants';
import type { SubtypeByType } from '@/server/detect/types';
import { priorityOf, toScore100 } from '@/server/priority/score';
import { formatTaskId, issueNumber, MAX_ISSUES_PER_TASK } from '@/server/tasks/group';
import type { DevTask, Inspection, Issue, IssueType, Priority, Viewport, ViewportResult } from '@/types/inspection';

// DOMAIN_MODEL 3장 불변 조건. 테스트(단위, Fixture, 샘플 리포트 검증)에서만 실행한다.
// 운영 중 저장할 때는 호출하지 않는다: 코드 버그 하나로 정상적인 검사 결과 전체가 실패 처리되지 않게 하기 위해서다.
//
// 구현 범위: Inspection I-1~I-11, ViewportResult V-1~V-4, Issue S-1~S-13, DevTask T-1~T-8,
// 규칙 기반 분석 A-1, A-2 (T10에서 추가, DOMAIN_MODEL에 없는 조건).

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
  if (result.screenshotUrl === null || result.screenshotWidth === null || result.screenshotHeight === null) {
    // 스크린샷만 실패한 viewport(SCREENSHOT_FAILED, PRD 5.2.4): 세 값이 함께 null이고 잘림 표시는 하지 않는다
    if (result.screenshotUrl !== null || result.screenshotWidth !== null || result.screenshotHeight !== null || result.screenshotTruncated) {
      out.push({
        id: 'V-2',
        message: `${at}: 스크린샷 없음이면 screenshotUrl/Width/Height가 모두 null이고 screenshotTruncated가 false여야 한다 (${json([result.screenshotUrl !== null, result.screenshotWidth, result.screenshotHeight, result.screenshotTruncated])})`,
      });
    }
  } else {
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
  }
  if (result.elementsTruncated && result.elementsInspected !== MAX_CANDIDATES) {
    out.push({ id: 'V-3', message: `${at}: elementsTruncated인데 elementsInspected ${result.elementsInspected} ≠ ${MAX_CANDIDATES}` });
  }
  const map = result.layoutMap;
  if (map) {
    // V-4: 블록 수 상한, 정수 좌표, 문서 범위 안 (예전 문서에는 layoutMap이 없다)
    if (map.blocks.length > LAYOUT_MAX_BLOCKS) out.push({ id: 'V-4', message: `${at}: layoutMap 블록 ${map.blocks.length}개 > 상한 ${LAYOUT_MAX_BLOCKS}` });
    if (map.height > LAYOUT_MAX_HEIGHT[viewport] || map.scrollWidth < map.width) {
      out.push({ id: 'V-4', message: `${at}: layoutMap ${map.width}/${map.scrollWidth}×${map.height}` });
    }
    map.blocks.forEach((b, i) => {
      const r = b.rect;
      const ints = [r.x, r.y, r.width, r.height].every(Number.isInteger);
      const inside = r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= map.scrollWidth && r.y + r.height <= map.height;
      if (!ints || !inside) out.push({ id: 'V-4', message: `${at}: layoutMap.blocks[${i}] ${json(r)}가 정수가 아니거나 문서 ${map.scrollWidth}×${map.height} 밖이다` });
    });
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
    if (vr.screenshotWidth === null || vr.screenshotHeight === null) {
      add('S-11', `${o.viewport} 스크린샷이 없는데 cropRect ${json(c)}가 있다`);
      continue;
    }
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

const STATUSES = ['pending', 'running', 'analyzing', 'completed', 'partial', 'failed'] as const;

/** DOMAIN_MODEL 3.1 Inspection I-1~I-11 */
export function inspectionLevelViolations(inspection: Inspection): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const add = (id: string, message: string) => out.push({ id, message });
  const { status, analysis, viewports, viewportErrors } = inspection;
  const before = status === 'pending' || status === 'running';
  const afterAi = status === 'completed' || status === 'partial';
  const browserDone = !before;

  // I-1
  if (!(STATUSES as readonly string[]).includes(status)) add('I-1', `status ${status}`);
  // I-2
  if (status === 'failed' && !inspection.error) add('I-2', 'failed인데 error가 없다');
  if (status !== 'failed' && inspection.error) add('I-2', `${status}인데 error가 있다`);
  // I-3
  if (before) {
    if (inspection.issues.length > 0 || inspection.tasks.length > 0) add('I-3', `${status}인데 issues ${inspection.issues.length}개, tasks ${inspection.tasks.length}개`);
    if (VIEWPORT_LIST.some((v) => viewports[v] !== null)) add('I-3', `${status}인데 viewports가 채워져 있다`);
  }
  // I-4
  if ((status === 'analyzing' || afterAi) && VIEWPORT_LIST.every((v) => viewports[v] === null)) add('I-4', `${status}인데 viewports가 모두 null`);
  // I-5 (렌더링 전에 실패한 failed는 네 값이 모두 null일 수 있다)
  if (browserDone) {
    const allEmpty = VIEWPORT_LIST.every((v) => viewports[v] === null && viewportErrors[v] === null);
    if (!(status === 'failed' && allEmpty)) {
      for (const v of VIEWPORT_LIST) {
        if ((viewports[v] === null) === (viewportErrors[v] === null)) add('I-5', `${v}: viewports와 viewportErrors 중 정확히 하나만 있어야 한다`);
      }
    }
  }
  // I-6
  if (status === 'completed') {
    if (VIEWPORT_LIST.some((v) => viewportErrors[v] !== null)) add('I-6', 'completed인데 viewportErrors가 있다');
    if (analysis.status !== 'completed' && analysis.status !== 'skipped') add('I-6', `completed인데 analysis.status ${analysis.status}`);
  }
  // I-7
  if (status === 'partial' && VIEWPORT_LIST.every((v) => viewportErrors[v] === null) && analysis.status !== 'failed') {
    add('I-7', 'partial인데 viewport 실패도 analysis 실패도 없다');
  }
  // I-8
  if ((afterAi || status === 'failed') && !inspection.completedAt) add('I-8', `${status}인데 completedAt이 없다`);
  // I-9: AI 단계가 끝난 문서에만 적용한다. analyzing에서는 이슈가 0개여도 analysis가 pending/running이다
  // (이슈 0개도 analyze를 호출하고 skipped 처리는 analyze가 한다, T09 결정)
  if (afterAi && inspection.issues.length === 0) {
    if (analysis.status !== 'skipped') add('I-9', `이슈 0개인데 analysis.status ${analysis.status}`);
    if (inspection.tasks.length > 0) add('I-9', `이슈 0개인데 tasks ${inspection.tasks.length}개`);
  }
  // I-10
  if (analysis.error && (analysis.status !== 'failed' || analysis.error.code !== 'AI_FAILED')) {
    add('I-10', `analysis.error ${analysis.error.code}, analysis.status ${analysis.status}`);
  }
  // I-11
  const { issuesDetected, issuesTruncated } = inspection;
  if (inspection.issues.length > MAX_ISSUES) add('I-11', `issues ${inspection.issues.length}개 > ${MAX_ISSUES}`);
  if (issuesDetected < inspection.issues.length) add('I-11', `issuesDetected ${issuesDetected} < issues ${inspection.issues.length}`);
  if (issuesTruncated !== issuesDetected > inspection.issues.length) add('I-11', `issuesTruncated ${issuesTruncated}, issuesDetected ${issuesDetected}, issues ${inspection.issues.length}`);
  if (before && issuesDetected !== 0) add('I-11', `${status}인데 issuesDetected ${issuesDetected}`);
  return out;
}

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** DOMAIN_MODEL 3.4 DevTask T-1~T-8 */
export function taskViolations(inspection: Inspection): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  const add = (id: string, message: string) => out.push({ id, message });
  const byId = new Map(inspection.issues.map((issue) => [issue.id, issue]));
  const membership = new Map<string, DevTask[]>();
  const sortKey = (task: DevTask): number[] => {
    const issues = task.issueIds.map((id) => byId.get(id)).filter((i): i is Issue => i !== undefined);
    const minNumber = Math.min(...task.issueIds.map(issueNumber));
    const best = Math.min(...issues.map((i) => PRIORITY_RANK[i.priority]));
    return [Number(task.needsReview), best, minNumber];
  };

  inspection.tasks.forEach((task, index) => {
    const at = task.id;
    // T-3
    if (task.issueIds.length < 1 || task.issueIds.length > MAX_ISSUES_PER_TASK) add('T-3', `${at}: issueIds ${task.issueIds.length}개`);
    const numbers = task.issueIds.map(issueNumber);
    if (numbers.some((v, i) => i > 0 && v <= numbers[i - 1])) add('T-3', `${at}: issueIds가 오름차순이 아니다 ${json(task.issueIds)}`);
    const members: Issue[] = [];
    for (const issueId of task.issueIds) {
      const issue = byId.get(issueId);
      if (!issue) {
        add('T-3', `${at}: 없는 ID ${issueId}`);
        continue;
      }
      members.push(issue);
      membership.set(issueId, [...(membership.get(issueId) ?? []), task]);
      // T-1, T-2: 일반 이슈는 일반 태스크에, Needs Review 이슈는 Needs Review 태스크에
      if (issue.needsReview !== task.needsReview) add(issue.needsReview ? 'T-2' : 'T-1', `${at}: ${issueId}(needsReview ${issue.needsReview})가 needsReview ${task.needsReview} 태스크에 있다`);
    }
    // T-4
    if (members.length > 0) {
      const best = members.reduce((p, i) => (PRIORITY_RANK[i.priority] < PRIORITY_RANK[p] ? i.priority : p), 'P3' as Priority);
      if (task.priority !== best) add('T-4', `${at}: priority ${task.priority} ≠ 가장 높은 이슈 ${best}`);
    }
    // T-5
    if (task.id !== formatTaskId(index + 1)) add('T-5', `위치 ${index}의 ID ${task.id}는 ${formatTaskId(index + 1)}이어야 한다`);
    if (index > 0 && members.length > 0) {
      const prev = sortKey(inspection.tasks[index - 1]);
      const cur = sortKey(task);
      const cmp = prev.map((v, i) => v - cur[i]).find((d) => d !== 0) ?? 0;
      if (cmp > 0) add('T-5', `${at}: 정렬 순서(needsReview → Priority → 가장 작은 Issue ID)가 맞지 않다`);
    }
    // T-6
    if (task.needsReview && task.titleSource !== 'template') add('T-6', `${at}: Needs Review 태스크인데 titleSource ${task.titleSource}`);
    // T-7
    if (task.acceptanceCriteria.length < 1) add('T-7', `${at}: acceptanceCriteria가 비어 있다`);
    // T-8
    if (task.prompt.trim() === '') add('T-8', `${at}: prompt가 비어 있다`);
    for (const issueId of task.issueIds) if (!task.prompt.includes(issueId)) add('T-8', `${at}: prompt에 ${issueId}가 없다`);
  });

  // T-1, T-2: 태스크를 만든 뒤(analysis completed)에는 모든 이슈가 정확히 한 태스크에 속한다.
  // 분석 단계가 실패했거나(failed) 멈춘 검사(DOMAIN_MODEL 4.4)는 tasks가 비어 있을 수 있다.
  if (inspection.analysis.status === 'completed') {
    for (const issue of inspection.issues) {
      const count = membership.get(issue.id)?.length ?? 0;
      if (count !== 1) add(issue.needsReview ? 'T-2' : 'T-1', `${issue.id}: ${count}개 태스크에 속한다`);
    }
  }
  return out;
}

/**
 * 규칙 기반 분석(PRD 5.7.1)이 끝난 문서 (stage 'final', analysis.status completed).
 * - A-1: Needs Review가 아닌 이슈는 analysis가 있고 source가 rule이며 certainty가 confirmed가 아니다
 * - A-2: analyzedIssueCount = analysis가 있는 이슈 수
 * T15(AI 연동)에서는 source 'ai'도 허용하도록 바꾼다
 */
export function ruleAnalysisViolations(inspection: Inspection): InvariantViolation[] {
  if (inspection.analysis.status !== 'completed') return [];
  const out: InvariantViolation[] = [];
  for (const issue of inspection.issues) {
    if (issue.needsReview) continue;
    if (!issue.analysis) out.push({ id: 'A-1', message: `${issue.id}: analysis가 없다` });
    else if (issue.analysis.source !== 'rule' || issue.analysis.certainty === 'confirmed') {
      out.push({ id: 'A-1', message: `${issue.id}: source ${issue.analysis.source}, certainty ${issue.analysis.certainty}` });
    }
  }
  const analyzed = inspection.issues.filter((i) => i.analysis !== undefined).length;
  if (inspection.analysis.analyzedIssueCount !== analyzed) {
    out.push({ id: 'A-2', message: `analyzedIssueCount ${inspection.analysis.analyzedIssueCount} ≠ analysis가 있는 이슈 ${analyzed}개` });
  }
  return out;
}

export function findInspectionViolations(inspection: Inspection, stage: InvariantStage): InvariantViolation[] {
  const out: InvariantViolation[] = [...inspectionLevelViolations(inspection)];
  for (const v of VIEWPORT_LIST) {
    const result = inspection.viewports[v];
    if (result) out.push(...viewportResultViolations(v, result));
  }
  const byId = new Map(inspection.issues.map((issue) => [issue.id, issue]));
  inspection.issues.forEach((issue, i) => out.push(...issueViolations(issue, i, inspection, stage, byId)));
  out.push(...taskViolations(inspection));
  if (stage === 'final') out.push(...ruleAnalysisViolations(inspection));
  return out;
}

/** 위반이 있으면 조건 ID와 값을 담은 InvariantError를 던진다 */
export function assertInspectionInvariants(inspection: Inspection, stage: InvariantStage): void {
  const violations = findInspectionViolations(inspection, stage);
  if (violations.length > 0) throw new InvariantError(violations);
}
