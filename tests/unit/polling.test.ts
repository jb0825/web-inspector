import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchInspection, type FetchInspectionResult } from '@/components/api/inspections';
import {
  createPoller,
  ERROR_RETRY_DELAYS_MS,
  INITIAL_POLL_STATE,
  MAX_ERROR_RETRIES,
  nextDelay,
  POLL_INTERVAL_MS,
  reducePoll,
  type PollState,
} from '@/components/polling/pollingLogic';
import type { Inspection, InspectionStatus } from '@/types/inspection';

function inspection(status: InspectionStatus): Inspection {
  return {
    id: '9b1f2c4e-6a0d-4c1e-9f8a-2d7e5b3c1a90',
    url: 'https://example.com/',
    status,
    createdAt: '2026-11-13T08:20:00.000Z',
    updatedAt: '2026-11-13T08:20:00.000Z',
    viewports: { desktop: null, mobile: null },
    viewportErrors: { desktop: null, mobile: null },
    analysis: { status: 'pending', analyzedIssueCount: 0 },
    issuesDetected: 0,
    issuesTruncated: false,
    issues: [],
    tasks: [],
  };
}

const ok = (status: InspectionStatus) => ({ type: 'success', inspection: inspection(status) }) as const;
const fail = { type: 'failure', retryable: true } as const;

describe('reducePoll / nextDelay', () => {
  it.each(['completed', 'partial', 'failed'] as const)('종료 상태 %s에서 멈춘다', (status) => {
    const state = reducePoll(INITIAL_POLL_STATE, ok(status));
    expect(state.phase).toBe('done');
    expect(nextDelay(state)).toBeNull();
  });

  it.each(['pending', 'running', 'analyzing'] as const)('%s이면 2초 뒤 다시 조회한다', (status) => {
    const state = reducePoll(INITIAL_POLL_STATE, ok(status));
    expect(state.phase).toBe('active');
    expect(nextDelay(state)).toBe(POLL_INTERVAL_MS);
  });

  it('stopWhen을 만족하면 종료 상태가 아니어도 멈춘다', () => {
    const state = reducePoll(INITIAL_POLL_STATE, ok('analyzing'), { stopWhen: (i) => i.status === 'analyzing' });
    expect(state.phase).toBe('done');
  });

  it('404에서 결과 없음으로 멈춘다', () => {
    const state = reducePoll(INITIAL_POLL_STATE, { type: 'not-found' });
    expect(state.phase).toBe('not-found');
    expect(nextDelay(state)).toBeNull();
  });

  it('연속 실패마다 간격을 늘리고, 최대 횟수를 넘으면 오류로 멈춘다', () => {
    let state: PollState = reducePoll(INITIAL_POLL_STATE, ok('running'));
    const delays: Array<number | null> = [];
    for (let i = 0; i < MAX_ERROR_RETRIES; i += 1) {
      state = reducePoll(state, fail);
      delays.push(nextDelay(state));
    }
    expect(delays).toEqual([...ERROR_RETRY_DELAYS_MS]);
    expect(delays[1]! > delays[0]! && delays[2]! > delays[1]!).toBe(true);
    expect(state.phase).toBe('active');

    state = reducePoll(state, fail);
    expect(state.phase).toBe('error');
    expect(nextDelay(state)).toBeNull();
    // 마지막으로 받은 값은 유지한다
    expect(state.inspection?.status).toBe('running');
  });

  it('성공하면 실패 횟수를 초기화한다', () => {
    let state = reducePoll(INITIAL_POLL_STATE, fail);
    state = reducePoll(state, fail);
    state = reducePoll(state, ok('running'));
    expect(state.failures).toBe(0);
    expect(nextDelay(state)).toBe(POLL_INTERVAL_MS);
  });

  it('다시 시도해도 같은 4xx는 바로 오류로 멈춘다', () => {
    expect(reducePoll(INITIAL_POLL_STATE, { type: 'failure', retryable: false }).phase).toBe('error');
  });

  it('멈춘 뒤의 응답은 상태를 바꾸지 않는다', () => {
    const done = reducePoll(INITIAL_POLL_STATE, ok('completed'));
    expect(reducePoll(done, ok('running'))).toBe(done);
  });
});

/** 수동으로 응답을 돌려주는 가짜 fetch */
function manualFetch() {
  const calls: Array<{ signal: AbortSignal; resolve: (r: FetchInspectionResult) => void }> = [];
  const fetchOnce = (signal: AbortSignal) =>
    new Promise<FetchInspectionResult>((resolve) => {
      calls.push({ signal, resolve });
      signal.addEventListener('abort', () => resolve({ type: 'aborted' }));
    });
  return { calls, fetchOnce };
}

