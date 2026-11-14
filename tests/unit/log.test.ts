import { describe, expect, it } from 'vitest';
import { EnvError } from '@/server/env';
import { describeFailure, logLevelOf } from '@/server/log';

// 운영 STORAGE_FAILED 원인 로그 (T13)
describe('describeFailure', () => {
  it('EnvError는 변수 이름을 남긴다', () => {
    expect(describeFailure(new EnvError('store', ['BLOB_READ_WRITE_TOKEN', 'UPSTASH_REDIS_REST_TOKEN']))).toBe(
      'EnvError: Invalid or missing environment variables for store: BLOB_READ_WRITE_TOKEN, UPSTASH_REDIS_REST_TOKEN',
    );
  });

  it('URL과 토큰 형태의 문자열은 지운다', () => {
    const text = describeFailure(new Error('failed https://abc.upstash.io/get/x?token=AXyzAXyzAXyzAXyzAXyzAXyzAXyzAXyz1234 with AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'));
    expect(text).not.toContain('upstash.io');
    expect(text).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
    expect(text).toContain('<url>');
    expect(text).toContain('<redacted>');
  });

  it('네트워크 오류의 cause 코드를 붙이고 길이를 자른다', () => {
    const error = new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ENOTFOUND' }) });
    expect(describeFailure(error)).toBe('TypeError: fetch failed (ENOTFOUND) <- Error: x');
    expect(describeFailure(new Error('a'.repeat(10) + ' ' + 'b '.repeat(200))).length).toBeLessThanOrEqual(240);
    expect(describeFailure('oops')).toBe('string');
  });
});

describe('describeFailure: 감싼 오류', () => {
  it('cause가 Error면 한 단계 붙인다', () => {
    const inner = new Error('page.screenshot: Target crashed');
    const outer = new Error('Viewport stopped: measure budget exceeded', { cause: inner });
    expect(describeFailure(outer)).toBe('Error: Viewport stopped: measure budget exceeded <- Error: page.screenshot: Target crashed');
  });
});

describe('logLevelOf', () => {
  it('실패는 error, 거절·건너뜀은 warn, 나머지는 info', () => {
    for (const e of ['create-failed', 'read-failed', 'viewport-failed', 'launch-failed', 'analyze-call-timeout', 'unexpected', 'read-invalid', 'analyze-config-missing'])
      expect(logLevelOf(e)).toBe('error');
    for (const e of ['create-rejected', 'viewport-skipped']) expect(logLevelOf(e)).toBe('warn');
    for (const e of ['created', 'start', 'viewport', 'viewport-step', 'save', 'end']) expect(logLevelOf(e)).toBe('info');
  });
});
