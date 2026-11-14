import { inspectionRequestSchema } from '@/schemas/inspectionRequest';

// USER_FLOW 3.4, 3.6: 입력 편의를 위한 형식 확인. 허용 여부(금지 대상, 계정 정보)는 서버만 판정한다(AGENTS.md 3.1).

export type UrlInputError = 'empty' | 'protocol' | 'invalid';

export type NormalizeUrlResult = { ok: true; url: string } | { ok: false; error: UrlInputError };

export const URL_INPUT_MESSAGES: Record<UrlInputError, string> = {
  empty: '검사할 URL을 입력해 주세요.',
  protocol: 'http:// 또는 https:// 주소만 검사할 수 있습니다.',
  invalid: '올바른 URL 형식이 아닙니다. 예: https://example.com',
};

/** `https://`, `ftp://` 처럼 `//`가 붙은 스킴 */
const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
/** `mailto:`, `javascript:` 처럼 `//` 없는 스킴. `example.com:8080`(콜론 뒤 숫자)은 포트로 본다 */
const SCHEME_WITHOUT_SLASHES = /^[a-z][a-z0-9+.-]*:(?!\d)/i;

/**
 * 앞뒤 공백을 지우고, 스킴이 없으면 `https://`를 붙인다(PRD에 없던 결정, USER_FLOW 3.6).
 * 돌려주는 url은 서버로 보낼 문자열이다. 정규화(소문자화, fragment 제거)는 서버가 한다.
 */
export function normalizeUrlInput(raw: string): NormalizeUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'empty' };

  let candidate = trimmed;
  if (!SCHEME_WITH_SLASHES.test(trimmed)) {
    if (SCHEME_WITHOUT_SLASHES.test(trimmed)) return { ok: false, error: 'protocol' };
    candidate = `https://${trimmed}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, error: 'invalid' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { ok: false, error: 'protocol' };
  if (!parsed.hostname) return { ok: false, error: 'invalid' };

  if (!inspectionRequestSchema.safeParse({ url: candidate }).success) return { ok: false, error: 'invalid' };
  return { ok: true, url: candidate };
}
