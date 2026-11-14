import type { Browser, BrowserContext, Page } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLaunchedBrowser, type BrowserServerLike, type LaunchedBrowser } from '@/server/browser/launch';
import { renderViewport, type RenderedViewport, type RenderLimits } from '@/server/browser/render';
import { inspectViewportInFreshBrowser, withFreshBrowser } from '@/server/browser/session';
import { settledWithin, withHardTimeout } from '@/server/browser/timeouts';
import { InspectionError } from '@/server/errors';
import { runInspection, type InspectionDeps } from '@/server/inspect';
import { createHostChecker } from '@/server/security/ssrf';
import { createInspectionStore } from '@/server/store/redis';
import type { Viewport } from '@/types/inspection';
import { FakeRedis } from './helpers/fakeRedis';
import { ID, pendingDoc, T0 } from './helpers/inspection';
import { site } from './helpers/site';

// T13: 멈춘 Chromium(응답하지 않는 Playwright 호출)을 단계별 강제 시간 제한으로 끊고, 브라우저를 강제 종료한 뒤
// 다음 viewport가 새 브라우저로 계속 진행되는지 확인한다. 실제 브라우저 대신 응답하지 않는 가짜를 쓴다.

const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** 단계 제한을 짧게 줄인 값 (ms) */
const TINY: Partial<RenderLimits> = { contextMs: 40, pageOpenMs: 40, navigationMs: 40, stabilizeMs: 40, hardGraceMs: 20, measureMs: 40 };
const guard = { checker: createHostChecker({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }) };

/** route guard 연결에 필요한 메서드만 있는 context. page가 없으면 newPage가 응답하지 않는다 */
function fakeContext(page?: Page): BrowserContext {
  return {
    route: async () => undefined,
    routeWebSocket: async () => undefined,
    pages: () => [],
    on: () => undefined,
    newPage: page ? async () => page : () => never<Page>(),
    close: () => never<void>(),
  } as unknown as BrowserContext;
}

/** goto가 응답하지 않는 page (close도 응답하지 않는다) */
function hungGotoPage(): Page {
  return {
    on: () => undefined,
    mainFrame: () => ({}),
    goto: () => never(),
    close: () => never<void>(),
    url: () => 'about:blank',
  } as unknown as Page;
}

const fakeBrowser = (context: () => Promise<BrowserContext>) => ({ newContext: context }) as unknown as Browser;

async function expectCode(promise: Promise<unknown>, code: string): Promise<InspectionError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InspectionError);
  expect((error as InspectionError).code).toBe(code);
  return error as InspectionError;
}

