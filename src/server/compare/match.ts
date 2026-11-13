import 'server-only';
import type { CollectedElement } from '@/server/collect/types';

// Desktop / Mobile 요소 매칭 (PRD 5.6, DETECTION_RULES 7.2). 순수 함수다.

type Criterion = (d: CollectedElement, m: CollectedElement) => boolean;

/** 매칭 기준 3단계. 위에서부터 시도한다 */
export const MATCH_CRITERIA: readonly Criterion[] = [
  // 1. id 또는 data-testid가 있고 같음
  (d, m) =>
    (d.identity.id !== undefined && d.identity.id === m.identity.id) ||
    (d.identity.testId !== undefined && d.identity.testId === m.identity.testId),
  // 2. selector가 같음
  (d, m) => d.selector === m.selector,
  // 3. landmark, 태그, textSnippet이 모두 같고 textSnippet이 비어 있지 않음
  (d, m) => {
    const snippet = d.sourceHints.textSnippet;
    return (
      snippet !== undefined &&
      snippet !== '' &&
      snippet === m.sourceHints.textSnippet &&
      d.tag === m.tag &&
      d.sourceHints.landmark === m.sourceHints.landmark
    );
  },
];

export interface ElementMatching {
  /** desktop index → mobile index */
  desktopToMobile: ReadonlyMap<number, number>;
  /** mobile index → desktop index */
  mobileToDesktop: ReadonlyMap<number, number>;
}

/**
 * 1:1 매칭. 기준 1로 가능한 짝을 모두 정한 뒤, 남은 요소끼리 기준 2, 그다음 기준 3을 시도한다.
 * 한 기준에서 desktop 요소는 문서 순서대로 짝을 찾고, 후보가 여럿이면 문서 순서상 가장 앞의 mobile 요소를 고른다.
 * 이미 짝지어진 요소는 다시 쓰지 않는다.
 * 매칭은 이슈가 있는 요소에 대해서만 계산하므로, 호출하는 쪽이 그 요소만 넘긴다(7.2).
 */
export function matchElements(desktop: readonly CollectedElement[], mobile: readonly CollectedElement[]): ElementMatching {
  const ds = [...desktop].sort((a, b) => a.index - b.index);
  const ms = [...mobile].sort((a, b) => a.index - b.index);
  const desktopToMobile = new Map<number, number>();
  const mobileToDesktop = new Map<number, number>();

  for (const criterion of MATCH_CRITERIA) {
    for (const d of ds) {
      if (desktopToMobile.has(d.index)) continue;
      const m = ms.find((candidate) => !mobileToDesktop.has(candidate.index) && criterion(d, candidate));
      if (!m) continue;
      desktopToMobile.set(d.index, m.index);
      mobileToDesktop.set(m.index, d.index);
    }
  }
  return { desktopToMobile, mobileToDesktop };
}
