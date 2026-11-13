// Fixture 15종을 로컬 브라우저로 검사하고 expected.ts와 비교한다 (PRD 13.2, DETECTION_RULES 12.2).
//
// 실행 (node --conditions=react-server: server-only를 빈 모듈로 불러온다, AGENTS.md 10장)
//   pnpm test:fixtures                 15개 전체
//   pnpm test:fixtures P-01 N-07       일부만
//   pnpm test:fixtures --repeat 2      전체를 두 번 실행하고 buildIssues·finalizeIssues 결과가 같은지 확인한다
//
// 각 Fixture의 스크린샷과 확인용 HTML(cropRect와 boundingBox)을 .tmp/fixtures-report/에 저장한다.
//
// 하나라도 실패하면 종료 코드 1이다.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { createViewportContext } from '@/server/browser/devices';
import { launchBrowser } from '@/server/browser/launch';
import { captureFullPage, type CapturedScreenshot } from '@/server/browser/screenshot';
import { openAndStabilize } from '@/server/browser/stabilize';
import { collectViewport } from '@/server/collect/collect';
import type { CollectedViewport } from '@/server/collect/types';
import { buildLookup } from '@/server/detect/geometry';
import { buildIssues, type BuildIssuesResult } from '@/server/detect/pipeline';
import type { DetectedIssue } from '@/server/detect/types';
import { buildViewportResult, finalizeIssues } from '@/server/evidence/finalize';
import { assertInspectionInvariants } from '@/server/store/invariants';
import type { Inspection, Issue, Viewport, ViewportResult } from '@/types/inspection';
import { FIXTURE_EXPECTATIONS, type ExpectedIssue, type FixtureExpectation } from './expected';
import { start } from './server';

const REPORT_DIR = path.join(process.cwd(), '.tmp', 'fixtures-report');

interface FixtureRun {
  fixture: FixtureExpectation;
  collected: Record<Viewport, CollectedViewport>;
  screenshots: Record<Viewport, CapturedScreenshot>;
  result: BuildIssuesResult;
  /** finalizeIssues 결과 (result.issues와 같은 순서) */
  issues: Issue[];
  viewportResults: Record<Viewport, ViewportResult>;
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
  process.exit(2);
}

function parseArgs(argv: string[]): { fixtures: FixtureExpectation[]; repeat: number } {
  let repeat = 1;
  const ids: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repeat') {
      repeat = Number(argv[(i += 1)]);
      if (!Number.isInteger(repeat) || repeat < 1) usage(`Invalid --repeat: ${argv[i]}`);
    } else if (!arg.startsWith('-')) ids.push(arg);
    else usage(`Unknown argument: ${arg}`);
  }
  if (ids.length === 0) return { fixtures: [...FIXTURE_EXPECTATIONS], repeat };
  const fixtures = ids.map((id) => {
    const found = FIXTURE_EXPECTATIONS.find((f) => f.id.toLowerCase() === id.toLowerCase());
    if (!found) usage(`Unknown Fixture ID: ${id}`);
    return found;
  });
  return { fixtures, repeat };
}

async function collectOne(
  browser: Browser,
  url: string,
  viewport: Viewport,
): Promise<{ collected: CollectedViewport; screenshot: CapturedScreenshot }> {
  const context = await createViewportContext(browser, viewport);
  try {
    const { page } = await openAndStabilize(context, url);
    const collected = await collectViewport(page, viewport);
    // 수집 직후 같은 page로 찍는다
    const screenshot = await captureFullPage(page, viewport, collected);
    return { collected, screenshot };
  } finally {
    await context.close();
  }
}

async function runFixture(browser: Browser, baseUrl: string, fixture: FixtureExpectation): Promise<FixtureRun> {
  const started = performance.now();
  // Desktop과 Mobile은 순서대로 실행한다(AGENTS.md 7장)
  const desktop = await collectOne(browser, `${baseUrl}${fixture.path}`, 'desktop');
  const mobile = await collectOne(browser, `${baseUrl}${fixture.path}`, 'mobile');
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
  assertInspectionInvariants(toInspection(fixture, viewportResults, result, issues), 'browser');
  return {
    fixture,
    collected: { desktop: desktop.collected, mobile: mobile.collected },
    screenshots: { desktop: desktop.screenshot, mobile: mobile.screenshot },
    result,
    issues,
    viewportResults,
    browserMs,
    buildMs,
  };
}

/** 불변 조건 검사용 Inspection. 시각과 ID는 고정값이다(결정성 비교를 위해) */
function toInspection(
  fixture: FixtureExpectation,
  viewports: Record<Viewport, ViewportResult>,
  result: BuildIssuesResult,
  issues: Issue[],
): Inspection {
  const at = '2000-01-01T00:00:00.000Z';
  return {
    id: `fixture-${fixture.id}`,
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
function judge(run: FixtureRun): Verdict {
  const { fixture, result } = run;
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

function printFixture(run: FixtureRun, verdict: Verdict): void {
  const { fixture, result } = run;
  console.log(`\n=== ${fixture.id} [${verdict.pass ? 'PASS' : 'FAIL'}] ${fixture.description}`);
  console.log(
    `기대: ${fixture.issues.length === 0 ? '이슈 0개' : fixture.issues.map((e) => `${e.type}/${e.subtype} ${e.priority} ${e.viewportTag} @${e.testId}`).join(', ')}`,
  );
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
        verdict: verdict.reviewOnly.includes(i) ? 'needs-review(로그)' : verdict.allowedSeen.includes(i) ? 'allowed' : [...verdict.matched.values()].includes(i) ? 'expected' : 'unexpected',
      })),
    );
    for (const issue of run.issues) {
      console.log(`  ${issue.id} ${issue.title}`);
      for (const o of issue.occurrences) {
        console.log(`    [${o.viewport}] ${o.evidenceText}`);
        console.log(`      boundingBox=${JSON.stringify(o.boundingBox)} cropRect=${JSON.stringify(o.cropRect)}`);
      }
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
  for (const p of verdict.problems) console.log(`  ✗ ${p}`);
}

