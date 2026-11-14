import 'server-only';
import type { Issue } from '@/types/inspection';
import { analyzeIssueByRules } from './rules';

// 분석 단계의 이슈별 원인 분석 (PRD 5.7.1, DOMAIN_MODEL 4.3 2단계).
// 결정적 필드(측정값, ID, Priority, 연결)는 바꾸지 않고 analysis 또는 analysisSkippedReason만 채운다(AGENTS.md 6장 불변 조건 1).

export interface AnalyzeIssuesResult {
  /** 입력과 같은 순서 */
  issues: Issue[];
  /** analysis가 채워진 이슈 수 */
  analyzedIssueCount: number;
}

/**
 * - needsReview: analysisSkippedReason 'needs-review', analysis 없음 (DOMAIN_MODEL S-9)
 * - 그 밖: 규칙 기반 분석. AI 비용 때문에 둔 개수 제한(PRD 5.7.2의 30개)은 적용하지 않는다.
 * 지금은 동기 계산이지만, AI로 바뀔 자리라 Promise를 돌려준다.
 */
// TODO(T15): AI 연동. AI가 실패한 이슈는 규칙 분석 결과를 그대로 쓴다(PRD 5.7.1)
export async function analyzeIssues(issues: readonly Issue[]): Promise<AnalyzeIssuesResult> {
  const out = issues.map((issue): Issue => {
    const rest: Issue = { ...issue };
    delete rest.analysis;
    delete rest.analysisSkippedReason;
    if (issue.needsReview) return { ...rest, analysisSkippedReason: 'needs-review' };
    return { ...rest, analysis: analyzeIssueByRules(issue) };
  });
  return { issues: out, analyzedIssueCount: out.filter((i) => i.analysis !== undefined).length };
}
