// WIREFRAME 3.4, 4.5: "다시 시도"·"다시 검사"는 새 검사를 바로 만들지 않고, URL을 sessionStorage에 넣고 Home으로 이동한다.
// query string으로 넘기면 검사 대상 URL 전체가 서버 접근 로그에 남는다(AGENTS.md 8장).
// 저장소 접근은 사생활 보호 모드 등에서 예외를 던질 수 있으므로 모두 try/catch로 감싸고, 실패하면 빈 입력창으로 동작한다.

export const RETRY_URL_STORAGE_KEY = 'inspector:retry-url';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function sessionStore(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** 다시 시도할 URL을 저장한다. 저장하지 못하면 false (Home은 빈 입력창으로 열린다) */
export function stashRetryUrl(url: string, storage: StorageLike | null = sessionStore()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(RETRY_URL_STORAGE_KEY, url);
    return true;
  } catch {
    return false;
  }
}

/** 저장된 URL을 읽고 바로 지운다. 새로고침하면 다시 채우지 않는다 */
export function takeRetryUrl(storage: StorageLike | null = sessionStore()): string | null {
  if (!storage) return null;
  try {
    const value = storage.getItem(RETRY_URL_STORAGE_KEY);
    storage.removeItem(RETRY_URL_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}
