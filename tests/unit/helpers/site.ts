import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import type { Viewport } from '@/types/inspection';
import { collected, el, r } from './collected';

// 세 유형(겹침, spill, page-scroll)이 모두 나오는 작은 페이지. pipeline, finalize, invariants 테스트가 함께 쓴다.

/** 두 viewport에 같은 testId로 같은 구성을 둔 페이지. Mobile에서만 600px 박스가 넘친다 */
export function site(viewport: Viewport): CollectedViewport {
  const mobile = viewport === 'mobile';
  const elements: CollectedElement[] = [
    // 고정 너비 박스와 자손 (Mobile에서만 page-scroll)
    el({ index: 1, rect: r(16, 100, 600, 100), testId: 'box' }),
    el({ index: 2, ancestors: [1], rect: r(420, 110, 180, 60), textRects: [r(430, 120, 150, 20)], testId: 'box-child' }),
    // 겹친 버튼 두 개 (양쪽)
    el({ index: 3, tag: 'button', rect: r(16, 300, 100, 44), textRects: [r(30, 312, 60, 20)], flags: { interactive: true }, testId: 'save' }),
    el({ index: 4, tag: 'button', rect: r(80, 304, 100, 44), textRects: [r(94, 316, 60, 20)], flags: { interactive: true }, testId: 'cancel' }),
    // spill 카드 (양쪽, 첫 화면 밖)
    el({ index: 5, rect: r(16, 1500, 300, 100), style: { backgroundColor: 'rgb(255, 248, 197)', paddingSum: 32 }, testId: 'card' }),
    el({ index: 6, ancestors: [5], tag: 'p', rect: r(32, 1516, 268, 120), textRects: [r(32, 1516, 260, 24), r(32, 1610, 200, 24)], testId: 'card-text' }),
  ];
  return collected(viewport, elements, mobile ? { documentScrollWidth: 616 } : {});
}

