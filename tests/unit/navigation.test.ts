import { describe, expect, it } from 'vitest';
import { navigationNetError } from '@/server/browser/stabilize';
import { abortCodeForFetchError } from '@/server/security/routeGuard';

// PRD 6.2.4: goto의 네트워크 오류(net::ERR_*)는 NAVIGATION_FAILED. 메시지에 오류 종류를 넣는다

describe('navigationNetError', () => {
  it('Playwright 오류 메시지에서 net::ERR_* 이름을 꺼낸다', () => {
    expect(navigationNetError(new Error('page.goto: net::ERR_NAME_NOT_RESOLVED at https://x.test/\nCall log: ...'))).toBe('net::ERR_NAME_NOT_RESOLVED');
    expect(navigationNetError(new Error('page.goto: net::ERR_CONNECTION_REFUSED at http://a/'))).toBe('net::ERR_CONNECTION_REFUSED');
    expect(navigationNetError(new Error('net::ERR_CERT_AUTHORITY_INVALID'))).toBe('net::ERR_CERT_AUTHORITY_INVALID');
    expect(navigationNetError(new Error('net::ERR_TOO_MANY_REDIRECTS'))).toBe('net::ERR_TOO_MANY_REDIRECTS');
  });

  it('네트워크 오류가 아니면 null', () => {
    expect(navigationNetError(new Error('Target closed'))).toBeNull();
    expect(navigationNetError('net::ERR_FAILED')).toBeNull();
    expect(navigationNetError(undefined)).toBeNull();
  });
});

describe('abortCodeForFetchError', () => {
  it('route.fetch 오류를 Chromium 오류 코드로 바꾼다', () => {
    expect(abortCodeForFetchError(new Error('apiRequestContext._wrapApiCall: connect ECONNREFUSED 127.0.0.1:1'))).toBe('connectionrefused');
    expect(abortCodeForFetchError(new Error('read ECONNRESET'))).toBe('connectionreset');
    expect(abortCodeForFetchError(new Error('getaddrinfo ENOTFOUND x.test'))).toBe('namenotresolved');
    expect(abortCodeForFetchError(new Error('Timeout 15000ms exceeded'))).toBe('timedout');
    expect(abortCodeForFetchError(new Error('self-signed certificate'))).toBe('failed');
  });
});
