import 'server-only';
import { VIEWPORT_LABEL } from '@/server/evidence/sentences';
import { codeBlock, inlineCode, singleLine } from '@/server/prompt/markdown';
import type { Issue, IssueOccurrence, IssueType } from '@/types/inspection';

// 규칙 기반 원인 분석 (PRD 5.7.1). 측정값과 computedStyle(PRD 5.7.2 화이트리스트)로 원인 후보를 고른다.
// 순수 함수다. 같은 입력이면 같은 문자열을 만든다(AGENTS.md 6장 불변 조건 5).
// 규칙 표와 문구는 이 파일 한 곳에 둔다(명세: DETECTION_RULES 13.1). 페이지에서 가져온 텍스트는 문구에 넣지 않는다(selector와 CSS 값만).
//
// computedStyle은 계산된 값이라 작성자가 쓴 원래 값(고정 px인지 %인지)을 알 수 없다.
// 그래서 certainty는 likely(맞는 규칙 있음) 또는 uncertain(규칙 X)만 쓰고 confirmed는 쓰지 않는다(PRD 5.7.1).

export type IssueAnalysis = NonNullable<Issue['analysis']>;

export type RuleId =
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'VM' | 'V7'
  | 'C1' | 'C2' | 'C3'
  | 'S1' | 'S2'
  | 'O1' | 'O2' | 'O3'
  | 'X';

/** suggestedFix 끝에 붙이는 안내. 빌드된 selector가 소스와 다를 수 있다 */
export const SELECTOR_NOTE =
  '※ selector는 빌드된 DOM 기준이므로 소스 코드의 클래스명이나 컴포넌트 구조와 다를 수 있다. 위 Source Hints로 소스 위치를 찾아 적용한다.';

interface RuleContext {
  issue: Issue;
  occ: IssueOccurrence;
}

interface RuleDef {
  id: RuleId;
  /** 표의 "대상 + 조건". occurrences[0]으로 판정한다 */
  match(ctx: RuleContext): boolean;
  /** 원인 요지 */
  cause: string;
  /** 수정 방향 */
  fix: string;
  /** cssProblem: 판정에 쓴 CSS 속성과 값 */
  cssProblem(ctx: RuleContext): string;
  /** rootCause 근거: 판정에 쓴 CSS 값과 측정값 */
  basis(ctx: RuleContext): string[];
  /** suggestedFix의 CSS 예시. 대상 selector와 선언 목록 */
  css(ctx: RuleContext): { selector: string; declarations: string[] };
}

// ── 값 읽기 ──

/** Evidence 문장과 같은 반올림(정수 px, PRD 5.4.3) */
const n = (value: number | undefined): number => Math.round(value ?? 0);
const has = (record: Record<string, number>, key: string): boolean => (record[key] ?? 0) > 0;

const style = (ctx: RuleContext, prop: string): string | undefined => ctx.occ.computedStyle[prop];

