import type { ApiErrorCode } from '@/types/api';
import type { ErrorCode, InspectionStatus } from '@/types/inspection';

// 상태, 단계, 실패 코드의 화면 문구를 한 곳에 모은다.
// 원인 분석은 지금 규칙 기반이므로(PRD 5.7.1) "AI 분석" 같은 표현을 쓰지 않는다.

/** PRD 6.2.1 상태 라벨 (DESIGN_GUIDE 6.4. analyzing은 "AI 분석 중" 대신 중립 표현) */
export const STATUS_LABELS: Record<InspectionStatus, string> = {
  pending: '대기 중',
  running: '검사 중',
  analyzing: '원인 분석 중',
  completed: '완료',
  partial: '일부 실패',
  failed: '실패',
};

/** PRD 6.2.3 단계. 순서가 곧 화면 표시 순서다. 서버의 INSPECTION_STEPS와 같은지 단위 테스트로 확인한다 */
export const INSPECTION_STEP_ORDER = [
  'initializing_browser',
  'rendering_desktop',
  'rendering_mobile',
  'detecting_issues',
  'saving_results',
  'analyzing_issues',
  'generating_tasks',
] as const;

export type InspectionStepName = (typeof INSPECTION_STEP_ORDER)[number];

/** USER_FLOW 4.3 (analyzing_issues는 "AI 원인 분석" 대신 "원인 분석") */
export const STEP_LABELS: Record<InspectionStepName, string> = {
  initializing_browser: '브라우저 준비',
  rendering_desktop: 'Desktop 렌더링 및 측정',
  rendering_mobile: 'Mobile 렌더링 및 측정',
  detecting_issues: 'UI 문제 탐지',
  saving_results: '검사 결과 저장',
  analyzing_issues: '원인 분석',
  generating_tasks: '개발 태스크와 프롬프트 생성',
};

export function isInspectionStep(value: string | undefined): value is InspectionStepName {
  return value !== undefined && (INSPECTION_STEP_ORDER as readonly string[]).includes(value);
}

/**
 * PRD 6.2.4 실패 코드별 문구 (USER_FLOW 9장). 검사 결과(`error`, `viewportErrors`, `analysis.error`)에 쓴다.
 * 서버의 message는 보조 정보로만 보여준다(errorDetail).
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  INVALID_URL: '올바른 http:// 또는 https:// 주소가 아닙니다.',
  BLOCKED_TARGET: '리다이렉트된 주소가 보안 정책상 차단되었습니다.',
  TOO_MANY_INSPECTIONS: '다른 검사가 진행 중입니다. 잠시 후 다시 시도해 주세요.',
  NAVIGATION_TIMEOUT: '제한 시간 안에 페이지를 불러오지 못했습니다.',
  NAVIGATION_FAILED: '페이지에 연결하지 못했습니다.',
  HTTP_ERROR: '페이지가 오류를 반환했습니다. 봇 차단 때문일 수도 있습니다.',
  BROWSER_CRASH: '검사 브라우저가 비정상 종료되었습니다.',
  DETECTION_FAILED: '페이지를 측정하거나 문제를 탐지하는 중 오류가 발생했습니다.',
  TIME_BUDGET_EXCEEDED: '검사 제한 시간 안에 끝내지 못했습니다.',
  STORAGE_FAILED: '검사 결과를 저장하지 못했습니다.',
  AI_FAILED: '원인 분석 단계를 끝내지 못했습니다. 측정 결과는 그대로 볼 수 있습니다.',
  INTERNAL_ERROR: '일시적인 오류가 발생했습니다.',
};

/** 검사 시작 요청(POST /api/inspections) 응답에 쓰는 문구. 검사 결과와 뜻이 다른 코드만 덮어쓴다 (USER_FLOW 3.6, 9.2) */
const REQUEST_ERROR_MESSAGES: Partial<Record<ApiErrorCode, string>> = {
  BLOCKED_TARGET: '보안상 검사할 수 없는 주소입니다. localhost, 사설 IP 같은 내부 주소는 검사할 수 없습니다.',
  STORAGE_FAILED: '검사를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
};

/** 응답을 받지 못했거나 알 수 없는 코드일 때 */
export const REQUEST_FALLBACK_MESSAGE = '검사를 시작하지 못했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.';

export function requestErrorMessage(code: string | undefined): string {
  if (code === undefined) return REQUEST_FALLBACK_MESSAGE;
  const override = REQUEST_ERROR_MESSAGES[code as ApiErrorCode];
  if (override) return override;
  return code in ERROR_MESSAGES ? ERROR_MESSAGES[code as ErrorCode] : REQUEST_FALLBACK_MESSAGE;
}

/** 내부 오류 내용을 화면에 보이지 않는 코드 (USER_FLOW 9.11) */
const HIDE_SERVER_MESSAGE: ReadonlySet<ErrorCode> = new Set(['INTERNAL_ERROR', 'STORAGE_FAILED']);

/** 서버 message를 보조로 보여줄지 정한다. 코드 문구와 같거나 숨길 코드면 null */
export function errorDetail(error: { code: ErrorCode; message: string }): string | null {
  if (HIDE_SERVER_MESSAGE.has(error.code)) return null;
  const message = error.message.trim();
  if (!message || message === ERROR_MESSAGES[error.code]) return null;
  return message;
}
