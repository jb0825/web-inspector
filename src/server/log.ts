import 'server-only';

// 구조화 로그 한 줄(JSON). 검사 ID, 호스트, 단계, 오류 코드, 소요 시간만 남긴다.
// 입력 URL 전체, 쿼리 문자열, 비밀 값은 넣지 않는다(AGENTS.md 8장, API_SPEC 2.6). 필드 이름을 제한해 실수로 넣지 못하게 한다.

export interface LogFields {
  id?: string;
  host?: string;
  step?: string;
  viewport?: string;
  status?: string;
  code?: string;
  durationMs?: number;
  attempt?: number;
  httpStatus?: number;
  /** 단계별 소요 시간(ms). 예: { gotoMs, stabilizeMs, collectMs, screenshotMs } */
  timings?: Record<string, number>;
  /** 저장소·설정 실패의 원인 요약. describeFailure로만 만든다 */
  cause?: string;
}

export type Logger = (event: string, fields: LogFields) => void;

const CAUSE_MAX = 240;

/**
 * 예상하지 못한 실패의 원인을 로그 한 줄로 요약한다. 운영에서 STORAGE_FAILED 원인을 찾기 위해 둔다(T13).
 * - EnvError: 메시지에 변수 이름만 있다(값은 없다, env.ts)
 * - Upstash 오류: 서버가 돌려준 오류 문구(예: WRONGPASS, max requests limit). 토큰은 들어 있지 않다
 * - 네트워크 오류: Node fetch의 cause 코드(예: ENOTFOUND)
 * URL과 토큰 형태의 문자열은 지운 뒤 길이를 자른다(AGENTS.md 8장).
 */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  let text = `${error.name}: ${error.message}`;
  const cause = (error as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') text += ` (${cause.code})`;
  // InspectionError가 감싼 원래 오류(예: 시간 제한으로 끊긴 Playwright 호출)도 한 단계만 붙인다
  if (cause instanceof Error) text += ` <- ${cause.name}: ${cause.message}`;
  return text
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/[A-Za-z0-9_-]{32,}/g, '<redacted>')
    .slice(0, CAUSE_MAX);
}

export type LogLevel = 'info' | 'warn' | 'error';

/**
 * 이벤트 이름으로 로그 레벨을 정한다. Vercel 로그는 console.error/warn을 error/warning 레벨로 표시한다.
 * - error: 실패(…-failed, …-timeout, unexpected, read-invalid, analyze-config-missing)
 * - warn: 정상 처리되지만 사용자가 원하는 결과를 받지 못한 경우(동시 실행 초과, 시간 부족으로 viewport 건너뜀)
 */
export function logLevelOf(event: string): LogLevel {
  if (event.endsWith('-failed') || event.endsWith('-timeout') || event === 'unexpected' || event === 'read-invalid' || event === 'analyze-config-missing')
    return 'error';
  if (event === 'create-rejected' || event === 'viewport-skipped') return 'warn';
  return 'info';
}

export const logEvent: Logger = (event, fields) => {
  const level = logLevelOf(event);
  const line = JSON.stringify({ scope: 'inspection', level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};
