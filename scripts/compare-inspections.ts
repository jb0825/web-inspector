// Before/After 검사 결과를 비교해 Markdown으로 출력하고 docs/assets/showcase-compare.md에도 저장한다 (T14).
//
// 실행 (node --conditions=react-server: server-only를 빈 모듈로 불러온다, AGENTS.md 10장)
//   pnpm compare-inspections public/showcase/before/inspection.json public/showcase/after/inspection.json [--out <path>]
//
// 두 문서는 inspectionSchema로 확인한 뒤 비교한다. 매칭 규칙은 scripts/compare/core.ts(단위 테스트 있음).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectionSchema } from '@/server/store/schemas';
import type { Inspection } from '@/types/inspection';
import { renderComparisonMarkdown } from './compare/core';

const DEFAULT_OUT = path.join('docs', 'assets', 'showcase-compare.md');

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: pnpm compare-inspections <before.json> <after.json> [--out <path>]');
  process.exit(2);
}

function parseArgs(argv: string[]): { before: string; after: string; out: string } {
  const files: string[] = [];
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--out') out = argv[(i += 1)] ?? usage('--out에 경로가 필요하다');
    else if (arg.startsWith('--')) usage(`Unknown argument: ${arg}`);
    else files.push(arg);
  }
  if (files.length !== 2) usage('Before와 After 문서 경로 2개가 필요하다');
  return { before: files[0]!, after: files[1]!, out };
}

async function load(file: string): Promise<Inspection> {
  return inspectionSchema.parse(JSON.parse(await readFile(file, 'utf8')));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const markdown = renderComparisonMarkdown(await load(args.before), await load(args.after));
  console.log(markdown);
  await mkdir(path.dirname(args.out), { recursive: true });
  await writeFile(args.out, markdown);
  console.error(`저장: ${args.out}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
