import { beforeEach, describe, expect, it } from 'vitest';
import { inspectionRequestSchema } from '@/schemas/inspectionRequest';
import { InspectionError } from '@/server/errors';
import { applyStaleRule, browserStageError, browserStageStatus, finalStatus, STALE_AFTER_MS } from '@/server/status';
import {
  analyzeLockKey,
  createInspectionStore,
  INSPECTION_TTL_SECONDS,
  inspectionKey,
  RUNNING_SET_KEY,
  SLOT_TTL_MS,
  StoredInspectionInvalidError,
  type InspectionStore,
} from '@/server/store/redis';
import { inspectionSchema } from '@/server/store/schemas';
import type { Inspection, ViewportResult } from '@/types/inspection';
import { FakeRedis } from './helpers/fakeRedis';
import { ID, pendingDoc, T0 } from './helpers/inspection';

// T09: DOMAIN_MODEL 4.4, 5장, 6.1 / PRD 6.2.2, 8.4

let now = T0;
const clock = () => now;
let redis: FakeRedis;
let store: InspectionStore;

beforeEach(() => {
  now = T0;
  redis = new FakeRedis(clock);
  store = createInspectionStore(redis, { now: clock });
});

const VIEWPORT: ViewportResult = {
  width: 1440, height: 900, innerWidth: 1440, layoutWidth: 1440, hasMetaViewport: true, documentHeight: 900,
  screenshotUrl: 'https://blob.example/d.png', screenshotWidth: 1440, screenshotHeight: 900, screenshotTruncated: false,
  elementsInspected: 10, elementsTruncated: false, hasCanvas: false, overlaysDetected: [],
};
const ERR = { code: 'NAVIGATION_TIMEOUT', message: 'timeout' } as const;

describe('inspectionRequestSchema (DOMAIN_MODEL 5.1)', () => {
  it('url만 받고 trim한다. 빈 값, 2,048자 초과, 다른 필드는 거부한다', () => {
    expect(inspectionRequestSchema.parse({ url: '  https://example.com  ' })).toEqual({ url: 'https://example.com' });
    expect(inspectionRequestSchema.safeParse({ url: '   ' }).success).toBe(false);
    expect(inspectionRequestSchema.safeParse({ url: 'x'.repeat(2048) }).success).toBe(true);
    expect(inspectionRequestSchema.safeParse({ url: 'x'.repeat(2049) }).success).toBe(false);
    expect(inspectionRequestSchema.safeParse({ url: 'https://a.com', viewports: ['desktop'] }).success).toBe(false);
    expect(inspectionRequestSchema.safeParse({ url: 1 }).success).toBe(false);
  });
});

describe('inspectionSchema (DOMAIN_MODEL 5.3)', () => {
  it('정상 문서는 통과한다', () => {
    expect(inspectionSchema.parse(pendingDoc())).toEqual(pendingDoc());
    const analyzing = pendingDoc({ status: 'analyzing', step: 'saving_results', viewports: { desktop: VIEWPORT, mobile: null }, viewportErrors: { desktop: null, mobile: ERR } });
    expect(inspectionSchema.safeParse(analyzing).success).toBe(true);
  });

  it('잘못된 문서는 거부한다', () => {
    const bad: unknown[] = [
      { ...pendingDoc(), status: 'queued' },
      { ...pendingDoc(), id: 'not-a-uuid' },
      { ...pendingDoc(), createdAt: '2026-11-13' },
      { ...pendingDoc(), step: 'unknown_step' },
      { ...pendingDoc(), extra: 1 },
      { ...pendingDoc(), viewportErrors: { desktop: { code: 'NOPE', message: '' }, mobile: null } },
      { ...pendingDoc(), viewports: { desktop: { ...VIEWPORT, screenshotUrl: undefined }, mobile: null } },
      (() => {
        const d: Partial<Inspection> = pendingDoc();
        delete d.issues;
        return d;
      })(),
    ];
    for (const doc of bad) expect(inspectionSchema.safeParse(doc).success).toBe(false);
  });
});

