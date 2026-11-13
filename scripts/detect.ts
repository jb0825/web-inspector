// `pnpm collect` 결과(.tmp/collect/{ID}-{viewport}.json)에 탐지 함수 3종을 실행해 표로 보여준다(T05).
// Dedup 규칙 2~4, 병합, Priority는 하지 않는다. 정식 비교는 test:fixtures(T06)가 한다.
//
// 실행 (node --conditions=react-server, AGENTS.md 10장)
//   pnpm detect <Fixture ID> [--viewport desktop|mobile]
//   pnpm detect --all       15개 Fixture를 expected.ts와 대략 비교한다(type/subtype과 대상 요소, viewport별)

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CollectedViewport } from '@/server/collect/types';
import { NEEDS_REVIEW_BELOW } from '@/server/detect/constants';
import { detectOverlap } from '@/server/detect/overlap';
import { detectTextOverflow } from '@/server/detect/textOverflow';
import type { RawIssue } from '@/server/detect/types';
import { detectViewportOverflow } from '@/server/detect/viewportOverflow';
import type { Viewport, ViewportTag } from '@/types/inspection';
import { FIXTURE_EXPECTATIONS, type FixtureExpectation } from '../tests/fixtures/expected';

const IN_DIR = path.join(process.cwd(), '.tmp', 'collect');
const VIEWPORTS: Viewport[] = ['desktop', 'mobile'];

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: pnpm detect <Fixture ID> [--viewport desktop|mobile]\n       pnpm detect --all');
  process.exit(2);
}

function parseArgs(argv: string[]) {
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
  if (!fixture) usage(`Unknown Fixture ID: ${id}`);
  return { all, fixtures: [fixture], viewports };
}

async function load(id: string, viewport: Viewport): Promise<CollectedViewport> {
  const file = path.join(IN_DIR, `${id}-${viewport}.json`);
  try {
    // 이 스크립트가 직접 만든 파일만 읽는 로컬 도구라 스키마 검증은 생략한다.
    return JSON.parse(await readFile(file, 'utf8')) as CollectedViewport;
  } catch {
    usage(`Missing ${path.relative(process.cwd(), file)}. Run \`pnpm collect ${id}\` (or --all) first.`);
  }
}

function detectAll(c: CollectedViewport) {
  const text = detectTextOverflow(c);
  const overlap = detectOverlap(c);
  const overflow = detectViewportOverflow(c);
  return {
    issues: [...text.issues, ...overlap.issues, ...overflow.issues] as RawIssue[],
    overlaysDetected: overlap.overlaysDetected,
    unexplainedPageScroll: overflow.unexplainedPageScroll,
  };
}

function labelOf(c: CollectedViewport, index: number | undefined): string {
  if (index === undefined) return '';
  const el = c.elements.find((e) => e.index === index);
  if (!el) return `#${index}`;
  return el.identity.testId ?? el.selector;
}

function relatedOf(issue: RawIssue): number | undefined {
  return issue.relatedElements[0]?.index;
}

function measuredSummary(issue: RawIssue): string {
  const parts = [
    ...Object.entries(issue.delta).map(([k, v]) => `${k}=${v}`),
    ...(issue.type === 'element-overlap' ? Object.entries(issue.measured).map(([k, v]) => `${k}=${v}`) : []),
  ];
  if (issue.type === 'viewport-overflow') parts.push(`affected=${issue.affectedDescendants}`);
  if (issue.type === 'text-overflow' && issue.subtype === 'clipped') parts.push(`axes=${issue.axes.join('')}`);
  return parts.join(' ');
}

function viewportsOf(tag: ViewportTag): Viewport[] {
  if (tag === 'both') return ['desktop', 'mobile'];
  return tag === 'desktop-only' ? ['desktop'] : ['mobile'];
}

/** expected.ts와 대략 비교한다: viewport별로 type/subtype과 대상 testId */
function compare(fixture: FixtureExpectation, viewport: Viewport, c: CollectedViewport, issues: RawIssue[]): string[] {
  const problems: string[] = [];
  const keyOf = (issue: RawIssue) => `${issue.type}/${issue.subtype}@${labelOf(c, issue.elementIndex)}`;
  const expected = fixture.issues.filter((e) => viewportsOf(e.viewportTag).includes(viewport));
  const matched = new Set<RawIssue>();
  for (const e of expected) {
    const hit = issues.find((i) => i.type === e.type && i.subtype === e.subtype && labelOf(c, i.elementIndex) === e.testId);
    if (!hit) problems.push(`missing ${e.type}/${e.subtype}@${e.testId}`);
    else matched.add(hit);
  }
  for (const issue of issues) {
    if (matched.has(issue) || issue.confidence < NEEDS_REVIEW_BELOW) continue;
    const allowed = fixture.allowed?.some((a) => a.type === issue.type && a.testId === labelOf(c, issue.elementIndex));
    if (!allowed) problems.push(`unexpected ${keyOf(issue)} (confidence ${issue.confidence})`);
  }
  return problems;
}

async function main(): Promise<void> {
  const { all, fixtures, viewports } = parseArgs(process.argv.slice(2));
  const rows: Record<string, string | number>[] = [];
  const summary: Record<string, string | number>[] = [];
  const problems: string[] = [];

  for (const fixture of fixtures) {
    for (const viewport of viewports) {
      const c = await load(fixture.id, viewport);
      const result = detectAll(c);
      for (const issue of result.issues) {
        rows.push({
          fixture: fixture.id,
          viewport,
          type: `${issue.type}/${issue.subtype}`,
          target: labelOf(c, issue.elementIndex),
          related: labelOf(c, relatedOf(issue)),
          confidence: issue.confidence,
          measured: measuredSummary(issue),
        });
      }
      const found = all ? compare(fixture, viewport, c, result.issues) : [];
      problems.push(...found.map((p) => `${fixture.id}/${viewport}: ${p}`));
      summary.push({
        fixture: fixture.id,
        viewport,
        issues: result.issues.length,
        needsReview: result.issues.filter((i) => i.confidence < NEEDS_REVIEW_BELOW).length,
        overlays: result.overlaysDetected.join(', '),
        unexplainedPageScroll: String(result.unexplainedPageScroll),
        ...(all ? { check: found.length === 0 ? 'OK' : 'MISMATCH' } : {}),
      });
    }
  }

  console.table(rows);
  console.table(summary);
  if (all) {
    if (problems.length > 0) {
      console.error(`\n${problems.length} mismatch(es):\n${problems.map((p) => `- ${p}`).join('\n')}`);
      process.exit(1);
    }
    console.log('\nOK: all fixtures match expected type/subtype and target per viewport.');
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
