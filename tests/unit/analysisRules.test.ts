import { describe, expect, it } from 'vitest';
import { analyzeIssues } from '@/server/analysis/analyze';
import { analyzeIssueByRules, ANALYSIS_RULES, SELECTOR_NOTE, selectRule, type RuleId } from '@/server/analysis/rules';
import type { Issue, IssueOccurrence } from '@/types/inspection';
import { issue } from './helpers/issue';

// T10: 규칙 기반 원인 분석 (PRD 5.7.1). 규칙마다 맞는 경우와 맞지 않아 다음 규칙으로 넘어가는 경우

const VO = { expected: { layoutWidth: 390 }, measured: { elementRight: 493 }, delta: { overflowRight: 103 } };
const viewport = (style: Record<string, string>, width = 200, extra: Partial<IssueOccurrence> = {}): Issue =>
  issue({ type: 'viewport-overflow', subtype: 'page-scroll', occurrences: [{ ...VO, computedStyle: style, boundingBox: { x: 16, y: 100, width, height: 40 }, ...extra }] });

const CLIP_X = { measured: { scrollWidth: 227 }, expected: { clientWidth: 180 }, delta: { overflowX: 47 } };
const CLIP_Y = { measured: { scrollHeight: 90 }, expected: { clientHeight: 40 }, delta: { overflowY: 50 } };
type Axis = { measured: Record<string, number>; expected: Record<string, number>; delta: Record<string, number> };
const clipped = (style: Record<string, string>, ...axes: Axis[]): Issue =>
  issue({
    type: 'text-overflow',
    subtype: 'clipped',
    occurrences: [
      {
        computedStyle: style,
        measured: Object.assign({}, ...axes.map((a) => a.measured)),
        expected: Object.assign({}, ...axes.map((a) => a.expected)),
        delta: Object.assign({}, ...axes.map((a) => a.delta)),
      },
    ],
  });

const BOX = { role: 'bordered-ancestor' as const, selector: '.card', tag: 'div', boundingBox: { x: 16, y: 1500, width: 300, height: 120 } };
const spill = (delta: Record<string, number>, style: Record<string, string> = {}): Issue =>
  issue({ type: 'text-overflow', subtype: 'spill', occurrences: [{ delta, computedStyle: style, relatedElements: [BOX] }] });

const TARGET = { role: 'overlap-target' as const, selector: '.cancel', tag: 'button', boundingBox: { x: 64, y: 8, width: 80, height: 40 } };
const overlap = (style: Record<string, string>): Issue =>
  issue({
    type: 'element-overlap',
    subtype: 'interactive',
    occurrences: [{ computedStyle: style, measured: { intersectionArea: 968.4, overlapRatioPercent: 36.2, overlapTargetCount: 1 }, relatedElements: [TARGET] }],
  });

