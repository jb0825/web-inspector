import { launchBrowser } from '@/server/browser/launch';
import { renderViewport, type RenderedViewport } from '@/server/browser/render';
import { inspectViewportInFreshBrowser } from '@/server/browser/session';
import type { Viewport } from '@/types/inspection';
import { fixtureGuard } from './server';

// 로컬 하네스(test:fixtures, --page)가 viewport 하나를 검사하는 경로. runInspection과 같은 함수
// (inspectViewportInFreshBrowser: viewport마다 실행 → 검사 → 닫기, 단계별 강제 시간 제한)를 쓴다(AGENTS.md 7장).
// 운영과 다른 점은 guard뿐이다: Fixture 서버 호스트만 허용한다(PRD 8.6 테스트 예외).

/** 로컬 하네스의 viewport 시간 예산. 운영 전체 상한(180초)과 같게 둔다 */
export const LOCAL_VIEWPORT_TIME_LIMIT_MS = 180_000;

export function inspectLocalViewport(url: string, viewport: Viewport): Promise<RenderedViewport> {
  return inspectViewportInFreshBrowser({ launchBrowser, renderViewport }, viewport, url, {
    guard: fixtureGuard(url),
    timeLimitMs: LOCAL_VIEWPORT_TIME_LIMIT_MS,
  });
}
