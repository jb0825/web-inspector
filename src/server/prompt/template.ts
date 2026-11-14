import 'server-only';
import { VIEWPORT_LABEL } from '@/server/evidence/sentences';
import type { Inspection, Issue, Viewport, ViewportTag } from '@/types/inspection';
import { inlineCode, singleLine } from './markdown';

// 코딩 에이전트용 최종 프롬프트 (PRD 5.9.1). 템플릿을 문서 그대로 구현한다.
// 측정값, Issue ID, selector, Evidence 문장은 원본 데이터에서 직접 넣고, 분석 필드(rootCause, suggestedFix)만 정해진 자리에 넣는다
// (AGENTS.md 6장 불변 조건 3). 페이지에서 가져온 문자열은 줄바꿈을 공백으로 바꾸고 백틱 구분자를 늘려 Markdown 구조를 지킨다.

/** PRD 5.9.1: analysis가 없는 이슈의 Root Cause와 Required Changes 자리 */
export const NO_ANALYSIS_TEXT = 'AI 분석 없음 — 위 Evidence와 소스 코드를 직접 확인한다.';

const SOURCE_LABEL: Record<NonNullable<Issue['analysis']>['source'], string> = { rule: 'rule-based', ai: 'AI' };

const OTHER: Record<Viewport, Viewport> = { desktop: 'mobile', mobile: 'desktop' };

export interface PromptTask {
  title: string;
  description: string;
  priority: string;
  viewportTag: ViewportTag | null;
  /** issueIds 순서의 이슈 */
  issues: readonly Issue[];
  acceptanceCriteria: readonly string[];
}

/** PRD 5.9.1 {otherViewportConstraint} */
function otherViewportConstraint(tag: ViewportTag | null): string {
  if (tag === 'both') return 'Desktop과 Mobile 모두에서 아래 Acceptance Criteria를 만족해야 한다.';
  if (tag === 'mobile-only' || tag === 'desktop-only') {
    return `다른 viewport(${VIEWPORT_LABEL[OTHER[tag === 'mobile-only' ? 'mobile' : 'desktop']]})의 레이아웃을 깨뜨리지 않는다.`;
  }
  // PRD에 없는 경우: 한 viewport가 실패한 검사(PRD 5.6)라 다른 viewport는 측정하지 못했다
  return '다른 viewport는 검사하지 못했으므로, 수정한 뒤 Desktop과 Mobile에서 모두 레이아웃을 확인한다.';
}

function evidenceLines(issue: Issue, viewports: Inspection['viewports']): string[] {
  return issue.occurrences.flatMap((o) => {
    const vr = viewports[o.viewport];
    const size = vr ? `${vr.layoutWidth}×${vr.height}` : 'n/a';
    return [`- ${VIEWPORT_LABEL[o.viewport]} (${size}): ${singleLine(o.evidenceText)}`, `  - Selector: ${inlineCode(o.selector)}`];
  });
}

/** PRD 5.9.1: 값이 없는 Source Hints 항목은 줄째로 생략한다 */
function sourceLines(issue: Issue): string[] {
  const { landmark, textSnippet, stableAttributes, htmlSnippet } = issue.sourceHints;
  const attributes = Object.keys(stableAttributes)
    .sort()
    .map((key) => inlineCode(`${key}="${stableAttributes[key]}"`));
  return [
    landmark ? `- Section: ${singleLine(landmark)}` : null,
    textSnippet ? `- Text: "${singleLine(textSnippet)}"` : null,
    attributes.length > 0 ? `- Attributes: ${attributes.join(', ')}` : null,
    htmlSnippet ? `- HTML: ${inlineCode(htmlSnippet)}` : null,
  ].filter((line): line is string => line !== null);
}

function issueBlock(issue: Issue, viewports: Inspection['viewports']): string {
  const { analysis } = issue;
  const sources = sourceLines(issue);
  const lines = [
    `## [${issue.id}] ${singleLine(issue.title)}`,
    '',
    '### Evidence (measured in browser)',
    ...evidenceLines(issue, viewports),
    '',
    ...(sources.length > 0 ? ['### How to locate the element in source', ...sources, ''] : []),
    // analysis가 없으면 certainty와 출처가 없으므로 괄호를 쓰지 않는다
    analysis ? `### Likely Root Cause (${analysis.certainty}, ${SOURCE_LABEL[analysis.source]})` : '### Likely Root Cause',
    analysis ? analysis.rootCause : NO_ANALYSIS_TEXT,
    '',
    '### Required Changes',
    analysis ? analysis.suggestedFix : NO_ANALYSIS_TEXT,
  ];
  return lines.join('\n');
}

/** PRD 5.9.1 템플릿 조립 */
export function buildPrompt(task: PromptTask, viewports: Inspection['viewports']): string {
  const lines = [
    `# Task: ${singleLine(task.title)}`,
    `Priority: ${task.priority} | Viewport: ${task.viewportTag ?? '비교 불가'}`,
    '',
    '## Problem',
    task.description,
    '',
    ...task.issues.flatMap((issue) => [issueBlock(issue, viewports), '']),
    '## Constraints',
    `- ${otherViewportConstraint(task.viewportTag)}`,
    '- 관련 없는 컴포넌트와 스타일은 수정하지 않는다.',
    '- 위 Root Cause는 추정일 수 있으니, 소스 코드를 확인한 뒤 수정한다.',
    '',
    '## Acceptance Criteria',
    ...task.acceptanceCriteria.map((line) => `- ${singleLine(line)}`),
    '',
  ];
  return lines.join('\n');
}
