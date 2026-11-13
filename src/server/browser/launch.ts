import 'server-only';
import type { Browser } from 'playwright-core';
import { getChildProcessEnv, getRuntimeEnv, type RuntimeEnv } from '@/server/env';
import { ensureFonts, type FontTarget } from './fonts';

// 실행 환경(Vercel / 로컬) 분기는 이 파일에서만 한다(AGENTS.md 7장).

/** PRD 8.1.3: Chromium 실행(콜드 스타트 포함) 시간 제한 */
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

async function startVercel(): Promise<Browser> {
  // dynamic import: 로컬에서는 @sparticuz/chromium을 불러오지 않는다.
  const [{ default: sparticuz }, { chromium }] = await Promise.all([
    import('@sparticuz/chromium'),
    import('playwright-core'),
  ]);
  // executablePath()가 /tmp/fonts(fonts.conf)를 먼저 풀어야 번들 폰트를 등록할 수 있다(fonts.ts 참고).
  const executablePath = await sparticuz.executablePath();
  await ensureFonts('vercel');
  return chromium.launch({
    executablePath,
    args: sparticuz.args,
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS,
  });
}

async function startLocal(target: FontTarget): Promise<Browser> {
  const fonts = await ensureFonts(target);
  // dynamic import: devDependency인 playwright가 Vercel 함수 번들에 들어가지 않게 한다.
  const { chromium } = await import('playwright');
  const hasExtraEnv = Object.keys(fonts.env).length > 0;
  return chromium.launch({
    headless: true,
    timeout: LAUNCH_TIMEOUT_MS,
    ...(hasExtraEnv ? { env: getChildProcessEnv(fonts.env) } : {}),
  });
}

/**
 * 브라우저를 실행한다. 압축 해제와 폰트 등록을 포함한 전체 과정에 LAUNCH_TIMEOUT_MS를 적용한다.
 * 시간 제한을 넘긴 뒤 늦게 실행된 브라우저는 바로 닫는다.
 */
export async function launchBrowser(): Promise<Browser> {
  const target = getLaunchTarget();
  const starting = target === 'vercel' ? startVercel() : startLocal(target);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`Browser launch timed out after ${LAUNCH_TIMEOUT_MS}ms`));
    }, LAUNCH_TIMEOUT_MS);
  });

  try {
    return await Promise.race([starting, timeout]);
  } finally {
    clearTimeout(timer);
    if (timedOut) {
      starting.then((browser) => browser.close()).catch(() => undefined);
    }
  }
}
