// Fixture 15종을 로컬 브라우저로 검사하고 expected.ts와 비교한다 (PRD 13.2, DETECTION_RULES 12.2).
//
// 실행 (node --conditions=react-server: server-only를 빈 모듈로 불러온다, AGENTS.md 10장)
//   pnpm test:fixtures                 15개 전체
//   pnpm test:fixtures P-01 N-07       일부만
//   pnpm test:fixtures --repeat 2      전체를 두 번 실행하고 buildIssues·finalizeIssues·분석·태스크 결과가 같은지 확인한다
//   pnpm test:fixtures --page demo/landing.html --report-only
//                                      Fixture가 아닌 페이지(public/ 기준 경로) 1개를 같은 경로로 검사하고 결과만 출력한다.
//                                      기대값이 없으므로 판정(통과/실패)하지 않는다(T13 데모 페이지 미리 보기)
//
// T10: finalizeIssues 뒤에 분석 단계(규칙 기반 원인 분석 → 태스크 그룹화 → 프롬프트)를 실행하고
// 'final' 불변 조건과 Positive Fixture의 기대 규칙(EXPECTED_RULES)을 확인한다.
//
// 각 Fixture의 스크린샷과 확인용 HTML(cropRect, boundingBox, 분석 결과, 태스크와 프롬프트 전문), 분석 입출력 JSON을
// .tmp/fixtures-report/에 저장한다. 결과 화면 확인용 전체 Inspection 문서({ID}.inspection.json)도 함께 저장한다(T12).
//
// 하나라도 실패하면 종료 코드 1이다.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeIssues } from '@/server/analysis/analyze';
import { selectRule, type RuleId } from '@/server/analysis/rules';
import type { CapturedScreenshot } from '@/server/browser/screenshot';
import type { CollectedViewport } from '@/server/collect/types';
import { buildLookup } from '@/server/detect/geometry';
import { buildIssues, type BuildIssuesResult } from '@/server/detect/pipeline';
import type { DetectedIssue } from '@/server/detect/types';
import { buildViewportResult, finalizeIssues } from '@/server/evidence/finalize';
import { assertInspectionInvariants } from '@/server/store/invariants';
import { buildTasks } from '@/server/tasks/build';
import type { DevTask, Inspection, Issue, Viewport, ViewportResult } from '@/types/inspection';
import { FIXTURE_EXPECTATIONS, type ExpectedIssue, type FixtureExpectation } from './expected';
import { start } from './server';
import { inspectLocalViewport } from './viewport';

const REPORT_DIR = path.join(process.cwd(), '.tmp', 'fixtures-report');

/**
 * T10: Positive Fixture의 기대 이슈(expected.ts의 issues, 같은 순서)마다 허용하는 분석 규칙.
 * 규칙 기반 분석은 T10에서 추가한 단계라 expected.ts(탐지 기대값)를 바꾸지 않고 여기에 둔다.
 */
