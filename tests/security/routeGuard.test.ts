import type { BrowserContext } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createViewportContext } from '@/server/browser/devices';
import { launchBrowser, type LaunchedBrowser } from '@/server/browser/launch';
import { openAndStabilize } from '@/server/browser/stabilize';
import { InspectionError } from '@/server/errors';
import { getRouteGuard, type BlockedRequest, type RouteGuard } from '@/server/security/routeGuard';
import { createHostChecker, type LookupFn } from '@/server/security/ssrf';
import { start, type FixtureServer } from '../fixtures/server';

// T08 통합 테스트: 로컬 브라우저로 routeGuard가 실제 요청을 막는지 확인한다 (PRD 5.1, 8.6).
// 실행: pnpm test:security
//
// 새어 나간 요청은 Fixture 서버의 요청 기록으로 확인한다. 테스트 페이지는 같은 서버를 금지 호스트 이름 localhost로 부른다
// (허용 목록은 127.0.0.1뿐). 기록에 /__secret이 있으면 차단에 실패한 것이다.

/** 가짜 DNS: evil.test → 10.0.0.1. 그 밖의 이름은 조회 실패 */
const fakeLookup: LookupFn = async (hostname) => {
  if (hostname === 'evil.test') return [{ address: '10.0.0.1', family: 4 }];
  throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
};

let server: FixtureServer;
/** 테스트마다 새 브라우저 1개, context 1개 (AGENTS.md 7장: 브라우저 하나에 context를 여러 개 만들지 않는다) */
let current: LaunchedBrowser | undefined;

beforeAll(async () => {
  server = await start({ securityRoutes: true });
}, 60_000);

afterAll(async () => {
  await current?.close();
  await server?.close();
});

async function freshBrowser(): Promise<LaunchedBrowser> {
  await current?.close();
  current = await launchBrowser();
  return current;
}

async function newContext(): Promise<{ context: BrowserContext; guard: RouteGuard }> {
  const { browser } = await freshBrowser();
  server.requests.length = 0;
  const checker = createHostChecker({ lookup: fakeLookup, allowHosts: [new URL(server.baseUrl).hostname] });
  const context = await createViewportContext(browser, 'desktop', { checker });
  const guard = getRouteGuard(context);
  if (!guard) throw new Error('guard not attached');
  return { context, guard };
}

const leaked = () => server.requests.filter((path) => path.startsWith('/__secret'));
const hosts = (blocked: readonly BlockedRequest[]) => blocked.map((b) => `${b.host} ${b.reason}${b.viaRedirect ? ' redirect' : ''}${b.topLevel ? ' top' : ''}`);
const redirect = (to: string) => `/__redirect?to=${encodeURIComponent(to)}`;
const secret = (tag: string) => `http://localhost:${new URL(server.baseUrl).port}/__secret?${tag}`;

async function expectBlockedTarget(promise: Promise<unknown>): Promise<InspectionError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(InspectionError);
  expect((error as InspectionError).code).toBe('BLOCKED_TARGET');
  return error as InspectionError;
}