describe('createPoller', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('진입 즉시 조회하고, 응답을 받은 뒤에만 다음 요청을 예약한다', async () => {
    const { calls, fetchOnce } = manualFetch();
    const states: PollState[] = [];
    const poller = createPoller({ fetchOnce, onChange: (s) => states.push(s) });
    poller.start();
    expect(calls).toHaveLength(1);

    // 응답 전에는 시간이 지나도 두 번째 요청이 없다
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(calls).toHaveLength(1);

    calls[0]!.resolve(ok('running'));
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS - 1);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    expect(states.map((s) => s.phase)).toEqual(['active']);
    poller.stop();
  });

  it('종료 상태를 받으면 더 요청하지 않는다', async () => {
    const { calls, fetchOnce } = manualFetch();
    const poller = createPoller({ fetchOnce, onChange: () => {} });
    poller.start();
    calls[0]!.resolve(ok('failed'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it('404를 받으면 더 요청하지 않는다', async () => {
    const { calls, fetchOnce } = manualFetch();
    const states: PollState[] = [];
    const poller = createPoller({ fetchOnce, onChange: (s) => states.push(s) });
    poller.start();
    calls[0]!.resolve({ type: 'not-found' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(states.at(-1)?.phase).toBe('not-found');
  });

  it('실패하면 늘어나는 간격으로 재시도하고 최대 횟수 뒤 멈춘다', async () => {
    const { calls, fetchOnce } = manualFetch();
    const states: PollState[] = [];
    const poller = createPoller({ fetchOnce, onChange: (s) => states.push(s) });
    poller.start();
    for (const delay of ERROR_RETRY_DELAYS_MS) {
      const before = calls.length;
      calls.at(-1)!.resolve(fail);
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(calls).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(before + 1);
    }
    calls.at(-1)!.resolve(fail);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(MAX_ERROR_RETRIES + 1);
    expect(states.at(-1)?.phase).toBe('error');
  });

  it('stop 후에는 진행 중인 요청을 취소하고 추가 요청이 없다', async () => {
    const { calls, fetchOnce } = manualFetch();
    const onChange = vi.fn();
    const poller = createPoller({ fetchOnce, onChange });
    poller.start();
    poller.stop();
    expect(calls[0]!.signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stop 후에는 예약된 요청이 실행되지 않는다', async () => {
    const { calls, fetchOnce } = manualFetch();
    const poller = createPoller({ fetchOnce, onChange: () => {} });
    poller.start();
    calls[0]!.resolve(ok('running'));
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(1);
  });

  it('stop 뒤에 도착한 응답은 무시한다', async () => {
    const onChange = vi.fn();
    let resolve: (r: FetchInspectionResult) => void = () => {};
    // abort를 무시하고 늦게 응답하는 fetch
    const fetchOnce = vi.fn(() => new Promise<FetchInspectionResult>((r) => (resolve = r)));
    const poller = createPoller({ fetchOnce, onChange });
    poller.start();
    poller.stop();
    resolve(ok('running'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it('화면이 숨겨져 있으면 요청을 미루고, 다시 보이면 바로 요청한다', async () => {
    const { calls, fetchOnce } = manualFetch();
    let hidden = false;
    const poller = createPoller({ fetchOnce, onChange: () => {}, isHidden: () => hidden });
    poller.start();
    calls[0]!.resolve(ok('running'));
    hidden = true;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 10);
    expect(calls).toHaveLength(1);
    hidden = false;
    poller.resume();
    expect(calls).toHaveLength(2);
    // 요청 중에 resume을 다시 불러도 중복 요청이 없다
    poller.resume();
    expect(calls).toHaveLength(2);
    poller.stop();
  });
});

describe('fetchInspection', () => {
  const signal = new AbortController().signal;
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it('200을 success로 바꾼다', async () => {
    const result = await fetchInspection('x', signal, respond(200, inspection('running')));
    expect(result).toMatchObject({ type: 'success', inspection: { status: 'running' } });
  });

  it('404를 not-found로 바꾼다', async () => {
    expect(await fetchInspection('x', signal, respond(404, { code: 'NOT_FOUND', message: '' }))).toEqual({ type: 'not-found' });
  });

  it('5xx는 재시도 가능, 그 밖의 4xx는 재시도 불가', async () => {
    expect(await fetchInspection('x', signal, respond(500, {}))).toEqual({ type: 'failure', retryable: true });
    expect(await fetchInspection('x', signal, respond(400, {}))).toEqual({ type: 'failure', retryable: false });
  });

  it('네트워크 오류와 읽을 수 없는 본문은 재시도 가능', async () => {
    const throws = vi.fn(async () => {
      throw new TypeError('network');
    });
    expect(await fetchInspection('x', signal, throws)).toEqual({ type: 'failure', retryable: true });
    expect(await fetchInspection('x', signal, respond(200, { status: 'nope' }))).toEqual({ type: 'failure', retryable: true });
  });

  it('취소된 요청은 aborted로 돌려준다', async () => {
    const controller = new AbortController();
    controller.abort();
    const throws = vi.fn(async () => {
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await fetchInspection('x', controller.signal, throws)).toEqual({ type: 'aborted' });
  });
});