const EXPECTED_RULES: Record<string, readonly (readonly RuleId[])[]> = {
  'P-01': [['V2', 'V7']],
  'P-02': [['C1', 'C3']],
  'P-03': [['O1']],
  'P-04': [['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'VM', 'V7']],
  'P-05': [['S1']],
  'P-06': [['V1']],
};

/** 검사할 페이지. Fixture면 FixtureExpectation, --page면 기대값 없는 페이지 */
type RunTarget = Pick<FixtureExpectation, 'path' | 'description'> & {
  id: string;
  /**
   * 저장하는 Inspection 문서의 id. 없으면 `fixture-{id}`.
   * --page는 이 문서로 임시 샘플 리포트를 만들 수 있게(T13) inspectionSchema가 요구하는 UUID를 쓴다.
   */
  inspectionId?: string;
};

/** --page 문서의 고정 id (결정성 비교를 위해 고정값) */
const PAGE_INSPECTION_ID = '00000000-0000-4000-8000-00000000d001';

interface FixtureRun {
  fixture: RunTarget;
  collected: Record<Viewport, CollectedViewport>;
  screenshots: Record<Viewport, CapturedScreenshot>;
  result: BuildIssuesResult;
  /** finalizeIssues 결과 (result.issues와 같은 순서) */
  issues: Issue[];
  /** 분석 단계 뒤의 이슈 (issues와 같은 순서) */
  analyzed: Issue[];
  tasks: DevTask[];
  viewportResults: Record<Viewport, ViewportResult>;
  /** 분석 단계까지 끝낸 Inspection 문서 ('final' 불변 조건 통과). T12: 결과 화면 확인(ui-shots)에 쓴다 */
  finalDoc: Inspection;
  /** Desktop + Mobile의 열기·안정화·수집 시간 */
  browserMs: number;
  buildMs: number;
}

interface Verdict {
  pass: boolean;
  problems: string[];
  /** needsReview: true라 실패로 보지 않은 추가 이슈 */
  reviewOnly: DetectedIssue[];
  /** 기대 이슈와 짝지어지지 않은 needsReview: false 이슈 중 allowed에 해당하는 것 */
  allowedSeen: DetectedIssue[];
  matched: Map<ExpectedIssue, DetectedIssue>;
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: pnpm test:fixtures [Fixture ID ...] [--repeat N]');
  console.error('       pnpm test:fixtures --page <public/ 기준 경로> --report-only');
  process.exit(2);
}

type ParsedArgs = { mode: 'fixtures'; fixtures: FixtureExpectation[]; repeat: number } | { mode: 'page'; page: RunTarget };

/** --page 값을 public/ 기준 URL 경로로 바꾼다. Fixture는 판정 대상이므로 --page로 받지 않는다 */
function pageTarget(value: string | undefined): RunTarget {
  if (!value) usage('--page needs a path');
  const pathname = `/${value.replace(/^\/+/, '')}`;
  if (!pathname.endsWith('.html') || pathname.includes('..')) usage(`Invalid --page: ${value}`);
  if (pathname.startsWith('/fixtures/')) usage('Fixture는 --page가 아니라 Fixture ID로 검사한다');
  const id = pathname.slice(1, -'.html'.length).replace(/[^A-Za-z0-9_-]+/g, '-');
  return { id, path: pathname, description: `${pathname} (판정 없음, --report-only)`, inspectionId: PAGE_INSPECTION_ID };
}

function parseArgs(argv: string[]): ParsedArgs {
  let repeat = 1;
  let page: RunTarget | undefined;
  let reportOnly = false;
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repeat') {
      repeat = Number(argv[(i += 1)]);
      if (!Number.isInteger(repeat) || repeat < 1) usage(`Invalid --repeat: ${argv[i]}`);
    } else if (arg === '--page') page = pageTarget(argv[(i += 1)]);
    else if (arg === '--report-only') reportOnly = true;
    else if (!arg.startsWith('-')) ids.push(arg);
    else usage(`Unknown argument: ${arg}`);
  }
  if (page || reportOnly) {
    // 기대값이 없는 페이지는 판정하지 않는다. 두 옵션은 함께 쓴다
    if (!page || !reportOnly) usage('--page와 --report-only는 함께 쓴다');
    if (ids.length > 0 || repeat !== 1) usage('--page는 Fixture ID, --repeat와 함께 쓸 수 없다');
    return { mode: 'page', page };
  }
  if (ids.length === 0) return { mode: 'fixtures', fixtures: [...FIXTURE_EXPECTATIONS], repeat };
  const fixtures = ids.map((id) => {
    const found = FIXTURE_EXPECTATIONS.find((f) => f.id.toLowerCase() === id.toLowerCase());
    if (!found) usage(`Unknown Fixture ID: ${id}`);
    return found;
  });
  return { mode: 'fixtures', fixtures, repeat };
}