const CASES: { rule: RuleId; hit: Issue; miss: Issue; missRule: RuleId }[] = [
  { rule: 'V1', hit: viewport({ 'white-space': 'nowrap' }), miss: viewport({ 'white-space': 'normal' }), missRule: 'X' },
  { rule: 'V2', hit: viewport({ 'min-width': '500px' }), miss: viewport({ 'min-width': '300px' }), missRule: 'X' },
  { rule: 'V3', hit: viewport({ 'flex-shrink': '0' }, 500), miss: viewport({ 'flex-shrink': '0' }, 200), missRule: 'X' },
  { rule: 'V4', hit: viewport({ 'grid-template-columns': '200px 200px' }), miss: viewport({ 'grid-template-columns': '100px 100px' }), missRule: 'X' },
  { rule: 'V5', hit: viewport({ position: 'absolute' }), miss: viewport({ position: 'relative' }), missRule: 'X' },
  { rule: 'V6', hit: viewport({ transform: 'matrix(1, 0, 0, 1, 300, 0)' }), miss: viewport({ transform: 'none' }), missRule: 'X' },
  // 넘친 양(103px) 이상인 반대쪽 margin
  { rule: 'VM', hit: viewport({ margin: '0px 0px 0px 200px' }), miss: viewport({ margin: '0px 0px 0px 50px' }), missRule: 'X' },
  // 390.4는 반올림하면 화면 너비와 같아 넓다고 보지 않는다
  { rule: 'V7', hit: viewport({ width: '600px' }, 600), miss: viewport({ width: '390px' }, 390.4), missRule: 'X' },
  { rule: 'C1', hit: clipped({ 'white-space': 'nowrap' }, CLIP_X), miss: clipped({ 'white-space': 'normal' }, CLIP_X), missRule: 'C3' },
  { rule: 'C2', hit: clipped({ height: '40px' }, CLIP_Y), miss: clipped({ height: '40px' }, CLIP_X), missRule: 'C3' },
  { rule: 'C3', hit: clipped({ width: '180px' }, CLIP_X), miss: clipped({ width: '180px' }), missRule: 'X' },
  { rule: 'S1', hit: spill({ overflowBottom: 42 }), miss: spill({ overflowRight: 20 }), missRule: 'S2' },
  { rule: 'S2', hit: spill({ overflowRight: 20 }), miss: spill({ overflowTop: 20 }), missRule: 'X' },
  { rule: 'O1', hit: overlap({ position: 'absolute' }), miss: overlap({ position: 'static' }), missRule: 'X' },
  { rule: 'O2', hit: overlap({ margin: '0px -12px 0px 0px' }), miss: overlap({ margin: '0px 12px' }), missRule: 'X' },
  { rule: 'O3', hit: overlap({ transform: 'matrix(1, 0, 0, 1, -40, 0)' }), miss: overlap({ transform: 'none' }), missRule: 'X' },
];

describe('규칙 표 (위에서부터 처음 맞는 규칙)', () => {
  it('규칙 목록은 표 순서이고 마지막은 X다', () => {
    expect(ANALYSIS_RULES.map((r) => r.id)).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'VM', 'V7', 'C1', 'C2', 'C3', 'S1', 'S2', 'O1', 'O2', 'O3']);
  });

  for (const c of CASES) {
    it(`${c.rule}: 맞는 경우 / 맞지 않으면 ${c.missRule}`, () => {
      expect(selectRule(c.hit)).toBe(c.rule);
      expect(selectRule(c.miss)).toBe(c.missRule);
    });
  }

  it('두 조건이 모두 맞으면 위쪽 규칙', () => {
    expect(selectRule(viewport({ 'white-space': 'nowrap', 'min-width': '500px' }, 600))).toBe('V1');
    expect(selectRule(viewport({ 'min-width': '500px', 'flex-shrink': '0' }, 600))).toBe('V2');
    expect(selectRule(viewport({ position: 'absolute', transform: 'matrix(1, 0, 0, 1, 9, 0)' }, 600))).toBe('V5');
    expect(selectRule(viewport({ transform: 'matrix(1, 0, 0, 1, 9, 0)' }, 600))).toBe('V6');
    expect(selectRule(viewport({ transform: 'matrix(1, 0, 0, 1, 9, 0)', margin: '0px 0px 0px 200px' }))).toBe('V6');
    expect(selectRule(viewport({ margin: '0px 0px 0px 200px' }, 600))).toBe('VM');
    expect(selectRule(clipped({ 'white-space': 'nowrap' }, CLIP_X, CLIP_Y))).toBe('C1');
    expect(selectRule(clipped({ 'white-space': 'normal' }, CLIP_X, CLIP_Y))).toBe('C2');
    expect(selectRule(spill({ overflowBottom: 10, overflowRight: 10 }))).toBe('S1');
    expect(selectRule(overlap({ position: 'absolute', margin: '-4px', transform: 'matrix(1, 0, 0, 1, 1, 1)' }))).toBe('O1');
    expect(selectRule(overlap({ margin: '-4px', transform: 'matrix(1, 0, 0, 1, 1, 1)' }))).toBe('O2');
  });

  it('병합된 이슈는 occurrences[0]으로 규칙을 고른다', () => {
    const merged = issue({
      viewportTag: 'both',
      occurrences: [
        { ...VO, viewport: 'desktop', expected: { layoutWidth: 1440 }, computedStyle: { 'white-space': 'normal' }, boundingBox: { x: 0, y: 0, width: 1500, height: 40 } },
        { ...VO, viewport: 'mobile', computedStyle: { 'white-space': 'nowrap' } },
      ],
    });
    expect(selectRule(merged)).toBe('V7');
  });
});

