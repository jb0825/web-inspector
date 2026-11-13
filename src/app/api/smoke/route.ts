// TEMP(T02): T13에서 삭제
// Vercel 서버리스에서 Chromium 실행, 번들 폰트 렌더링, Mobile 에뮬레이션, 메모리·스크린샷 크기를 확인하는 임시 route.
// 외부 URL에 접속하지 않고 page.setContent()로 고정 HTML만 렌더링한다.
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';
import { createViewportContext, VIEWPORTS } from '@/server/browser/devices';
import { getLaunchTarget, launchBrowser } from '@/server/browser/launch';
import { SCREENSHOT_MAX_HEIGHT } from '@/server/detect/constants';
import { getInternalEnv } from '@/server/env';
import { createHostChecker } from '@/server/security/ssrf';
import type { Viewport } from '@/types/inspection';

export const runtime = 'nodejs';
export const maxDuration = 300;

// PRD 8.1.3: viewport당 측정과 스크린샷 20s 안에서 나눠 쓴다.
const SET_CONTENT_TIMEOUT_MS = 10_000;
const MEASURE_TIMEOUT_MS = 5_000;
const SCREENSHOT_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 10_000;
const TALL_PAGE_HEIGHT_PX = 8_000;

const querySchema = z.object({
  viewport: z.enum(['desktop', 'mobile']).default('desktop'),
  format: z.enum(['png', 'json']).default('png'),
  meta: z.enum(['0', '1']).default('1'),
  tall: z.enum(['0', '1']).default('0'),
});

