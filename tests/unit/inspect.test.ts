import type { Browser } from 'playwright-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectedViewport } from '@/server/collect/types';
import { InspectionError } from '@/server/errors';
import type { LaunchedBrowser } from '@/server/browser/launch';
import type { RenderedViewport } from '@/server/browser/render';
import {
  ANALYZE_CALL_ATTEMPTS,
  AnalyzeCallTimeout,
  INSPECTION_TIME_BUDGET_MS,
  MOBILE_RESERVE_MS,
  resolveInternalOrigin,
  describeAnalyzeResponse,
  runInspection,
  viewportTimeLimit,
  type InspectionDeps,
} from '@/server/inspect';
import { createHostChecker } from '@/server/security/ssrf';
import { assertInspectionInvariants } from '@/server/store/invariants';
import { createInspectionStore, RUNNING_SET_KEY, type InspectionStore } from '@/server/store/redis';
import type { Inspection, Viewport } from '@/types/inspection';
import { collected, el, r } from './helpers/collected';
import { FakeRedis } from './helpers/fakeRedis';
import { ID, pendingDoc, T0 } from './helpers/inspection';
import { site } from './helpers/site';

// T09: runInspection 상태 전이, step 순서, viewport 실패, 시간 상한, finally (PRD 6.2, 8.1.2, 8.1.3, DOMAIN_MODEL 4)

const SHOTS = {
  desktop: { screenshotWidth: 1440, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false },
  mobile: { screenshotWidth: 616, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false },
} as const;

let now: number;
let redis: FakeRedis;
let saves: Inspection[];
let browserClose: ReturnType<typeof vi.fn<() => Promise<"closed" | "killed">>>;

function rendered(viewport: Viewport, data: CollectedViewport = site(viewport)): RenderedViewport {
  return {
    collected: data,
    screenshot: { ...SHOTS[viewport], png: Buffer.from(`png-${viewport}`), mode: 'full', failedAttempts: 0 },
    screenshotError: null,
    finalUrl: `https://www.example.com/?from=${viewport}`,
    timings: { gotoMs: 100 },
  };
}

/** 저장할 때마다 문서를 기록하고 불변 조건을 확인하는 저장소 (운영 코드에서는 불변 조건을 호출하지 않는다) */
function recordingStore(): InspectionStore {
  const inner = createInspectionStore(redis, { now: () => now });
  return {
    ...inner,
    async save(doc, options) {
      const saved = await inner.save(doc, options);
      saves.push(saved);
      assertInspectionInvariants(saved, saved.status === 'completed' || saved.status === 'partial' ? 'final' : 'browser');
      return saved;
    },
  };
}

function makeDeps(overrides: Partial<InspectionDeps> = {}): InspectionDeps {
  return {
    store: recordingStore(),
    screenshots: { upload: vi.fn(async (id: string, v: Viewport) => `https://blob.example/inspections/${id}/${v}-full-abc.png`) },
    launchBrowser: vi.fn(async (): Promise<LaunchedBrowser> => ({ browser: {} as Browser, launchMs: 0, close: browserClose })),
    renderViewport: vi.fn(async (_b: Browser, v: Viewport) => rendered(v)),
    createChecker: () => createHostChecker({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }),
    triggerAnalyze: vi.fn(async () => undefined),
    now: () => now,
    log: () => undefined,
    ...overrides,
  };
}

async function setup(max = 2) {
  const store = createInspectionStore(redis, { now: () => now });
  await store.create(pendingDoc());
  expect(await store.acquireSlot(ID, max)).toBe(true);
}

const slotHeld = () => redis.zsets.get(RUNNING_SET_KEY)?.has(ID) ?? false;
const last = () => saves[saves.length - 1];

beforeEach(async () => {
  now = T0;
  redis = new FakeRedis(() => now);
  saves = [];
  browserClose = vi.fn(async () => 'closed' as const);
  await setup();
});