describe('VM: margin 단축 값 해석', () => {
  const left = (margin: string, delta: Record<string, number>) =>
    selectRule(viewport({ margin }, 200, { delta, measured: { elementLeft: -30, elementRight: 493 } }));

  it('오른쪽으로 넘치면 margin-left, 왼쪽으로 넘치면 margin-right를 본다 (1~4개 토큰)', () => {
    expect(left('0px 0px 0px 200px', { overflowRight: 103 })).toBe('VM');
    expect(left('0px 200px 0px 0px', { overflowRight: 103 })).toBe('X');
    expect(left('0px 200px', { overflowRight: 103 })).toBe('VM');
    expect(left('120px', { overflowRight: 103 })).toBe('VM');
    expect(left('0px 40px 0px 0px', { overflowLeft: 30 })).toBe('VM');
    expect(left('0px auto', { overflowRight: 103 })).toBe('X');
    expect(left('0px 0px 0px -200px', { overflowRight: 103 })).toBe('X');
  });

  it('suggestedFix는 밀어낸 쪽 margin을 0으로 둔다', () => {
    const a = analyzeIssueByRules(viewport({ margin: '0px 0px 0px 828px' }));
    expect(a.rootCause).toBe('반대쪽 margin이 요소를 화면 밖으로 밀어냄. 근거(Mobile): `margin: 0px 0px 0px 828px`, 요소 오른쪽 끝 493px, 화면 너비 390px, 넘친 양 103px');
    expect(a.suggestedFix).toContain('  margin-left: 0;\n  max-width: 100%;');
  });
});

