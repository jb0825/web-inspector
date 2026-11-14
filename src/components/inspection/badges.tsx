import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { formatConfidence } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Issue, IssueType, Priority, ViewportTag } from '@/types/inspection';
import { ANALYSIS_SOURCE_LABELS, ISSUE_TYPE_LABELS, VIEWPORT_TAG_UNAVAILABLE } from './labels';

// 도메인 값을 표시만 하는 배지 (AGENTS.md 3.1, DESIGN_GUIDE 6.3). 값 → 라벨·색 변환을 이 파일 한 곳에 둔다(17장-4)

const PRIORITY_TONE: Record<Priority, BadgeTone> = { P0: 'p0', P1: 'p1', P2: 'p2', P3: 'p3' };

/** 색만으로 구분하지 않도록 P0 같은 텍스트 라벨을 항상 쓴다(2.5) */
export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <Badge tone={PRIORITY_TONE[priority]} className={cn('font-mono', className)}>
      {priority}
    </Badge>
  );
}

/** viewport 태그는 neutral 한 가지 색으로 두고 텍스트로 구분한다(6.3). null은 한 viewport가 실패한 검사(PRD 5.6) */
export function ViewportTagBadge({ tag, hideWhenNull = false }: { tag: ViewportTag | null; hideWhenNull?: boolean }) {
  if (tag === null && hideWhenNull) return null;
  return <Badge tone="neutral">{tag ?? VIEWPORT_TAG_UNAVAILABLE}</Badge>;
}

type Certainty = NonNullable<Issue['analysis']>['certainty'];
const CERTAINTY_TONE: Record<Certainty, BadgeTone> = { confirmed: 'success', likely: 'info', uncertain: 'neutral' };

export function CertaintyBadge({ certainty }: { certainty: Certainty }) {
  return <Badge tone={CERTAINTY_TONE[certainty]}>{certainty}</Badge>;
}

/** 원인 분석의 출처. 측정값이 아니라 추정임을 드러낸다(WIREFRAME 1.2-5) */
export function AnalysisSourceBadge({ source }: { source: NonNullable<Issue['analysis']>['source'] }) {
  return <span className="text-caption text-text-secondary">{ANALYSIS_SOURCE_LABELS[source]}</span>;
}

/** 이슈 유형은 배지가 아니라 텍스트로 쓴다(6.3) */
export function IssueTypeLabel({ type, subtype, className }: { type: IssueType; subtype?: string; className?: string }) {
  return (
    <span className={cn('whitespace-nowrap', className)}>
      {ISSUE_TYPE_LABELS[type]}
      {subtype ? <span className="text-text-secondary"> · {subtype}</span> : null}
    </span>
  );
}

/** DESIGN_GUIDE 6.5: caption, text-secondary, mono 숫자. always가 아니면 1.0일 때 숨긴다 */
export function ConfidenceText({ confidence, always = false }: { confidence: number; always?: boolean }) {
  if (!always && confidence >= 1) return null;
  return (
    <span className="text-caption whitespace-nowrap text-text-secondary">
      Confidence <span className="font-mono tabular-nums">{formatConfidence(confidence)}</span>
    </span>
  );
}
