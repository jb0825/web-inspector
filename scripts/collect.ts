// Fixture를 열어 안정화와 수집(T04)까지만 실행하고, CollectedViewport를 JSON으로 저장한다.
// Fixture만 대상으로 한다. 외부 URL은 받지 않는다(routeGuard는 T08).
//
// 실행 (node --conditions=react-server: server-only를 빈 모듈로 불러온다, AGENTS.md 10장)
//   pnpm collect <Fixture ID> [--viewport desktop|mobile]
//   pnpm collect --all          15개 × 2 viewport를 두 번씩 수집해 JSON이 같은지 비교한다

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import { createViewportContext } from '@/server/browser/devices';
import { launchBrowser } from '@/server/browser/launch';
import { openAndStabilize, type StabilizeMeta } from '@/server/browser/stabilize';
import { collectViewport } from '@/server/collect/collect';
import type { CollectedViewport } from '@/server/collect/types';
import type { Viewport } from '@/types/inspection';
import { FIXTURE_EXPECTATIONS, type FixtureExpectation } from '../tests/fixtures/expected';
import { start } from '../tests/fixtures/server';

const OUT_DIR = path.join(process.cwd(), '.tmp', 'collect');
const VIEWPORTS: Viewport[] = ['desktop', 'mobile'];

interface RunResult {
  collected: CollectedViewport;
  meta: StabilizeMeta;
  collectMs: number;
  scope: { iframes: number; openShadowRoots: number };
}

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: pnpm collect <Fixture ID> [--viewport desktop|mobile]\n       pnpm collect --all');
  process.exit(2);
}

function parseArgs(argv: string[]): { all: boolean; fixtures: FixtureExpectation[]; viewports: Viewport[] } {
  let all = false;
  let id: string | undefined;
  let viewports = VIEWPORTS;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') all = true;
    else if (arg === '--viewport') {
      const value = argv[(i += 1)];
      if (value !== 'desktop' && value !== 'mobile') usage(`Invalid --viewport: ${value}`);
      viewports = [value];
    } else if (!arg.startsWith('-') && id === undefined) id = arg;
    else usage(`Unknown argument: ${arg}`);
  }
  if (all) return { all, fixtures: [...FIXTURE_EXPECTATIONS], viewports };
  if (!id) usage();
  const fixture = FIXTURE_EXPECTATIONS.find((f) => f.id.toLowerCase() === id.toLowerCase());
  if (!fixture) usage(`Unknown Fixture ID: ${id} (expected one of ${FIXTURE_EXPECTATIONS.map((f) => f.id).join(', ')})`);
  return { all, fixtures: [fixture], viewports };
}

/** 검사 범위 밖(iframe 내부, Shadow DOM)이 얼마나 있는지 센다. 결과 필드가 아니라 보고용이다. */
async function countOutOfScope(page: Page): Promise<RunResult['scope']> {
  return page.evaluate(() => {
    const all = document.getElementsByTagName('*');
    let openShadowRoots = 0;
    for (let i = 0; i < all.length; i += 1) if (all[i].shadowRoot) openShadowRoots += 1;
    return { iframes: document.getElementsByTagName('iframe').length, openShadowRoots };
  });
}

async function runOnce(browser: Browser, baseUrl: string, fixture: FixtureExpectation, viewport: Viewport): Promise<RunResult> {
  const context = await createViewportContext(browser, viewport);
  try {
    const { page, meta } = await openAndStabilize(context, `${baseUrl}${fixture.path}`);
    const started = Date.now();
    const collected = await collectViewport(page, viewport);
    const collectMs = Date.now() - started;
    const scope = await countOutOfScope(page);
    return { collected, meta, collectMs, scope };
  } finally {
    await context.close();
  }
}

function stepMs(meta: StabilizeMeta, step: string): string {
  const timing = meta.steps.find((s) => s.step === step);
  if (!timing) return '-';
  return timing.outcome === 'completed' ? String(timing.durationMs) : `${timing.durationMs}(${timing.outcome})`;
}

function totalStabilizeMs(meta: StabilizeMeta): number {
  return meta.steps.reduce((sum, s) => sum + s.durationMs, 0);
}

