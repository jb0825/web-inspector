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
}

export type Logger = (event: string, fields: LogFields) => void;

export const logEvent: Logger = (event, fields) => {
  console.log(JSON.stringify({ scope: 'inspection', event, ...fields }));
};
