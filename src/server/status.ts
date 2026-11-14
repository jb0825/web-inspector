import 'server-only';
import type { Inspection, InspectionErrorInfo, Issue, Viewport } from '@/types/inspection';

// PRD 6.2.2 상태 판정과 DOMAIN_MODEL 4.4 멈춘 검사 처리. 순수 함수만 둔다(T10의 analyze가 그대로 쓴다).

const VIEWPORT_LIST: readonly Viewport[] = ['desktop', 'mobile'];

/**
 * 브라우저 단계가 끝나기 전의 failed 문서 (DOMAIN_MODEL I-5): 측정 결과를 모두 비우고 error와 completedAt을 채운다.
 * runInspection의 실패 저장과 검사 중지(POST /api/inspections/:id/cancel)가 함께 쓴다.
 */
export function toFailedDocument(doc: Inspection, error: InspectionErrorInfo, atMs: number): Inspection {
  return {
    ...doc,
    status: 'failed',
    error,
    viewports: { desktop: null, mobile: null },
    viewportErrors: { desktop: null, mobile: null },
    issues: [],
    issuesDetected: 0,
    issuesTruncated: false,
    finalUrl: undefined,
    completedAt: new Date(atMs).toISOString(),
  };
}

/** 검사 중지를 받을 수 있는 상태: 브라우저 단계가 끝나기 전 (DOMAIN_MODEL 4.1) */
export function isCancellable(status: Inspection['status']): boolean {
  return status === 'pending' || status === 'running';
}

/** DOMAIN_MODEL 4.4: 함수 maxDuration(300초)과 같은 값 */
export const STALE_AFTER_MS = 300_000;

/** 브라우저 단계가 끝났을 때 (PRD 6.2.2): 성공한 viewport가 하나도 없으면 failed */
export function browserStageStatus(viewports: Inspection['viewports']): 'analyzing' | 'failed' {
  return VIEWPORT_LIST.some((v) => viewports[v] !== null) ? 'analyzing' : 'failed';
}

/** 두 viewport가 모두 실패했을 때 최상위 error: Desktop 오류, Desktop이 성공했다면 Mobile 오류 (PRD 6.2.2) */
export function browserStageError(viewportErrors: Inspection['viewportErrors']): InspectionErrorInfo | null {
  return viewportErrors.desktop ?? viewportErrors.mobile ?? null;
}

/** AI 단계가 끝났을 때 (PRD 6.2.2): viewport 실패가 하나라도 있거나 analysis가 failed면 partial */
export function finalStatus(inspection: Pick<Inspection, 'viewportErrors' | 'analysis'>): 'completed' | 'partial' {
  const viewportFailed = VIEWPORT_LIST.some((v) => inspection.viewportErrors[v] !== null);
  return viewportFailed || inspection.analysis.status === 'failed' ? 'partial' : 'completed';
}

/**
 * AI 분석 결과가 없는 이슈에 analysisSkippedReason을 채운다(DOMAIN_MODEL S-9, S-10).
 * needsReview 이슈는 항상 'needs-review'다. 이미 analysis나 사유가 있는 이슈는 그대로 둔다.
 */
export function withSkippedReasons(issues: readonly Issue[], reason: 'limit-exceeded' | 'ai-failed'): Issue[] {
  return issues.map((issue) => {
    if (issue.analysis !== undefined || issue.analysisSkippedReason !== undefined) return issue;
    return { ...issue, analysisSkippedReason: issue.needsReview ? 'needs-review' : reason };
  });
}

const plusStale = (iso: string) => new Date(Date.parse(iso) + STALE_AFTER_MS).toISOString();

/**
 * DOMAIN_MODEL 4.4: 함수가 죽어 종료 상태가 되지 못한 문서를 화면에 보여줄 상태로 바꾼다. Redis에는 다시 쓰지 않는다.
 * - pending, running: createdAt에서 300초 이상 → failed + TIME_BUDGET_EXCEEDED
 * - analyzing: updatedAt에서 300초 이상 → partial + analysis.failed(AI_FAILED)
 * completedAt은 기준 시각 + 300초로 둔다(같은 문서는 몇 번 읽어도 같은 응답).
 */
export function applyStaleRule(inspection: Inspection, nowMs: number): Inspection {
  const { status } = inspection;
  if ((status === 'pending' || status === 'running') && nowMs - Date.parse(inspection.createdAt) >= STALE_AFTER_MS) {
    return {
      ...inspection,
      status: 'failed',
      error: { code: 'TIME_BUDGET_EXCEEDED', message: 'Inspection did not finish in time' },
      completedAt: plusStale(inspection.createdAt),
    };
  }
  if (status === 'analyzing' && nowMs - Date.parse(inspection.updatedAt) >= STALE_AFTER_MS) {
    return {
      ...inspection,
      status: 'partial',
      analysis: {
        status: 'failed',
        analyzedIssueCount: inspection.analysis.analyzedIssueCount,
        error: { code: 'AI_FAILED', message: 'Analysis did not finish in time' },
      },
      issues: withSkippedReasons(inspection.issues, 'ai-failed'),
      completedAt: plusStale(inspection.updatedAt),
    };
  }
  return inspection;
}