async function runFixture(baseUrl: string, fixture: RunTarget): Promise<FixtureRun> {
  const started = performance.now();
  // Desktop과 Mobile은 순서대로, viewport마다 브라우저를 새로 띄운다(AGENTS.md 7장, runInspection과 같은 경로)
  const desktop = await inspectLocalViewport(`${baseUrl}${fixture.path}`, 'desktop');
  const mobile = await inspectLocalViewport(`${baseUrl}${fixture.path}`, 'mobile');
  const browserMs = performance.now() - started;
  const buildStarted = performance.now();
  const result = buildIssues({ desktop: desktop.collected, mobile: mobile.collected });
  const issues = finalizeIssues(result.issues, {
    desktop: { collected: desktop.collected, screenshot: desktop.screenshot },
    mobile: { collected: mobile.collected, screenshot: mobile.screenshot },
  });
  const buildMs = performance.now() - buildStarted;
  const viewportResult = (v: Viewport, c: { collected: CollectedViewport; screenshot: CapturedScreenshot }) => {
    const detection = result.viewports[v];
    if (!detection) throw new Error(`${v} detection missing`);
    return buildViewportResult(c.collected, c.screenshot, detection, `${fixture.id}-${v}.png`);
  };
  const viewportResults = { desktop: viewportResult('desktop', desktop), mobile: viewportResult('mobile', mobile) };
  // DOMAIN_MODEL 3장: 브라우저 단계 결과의 불변 조건. 위반하면 예외 → 실패
  const browserDoc = toInspection(fixture, viewportResults, result, issues);
  assertInspectionInvariants(browserDoc, 'browser');
  // T10: 분석 단계 (src/server/analyze.ts의 completeAnalysis와 같은 순서)
  const analysis = await analyzeIssues(issues);
  const tasks = issues.length === 0 ? [] : buildTasks(analysis.issues, viewportResults);
  const finalDoc: Inspection = {
    ...browserDoc,
    status: 'completed',
    step: 'generating_tasks',
    completedAt: browserDoc.createdAt,
    analysis: issues.length === 0 ? { status: 'skipped', analyzedIssueCount: 0 } : { status: 'completed', analyzedIssueCount: analysis.analyzedIssueCount },
    issues: analysis.issues,
    tasks,
  };
  assertInspectionInvariants(finalDoc, 'final');
  return {
    fixture,
    collected: { desktop: desktop.collected, mobile: mobile.collected },
    screenshots: { desktop: desktop.screenshot, mobile: mobile.screenshot },
    result,
    issues,
    analyzed: analysis.issues,
    tasks,
    viewportResults,
    finalDoc,
    browserMs,
    buildMs,
  };
}

/** 불변 조건 검사용 Inspection. 시각과 ID는 고정값이다(결정성 비교를 위해) */
function toInspection(
  fixture: RunTarget,
  viewports: Record<Viewport, ViewportResult>,
  result: BuildIssuesResult,
  issues: Issue[],
): Inspection {
  const at = '2000-01-01T00:00:00.000Z';
  return {
    id: fixture.inspectionId ?? `fixture-${fixture.id}`,
    url: fixture.path,
    status: 'analyzing',
    createdAt: at,
    startedAt: at,
    updatedAt: at,
    viewports,
    viewportErrors: { desktop: null, mobile: null },
    analysis: { status: 'pending', analyzedIssueCount: 0 },
    issuesDetected: result.issuesDetected,
    issuesTruncated: result.issuesTruncated,
    issues,
    tasks: [],
  };
}

/** 요소 index를 data-testid로 (없으면 selector) */
function labeler(collected: Record<Viewport, CollectedViewport>) {
  return (viewport: Viewport, index: number | undefined): string => {
    if (index === undefined) return '';
    const el = buildLookup(collected[viewport]).get(index);
    return el ? (el.identity.testId ?? el.selector) : `#${index}`;
  };
}

function targetOf(run: FixtureRun, issue: DetectedIssue): string {
  const o = issue.occurrences[0];
  return labeler(run.collected)(o.viewport, o.elementIndex);
}

function relatedOf(run: FixtureRun, issue: DetectedIssue): string {
  const o = issue.occurrences[0];
  return labeler(run.collected)(o.viewport, o.relatedElements[0]?.index);
}

