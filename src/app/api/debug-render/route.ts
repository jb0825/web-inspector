// TEMP(T14 진단): production에서 WebGL canvas와 웹 폰트가 스크린샷에 나오지 않는 원인을 찾기 위한 임시 route.
// 진단이 끝나면 이 파일을 삭제한다. 검사 기능에서 쓰지 않는다.
//
// POST /api/debug-render
//   헤더: x-internal-secret: <INTERNAL_API_SECRET>  (쿼리로 받지 않는다, AGENTS.md 8장)
//   본문: { "url": "https://…", "viewport": "mobile" | "desktop", "fontMode": "fetch" | "continue", "waitMs": 0~15000 }
//   - fontMode "fetch": 운영과 같다. 모든 요청을 routeGuard가 route.fetch로 대신 받는다
//   - fontMode "continue": 폰트 요청만 호스트 검사(SSRF) 후 route.continue로 브라우저가 직접 받는다. 리다이렉트 hop 검사는 하지 않는다(비교용)
//
// 운영 검사와 같은 경로를 쓴다: launchBrowser(Vercel이면 @sparticuz/chromium) → createViewportContext(routeGuard 연결) → openAndStabilize.
// 브라우저는 하나, context도 하나다(AGENTS.md 7장). 응답에는 스크린샷을 넣지 않고 진단 값만 넣는다.

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';
import { createViewportContext } from '@/server/browser/devices';
import { launchBrowser, type LaunchedBrowser } from '@/server/browser/launch';
import { openAndStabilize } from '@/server/browser/stabilize';
import { CONTEXT_TIMEOUT_MS, withHardTimeout } from '@/server/browser/timeouts';
import { getInternalEnv } from '@/server/env';
import { isAuthorized } from '@/server/http/inspections';
import { describeFailure } from '@/server/log';
import { createHostChecker } from '@/server/security/ssrf';
import { validateInspectionUrl } from '@/server/security/url';

export const runtime = 'nodejs';
export const maxDuration = 120;

const bodySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  viewport: z.enum(['desktop', 'mobile']).default('mobile'),
  fontMode: z.enum(['fetch', 'continue']).default('fetch'),
  waitMs: z.number().int().min(0).max(15_000).default(5_000),
});

const MAX_ENTRIES = 60;
const TEXT_MAX = 300;
const STEP_TIMEOUT_MS = 20_000;

const clip = (value: string) => value.slice(0, TEXT_MAX);
const hostOf = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.host : url.protocol;
  } catch {
    return 'invalid';
  }
};
const push = <T,>(list: T[], item: T) => {
  if (list.length < MAX_ENTRIES) list.push(item);
};

interface Collected {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: { resourceType: string; host: string; failure: string }[];
  fontResponses: {
    host: string;
    path: string;
    status: number;
    contentType: string | null;
    contentEncoding: string | null;
    accessControlAllowOrigin: string | null;
    contentLength: string | null;
    fromServiceWorker: boolean;
  }[];
  fontRequestsContinued: number;
  fontRequestsBlocked: number;
}

function watch(context: BrowserContext, collected: Collected): void {
  context.on('console', (message) => {
    if (message.type() === 'error') push(collected.consoleErrors, clip(message.text()));
  });
  context.on('weberror', (error) => push(collected.pageErrors, clip(String(error.error()))));
  context.on('requestfailed', (request) =>
    push(collected.failedRequests, { resourceType: request.resourceType(), host: hostOf(request.url()), failure: clip(request.failure()?.errorText ?? 'unknown') }),
  );
  context.on('response', (response) => {
    if (response.request().resourceType() !== 'font') return;
    const headers = response.headers();
    let path = '';
    try {
      path = clip(new URL(response.url()).pathname);
    } catch {
      path = 'invalid';
    }
    push(collected.fontResponses, {
      host: hostOf(response.url()),
      path,
      status: response.status(),
      contentType: headers['content-type'] ?? null,
      contentEncoding: headers['content-encoding'] ?? null,
      accessControlAllowOrigin: headers['access-control-allow-origin'] ?? null,
      contentLength: headers['content-length'] ?? null,
      fromServiceWorker: response.fromServiceWorker(),
    });
  });
}

/** 브라우저 안에서 실행한다. 바깥 변수를 참조하지 않는다(AGENTS.md 7장) */
function probeInPage() {
  const webgl = (type: 'webgl' | 'webgl2') => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext(type) as WebGLRenderingContext | null;
      if (!gl) return { created: false, renderer: null, vendor: null, version: null };
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        created: true,
        renderer: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null,
        vendor: info ? String(gl.getParameter(info.UNMASKED_VENDOR_WEBGL)) : null,
        version: String(gl.getParameter(gl.VERSION)),
      };
    } catch (error) {
      return { created: false, renderer: null, vendor: null, version: null, error: String(error).slice(0, 300) };
    }
  };
  const fonts: { family: string; status: string; weight: string; style: string }[] = [];
  document.fonts.forEach((face) => {
    if (fonts.length < 60) fonts.push({ family: face.family, status: face.status, weight: face.weight, style: face.style });
  });
  // 페이지가 만든 canvas. 이미 만든 context만 확인하려고 2d → webgl2 → webgl 순서로 묻는다
  // (getContext는 다른 종류의 context가 이미 있으면 null을 돌려준다. context가 없는 canvas에는 새로 만들어질 수 있다)
  const canvases = Array.from(document.getElementsByTagName('canvas'))
    .slice(0, 10)
    .map((canvas) => {
      const rect = canvas.getBoundingClientRect();
      let contextType: string | null = null;
      let contextLost: boolean | null = null;
      for (const type of ['webgl2', 'webgl'] as const) {
        const gl = canvas.getContext(type) as WebGLRenderingContext | null;
        if (gl) {
          contextType = type;
          contextLost = gl.isContextLost();
          break;
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        contextType,
        contextLost,
      };
    });
  return {
    webgl1: webgl('webgl'),
    webgl2: webgl('webgl2'),
    fontsStatus: document.fonts.status,
    fonts,
    canvases,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
  };
}

