// TEMP(T14 진단): production에서 WebGL canvas와 웹 폰트가 스크린샷에 나오지 않는 원인을 찾기 위한 임시 route.
// 진단이 끝나면 이 파일을 삭제한다. 검사 기능에서 쓰지 않는다.
//
// POST /api/debug-render
//   헤더: x-internal-secret: <INTERNAL_API_SECRET>  (쿼리로 받지 않는다, AGENTS.md 8장)
//   본문: { "url": "https://…", "viewport": "mobile" | "desktop", "fontMode": "fetch" | "continue", "waitMs": 0~15000 }
//   - fontMode "fetch": 운영과 같다. 모든 요청을 routeGuard가 route.fetch로 대신 받는다
//   - fontMode "continue": 폰트 요청만 호스트 검사(SSRF) 후 route.continue로 브라우저가 직접 받는다. 리다이렉트 hop 검사는 하지 않는다(비교용)
//   - webgl false: 브라우저를 --disable-webgl, --disable-3d-apis로 띄운다(WebGL context 생성 불가, 비교용)
//   - mode "render": 검사와 같은 renderViewport(안정화 → 수집 → 스크린샷 재시도)를 돌리고 단계별 시간, 스크린샷 시도, 오류를 돌려준다.
//     fontMode는 무시한다. viewport 실패 원인(viewportErrors는 'Unexpected error'만 남는다)을 응답으로 확인하기 위한 것이다
//   - mode "shot": 새 브라우저·새 page에서 열기·안정화 뒤 첫 촬영 1회만 한다(재시도 없음, 앞 촬영의 영향 없음).
//     shot "first-screen"은 viewport 크기를 바꾸지 않는 clip 촬영, "full"은 검사와 같은 전체 페이지 촬영이다.
//     jsFreeze "script-disabled"는 CDP Emulation.setScriptExecutionDisabled(true), "frozen"은 Page.setWebLifecycleState(frozen)를
//     촬영 직전에 걸고 촬영 뒤 푼다
//   - mode "launch-loop": 한 요청 안에서(같은 인스턴스) 브라우저를 count번 띄운다. 매번 실행 → context·page 열기·안정화 → 닫기를 하고,
//     실행 전, 실행 후, 닫은 뒤의 자원 사용량(fd, /tmp, Chromium 프로세스)을 돌려준다
//   - freezeRaf true(render 모드): 스크린샷 직전에 window.requestAnimationFrame을 바꿔 애니메이션 루프를 멈춘다.
//     스크린샷 전후 canvas 크기, resize 이벤트 수, 멈춘 뒤 rAF 요청 수, 스크린샷의 canvas 영역 색 분포를 돌려준다
//
// 운영 검사와 같은 경로를 쓴다: launchBrowser(Vercel이면 @sparticuz/chromium) → createViewportContext(routeGuard 연결) → openAndStabilize.
// 브라우저는 하나, context도 하나다(AGENTS.md 7장). 응답에는 스크린샷을 넣지 않고 진단 값만 넣는다.

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import type { BrowserContext, Page } from 'playwright-core';
import { z } from 'zod';
import { createViewportContext } from '@/server/browser/devices';
import { launchBrowser, type LaunchedBrowser } from '@/server/browser/launch';
import { renderViewport } from '@/server/browser/render';
import { resourceSnapshot } from '@/server/browser/resources';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import type { ScreenshotAttemptFailure } from '@/server/browser/screenshot';
import { InspectionError } from '@/server/errors';
import { openAndStabilize } from '@/server/browser/stabilize';
import { CONTEXT_TIMEOUT_MS, withHardTimeout } from '@/server/browser/timeouts';
import { getInternalEnv } from '@/server/env';
import { isAuthorized } from '@/server/http/inspections';
import { describeFailure } from '@/server/log';
import { createHostChecker } from '@/server/security/ssrf';
import { validateInspectionUrl } from '@/server/security/url';

export const runtime = 'nodejs';
export const maxDuration = 300;

const bodySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  viewport: z.enum(['desktop', 'mobile']).default('mobile'),
  fontMode: z.enum(['fetch', 'continue']).default('fetch'),
  waitMs: z.number().int().min(0).max(15_000).default(5_000),
  webgl: z.boolean().default(true),
  mode: z.enum(['probe', 'render', 'shot', 'launch-loop']).default('probe'),
  count: z.number().int().min(1).max(20).default(12),
  stabilize: z.boolean().default(true),
  freezeRaf: z.boolean().default(false),
  shot: z.enum(['first-screen', 'full']).default('first-screen'),
  jsFreeze: z.enum(['none', 'script-disabled', 'frozen']).default('none'),
});