describe('InspectionStore (DOMAIN_MODEL 6.1)', () => {
  it('생성은 TTL 7일, 갱신은 KEEPTTL로 TTL을 유지하고 updatedAt을 갱신한다', async () => {
    await store.create(pendingDoc());
    expect(redis.calls.at(-1)?.options).toEqual({ ex: INSPECTION_TTL_SECONDS, nx: true });
    expect(redis.ttlSeconds(inspectionKey(ID))).toBe(INSPECTION_TTL_SECONDS);

    now = T0 + 60_000;
    const saved = await store.save({ ...pendingDoc(), status: 'running' });
    expect(redis.calls.at(-1)?.options).toEqual({ keepTtl: true, xx: true });
    expect(saved.updatedAt).toBe(new Date(T0 + 60_000).toISOString());
    expect(redis.ttlSeconds(inspectionKey(ID))).toBe(INSPECTION_TTL_SECONDS - 60);

    const read = await store.read(ID);
    expect(read).toEqual(saved);
  });

  it('문자열 그대로 저장하고 한 번만 파싱한다 (이중 직렬화 없음)', async () => {
    await store.create(pendingDoc());
    const raw = redis.strings.get(inspectionKey(ID))?.value ?? '';
    expect(JSON.parse(raw)).toEqual(pendingDoc());
  });

  it('없는 문서는 null, 깨진 문서는 StoredInspectionInvalidError', async () => {
    expect(await store.read(ID)).toBeNull();
    redis.strings.set(inspectionKey(ID), { value: '{not json', expiresAt: null });
    await expect(store.read(ID)).rejects.toBeInstanceOf(StoredInspectionInvalidError);
    redis.strings.set(inspectionKey(ID), { value: JSON.stringify({ ...pendingDoc(), status: 'queued' }), expiresAt: null });
    await expect(store.read(ID)).rejects.toBeInstanceOf(StoredInspectionInvalidError);
  });

  it('TTL이 지난 문서는 읽을 수 없고, 갱신해도 다시 만들지 않는다', async () => {
    await store.create(pendingDoc());
    now = T0 + INSPECTION_TTL_SECONDS * 1000;
    expect(await store.read(ID)).toBeNull();
    await expect(store.save(pendingDoc())).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  });

  it('Redis 오류는 STORAGE_FAILED', async () => {
    redis.failNext = { command: 'set', error: new Error('network') };
    await expect(store.create(pendingDoc())).rejects.toBeInstanceOf(InspectionError);
    redis.failNext = { command: 'get', error: new Error('network') };
    await expect(store.read(ID)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  });

  it('읽기는 멈춘 검사 처리를 적용하지만 Redis에는 다시 쓰지 않는다 (DOMAIN_MODEL 4.4)', async () => {
    await store.create(pendingDoc());
    now = T0 + STALE_AFTER_MS;
    expect((await store.read(ID))?.status).toBe('failed');
    expect(JSON.parse(redis.strings.get(inspectionKey(ID))?.value ?? '').status).toBe('pending');
  });
});

describe('동시 실행 슬롯 (PRD 8.4)', () => {
  it('상한까지 획득하고 초과는 거부한다', async () => {
    expect(await store.acquireSlot('a', 2)).toBe(true);
    expect(await store.acquireSlot('b', 2)).toBe(true);
    expect(await store.acquireSlot('c', 2)).toBe(false);
    expect([...(redis.zsets.get(RUNNING_SET_KEY)?.keys() ?? [])]).toEqual(['a', 'b']);
  });

  it('반환하면 다시 획득할 수 있다', async () => {
    await store.acquireSlot('a', 1);
    expect(await store.acquireSlot('b', 1)).toBe(false);
    await store.releaseSlot('a');
    expect(await store.acquireSlot('b', 1)).toBe(true);
  });

  it('시작 후 300초가 지난 슬롯은 만료되어 재획득된다', async () => {
    await store.acquireSlot('a', 1);
    now = T0 + SLOT_TTL_MS - 1;
    expect(await store.acquireSlot('b', 1)).toBe(false);
    now = T0 + SLOT_TTL_MS;
    expect(await store.acquireSlot('b', 1)).toBe(true);
    expect(redis.zsets.get(RUNNING_SET_KEY)?.get('b')).toBe(T0 + SLOT_TTL_MS * 2);
  });
});

describe('analyze 잠금 (DOMAIN_MODEL 6.1)', () => {
  it('한 번만 잡히고 300초 뒤 풀린다', async () => {
    expect(await store.acquireAnalyzeLock(ID)).toBe(true);
    expect(await store.acquireAnalyzeLock(ID)).toBe(false);
    expect(redis.ttlSeconds(analyzeLockKey(ID))).toBe(300);
    now = T0 + 300_000;
    expect(await store.acquireAnalyzeLock(ID)).toBe(true);
  });
});

describe('상태 판정 (PRD 6.2.2)', () => {
  const ok = { desktop: VIEWPORT, mobile: VIEWPORT };
  it('브라우저 단계: 하나 이상 성공 → analyzing, 둘 다 실패 → failed (error는 Desktop 우선)', () => {
    expect(browserStageStatus(ok)).toBe('analyzing');
    expect(browserStageStatus({ desktop: null, mobile: VIEWPORT })).toBe('analyzing');
    expect(browserStageStatus({ desktop: null, mobile: null })).toBe('failed');
    const mobileErr = { code: 'HTTP_ERROR', message: 'HTTP 500' } as const;
    expect(browserStageError({ desktop: ERR, mobile: mobileErr })).toEqual(ERR);
    expect(browserStageError({ desktop: null, mobile: mobileErr })).toEqual(mobileErr);
  });

  it('AI 단계: 두 viewport 성공 → completed, 하나 실패 → partial, analysis 실패 → partial, 이슈 0개(skipped) → completed', () => {
    const none = { desktop: null, mobile: null };
    expect(finalStatus({ viewportErrors: none, analysis: { status: 'completed', analyzedIssueCount: 3 } })).toBe('completed');
    expect(finalStatus({ viewportErrors: { desktop: null, mobile: ERR }, analysis: { status: 'completed', analyzedIssueCount: 1 } })).toBe('partial');
    expect(finalStatus({ viewportErrors: none, analysis: { status: 'failed', analyzedIssueCount: 0 } })).toBe('partial');
    expect(finalStatus({ viewportErrors: none, analysis: { status: 'skipped', analyzedIssueCount: 0 } })).toBe('completed');
    expect(finalStatus({ viewportErrors: { desktop: ERR, mobile: null }, analysis: { status: 'skipped', analyzedIssueCount: 0 } })).toBe('partial');
  });
});

describe('멈춘 검사 처리 (DOMAIN_MODEL 4.4)', () => {
  it('pending/running은 createdAt에서 300초 경계부터 failed + TIME_BUDGET_EXCEEDED', () => {
    for (const status of ['pending', 'running'] as const) {
      const doc = pendingDoc({ status, updatedAt: new Date(T0 + 250_000).toISOString() });
      expect(applyStaleRule(doc, T0 + STALE_AFTER_MS - 1)).toBe(doc);
      const stale = applyStaleRule(doc, T0 + STALE_AFTER_MS);
      expect(stale.status).toBe('failed');
      expect(stale.error?.code).toBe('TIME_BUDGET_EXCEEDED');
      expect(stale.completedAt).toBe(new Date(T0 + STALE_AFTER_MS).toISOString());
    }
  });

  it('analyzing은 updatedAt에서 300초 경계부터 partial + analysis.failed(AI_FAILED)', () => {
    const updated = T0 + 120_000;
    const doc = pendingDoc({
      status: 'analyzing',
      updatedAt: new Date(updated).toISOString(),
      viewports: { desktop: VIEWPORT, mobile: VIEWPORT },
    });
    expect(applyStaleRule(doc, updated + STALE_AFTER_MS - 1)).toBe(doc);
    const stale = applyStaleRule(doc, updated + STALE_AFTER_MS);
    expect(stale.status).toBe('partial');
    expect(stale.analysis).toEqual({ status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: expect.any(String) } });
  });

  it('종료 상태는 바꾸지 않는다', () => {
    for (const status of ['completed', 'partial', 'failed'] as const) {
      const doc = pendingDoc({ status });
      expect(applyStaleRule(doc, T0 + STALE_AFTER_MS * 10)).toBe(doc);
    }
  });
});
