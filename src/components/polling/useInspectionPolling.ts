'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchInspection } from '@/components/api/inspections';
import type { Inspection } from '@/types/inspection';
import { createPoller, INITIAL_POLL_STATE, type PollState } from './pollingLogic';

// API_SPEC 7장. Progress와 Report가 함께 쓴다. 화면 이동 같은 화면 전용 동작은 넣지 않는다.

export interface UseInspectionPollingOptions {
  /** 종료 상태 외에 추가로 멈출 조건 */
  stopWhen?: (inspection: Inspection) => boolean;
}

export interface UseInspectionPollingResult {
  state: PollState;
  /** 오류로 멈춘 뒤 처음부터 다시 조회한다 */
  retry: () => void;
}

export function useInspectionPolling(id: string, options: UseInspectionPollingOptions = {}): UseInspectionPollingResult {
  const [state, setState] = useState<PollState>(INITIAL_POLL_STATE);
  const [attempt, setAttempt] = useState(0);
  const stopWhenRef = useRef(options.stopWhen);

  useEffect(() => {
    stopWhenRef.current = options.stopWhen;
  });

  useEffect(() => {
    const poller = createPoller({
      fetchOnce: (signal) => fetchInspection(id, signal),
      onChange: setState,
      stopWhen: (inspection) => stopWhenRef.current?.(inspection) ?? false,
      isHidden: () => document.visibilityState === 'hidden',
    });
    const onVisibility = () => {
      if (document.visibilityState === 'visible') poller.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    poller.start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      poller.stop();
    };
  }, [id, attempt]);

  const retry = useCallback(() => {
    setState(INITIAL_POLL_STATE);
    setAttempt((n) => n + 1);
  }, []);

  return { state, retry };
}