/** shot 모드의 촬영 1회 시간 제한 */
const SHOT_TIMEOUT_MS = 20_000;
/** JS를 멈춘 뒤 촬영 전까지 기다리는 시간 */
const JS_FREEZE_SETTLE_MS = 300;

/** rAF를 멈춘 뒤 스크린샷 전까지 기다리는 시간. 이미 예약된 콜백이 한 번 돌고 멈출 시간이다 */
const FREEZE_SETTLE_MS = 300;

/** render 모드의 viewport 시간 제한. 검사(INSPECTION_TIME_BUDGET_MS 안의 남은 시간)보다 넉넉히 준다 */
const RENDER_TIME_LIMIT_MS = 100_000;

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


/** 브라우저 안에서 실행한다. rAF를 가로채 콜백을 실행하지 않는다. 이후 요청 수만 센다 */
function freezeRafInPage() {
  const w = window as unknown as { __diag?: { rafCalls: number; resizes: number } };
  const diag = { rafCalls: 0, resizes: 0 };
  w.__diag = diag;
  window.addEventListener('resize', () => {
    diag.resizes += 1;
  });
  window.requestAnimationFrame = () => {
    diag.rafCalls += 1;
    return 0;
  };
  return true;
}

/** 브라우저 안에서 실행한다. resize 이벤트만 센다(rAF 멈춤 없이 비교용) */
function watchResizeInPage() {
  const w = window as unknown as { __diag?: { rafCalls: number; resizes: number } };
  const diag = { rafCalls: -1, resizes: 0 };
  w.__diag = diag;
  window.addEventListener('resize', () => {
    diag.resizes += 1;
  });
  return true;
}

/** 브라우저 안에서 실행한다. canvas의 문서 기준 위치와 버퍼 크기 */
function canvasStateInPage() {
  const w = window as unknown as { __diag?: { rafCalls: number; resizes: number } };
  return {
    diag: w.__diag ? { ...w.__diag } : null,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    canvases: Array.from(document.getElementsByTagName('canvas'))
      .slice(0, 5)
      .map((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return {
          bufferWidth: canvas.width,
          bufferHeight: canvas.height,
          docRect: { x: Math.round(rect.x + window.scrollX), y: Math.round(rect.y + window.scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
          position: getComputedStyle(canvas).position,
        };
      }),
  };
}

/** 8비트, 비인터레이스 RGB/RGBA PNG를 RGBA로 푼다(진단용, 새 의존성 없음) */
function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const bitDepth = png[24];
  const colorType = png[25];
  const interlace = png[28];
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) throw new Error(`unsupported png ${bitDepth}/${colorType}/${interlace}`);
  const channels = colorType === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let value = src[i]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = value & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      out[o] = line[x * channels]!;
      out[o + 1] = line[x * channels + 1]!;
      out[o + 2] = line[x * channels + 2]!;
      out[o + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    prev.set(line);
  }
  return { width, height, rgba: out };
}

