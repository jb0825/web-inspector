import type { FetchInspectionResult } from '@/components/api/inspections';
import type { Inspection, InspectionStatus } from '@/types/inspection';

// API_SPEC 7장, PRD 8.4, USER_FLOW 4.7의 polling 규칙. React와 분리한 순수 함수와 타이머 컨트롤러다.

/** 이전 응답을 받은 뒤 다음 요청까지의 간격 */
export const POLL_INTERVAL_MS = 2000;
/** 연속 실패(네트워크 오류, 5xx) 후 다시 시도할 간격. 길이가 최대 재시도 횟수다 */
export const ERROR_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
export const MAX_ERROR_RETRIES = ERROR_RETRY_DELAYS_MS.length;

export const TERMINAL_STATUSES: ReadonlySet<InspectionStatus> = new Set(['completed', 'partial', 'failed']);

export function isTerminalStatus(status: InspectionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * - loading: 첫 응답 전
 * - active: polling 중 (inspection은 마지막으로 받은 값)
 * - done: 종료 상태이거나 호출한 쪽의 stopWhen을 만족해 멈춤
 * - not-found: 404로 멈춤
 * - error: 재시도 횟수를 넘겨 멈춤, 또는 다시 시도해도 소용없는 4xx
 */
export type PollPhase = 'loading' | 'active' | 'done' | 'not-found' | 'error';

export interface PollState {
  phase: PollPhase;
  inspection: Inspection | null;
  /** 연속 실패 횟수. 성공하면 0으로 돌아간다 */
  failures: number;
}

export const INITIAL_POLL_STATE: PollState = { phase: 'loading', inspection: null, failures: 0 };

export interface PollOptions {
  /** 종료 상태 외에 추가로 멈출 조건. 예: Progress는 analyzing부터 멈춘다 */
  stopWhen?: (inspection: Inspection) => boolean;
}

export type PollEvent = Exclude<FetchInspectionResult, { type: 'aborted' }>;

/** 응답 하나를 받아 다음 상태를 정한다 */
export function reducePoll(state: PollState, event: PollEvent, options: PollOptions = {}): PollState {
  if (isStopped(state)) return state;
  switch (event.type) {
    case 'success': {
      const stop = isTerminalStatus(event.inspection.status) || (options.stopWhen?.(event.inspection) ?? false);
      return { phase: stop ? 'done' : 'active', inspection: event.inspection, failures: 0 };
    }
    case 'not-found':
      return { phase: 'not-found', inspection: state.inspection, failures: 0 };
    case 'failure': {
      const failures = state.failures + 1;
      if (!event.retryable || failures > MAX_ERROR_RETRIES) return { phase: 'error', inspection: state.inspection, failures };
      return { ...state, failures };
    }
  }
}

export function isStopped(state: PollState): boolean {
  return state.phase === 'done' || state.phase === 'not-found' || state.phase === 'error';
}

/** 다음 요청까지 기다릴 시간. 멈춰야 하면 null */
export function nextDelay(state: PollState): number | null {
  if (isStopped(state)) return null;
  if (state.failures > 0) return ERROR_RETRY_DELAYS_MS[state.failures - 1] ?? null;
  return POLL_INTERVAL_MS;
}

export interface PollerDeps extends PollOptions {
  fetchOnce: (signal: AbortSignal) => Promise<FetchInspectionResult>;
  onChange: (state: PollState) => void;
  /** 화면이 숨겨졌는지. 숨겨져 있으면 예약 시각에 요청하지 않고 다시 보일 때 바로 요청한다(API_SPEC 7장) */
  isHidden?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Poller {
  /** 첫 요청을 바로 보낸다 */
  start(): void;
  /** 예약된 요청과 진행 중인 요청을 정리한다. 이후 어떤 요청도 보내지 않는다 */
  stop(): void;
  /** 화면이 다시 보일 때 호출한다. 대기 중이던 요청을 바로 보낸다 */
  resume(): void;
}

/**
 * 요청은 항상 하나만 진행한다. 응답을 받은 뒤에만 다음 요청을 예약한다(setInterval 쓰지 않음).
 */
export function createPoller(deps: PollerDeps): Poller {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const isHidden = deps.isHidden ?? (() => false);

  let state = INITIAL_POLL_STATE;
  let stopped = false;
  let timer: unknown = null;
  let controller: AbortController | null = null;
  /** 숨겨진 동안 예약 시각이 지나 요청을 미룬 상태 */
  let deferred = false;

  const schedule = () => {
    const delay = nextDelay(state);
    if (delay === null) return;
    timer = setTimer(() => {
      timer = null;
      tick();
    }, delay);
  };

  const tick = () => {
    if (stopped || controller) return;
    if (isHidden()) {
      deferred = true;
      return;
    }
    deferred = false;
    const current = new AbortController();
    controller = current;
    void deps.fetchOnce(current.signal).then((result) => {
      if (controller === current) controller = null;
      if (stopped || result.type === 'aborted') return;
      state = reducePoll(state, result, deps);
      deps.onChange(state);
      schedule();
    });
  };

  return {
    start() {
      if (stopped) return;
      tick();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      controller?.abort();
      controller = null;
    },
    resume() {
      if (stopped || !deferred) return;
      tick();
    },
  };
}
