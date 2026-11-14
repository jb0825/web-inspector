import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYSIS_FAILED_MESSAGE, runAnalysis } from '@/server/analyze';
import { InspectionError } from '@/server/errors';
import {
  handleAnalyze,
  handleCreateInspection,
  handleGetInspection,
  MAX_REQUEST_BODY_BYTES,
  type AnalyzeDeps,
  type CreateDeps,
} from '@/server/http/inspections';
import { createHostChecker, type LookupFn } from '@/server/security/ssrf';
import { assertInspectionInvariants } from '@/server/store/invariants';
import { createInspectionStore, inspectionKey, RUNNING_SET_KEY, type InspectionStore } from '@/server/store/redis';
import type { Inspection, Issue, ViewportResult } from '@/types/inspection';
import { FakeRedis } from './helpers/fakeRedis';
import { ID, pendingDoc, T0 } from './helpers/inspection';
import { P01_ISSUE, P01_VIEWPORTS } from './helpers/p01';

// T09: API route 응답 형식 (PRD 8.3, API_SPEC 2~6장). route 파일은 이 handler에 의존성만 넣는다.

const SECRET = 'internal-secret-0123456789';
const DNS: Record<string, string[]> = { 'example.com': ['93.184.216.34'], 'evil.test': ['10.0.0.1'] };
const lookup: LookupFn = async (host) => {
  const addresses = DNS[host];
  if (!addresses) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return addresses.map((address) => ({ address, family: 4 }));
};

let now: number;
let redis: FakeRedis;
let store: InspectionStore;
let scheduled: (() => Promise<void>)[];

beforeEach(() => {
  now = T0;
  redis = new FakeRedis(() => now);
  store = createInspectionStore(redis, { now: () => now });
  scheduled = [];
});

let nextId = 0;
function createDeps(overrides: Partial<CreateDeps> = {}): CreateDeps {
  return {
    store,
    createChecker: () => createHostChecker({ lookup }),
    maxConcurrentInspections: () => 2,
    newId: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, '0')}`,
    now: () => now,
    schedule: (task) => scheduled.push(task),
    startInspection: vi.fn(async () => undefined),
    log: () => undefined,
    ...overrides,
  };
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/inspections', { method: 'POST', body, headers: { 'content-type': 'application/json', ...headers } });

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = (await response.json()) as { code: string; message: string };
  expect(body).toEqual({ code, message: expect.any(String) });
  // 오류 메시지에 스택, 내부 경로, 입력 URL(호스트)을 넣지 않는다
  expect(body.message).not.toMatch(/\n\s+at |\/src\/|example\.com|nowhere|evil|localhost|169\.254/);
  return body;
}

describe('POST /api/inspections', () => {
  it('202 { id }, pending 문서 생성, 슬롯 획득, 응답 뒤 검사 예약', async () => {
    const deps = createDeps();
    const response = await handleCreateInspection(post(JSON.stringify({ url: ' https://Example.com/pricing?plan=pro#top ' })), deps);
    expect(response.status).toBe(202);
    const { id } = (await response.json()) as { id: string };
    const doc = await store.read(id);
    expect(doc).toMatchObject({ id, url: 'https://example.com/pricing?plan=pro', status: 'pending', issues: [], tasks: [] });
    assertInspectionInvariants(doc as Inspection, 'browser');
    expect(redis.zsets.get(RUNNING_SET_KEY)?.has(id)).toBe(true);
    expect(deps.startInspection).not.toHaveBeenCalled();
    await scheduled[0]();
    expect(deps.startInspection).toHaveBeenCalledWith(id);
  });

  it('400 INVALID_URL: JSON 아님, 스키마 불일치, 형식 오류, 프로토콜, 계정 정보, DNS 실패', async () => {
    const bodies = [
      'not json',
      JSON.stringify({}),
      JSON.stringify({ url: 'https://example.com', extra: 1 }),
      JSON.stringify({ url: '' }),
      JSON.stringify({ url: 'not a url' }),
      JSON.stringify({ url: 'ftp://example.com' }),
      JSON.stringify({ url: 'https://user:pass@example.com' }),
      JSON.stringify({ url: `https://example.com/${'a'.repeat(2048)}` }),
    ];
    for (const body of bodies) await expectError(await handleCreateInspection(post(body), createDeps()), 400, 'INVALID_URL');
    const dns = await expectError(await handleCreateInspection(post(JSON.stringify({ url: 'https://nowhere.test' })), createDeps()), 400, 'INVALID_URL');
    expect(dns.message).toContain('찾을 수 없습니다');
  });

  it('400 BLOCKED_TARGET: localhost, 메타데이터, 내부 주소로 풀리는 이름', async () => {
    for (const url of ['http://localhost:3000/fixtures/positive/P-01.html', 'http://169.254.169.254', 'http://evil.test', 'http://[::ffff:127.0.0.1]']) {
      await expectError(await handleCreateInspection(post(JSON.stringify({ url })), createDeps()), 400, 'BLOCKED_TARGET');
    }
    expect(redis.strings.size).toBe(0);
  });

  it('413: 본문이 4 KB를 넘으면', async () => {
    const big = JSON.stringify({ url: `https://example.com/?q=${'a'.repeat(MAX_REQUEST_BODY_BYTES)}` });
    await expectError(await handleCreateInspection(post(big), createDeps()), 413, 'INVALID_URL');
    await expectError(await handleCreateInspection(post('{}', { 'content-length': '999999' }), createDeps()), 413, 'INVALID_URL');
  });

  it('429 TOO_MANY_INSPECTIONS: 동시 실행 수 초과. 문서를 만들지 않는다', async () => {
    const deps = createDeps({ maxConcurrentInspections: () => 1 });
    const body = JSON.stringify({ url: 'https://example.com' });
    expect((await handleCreateInspection(post(body), deps)).status).toBe(202);
    await expectError(await handleCreateInspection(post(body), deps), 429, 'TOO_MANY_INSPECTIONS');
    expect(redis.strings.size).toBe(1);
  });

  it('500 STORAGE_FAILED: 문서 생성이 실패하면 슬롯을 반환한다', async () => {
    const deps = createDeps();
    redis.failNext = { command: 'set', error: new Error('network') };
    await expectError(await handleCreateInspection(post(JSON.stringify({ url: 'https://example.com' })), deps), 500, 'STORAGE_FAILED');
    expect(redis.zsets.get(RUNNING_SET_KEY)?.size).toBe(0);
    expect(scheduled).toHaveLength(0);
  });
});

