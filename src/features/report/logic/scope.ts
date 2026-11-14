import { ERROR_MESSAGES, SCOPE_NOTICE_MESSAGES as M, VIEWPORT_LABELS } from '@/components/inspection/labels';
import { formatCount, formatPx } from '@/lib/format';
import type { Inspection, Viewport } from '@/types/inspection';

// WIREFRAME 5.4 검사 범위 안내. 해당 항목이 없으면 빈 배열이고, 화면은 영역 전체를 숨긴다.

export type ScopeNoticeKind =
  | 'viewport-failed'
  | 'screenshot-truncated'
  | 'elements-truncated'
  | 'issues-truncated'
  | 'canvas'
  | 'no-meta-viewport'
  | 'analysis-failed'
  | 'overlays';

export interface ScopeNotice {
  kind: ScopeNoticeKind;
  viewport?: Viewport;
  text: string;
}

const VIEWPORTS: readonly Viewport[] = ['desktop', 'mobile'];
const other = (v: Viewport): Viewport => (v === 'desktop' ? 'mobile' : 'desktop');

export function buildScopeNotices(
  inspection: Pick<Inspection, 'viewports' | 'viewportErrors' | 'analysis' | 'issuesDetected' | 'issuesTruncated' | 'issues' | 'tasks'>,
): ScopeNotice[] {
  const notices: ScopeNotice[] = [];

  for (const v of VIEWPORTS) {
    const error = inspection.viewportErrors[v];
    // 두 viewport가 모두 실패하면 failed라 결과 화면에 오지 않는다. 한쪽만 실패한 경우만 안내한다
    if (error && inspection.viewports[other(v)]) {
      notices.push({ kind: 'viewport-failed', viewport: v, text: M.viewportFailed(VIEWPORT_LABELS[v], ERROR_MESSAGES[error.code], VIEWPORT_LABELS[other(v)]) });
    }
  }

  for (const v of VIEWPORTS) {
    const result = inspection.viewports[v];
    if (result?.screenshotTruncated) {
      notices.push({ kind: 'screenshot-truncated', viewport: v, text: M.screenshotTruncated(VIEWPORT_LABELS[v], formatPx(result.screenshotHeight)) });
    }
  }

  for (const v of VIEWPORTS) {
    const result = inspection.viewports[v];
    // 상한 값(3,000)은 서버 상수라 화면에서는 실제로 검사한 개수를 쓴다
    if (result?.elementsTruncated) {
      notices.push({ kind: 'elements-truncated', viewport: v, text: M.elementsTruncated(VIEWPORT_LABELS[v], formatCount(result.elementsInspected)) });
    }
  }

  if (inspection.issuesTruncated) {
    notices.push({ kind: 'issues-truncated', text: M.issuesTruncated(formatCount(inspection.issuesDetected), formatCount(inspection.issues.length)) });
  }

  if (VIEWPORTS.some((v) => inspection.viewports[v]?.hasCanvas)) notices.push({ kind: 'canvas', text: M.canvas });

  const mobile = inspection.viewports.mobile;
  if (mobile && !mobile.hasMetaViewport) notices.push({ kind: 'no-meta-viewport', viewport: 'mobile', text: M.noMetaViewport(formatPx(mobile.layoutWidth)) });

  if (inspection.analysis.status === 'failed') {
    notices.push({ kind: 'analysis-failed', text: inspection.tasks.length > 0 ? M.analysisFailedWithTasks : M.analysisFailedWithoutTasks });
  }

  for (const v of VIEWPORTS) {
    const overlays = inspection.viewports[v]?.overlaysDetected ?? [];
    if (overlays.length > 0) notices.push({ kind: 'overlays', viewport: v, text: M.overlays(VIEWPORT_LABELS[v], overlays.join(', ')) });
  }

  return notices;
}