/** 영역 안을 격자로 표본 추출해 색 분포를 낸다. 가장 많은 색 비율이 1에 가까우면 단색(비어 있음)이다 */
function regionColors(image: { width: number; height: number; rgba: Uint8Array }, rect: { x: number; y: number; width: number; height: number }) {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(image.width, rect.x + rect.width);
  const y1 = Math.min(image.height, rect.y + rect.height);
  if (x1 <= x0 || y1 <= y0) return { sampled: 0, note: 'outside-screenshot' };
  const counts = new Map<string, number>();
  const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 60));
  let sampled = 0;
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const o = (y * image.width + x) * 4;
      // 4단계로 줄여 센다(압축 잡음 무시)
      const key = `${image.rgba[o]! >> 4},${image.rgba[o + 1]! >> 4},${image.rgba[o + 2]! >> 4}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      sampled += 1;
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return {
    sampled,
    clippedRect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    distinctColors: counts.size,
    dominantColor: sorted[0]?.[0] ?? null,
    dominantRatio: sorted[0] ? Math.round((sorted[0][1] / sampled) * 1000) / 1000 : null,
  };
}


/** 함수 인스턴스 식별(Fluid compute에서 같은 인스턴스를 다시 쓰는지 보기 위해) */
const INSTANCE = { id: randomUUID().slice(0, 8), startedAt: Date.now(), requests: 0 };

/**
 * 이 인스턴스에서 살아 있는 Chromium 프로세스와 메모리, 부하(/proc, Linux만). 앞 요청의 브라우저가 남아
 * CPU·메모리를 쓰고 있는지 확인한다. 실행 인자는 넣지 않는다(경로 정도지만 줄인다)
 */
async function processSnapshot(): Promise<unknown> {
  try {
    const pids = (await readdir('/proc')).filter((name) => /^\d+$/.test(name));
    const chrome: { pid: number; ppid: number; state: string; cpuTicks: number; rssKb: number | null; kind: string }[] = [];
    for (const pid of pids) {
      try {
        const cmdline = (await readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0');
        const exe = cmdline[0] ?? '';
        if (!/chrom|headless_shell/i.test(exe)) continue;
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        const status = await readFile(`/proc/${pid}/status`, 'utf8');
        const rss = /VmRSS:\s+(\d+)/.exec(status);
        const type = cmdline.find((arg) => arg.startsWith('--type='));
        chrome.push({
          pid: Number(pid),
          ppid: Number(fields[1]),
          state: fields[0] ?? '?',
          cpuTicks: Number(fields[11]) + Number(fields[12]),
          rssKb: rss ? Number(rss[1]) : null,
          kind: type ? type.slice(7) : 'browser',
        });
      } catch {
        // 그사이 끝난 프로세스
      }
    }
    const meminfo = await readFile('/proc/meminfo', 'utf8').catch(() => '');
    const available = /MemAvailable:\s+(\d+)/.exec(meminfo);
    const total = /MemTotal:\s+(\d+)/.exec(meminfo);
    return {
      chrome,
      memAvailableMb: available ? Math.round(Number(available[1]) / 1024) : null,
      memTotalMb: total ? Math.round(Number(total[1]) / 1024) : null,
      loadavg: (await readFile('/proc/loadavg', 'utf8').catch(() => '')).trim(),
    };
  } catch (error) {
    return { error: describeFailure(error) };
  }
}


interface ShotReport {
  ok: boolean;
  timings: Record<string, number>;
  freeze: { applied: boolean; error: string | null; released: boolean | null; releaseError: string | null };
  screenshot: { width: number; height: number; pngBytes: number } | null;
  error: string | null;
  canvasBefore: unknown;
  canvasAfter: unknown;
  canvasPixels: unknown[];
}

/** 새 page에서 첫 촬영 1회. 앞 촬영의 영향이 없는 조건에서 촬영 방식과 JS 멈춤의 효과를 본다 */
async function runShot(
  launched: LaunchedBrowser,
  viewport: 'desktop' | 'mobile',
  url: string,
  checker: ReturnType<typeof createHostChecker>,
  shot: 'first-screen' | 'full',
  jsFreeze: 'none' | 'script-disabled' | 'frozen',
): Promise<ShotReport> {
  const report: ShotReport = {
    ok: false,
    timings: {},
    freeze: { applied: false, error: null, released: null, releaseError: null },
    screenshot: null,
    error: null,
    canvasBefore: null,
    canvasAfter: null,
    canvasPixels: [],
  };
  const time = async <T,>(name: string, ms: number, task: () => Promise<T>): Promise<T> => {
    const start = Date.now();
    try {
      return await withHardTimeout(task(), ms, () => new Error(`${name} hard timeout ${ms}ms`));
    } finally {
      report.timings[`${name}Ms`] = Date.now() - start;
    }
  };
  let page: Page | null = null;
  try {
    const context = await time('context', CONTEXT_TIMEOUT_MS, () => createViewportContext(launched.browser, viewport, { checker }));
    const opened = await time('openAndStabilize', 70_000, () => openAndStabilize(context, url));
    page = opened.page;
    const current = page;
    await current.evaluate(watchResizeInPage);
    const before = await time('canvasBefore', 5_000, () => current.evaluate(canvasStateInPage));
    report.canvasBefore = before;
    const viewportSize = current.viewportSize() ?? { width: 0, height: 0 };

    const session = jsFreeze === 'none' ? null : await time('cdpSession', 5_000, () => context.newCDPSession(current));
    if (session) {
      try {
        await time('freeze', 5_000, () =>
          jsFreeze === 'script-disabled'
            ? session.send('Emulation.setScriptExecutionDisabled', { value: true })
            : session.send('Page.setWebLifecycleState', { state: 'frozen' }),
        );
        report.freeze.applied = true;
        await new Promise((resolve) => setTimeout(resolve, JS_FREEZE_SETTLE_MS));
      } catch (error) {
        report.freeze.error = describeFailure(error);
      }
    }

    try {
      const png = await time('screenshot', SHOT_TIMEOUT_MS + 2_000, () =>
        current.screenshot({
          type: 'png',
          scale: 'css',
          animations: 'disabled',
          caret: 'hide',
          timeout: SHOT_TIMEOUT_MS,
          ...(shot === 'full' ? { fullPage: true } : { clip: { x: 0, y: 0, width: viewportSize.width, height: viewportSize.height } }),
        }),
      );
      const image = decodePng(png);
      report.ok = true;
      report.screenshot = { width: image.width, height: image.height, pngBytes: png.byteLength };
      report.canvasPixels = before.canvases.map((canvas) => regionColors(image, canvas.docRect));
    } catch (error) {
      report.error = describeFailure(error);
    }

    if (session && report.freeze.applied) {
      try {
        await time('release', 5_000, () =>
          jsFreeze === 'script-disabled'
            ? session.send('Emulation.setScriptExecutionDisabled', { value: false })
            : session.send('Page.setWebLifecycleState', { state: 'active' }),
        );
        report.freeze.released = true;
      } catch (error) {
        report.freeze.released = false;
        report.freeze.releaseError = describeFailure(error);
      }
    }
    report.canvasAfter = await time('canvasAfter', 5_000, () => current.evaluate(canvasStateInPage)).catch((error: unknown) => describeFailure(error));
  } catch (error) {
    report.error = report.error ?? describeFailure(error);
  }
  return report;
}


/** 같은 인스턴스에서 브라우저를 count번 띄우고 닫으며 자원 사용량 변화를 본다 */
async function runLaunchLoop(
  viewport: 'desktop' | 'mobile',
  url: string,
  checker: ReturnType<typeof createHostChecker>,
  count: number,
  stabilize: boolean,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let i = 1; i <= count; i += 1) {
    const row: Record<string, unknown> = { i, before: await resourceSnapshot() };
    const start = Date.now();
    let launched: LaunchedBrowser | null = null;
    try {
      launched = await launchBrowser();
      row.launchMs = launched.launchMs;
      row.afterLaunch = await resourceSnapshot();
      const context = await withHardTimeout(createViewportContext(launched.browser, viewport, { checker }), CONTEXT_TIMEOUT_MS, () => new Error('context timeout'));
      if (stabilize) {
        await withHardTimeout(openAndStabilize(context, url), 70_000, () => new Error('open-and-stabilize timeout'));
      } else {
        const page = await context.newPage();
        await withHardTimeout(page.goto(url, { waitUntil: 'load', timeout: 30_000 }), 32_000, () => new Error('goto timeout'));
      }
      row.ok = true;
    } catch (error) {
      row.ok = false;
      row.error = describeFailure(error);
    } finally {
      if (launched) row.close = await launched.close();
    }
    row.totalMs = Date.now() - start;
    row.afterClose = await resourceSnapshot();
    rows.push(row);
  }
  return rows;
}

interface RenderReport {
  ok: boolean;
  /** 시작한 단계와 그때까지 걸린 시간(ms). 멈춘 단계를 알 수 있다 */
  steps: { step: string; atMs: number }[];
  timings: Record<string, number> | null;
  screenshot: Record<string, unknown> | null;
  screenshotFailures: { diagnostics: ScreenshotAttemptFailure['diagnostics']; timeoutMs: number; durationMs: number; cause: string }[];
  collected: Record<string, unknown> | null;
  error: { code: string; message: string; cause: string } | null;
  totalMs: number;
  freezeRaf: boolean;
  canvasBefore: unknown;
  canvasAfter: unknown;
  canvasPixels: unknown[];
}

/** 검사와 같은 renderViewport. 검사의 viewport 실패 원인을 응답으로 돌려준다 */
async function runRender(
  launched: LaunchedBrowser,
  viewport: 'desktop' | 'mobile',
  url: string,
  checker: ReturnType<typeof createHostChecker>,
  freezeRaf: boolean,
): Promise<RenderReport> {
  const started = Date.now();
  const report: RenderReport = {
    ok: false,
    steps: [],
    timings: null,
    screenshot: null,
    screenshotFailures: [],
    collected: null,
    error: null,
    totalMs: 0,
    freezeRaf,
    canvasBefore: null,
    canvasAfter: null,
    canvasPixels: [],
  };
  let renderedPage: Page | null = null;
  let before: ReturnType<typeof canvasStateInPage> | null = null;
  try {
    const result = await renderViewport(launched.browser, viewport, url, {
      guard: { checker },
      timeLimitMs: RENDER_TIME_LIMIT_MS,
      beforeScreenshot: async (page) => {
        renderedPage = page;
        await page.evaluate(freezeRaf ? freezeRafInPage : watchResizeInPage);
        if (freezeRaf) await new Promise((resolve) => setTimeout(resolve, FREEZE_SETTLE_MS));
        before = await page.evaluate(canvasStateInPage);
        report.canvasBefore = before;
      },
      onStep: (step) => report.steps.push({ step, atMs: Date.now() - started }),
      onScreenshotFailed: (failure) =>
        report.screenshotFailures.push({
          diagnostics: failure.diagnostics,
          timeoutMs: failure.timeoutMs,
          durationMs: failure.durationMs,
          cause: describeFailure(failure.error),
        }),
    });
    const { png, ...meta } = result.screenshot;
    report.ok = true;
    report.timings = result.timings;
    report.screenshot = { ...meta, pngBytes: png.byteLength };
    try {
      const image = decodePng(png);
      const rects = (before as ReturnType<typeof canvasStateInPage> | null)?.canvases.map((c) => c.docRect) ?? [];
      report.canvasPixels = rects.map((rect) => regionColors(image, rect));
    } catch (error) {
      report.canvasPixels = [describeFailure(error)];
    }
    report.collected = {
      layoutWidth: result.collected.layoutWidth,
      documentHeight: result.collected.documentHeight,
      hasCanvas: result.collected.hasCanvas,
      finalHost: hostOf(result.finalUrl),
    };
  } catch (error) {
    report.error = {
      code: error instanceof InspectionError ? error.code : 'UNEXPECTED',
      message: error instanceof Error ? clip(error.message) : 'unknown',
      cause: describeFailure(error),
    };
  }
  const page = renderedPage as Page | null;
  if (page && !page.isClosed()) {
    report.canvasAfter = await withHardTimeout(page.evaluate(canvasStateInPage), 5_000, () => new Error('canvas state timeout')).catch((error: unknown) =>
      describeFailure(error),
    );
  }
  report.totalMs = Date.now() - started;
  return report;
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
  const { viewport, fontMode, waitMs, webgl, mode, freezeRaf, shot, jsFreeze, count, stabilize } = parsed.data;

  // 운영과 같은 SSRF 검사(PRD 8.6). 허용 목록 없이 만든다
  const checker = createHostChecker();
  let target: URL;
  try {
    target = await validateInspectionUrl(parsed.data.url, checker);
  } catch (error) {
    return NextResponse.json({ error: describeFailure(error) }, { status: 400 });
  }

  INSTANCE.requests += 1;
  const instance = { id: INSTANCE.id, ageMs: Date.now() - INSTANCE.startedAt, request: INSTANCE.requests };
  const processesAtStart = await processSnapshot();
  if (mode === 'launch-loop') {
    return NextResponse.json({
      target: { host: target.host, viewport, mode, count, stabilize },
      instance,
      loop: await runLaunchLoop(viewport, target.href, checker, count, stabilize),
    });
  }

  const collected: Collected = { consoleErrors: [], pageErrors: [], failedRequests: [], fontResponses: [], fontRequestsContinued: 0, fontRequestsBlocked: 0 };
  const timings: Record<string, number> = {};
  const started = Date.now();
  let launched: LaunchedBrowser | null = null;
  try {
    launched = await launchBrowser({ webgl });
    timings.launchMs = launched.launchMs;
    const browserInfo = await withHardTimeout(systemInfo(launched), 10_000, () => new Error('SystemInfo timeout'));

    if (mode === 'shot') {
      return NextResponse.json({
        target: { host: target.host, viewport, webgl, mode, shot, jsFreeze },
        instance,
        processesAtStart,
        launchMs: launched.launchMs,
        result: await runShot(launched, viewport, target.href, checker, shot, jsFreeze),
        closeResult: await launched.close(),
        processesAfterClose: await processSnapshot(),
      });
    }

    if (mode === 'render') {
      return NextResponse.json({
        target: { host: target.host, viewport, webgl, mode, freezeRaf },
        instance,
        processesAtStart,
        launchMs: launched.launchMs,
        browser: browserInfo,
        render: await runRender(launched, viewport, target.href, checker, freezeRaf),
        closeResult: await launched.close(),
        processesAfterClose: await processSnapshot(),
      });
    }

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