describe('withHardTimeout / settledWithin', () => {
  it('응답하지 않는 작업을 기다리지 않고 제한 시간에 끝낸다', async () => {
    const started = Date.now();
    await expect(withHardTimeout(never(), 30, () => new Error('cut'))).rejects.toThrow('cut');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('제한 안에 끝나면 결과를 돌려주고, 늦은 실패는 처리되지 않은 rejection을 만들지 않는다', async () => {
    await expect(withHardTimeout(Promise.resolve(1), 30, () => new Error('cut'))).resolves.toBe(1);
    const late = new Promise((_, reject) => setTimeout(() => reject(new Error('late')), 60));
    await expect(withHardTimeout(late, 10, () => new Error('cut'))).rejects.toThrow('cut');
    await new Promise((r) => setTimeout(r, 80));
  });

  it('settledWithin: 끝나면 true(실패도 끝난 것), 멈추면 false', async () => {
    expect(await settledWithin(Promise.resolve(), 20)).toBe(true);
    expect(await settledWithin(Promise.reject(new Error('x')), 20)).toBe(true);
    expect(await settledWithin(never(), 20)).toBe(false);
  });
});

describe('renderViewport: 단계별 강제 시간 제한', () => {
  it('context가 열리지 않으면 BROWSER_CRASH로 끝난다', async () => {
    const browser = fakeBrowser(() => never());
    await expectCode(renderViewport(browser, 'mobile', 'https://example.com/', { guard, timeLimitMs: 10_000, limits: TINY }), 'BROWSER_CRASH');
  });

  it('page가 열리지 않으면 BROWSER_CRASH로 끝난다', async () => {
    const browser = fakeBrowser(async () => fakeContext());
    const error = await expectCode(renderViewport(browser, 'mobile', 'https://example.com/', { guard, timeLimitMs: 10_000, limits: TINY }), 'BROWSER_CRASH');
    expect(error.message).toContain('Page did not open');
  });

  it('goto가 응답하지 않으면 NAVIGATION_TIMEOUT으로 끝난다 (page.close도 기다리지 않는다)', async () => {
    const browser = fakeBrowser(async () => fakeContext(hungGotoPage()));
    const steps: string[] = [];
    const started = Date.now();
    await expectCode(
      renderViewport(browser, 'mobile', 'https://example.com/', { guard, timeLimitMs: 10_000, limits: TINY, onStep: (s) => steps.push(s) }),
      'NAVIGATION_TIMEOUT',
    );
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(steps).toEqual(['context', 'open-and-stabilize']);
  });

  it('viewport에 남은 시간이 단계 제한보다 짧으면 TIME_BUDGET_EXCEEDED', async () => {
    const browser = fakeBrowser(() => never());
    await expectCode(
      renderViewport(browser, 'mobile', 'https://example.com/', { guard, timeLimitMs: 30, limits: { ...TINY, contextMs: 10_000 } }),
      'TIME_BUDGET_EXCEEDED',
    );
  });
});

describe('createLaunchedBrowser: 닫기와 강제 종료', () => {
  const server = (overrides: Partial<BrowserServerLike> = {}) => ({
    wsEndpoint: () => 'ws://fake',
    close: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    ...overrides,
  });

  it('정상 종료되면 closed, 강제 종료하지 않는다. 여러 번 불러도 한 번만 닫는다', async () => {
    const s = server();
    const close = vi.fn(async () => undefined);
    const launched = createLaunchedBrowser({ close } as unknown as Browser, s, 5, { closeMs: 50, killMs: 50 });
    expect(await launched.close()).toBe('closed');
    expect(await launched.close()).toBe('closed');
    expect(close).toHaveBeenCalledTimes(1);
    expect(s.kill).not.toHaveBeenCalled();
  });

  it('browser.close가 응답하지 않으면 제한 시간 뒤 프로세스를 강제 종료한다', async () => {
    const s = server();
    const launched = createLaunchedBrowser({ close: () => never() } as unknown as Browser, s, 5, { closeMs: 30, killMs: 50 });
    const started = Date.now();
    expect(await launched.close()).toBe('killed');
    expect(s.kill).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('kill도 응답하지 않으면 더 기다리지 않는다', async () => {
    const s = server({ kill: vi.fn(() => never<void>()) });
    const launched = createLaunchedBrowser({ close: () => never() } as unknown as Browser, s, 5, { closeMs: 20, killMs: 20 });
    expect(await launched.close()).toBe('killed');
  });
});

describe('withFreshBrowser / inspectViewportInFreshBrowser', () => {
  const launchedWith = (browser: Browser, close = vi.fn(async () => 'closed' as const)): LaunchedBrowser => ({ browser, launchMs: 7, close });

  it('실행 실패는 BROWSER_CRASH', async () => {
    await expectCode(withFreshBrowser(async () => Promise.reject(new Error('spawn failed')), async () => 1), 'BROWSER_CRASH');
  });

  it('검사가 실패해도 브라우저를 닫고 오류를 그대로 던진다', async () => {
    const launched = launchedWith({} as Browser);
    const closed = vi.fn();
    await expect(
      withFreshBrowser(async () => launched, async () => Promise.reject(new InspectionError('NAVIGATION_TIMEOUT', 'x')), { onClosed: closed }),
    ).rejects.toThrow('x');
    expect(launched.close).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith('closed', expect.any(Number));
  });

  it('실행 시간을 viewport 예산에서 빼고 timings에 launchMs를 남긴다', async () => {
    const render = vi.fn<InspectionDeps['renderViewport']>(async () => ({ collected: site('desktop'), screenshot: {} as RenderedViewport['screenshot'], finalUrl: 'x', timings: {} }));
    const result = await inspectViewportInFreshBrowser({ launchBrowser: async () => launchedWith({} as Browser), renderViewport: render }, 'desktop', 'https://example.com/', {
      guard,
      timeLimitMs: 1_000,
    });
    expect(render.mock.calls[0]?.[3].timeLimitMs).toBe(993);
    expect(result.timings.launchMs).toBe(7);
  });
});

describe('runInspection: 멈춘 viewport를 끊고 다음 viewport를 새 브라우저로 진행한다', () => {
  let now: number;
  let redis: FakeRedis;

  beforeEach(async () => {
    now = T0;
    redis = new FakeRedis(() => now);
    const store = createInspectionStore(redis, { now: () => now });
    await store.create(pendingDoc());
    await store.acquireSlot(ID, 2);
  });

  it('Desktop goto가 멈추면 NAVIGATION_TIMEOUT, 그 브라우저는 강제 종료하고 Mobile은 성공한다. 동시에 떠 있는 브라우저는 하나다', async () => {
    let open = 0;
    let maxOpen = 0;
    const kills: Viewport[] = [];
    const launches: Viewport[] = [];
    const order: Viewport[] = ['desktop', 'mobile'];

    const launchBrowser = vi.fn(async (): Promise<LaunchedBrowser> => {
      const viewport = order[launches.length];
      launches.push(viewport);
      open += 1;
      maxOpen = Math.max(maxOpen, open);
      const hung = viewport === 'desktop';
      const browser = hung ? fakeBrowser(async () => fakeContext(hungGotoPage())) : ({} as Browser);
      // Desktop 브라우저는 close도 응답하지 않는다 → 강제 종료
      const server: BrowserServerLike = {
        wsEndpoint: () => 'ws://fake',
        close: async () => undefined,
        kill: async () => {
          kills.push(viewport);
        },
      };
      const launched = createLaunchedBrowser(
        { close: hung ? () => never() : async () => undefined } as unknown as Browser,
        server,
        0,
        { closeMs: 30, killMs: 30 },
      );
      return {
        ...launched,
        browser,
        close: async () => {
          const result = await launched.close();
          open -= 1;
          return result;
        },
      };
    });

    const mobileRendered: RenderedViewport = {
      collected: site('mobile'),
      screenshot: { png: Buffer.from('png'), screenshotWidth: 616, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false, mode: 'full', failedAttempts: 0 },
      finalUrl: 'https://example.com/',
      timings: {},
    };
    const deps: InspectionDeps = {
      store: createInspectionStore(redis, { now: () => now }),
      screenshots: { upload: vi.fn(async (id: string, v: Viewport) => `https://blob.example/${id}/${v}.png`) },
      launchBrowser,
      renderViewport: (browser, viewport, url, options) =>
        viewport === 'desktop' ? renderViewport(browser, viewport, url, { ...options, limits: TINY }) : Promise.resolve(mobileRendered),
      createChecker: () => guard.checker,
      triggerAnalyze: vi.fn(async () => undefined),
      now: () => now,
      log: () => undefined,
    };

    await runInspection(ID, deps);

    const doc = await deps.store.read(ID);
    expect(launches).toEqual(['desktop', 'mobile']);
    expect(kills).toEqual(['desktop']);
    expect(maxOpen).toBe(1);
    expect(open).toBe(0);
    expect(doc?.status).toBe('analyzing');
    expect(doc?.viewportErrors.desktop?.code).toBe('NAVIGATION_TIMEOUT');
    expect(doc?.viewports.mobile).not.toBeNull();
  });
});