function markdownSummary(runs: { run: FixtureRun; verdict: Verdict }[]): string {
  const positives = runs.filter((r) => r.run.fixture.kind === 'positive');
  const negatives = runs.filter((r) => r.run.fixture.kind === 'negative');
  const detected = positives.filter((r) => r.verdict.pass).length;
  const falsePositives = negatives.filter((r) => !r.verdict.pass).length;
  const lines = [
    '| Fixture | 구분 | 기대 결과 | 실제 결과 (needsReview: false) | Needs Review | 판정 |',
    '|---|---|---|---|---:|---|',
    ...runs.map(({ run, verdict }) => {
      const expected =
        run.fixture.issues.length === 0
          ? '이슈 0개'
          : run.fixture.issues.map((e) => `${e.type}/${e.subtype} ${e.priority} ${e.viewportTag}`).join('<br>');
      const actual = run.result.issues.filter((i) => !i.needsReview);
      const actualText = actual.length === 0 ? '이슈 0개' : actual.map((i) => `${i.type}/${i.subtype} ${i.priority} ${i.viewportTag}`).join('<br>');
      const review = run.result.issues.filter((i) => i.needsReview).length;
      return `| ${run.fixture.id} | ${run.fixture.kind === 'positive' ? 'Positive' : 'Negative'} | ${expected} | ${actualText} | ${review} | ${verdict.pass ? '통과' : '실패'} |`;
    }),
    '',
    '| 지표 | 결과 | 기준 (PRD 13.2) |',
    '|---|---|---|',
    `| Positive 탐지율 | ${detected}/${positives.length} | 6/6 |`,
    `| Negative 오탐 | ${falsePositives}/${negatives.length} | 0/9 |`,
  ];
  return lines.join('\n');
}

async function main(): Promise<void> {
  const { fixtures, repeat } = parseArgs(process.argv.slice(2));
  const server = await start();
  let browser: Browser | undefined;
  const rounds: { run: FixtureRun; verdict: Verdict }[][] = [];
  const errors: string[] = [];

  try {
    // TODO(T08): localhost allowlist — routeGuard가 붙으면 이 하네스가 허용 목록을 인자로 넘긴다
    browser = await launchBrowser();
    for (let round = 1; round <= repeat; round += 1) {
      const runs: { run: FixtureRun; verdict: Verdict }[] = [];
      for (const fixture of fixtures) {
        try {
          const run = await runFixture(browser, server.baseUrl, fixture);
          const verdict = judge(run);
          runs.push({ run, verdict });
          if (round === 1) {
            printFixture(run, verdict);
            await writeReport(run, verdict);
          }
        } catch (error) {
          errors.push(`${fixture.id} (round ${round}): ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      rounds.push(runs);
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  const first = rounds[0] ?? [];
  const failed = first.filter((r) => !r.verdict.pass).map((r) => r.run.fixture.id);

  // 결정성: 라운드마다 buildIssues 결과 JSON이 같아야 한다(DETECTION_RULES 11장)
  const nondeterministic: string[] = [];
  for (const runs of rounds.slice(1)) {
    for (const { run } of runs) {
      const base = first.find((r) => r.run.fixture.id === run.fixture.id);
      if (base && (JSON.stringify(base.run.result) !== JSON.stringify(run.result) || JSON.stringify(base.run.issues) !== JSON.stringify(run.issues)))
        nondeterministic.push(run.fixture.id);
    }
  }

  console.log('\n=== 요약');
  console.table(
    first.map(({ run, verdict }) => ({
      fixture: run.fixture.id,
      kind: run.fixture.kind,
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
async function writeReport(run: FixtureRun, verdict: Verdict): Promise<void> {
  await mkdir(REPORT_DIR, { recursive: true });
  const id = run.fixture.id;
  for (const v of ['desktop', 'mobile'] as const) {
    await writeFile(path.join(REPORT_DIR, `${id}-${v}.png`), run.screenshots[v].png);
  }
  const sections = run.issues.map((issue) => {
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
    return `<section><h2>${escapeHtml(issue.id)} · ${escapeHtml(issue.priority)} · ${escapeHtml(String(issue.viewportTag))}${issue.needsReview ? ' · Needs Review' : ''}</h2>
<p class="title">${escapeHtml(issue.title)}</p>
${occurrences.join('\n')}</section>`;
  });
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
</style></head><body>
<h1>${escapeHtml(id)} [${verdict.pass ? 'PASS' : 'FAIL'}] ${escapeHtml(run.fixture.description)}</h1>
<p>${(['desktop', 'mobile'] as const).map((v) => `${v}: ${run.viewportResults[v].screenshotWidth}×${run.viewportResults[v].screenshotHeight} (layoutWidth ${run.viewportResults[v].layoutWidth}, truncated ${run.viewportResults[v].screenshotTruncated})`).join(' · ')}</p>
${sections.length > 0 ? sections.join('\n') : '<p>이슈 0개</p>'}
</body></html>
`;
  await writeFile(path.join(REPORT_DIR, `${id}.html`), html);
}
