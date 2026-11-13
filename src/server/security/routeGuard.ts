import 'server-only';
import type { APIResponse, BrowserContext, Frame, Page, Request, Response, Route } from 'playwright-core';
import { isLookupFailure, normalizeHostname, type HostBlockReason, type HostChecker } from './ssrf';

// PRD 8.6: 검사 중 브라우저의 모든 요청을 검사한다. context.route에 연결해 팝업과 새 페이지까지 포함한다.
//
// 리다이렉트 (T08 확인, playwright-core 1.63):
// - route.continue()로 보내면 리다이렉트의 다음 URL은 route 핸들러를 다시 거치지 않는다(문서의 주의 사항과 같다).
// - route.fetch({ maxRedirects: 0 })로 받은 3xx를 그대로 fulfill해도, 브라우저가 따라가는 다음 요청은 가로채지지 않는다.
// 그래서 리다이렉트는 브라우저에 넘기지 않고 Node에서 hop마다 호스트를 검사하며 따라간다(followRedirects).
// - 검사 대상 page의 메인 프레임(guard.goto 중): 3xx의 다음 URL을 검사한 뒤 요청을 중단하고, guard.goto가 그 URL로 다시 goto한다.
//   브라우저의 문서 URL이 최종 URL과 같아야 상대 경로 리소스가 올바르게 풀리기 때문이다.
// - 그 밖의 요청(iframe, 팝업, 하위 리소스): Node에서 끝까지 따라간 최종 응답을 원래 요청에 fulfill한다.

/** Chromium의 리다이렉트 상한과 같다 */
export const MAX_REDIRECTS = 20;
/** PRD 8.6: route.fetch 1회의 시간 제한. 전체 상한은 goto 시간 제한(PRD 8.1.3)이다 */
export const ROUTE_FETCH_TIMEOUT_MS = 15_000;

/**
 * 리다이렉트를 Node에서 검사하며 따라갈 요청 범위. 'all'은 하위 리소스까지 포함한다.
 * T08 측정(보고서)으로 정한 값이다. 'documents'로 바꾸면 하위 리소스의 리다이렉트 대상은 검사하지 않는다.
 */
export const REDIRECT_CHECK_SCOPE: 'all' | 'documents' = 'all';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);
/** 탐색 실패나 빈 페이지일 때 Chromium이 쓰는 내부 URL. 차단 대상이 아니다 */
const BENIGN_NAVIGATION_URLS = ['about:blank', 'chrome-error://chromewebdata/'];

export type GuardBlockReason = HostBlockReason | 'scheme' | 'websocket';

/** 차단 기록. 호스트만 남긴다(전체 URL, 쿼리 문자열을 남기지 않는다, AGENTS.md 8장) */
export interface BlockedRequest {
  /** 호스트 이름. 호스트가 없는 스킴(data:, blob:, file:)은 스킴 이름 (예: "data:") */
  host: string;
  reason: GuardBlockReason;
  resourceType: string;
  /** 검사 대상 page의 최상위 문서였는지 (PRD 5.1: BLOCKED_TARGET으로 실패 처리) */
  topLevel: boolean;
  /** 리다이렉트를 따라가다 막혔는지 */
  viaRedirect: boolean;
}

export interface RouteGuardOptions {
  checker: HostChecker;
  /** 로깅용. 호스트만 담긴다 */
  onBlocked?: (blocked: BlockedRequest) => void;
}

export interface GuardedNavigation {
  response: Response | null;
  /** 메인 프레임이 따라간 리다이렉트 수 */
  redirects: number;
}

export interface RouteGuard {
  readonly blocked: readonly BlockedRequest[];
  /** 검사 대상 page의 최상위 문서가 차단되었으면 그 기록 */
  readonly topLevelBlock: BlockedRequest | null;
  /**
   * 검사 대상 page를 url로 연다. 메인 프레임의 리다이렉트를 hop마다 검사하며 따라간다.
   * 최상위 문서가 차단되면 Playwright 오류(net::ERR_BLOCKED_BY_CLIENT)를 그대로 던진다. 호출한 쪽은 topLevelBlock을 먼저 확인한다.
   */
  goto(page: Page, url: string, options: { timeoutMs: number }): Promise<GuardedNavigation>;
}

const guards = new WeakMap<BrowserContext, RouteGuard>();