function describeIssue(run: FixtureRun, issue: DetectedIssue): string {
  const related = relatedOf(run, issue);
  return `${issue.id} ${issue.type}/${issue.subtype} ${issue.priority}(${issue.scores.score100}) ${issue.viewportTag} @${targetOf(run, issue)}${related ? ` ↔ ${related}` : ''} conf=${issue.confidence}`;
}

/** DETECTION_RULES 12.2 판정 */
function judge(run: FixtureRun, fixture: FixtureExpectation): Verdict {
  const { result } = run;
  const problems: string[] = [];
  const matched = new Map<ExpectedIssue, DetectedIssue>();
  const used = new Set<DetectedIssue>();

  for (const e of fixture.issues) {
    const hit = result.issues.find(
      (i) =>
        !used.has(i) &&
        !i.needsReview &&
        i.type === e.type &&
        i.subtype === e.subtype &&
        i.priority === e.priority &&
        i.viewportTag === e.viewportTag &&
        targetOf(run, i) === e.testId,
    );
    if (!hit) {
      problems.push(`기대 이슈 없음: ${e.type}/${e.subtype} ${e.priority} ${e.viewportTag} @${e.testId}`);
      continue;
    }
    used.add(hit);
    matched.set(e, hit);
    // expected.ts가 값을 정한 필드는 함께 확인한다
    if (e.relatedTestId !== undefined && relatedOf(run, hit) !== e.relatedTestId)
      problems.push(`${hit.id}: 상대 요소 ${relatedOf(run, hit)} ≠ 기대 ${e.relatedTestId}`);
    if (e.confidence !== undefined && hit.confidence !== e.confidence)
      problems.push(`${hit.id}: confidence ${hit.confidence} ≠ 기대 ${e.confidence}`);
    if (JSON.stringify(hit.scores) !== JSON.stringify(e.scores))
      problems.push(`${hit.id}: scores ${JSON.stringify(hit.scores)} ≠ 기대 ${JSON.stringify(e.scores)}`);
  }

  // T10: 기대 이슈의 분석 규칙
  const expectedRules = EXPECTED_RULES[fixture.id];
  fixture.issues.forEach((e, i) => {
    const hit = matched.get(e);
    const allowedRules = expectedRules?.[i];
    if (!hit || !allowedRules) return;
    const analyzed = run.analyzed.find((a) => a.id === hit.id);
    const rule = analyzed ? selectRule(analyzed) : undefined;
    if (!rule || !allowedRules.includes(rule)) problems.push(`${hit.id}: 분석 규칙 ${rule} ∉ 기대 ${allowedRules.join('/')}`);
  });

  const reviewOnly: DetectedIssue[] = [];
  const allowedSeen: DetectedIssue[] = [];
  for (const issue of result.issues) {
    if (used.has(issue)) continue;
    if (issue.needsReview) {
      reviewOnly.push(issue);
      continue;
    }
    const allowed = fixture.allowed?.some((a) => a.type === issue.type && a.testId === targetOf(run, issue));
    if (allowed) {
      allowedSeen.push(issue);
      // P-06: 같은 요소의 Text Overflow가 나오면 주 이슈와 relatedIssueIds로 연결되어 있어야 한다(PRD 5.3.5 규칙 4)
      const primary = [...matched.values()].find((m) => targetOf(run, m) === targetOf(run, issue));
      if (primary && !issue.relatedIssueIds.includes(primary.id))
        problems.push(`${issue.id}: 허용 이슈가 주 이슈 ${primary.id}와 연결되지 않음`);
      continue;
    }
    problems.push(`기대하지 않은 이슈: ${describeIssue(run, issue)}`);
  }

  if (fixture.kind === 'negative') {
    const counted = result.issues.filter((i) => !i.needsReview).length;
    if (counted !== 0 && problems.length === 0) problems.push(`needsReview: false 이슈 ${counted}개`);
  }

  return { pass: problems.length === 0, problems, reviewOnly, allowedSeen, matched };
}