describe('메인 프레임', () => {
  it('리다이렉트로 내부 주소에 닿으면 BLOCKED_TARGET이고, 대상에 연결하지 않는다', async () => {
    const { context, guard } = await newContext();
    await expectBlockedTarget(openAndStabilize(context, `${server.baseUrl}${redirect('http://10.0.0.1/')}`));
    expect(guard.topLevelBlock).toMatchObject({ host: '10.0.0.1', reason: 'blocked-ip', viaRedirect: true, topLevel: true });

    const second = await newContext();
    await expectBlockedTarget(openAndStabilize(second.context, `${server.baseUrl}${redirect(secret('main'))}`));
    expect(second.guard.topLevelBlock).toMatchObject({ host: 'localhost', reason: 'blocked-hostname', viaRedirect: true });
    expect(leaked()).toEqual([]);
  }, 30_000);

  it('허용된 hop을 거친 뒤의 리다이렉트도 hop마다 검사한다 (A → B → 금지 대상)', async () => {
    const { context, guard } = await newContext();
    const chain = redirect(redirect(redirect(secret('chain'))));
    await expectBlockedTarget(openAndStabilize(context, `${server.baseUrl}${chain}`));
    expect(guard.topLevelBlock).toMatchObject({ host: 'localhost', viaRedirect: true });
    expect(leaked()).toEqual([]);
    // 앞의 두 hop은 실제로 요청했다
    expect(server.requests.filter((p) => p.startsWith('/__redirect'))).toHaveLength(3);
  }, 30_000);

  it('가짜 DNS로 내부 주소를 가리키는 호스트도 차단한다 (evil.test → 10.0.0.1)', async () => {
    const { context, guard } = await newContext();
    await expectBlockedTarget(openAndStabilize(context, `${server.baseUrl}${redirect('http://evil.test/')}`));
    expect(guard.topLevelBlock).toMatchObject({ host: 'evil.test', reason: 'blocked-ip' });
  }, 30_000);

  it('허용된 리다이렉트(301, 302, 307, 308)는 따라가고 최종 URL 기준으로 상대 경로를 푼다', async () => {
    for (const status of [301, 302, 307, 308]) {
      const { context, guard } = await newContext();
      const { page, meta } = await openAndStabilize(context, `${server.baseUrl}/__redirect?status=${status}&to=${encodeURIComponent('/__security/ok')}`);
      expect(meta.finalUrl).toBe(`${server.baseUrl}/__security/ok`);
      expect(meta.httpStatus).toBe(200);
      expect(await page.textContent('#ok')).toBe('OK');
      // 상대 경로 이미지가 최종 URL 기준으로 요청되었다
      expect(server.requests).toContain('/__security/relative.png');
      expect(guard.blocked).toEqual([]);
    }
  }, 60_000);

  it('리다이렉트로 data: 스킴에 가면 차단한다', async () => {
    const { context, guard } = await newContext();
    await expectBlockedTarget(openAndStabilize(context, `${server.baseUrl}${redirect('data:text/html,<p>x</p>')}`));
    expect(guard.topLevelBlock).toMatchObject({ host: 'data:', reason: 'scheme', viaRedirect: true });
  }, 30_000);

  it('최상위 data:, file: 탐색은 goto 전에 차단한다', async () => {
    for (const url of ['data:text/html,<p>x</p>', 'file:///etc/passwd']) {
      const { context, guard } = await newContext();
      await expectBlockedTarget(openAndStabilize(context, url));
      expect(guard.topLevelBlock).toMatchObject({ reason: 'scheme', topLevel: true });
    }
  }, 30_000);

  it('스크립트의 blob: 최상위 탐색은 탐색 이벤트로 감지해 BLOCKED_TARGET', async () => {
    const { context, guard } = await newContext();
    await expectBlockedTarget(openAndStabilize(context, `${server.baseUrl}/__security/blob`));
    expect(guard.topLevelBlock).toMatchObject({ host: 'blob:', reason: 'scheme', topLevel: true });
  }, 30_000);

  it('스크립트의 data: 최상위 탐색은 Chromium이 막고 페이지가 그대로 남는다', async () => {
    const { context, guard } = await newContext();
    const { page } = await openAndStabilize(context, `${server.baseUrl}/__security/js-data`);
    expect(page.url()).toBe(`${server.baseUrl}/__security/js-data`);
    expect(await page.$('#data')).toBeNull();
    expect(guard.topLevelBlock).toBeNull();
  }, 30_000);

  it('로드 뒤 스크립트가 메인 프레임을 금지 대상으로 옮기려 하면 BLOCKED_TARGET', async () => {
    const { context, guard } = await newContext();
    await expectBlockedTarget(openAndStabilize(context, `${server.baseUrl}/__security/js-redirect`));
    expect(guard.topLevelBlock).toMatchObject({ host: 'localhost', viaRedirect: true, topLevel: true });
    expect(leaked()).toEqual([]);
  }, 30_000);
});