describe('analyzeIssueByRules 출력', () => {
  const all = [...CASES.flatMap((c) => [c.hit, c.miss])];

  it('source는 rule, certainty는 likely 또는 uncertain만 (confirmed 없음)', () => {
    for (const i of all) {
      const a = analyzeIssueByRules(i);
      expect(a.source).toBe('rule');
      expect(a.certainty).toBe(selectRule(i) === 'X' ? 'uncertain' : 'likely');
      expect(a.certainty).not.toBe('confirmed');
    }
  });

  it('rootCause의 숫자는 측정값을 Evidence와 같은 정수 반올림으로 쓴다', () => {
    const a = analyzeIssueByRules(viewport({ 'white-space': 'nowrap' }, 200, { measured: { elementRight: 493.4 }, expected: { layoutWidth: 390 } }));
    expect(a.rootCause).toBe('줄바꿈이 금지되어 내용이 화면 밖으로 나감. 근거(Mobile): `white-space: nowrap`, 요소 오른쪽 끝 493px, 화면 너비 390px');
    expect(a.cssProblem).toBe('판정 근거(Mobile): `white-space: nowrap`');

    const c = analyzeIssueByRules(clipped({ 'white-space': 'nowrap', overflow: 'hidden' }, CLIP_X));
    expect(c.rootCause).toContain('내용 너비 227px, 컨테이너 너비 180px');
    const s = analyzeIssueByRules(spill({ overflowBottom: 41.6 }));
    expect(s.rootCause).toBe('상위 영역의 높이가 고정되어 텍스트가 아래로 넘침. 근거(Mobile): 상위 영역 `.card` 높이 120px, 아래쪽으로 42px 넘침');
    const o = analyzeIssueByRules(overlap({ position: 'absolute' }));
    expect(o.rootCause).toContain('겹친 면적 968px², 작은 요소 면적의 36%, 겹친 요소 `.cancel`');
  });

  it('병합된 이슈: viewport 값이 같으면 한 번, 다르면 viewport별로 적는다', () => {
    const same = overlap({ position: 'absolute' });
    const both = { ...same, viewportTag: 'both' as const, occurrences: [{ ...same.occurrences[0], viewport: 'desktop' as const }, same.occurrences[0]] };
    expect(analyzeIssueByRules(both).rootCause).toContain('근거(Desktop, Mobile): `position: absolute`');

    const differ = issue({
      viewportTag: 'both',
      occurrences: [
        { ...VO, viewport: 'desktop', expected: { layoutWidth: 1440 }, measured: { elementRight: 1484 }, computedStyle: { 'white-space': 'nowrap' } },
        { ...VO, viewport: 'mobile', computedStyle: { 'white-space': 'nowrap' } },
      ],
    });
    expect(analyzeIssueByRules(differ).rootCause).toBe(
      '줄바꿈이 금지되어 내용이 화면 밖으로 나감. 근거(Desktop): `white-space: nowrap`, 요소 오른쪽 끝 1484px, 화면 너비 1440px; 근거(Mobile): `white-space: nowrap`, 요소 오른쪽 끝 493px, 화면 너비 390px',
    );
  });

  it('suggestedFix: selector를 쓴 CSS 예시와 selector 안내를 포함한다. S1은 상위 영역 selector', () => {
    const v = analyzeIssueByRules(viewport({ 'white-space': 'nowrap' }));
    expect(v.suggestedFix).toContain('```css\n.target {\n  white-space: normal;');
    expect(v.suggestedFix.endsWith(SELECTOR_NOTE)).toBe(true);
    expect(analyzeIssueByRules(spill({ overflowBottom: 10 })).suggestedFix).toContain('```css\n.card {\n  height: auto;');
  });

  it('X: 원인을 특정하지 못하면 확인한 CSS 값을 나열하고 CSS 예시를 만들지 않는다', () => {
    const a = analyzeIssueByRules(viewport({ position: 'static', width: '400px', margin: '24px 0px 0px', 'font-size': '16px' }));
    expect(a.certainty).toBe('uncertain');
    expect(a.cssProblem).toBe('확인한 CSS(Mobile): `position: static`, `width: 400px`, `margin: 24px 0px 0px`');
    expect(a.rootCause).toContain('규칙 표에 맞는 원인을 특정하지 못함');
    expect(a.suggestedFix).not.toContain('```');
    expect(a.suggestedFix).toContain(SELECTOR_NOTE);
  });

  it('페이지에서 가져온 텍스트(textSnippet, htmlSnippet, landmark)는 문구에 넣지 않는다', () => {
    const i = viewport({ 'white-space': 'nowrap' });
    const hints = { ...i.sourceHints, textSnippet: 'PAGE_TEXT', landmark: 'PAGE_LANDMARK', htmlSnippet: '<div>PAGE_HTML</div>' };
    const withText = { ...i, sourceHints: hints, occurrences: i.occurrences.map((o) => ({ ...o, sourceHints: hints })) };
    expect(JSON.stringify(analyzeIssueByRules(withText))).not.toMatch(/PAGE_/);
  });

  it('같은 입력이면 같은 결과', () => {
    for (const i of all) expect(JSON.stringify(analyzeIssueByRules(i))).toBe(JSON.stringify(analyzeIssueByRules(structuredClone(i))));
  });
});

describe('analyzeIssues (분석 단계, T15에서 AI로 바뀔 자리)', () => {
  it('needsReview는 analysisSkippedReason만, 나머지는 규칙 분석. 결정적 필드는 그대로', async () => {
    const normal = viewport({ 'white-space': 'nowrap' });
    const review = { ...overlap({ position: 'absolute' }), id: 'ISS-002', needsReview: true, confidence: 0.4 };
    const { issues, analyzedIssueCount } = await analyzeIssues([normal, review]);
    expect(analyzedIssueCount).toBe(1);
    expect(issues[0].analysis?.source).toBe('rule');
    expect(issues[0].analysisSkippedReason).toBeUndefined();
    expect(issues[1].analysis).toBeUndefined();
    expect(issues[1].analysisSkippedReason).toBe('needs-review');
    const strip = (i: Issue) => {
      const copy: Issue = { ...i };
      delete copy.analysis;
      delete copy.analysisSkippedReason;
      return copy;
    };
    expect(issues.map(strip)).toEqual([normal, review]);
  });

  it('개수 제한(30개)을 적용하지 않는다', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...viewport({ 'white-space': 'nowrap' }), id: `ISS-${String(i + 1).padStart(3, '0')}` }));
    const { issues, analyzedIssueCount } = await analyzeIssues(many);
    expect(analyzedIssueCount).toBe(40);
    expect(issues.every((i) => i.analysis !== undefined)).toBe(true);
  });
});