/** verdict와 fixture가 없으면(--page --report-only) 판정 없이 결과만 출력한다 */
function printFixture(run: FixtureRun, verdict?: Verdict, fixture?: FixtureExpectation): void {
  const { result } = run;
  const label = verdict ? (verdict.pass ? 'PASS' : 'FAIL') : 'REPORT';
  console.log(`\n=== ${run.fixture.id} [${label}] ${run.fixture.description}`);
  if (fixture) {
    console.log(
      `기대: ${fixture.issues.length === 0 ? '이슈 0개' : fixture.issues.map((e) => `${e.type}/${e.subtype} ${e.priority} ${e.viewportTag} @${e.testId}`).join(', ')}`,
    );
  }
  if (result.issues.length > 0) {
    console.table(
      result.issues.map((i) => ({
        id: i.id,
        type: `${i.type}/${i.subtype}`,
        priority: i.priority,
        score100: i.scores.score100,
        viewportTag: i.viewportTag,
        target: targetOf(run, i),
        related: relatedOf(run, i),
        confidence: i.confidence,
        needsReview: i.needsReview,
        relatedIssueIds: i.relatedIssueIds.join(','),
        verdict: !verdict
          ? '-'
          : verdict.reviewOnly.includes(i)
            ? 'needs-review(로그)'
            : verdict.allowedSeen.includes(i)
              ? 'allowed'
              : [...verdict.matched.values()].includes(i)
                ? 'expected'
                : 'unexpected',
      })),
    );
    for (const issue of run.analyzed) {
      console.log(`  ${issue.id} ${issue.title}`);
      for (const o of issue.occurrences) {
        console.log(`    [${o.viewport}] ${o.evidenceText}`);
        console.log(`      boundingBox=${JSON.stringify(o.boundingBox)} cropRect=${JSON.stringify(o.cropRect)}`);
      }
      if (issue.analysis) {
        console.log(`    분석 ${selectRule(issue)} (${issue.analysis.certainty}, ${issue.analysis.source}): ${issue.analysis.rootCause}`);
      } else {
        console.log(`    분석 없음: ${issue.analysisSkippedReason}`);
      }
    }
    for (const task of run.tasks) {
      console.log(`  ${task.id} ${task.priority} ${task.viewportTag} [${task.issueIds.join(', ')}]${task.needsReview ? ' (Needs Review)' : ''} ${task.title}`);
    }
  } else {
    console.log('실제: 이슈 0개');
  }
  const vr = run.viewportResults;
  console.log(
    (['desktop', 'mobile'] as const)
      .map((v) => `${v}: screenshot ${vr[v].screenshotWidth}×${vr[v].screenshotHeight} layoutWidth=${vr[v].layoutWidth} documentHeight=${vr[v].documentHeight} truncated=${vr[v].screenshotTruncated}`)
      .join(' | '),
  );
  const extra = (['desktop', 'mobile'] as const)
    .map((v) => {
      const d = result.viewports[v];
      return d ? `${v}: overlays=[${d.overlaysDetected.join(', ')}] unexplainedPageScroll=${d.unexplainedPageScroll}` : `${v}: 실패`;
    })
    .join(' | ');
  console.log(`${extra} | issuesDetected=${result.issuesDetected} truncated=${result.issuesTruncated}`);
  console.log(`시간: 브라우저(Desktop + Mobile) ${run.browserMs.toFixed(0)}ms, buildIssues ${run.buildMs.toFixed(1)}ms`);
  for (const p of verdict?.problems ?? []) console.log(`  ✗ ${p}`);
}

interface JudgedRun {
  fixture: FixtureExpectation;
  run: FixtureRun;
  verdict: Verdict;
}

