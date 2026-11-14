import { describe, expect, it } from 'vitest';
import {
  ERROR_MESSAGES,
  errorDetail,
  INSPECTION_STEP_ORDER,
  REQUEST_FALLBACK_MESSAGE,
  requestErrorMessage,
  STATUS_LABELS,
  STEP_LABELS,
} from '@/components/inspection/labels';
import { errorCodeSchema, inspectionStatusSchema } from '@/schemas/enums';
import { INSPECTION_STEPS } from '@/server/store/schemas';

const FORBIDDEN_WORDING = /AI/;

describe('화면 문구 상수', () => {
  it('모든 ErrorCode에 문구가 있다', () => {
    for (const code of errorCodeSchema.options) {
      expect(ERROR_MESSAGES[code], code).toBeTruthy();
    }
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...errorCodeSchema.options].sort());
  });

  it('PRD 6.2.3의 모든 step에 라벨이 있고 순서가 서버와 같다', () => {
    expect([...INSPECTION_STEP_ORDER]).toEqual([...INSPECTION_STEPS]);
    for (const step of INSPECTION_STEPS) expect(STEP_LABELS[step], step).toBeTruthy();
  });

  it('모든 상태에 라벨이 있다', () => {
    for (const status of inspectionStatusSchema.options) expect(STATUS_LABELS[status], status).toBeTruthy();
  });

  it('원인 분석 문구에 "AI"를 쓰지 않는다 (PRD 5.7.1)', () => {
    for (const text of [...Object.values(STATUS_LABELS), ...Object.values(STEP_LABELS), ...Object.values(ERROR_MESSAGES)]) {
      expect(text).not.toMatch(FORBIDDEN_WORDING);
    }
  });

  it('검사 시작 요청 오류는 코드별 문구를 쓰고, 모르는 코드는 기본 문구를 쓴다', () => {
    expect(requestErrorMessage('BLOCKED_TARGET')).toContain('보안상 검사할 수 없는 주소');
    expect(requestErrorMessage('TOO_MANY_INSPECTIONS')).toBe(ERROR_MESSAGES.TOO_MANY_INSPECTIONS);
    expect(requestErrorMessage('INVALID_URL')).toBe(ERROR_MESSAGES.INVALID_URL);
    expect(requestErrorMessage('SOMETHING_ELSE')).toBe(REQUEST_FALLBACK_MESSAGE);
    expect(requestErrorMessage(undefined)).toBe(REQUEST_FALLBACK_MESSAGE);
  });

  it('서버 message는 보조로만 쓰고, 내부 오류는 숨긴다', () => {
    expect(errorDetail({ code: 'HTTP_ERROR', message: 'HTTP 403' })).toBe('HTTP 403');
    expect(errorDetail({ code: 'HTTP_ERROR', message: ERROR_MESSAGES.HTTP_ERROR })).toBeNull();
    expect(errorDetail({ code: 'INTERNAL_ERROR', message: 'stack...' })).toBeNull();
    expect(errorDetail({ code: 'STORAGE_FAILED', message: 'redis down' })).toBeNull();
  });
});
