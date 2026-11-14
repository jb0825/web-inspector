// PRD 8.3, API_SPEC 2~6장의 요청·응답 타입. 런타임 코드를 두지 않는다.
import type { ErrorCode, Inspection } from './inspection';

/** API 응답 전용 코드. PRD 6.2.4의 검사 실패 코드와 섞지 않는다(API_SPEC 9.2-9) */
export type ApiOnlyErrorCode = 'NOT_FOUND' | 'INVALID_STATE' | 'UNAUTHORIZED';

export type ApiErrorCode = ErrorCode | ApiOnlyErrorCode;

/** 오류 응답 본문 (API_SPEC 2.1). message는 사용자에게 보여줄 수 있는 한국어 문구 */
export interface ApiError {
  code: ApiErrorCode;
  message: string;
}

/** POST /api/inspections 요청 본문 */
export interface CreateInspectionRequest {
  url: string;
}

/** POST /api/inspections 202 */
export interface CreateInspectionResponse {
  id: string;
}

/** GET /api/inspections/:id 200. 저장된 문서 그대로 (DOMAIN_MODEL 8장) */
export type GetInspectionResponse = Inspection;

/** POST /api/inspections/:id/cancel 200. 중지 후 문서(status: failed, error.code: CANCELLED) */
export type CancelInspectionResponse = Inspection;

/** POST /api/inspections/:id/analyze 202 */
export type AnalyzeResponse = Record<string, never>;