describe('runInspection: 정상 흐름', () => {
  it('pending → running → analyzing. step을 PRD 6.2.3 순서로 저장하고 analyze를 호출한다', async () => {
    const deps = makeDeps();
    await runInspection(ID, deps);

    expect(saves.map((d) => `${d.status}:${d.step}`)).toEqual([
      'running:initializing_browser',
      'running:rendering_desktop',
      'running:rendering_mobile',
      'running:detecting_issues',
      'running:saving_results',
      'analyzing:saving_results',
    ]);
    const doc = last();
    expect(doc.startedAt).toBe(new Date(T0).toISOString());
    expect(doc.finalUrl).toBe('https://www.example.com/?from=desktop');
    expect(doc.analysis).toEqual({ status: 'pending', analyzedIssueCount: 0 });
    expect(doc.issues.map((i) => i.id)).toEqual(['ISS-001', 'ISS-002', 'ISS-003']);
    expect(doc.issuesDetected).toBe(3);
    expect(doc.issuesTruncated).toBe(false);
    expect(doc.viewports.desktop?.screenshotUrl).toContain('/desktop-full-');
    expect(doc.viewports.mobile?.screenshotWidth).toBe(616);
    expect(doc.completedAt).toBeUndefined();

    // Desktop → Mobile 순서, 한 번에 하나씩
    expect(vi.mocked(deps.renderViewport).mock.calls.map((c) => c[1])).toEqual(['desktop', 'mobile']);
    expect(vi.mocked(deps.renderViewport).mock.calls[0][2]).toBe('https://example.com/');
    expect(deps.triggerAnalyze).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });

  it('이슈가 0개여도 analyzing으로 저장하고 analyze를 호출한다', async () => {
    const empty = (v: Viewport) => collected(v, [el({ index: 1, rect: r(0, 0, 100, 20) })]);
    const deps = makeDeps({ renderViewport: vi.fn(async (_b: Browser, v: Viewport) => rendered(v, empty(v))) });
    await runInspection(ID, deps);
    expect(last().status).toBe('analyzing');
    expect(last().issues).toEqual([]);
    expect(deps.triggerAnalyze).toHaveBeenCalledTimes(1);
  });

  it('pending이 아닌 문서는 검사하지 않지만 슬롯은 반환한다', async () => {
    await createInspectionStore(redis, { now: () => now }).save(pendingDoc({ status: 'running', step: 'initializing_browser', startedAt: new Date(T0).toISOString() }));
    const deps = makeDeps();
    await runInspection(ID, deps);
    expect(deps.launchBrowser).not.toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });
});

