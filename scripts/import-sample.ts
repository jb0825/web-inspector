// 검사 결과를 정적 파일로 가져온다 (T13, T14, DOMAIN_MODEL 6.3, PRD 8.1.4, 8.7).
//   --out public/sample(기본값)                → 샘플 리포트 (/report/sample). 데모 페이지만
//   --out public/showcase/before|after          → Before/After 사례 (/report/before, /report/after, /showcase)
//   (--target sample|showcase/before|showcase/after는 예전 이름이며 --out과 같다)
//   --base는 production 주소뿐 아니라 pnpm dev:local로 띄운 http://127.0.0.1:3000도 받는다.
//     로컬 파일 저장소의 스크린샷(/api/local-files/…, 상대 경로)은 --base 기준으로 내려받는다.
//     사례 대상은 사람이 소유한 사이트라 /demo/가 아니다. 그래도 --force 없이는 중단한다(대상을 한 번 더 확인하게 하기 위해서다)
//
// 실행 (node --conditions=react-server: server-only를 빈 모듈로 불러온다, AGENTS.md 10장)
//   pnpm import-sample --base https://<production 도메인> --id <inspection id> [--out public/showcase/before] [--force]
//   pnpm import-sample --base http://127.0.0.1:3000 --id <inspection id> --out public/showcase/after --force
//   pnpm import-sample --local .tmp/fixtures-report/demo-landing.inspection.json
//     1차 작업의 임시 샘플 전용. `pnpm test:fixtures --page demo/landing.html --report-only`가 만든 문서와
//     같은 폴더의 PNG(screenshotUrl이 파일 이름)를 가져온다. 네트워크를 쓰지 않는다.
//
// 순서: 문서 받기 → completed 확인 → 검사 대상 확인(/demo/) → 스크린샷 내려받기(허용 호스트만) →
//       screenshotUrl을 /{target}/…로 바꾸기 → 스키마·불변 조건·PNG 크기 확인 → 모두 통과하면 세 파일 저장.
// 검증에 실패하면 아무 파일도 쓰지 않는다. 가져온 JSON은 손으로 고치지 않고, 다시 검사해서 가져온다.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectionSchema } from '@/server/store/schemas';
import type { Inspection, Viewport } from '@/types/inspection';
import {
  IMPORT_TARGETS,
  isAllowedDownloadUrl,
  outToTarget,
  resolveScreenshotSource,
  isDemoTarget,
  isImportTarget,
  parseBaseUrl,
  SAMPLE_VIEWPORTS,
  screenshotSources,
  screenshotUrlsFor,
  toSampleDocument,
  validateSample,
  type ImportTarget,
} from './sample/core';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const FETCH_TIMEOUT_MS = 30_000;
/** 스크린샷 1장 상한. Mobile 최대 높이(DETECTION_RULES)의 PNG도 이보다 작다 */
const MAX_PNG_BYTES = 20 * 1024 * 1024;

type Args = ({ mode: 'remote'; base: URL; id: string; force: boolean } | { mode: 'local'; file: string }) & { target: ImportTarget };

function usage(message?: string): never {
  if (message) console.error(message);
  console.error(`Usage: pnpm import-sample --base <URL> --id <inspection id> [--out ${IMPORT_TARGETS.map((t) => `public/${t}`).join('|')}] [--force]`);
  console.error('       pnpm import-sample --local <path/to/*.inspection.json> [--target <target>]   (로컬 확인용)');
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  let base: string | undefined;
  let id: string | undefined;
  let local: string | undefined;
  let force = false;
  let target: ImportTarget = 'sample';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--target') {
      const value = argv[(i += 1)] ?? '';
      if (!isImportTarget(value)) usage(`Invalid --target: ${value} (${IMPORT_TARGETS.join(', ')})`);
      target = value;
    } else if (arg === '--out') {
      const value = argv[(i += 1)] ?? '';
      const resolved = outToTarget(value);
      if (!resolved) usage(`Invalid --out: ${value} (${IMPORT_TARGETS.map((t) => `public/${t}`).join(', ')})`);
      target = resolved;
    } else if (arg === '--base') base = argv[(i += 1)];
    else if (arg === '--id') id = argv[(i += 1)];
    else if (arg === '--local') local = argv[(i += 1)];
    else if (arg === '--force') force = true;
    else usage(`Unknown argument: ${arg}`);
  }
  if (local !== undefined) {
    if (base !== undefined || id !== undefined || force) usage('--local은 다른 옵션과 함께 쓸 수 없다');
    return { mode: 'local', file: local, target };
  }
  if (!base || !id) usage('--base와 --id가 필요하다');
  let baseUrl: URL;
  try {
    baseUrl = parseBaseUrl(base);
  } catch (error) {
    usage(error instanceof Error ? error.message : String(error));
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) usage(`Invalid --id: ${id}`);
  return { mode: 'remote', base: baseUrl, id, force, target };
}

/** 리다이렉트를 따라가지 않는다. 허용 호스트 검사를 우회하지 못하게 하기 위해서다 */
async function fetchChecked(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, { redirect: 'error', headers: { accept }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`GET ${url} → ${response.status}`);
  return response;
}

