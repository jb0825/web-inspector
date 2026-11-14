import 'server-only';

// 브라우저 작업의 강제 시간 제한. Playwright 호출이 응답하지 않아도(Vercel에서 멈춘 Chromium) 제한 시간에 끝낸다.
// PRD 8.1.3의 단계 제한은 각 모듈에 있다(LAUNCH_TIMEOUT_MS, NAVIGATION_TIMEOUT_MS, STABILIZE_BUDGET_MS, MEASURE_AND_SCREENSHOT_BUDGET_MS).
// 아래 값은 PRD에 없는 값이다(T13 보고).

/** Playwright 자체 시간 제한(goto timeout 등)이 먼저 동작할 여유. 이 시간이 더 지나도 응답이 없으면 멈춘 것으로 본다 */
export const HARD_TIMEOUT_GRACE_MS = 2_000;
/** browser.newContext와 route guard 연결 */
export const CONTEXT_TIMEOUT_MS = 10_000;
/** context.newPage */
export const PAGE_OPEN_TIMEOUT_MS = 10_000;
/** 정상 종료(browser.close) 제한. 넘으면 브라우저 프로세스를 강제 종료한다 */
export const BROWSER_CLOSE_TIMEOUT_MS = 5_000;
/** 강제 종료(SIGKILL) 제한. 넘어도 더 기다리지 않는다 */
export const BROWSER_KILL_TIMEOUT_MS = 2_000;

/**
 * task가 ms 안에 끝나지 않으면 기다리지 않고 onTimeout()의 오류로 끝낸다.
 * task는 계속 실행될 수 있으므로, 나중에 실패해도 처리되지 않은 rejection이 생기지 않게 막아 둔다.
 * 끊긴 작업은 호출한 쪽이 브라우저를 닫아(강제 종료 포함) 정리한다.
 */
export function withHardTimeout<T>(task: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  task.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), Math.max(0, ms));
  });
  return Promise.race([task, timeout]).finally(() => clearTimeout(timer));
}

class SettleTimeout extends Error {}

/** 시간 안에 끝나면 true, 아니면 false. 오류로 끝난 것도 끝난 것으로 본다(종료 정리용) */
export async function settledWithin(task: Promise<unknown>, ms: number): Promise<boolean> {
  try {
    await withHardTimeout(task, ms, () => new SettleTimeout());
    return true;
  } catch (error) {
    return !(error instanceof SettleTimeout);
  }
}