describe('runInspection: viewport 실패', () => {
  it('Mobile이 실패해도 Desktop 결과로 analyzing. 실패 코드는 InspectionError의 코드', async () => {
    const deps = makeDeps({
      renderViewport: vi.fn(async (_b: Browser, v: Viewport) => {
        if (v === 'mobile') throw new InspectionError('NAVIGATION_TIMEOUT', 'Navigation timed out after 30000ms');
        return rendered(v);
      }),
    });
    await runInspection(ID, deps);
    const doc = last();
    expect(doc.status).toBe('analyzing');
    expect(doc.viewports.mobile).toBeNull();
    expect(doc.viewportErrors).toEqual({ desktop: null, mobile: { code: 'NAVIGATION_TIMEOUT', message: 'Navigation timed out after 30000ms' } });
    // S-3, S-4: 실패한 viewport의 occurrence가 없고 viewportTag는 null
    expect(doc.issues.every((i) => i.viewports.join() === 'desktop' && i.viewportTag === null)).toBe(true);
    expect(deps.triggerAnalyze).toHaveBeenCalledTimes(1);
  });

  it('Desktop이 실패하면 finalUrl은 Mobile의 최종 URL. 알 수 없는 예외는 INTERNAL_ERROR', async () => {
    const deps = makeDeps({
      renderViewport: vi.fn(async (_b: Browser, v: Viewport) => {
        if (v === 'desktop') throw new Error('boom /internal/path');
        return rendered(v);
      }),
    });
    await runInspection(ID, deps);
    expect(last().finalUrl).toBe('https://www.example.com/?from=mobile');
    expect(last().viewportErrors.desktop).toEqual({ code: 'INTERNAL_ERROR', message: 'Unexpected error' });
  });

  it('두 viewport가 모두 실패하면 failed. error는 Desktop 오류이고 analyze를 호출하지 않는다', async () => {
    const deps = makeDeps({
      renderViewport: vi.fn(async (_b: Browser, v: Viewport) => {
        throw new InspectionError(v === 'desktop' ? 'HTTP_ERROR' : 'NAVIGATION_FAILED', v === 'desktop' ? 'HTTP 503' : 'Navigation failed: net::ERR_CONNECTION_REFUSED');
      }),
    });
    await runInspection(ID, deps);
    const doc = last();
    expect(doc.status).toBe('failed');
    expect(doc.error).toEqual({ code: 'HTTP_ERROR', message: 'HTTP 503' });
    expect(doc.viewportErrors.mobile?.code).toBe('NAVIGATION_FAILED');
    expect(doc.completedAt).toBe(new Date(T0).toISOString());
    expect(deps.triggerAnalyze).not.toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
    expect(browserClose).toHaveBeenCalled();
  });

  it('브라우저 실행 실패는 그 viewport의 BROWSER_CRASH. viewport마다 다시 실행하고, 둘 다 실패하면 failed (T13)', async () => {
    const deps = makeDeps({ launchBrowser: vi.fn(async () => { throw new Error('launch timed out'); }) });
    await runInspection(ID, deps);
    expect(deps.launchBrowser).toHaveBeenCalledTimes(2);
    expect(last().status).toBe('failed');
    expect(last().error?.code).toBe('BROWSER_CRASH');
    // viewport마다 실행하므로 실패도 viewport별로 남는다 (DOMAIN_MODEL I-5: 두 viewport 모두 오류)
    expect(last().viewportErrors.desktop?.code).toBe('BROWSER_CRASH');
    expect(last().viewportErrors.mobile?.code).toBe('BROWSER_CRASH');
    expect(deps.renderViewport).not.toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });

  it('Desktop 브라우저 실행만 실패하면 Mobile은 새 브라우저로 진행한다 (T13)', async () => {
    const launch = vi
      .fn<() => Promise<LaunchedBrowser>>()
      .mockRejectedValueOnce(new Error('launch timed out'))
      .mockResolvedValueOnce({ browser: {} as Browser, launchMs: 0, close: browserClose });
    const deps = makeDeps({ launchBrowser: launch });
    await runInspection(ID, deps);
    expect(last().status).toBe('analyzing');
    expect(last().viewportErrors.desktop?.code).toBe('BROWSER_CRASH');
    expect(last().viewports.mobile).not.toBeNull();
  });

  it('한 viewport의 데이터로 탐지가 실패하면 그 viewport만 DETECTION_FAILED', async () => {
    // Desktop 자리에 Mobile 데이터 → buildIssues가 예외를 던진다
    const deps = makeDeps({ renderViewport: vi.fn(async (_b: Browser, v: Viewport) => (v === 'desktop' ? rendered(v, site('mobile')) : rendered(v))) });
    await runInspection(ID, deps);
    expect(last().status).toBe('analyzing');
    expect(last().viewportErrors.desktop?.code).toBe('DETECTION_FAILED');
    expect(last().viewports.mobile).not.toBeNull();
    expect(deps.screenshots.upload).toHaveBeenCalledTimes(1);
  });

  it('스크린샷 업로드가 실패한 viewport는 STORAGE_FAILED. screenshotUrl 없는 결과를 만들지 않고 이슈를 다시 만든다', async () => {
    const deps = makeDeps({
      screenshots: {
        upload: vi.fn(async (id: string, v: Viewport) => {
          if (v === 'mobile') throw new InspectionError('STORAGE_FAILED', 'Screenshot upload failed (mobile)');
          return `https://blob.example/${id}/${v}.png`;
        }),
      },
    });
    await runInspection(ID, deps);
    const doc = last();
    expect(doc.status).toBe('analyzing');
    expect(doc.viewports.mobile).toBeNull();
    expect(doc.viewportErrors.mobile?.code).toBe('STORAGE_FAILED');
    expect(doc.issues.every((i) => !i.viewports.includes('mobile') && i.viewportTag === null)).toBe(true);
  });
});