describe('GET /api/inspections/:id', () => {
  it('200: 저장된 문서를 그대로 돌려주고 캐시하지 않는다', async () => {
    await store.create(pendingDoc());
    const response = await handleGetInspection(ID, { store, log: () => undefined });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(pendingDoc());
  });

  it('404 NOT_FOUND: 없는 id, UUID가 아닌 id (Redis를 조회하지 않는다)', async () => {
    await expectError(await handleGetInspection(ID, { store, log: () => undefined }), 404, 'NOT_FOUND');
    const calls = redis.calls.length;
    await expectError(await handleGetInspection('../etc', { store, log: () => undefined }), 404, 'NOT_FOUND');
    expect(redis.calls.length).toBe(calls);
  });

  it('500 INTERNAL_ERROR: 스키마 검증 실패. 로그에는 ID만', async () => {
    redis.strings.set(inspectionKey(ID), { value: JSON.stringify({ ...pendingDoc(), status: 'queued' }), expiresAt: null });
    const log = vi.fn();
    await expectError(await handleGetInspection(ID, { store, log }), 500, 'INTERNAL_ERROR');
    expect(log).toHaveBeenCalledWith('read-invalid', { id: ID });
  });

  it('멈춘 검사는 300초 뒤 failed로 보인다', async () => {
    await store.create(pendingDoc());
    now = T0 + 300_000;
    const body = (await (await handleGetInspection(ID, { store, log: () => undefined })).json()) as Inspection;
    expect(body.status).toBe('failed');
    expect(body.error?.code).toBe('TIME_BUDGET_EXCEEDED');
  });
});

const VIEWPORT: ViewportResult = {
  width: 1440, height: 900, innerWidth: 1440, layoutWidth: 1440, hasMetaViewport: true, documentHeight: 900,
  screenshotUrl: 'https://blob.example/d.png', screenshotWidth: 1440, screenshotHeight: 900, screenshotTruncated: false,
  elementsInspected: 10, elementsTruncated: false, hasCanvas: false, overlaysDetected: [],
};
const MOBILE: ViewportResult = { ...VIEWPORT, width: 390, height: 844, innerWidth: 390, layoutWidth: 390, screenshotWidth: 390 };

function analyzingDoc(overrides: Partial<Inspection> = {}): Inspection {
  return pendingDoc({
    status: 'analyzing',
    step: 'saving_results',
    startedAt: new Date(T0).toISOString(),
    finalUrl: 'https://example.com/',
    viewports: { desktop: VIEWPORT, mobile: MOBILE },
    ...overrides,
  });
}

function analyzeDeps(overrides: Partial<AnalyzeDeps> = {}): AnalyzeDeps {
  return {
    store,
    internalSecret: () => SECRET,
    schedule: (task) => scheduled.push(task),
    startAnalysis: vi.fn(async () => undefined),
    log: () => undefined,
    ...overrides,
  };
}

const analyzeRequest = (secret?: string) =>
  new Request(`http://localhost/api/inspections/${ID}/analyze`, { method: 'POST', headers: secret ? { 'x-internal-secret': secret } : {} });

