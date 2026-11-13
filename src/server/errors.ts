import 'server-only';
import type { ErrorCode } from '@/types/inspection';

/**
 * 검사 실패를 PRD 6.2.4의 실패 원인 코드와 함께 던진다(AGENTS.md 9장).
 * message에는 사용자가 입력한 URL 전체나 비밀 값을 넣지 않는다(AGENTS.md 8장).
 */
export class InspectionError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InspectionError';
    this.code = code;
  }
}

export function isInspectionError(error: unknown): error is InspectionError {
  return error instanceof InspectionError;
}