describe('runInspection: 시간 예산 (PRD 8.1.3)', () => {
  it('상한을 넘기면 끝내지 못한 viewport에 TIME_BUDGET_EXCEEDED를 기록하고 얻은 결과로 진행한다', async () => {
    const deps = makeDeps({
      renderViewport: vi.fn(async (_b: Browser, v: Viewport, _u: string, options: { timeLimitMs: number }) => {
        expect(options.timeLimitMs).toBe(INSPECTION_TIME_BUDGET_MS - MOBILE_RESERVE_MS);
        now = T0 + INSPECTION_TIME_BUDGET_MS; // Desktop이 예산을 다 썼다(Mobile 몫까지 넘김)
        return rendered(v);
      }),
    });
    await runInspection(ID, deps);
    expect(vi.mocked(deps.renderViewport)).toHaveBeenCalledTimes(1);
    const doc = last();
    expect(doc.status).toBe('analyzing');
    expect(doc.viewportErrors.mobile?.code).toBe('TIME_BUDGET_EXCEEDED');
    expect(doc.viewports.desktop).not.toBeNull();
    // Mobile은 렌더링하지 않았으므로 rendering_mobile 단계가 없다
    expect(saves.map((d) => d.step)).not.toContain('rendering_mobile');
  });

  it('Desktop에는 Mobile 몫을 뺀 시간, Mobile에는 남은 시간을 넘긴다', async () => {
    const deps = makeDeps({
      renderViewport: vi.fn(async (_b: Browser, v: Viewport) => {
        now += 100_000;
        return rendered(v);
      }),
    });
    await runInspection(ID, deps);
    const limits = vi.mocked(deps.renderViewport).mock.calls.map((c) => c[3].timeLimitMs);
    expect(limits).toEqual([INSPECTION_TIME_BUDGET_MS - MOBILE_RESERVE_MS, INSPECTION_TIME_BUDGET_MS - 100_000]);
  });

  it('Desktop이 받은 시간을 모두 써도 Mobile 몫이 남고, 두 viewport 합계가 전체 상한을 넘지 않는다', async () => {
    const deps = makeDeps({
      renderViewport: vi.fn(async (_b: Browser, v: Viewport, _u: string, options: { timeLimitMs: number }) => {
        now += options.timeLimitMs; // 받은 시간을 모두 쓴다
        return rendered(v);
      }),
    });
    await runInspection(ID, deps);
    const limits = vi.mocked(deps.renderViewport).mock.calls.map((c) => c[3].timeLimitMs);
    expect(limits).toHaveLength(2);
    expect(limits[1]).toBeGreaterThanOrEqual(MOBILE_RESERVE_MS);
    expect(limits[0]! + limits[1]!).toBeLessThanOrEqual(INSPECTION_TIME_BUDGET_MS);
    expect(last().viewports.mobile).not.toBeNull();
  });

  it('viewportTimeLimit: 남은 시간이 Mobile 몫보다 적으면 Desktop이 남은 시간을 쓴다', () => {
    expect(viewportTimeLimit('desktop', 180_000)).toBe(180_000 - MOBILE_RESERVE_MS);
    expect(viewportTimeLimit('desktop', MOBILE_RESERVE_MS)).toBe(MOBILE_RESERVE_MS);
    expect(viewportTimeLimit('mobile', 70_000)).toBe(70_000);
  });

  it('남은 시간 안에 끝나지 않는 viewport는 오케스트레이터가 끊는다', async () => {
    vi.useFakeTimers();
    try {
      const deps = makeDeps({
        renderViewport: vi.fn((_b: Browser, v: Viewport) => (v === 'desktop' ? new Promise<RenderedViewport>(() => undefined) : Promise.resolve(rendered(v)))),
      });
      const done = runInspection(ID, deps);
      await vi.advanceTimersByTimeAsync(INSPECTION_TIME_BUDGET_MS + 10_000);
      await done;
      expect(last().viewportErrors.desktop?.code).toBe('TIME_BUDGET_EXCEEDED');
      expect(last().status).toBe('analyzing');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runInspection: 스크린샷만 실패한 viewport (PRD 5.2.4, T14)', () => {
  it('viewport 실패가 아니다: 결과는 남고 screenshotUrl = null, cropRect는 모두 null, 업로드하지 않는다', async () => {
    const logs: [string, unknown][] = [];
    const deps = makeDeps({
      log: (event, fields) => void logs.push([event, fields]),
      renderViewport: vi.fn(async (_b: Browser, v: Viewport) =>
        v === 'desktop'
          ? { ...rendered(v), screenshot: null, screenshotError: new InspectionError('SCREENSHOT_FAILED', 'Screenshot failed', { step: 'screenshot' }) }
          : rendered(v),
      ),
    });
    await runInspection(ID, deps);
    const doc = last();
    expect(doc.status).toBe('analyzing');
    expect(doc.viewportErrors.desktop).toBeNull();
    expect(doc.viewports.desktop).toMatchObject({ screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false });
    expect(doc.viewports.mobile?.screenshotUrl).not.toBeNull();
    expect(vi.mocked(deps.screenshots.upload).mock.calls.map((c) => c[1])).toEqual(['mobile']);
    const desktopOccurrences = doc.issues.flatMap((i) => i.occurrences).filter((o) => o.viewport === 'desktop');
    expect(desktopOccurrences.length).toBeGreaterThan(0);
    expect(desktopOccurrences.every((o) => o.cropRect === null)).toBe(true);
    expect(logs.some(([event]) => event === 'screenshot-missing')).toBe(true);
  });
});

describe('runInspection: 저장과 analyze 호출 실패', () => {
  it('analyze 호출이 1회 실패하면 재시도한다', async () => {
    const trigger = vi.fn().mockRejectedValueOnce(new Error('502')).mockResolvedValueOnce(undefined);
    await runInspection(ID, makeDeps({ triggerAnalyze: trigger }));
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(last().status).toBe('analyzing');
  });

  it('확실한 실패가 두 번이면 partial + analysis.failed(AI_FAILED). 브라우저 결과는 남는다', async () => {
    const trigger = vi.fn(async () => { throw new Error('401'); });
    await runInspection(ID, makeDeps({ triggerAnalyze: trigger }));
    expect(trigger).toHaveBeenCalledTimes(ANALYZE_CALL_ATTEMPTS);
    const doc = last();
    expect(doc.status).toBe('partial');
    expect(doc.analysis.status).toBe('failed');
    expect(doc.analysis.error?.code).toBe('AI_FAILED');
    expect(doc.issues).toHaveLength(3);
    expect(doc.viewports.desktop).not.toBeNull();
    expect(doc.completedAt).toBeDefined();
  });

  it('시간 초과는 다시 시도하지 않고 문서를 쓰지 않는다 (멈춘 검사 처리에 맡긴다)', async () => {
    const trigger = vi.fn(async () => { throw new AnalyzeCallTimeout(); });
    await runInspection(ID, makeDeps({ triggerAnalyze: trigger }));
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(last().status).toBe('analyzing');
    expect(last().analysis.status).toBe('pending');
  });

  it('확실한 실패 뒤 재시도가 시간 초과면 partial을 쓰지 않는다', async () => {
    const trigger = vi.fn().mockRejectedValueOnce(new InspectionError('INTERNAL_ERROR', 'Analyze call returned 502')).mockRejectedValueOnce(new AnalyzeCallTimeout());
    await runInspection(ID, makeDeps({ triggerAnalyze: trigger }));
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(last().status).toBe('analyzing');
  });

  it('step 저장 실패는 검사를 멈추지 않는다', async () => {
    const deps = makeDeps();
    redis.failNext = { command: 'set', error: new Error('network') }; // running:initializing_browser 저장 실패
    await runInspection(ID, deps);
    expect(last().status).toBe('analyzing');
  });

  it('마지막 결과 저장이 실패하면 STORAGE_FAILED로 failed를 한 번 더 저장한다', async () => {
    const store = recordingStore();
    let failed = false;
    const deps = makeDeps({
      store: {
        ...store,
        async save(doc) {
          if (doc.status === 'analyzing' && !failed) {
            failed = true;
            throw new InspectionError('STORAGE_FAILED', 'Redis save failed');
          }
          return store.save(doc);
        },
      },
    });
    await runInspection(ID, deps);
    expect(last().status).toBe('failed');
    expect(last().error?.code).toBe('STORAGE_FAILED');
    expect(deps.triggerAnalyze).not.toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });

  it('읽기부터 실패해도 슬롯을 반환한다', async () => {
    const deps = makeDeps();
    deps.store = { ...deps.store, read: async () => { throw new Error('read exploded'); } };
    await runInspection(ID, deps);
    expect(slotHeld()).toBe(false);
  });

  it('브라우저 실행 뒤 예상하지 못한 오류: failed + INTERNAL_ERROR, finally에서 브라우저 종료와 슬롯 반환', async () => {
    const deps = makeDeps({
      log: (event) => {
        if (event === 'launch') throw new Error('unexpected');
      },
    });
    await runInspection(ID, deps);
    expect(last().status).toBe('failed');
    expect(last().error?.code).toBe('INTERNAL_ERROR');
    expect(browserClose).toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });
});

describe('resolveInternalOrigin (PRD 8.1.2)', () => {
  it('1순위는 요청 origin, 알 수 없을 때만 VERCEL_URL', () => {
    expect(resolveInternalOrigin('https://web-inspector.example', 'web-inspector-abc.vercel.app')).toBe('https://web-inspector.example');
    expect(resolveInternalOrigin('http://localhost:3000', undefined)).toBe('http://localhost:3000');
    expect(resolveInternalOrigin(undefined, 'web-inspector-abc.vercel.app')).toBe('https://web-inspector-abc.vercel.app');
    expect(() => resolveInternalOrigin(undefined, undefined)).toThrow(InspectionError);
  });
});

describe('runInspection: 검사 중지 (POST /api/inspections/:id/cancel)', () => {
  it('시작 전에 중지 요청이 있으면 아무것도 저장하지 않고 브라우저를 띄우지 않는다. 슬롯은 반환한다', async () => {
    await createInspectionStore(redis, { now: () => now }).requestCancel(ID);
    const deps = makeDeps();
    await runInspection(ID, deps);
    expect(saves).toEqual([]);
    expect(deps.launchBrowser).not.toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });

  it('렌더링 중 중지 요청을 보면 브라우저를 닫아 멈추고, 중지 API가 저장한 문서를 덮어쓰지 않는다', async () => {
    const store = createInspectionStore(redis, { now: () => now });
    let closed: () => void = () => undefined;
    const closedPromise = new Promise<void>((resolve) => (closed = resolve));
    browserClose = vi.fn(async () => {
      closed();
      return 'closed' as const;
    });
    const deps = makeDeps({
      cancelPollMs: 5,
      // 브라우저가 닫힐 때까지 끝나지 않는 렌더링 (production에서 멈춘 Mobile viewport와 같은 상황)
      renderViewport: vi.fn(async () => {
        await closedPromise;
        throw new Error('Target page, context or browser has been closed');
      }),
    });
    const running = runInspection(ID, deps);
    // 중지 API와 같은 순서: 표시 → 다시 읽기 → failed(CANCELLED) 저장
    await vi.waitFor(() => expect(saves.some((d) => d.step === 'rendering_desktop')).toBe(true));
    await store.requestCancel(ID);
    const current = await store.read(ID);
    await store.save({ ...current!, status: 'failed', error: { code: 'CANCELLED', message: 'Cancelled by user' }, completedAt: new Date(now).toISOString() });
    await running;

    expect(browserClose).toHaveBeenCalled();
    expect(vi.mocked(deps.renderViewport)).toHaveBeenCalledTimes(1);
    expect(saves.every((d) => d.status === 'running')).toBe(true);
    const doc = await store.read(ID);
    expect(doc?.status).toBe('failed');
    expect(doc?.error?.code).toBe('CANCELLED');
    expect(deps.triggerAnalyze).not.toHaveBeenCalled();
    expect(slotHeld()).toBe(false);
  });
});

describe('describeAnalyzeResponse (analyze 호출 실패 로그)', () => {
  const call = { host: 'web-inspector.vercel.app', bypass: false };
  it('호출 호스트, bypass 여부, 리다이렉트 호스트, route 여부를 남긴다', () => {
    const redirect = new Response(null, { status: 302, headers: { location: 'https://vercel.com/sso-api?url=secret-path' } });
    expect(describeAnalyzeResponse(redirect, call)).toBe('302 host=web-inspector.vercel.app bypass=false location=vercel.com redirected=false matched=none');
    const page = new Response('<html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    expect(describeAnalyzeResponse(page, { ...call, bypass: true })).toBe('200 host=web-inspector.vercel.app bypass=true redirected=false matched=none type=text/html');
    const route = new Response('{}', { status: 409, headers: { 'content-type': 'application/json', 'x-matched-path': '/api/inspections/[id]/analyze' } });
    expect(describeAnalyzeResponse(route, call)).toBe(
      '409 host=web-inspector.vercel.app bypass=false redirected=false matched=/api/inspections/[id]/analyze type=application/json',
    );
    expect(describeAnalyzeResponse(new Response(null, { status: 308, headers: { location: '/next' } }), call)).toContain('location=relative');
  });
});