function markdownSummary(runs: JudgedRun[]): string {
  const positives = runs.filter((r) => r.fixture.kind === 'positive');
  const negatives = runs.filter((r) => r.fixture.kind === 'negative');
  const detected = positives.filter((r) => r.verdict.pass).length;
  const falsePositives = negatives.filter((r) => !r.verdict.pass).length;
  const lines = [
    '| Fixture | 구분 | 기대 결과 | 실제 결과 (needsReview: false) | Needs Review | 판정 |',
    '|---|---|---|---|---:|---|',
    ...runs.map(({ fixture, run, verdict }) => {
      const expected =
        fixture.issues.length === 0
          ? '이슈 0개'
          : fixture.issues.map((e) => `${e.type}/${e.subtype} ${e.priority} ${e.viewportTag}`).join('<br>');
      const actual = run.result.issues.filter((i) => !i.needsReview);
      const actualText = actual.length === 0 ? '이슈 0개' : actual.map((i) => `${i.type}/${i.subtype} ${i.priority} ${i.viewportTag}`).join('<br>');
      const review = run.result.issues.filter((i) => i.needsReview).length;
      return `| ${fixture.id} | ${fixture.kind === 'positive' ? 'Positive' : 'Negative'} | ${expected} | ${actualText} | ${review} | ${verdict.pass ? '통과' : '실패'} |`;
    }),
    '',
    '| 지표 | 결과 | 기준 (PRD 13.2) |',
    '|---|---|---|',
    `| Positive 탐지율 | ${detected}/${positives.length} | 6/6 |`,
    `| Negative 오탐 | ${falsePositives}/${negatives.length} | 0/9 |`,
  ];
  return lines.join('\n');
}