async function downloadPng(url: string): Promise<Uint8Array> {
  const response = await fetchChecked(url, 'image/png');
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PNG_BYTES) throw new Error(`${url}: PNG is larger than ${MAX_PNG_BYTES} bytes`);
  return buffer;
}

async function loadRemote(base: URL, id: string, force: boolean): Promise<{ inspection: Inspection; pngs: Record<Viewport, Uint8Array> }> {
  const apiUrl = new URL(`/api/inspections/${encodeURIComponent(id)}`, base).href;
  console.log(`문서 받기: ${apiUrl}`);
  const body: unknown = await (await fetchChecked(apiUrl, 'application/json')).json();
  const inspection = inspectionSchema.parse(body);
  if (inspection.status !== 'completed') throw new Error(`status가 ${inspection.status}이다. completed인 검사만 샘플로 쓴다`);

  if (!isDemoTarget(inspection, base)) {
    const message = `검사 대상(${inspection.finalUrl ?? inspection.url})이 ${base.host}의 /demo/ 페이지가 아니다. 외부 실제 사이트의 결과는 샘플로 쓰지 않는다(DOMAIN_MODEL 6.3). 사례(showcase)라면 직접 소유한 사이트인지 확인한다`;
    if (!force) throw new Error(`${message}. 그래도 가져오려면 --force`);
    console.warn(`경고: ${message}. --force로 계속한다`);
  }

  const raw = screenshotSources(inspection);
  const sources = {} as Record<Viewport, string>;
  for (const v of SAMPLE_VIEWPORTS) sources[v] = resolveScreenshotSource(raw[v], base);
  for (const v of SAMPLE_VIEWPORTS) {
    if (!isAllowedDownloadUrl(sources[v], base)) throw new Error(`${v} screenshotUrl의 호스트가 허용 목록(--base, Vercel Blob)에 없다`);
  }
  const pngs = {} as Record<Viewport, Uint8Array>;
  for (const v of SAMPLE_VIEWPORTS) {
    console.log(`스크린샷 받기: ${v}`);
    pngs[v] = await downloadPng(sources[v]);
  }
  return { inspection, pngs };
}

/** 1차 작업의 임시 샘플: 로컬 하네스가 만든 문서와 같은 폴더의 PNG */
async function loadLocal(file: string): Promise<{ inspection: Inspection; pngs: Record<Viewport, Uint8Array> }> {
  const inspection = inspectionSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  const sources = screenshotSources(inspection);
  const pngs = {} as Record<Viewport, Uint8Array>;
  for (const v of SAMPLE_VIEWPORTS) {
    // 하네스 문서의 screenshotUrl은 같은 폴더의 파일 이름이다. 경로가 들어 있으면 거부한다
    if (path.basename(sources[v]) !== sources[v]) throw new Error(`${v} screenshotUrl is not a local file name: ${sources[v]}`);
    pngs[v] = new Uint8Array(await readFile(path.join(path.dirname(file), sources[v])));
  }
  return { inspection, pngs };
}

/** 임시 파일에 쓴 뒤 이름을 바꿔, 중간에 실패해도 반쯤 쓴 파일이 남지 않게 한다 */
async function writeAtomic(target: string, data: string | Uint8Array): Promise<void> {
  const temp = `${target}.tmp`;
  await writeFile(temp, data);
  await rename(temp, target);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { inspection, pngs } = args.mode === 'remote' ? await loadRemote(args.base, args.id, args.force) : await loadLocal(args.file);

  const sample = toSampleDocument(inspection, args.target);
  const problems = validateSample(sample, pngs, args.target);
  if (problems.length > 0) {
    console.error(`검증 실패 (${problems.length}건). 아무 파일도 저장하지 않았다:`);
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }

  const urls = screenshotUrlsFor(args.target);
  await mkdir(path.join(PUBLIC_DIR, args.target), { recursive: true });
  for (const v of SAMPLE_VIEWPORTS) await writeAtomic(path.join(PUBLIC_DIR, urls[v]), pngs[v]);
  await writeAtomic(path.join(PUBLIC_DIR, args.target, 'inspection.json'), `${JSON.stringify(sample, null, 2)}\n`);

  const regular = sample.issues.filter((i) => !i.needsReview);
  console.log(`\n저장: public/${args.target}/inspection.json, desktop-full.png, mobile-full.png${args.mode === 'local' ? ' (로컬 문서)' : ''}`);
  console.log(`검사 대상: ${sample.url}`);
  console.log(`이슈 ${sample.issues.length}개 (일반 ${regular.length}, Needs Review ${sample.issues.length - regular.length}), 태스크 ${sample.tasks.length}개`);
  console.table(sample.issues.map((i) => ({ id: i.id, type: `${i.type}/${i.subtype}`, priority: i.priority, viewportTag: i.viewportTag, needsReview: i.needsReview })));
  console.table(sample.tasks.map((t) => ({ id: t.id, priority: t.priority, viewportTag: t.viewportTag, issues: t.issueIds.join(', '), needsReview: t.needsReview })));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
