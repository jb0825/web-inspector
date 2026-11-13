import 'server-only';
import { InspectionError } from '@/server/errors';
import { isLookupFailure, type HostChecker } from './ssrf';

// 입력 URL 검증 (PRD 5.1, 8.6, API_SPEC 3.1). 실제 허용 여부의 기준은 이 함수다(클라이언트 검사는 편의용).
// 입력은 src/schemas/inspectionRequest.ts(trim, 길이)를 통과한 문자열이라고 가정한다.
// 오류 메시지에 입력 URL을 넣지 않는다(AGENTS.md 8장).

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** DNS 조회 실패 메시지의 앞부분. API 응답에서 "주소를 찾을 수 없습니다" 문구를 고르는 데 쓴다(API_SPEC 3.1-6) */
export const HOST_LOOKUP_FAILED_MESSAGE = 'Host lookup failed';

/**
 * WHATWG URL로 파싱해 판정하고 정규화한 URL을 돌려준다. `#fragment`는 버린다(API_SPEC 3.1).
 * - 형식 오류, http/https 아님, 계정 정보, DNS 조회 실패 → INVALID_URL
 * - 금지 대상 → BLOCKED_TARGET
 * IP 표기(10진수 `2130706433`, 16진수 `0x7f000001`, 축약형 `127.1`)는 파서가 정규화한 호스트로 판정한다.
 */
export async function validateInspectionUrl(input: string, checker: HostChecker): Promise<URL> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InspectionError('INVALID_URL', 'URL could not be parsed');
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new InspectionError('INVALID_URL', 'Only http and https URLs are supported');
  if (url.username !== '' || url.password !== '') throw new InspectionError('INVALID_URL', 'URL must not contain credentials');
  if (url.hostname === '') throw new InspectionError('INVALID_URL', 'URL has no host');

  const result = await checker.check(url.hostname);
  if (!result.allowed) {
    if (isLookupFailure(result)) throw new InspectionError('INVALID_URL', `${HOST_LOOKUP_FAILED_MESSAGE} (${result.reason})`);
    throw new InspectionError('BLOCKED_TARGET', `Blocked target (${result.reason})`);
  }
  url.hash = '';
  return url;
}
