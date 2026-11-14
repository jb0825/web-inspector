import { describe, expect, it } from 'vitest';
import { analyzeIssues } from '@/server/analysis/analyze';
import { codeBlock, inlineCode, singleLine } from '@/server/prompt/markdown';
import { buildPrompt, NO_ANALYSIS_TEXT } from '@/server/prompt/template';
import { buildTasks } from '@/server/tasks/build';
import type { Issue } from '@/types/inspection';
import { issue } from './helpers/issue';
import { P01_ISSUE, P01_VIEWPORTS } from './helpers/p01';

// T10: 코딩 에이전트 프롬프트 조립 (PRD 5.9.1)

async function tasksFor(issues: Issue[]) {
  const { issues: analyzed } = await analyzeIssues(issues);
  return buildTasks(analyzed, P01_VIEWPORTS);
}

describe('markdown 도구', () => {
  it('inlineCode: 값 안의 백틱보다 긴 구분자, 백틱으로 시작·끝나면 공백 패딩, 줄바꿈은 공백', () => {
    expect(inlineCode('.a')).toBe('`.a`');
    expect(inlineCode('a`b')).toBe('``a`b``');
    expect(inlineCode('`x``')).toBe('``` `x`` ```');
    expect(inlineCode('a\nb\r\nc')).toBe('`a b c`');
  });

  it('codeBlock: 내용 안의 백틱 묶음보다 긴 구분자 (최소 3개)', () => {
    expect(codeBlock('css', 'a {}')).toBe('```css\na {}\n```');
    expect(codeBlock('css', '```\n````')).toBe('`````css\n```\n````\n`````');
  });

  it('singleLine: 내용은 그대로 두고 줄바꿈만 공백으로', () => {
    expect(singleLine('# 제목\n- 목록 끝')).toBe('# 제목 - 목록 끝');
  });
});

