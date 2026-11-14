import type { Browser, BrowserContext, Page } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderViewport } from '@/server/browser/render';
import { InspectionError, toStepError } from '@/server/errors';
import { createHostChecker } from '@/server/security/ssrf';
import { site } from './helpers/site';

// T14: viewport 단계(context, 열기·안정화, 수집, 스크린샷)의 Playwright 오류를 단계별 InspectionError로 기록한다.
// 'Unexpected error'(INTERNAL_ERROR)로 남는 경우가 없어야 하고, 스크린샷만 실패하면 viewport 결과는 남는다(PRD 5.2.4).
// 열기·안정화와 수집은 가짜로 바꿔, 각 단계에서 원하는 오류를 던진다.

const mocks = vi.hoisted(() => ({
  openAndStabilize: vi.fn(),
  collectViewport: vi.fn(),
}));

vi.mock('@/server/browser/stabilize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/browser/stabilize')>()),
  openAndStabilize: mocks.openAndStabilize,
}));
vi.mock('@/server/collect/collect', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/collect/collect')>()),
  collectViewport: mocks.collectViewport,
}));

const guard = { checker: createHostChecker({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }) };

const timeoutError = (what: string) => Object.assign(new Error(`${what}: Timeout 1000ms exceeded.`), { name: 'TimeoutError' });

function fakePage(screenshot: () => Promise<Buffer>): Page {
  return {
    evaluate: vi.fn(async () => ({ width: 1440, height: 2000, canvasCount: 0 })),
    screenshot: vi.fn(screenshot),
    isClosed: () => false,
  } as unknown as Page;
}

function fakeBrowser(newContext?: () => Promise<BrowserContext>): Browser {
  const context = {
    route: async () => undefined,
    routeWebSocket: async () => undefined,
    pages: () => [],
    on: () => undefined,
  } as unknown as BrowserContext;
  return { newContext: newContext ?? (async () => context) } as unknown as Browser;
}

async function failure(promise: Promise<unknown>): Promise<InspectionError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InspectionError);
  return error as InspectionError;
}

const run = (browser: Browser) => renderViewport(browser, 'desktop', 'https://example.com/', { guard, timeLimitMs: 30_000 });

beforeEach(() => {
  mocks.openAndStabilize.mockReset();
  mocks.collectViewport.mockReset();
});

describe('renderViewport: 단계별 오류 분류 (T14)', () => {
  it('context 단계 TimeoutError → TIME_BUDGET_EXCEEDED, step context', async () => {
    const error = await failure(run(fakeBrowser(async () => Promise.reject(timeoutError('browser.newContext')))));
    expect(error).toMatchObject({ code: 'TIME_BUDGET_EXCEEDED', step: 'context' });
    expect((error.cause as Error).name).toBe('TimeoutError');
  });

  it('열기·안정화 단계 TimeoutError → TIME_BUDGET_EXCEEDED, step open-and-stabilize', async () => {
    mocks.openAndStabilize.mockRejectedValue(timeoutError('page.waitForLoadState'));
    const error = await failure(run(fakeBrowser()));
    expect(error).toMatchObject({ code: 'TIME_BUDGET_EXCEEDED', step: 'open-and-stabilize' });
  });

  it('열기·안정화가 이미 분류한 오류는 코드를 그대로 두고 단계 이름만 붙인다', async () => {
    mocks.openAndStabilize.mockRejectedValue(new InspectionError('NAVIGATION_TIMEOUT', 'Navigation timed out'));
    const error = await failure(run(fakeBrowser()));
    expect(error).toMatchObject({ code: 'NAVIGATION_TIMEOUT', step: 'open-and-stabilize' });
  });

  it('수집 단계 TimeoutError → TIME_BUDGET_EXCEEDED, 브라우저가 닫힘 → BROWSER_CRASH', async () => {
    mocks.openAndStabilize.mockResolvedValue({ page: fakePage(async () => Buffer.alloc(0)), meta: { steps: [], finalUrl: 'https://example.com/' } });
    mocks.collectViewport.mockRejectedValueOnce(timeoutError('page.evaluate'));
    expect(await failure(run(fakeBrowser()))).toMatchObject({ code: 'TIME_BUDGET_EXCEEDED', step: 'collect' });

    mocks.collectViewport.mockRejectedValueOnce(new Error('page.evaluate: Target page, context or browser has been closed'));
    expect(await failure(run(fakeBrowser()))).toMatchObject({ code: 'BROWSER_CRASH', step: 'collect' });
  });

  it('스크린샷 단계 TimeoutError는 viewport 실패가 아니다: screenshot null, SCREENSHOT_FAILED', async () => {
    mocks.openAndStabilize.mockResolvedValue({
      page: fakePage(async () => Promise.reject(timeoutError('page.screenshot'))),
      meta: { steps: [], finalUrl: 'https://example.com/' },
    });
    mocks.collectViewport.mockResolvedValue(site('desktop'));
    const result = await run(fakeBrowser());
    expect(result.screenshot).toBeNull();
    expect(result.collected).toEqual(site('desktop'));
    expect(result.screenshotError).toMatchObject({ code: 'SCREENSHOT_FAILED', step: 'screenshot' });
    expect((result.screenshotError?.cause as Error).name).toBe('TimeoutError');
  });
});

describe('toStepError', () => {
  it('어떤 오류도 INTERNAL_ERROR "Unexpected error"로 남기지 않고 단계 이름과 원래 종류를 남긴다', () => {
    const error = toStepError(new TypeError('x is not a function'), 'collect', 'DETECTION_FAILED');
    expect(error).toMatchObject({ code: 'DETECTION_FAILED', step: 'collect', message: 'collect failed (TypeError)' });
    expect(toStepError(new Error('Browser closed'), 'context', 'BROWSER_CRASH').code).toBe('BROWSER_CRASH');
    expect(toStepError('boom', 'screenshot', 'SCREENSHOT_FAILED').message).toBe('screenshot failed (string)');
  });

  it('이미 단계가 있으면 바꾸지 않는다', () => {
    const inner = new InspectionError('HTTP_ERROR', 'HTTP 403', { step: 'goto' });
    expect(toStepError(inner, 'open-and-stabilize', 'INTERNAL_ERROR').step).toBe('goto');
  });
});