/** --page --report-only: 페이지 1개를 Fixture와 같은 경로로 검사하고 결과만 출력한다. 판정하지 않는다 */
async function reportPage(page: RunTarget): Promise<void> {
  const server = await start();
  try {
    const run = await runFixture(server.baseUrl, page);
    printFixture(run);
    await writeReport(run);
    console.log(`\n확인용 HTML: ${path.relative(process.cwd(), REPORT_DIR)}/${page.id}.html`);
    console.log(`Inspection 문서: ${path.relative(process.cwd(), REPORT_DIR)}/${page.id}.inspection.json`);
  } finally {
    await server.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === 'page') return reportPage(args.page);
  const { fixtures, repeat } = args;
  const server = await start();
  const rounds: JudgedRun[][] = [];
  const errors: string[] = [];

  try {
    for (let round = 1; round <= repeat; round += 1) {
      const runs: JudgedRun[] = [];
      for (const fixture of fixtures) {
        try {
          const run = await runFixture(server.baseUrl, fixture);
          const verdict = judge(run, fixture);
          runs.push({ fixture, run, verdict });
          if (round === 1) {
            printFixture(run, verdict, fixture);
            await writeReport(run, verdict);
          }
        } catch (error) {
          errors.push(`${fixture.id} (round ${round}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      rounds.push(runs);
    }
  } finally {
    await server.close();
  }

  const first = rounds[0] ?? [];
  const failed = first.filter((r) => !r.verdict.pass).map((r) => r.run.fixture.id);

  // 결정성: 라운드마다 buildIssues 결과 JSON이 같아야 한다(DETECTION_RULES 11장)
  const nondeterministic: string[] = [];
  for (const runs of rounds.slice(1)) {
    for (const { run } of runs) {
      const base = first.find((r) => r.run.fixture.id === run.fixture.id);
      if (
        base &&
        (JSON.stringify(base.run.result) !== JSON.stringify(run.result) ||
          JSON.stringify(base.run.issues) !== JSON.stringify(run.issues) ||
          JSON.stringify(base.run.analyzed) !== JSON.stringify(run.analyzed) ||
          JSON.stringify(base.run.tasks) !== JSON.stringify(run.tasks))
      )
        nondeterministic.push(run.fixture.id);
    }
  }

  console.log('\n=== 요약');
  console.table(
    first.map(({ fixture, run, verdict }) => ({
      fixture: fixture.id,
      kind: fixture.kind,
      result: verdict.pass ? 'PASS' : 'FAIL',
      issues: run.result.issues.filter((i) => !i.needsReview).length,
      needsReview: run.result.issues.filter((i) => i.needsReview).length,
      browserMs: Math.round(run.browserMs),
      buildMs: Number(run.buildMs.toFixed(1)),
    })),
  );
  console.log('\n=== 스크린샷');
  console.table(
    first.flatMap(({ run }) =>
      (['desktop', 'mobile'] as const).map((v) => ({
        fixture: run.fixture.id,
        viewport: v,
        screenshot: `${run.viewportResults[v].screenshotWidth}×${run.viewportResults[v].screenshotHeight}`,
        layoutWidth: run.viewportResults[v].layoutWidth,
        documentHeight: run.viewportResults[v].documentHeight,
        truncated: run.viewportResults[v].screenshotTruncated,
      })),
    ),
  );
  console.log(`확인용 HTML: ${path.relative(process.cwd(), REPORT_DIR)}/{ID}.html`);
  const totalBrowser = first.reduce((sum, r) => sum + r.run.browserMs, 0);
  if (first.length > 0) console.log(`Fixture 1개당 평균 검사 시간(Desktop + Mobile): ${(totalBrowser / first.length).toFixed(0)}ms`);
  console.log(`\n${markdownSummary(first)}\n`);
  if (repeat > 1) {
    console.log(
      nondeterministic.length === 0
        ? `결정성: ${repeat}회 실행 결과가 모두 같다.`
        : `결정성 실패: ${[...new Set(nondeterministic)].join(', ')}`,
    );
  }

  if (errors.length > 0) console.error(`\n오류 ${errors.length}건:\n${errors.map((e) => `- ${e}`).join('\n')}`);
  if (failed.length > 0) console.error(`\n실패: ${failed.join(', ')}`);
  if (errors.length > 0 || failed.length > 0 || nondeterministic.length > 0) process.exit(1);
  console.log(`\nOK: ${first.length}개 Fixture 통과`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 사람이 cropRect와 Evidence 문장을 눈으로 확인하기 위한 HTML. 제품 UI가 아니다.
 * 크롭 이미지를 새로 만들지 않고, 전체 스크린샷을 CSS로 cropRect만큼 잘라 보여준다(PRD 5.4.1).
 */
async function writeReport(run: FixtureRun, verdict?: Verdict): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const id = run.fixture.id;
  for (const v of ['desktop', 'mobile'] as const) {
    await writeFile(path.join(REPORT_DIR, `${id}-${v}.png`), run.screenshots[v].png);
  }
  const sections = run.analyzed.map((issue) => {
    const occurrences = issue.occurrences.map((o) => {
      const vr = run.viewportResults[o.viewport];
      const meta = `<p class="meta">${o.viewport} · boundingBox ${escapeHtml(JSON.stringify(o.boundingBox))} · cropRect ${escapeHtml(JSON.stringify(o.cropRect))}</p>`;
      if (!o.cropRect) return `${meta}<p class="evidence">${escapeHtml(o.evidenceText)}</p><p class="out">스크린샷 범위 밖</p>`;
      const c = o.cropRect;
      const b = o.boundingBox;
      const related = o.relatedElements
        .map((r) => `<div class="box related" style="left:${r.boundingBox.x - c.x}px;top:${r.boundingBox.y - c.y}px;width:${r.boundingBox.width}px;height:${r.boundingBox.height}px"></div>`)
        .join('');
      return `${meta}<p class="evidence">${escapeHtml(o.evidenceText)}</p>
<div class="crop" style="width:${c.width}px;height:${c.height}px">
  <img src="${escapeHtml(vr.screenshotUrl)}" style="left:${-c.x}px;top:${-c.y}px;width:${vr.screenshotWidth}px;height:${vr.screenshotHeight}px" alt="">
  ${related}
  <div class="box" style="left:${b.x - c.x}px;top:${b.y - c.y}px;width:${b.width}px;height:${b.height}px"></div>
</div>`;
    });
    const a = issue.analysis;
    const analysis = a
      ? `<h3>분석 ${escapeHtml(selectRule(issue))} (${escapeHtml(a.certainty)}, ${escapeHtml(a.source)})</h3>
<dl><dt>rootCause</dt><dd>${escapeHtml(a.rootCause)}</dd><dt>cssProblem</dt><dd>${escapeHtml(a.cssProblem)}</dd><dt>fixDirection</dt><dd>${escapeHtml(a.fixDirection)}</dd></dl>
<pre>${escapeHtml(a.suggestedFix)}</pre>`
      : `<h3>분석 없음 (${escapeHtml(String(issue.analysisSkippedReason))})</h3>`;
    return `<section><h2>${escapeHtml(issue.id)} · ${escapeHtml(issue.priority)} · ${escapeHtml(String(issue.viewportTag))}${issue.needsReview ? ' · Needs Review' : ''}</h2>
<p class="title">${escapeHtml(issue.title)}</p>
${occurrences.join('\n')}
${analysis}</section>`;
  });
  const taskSections = run.tasks.map(
    (task) => `<section><h2>${escapeHtml(task.id)} · ${escapeHtml(task.priority)} · ${escapeHtml(String(task.viewportTag))}${task.needsReview ? ' · Needs Review' : ''}</h2>
<p class="title">${escapeHtml(task.title)} <span class="meta">(${escapeHtml(task.titleSource)}, ${escapeHtml(task.issueIds.join(', '))})</span></p>
<h3>Acceptance Criteria</h3><ul>${task.acceptanceCriteria.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
<h3>Prompt</h3><pre>${escapeHtml(task.prompt)}</pre></section>`,
  );
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(id)} fixture report</title>
<style>
body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
section { margin-bottom: 40px; border-top: 1px solid #ddd; padding-top: 12px; }
.title { font-weight: 600; }
.meta { color: #666; font-size: 12px; font-family: ui-monospace, monospace; }
.crop { position: relative; overflow: hidden; outline: 1px solid #999; max-width: none; }
.crop img { position: absolute; max-width: none; }
.box { position: absolute; outline: 2px solid #e5484d; background: rgba(229, 72, 77, 0.12); }
.box.related { outline: 2px dashed #0090ff; background: transparent; }
.out { color: #b45309; }
pre { background: #f6f8fa; padding: 12px; white-space: pre-wrap; font-size: 12px; }
dt { font-weight: 600; margin-top: 4px; }
</style></head><body>
<h1>${escapeHtml(id)} [${verdict ? (verdict.pass ? 'PASS' : 'FAIL') : 'REPORT'}] ${escapeHtml(run.fixture.description)}</h1>
<p>${(['desktop', 'mobile'] as const).map((v) => `${v}: ${run.viewportResults[v].screenshotWidth}×${run.viewportResults[v].screenshotHeight} (layoutWidth ${run.viewportResults[v].layoutWidth}, truncated ${run.viewportResults[v].screenshotTruncated})`).join(' · ')}</p>
${sections.length > 0 ? sections.join('\n') : '<p>이슈 0개</p>'}
<h1>Tasks</h1>
${taskSections.length > 0 ? taskSections.join('\n') : '<p>태스크 0개</p>'}
</body></html>
`;
  await writeFile(path.join(REPORT_DIR, `${id}.html`), html);
  // 분석 단계의 입력과 출력 (사람이 확인하는 용도, 단위 테스트 데이터를 만들 때도 쓴다)
  await writeFile(
    path.join(REPORT_DIR, `${id}.json`),
    `${JSON.stringify({ viewports: run.viewportResults, issues: run.issues, analyzed: run.analyzed, tasks: run.tasks }, null, 2)}\n`,
  );
  // T12: 전체 Inspection 문서. scripts/ui-shots.ts가 결과 화면 응답으로 끼워 넣는다(screenshotUrl은 같은 폴더의 PNG 파일 이름)
  await writeFile(path.join(REPORT_DIR, `${id}.inspection.json`), `${JSON.stringify(run.finalDoc, null, 2)}\n`);
}