describe('하위 요청', () => {
  it('하위 리소스의 내부 주소 요청은 기록하고 연결하지 않는다 (대기 없이 끝난다)', async () => {
    const { context, guard } = await newContext();
    const started = Date.now();
    const { meta } = await openAndStabilize(context, `${server.baseUrl}/__security/subresources`);
    const elapsed = Date.now() - started;
    expect(meta.httpStatus).toBe(200);
    expect(guard.topLevelBlock).toBeNull();
    expect(hosts(guard.blocked).sort()).toEqual(
      [
        '10.0.0.1 blocked-ip',
        '169.254.169.254 blocked-ip',
        'evil.test blocked-ip',
        'localhost blocked-hostname',
        'localhost blocked-hostname redirect',
        'localhost blocked-hostname redirect',
      ].sort(),
    );
    expect(leaked()).toEqual([]);
    // 10.0.0.1에 실제로 연결을 시도했다면 연결 시간 초과까지 기다렸을 것이다
    expect(meta.steps.find((s) => s.step === 'networkidle')?.outcome).toBe('completed');
    expect(elapsed).toBeLessThan(5_000);
  }, 30_000);

  it('iframe이 리다이렉트로 내부 주소에 닿으려 하면 차단한다. 허용된 iframe 리다이렉트는 따라간다', async () => {
    const { context, guard } = await newContext();
    const { page } = await openAndStabilize(context, `${server.baseUrl}/__security/iframe`);
    expect(guard.topLevelBlock).toBeNull();
    expect(hosts(guard.blocked).sort()).toEqual(['169.254.169.254 blocked-ip', 'localhost blocked-hostname redirect']);
    expect(leaked()).toEqual([]);
    // iframe은 Node에서 따라간 최종 응답을 원래 요청에 fulfill하므로 frame URL은 첫 URL(/__redirect…)로 남는다
    const allowed = page.frame({ url: (url) => url.href.includes(encodeURIComponent('/__security/ok')) });
    expect(await allowed?.textContent('#ok')).toBe('OK');
  }, 30_000);

  it('WebSocket 연결은 서버에 닿지 않고 닫힌다', async () => {
    const { context, guard } = await newContext();
    const { page } = await openAndStabilize(context, `${server.baseUrl}/__security/websocket`);
    expect(await page.title()).toBe('closed 1008');
    expect(hosts(guard.blocked)).toEqual(['127.0.0.1 websocket']);
    expect(server.requests.filter((p) => p.startsWith('UPGRADE'))).toEqual([]);
  }, 30_000);

  it('window.open으로 연 팝업의 내부 주소 요청도 차단한다 (최상위 문서 차단은 아니다)', async () => {
    const { context, guard } = await newContext();
    await openAndStabilize(context, `${server.baseUrl}/__security/popup`);
    expect(guard.topLevelBlock).toBeNull();
    expect(hosts(guard.blocked).sort()).toEqual(['10.0.0.1 blocked-ip', 'localhost blocked-hostname redirect']);
    expect(leaked()).toEqual([]);
  }, 30_000);

  it('차단 기록에는 호스트만 남는다 (경로, 쿼리 없음)', async () => {
    const { context, guard } = await newContext();
    await openAndStabilize(context, `${server.baseUrl}/__security/subresources`);
    for (const entry of guard.blocked) {
      expect(entry.host).not.toMatch(/[/?#]/);
      expect(JSON.stringify(entry)).not.toContain('__secret');
    }
  }, 30_000);
});

describe('media와 네트워크 오류', () => {
  it('video, audio 요청은 서버에 닿지 않는다 (PRD 8.6 메모리 보호)', async () => {
    const { context, guard } = await newContext();
    const { page } = await openAndStabilize(context, `${server.baseUrl}/__security/media`);
    expect(await page.textContent('p')).toBe('media');
    expect(server.requests.filter((p) => p.startsWith('/__security/clip'))).toEqual([]);
    // 금지 대상이 아니므로 차단 기록에는 남기지 않는다
    expect(guard.blocked).toEqual([]);
  }, 30_000);

  it('검사 중 DNS 조회 실패는 NAVIGATION_FAILED (BLOCKED_TARGET 아님)', async () => {
    const { context, guard } = await newContext();
    const error = await openAndStabilize(context, 'http://nowhere.test/').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InspectionError);
    expect((error as InspectionError).code).toBe('NAVIGATION_FAILED');
    expect((error as InspectionError).message).toContain('net::ERR_NAME_NOT_RESOLVED');
    expect(guard.topLevelBlock).toBeNull();
  }, 30_000);

  it('연결 거부는 NAVIGATION_FAILED이고 오류 종류를 메시지에 담는다', async () => {
    const { context } = await newContext();
    // 허용된 호스트(127.0.0.1)의 닫힌 포트
    const error = await openAndStabilize(context, 'http://127.0.0.1:1/').catch((e: unknown) => e);
    expect((error as InspectionError).code).toBe('NAVIGATION_FAILED');
    expect((error as InspectionError).message).toContain('net::ERR_CONNECTION_REFUSED');
  }, 30_000);
});

describe('연결', () => {
  it('guard가 없는 context는 openAndStabilize가 거부한다', async () => {
    const { browser } = await freshBrowser();
    const bare = await browser.newContext();
    const error = await openAndStabilize(bare, `${server.baseUrl}/__security/ok`).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InspectionError);
    expect((error as InspectionError).code).toBe('INTERNAL_ERROR');
  });
});