describe('buildPrompt (PRD 5.9.1)', () => {
  it('P-01 프롬프트 전체 (스냅샷)', async () => {
    const [task] = await tasksFor([P01_ISSUE]);
    await expect(task.prompt).toMatchFileSnapshot('./__snapshots__/p01-prompt.md');
  });

  it('측정값, Issue ID, selector, Evidence 문장이 원본 이슈와 정확히 같다', async () => {
    const [task] = await tasksFor([P01_ISSUE]);
    const occ = P01_ISSUE.occurrences[0];
    expect(task.prompt).toContain(`## [${P01_ISSUE.id}] ${P01_ISSUE.title}`);
    expect(task.prompt).toContain(`- Mobile (${P01_VIEWPORTS.mobile?.layoutWidth}×${P01_VIEWPORTS.mobile?.height}): ${occ.evidenceText}`);
    expect(task.prompt).toContain(`  - Selector: \`${occ.selector}\``);
    expect(task.prompt).toContain(`${Math.round(occ.measured.elementRight)}px`);
    expect(task.prompt).toContain(`${occ.expected.layoutWidth}px`);
    expect(task.prompt).toContain(`${occ.delta.overflowRight}px`);
    expect(task.prompt).toContain('### Likely Root Cause (likely, rule-based)');
  });

  it('값이 없는 Source Hints 줄은 생략한다', async () => {
    const [task] = await tasksFor([issue({ id: 'ISS-001' })]);
    expect(task.prompt).toContain('- HTML: `<div class="target">`');
    expect(task.prompt).not.toMatch(/- Section:|- Text:|- Attributes:/);
    const [full] = await tasksFor([P01_ISSUE]);
    expect(full.prompt).toContain('- Section: 요금제 한눈에 보기');
    expect(full.prompt).toContain('- Text: "베이직 월 9,900원 프로 월 19,900원 팀 월 49,900원"');
    expect(full.prompt).toContain('- Attributes: `data-testid="p01-fixed-box"`');
  });

  it('{otherViewportConstraint}: 한쪽 viewport / both / 비교 불가', async () => {
    const one = await tasksFor([issue({ id: 'ISS-001', viewportTag: 'mobile-only' })]);
    expect(one[0].prompt).toContain('- 다른 viewport(Desktop)의 레이아웃을 깨뜨리지 않는다.');
    const desktop = await tasksFor([issue({ id: 'ISS-001', viewportTag: 'desktop-only' })]);
    expect(desktop[0].prompt).toContain('- 다른 viewport(Mobile)의 레이아웃을 깨뜨리지 않는다.');
    const both = await tasksFor([issue({ id: 'ISS-001', viewportTag: 'both' })]);
    expect(both[0].prompt).toContain('- Desktop과 Mobile 모두에서 아래 Acceptance Criteria를 만족해야 한다.');
    const none = await tasksFor([issue({ id: 'ISS-001', viewportTag: null })]);
    expect(none[0].prompt).toContain('- 다른 viewport는 검사하지 못했으므로');
    expect(none[0].prompt).toContain('Viewport: 비교 불가');
  });

  it('analysis가 없는 이슈(Needs Review)는 Root Cause와 Required Changes에 대체 문구', async () => {
    const [task] = await tasksFor([issue({ id: 'ISS-001', needsReview: true })]);
    expect(task.needsReview).toBe(true);
    expect(task.prompt).toContain(`### Likely Root Cause\n${NO_ANALYSIS_TEXT}\n\n### Required Changes\n${NO_ANALYSIS_TEXT}`);
  });

  it('백틱과 줄바꿈이 들어간 htmlSnippet·textSnippet·selector에서도 Markdown 구조가 유지된다', async () => {
    const hints = {
      htmlSnippet: '<code data-x="`a``b`">\n## 가짜 제목\n```',
      textSnippet: '첫 줄\n# 가짜 제목\n- 가짜 목록',
      landmark: '섹션\n## 가짜',
      stableAttributes: { 'aria-label': 'x`y\nz' },
      ancestorPath: 'body',
    };
    const [task] = await tasksFor([
      issue({
        id: 'ISS-001',
        occurrences: [{ selector: '[data-x="`a``b`"]\n# x', sourceHints: hints, evidenceText: '증거\n## 가짜', computedStyle: { 'white-space': 'nowrap' } }],
      }),
    ]);
    const lines = task.prompt.split('\n');
    // 페이지 문자열이 만든 줄이 없다: 제목은 템플릿이 만든 것뿐이다
    expect(lines.filter((l) => l.startsWith('#'))).toEqual([
      expect.stringMatching(/^# Task: /),
      '## Problem',
      expect.stringMatching(/^## \[ISS-001\] /),
      '### Evidence (measured in browser)',
      '### How to locate the element in source',
      '### Likely Root Cause (likely, rule-based)',
      '### Required Changes',
      '## Constraints',
      '## Acceptance Criteria',
    ]);
    expect(task.prompt).toContain('- HTML: ```` <code data-x="`a``b`"> ## 가짜 제목 ``` ````');
    expect(task.prompt).toContain('- Text: "첫 줄 # 가짜 제목 - 가짜 목록"');
    expect(task.prompt).toContain('- Section: 섹션 ## 가짜');
    expect(task.prompt).toContain('  - Selector: ```[data-x="`a``b`"] # x```');
    expect(task.prompt).toContain('- Attributes: ``aria-label="x`y z"``');
    // suggestedFix 코드 블록의 구분자도 내용의 백틱보다 길다
    expect(task.prompt).toContain('```css\n[data-x="`a``b`"] # x {');
  });

  it('태스크의 모든 Issue ID가 프롬프트에 들어 있다 (DOMAIN_MODEL T-8)', async () => {
    const issues = Array.from({ length: 5 }, (_, i) => issue({ id: `ISS-00${i + 1}`, landmark: 'Hero' }));
    const [task] = await tasksFor(issues);
    for (const i of issues) expect(task.prompt).toContain(`## [${i.id}]`);
  });

  it('buildPrompt는 같은 입력에 같은 문자열', async () => {
    const [task] = await tasksFor([P01_ISSUE]);
    const { issues } = await analyzeIssues([P01_ISSUE]);
    expect(buildPrompt({ ...task, issues }, P01_VIEWPORTS)).toBe(task.prompt);
  });
});
