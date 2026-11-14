import 'server-only';
import type { Browser } from 'playwright-core';
import { getChildProcessEnv, getRuntimeEnv, type RuntimeEnv } from '@/server/env';
import { ensureFonts, type FontTarget } from './fonts';
import { BROWSER_CLOSE_TIMEOUT_MS, BROWSER_KILL_TIMEOUT_MS, settledWithin, withHardTimeout } from './timeouts';

// 실행 환경(Vercel / 로컬) 분기는 이 파일에서만 한다(AGENTS.md 7장).

/** PRD 8.1.3: Chromium 실행(콜드 스타트 포함) 시간 제한. viewport마다 적용한다 */
export const LAUNCH_TIMEOUT_MS = 15_000;

export function resolveLaunchTarget(runtime: Pick<RuntimeEnv, 'isVercel' | 'platform'>): FontTarget {
  if (runtime.isVercel) return 'vercel';
  if (runtime.platform === 'linux') return 'linux';
  // macOS와 그 밖의 로컬 환경은 OS 폰트 대체 순서를 그대로 쓴다(AGENTS.md 7.1).
  return 'macos';
}

export function getLaunchTarget(): FontTarget {
  return resolveLaunchTarget(getRuntimeEnv());
}

/** Playwright BrowserServer 중 이 모듈이 쓰는 부분. 강제 종료(kill)를 하려고 launch 대신 launchServer를 쓴다 */
export interface BrowserServerLike {
  wsEndpoint(): string;
  close(): Promise<void>;
  kill(): Promise<void>;
}

export type BrowserCloseResult = 'closed' | 'killed';

/**
 * viewport 하나를 검사하는 동안 쓰는 브라우저(AGENTS.md 7장: viewport마다 새로 띄운다).
 * Vercel의 @sparticuz/chromium은 --single-process로 실행되어 브라우저 하나에 context를 하나만 쓸 수 있다.
 */
export interface LaunchedBrowser {
  browser: Browser;
  /** 실행에 걸린 시간(ms, 압축 해제·폰트 등록·연결 포함) */
  launchMs: number;
  /**
   * 정상 종료를 BROWSER_CLOSE_TIMEOUT_MS까지 기다리고, 넘으면 프로세스를 강제 종료(SIGKILL)한다.
   * 여러 번 불러도 한 번만 닫는다.
   */
  close(): Promise<BrowserCloseResult>;
}

export interface CloseLimits {
  closeMs: number;
  killMs: number;
}

export function createLaunchedBrowser(
  browser: Browser,
  server: BrowserServerLike,
  launchMs: number,
  limits: CloseLimits = { closeMs: BROWSER_CLOSE_TIMEOUT_MS, killMs: BROWSER_KILL_TIMEOUT_MS },
): LaunchedBrowser {
  let closing: Promise<BrowserCloseResult> | null = null;
  const close = async (): Promise<BrowserCloseResult> => {
    const graceful = (async () => {
      await browser.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    })();
    if (await settledWithin(graceful, limits.closeMs)) return 'closed';
    await settledWithin(server.kill(), limits.killMs);
    return 'killed';
  };
  return {
    browser,
    launchMs,
    close: () => (closing ??= close()),
  };
}

interface Started {
  server: BrowserServerLike;
  connect(wsEndpoint: string): Promise<Browser>;
}

async function startVercel(): Promise<Started> {
  // dynamic import: 로컬에서는 @sparticuz/chromium을 불러오지 않는다.
  const [{ default: sparticuz }, { chromium }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('playwright-core'),
  ]);
  // executablePath()가 /tmp/fonts(fonts.conf)를 먼저 풀어야 번들 폰트를 등록할 수 있다(fonts.ts 참고).
  const executablePath = await sparticuz.executablePath();
  const fonts = await ensureFonts('vercel');
  const server = await chromium.launchServer({
    executablePath,
    args: sparticuz.args,
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS,
    // FONTCONFIG_FILE: 시스템 폰트 별칭을 더한 fonts.conf (fonts.ts). 나머지 환경(FONTCONFIG_PATH 등)은 그대로 물려준다
    env: getChildProcessEnv(fonts.env),
  });
  return { server, connect: (ws) => chromium.connect(ws, { timeout: LAUNCH_TIMEOUT_MS }) };
}

async function startLocal(target: FontTarget): Promise<Started> {
  const fonts = await ensureFonts(target);
  // dynamic import: devDependency인 playwright가 Vercel 함수 번들에 들어가지 않게 한다.
  const { chromium } = await import('playwright');
  const hasExtraEnv = Object.keys(fonts.env).length > 0;
  const server = await chromium.launchServer({
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS,
    ...(hasExtraEnv ? { env: getChildProcessEnv(fonts.env) } : {}),
  });
  return { server, connect: (ws) => chromium.connect(ws, { timeout: LAUNCH_TIMEOUT_MS }) };
}

/**
 * 브라우저를 실행하고 연결한다. 압축 해제와 폰트 등록을 포함한 전체 과정에 LAUNCH_TIMEOUT_MS를 적용한다(PRD 8.1.3, viewport마다).
 * 시간 제한을 넘긴 뒤 늦게 실행된 브라우저는 바로 닫는다(필요하면 강제 종료).
 */
export async function launchBrowser(): Promise<LaunchedBrowser> {
  const target = getLaunchTarget();
  const startedAt = Date.now();
  const starting = (async (): Promise<LaunchedBrowser> => {
    const { server, connect } = target === 'vercel' ? await startVercel() : await startLocal(target);
    try {
      const browser = await connect(server.wsEndpoint());
      return createLaunchedBrowser(browser, server, Date.now() - startedAt);
    } catch (error) {
      await settledWithin(server.kill(), BROWSER_KILL_TIMEOUT_MS);
      throw error;
    }
  })();

  let timedOut = false;
  try {
    return await withHardTimeout(starting, LAUNCH_TIMEOUT_MS, () => {
      timedOut = true;
      return new Error(`Browser launch timed out after ${LAUNCH_TIMEOUT_MS}ms`);
    });
  } finally {
    if (timedOut) {
      starting.then((launched) => launched.close()).catch(() => undefined);
    }
  }
}