describe('POST /api/inspections/:id/analyze', () => {
  it('401: 비밀 헤더가 없거나 다르다 (쿼리 문자열은 보지 않는다)', async () => {
    await store.create(analyzingDoc());
    await expectError(await handleAnalyze(analyzeRequest(), ID, analyzeDeps()), 401, 'UNAUTHORIZED');
    await expectError(await handleAnalyze(analyzeRequest('wrong'), ID, analyzeDeps()), 401, 'UNAUTHORIZED');
    await expectError(await handleAnalyze(analyzeRequest(`${SECRET.slice(0, -1)}X`), ID, analyzeDeps()), 401, 'UNAUTHORIZED');
    const withQuery = new Request(`http://localhost/api/inspections/${ID}/analyze?secret=${SECRET}`, { method: 'POST' });
    await expectError(await handleAnalyze(withQuery, ID, analyzeDeps()), 401, 'UNAUTHORIZED');
  });

  it('404: 없는 검사', async () => {
    await expectError(await handleAnalyze(analyzeRequest(SECRET), ID, analyzeDeps()), 404, 'NOT_FOUND');
    await expectError(await handleAnalyze(analyzeRequest(SECRET), 'nope', analyzeDeps()), 404, 'NOT_FOUND');
  });

  it('202 {} 후 after()에서 실행. 두 번째 호출은 잠금 때문에 409', async () => {
    await store.create(analyzingDoc());
    const deps = analyzeDeps();
    const first = await handleAnalyze(analyzeRequest(SECRET), ID, deps);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({});
    await expectError(await handleAnalyze(analyzeRequest(SECRET), ID, deps), 409, 'INVALID_STATE');
    expect(scheduled).toHaveLength(1);
  });

  it('409: analyzing이 아니거나 analysis가 pending이 아니면', async () => {
    await store.create(pendingDoc());
    await expectError(await handleAnalyze(analyzeRequest(SECRET), ID, analyzeDeps()), 409, 'INVALID_STATE');
    await store.save(analyzingDoc({ analysis: { status: 'running', analyzedIssueCount: 0 } }));
    await expectError(await handleAnalyze(analyzeRequest(SECRET), ID, analyzeDeps()), 409, 'INVALID_STATE');
    // 상태가 맞지 않으면 잠금을 잡지 않는다
    expect(redis.strings.has(`inspection:${ID}:analyze-lock`)).toBe(false);
  });

  it('500: INTERNAL_API_SECRET 설정이 없으면 (401로 숨기지 않는다)', async () => {
    const deps = analyzeDeps({ internalSecret: () => { throw new Error('missing'); } });
    await expectError(await handleAnalyze(analyzeRequest(SECRET), ID, deps), 500, 'INTERNAL_ERROR');
  });
});

