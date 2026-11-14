// 샘플·사례 리포트 가져오기(scripts/import-sample.ts)의 순수 함수. 네트워크와 파일을 쓰지 않아 단위 테스트할 수 있다(T13, T14).
// 샘플 문서의 기준은 DOMAIN_MODEL 6.3이다. 사례(showcase) 문서도 같은 검증을 거친다.

import { readPngSize } from '@/server/browser/screenshot';
import { findInspectionViolations } from '@/server/store/invariants';
import { inspectionSchema } from '@/server/store/schemas';
import type { Inspection, Viewport } from '@/types/inspection';

export const SAMPLE_VIEWPORTS: readonly Viewport[] = ['desktop', 'mobile'];

/**
 * 가져온 문서를 둘 곳. public/{target}/ 아래에 inspection.json과 스크린샷 2장을 둔다.
 * - sample: 샘플 리포트 (/report/sample, DOMAIN_MODEL 6.3)
 * - showcase/before, showcase/after: Before/After 사례 (/report/showcase/[name], T14). 공유 리포트는 7일 뒤 만료되므로(PRD 8.1.4) 정적 파일로 보관한다
 */
export const IMPORT_TARGETS = ['sample', 'showcase/before', 'showcase/after'] as const;
export type ImportTarget = (typeof IMPORT_TARGETS)[number];

export function isImportTarget(value: string): value is ImportTarget {
  return (IMPORT_TARGETS as readonly string[]).includes(value);
}

/** 대상 폴더의 screenshotUrl (public/ 기준 절대 경로) */
export function screenshotUrlsFor(target: ImportTarget): Record<Viewport, string> {
  return { desktop: `/${target}/desktop-full.png`, mobile: `/${target}/mobile-full.png` };
}

/** 샘플 문서의 screenshotUrl (public/sample/ 아래 파일). DOMAIN_MODEL 6.3 */
export const SAMPLE_SCREENSHOT_URL: Record<Viewport, string> = screenshotUrlsFor('sample');

/** 스크린샷을 내려받아도 되는 호스트: Vercel Blob 공개 스토어 (DOMAIN_MODEL 6.2) */
const BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

/** --base는 http(s) origin만 받는다. 경로·쿼리가 있으면 오타일 가능성이 높아 거부한다 */
export function parseBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`--base must be http(s): ${value}`);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || url.username || url.password)
    throw new Error(`--base must be an origin without path, query or credentials: ${value}`);
  return url;
}

/**
 * 내려받을 수 있는 주소인지: --base와 같은 origin이거나 Vercel Blob 공개 스토어(https).
 * 그 밖의 주소가 문서에 있으면 가져오기를 중단한다(T13 규칙).
 */
export function isAllowedDownloadUrl(value: string, base: URL): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.origin === base.origin) return true;
  return url.protocol === 'https:' && url.hostname.endsWith(BLOB_HOST_SUFFIX) && url.port === '';
}

/**
 * 검사 대상이 --base 호스트의 /demo/ 페이지인지. 외부 실제 사이트의 결과를 샘플로 쓰지 않기 위해 확인한다(DOMAIN_MODEL 6.3).
 * 리다이렉트로 다른 곳에 갔을 수 있으므로 finalUrl도 같은 조건을 만족해야 한다.
 */
export function isDemoTarget(inspection: Pick<Inspection, 'url' | 'finalUrl'>, base: URL): boolean {
  const ok = (value: string) => {
    try {
      const url = new URL(value);
      return url.hostname === base.hostname && url.pathname.startsWith('/demo/');
    } catch {
      return false;
    }
  };
  return ok(inspection.url) && (inspection.finalUrl === undefined || ok(inspection.finalUrl));
}

/** 두 viewport의 원본 screenshotUrl. 결과가 없는 viewport가 있으면 샘플로 쓸 수 없다 */
export function screenshotSources(inspection: Inspection): Record<Viewport, string> {
  const out = {} as Record<Viewport, string>;
  for (const v of SAMPLE_VIEWPORTS) {
    const result = inspection.viewports[v];
    if (!result) throw new Error(`${v} viewport result is missing`);
    out[v] = result.screenshotUrl;
  }
  return out;
}

/** screenshotUrl만 대상 폴더 경로(/sample/ 등)로 바꾼 사본. 그 밖의 값은 바꾸지 않는다(샘플 JSON을 손으로 고치지 않는다) */
export function toSampleDocument(inspection: Inspection, target: ImportTarget = 'sample'): Inspection {
  const urls = screenshotUrlsFor(target);
  const viewports = { ...inspection.viewports };
  for (const v of SAMPLE_VIEWPORTS) {
    const result = viewports[v];
    if (result) viewports[v] = { ...result, screenshotUrl: urls[v] };
  }
  return { ...inspection, viewports };
}

/**
 * 저장 전에 샘플 문서와 PNG를 검사하고 문제 목록을 돌려준다. 비어 있어야 저장한다.
 * - inspectionSchema.parse, assertInspectionInvariants(…, 'final')와 같은 조건 (DOMAIN_MODEL 3장, 6.3)
 * - status completed, screenshotUrl이 대상 폴더(/sample/ 등)의 파일
 * - PNG 실제 크기 = screenshotWidth × screenshotHeight
 */
export function validateSample(document: unknown, pngs?: Partial<Record<Viewport, Uint8Array>>, target: ImportTarget = 'sample'): string[] {
  const urls = screenshotUrlsFor(target);
  const parsed = inspectionSchema.safeParse(document);
  if (!parsed.success) return parsed.error.issues.map((issue) => `schema ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  const inspection = parsed.data;
  const problems = findInspectionViolations(inspection, 'final').map((v) => `invariant ${v.id}: ${v.message}`);
  if (inspection.status !== 'completed') problems.push(`status is ${inspection.status}, expected completed`);
  for (const v of SAMPLE_VIEWPORTS) {
    const result = inspection.viewports[v];
    if (!result) {
      problems.push(`${v}: viewport result is missing`);
      continue;
    }
    if (result.screenshotUrl !== urls[v]) problems.push(`${v}: screenshotUrl ${result.screenshotUrl} is not ${urls[v]}`);
    const png = pngs?.[v];
    if (!pngs) continue;
    if (!png) {
      problems.push(`${v}: PNG is missing`);
      continue;
    }
    try {
      const size = readPngSize(png);
      if (size.width !== result.screenshotWidth || size.height !== result.screenshotHeight)
        problems.push(`${v}: PNG ${size.width}×${size.height} ≠ document ${result.screenshotWidth}×${result.screenshotHeight}`);
    } catch (error) {
      problems.push(`${v}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}