/** `NNpx` 값만 숫자로. auto, %, none 등은 null */
function px(value: string | undefined): number | null {
  const m = value?.trim().match(/^(-?\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : null;
}

/** 계산된 grid-template-columns의 px 트랙 합. px 트랙이 없으면 null (줄 이름 등 px가 아닌 토큰은 건너뛴다) */
function gridPxSum(value: string | undefined): number | null {
  if (!value || value === 'none') return null;
  const tracks = value.split(/\s+/).map(px).filter((v): v is number => v !== null);
  return tracks.length > 0 ? tracks.reduce((a, b) => a + b, 0) : null;
}

/**
 * 계산된 margin 단축 값(1~4개 토큰)의 좌우 값. CSS 단축 표기 규칙대로 펼친다.
 * px가 아닌 값(auto 등)은 null
 */
function horizontalMargins(value: string | undefined): { left: number | null; right: number | null } {
  const t = (value ?? '').trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return { left: null, right: null };
  const right = t.length === 1 ? t[0] : t[1];
  const left = t.length === 4 ? t[3] : right;
  return { left: px(left), right: px(right) };
}

/**
 * VM: 넘친 쪽 반대편의 양수 margin이 넘친 양 이상이면 margin이 요소를 화면 밖으로 밀었다고 본다.
 * 오른쪽으로 넘침 → margin-left, 왼쪽으로 넘침 → margin-right. 해당하는 쪽이 없으면 null
 */
function pushingMargin(ctx: RuleContext): { side: 'left' | 'right'; value: number } | null {
  const { left, right } = horizontalMargins(style(ctx, 'margin'));
  const { delta } = ctx.occ;
  if (has(delta, 'overflowRight') && left !== null && left > 0 && n(left) >= n(delta.overflowRight)) return { side: 'left', value: left };
  if (has(delta, 'overflowLeft') && right !== null && right > 0 && n(right) >= n(delta.overflowLeft)) return { side: 'right', value: right };
  return null;
}

/** 계산된 margin 단축 값에 음수 px가 있는지 */
const hasNegativeMargin = (value: string | undefined): boolean =>
  (value ?? '').split(/\s+/).some((token) => (px(token) ?? 0) < 0);

const layoutWidth = (ctx: RuleContext): number | undefined => ctx.occ.expected.layoutWidth;
const widerThanLayout = (ctx: RuleContext): boolean => {
  const lw = layoutWidth(ctx);
  return lw !== undefined && n(ctx.occ.boundingBox.width) > n(lw);
};

/** `prop: value` 인라인 코드. 값이 없으면 null */
function decl(ctx: RuleContext, prop: string): string | null {
  const value = style(ctx, prop);
  return value === undefined ? null : inlineCode(`${prop}: ${value}`);
}
const decls = (ctx: RuleContext, props: readonly string[]): string[] =>
  props.map((p) => decl(ctx, p)).filter((d): d is string => d !== null);

// ── 유형별 근거 수치 ──

function viewportFacts(ctx: RuleContext, withWidth = false): string[] {
  const { measured, expected, delta, boundingBox } = ctx.occ;
  const out: string[] = [];
  if (withWidth) out.push(`요소 너비 ${n(boundingBox.width)}px`);
  if (has(delta, 'overflowRight')) out.push(`요소 오른쪽 끝 ${n(measured.elementRight)}px`);
  if (has(delta, 'overflowLeft')) out.push(`요소 왼쪽 끝 ${n(measured.elementLeft)}px`);
  out.push(`화면 너비 ${n(expected.layoutWidth)}px`);
  return out;
}

const hasAxis = (ctx: RuleContext, axis: 'x' | 'y'): boolean => (axis === 'x' ? 'overflowX' : 'overflowY') in ctx.occ.delta;

function clippedFacts(ctx: RuleContext, axes: readonly ('x' | 'y')[]): string[] {
  const { measured, expected } = ctx.occ;
  return axes.filter((axis) => hasAxis(ctx, axis)).map((axis) =>
    axis === 'x'
      ? `내용 너비 ${n(measured.scrollWidth)}px, 컨테이너 너비 ${n(expected.clientWidth)}px`
      : `내용 높이 ${n(measured.scrollHeight)}px, 컨테이너 높이 ${n(expected.clientHeight)}px`,
  );
}

/** spill의 넘친 방향 (DETECTION_RULES 4.2). Evidence 문장과 같은 순서: 왼쪽, 오른쪽, 위쪽, 아래쪽 */
const SPILL_DIRECTIONS = [
  ['overflowLeft', '왼쪽'],
  ['overflowRight', '오른쪽'],
  ['overflowTop', '위쪽'],
  ['overflowBottom', '아래쪽'],
] as const;

function spillFacts(ctx: RuleContext, keys: readonly (typeof SPILL_DIRECTIONS)[number][0][]): string[] {
  const { delta } = ctx.occ;
  return SPILL_DIRECTIONS.filter(([key]) => keys.includes(key) && has(delta, key)).map(
    ([key, label]) => `${label}으로 ${n(delta[key])}px 넘침`,
  );
}

/** spill의 테두리 상위 영역(bordered-ancestor) */
const container = (ctx: RuleContext) => ctx.occ.relatedElements.find((r) => r.role === 'bordered-ancestor');

function overlapFacts(ctx: RuleContext): string[] {
  const { measured, relatedElements } = ctx.occ;
  const out = [`겹친 면적 ${n(measured.intersectionArea)}px²`, `작은 요소 면적의 ${n(measured.overlapRatioPercent)}%`];
  if (relatedElements[0]) out.push(`겹친 요소 ${inlineCode(relatedElements[0].selector)}`);
  return out;
}

function typeFacts(ctx: RuleContext): string[] {
  switch (ctx.issue.type) {
    case 'viewport-overflow':
      return viewportFacts(ctx, true);
    case 'element-overlap':
      return overlapFacts(ctx);
    case 'text-overflow':
      return ctx.issue.subtype === 'clipped' ? clippedFacts(ctx, ['x', 'y']) : spillFacts(ctx, ['overflowLeft', 'overflowRight', 'overflowTop', 'overflowBottom']);
  }
}

/** 규칙 X에서 나열하는 CSS 속성 (유형별, PRD 5.7.2 화이트리스트 안) */
const CHECKED_PROPS: Record<IssueType | 'text-overflow/spill', readonly string[]> = {
  'viewport-overflow': ['position', 'width', 'min-width', 'max-width', 'flex-shrink', 'grid-template-columns', 'white-space', 'transform', 'margin'],
  'text-overflow': ['width', 'height', 'overflow', 'white-space', 'overflow-wrap', 'word-break', 'text-overflow'],
  'text-overflow/spill': ['height', 'white-space', 'overflow-wrap', 'word-break', 'line-height'],
  'element-overlap': ['position', 'margin', 'transform', 'z-index'],
};
const checkedProps = (issue: Issue) => CHECKED_PROPS[issue.type === 'text-overflow' && issue.subtype === 'spill' ? 'text-overflow/spill' : issue.type];

// ── 규칙 표 (위에서부터 처음 맞는 규칙) ──

const isViewport = (ctx: RuleContext) => ctx.issue.type === 'viewport-overflow';
const isClipped = (ctx: RuleContext) => ctx.issue.type === 'text-overflow' && ctx.issue.subtype === 'clipped';
const isSpill = (ctx: RuleContext) => ctx.issue.type === 'text-overflow' && ctx.issue.subtype === 'spill';
const isOverlap = (ctx: RuleContext) => ctx.issue.type === 'element-overlap';
const positioned = (ctx: RuleContext) => ['absolute', 'fixed'].includes(style(ctx, 'position') ?? '');
const transformed = (ctx: RuleContext) => {
  const t = style(ctx, 'transform');
  return t !== undefined && t !== 'none';
};
const target = (ctx: RuleContext) => ctx.occ.selector;

export const ANALYSIS_RULES: readonly RuleDef[] = [
  {
    id: 'V1',
    match: (ctx) => isViewport(ctx) && ['nowrap', 'pre'].includes(style(ctx, 'white-space') ?? ''),
    cause: '줄바꿈이 금지되어 내용이 화면 밖으로 나감',
    fix: '줄바꿈을 허용하거나, 한 줄 유지가 의도라면 overflow와 text-overflow로 잘림을 처리한다',
    cssProblem: (ctx) => decls(ctx, ['white-space']).join(', '),
    basis: (ctx) => [...decls(ctx, ['white-space']), ...viewportFacts(ctx)],
    css: (ctx) => ({
      selector: target(ctx),
      declarations: ['white-space: normal;', 'overflow-wrap: anywhere;', '/* 한 줄 유지가 의도라면: overflow: hidden; text-overflow: ellipsis; */'],
    }),
  },
  {
    id: 'V2',
    match: (ctx) => {
      const min = px(style(ctx, 'min-width'));
      const lw = layoutWidth(ctx);
      return isViewport(ctx) && min !== null && lw !== undefined && n(min) > n(lw);
    },
    cause: '최소 너비(min-width)가 화면 너비보다 큼',
    fix: 'min-width를 제거하거나 max-width: 100%로 제한한다',
    cssProblem: (ctx) => decls(ctx, ['min-width']).join(', '),
    basis: (ctx) => [...decls(ctx, ['min-width']), ...viewportFacts(ctx)],
    css: (ctx) => ({ selector: target(ctx), declarations: ['min-width: 0;', 'max-width: 100%;'] }),
  },
  {
    id: 'V3',
    match: (ctx) => isViewport(ctx) && style(ctx, 'flex-shrink') === '0' && widerThanLayout(ctx),
    cause: 'flex 항목이 줄어들지 않아(flex-shrink: 0) 화면보다 넓어짐',
    fix: '축소를 허용하거나(flex-shrink: 1, min-width: 0), 부모 flex 컨테이너에 flex-wrap: wrap을 준다',
    cssProblem: (ctx) => decls(ctx, ['flex-shrink', 'width']).join(', '),
    basis: (ctx) => [...decls(ctx, ['flex-shrink']), ...viewportFacts(ctx, true)],
    css: (ctx) => ({
      selector: target(ctx),
      declarations: ['flex-shrink: 1;', 'min-width: 0;', '/* 또는 부모 flex 컨테이너에 flex-wrap: wrap; */'],
    }),
  },
  {
    id: 'V4',
    match: (ctx) => {
      const sum = gridPxSum(style(ctx, 'grid-template-columns'));
      const lw = layoutWidth(ctx);
      return isViewport(ctx) && sum !== null && lw !== undefined && n(sum) > n(lw);
    },
    cause: '고정 열 너비(grid-template-columns)의 합이 화면 너비보다 큼',
    fix: 'minmax(0, 1fr)이나 auto-fit으로 열 너비가 화면에 맞춰 줄어들게 한다',
    cssProblem: (ctx) => decls(ctx, ['grid-template-columns']).join(', '),
    basis: (ctx) => [...decls(ctx, ['grid-template-columns']), `열 너비 합 ${n(gridPxSum(style(ctx, 'grid-template-columns')) ?? 0)}px`, ...viewportFacts(ctx)],
    css: (ctx) => ({
      selector: target(ctx),
      declarations: ['/* N은 현재 열 수. 좁은 화면에서 열 수를 줄이려면 repeat(auto-fit, minmax(최소 너비, 1fr))를 쓴다 */', 'grid-template-columns: repeat(N, minmax(0, 1fr));'],
    }),
  },
  {
    id: 'V5',
    match: (ctx) => isViewport(ctx) && positioned(ctx),
    cause: '위치 지정(absolute/fixed) 요소가 화면 밖에 놓임',
    fix: 'left/right 같은 위치 값을 조정해 화면 안에 둔다',
    cssProblem: (ctx) => decls(ctx, ['position']).join(', '),
    basis: (ctx) => [...decls(ctx, ['position']), ...viewportFacts(ctx)],
    css: (ctx) => ({
      selector: target(ctx),
      declarations: ['/* left, right 값을 조정해 요소가 화면 안에 들어오게 한다 */', 'max-width: 100%;'],
    }),
  },
  {
    id: 'V6',
    match: (ctx) => isViewport(ctx) && transformed(ctx),
    cause: 'transform 이동으로 요소가 화면 밖에 놓임',
    fix: 'transform의 이동 값을 줄이거나 제거한다',
    cssProblem: (ctx) => decls(ctx, ['transform']).join(', '),
    basis: (ctx) => [...decls(ctx, ['transform']), ...viewportFacts(ctx)],
    css: (ctx) => ({ selector: target(ctx), declarations: ['/* translate 이동 값을 화면 안으로 줄인다 */', 'transform: none;'] }),
  },
  {
    // T10에서 추가한 규칙 (DETECTION_RULES 13.1, 15장 37). P-04: margin-left: calc(100% - 100px)로 밀려난 이미지
    id: 'VM',
    match: (ctx) => isViewport(ctx) && pushingMargin(ctx) !== null,
    cause: '반대쪽 margin이 요소를 화면 밖으로 밀어냄',
    fix: 'margin을 줄이거나, 정렬이 목적이라면 margin 대신 flex 정렬이나 text-align으로 배치하고 max-width: 100%로 제한한다',
    cssProblem: (ctx) => decls(ctx, ['margin']).join(', '),
    basis: (ctx) => {
      const { delta } = ctx.occ;
      const amount = has(delta, 'overflowRight') ? delta.overflowRight : delta.overflowLeft;
      return [...decls(ctx, ['margin']), ...viewportFacts(ctx), `넘친 양 ${n(amount)}px`];
    },
    css: (ctx) => ({
      selector: target(ctx),
      declarations: [`margin-${pushingMargin(ctx)?.side ?? 'left'}: 0;`, 'max-width: 100%;', '/* 정렬이 목적이라면 부모에 display: flex; justify-content: …를 쓴다 */'],
    }),
  },
  {
    id: 'V7',
    match: (ctx) => isViewport(ctx) && widerThanLayout(ctx),
    cause: '요소 너비가 화면 너비보다 커서 고정 너비로 추정됨',
    fix: 'max-width: 100%를 주거나 반응형 단위(%, fr, min())로 너비를 정한다',
    cssProblem: (ctx) => decls(ctx, ['width', 'max-width']).join(', '),
    basis: (ctx) => [...decls(ctx, ['width', 'max-width']), ...viewportFacts(ctx, true)],
    css: (ctx) => ({ selector: target(ctx), declarations: ['width: auto;', 'max-width: 100%;'] }),
  },
  {
    id: 'C1',
    match: (ctx) => isClipped(ctx) && hasAxis(ctx, 'x') && style(ctx, 'white-space') === 'nowrap',
    cause: '한 줄 고정(white-space: nowrap) 상태에서 너비가 부족해 텍스트가 잘림',
    fix: '줄바꿈을 허용하거나, 잘림이 의도라면 text-overflow: ellipsis로 표시한다',
    cssProblem: (ctx) => decls(ctx, ['white-space', 'overflow', 'width']).join(', '),
    basis: (ctx) => [...decls(ctx, ['white-space', 'overflow']), ...clippedFacts(ctx, ['x'])],
    css: (ctx) => ({
      selector: target(ctx),
      declarations: ['white-space: normal;', '/* 한 줄 유지가 의도라면: text-overflow: ellipsis; */'],
    }),
  },
  {
    id: 'C2',
    match: (ctx) => isClipped(ctx) && hasAxis(ctx, 'y'),
    cause: '높이가 고정되어 내용이 세로로 잘림',
    fix: 'height 대신 min-height를 쓰거나 height: auto로 둔다',
    cssProblem: (ctx) => decls(ctx, ['height', 'overflow']).join(', '),
    basis: (ctx) => [...decls(ctx, ['height', 'overflow']), ...clippedFacts(ctx, ['y'])],
    css: (ctx) => ({ selector: target(ctx), declarations: ['height: auto;', '/* 최소 높이가 필요하면 height 대신 min-height를 쓴다 */'] }),
  },
  {
    id: 'C3',
    match: (ctx) => isClipped(ctx) && hasAxis(ctx, 'x'),
    cause: '너비가 내용보다 좁아 텍스트가 가로로 잘림',
    fix: '너비를 넓히거나 overflow-wrap으로 줄바꿈을 허용한다',
    cssProblem: (ctx) => decls(ctx, ['width', 'overflow']).join(', '),
    basis: (ctx) => [...decls(ctx, ['width', 'overflow']), ...clippedFacts(ctx, ['x'])],
    css: (ctx) => ({ selector: target(ctx), declarations: ['width: auto;', 'max-width: 100%;', 'overflow-wrap: anywhere;'] }),
  },
  {
    id: 'S1',
    match: (ctx) => isSpill(ctx) && has(ctx.occ.delta, 'overflowBottom'),
    cause: '상위 영역의 높이가 고정되어 텍스트가 아래로 넘침',
    fix: '상위 영역의 height를 auto로 두거나 min-height를 쓴다',
    cssProblem: (ctx) => {
      const box = container(ctx);
      return box ? `상위 영역 ${inlineCode(box.selector)}의 높이 ${n(box.boundingBox.height)}px (측정값)` : '상위 영역의 높이 (측정값 없음)';
    },
    basis: (ctx) => {
      const box = container(ctx);
      return [...(box ? [`상위 영역 ${inlineCode(box.selector)} 높이 ${n(box.boundingBox.height)}px`] : []), ...spillFacts(ctx, ['overflowBottom'])];
    },
    css: (ctx) => ({
      selector: container(ctx)?.selector ?? target(ctx),
      declarations: ['height: auto;', '/* 최소 높이가 필요하면 height 대신 min-height를 쓴다 */'],
    }),
  },
  {
    id: 'S2',
    match: (ctx) => isSpill(ctx) && (has(ctx.occ.delta, 'overflowLeft') || has(ctx.occ.delta, 'overflowRight')),
    cause: '긴 단어나 줄바꿈 금지로 텍스트가 가로로 넘침',
    fix: 'overflow-wrap: anywhere나 word-break로 긴 단어의 줄바꿈을 허용한다',
    cssProblem: (ctx) => decls(ctx, ['white-space', 'overflow-wrap', 'word-break']).join(', '),
    basis: (ctx) => [...decls(ctx, ['white-space', 'overflow-wrap', 'word-break']), ...spillFacts(ctx, ['overflowLeft', 'overflowRight'])],
    css: (ctx) => ({ selector: target(ctx), declarations: ['white-space: normal;', 'overflow-wrap: anywhere;'] }),
  },
  {
    id: 'O1',
    // 상대 요소의 computedStyle은 수집하지 않으므로 대상 요소만 본다(보고서 참고)
    match: (ctx) => isOverlap(ctx) && positioned(ctx),
    cause: '위치 지정(absolute/fixed) 요소가 일반 흐름 밖에 놓여 다른 요소와 겹침',
    fix: '위치 값을 조정하거나, 일반 흐름(flex, gap)으로 배치한다',
    cssProblem: (ctx) => decls(ctx, ['position']).join(', '),
    basis: (ctx) => [...decls(ctx, ['position']), ...overlapFacts(ctx)],
    css: (ctx) => ({
      selector: target(ctx),
      declarations: ['/* 일반 흐름으로 배치하고, 형제 요소 사이 간격은 부모의 display: flex; gap으로 둔다 */', 'position: static;'],
    }),
  },
  {
    id: 'O2',
    match: (ctx) => isOverlap(ctx) && hasNegativeMargin(style(ctx, 'margin')),
    cause: '음수 margin으로 요소가 다른 요소 쪽으로 당겨져 겹침',
    fix: 'margin을 0 이상으로 조정하고 간격은 gap으로 둔다',
    cssProblem: (ctx) => decls(ctx, ['margin']).join(', '),
    basis: (ctx) => [...decls(ctx, ['margin']), ...overlapFacts(ctx)],
    css: (ctx) => ({ selector: target(ctx), declarations: ['margin: 0;', '/* 간격은 부모의 gap으로 둔다 */'] }),
  },
  {
    id: 'O3',
    match: (ctx) => isOverlap(ctx) && transformed(ctx),
    cause: 'transform 이동으로 요소가 다른 요소와 겹침',
    fix: 'transform의 이동 값을 줄이거나 제거한다',
    cssProblem: (ctx) => decls(ctx, ['transform']).join(', '),
    basis: (ctx) => [...decls(ctx, ['transform']), ...overlapFacts(ctx)],
    css: (ctx) => ({ selector: target(ctx), declarations: ['/* translate 이동 값을 줄인다 */', 'transform: none;'] }),
  },
];

const FALLBACK = {
  id: 'X' as const,
  cause: '규칙 표에 맞는 원인을 특정하지 못함',
  fix: '아래 확인한 CSS 값과 소스 코드를 직접 확인해 대상 요소의 너비, 높이, 위치 지정 방식을 점검한다',
};

// ── 출력 ──

const ctxOf = (issue: Issue, occ: IssueOccurrence): RuleContext => ({ issue, occ });

/** 대표 occurrence(occurrences[0])로 규칙을 고른다. 맞는 규칙이 없으면 'X' */
export function selectRule(issue: Issue): RuleId {
  const first = issue.occurrences[0];
  if (!first) throw new Error(`${issue.id}: occurrence가 없다`);
  return ANALYSIS_RULES.find((rule) => rule.match(ctxOf(issue, first)))?.id ?? FALLBACK.id;
}

/**
 * occurrence별 문장을 만든다. 병합된 이슈의 viewport 값이 같으면 한 번만 쓰고, 다르면 viewport별로 나눠 적는다.
 * 예: `근거(Desktop, Mobile): …` / `근거(Desktop): …; 근거(Mobile): …`
 */
function perViewport(issue: Issue, label: string, render: (ctx: RuleContext) => string): string {
  const parts = issue.occurrences.map((occ) => ({ viewport: VIEWPORT_LABEL[occ.viewport], text: render(ctxOf(issue, occ)) }));
  if (parts.every((p) => p.text === parts[0].text)) return `${label}(${parts.map((p) => p.viewport).join(', ')}): ${parts[0].text}`;
  return parts.map((p) => `${label}(${p.viewport}): ${p.text}`).join('; ');
}

function suggestedFixText(fix: string, css: { selector: string; declarations: string[] } | null, selector: string): string {
  if (!css) {
    return `원인을 특정하지 못해 CSS 예시를 제시하지 않는다. ${inlineCode(selector)}에 적용된 스타일 규칙을 소스에서 찾아 위 CSS 값과 비교한다.\n\n${SELECTOR_NOTE}`;
  }
  const body = `${singleLine(css.selector)} {\n${css.declarations.map((d) => `  ${d}`).join('\n')}\n}`;
  return `${fix}.\n\n${codeBlock('css', body)}\n\n${SELECTOR_NOTE}`;
}

/** 규칙 기반 원인 분석 (PRD 5.7.1). source: 'rule', certainty: likely | uncertain */
export function analyzeIssueByRules(issue: Issue): IssueAnalysis {
  const id = selectRule(issue);
  const rule = ANALYSIS_RULES.find((r) => r.id === id);
  const first = ctxOf(issue, issue.occurrences[0]);

  if (!rule) {
    const checked = (ctx: RuleContext) => {
      const values = decls(ctx, checkedProps(issue));
      return values.length > 0 ? values.join(', ') : '확인할 수 있는 CSS 값 없음';
    };
    return {
      rootCause: `${FALLBACK.cause}. ${perViewport(issue, '근거', (ctx) => [...typeFacts(ctx), `확인한 CSS ${checked(ctx)}`].join(', '))}`,
      certainty: 'uncertain',
      cssProblem: perViewport(issue, '확인한 CSS', checked),
      fixDirection: FALLBACK.fix,
      suggestedFix: suggestedFixText(FALLBACK.fix, null, issue.selector),
      source: 'rule',
    };
  }

  return {
    rootCause: `${rule.cause}. ${perViewport(issue, '근거', (ctx) => rule.basis(ctx).join(', '))}`,
    certainty: 'likely',
    cssProblem: perViewport(issue, '판정 근거', (ctx) => rule.cssProblem(ctx) || '해당 CSS 값 없음'),
    fixDirection: rule.fix,
    suggestedFix: suggestedFixText(rule.fix, rule.css(first), issue.selector),
    source: 'rule',
  };
}