/** attachRouteGuard로 연결된 guard. 연결되지 않은 context면 null */
export function getRouteGuard(context: BrowserContext): RouteGuard | null {
  return guards.get(context) ?? null;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 기록용 호스트. 호스트가 없는 스킴은 스킴 이름만 남긴다 */
function hostLabel(url: URL | null): string {
  if (!url) return 'invalid';
  if (!ALLOWED_SCHEMES.has(url.protocol) && url.protocol !== 'ws:' && url.protocol !== 'wss:') return url.protocol;
  return normalizeHostname(url.hostname) ?? 'invalid';
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** 팝업의 첫 탐색 요청은 frame이 아직 없어 request.frame()이 예외를 던진다(T08 확인) */
function frameOf(request: Request): Frame | null {
  try {
    return request.frame();
  } catch {
    return null;
  }
}

/**
 * route.fetch 실패를 Chromium 오류 코드로 바꾼다. goto 쪽에서 net::ERR_* 이름으로 원인을 알 수 있게 하기 위해서다
 * (PRD 6.2.4 NAVIGATION_FAILED의 메시지). 순수 함수다.
 */
export function abortCodeForFetchError(error: unknown): 'connectionrefused' | 'connectionreset' | 'namenotresolved' | 'timedout' | 'failed' {
  const message = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED/.test(message)) return 'connectionrefused';
  if (/ECONNRESET|socket hang up/i.test(message)) return 'connectionreset';
  if (/ENOTFOUND|EAI_AGAIN/.test(message)) return 'namenotresolved';
  if (/Timeout|ETIMEDOUT/i.test(message)) return 'timedout';
  return 'failed';
}

type Verdict = { ok: true } | { ok: false; reason: GuardBlockReason; lookupFailure: boolean };

export async function attachRouteGuard(context: BrowserContext, options: RouteGuardOptions): Promise<RouteGuard> {
  if (guards.has(context)) throw new Error('Route guard is already attached to this context');
  const { checker, onBlocked } = options;
  const blocked: BlockedRequest[] = [];
  let topLevelBlock: BlockedRequest | null = null;
  /** guard.goto가 여는 검사 대상 page와, 그 탐색 중 중단한 리다이렉트의 다음 URL */
  let primaryPage: Page | null = null;
  let navigating = false;
  let pendingRedirect: string | null = null;

  const record = (entry: BlockedRequest) => {
    blocked.push(entry);
    if (entry.topLevel && !topLevelBlock) topLevelBlock = entry;
    onBlocked?.(entry);
  };

  const verdictFor = async (url: URL | null): Promise<Verdict> => {
    if (!url || !ALLOWED_SCHEMES.has(url.protocol)) return { ok: false, reason: 'scheme', lookupFailure: false };
    const result = await checker.check(url.hostname);
    if (result.allowed) return { ok: true };
    return { ok: false, reason: result.reason, lookupFailure: isLookupFailure(result) };
  };

  const isPrimaryMainFrame = (request: Request): boolean => {
    if (!request.isNavigationRequest()) return false;
    const frame = frameOf(request);
    return frame !== null && frame.parentFrame() === null && frame.page() === primaryPage;
  };

  /** 차단하고 route를 중단한다. DNS 조회 실패는 금지 대상이 아니므로 기록하지 않고 조회 실패로 중단한다 */
  const reject = async (route: Route, url: URL | null, verdict: Extract<Verdict, { ok: false }>, topLevel: boolean, viaRedirect: boolean) => {
    if (verdict.lookupFailure) {
      await route.abort('namenotresolved').catch(() => undefined);
      return;
    }
    record({ host: hostLabel(url), reason: verdict.reason, resourceType: route.request().resourceType(), topLevel, viaRedirect });
    await route.abort('blockedbyclient').catch(() => undefined);
  };

  const followRedirects = async (route: Route, start: URL, topLevel: boolean): Promise<void> => {
    const request = route.request();
    let current = start;
    let method = request.method();
    let response: APIResponse;
    try {
      response = await route.fetch({ maxRedirects: 0, timeout: ROUTE_FETCH_TIMEOUT_MS });
      for (let hops = 0; isRedirectStatus(response.status()); hops += 1) {
        const location = response.headers()['location'];
        if (!location) break; // Location 없는 3xx는 그대로 보여준다
        const next = parseUrl(new URL(location, current).href);
        const verdict = await verdictFor(next);
        if (!verdict.ok) return await reject(route, next, verdict, topLevel, true);
        // 금지 대상이 아니므로 기록하지 않는다. 브라우저의 ERR_TOO_MANY_REDIRECTS처럼 실패로 끝낸다
        if (hops + 1 > MAX_REDIRECTS) return await route.abort('failed').catch(() => undefined);
        if (topLevel && navigating && next) {
          // guard.goto가 이 URL로 다시 연다. 다음 요청도 route를 거치므로 hop마다 검사된다.
          pendingRedirect = next.href;
          return await route.abort('aborted').catch(() => undefined);
        }
        // 303, 그리고 POST의 301/302는 GET으로 바꾼다(Fetch 표준)
        const status = response.status();
        if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) method = 'GET';
        await response.dispose().catch(() => undefined);
        current = next as URL;
        response = await route.fetch({ url: current.href, method, maxRedirects: 0, timeout: ROUTE_FETCH_TIMEOUT_MS });
      }
    } catch (error) {
      // 연결 실패, 시간 초과, TLS 오류, context 종료 등. 브라우저가 직접 요청했을 때처럼 실패로 끝낸다
      await route.abort(abortCodeForFetchError(error)).catch(() => undefined);
      return;
    }
    await route.fulfill({ response }).catch(() => undefined);
  };

  await context.route('**/*', async (route) => {
    const request = route.request();
    // PRD 8.6: 동영상·오디오는 Node가 통째로 버퍼링하게 되므로 불러오지 않는다(메모리 보호). 금지 대상이 아니라 기록하지 않는다
    if (request.resourceType() === 'media') return route.abort('blockedbyclient').catch(() => undefined);
    const url = parseUrl(request.url());
    const topLevel = isPrimaryMainFrame(request);
    const verdict = await verdictFor(url);
    if (!verdict.ok) return reject(route, url, verdict, topLevel, false);
    if (REDIRECT_CHECK_SCOPE === 'documents' && !request.isNavigationRequest()) {
      return route.continue().catch(() => undefined);
    }
    return followRedirects(route, url as URL, topLevel);
  });

  // PRD 8.6: WebSocket은 route로 검사되지 않는다. 서버에 연결하지 않고 모두 닫는다
  await context.routeWebSocket(
    () => true,
    (ws) => {
      record({ host: hostLabel(parseUrl(ws.url())), reason: 'websocket', resourceType: 'websocket', topLevel: false, viaRedirect: false });
      void ws.close({ code: 1008, reason: 'Blocked' }).catch(() => undefined);
    },
  );

  // data:, blob:, file:, chrome: 같은 스킴의 최상위 탐색은 route가 가로채지 못한다(T08 확인: blob:은 route를 거치지 않고 열린다).
  // 메인 프레임 탐색 이벤트로 감지한다. 검사 대상 page면 최상위 문서 차단, 팝업이면 닫는다.
  const watchPage = (page: Page) => {
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const href = frame.url();
      if (BENIGN_NAVIGATION_URLS.includes(href)) return;
      const url = parseUrl(href);
      if (url && ALLOWED_SCHEMES.has(url.protocol)) return;
      const isPrimary = page === primaryPage;
      record({ host: hostLabel(url), reason: 'scheme', resourceType: 'document', topLevel: isPrimary, viaRedirect: false });
      if (!isPrimary) void page.close().catch(() => undefined);
    });
  };
  for (const page of context.pages()) watchPage(page);
  context.on('page', watchPage);

  const guard: RouteGuard = {
    get blocked() {
      return blocked;
    },
    get topLevelBlock() {
      return topLevelBlock;
    },
    async goto(page, url, { timeoutMs }) {
      primaryPage = page;
      const deadline = Date.now() + timeoutMs;
      let target = url;
      let redirects = 0;
      // goto 전에 스킴을 확인한다. data:, file: 같은 URL은 route를 거치지 않는다
      const first = parseUrl(target);
      if (!first || !ALLOWED_SCHEMES.has(first.protocol)) {
        record({ host: hostLabel(first), reason: 'scheme', resourceType: 'document', topLevel: true, viaRedirect: false });
        throw new Error('net::ERR_BLOCKED_BY_CLIENT');
      }
      for (;;) {
        pendingRedirect = null;
        navigating = true;
        try {
          const response = await page.goto(target, { waitUntil: 'load', timeout: Math.max(1, deadline - Date.now()) });
          return { response, redirects };
        } catch (error) {
          const next = pendingRedirect as string | null;
          if (topLevelBlock || next === null) throw error;
          redirects += 1;
          if (redirects > MAX_REDIRECTS) throw new Error('net::ERR_TOO_MANY_REDIRECTS');
          target = next;
        } finally {
          navigating = false;
        }
      }
    },
  };
  guards.set(context, guard);
  return guard;
}
