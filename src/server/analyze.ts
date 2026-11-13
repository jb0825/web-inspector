import 'server-only';
import { isInspectionError } from '@/server/errors';
import type { Logger } from '@/server/log';
import { finalStatus, withSkippedReasons } from '@/server/status';
import type { InspectionStore } from '@/server/store/redis';

// AI 단계 (DOMAIN_MODEL 4.3). POST /api/inspections/:id/analyze의 after()에서 실행한다.
// TODO(T10): AI 분석, 태스크, 프롬프트. 지금은 AI를 호출하지 않는 임시 처리(stub)다.

export interface AnalysisDeps {
  store: InspectionStore;
  now(): number;
  log: Logger;
}

/** 예외를 밖으로 던지지 않는다(after() 안에서 실행된다). 저장에 실패하면 GET의 멈춘 검사 처리에 맡긴다 */
export async function runAnalysis(id: string, deps: AnalysisDeps): Promise<void> {
  const { store, now, log } = deps;
  const started = now();
  try {
    const doc = await store.read(id);
    if (!doc || doc.status !== 'analyzing' || doc.analysis.status !== 'pending') {
      log('analyze-skip', { id, status: doc?.status ?? 'missing' });
      return;
    }
    // DOMAIN_MODEL 4.3 1단계
    const running = await store.save({ ...doc, step: 'analyzing_issues', analysis: { status: 'running', analyzedIssueCount: 0 } });

    // TODO(T10): 이슈별 AI 분석 → 태스크 그룹화(코드) → 제목과 설명(AI) → Acceptance Criteria와 프롬프트(코드)
    // 임시 처리: AI를 호출하지 않고 analysis.status = skipped, 모든 이슈에 analysisSkippedReason을 채우고 tasks = [].
    // PRD 8.2에 "AI 단계를 아직 구현하지 않음" 사유가 없어서 needsReview가 아닌 이슈는 'ai-failed'로 둔다(보고서 참고).
    const analysis = { status: 'skipped' as const, analyzedIssueCount: 0 };
    const issues = withSkippedReasons(running.issues, 'ai-failed');
    const final = { ...running, analysis, issues, tasks: [] };
    await store.save({ ...final, status: finalStatus(final), completedAt: new Date(now()).toISOString() });
    log('analyze-done', { id, status: finalStatus(final), durationMs: now() - started });
  } catch (error) {
    log('analyze-failed', { id, code: isInspectionError(error) ? error.code : 'INTERNAL_ERROR', durationMs: now() - started });
  }
}