function printDetail(fixture: FixtureExpectation, viewport: Viewport, result: RunResult, file: string): void {
  const c = result.collected;
  console.log(`\n=== ${fixture.id} / ${viewport} → ${path.relative(process.cwd(), file)}`);
  console.log(
    [
      `candidates=${c.totalCandidates} collected=${c.elements.length} truncated=${c.elementsTruncated}`,
      `viewportSize=${c.viewportSize.width}x${c.viewportSize.height} inner=${c.innerWidth}x${c.innerHeight} layoutWidth=${c.layoutWidth} documentScrollWidth=${c.documentScrollWidth} documentHeight=${c.documentHeight}`,
      `rootOverflowX=html:${c.rootOverflowX.html} body:${c.rootOverflowX.body} hasMetaViewport=${c.hasMetaViewport} hasCanvas=${c.hasCanvas}`,
      `http=${result.meta.httpStatus} skipped=[${result.meta.skippedSteps.join(',')}] autoScroll=${JSON.stringify(result.meta.autoScroll)}`,
      `iframes=${result.scope.iframes} openShadowRoots=${result.scope.openShadowRoots}`,
    ].join('\n'),
  );
  console.table(
    c.elements
      .filter((el) => el.identity.testId !== undefined)
      .map((el) => ({
        testId: el.identity.testId,
        index: el.index,
        tag: el.tag,
        selector: el.selector,
        x: el.rect.x,
        y: el.rect.y,
        w: el.rect.width,
        h: el.rect.height,
        textRects: el.textRects.length,
      })),
  );
  console.table(
    Object.fromEntries([
      ...result.meta.steps.map((s) => [s.step, { ms: s.durationMs, outcome: s.outcome }]),
      ['collect', { ms: result.collectMs, outcome: 'completed' }],
    ]),
  );
}

async function main(): Promise<void> {
  const { all, fixtures, viewports } = parseArgs(process.argv.slice(2));
  await mkdir(OUT_DIR, { recursive: true });
  const server = await start();
  let browser: Browser | undefined;
  const failures: string[] = [];
  const rows: Record<string, string | number | boolean>[] = [];

  try {
    browser = await launchBrowser();
    // Desktop과 Mobile은 순서대로 실행한다(AGENTS.md 7장).
    for (const viewport of viewports) {
      for (const fixture of fixtures) {
        const label = `${fixture.id}/${viewport}`;
        try {
          const first = await runOnce(browser, server.baseUrl, fixture, viewport);
          const json = `${JSON.stringify(first.collected, null, 2)}\n`;
          const file = path.join(OUT_DIR, `${fixture.id}-${viewport}.json`);
          await writeFile(file, json);

          if (!all) {
            printDetail(fixture, viewport, first, file);
            continue;
          }

          const second = await runOnce(browser, server.baseUrl, fixture, viewport);
          const same = JSON.stringify(second.collected, null, 2) + '\n' === json;
          if (!same) {
            failures.push(`${label}: JSON differs between two runs`);
            await writeFile(path.join(OUT_DIR, `${fixture.id}-${viewport}.run2.json`), `${JSON.stringify(second.collected, null, 2)}\n`);
          }
          rows.push({
            fixture: fixture.id,
            viewport,
            candidates: first.collected.totalCandidates,
            truncated: first.collected.elementsTruncated,
            layoutW: first.collected.layoutWidth,
            scrollW: first.collected.documentScrollWidth,
            goto: stepMs(first.meta, 'goto'),
            idle: stepMs(first.meta, 'networkidle'),
            fonts: stepMs(first.meta, 'fonts'),
            scroll: stepMs(first.meta, 'autoScroll'),
            motion: stepMs(first.meta, 'disableMotion'),
            settle: stepMs(first.meta, 'settle'),
            stabilizeTotal: totalStabilizeMs(first.meta),
            collect: first.collectMs,
            run2Total: totalStabilizeMs(second.meta) + second.collectMs,
            iframes: first.scope.iframes,
            shadow: first.scope.openShadowRoots,
            sameJson: same,
          });
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? ` [${String(error.code)}]` : '';
          failures.push(`${label}${code}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  if (all) console.table(rows);
  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n${failures.map((f) => `- ${f}`).join('\n')}`);
    process.exit(1);
  }
  if (all) console.log(`\nOK: ${rows.length} collections, each collected twice with identical JSON.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