/** canvas 영역만 찍은 PNG 크기. 한 가지 색이면 매우 작다(빈 화면 추정용) */
async function canvasShotBytes(page: Page, rects: { x: number; y: number; width: number; height: number }[]): Promise<(number | string)[]> {
  const out: (number | string)[] = [];
  for (const rect of rects.slice(0, 3)) {
    const width = Math.min(rect.width, 1440);
    const height = Math.min(rect.height, 900);
    if (width <= 0 || height <= 0 || rect.x < 0 || rect.y < 0) {
      out.push('outside-viewport');
      continue;
    }
    try {
      const png = await page.screenshot({ type: 'png', clip: { x: rect.x, y: rect.y, width, height }, scale: 'css', timeout: 10_000 });
      out.push(png.byteLength);
    } catch (error) {
      out.push(describeFailure(error));
    }
  }
  return out;
}

async function systemInfo(launched: LaunchedBrowser): Promise<unknown> {
  try {
    const session = await launched.browser.newBrowserCDPSession();
    const info = (await session.send('SystemInfo.getInfo')) as {
      gpu?: { featureStatus?: unknown; driverBugWorkarounds?: unknown; devices?: unknown };
      commandLine?: string;
      modelName?: string;
    };
    await session.detach().catch(() => undefined);
    return {
      featureStatus: info.gpu?.featureStatus ?? null,
      devices: info.gpu?.devices ?? null,
      // 실제로 적용된 실행 옵션(같은 이름의 옵션이 겹치면 마지막 값만 쓰인다). 경로만 있고 비밀 값은 없다
      commandLine: info.commandLine?.slice(0, 4000) ?? null,
    };
  } catch (error) {
    return { error: describeFailure(error) };
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let secret: string;
  try {
    secret = getInternalEnv().INTERNAL_API_SECRET;
  } catch {
    return NextResponse.json({ error: 'INTERNAL_API_SECRET is not configured' }, { status: 500 });
  }
  if (!isAuthorized(request.headers.get('x-internal-secret'), secret)) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'INVALID_BODY', issues: parsed.error.issues.map((i) => i.message) }, { status: 400 });
  const { viewport, fontMode, waitMs } = parsed.data;

  // 운영과 같은 SSRF 검사(PRD 8.6). 허용 목록 없이 만든다
  const checker = createHostChecker();
  let target: URL;
  try {
    target = await validateInspectionUrl(parsed.data.url, checker);
  } catch (error) {
    return NextResponse.json({ error: describeFailure(error) }, { status: 400 });
  }

  const collected: Collected = { consoleErrors: [], pageErrors: [], failedRequests: [], fontResponses: [], fontRequestsContinued: 0, fontRequestsBlocked: 0 };
  const timings: Record<string, number> = {};
  const started = Date.now();
  let launched: LaunchedBrowser | null = null;
  try {
    launched = await launchBrowser();
    timings.launchMs = launched.launchMs;
    const browserInfo = await withHardTimeout(systemInfo(launched), 10_000, () => new Error('SystemInfo timeout'));

    const context = await withHardTimeout(createViewportContext(launched.browser, viewport, { checker }), CONTEXT_TIMEOUT_MS, () => new Error('context timeout'));
    watch(context, collected);
    if (fontMode === 'continue') {
      // 나중에 등록한 route가 먼저 실행된다. 폰트가 아니면 routeGuard로 넘긴다(fallback)
      await context.route('**/*', async (route) => {
        const req = route.request();
        if (req.resourceType() !== 'font') return route.fallback();
        let host = '';
        try {
          const url = new URL(req.url());
          if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('scheme');
          host = url.hostname;
        } catch {
          collected.fontRequestsBlocked += 1;
          return route.abort('blockedbyclient');
        }
        const verdict = await checker.check(host);
        if (!verdict.allowed) {
          collected.fontRequestsBlocked += 1;
          return route.abort('blockedbyclient');
        }
        collected.fontRequestsContinued += 1;
        return route.continue();
      });
    }

    const openStart = Date.now();
    const { page, meta } = await withHardTimeout(openAndStabilize(context, target.href), 70_000, () => new Error('open-and-stabilize timeout'));
    timings.openAndStabilizeMs = Date.now() - openStart;
    if (waitMs > 0) await withHardTimeout(new Promise((resolve) => setTimeout(resolve, waitMs)), waitMs + 1_000, () => new Error('wait timeout'));
    await withHardTimeout(
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      5_000,
      () => new Error('fonts.ready timeout'),
    ).catch((error: unknown) => push(collected.pageErrors, `diagnostic: ${describeFailure(error)}`));

    const probe = await withHardTimeout(page.evaluate(probeInPage), STEP_TIMEOUT_MS, () => new Error('probe timeout'));
    const canvasPngBytes = await withHardTimeout(canvasShotBytes(page, probe.canvases.map((c) => c.rect)), STEP_TIMEOUT_MS, () => new Error('canvas shot timeout'));
    timings.totalMs = Date.now() - started;

    return NextResponse.json({
      target: { host: target.host, viewport, fontMode, waitMs, finalHost: hostOf(meta.finalUrl) },
      timings,
      browser: browserInfo,
      page: { ...probe, canvasPngBytes },
      network: collected,
    });
  } catch (error) {
    return NextResponse.json({ error: describeFailure(error), timings, network: collected }, { status: 500 });
  } finally {
    if (launched) await launched.close();
  }
}
