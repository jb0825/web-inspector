import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEnv, EnvError, LocalModeOnVercelError } from '@/server/env';

const SECRET = 'a'.repeat(32);

describe('env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('import만으로는 값이 없어도 에러가 나지 않는다', async () => {
    for (const key of ['INTERNAL_API_SECRET', 'UPSTASH_REDIS_REST_URL', 'AI_API_KEY', 'AI_MODEL']) {
      vi.stubEnv(key, '');
    }
    await expect(import('@/server/env')).resolves.toBeDefined();
  });

  it('getRuntimeEnv는 AI 키나 저장소 값 없이 동작하고 기본값을 쓴다', () => {
    const env = createEnv({});
    expect(env.getRuntimeEnv()).toEqual({
      isVercel: false,
      mode: 'public',
      localAllowHosts: [],
      platform: process.platform,
      maxConcurrentInspections: 1,
    });
  });

  it('VERCEL 값이 있으면 isVercel이 true다', () => {
    expect(createEnv({ VERCEL: '1' }).getRuntimeEnv().isVercel).toBe(true);
  });

  it('MAX_CONCURRENT_INSPECTIONS를 숫자로 읽고, 빈 값은 기본값으로 본다', () => {
    expect(createEnv({ MAX_CONCURRENT_INSPECTIONS: '2' }).getRuntimeEnv().maxConcurrentInspections).toBe(2);
    expect(createEnv({ MAX_CONCURRENT_INSPECTIONS: '' }).getRuntimeEnv().maxConcurrentInspections).toBe(1);
    expect(() => createEnv({ MAX_CONCURRENT_INSPECTIONS: 'abc' }).getRuntimeEnv()).toThrow(EnvError);
  });

  it('필요한 값이 없으면 해당 getter만 실패한다', () => {
    const env = createEnv({ INTERNAL_API_SECRET: SECRET });
    expect(env.getInternalEnv().INTERNAL_API_SECRET).toBe(SECRET);
    expect(() => env.getStoreEnv()).toThrow(EnvError);
    expect(() => env.getAiEnv()).toThrow(EnvError);
    expect(() => env.getRuntimeEnv()).not.toThrow();
  });

  it('getInternalEnv는 비밀값이 없거나 너무 짧으면 실패하고, 메시지에 값을 넣지 않는다', () => {
    expect(() => createEnv({}).getInternalEnv()).toThrow(/INTERNAL_API_SECRET/);
    const short = 'short-secret';
    try {
      createEnv({ INTERNAL_API_SECRET: short }).getInternalEnv();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      expect((error as Error).message).not.toContain(short);
    }
  });

  it('VERCEL_AUTOMATION_BYPASS_SECRET은 선택 값이다', () => {
    const env = createEnv({ INTERNAL_API_SECRET: SECRET, VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass' });
    expect(env.getInternalEnv().VERCEL_AUTOMATION_BYPASS_SECRET).toBe('bypass');
    expect(createEnv({ INTERNAL_API_SECRET: SECRET }).getInternalEnv().VERCEL_AUTOMATION_BYPASS_SECRET).toBeUndefined();
  });

  it('getStoreEnv와 getAiEnv는 값이 모두 있으면 통과한다', () => {
    const env = createEnv({
      UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      BLOB_READ_WRITE_TOKEN: 'blob',
      AI_API_KEY: 'key',
      AI_MODEL: 'model',
    });
    expect(env.getStoreEnv().UPSTASH_REDIS_REST_URL).toBe('https://example.upstash.io');
    expect(env.getAiEnv().AI_MODEL).toBe('model');
  });

  it('검증 결과를 캐시한다', () => {
    const source: Record<string, string | undefined> = { INTERNAL_API_SECRET: SECRET };
    const env = createEnv(source);
    const first = env.getInternalEnv();
    source.INTERNAL_API_SECRET = undefined;
    expect(env.getInternalEnv()).toBe(first);
  });

  describe('로컬 모드 (PRD 8.7)', () => {
    it('INSPECTOR_MODE=local이면 mode가 local이고 동시 검사 기본값이 2다', () => {
      const runtime = createEnv({ INSPECTOR_MODE: 'local' }).getRuntimeEnv();
      expect(runtime.mode).toBe('local');
      expect(runtime.maxConcurrentInspections).toBe(2);
      expect(createEnv({ INSPECTOR_MODE: 'local', MAX_CONCURRENT_INSPECTIONS: '3' }).getRuntimeEnv().maxConcurrentInspections).toBe(3);
    });

    it('알 수 없는 INSPECTOR_MODE 값은 거부하고, 빈 값은 public이다', () => {
      expect(() => createEnv({ INSPECTOR_MODE: 'dev' }).getRuntimeEnv()).toThrow(EnvError);
      expect(createEnv({ INSPECTOR_MODE: '' }).getRuntimeEnv().mode).toBe('public');
    });

    it('INSPECTOR_MODE=local과 VERCEL이 함께 있으면 즉시 실패한다', () => {
      expect(() => createEnv({ INSPECTOR_MODE: 'local', VERCEL: '1' }).getRuntimeEnv()).toThrow(LocalModeOnVercelError);
      expect(createEnv({ INSPECTOR_MODE: 'public', VERCEL: '1' }).getRuntimeEnv().mode).toBe('public');
    });

    it('LOCAL_ALLOW_HOSTS는 local 모드에서만 읽는다', () => {
      expect(createEnv({ INSPECTOR_MODE: 'local', LOCAL_ALLOW_HOSTS: ' 192.168.0.10, nas.lan ,,' }).getRuntimeEnv().localAllowHosts).toEqual(['192.168.0.10', 'nas.lan']);
      expect(createEnv({ LOCAL_ALLOW_HOSTS: '192.168.0.10' }).getRuntimeEnv().localAllowHosts).toEqual([]);
    });

    it('local 모드이고 Upstash·Blob 값이 없을 때만 파일 저장소를 쓴다', () => {
      expect(createEnv({ INSPECTOR_MODE: 'local' }).getStorageBackends()).toEqual({ inspections: 'file', screenshots: 'file' });
      expect(createEnv({}).getStorageBackends()).toEqual({ inspections: 'redis', screenshots: 'blob' });
      expect(
        createEnv({ INSPECTOR_MODE: 'local', UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't', BLOB_READ_WRITE_TOKEN: 'b' }).getStorageBackends(),
      ).toEqual({ inspections: 'redis', screenshots: 'blob' });
      expect(createEnv({ INSPECTOR_MODE: 'local', VERCEL: '1' }).getStorageBackends()).toEqual({ inspections: 'redis', screenshots: 'blob' });
    });

    it('local 모드에서 INTERNAL_API_SECRET이 없으면 프로세스 안에서 같은 무작위 값을 쓴다. public 모드는 여전히 필수다', () => {
      const a = createEnv({ INSPECTOR_MODE: 'local' }).getInternalEnv().INTERNAL_API_SECRET;
      const b = createEnv({ INSPECTOR_MODE: 'local' }).getInternalEnv().INTERNAL_API_SECRET;
      expect(a.length).toBeGreaterThanOrEqual(16);
      expect(a).toBe(b);
      expect(createEnv({ INSPECTOR_MODE: 'local', INTERNAL_API_SECRET: SECRET }).getInternalEnv().INTERNAL_API_SECRET).toBe(SECRET);
      expect(() => createEnv({}).getInternalEnv()).toThrow(EnvError);
    });
  });
});
