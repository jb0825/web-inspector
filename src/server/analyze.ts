import 'server-only';
import { analyzeIssues } from '@/server/analysis/analyze';
import { isInspectionError } from '@/server/errors';
import type { Logger } from '@/server/log';
import { finalStatus, withSkippedReasons } from '@/server/status';
import type { InspectionStore } from '@/server/store/redis';
import { buildTasks } from '@/server/tasks/build';
import type { Inspection } from '@/types/inspection';

// 분석 단계 (DOMAIN_MODEL 4.3). POST /api/inspections/:id/analyze의 after()에서 실행한다.
// 원인 분석 → 태스크 그룹화 → Acceptance Criteria → 프롬프트. 모두 코드가 만들고 AI를 호출하지 않는다(PRD 5.7.1).

export interface AnalysisDeps {
  store: InspectionStore;
  now(): number;
  log: Logger;
}

/** 분석 단계 전체 실패 시 analysis.error.message (PRD 6.2.4: AI_FAILED는 analysis.error에만 쓴다) */
export const ANALYSIS_FAILED_MESSAGE = '원인 분석과 태스크 생성에 실패했습니다. 검사 결과는 그대로 확인할 수 있습니다.';

/**
 * 예외를 밖으로 던지지 않는다(after() 안에서 실행된다).
 * 분석 중 예외가 나면 analysis.failed + partial로 저장하고, 브라우저 검사 결과(이슈, 스크린샷)는 그대로 남긴다(AGENTS.md 6장 불변 조건 7).
 * 그 저장마저 실패하면 GET의 멈춘 검사 처리(DOMAIN_MODEL 4.4)에 맡긴다.
 */
export async function runAnalysis(id: string, deps: AnalysisDeps): Promise<void> {
  const { store, now, log } = deps;
  const started = now();
  let running: Inspection;
  try {
    const doc = await store.read(id);
    if (!doc || doc.status !== 'analyzing' || doc.analysis.status !== 'pending') {
      log('analyze-skip', { id, status: doc?.status ?? 'missing' });
      return;
    }
    // DOMAIN_MODEL 4.3 1단계
    running = await store.save({ ...doc, step: 'analyzing_issues', analysis: { status: 'running', analyzedIssueCount: 0 } });
  } catch (error) {
    log('analyze-failed', { id, code: isInspectionError(error) ? error.code : 'INTERNAL_ERROR', durationMs: now() - started });
    return;
  }

  try {
    const final = await completeAnalysis(running, deps);
    log('analyze-done', { id, status: final.status, durationMs: now() - started });
  } catch (error) {
    log('analyze-failed', { id, code: isInspectionError(error) ? error.code : 'INTERNAL_ERROR', durationMs: now() - started });
    // running은 브라우저 단계 결과 그대로다. 분석 결과는 버리고 이슈마다 사유만 채운다(DOMAIN_MODEL S-10)
    const failed: Inspection = {
      ...running,
      analysis: { status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: ANALYSIS_FAILED_MESSAGE } },
      issues: withSkippedReasons(running.issues, 'ai-failed'),
      tasks: [],
    };
    try {
      await store.save({ ...failed, status: finalStatus(failed), completedAt: new Date(now()).toISOString() });
    } catch (saveError) {
      log('analyze-save-failed', { id, code: isInspectionError(saveError) ? saveError.code : 'INTERNAL_ERROR' });
    }
  }
}

/** DOMAIN_MODEL 4.3 2~4단계. 결과는 메모리에서 모으고 마지막에 한 번에 저장한다 */
async function completeAnalysis(running: Inspection, deps: AnalysisDeps): Promise<Inspection> {
  const { store, now } = deps;
  const completedAt = () => new Date(now()).toISOString();

  // PRD 6.2.2: 이슈가 0개면 분석 없이 바로 끝낸다
  if (running.issues.length === 0) {
    const skipped: Inspection = { ...running, analysis: { status: 'skipped', analyzedIssueCount: 0 }, tasks: [] };
    return store.save({ ...skipped, status: finalStatus(skipped), completedAt: completedAt() });
  }

  const { issues, analyzedIssueCount } = await analyzeIssues(running.issues);
  await store.save({ ...running, step: 'generating_tasks' });
  const tasks = buildTasks(issues, running.viewports);
  const final: Inspection = { ...running, step: 'generating_tasks', issues, tasks, analysis: { status: 'completed', analyzedIssueCount } };
  return store.save({ ...final, status: finalStatus(final), completedAt: completedAt() });
}