const measuredSchema = z.object({
  layoutLabel: z.string(),
  innerWidth: z.number(),
  layoutWidth: z.number(),
  devicePixelRatio: z.number(),
  hasMetaViewport: z.boolean(),
  pointerCoarse: z.boolean(),
  fontsCheck: z.boolean(),
  userAgent: z.string(),
});

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** 비밀값은 헤더로만 받는다(AGENTS.md 8장). 길이가 다르면 바로 거부하고, 같으면 상수 시간으로 비교한다. */
function isAuthorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(secret);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function buildHtml({ meta, tall }: { meta: boolean; tall: boolean }): string {
  // 웹폰트(@font-face)를 쓰지 않는다. 시스템에 등록된 폰트로 렌더링되는지 확인하는 것이 목적이다.
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
${meta ? '<meta name="viewport" content="width=device-width, initial-scale=1">' : ''}
<title>smoke</title>
<style>
  body { margin: 0; padding: 24px; font-family: 'Noto Sans KR', sans-serif; color: #1d1d1f; background: #fff; }
  .layout { font-size: 44px; font-weight: 700; margin: 0 0 16px; }
  .layout::before { content: 'DESKTOP LAYOUT'; }
  @media (max-width: 767px) { .layout::before { content: 'MOBILE LAYOUT'; } }
  h1 { font-size: 28px; font-weight: 700; margin: 0 0 12px; }
  p { font-size: 16px; font-weight: 400; line-height: 1.6; margin: 0 0 16px; }
  pre { font-size: 13px; white-space: pre-wrap; word-break: break-all; background: #f5f5f7; padding: 12px; }
  .tall { height: ${TALL_PAGE_HEIGHT_PX}px; background: linear-gradient(#e8f2ff, #fdecec); }
</style>
</head>
<body>
<div class="layout" id="layout"></div>
<h1 id="heading">한글 렌더링 확인: 굵은 제목입니다</h1>
<p id="paragraph">다람쥐 헌 쳇바퀴에 타고파. 서버리스 Chromium에서 번들 폰트로 한글이 네모(□) 없이 표시되어야 합니다.</p>
<pre id="values"></pre>
${tall ? '<div class="tall"></div>' : ''}
<script>
  document.fonts.ready.then(function () {
    var values = {
      layoutLabel: matchMedia('(max-width: 767px)').matches ? 'MOBILE LAYOUT' : 'DESKTOP LAYOUT',
      innerWidth: window.innerWidth,
      layoutWidth: document.documentElement.clientWidth,
      devicePixelRatio: window.devicePixelRatio,
      hasMetaViewport: document.querySelector('meta[name="viewport"]') !== null,
      pointerCoarse: matchMedia('(pointer: coarse)').matches,
      // T02 지시서 항목이라 남긴다. 등록되지 않은 시스템 폰트에도 true가 나오므로 판정에는 platformFonts를 쓴다(AGENTS.md 7.1).
      fontsCheck: document.fonts.check('16px "Noto Sans KR"'),
      userAgent: navigator.userAgent
    };
    document.getElementById('values').textContent = Object.keys(values)
      .map(function (key) { return key + ': ' + values[key]; })
      .join('\\n');
    document.body.setAttribute('data-smoke', JSON.stringify(values));
  });
</script>
</body>
</html>`;
}

function toMb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

/**
 * Node 프로세스와 그 자식(Chromium) 전체의 RSS. process.memoryUsage().rss는 Node 프로세스만 센다.
 * /proc이 있는 Linux(Vercel)에서만 값이 나오고, macOS에서는 null이다.
 */
async function readProcessTreeRssMb(rootPid: number): Promise<number | null> {
  try {
    const entries = (await readdir('/proc')).filter((entry) => /^\d+$/.test(entry));
    const parentOf = new Map<number, number>();
    const rssKbOf = new Map<number, number>();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const status = await readFile(`/proc/${entry}/status`, 'utf8');
          const pid = Number(entry);
          parentOf.set(pid, Number(/PPid:\s+(\d+)/.exec(status)?.[1] ?? 0));
          rssKbOf.set(pid, Number(/VmRSS:\s+(\d+)\s+kB/.exec(status)?.[1] ?? 0));
        } catch {
          // 읽는 사이에 끝난 프로세스는 건너뛴다.
        }
      }),
    );
    let totalKb = 0;
    for (const pid of rssKbOf.keys()) {
      let current: number | undefined = pid;
      for (let depth = 0; current && depth < 64; depth += 1) {
        if (current === rootPid) {
          totalKb += rssKbOf.get(pid) ?? 0;
          break;
        }
        current = parentOf.get(current);
      }
    }
    return Math.round((totalKb / 1024) * 10) / 10;
  } catch {
    return null;
  }
}

async function snapshotMemory() {
  const usage = process.memoryUsage();
  return {
    rssMb: toMb(usage.rss),
    heapUsedMb: toMb(usage.heapUsed),
    processTreeRssMb: await readProcessTreeRssMb(process.pid),
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 실제로 쓰인 시스템 폰트 이름. document.fonts.check()보다 직접적인 근거다(CDP). */
async function readPlatformFonts(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
    const result: Record<string, { familyName: string; postScriptName: string; glyphCount: number }[]> = {};
    for (const id of ['heading', 'paragraph']) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#${id}` });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      result[id] = fonts.map(({ familyName, postScriptName, glyphCount }) => ({ familyName, postScriptName, glyphCount }));
    }
    return result;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

function readPngSize(png: Buffer): { width: number; height: number } {
  // PNG IHDR: 16~23바이트에 width, height (big-endian)
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function takeScreenshot(page: Page, viewport: Viewport, tall: boolean) {
  if (!tall) {
    const png = await page.screenshot({ type: 'png', scale: 'css', timeout: SCREENSHOT_TIMEOUT_MS });
    return { png, documentHeight: null, capHeight: null, truncated: false };
  }
  const box = await page.locator('html').boundingBox({ timeout: MEASURE_TIMEOUT_MS });
  const documentWidth = Math.ceil(box?.width ?? VIEWPORTS[viewport].width);
  const documentHeight = Math.ceil(box?.height ?? 0);
  const capHeight = SCREENSHOT_MAX_HEIGHT[viewport];
  const png = await page.screenshot({
    type: 'png',
    scale: 'css',
    fullPage: true,
    // PRD 5.2.4: 상한에서 잘라서 찍는다.
    clip: { x: 0, y: 0, width: documentWidth, height: Math.min(documentHeight, capHeight) },
    timeout: SCREENSHOT_TIMEOUT_MS,
  });
  return { png, documentHeight, capHeight, truncated: documentHeight > capHeight };
}

export async function GET(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = getInternalEnv().INTERNAL_API_SECRET;
  } catch {
    return jsonError(500, 'INTERNAL_ERROR', 'INTERNAL_API_SECRET is not configured.');
  }
  if (!isAuthorized(request.headers.get('x-internal-secret'), secret)) {
    return jsonError(401, 'UNAUTHORIZED', 'Unauthorized.');
  }

  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) {
    return jsonError(400, 'INVALID_QUERY', 'viewport=desktop|mobile, format=png|json, meta=0|1, tall=0|1');
  }
  const { viewport, format } = query.data;
  const meta = query.data.meta === '1';
  const tall = query.data.tall === '1';

  const startedAt = performance.now();
  const memoryBeforeLaunch = await snapshotMemory();
  const target = getLaunchTarget();
  let browser: Browser | undefined;

  try {
    const launchStartedAt = performance.now();
    browser = await launchBrowser();
    const launchMs = Math.round(performance.now() - launchStartedAt);

    // setContent만 쓰지만 연결 누락이 없도록 guard를 붙인다. 허용 목록은 넘기지 않는다(PRD 8.6)
    const context = await createViewportContext(browser, viewport, { checker: createHostChecker() });
    const page = await context.newPage();
    await page.setContent(buildHtml({ meta, tall }), { waitUntil: 'load', timeout: SET_CONTENT_TIMEOUT_MS });
    const raw = await page
      .locator('body[data-smoke]')
      .getAttribute('data-smoke', { timeout: MEASURE_TIMEOUT_MS });
    const measured = measuredSchema.parse(JSON.parse(raw ?? 'null'));
    const platformFonts = await withTimeout(readPlatformFonts(context, page), MEASURE_TIMEOUT_MS, 'platform fonts');
    const shot = await takeScreenshot(page, viewport, tall);
    const memoryAfterScreenshot = await snapshotMemory();
    const chromiumVersion = browser.version();
    const totalMs = Math.round(performance.now() - startedAt);

    // 로그에는 viewport와 시간 정보만 남긴다.
    console.info(JSON.stringify({ route: 'smoke', target, viewport, format, meta, tall, launchMs, totalMs }));

    if (format === 'png') {
      return new Response(new Uint8Array(shot.png), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'X-Launch-Ms': String(launchMs),
          'X-Total-Ms': String(totalMs),
          'X-Rss-Mb': String(memoryAfterScreenshot.rssMb),
        },
      });
    }

    return Response.json(
      {
        environment: target,
        chromiumVersion,
        viewport: { name: viewport, configured: VIEWPORTS[viewport], meta, tall },
        measured,
        platformFonts,
        timings: { launchMs, totalMs },
        memory: { beforeLaunch: memoryBeforeLaunch, afterScreenshot: memoryAfterScreenshot },
        ...(tall
          ? {
              screenshot: {
                bytes: shot.png.byteLength,
                ...readPngSize(shot.png),
                documentHeight: shot.documentHeight,
                capHeight: shot.capHeight,
                truncated: shot.truncated,
              },
            }
          : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error(JSON.stringify({ route: 'smoke', target, viewport, error: error instanceof Error ? error.name : 'unknown' }));
    return jsonError(500, 'BROWSER_CRASH', 'Smoke check failed. See function logs.');
  } finally {
    if (browser) {
      await withTimeout(browser.close(), CLOSE_TIMEOUT_MS, 'browser close').catch(() => undefined);
    }
  }
}
