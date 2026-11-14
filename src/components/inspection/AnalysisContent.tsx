import { InlineCodeText, MarkdownText } from '@/components/ui/MarkdownText';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { Issue } from '@/types/inspection';
import { AnalysisSourceBadge, CertaintyBadge } from './badges';
import { ANALYSIS_UNAVAILABLE_MESSAGES } from './labels';

// 원인 분석 영역 (WIREFRAME 6.6, DESIGN_GUIDE 6.13). Issue Detail과 태스크 상세가 함께 쓴다.
// 측정(Evidence)과 구분되도록 background-secondary 영역에 두고, 출처 배지와 certainty 배지를 항상 함께 표시한다.
// 추정 문장은 표나 mono로 표현하지 않는다(코드 예시와 인라인 코드만 mono).

/** 분석이 없는 이유 (USER_FLOW 6.6). 분석 결과가 오기 전이면 analyzing */
export function analysisUnavailableMessage(issue: Pick<Issue, 'analysisSkippedReason'>, analyzing: boolean): string {
  if (issue.analysisSkippedReason) return ANALYSIS_UNAVAILABLE_MESSAGES[issue.analysisSkippedReason];
  return analyzing ? ANALYSIS_UNAVAILABLE_MESSAGES.analyzing : ANALYSIS_UNAVAILABLE_MESSAGES.unknown;
}

export function AnalysisBadges({ analysis }: { analysis: NonNullable<Issue['analysis']> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <AnalysisSourceBadge source={analysis.source} />
      <CertaintyBadge certainty={analysis.certainty} />
    </span>
  );
}

interface AnalysisContentProps {
  issue: Pick<Issue, 'analysis' | 'analysisSkippedReason'>;
  /** 검사가 analyzing이고 이 이슈의 분석이 아직 없다 */
  analyzing: boolean;
  /** 원인 / CSS 문제 / 수정 방향 / 수정 제안 중 보여줄 것 (태스크 상세는 원인과 수정 제안만) */
  compact?: boolean;
  className?: string;
}

export function AnalysisContent({ issue, analyzing, compact = false, className }: AnalysisContentProps) {
  const analysis = issue.analysis;
  if (!analysis) {
    const waiting = analyzing && !issue.analysisSkippedReason;
    return (
      <p className={cn('flex items-center gap-2 text-body-sm text-text-secondary', className)} role={waiting ? 'status' : undefined}>
        {waiting ? <Spinner size={14} /> : null}
        {analysisUnavailableMessage(issue, analyzing)}
      </p>
    );
  }
  const rows = compact
    ? [{ label: '원인', text: analysis.rootCause }]
    : [
        { label: '원인', text: analysis.rootCause },
        { label: 'CSS 문제', text: analysis.cssProblem },
        { label: '수정 방향', text: analysis.fixDirection },
      ];
  return (
    <div className={cn('flex flex-col gap-3 text-body', className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-0.5">
          <p className="text-body-sm font-medium text-text-secondary">{row.label}</p>
          <p className="text-text-primary">
            <InlineCodeText text={row.text} />
          </p>
        </div>
      ))}
      <div className="flex flex-col gap-1">
        <p className="text-body-sm font-medium text-text-secondary">수정 제안</p>
        <MarkdownText source={analysis.suggestedFix} className="text-body-sm text-text-primary" />
      </div>
    </div>
  );
}
