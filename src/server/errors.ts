import 'server-only';
import type { ErrorCode } from '@/types/inspection';

/**
 * 검사 실패를 PRD 6.2.4의 실패 원인 코드와 함께 던진다(AGENTS.md 9장).
 * message에는 사용자가 입력한 URL 전체나 비밀 값을 넣지 않는다(AGENTS.md 8장).
 */
export class InspectionError extends Error {
  readonly code: ErrorCode;
  /** 실패한 viewport 단계 이름(launch, context, open-and-stabilize, collect, screenshot). 로그용(T14) */
  step: string | undefined;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown; step?: string }) {
    super(message, options);
    this.name = 'InspectionError';
    this.code = code;
    this.step = options?.step;
  }
}

/**
 * 페이지나 브라우저가 죽었거나 닫혔다는 Playwright 오류.
 * 예: "Page crashed", "Target page, context or browser has been closed", "Browser closed", "Target closed"
 */
export function isBrowserGone(error: unknown): boolean {
  return (
    error instanceof Error &&
    /crash|Target (page, context or browser )?(has been )?closed|Browser (has been )?closed|browser has disconnected/i.test(error.message)
  );
}

/**
 * viewport 단계(실행, context, 열기·안정화, 수집, 스크린샷)의 오류를 단계 이름이 붙은 InspectionError로 바꾼다(T14).
 * 결과에 'Unexpected error'(INTERNAL_ERROR)만 남는 경우를 없애기 위해서다. 원래 오류는 cause에 두어 로그에 종류(name)가 남는다.
 * - 이미 InspectionError면 코드는 그대로 두고 단계 이름만 채운다
 * - 브라우저·페이지가 죽었거나 닫힘: BROWSER_CRASH
 * - Playwright 시간 초과(TimeoutError): TIME_BUDGET_EXCEEDED
 * - 그 밖: 단계의 기본 코드(fallback)
 */
export function toStepError(error: unknown, step: string, fallback: ErrorCode): InspectionError {
  if (error instanceof InspectionError) {
    error.step ??= step;
    return error;
  }
  const name = error instanceof Error ? error.name : typeof error;
  if (isBrowserGone(error)) return new InspectionError('BROWSER_CRASH', `Browser closed during ${step}`, { cause: error, step });
  if (error instanceof Error && error.name === 'TimeoutError') {
    return new InspectionError('TIME_BUDGET_EXCEEDED', `${step} timed out`, { cause: error, step });
  }
  return new InspectionError(fallback, `${step} failed (${name})`, { cause: error, step });
}

export function isInspectionError(error: unknown): error is InspectionError {
  return error instanceof InspectionError;
}
