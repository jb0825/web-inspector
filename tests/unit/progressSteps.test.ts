import { describe, expect, it } from 'vitest';
import { buildStepViews, elapsedRange, isReportReady } from '@/features/inspection-progress/steps';
import type { Inspection } from '@/types/inspection';

type StepInput = Parameters<typeof buildStepViews>[0];

const base: StepInput = {
  status: 'running',
  viewportErrors: { desktop: null, mobile: null },
  analysis: { status: 'pending', analyzedIssueCount: 0 },
};

const states = (input: StepInput) => buildStepViews(input).map((s) => s.state);

describe('buildStepViews', () => {
  it('pending이면 모두 대기', () => {
    expect(states({ ...base, status: 'pending' })).toEqual(Array(7).fill('pending'));
  });

  it('running이면 현재 step 앞은 완료, 현재는 진행 중', () => {
    expect(states({ ...base, step: 'rendering_mobile' })).toEqual(['done', 'done', 'current', 'pending', 'pending', 'pending', 'pending']);
  });

  it('모르는 step이면 모두 대기로 둔다', () => {
    expect(states({ ...base, step: 'unknown' })).toEqual(Array(7).fill('pending'));
  });

  it('failed면 실패한 step과 오류가 있는 viewport step을 실패로 표시한다', () => {
    const timeout = { code: 'NAVIGATION_TIMEOUT', message: '' } as const;
    const views = buildStepViews({
      ...base,
      status: 'failed',
      step: 'rendering_mobile',
      error: timeout,
      viewportErrors: { desktop: timeout, mobile: timeout },
    });
    expect(views.map((v) => v.state)).toEqual(['done', 'failed', 'failed', 'pending', 'pending', 'pending', 'pending']);
    expect(views[1]!.error?.code).toBe('NAVIGATION_TIMEOUT');
  });

  it('viewport가 아닌 단계에서 실패하면 Inspection 오류를 붙인다', () => {
    const views = buildStepViews({ ...base, status: 'failed', step: 'saving_results', error: { code: 'STORAGE_FAILED', message: '' } });
    expect(views[4]).toMatchObject({ state: 'failed', error: { code: 'STORAGE_FAILED' } });
  });
});

describe('isReportReady', () => {
  it('analyzing부터 결과 화면으로 이동한다', () => {
    expect(['pending', 'running', 'failed'].map((s) => isReportReady(s as Inspection['status']))).toEqual([false, false, false]);
    expect(['analyzing', 'completed', 'partial'].map((s) => isReportReady(s as Inspection['status']))).toEqual([true, true, true]);
  });
});

describe('elapsedRange', () => {
  const times = { createdAt: 'c', updatedAt: 'u' };
  it('startedAt이 있어도 createdAt 기준 (WIREFRAME 4.3)', () => {
    expect(elapsedRange({ ...times, status: 'pending' })).toEqual({ startIso: 'c', endIso: null });
    expect(elapsedRange({ ...times, status: 'running' })).toEqual({ startIso: 'c', endIso: null });
  });
  it('종료 상태면 completedAt(없으면 updatedAt)에서 멈춘다', () => {
    expect(elapsedRange({ ...times, completedAt: 'd', status: 'failed' })).toEqual({ startIso: 'c', endIso: 'd' });
    expect(elapsedRange({ ...times, status: 'failed' })).toEqual({ startIso: 'c', endIso: 'u' });
  });
});
