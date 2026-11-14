import type { ApiErrorCode } from '@/types/api';
import type { ErrorCode, InspectionStatus, Issue, IssueType, Viewport } from '@/types/inspection';

type AnalysisSource = NonNullable<Issue['analysis']>['source'];

// 상태, 단계, 실패 코드의 화면 문구를 한 곳에 모은다.
// 원인 분석은 지금 규칙 기반이므로(PRD 5.7.1) "AI 분석" 같은 표현을 쓰지 않는다.

/** PRD 6.2.1 상태 라벨 (DESIGN_GUIDE 6.4. analyzing은 "AI 분석 중" 대신 "분석 중", T12) */
export const STATUS_LABELS: Record<InspectionStatus, string> = {
  pending: '대기 중',
  running: '검사 중',
  analyzing: '분석 중',
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
  CANCELLED: '검사를 중지했습니다.',
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
const HIDE_SERVER_MESSAGE: ReadonlySet<ErrorCode> = new Set(['INTERNAL_ERROR', 'STORAGE_FAILED', 'CANCELLED']);

/** 서버 message를 보조로 보여줄지 정한다. 코드 문구와 같거나 숨길 코드면 null */
export function errorDetail(error: { code: ErrorCode; message: string }): string | null {
  if (HIDE_SERVER_MESSAGE.has(error.code)) return null;
  const message = error.message.trim();
  if (!message || message === ERROR_MESSAGES[error.code]) return null;
  return message;
}

// ── 결과 화면 (T12) ───────────────────────────────────────────────
// 원인 분석은 규칙 기반이다(PRD 5.7.1). "AI"는 analysis.source === 'ai'를 표시하는 ANALYSIS_SOURCE_LABELS.ai에만 쓴다.

/** PRD 5.4.4 type 라벨. 코드 값과 연결되므로 영문 그대로 (WIREFRAME 1.4) */
export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  'text-overflow': 'Text Overflow',
  'element-overlap': 'Element Overlap',
  'viewport-overflow': 'Viewport Overflow',
};

export const VIEWPORT_LABELS: Record<Viewport, string> = { desktop: 'Desktop', mobile: 'Mobile' };

/** 한 viewport가 실패한 검사의 viewportTag(null) 표시 (PRD 5.6) */
export const VIEWPORT_TAG_UNAVAILABLE = '비교 불가';

/** PRD 7.4의 출처 표시. WIREFRAME의 "AI 추론"은 source가 ai일 때만 쓴다 */
export const ANALYSIS_SOURCE_LABELS: Record<AnalysisSource, string> = {
  rule: '규칙 기반 추정',
  ai: 'AI 추론',
};

/** USER_FLOW 6.6의 분석이 없는 이유별 문구 ("AI"를 원인 분석으로 바꿈) */
export const ANALYSIS_UNAVAILABLE_MESSAGES = {
  analyzing: '원인 분석 중입니다.',
  'needs-review': '검토 필요 항목은 원인 분석 대상이 아닙니다.',
  'limit-exceeded': '우선순위가 높은 이슈만 원인 분석 대상입니다.',
  'ai-failed': '원인 분석을 가져오지 못했습니다. Evidence와 Source Hints로 직접 확인해 주세요.',
  /** 이유가 기록되지 않은 경우 */
  unknown: '이 이슈에는 원인 분석 결과가 없습니다.',
} as const satisfies Record<NonNullable<Issue['analysisSkippedReason']> | 'analyzing' | 'unknown', string>;

/** WIREFRAME 5.4 검사 범위 안내 (T12: "AI 실패"는 원인 분석 표현으로 바꾸고, "AI 분석 대상 초과"는 두지 않는다) */
export const SCOPE_NOTICE_MESSAGES = {
  viewportFailed: (failed: string, reason: string, succeeded: string) => `${failed} 검사에 실패했습니다: ${reason} ${succeeded} 결과만 표시합니다.`,
  screenshotTruncated: (viewport: string, height: string) => `${viewport} 스크린샷은 ${height}px까지만 저장되었습니다. (측정은 전체 페이지)`,
  elementsTruncated: (viewport: string, count: string) => `요소가 많아 ${viewport} 문서 앞쪽 ${count}개만 검사했습니다.`,
  issuesTruncated: (detected: string, shown: string) => `이슈가 ${detected}개 발견되어 우선순위가 높은 상위 ${shown}개만 표시합니다.`,
  canvas: 'canvas 영역 안의 그래픽은 검사하지 않았습니다.',
  noMetaViewport: (layoutWidth: string) => `이 페이지에는 meta viewport가 없어 Mobile 화면 너비가 ${layoutWidth}px로 측정되었습니다.`,
  analysisFailedWithTasks: '원인 분석을 가져오지 못했습니다. 측정 결과와 태스크는 그대로 사용할 수 있습니다.',
  /** 분석 단계 실패 시 서버는 tasks를 비운다(DETECTION_RULES 13장). 태스크가 없으면 태스크를 언급하지 않는다 */
  analysisFailedWithoutTasks: '원인 분석을 가져오지 못했습니다. 측정 결과는 그대로 볼 수 있습니다.',
  overlays: (viewport: string, selectors: string) => `${viewport} 화면을 크게 덮는 고정 요소가 있어 겹침 판정에서 제외했습니다: ${selectors}`,
} as const;

/** DOMAIN_MODEL 8장: 공유 URL로 공개되는 정보 */
export const SHARE_DISCLOSURE =
  '이 결과는 링크를 아는 누구나 볼 수 있습니다. 검사 URL, 페이지 텍스트 일부(텍스트와 HTML 조각), 스크린샷이 포함되며 7일 동안 보관됩니다.';

/** WIREFRAME 7.7 태스크 탭 상태 */
export const TASK_TAB_MESSAGES = {
  analyzing: '원인 분석과 태스크 생성 중입니다.',
  empty: '생성된 태스크가 없습니다.',
  analysisFailed: '원인 분석 없이 만든 태스크입니다.',
  /** 분석 단계가 실패해 태스크가 없는 경우 */
  analysisFailedNoTasks: '원인 분석 단계를 끝내지 못해 태스크를 만들지 못했습니다. 이슈 탭에서 측정 결과를 확인해 주세요.',
  allTemplateTitles: '태스크 제목은 검사 결과로 자동 생성했습니다.',
  templateTitle: '자동 제목',
} as const;

/** WIREFRAME 5.12 / USER_FLOW 5.9 */
export const NO_ISSUES_MESSAGES = {
  title: '검사한 항목에서 문제가 발견되지 않았습니다',
  body: 'Text Overflow, Element Overlap, Viewport Overflow 외의 문제는 검사하지 않았습니다. 다른 유형의 문제가 없다는 뜻은 아닙니다.',
} as const;