describe('runAnalysis (T10: 규칙 기반 분석 → 태스크 → 프롬프트)', () => {
  const issue = (id: string, needsReview: boolean): Issue => ({
    id, type: 'viewport-overflow', subtype: 'page-scroll', title: 't', viewports: ['desktop'], viewportTag: null,
    selector: 'div', sourceHints: { htmlSnippet: '<div>', stableAttributes: {}, ancestorPath: 'body' },
    occurrences: [{
      viewport: 'desktop', selector: 'div', boundingBox: { x: 0, y: 0, width: 10, height: 10 }, measured: {}, expected: {}, delta: {},
      evidenceText: 'e', relatedElements: [], cropRect: null, computedStyle: {},
      sourceHints: { htmlSnippet: '<div>', stableAttributes: {}, ancestorPath: 'body' }, confidence: needsReview ? 0.4 : 1,
    }],
    relatedIssueIds: [], scores: { S: 4, I: 4, R: 5, score100: 430 }, priority: 'P0', confidence: needsReview ? 0.4 : 1, needsReview,
  });
  /** P-01 브라우저 단계 결과 (이슈 1개, 두 viewport 성공) */
  const p01Doc = () => analyzingDoc({ viewports: P01_VIEWPORTS, issuesDetected: 1, issues: [P01_ISSUE] });

  /** 저장할 때마다 (status, step, analysis.status)를 기록하고, fail이 참인 저장에서 던지는 저장소 */
  function recordingStore(fail: (doc: Inspection) => boolean = () => false) {
    const saved: string[] = [];
    const wrapped: InspectionStore = {
      ...store,
      async save(doc) {
        if (fail(doc)) throw new InspectionError('STORAGE_FAILED', 'Redis save failed');
        saved.push(`${doc.status}/${doc.step}/${doc.analysis.status}`);
        return store.save(doc);
      },
    };
    return { saved, wrapped };
  }
  const run = (s: InspectionStore = store) => runAnalysis(ID, { store: s, now: () => now, log: () => undefined });

  it('정상 흐름: analyzing_issues → generating_tasks → completed를 한 번에 저장 (DOMAIN_MODEL 4.3)', async () => {
    await store.create(p01Doc());
    const { saved, wrapped } = recordingStore();
    now = T0 + 5_000;
    await run(wrapped);
    expect(saved).toEqual(['analyzing/analyzing_issues/running', 'analyzing/generating_tasks/running', 'completed/generating_tasks/completed']);
    const doc = (await store.read(ID)) as Inspection;
    expect(doc.analysis).toEqual({ status: 'completed', analyzedIssueCount: 1 });
    expect(doc.completedAt).toBe(new Date(T0 + 5_000).toISOString());
    expect(doc.issues[0].analysis).toMatchObject({ source: 'rule', certainty: 'likely' });
    expect(doc.tasks.map((t) => [t.id, t.issueIds, t.priority, t.viewportTag, t.titleSource])).toEqual([['TASK-001', ['ISS-001'], 'P0', 'mobile-only', 'template']]);
    expect(doc.tasks[0].prompt).toContain('## [ISS-001]');
    // 결정적 필드는 바뀌지 않는다(AGENTS.md 6장 불변 조건 1)
    const rest: Issue = { ...doc.issues[0] };
    delete rest.analysis;
    expect(rest).toEqual(P01_ISSUE);
    assertInspectionInvariants(doc, 'final');
  });

  it('이슈 0개: 분석 없이 analysis.skipped, tasks [], completed', async () => {
    await store.create(analyzingDoc());
    now = T0 + 5_000;
    await run();
    const doc = (await store.read(ID)) as Inspection;
    expect(doc.status).toBe('completed');
    expect(doc.analysis).toEqual({ status: 'skipped', analyzedIssueCount: 0 });
    expect(doc.tasks).toEqual([]);
    expect(doc.completedAt).toBe(new Date(T0 + 5_000).toISOString());
    assertInspectionInvariants(doc, 'final');
  });

  it('viewport 실패가 있으면 분석이 끝나도 partial. Needs Review 이슈는 Needs Review 태스크로', async () => {
    await store.create(
      analyzingDoc({
        viewports: { desktop: VIEWPORT, mobile: null },
        viewportErrors: { desktop: null, mobile: { code: 'NAVIGATION_TIMEOUT', message: 'timeout' } },
        issuesDetected: 2,
        issues: [issue('ISS-001', false), issue('ISS-002', true)],
      }),
    );
    await run();
    const doc = (await store.read(ID)) as Inspection;
    expect(doc.status).toBe('partial');
    expect(doc.analysis).toEqual({ status: 'completed', analyzedIssueCount: 1 });
    expect(doc.issues.map((i) => [i.analysis?.source, i.analysisSkippedReason])).toEqual([['rule', undefined], [undefined, 'needs-review']]);
    expect(doc.tasks.map((t) => [t.issueIds, t.needsReview, t.viewportTag])).toEqual([[['ISS-001'], false, null], [['ISS-002'], true, null]]);
    assertInspectionInvariants(doc, 'final');
  });

  it('중간 예외: analysis.failed(AI_FAILED) + partial로 저장하고 브라우저 검사 결과는 그대로 남긴다', async () => {
    await store.create(p01Doc());
    const { saved, wrapped } = recordingStore((doc) => doc.step === 'generating_tasks' && doc.status === 'analyzing');
    await run(wrapped);
    expect(saved).toEqual(['analyzing/analyzing_issues/running', 'partial/analyzing_issues/failed']);
    const doc = (await store.read(ID)) as Inspection;
    expect(doc.status).toBe('partial');
    expect(doc.analysis).toEqual({ status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: ANALYSIS_FAILED_MESSAGE } });
    expect(doc.viewports).toEqual(P01_VIEWPORTS);
    expect(doc.issues).toEqual([{ ...P01_ISSUE, analysisSkippedReason: 'ai-failed' }]);
    expect(doc.tasks).toEqual([]);
    assertInspectionInvariants(doc, 'final');
  });

  it('끝난 뒤 다시 호출하면 409 (상태가 analyzing이 아니다), runAnalysis도 아무것도 하지 않는다', async () => {
    await store.create(p01Doc());
    await run();
    const before = await store.read(ID);
    await expectError(await handleAnalyze(analyzeRequest(SECRET), ID, analyzeDeps()), 409, 'INVALID_STATE');
    await run();
    expect(await store.read(ID)).toEqual(before);
  });

  it('상태가 맞지 않으면 아무것도 하지 않는다', async () => {
    await store.create(pendingDoc());
    await run();
    expect((await store.read(ID))?.status).toBe('pending');
  });
});
