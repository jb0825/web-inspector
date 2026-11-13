import 'server-only';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import { buildLookup } from '@/server/detect/geometry';
import type { RawIssue } from '@/server/detect/types';
import type { Viewport } from '@/types/inspection';

// Evidence 문장 템플릿 (PRD 5.4.3, DETECTION_RULES 8.1). 문구는 문서 그대로 쓴다.
// 코드가 만든다. LLM을 쓰지 않는다(AGENTS.md 6장 불변 조건 2). 순수 함수만 둔다.

/** `{a 대상}`의 텍스트 길이 */
export const SUBJECT_TEXT_MAX = 20;

const VIEWPORT_LABEL: Record<Viewport, string> = { desktop: 'Desktop', mobile: 'Mobile' };

/** 방향 목록 순서 (8.1): 왼쪽, 오른쪽, 위쪽, 아래쪽 */
const DIRECTIONS = [
  ['overflowLeft', '왼쪽'],
  ['overflowRight', '오른쪽'],
  ['overflowTop', '위쪽'],
  ['overflowBottom', '아래쪽'],
] as const;

/** 숫자는 Math.round한 정수로 넣는다 (8.1) */
const n = (value: number | undefined): number => Math.round(value ?? 0);

/** `{a 대상}`: `tag "textSnippet 앞 20자"`, 텍스트가 없으면 selector (8.1) */
export function subjectLabel(el: Pick<CollectedElement, 'tag' | 'selector' | 'sourceHints'>): string {
  const text = el.sourceHints.textSnippet;
  if (!text) return el.selector;
  // 코드 포인트 단위로 자른다(서로게이트 쌍을 반으로 자르지 않게)
  return `${el.tag} "${Array.from(text).slice(0, SUBJECT_TEXT_MAX).join('')}"`;
}

function elementOf(c: CollectedViewport, index: number): CollectedElement {
  const el = buildLookup(c).get(index);
  if (!el) throw new Error(`Element ${index} not found in ${c.viewport}`);
  return el;
}

function clippedSentence(axis: 'x' | 'y', issue: RawIssue, el: CollectedElement): string {
  const { measured, expected, delta } = issue;
  if (axis === 'x') {
    return `내부 콘텐츠 너비(${n(measured.scrollWidth)}px)가 컨테이너 너비(${n(expected.clientWidth)}px)를 ${n(delta.overflowX)}px 초과합니다. (overflow: ${el.style.overflowX}으로 잘림)`;
  }
  return `내부 콘텐츠 높이(${n(measured.scrollHeight)}px)가 컨테이너 높이(${n(expected.clientHeight)}px)를 ${n(delta.overflowY)}px 초과합니다. (overflow: ${el.style.overflowY}으로 잘림)`;
}

function base(issue: RawIssue, c: CollectedViewport): string {
  const { measured, expected, delta } = issue;
  const vp = VIEWPORT_LABEL[issue.viewport];
  switch (issue.subtype) {
    case 'clipped': {
      if (issue.type !== 'text-overflow' || issue.subtype !== 'clipped') throw new Error('unreachable');
      const el = elementOf(c, issue.elementIndex);
      // 두 축이 모두 넘치면 두 문장을 공백으로 잇는다
      return issue.axes.map((axis) => clippedSentence(axis, issue, el)).join(' ');
    }
    case 'spill': {
      const related = issue.relatedElements[0];
      const container = elementOf(c, related ? related.index : issue.elementIndex);
      const present = DIRECTIONS.filter(([key]) => (delta[key] ?? 0) > 0);
      const maxDelta = Math.max(0, ...present.map(([key]) => delta[key]));
      return `텍스트가 테두리가 있는 상위 영역(${container.tag})의 ${present.map(([, label]) => label).join(', ')} 경계를 최대 ${n(maxDelta)}px 벗어납니다.`;
    }
    case 'interactive':
    case 'text':
    case 'other': {
      const a = elementOf(c, issue.elementIndex);
      const b = elementOf(c, issue.relatedElements[0].index);
      return `${subjectLabel(a)}과 ${subjectLabel(b)}의 표시 영역이 ${n(measured.intersectionArea)}px² 겹칩니다. (작은 요소 면적의 ${n(measured.overlapRatioPercent)}%)`;
    }
    case 'page-scroll':
      return `요소의 오른쪽 끝(${n(measured.elementRight)}px)이 ${vp} 화면 너비(${n(expected.layoutWidth)}px)를 ${n(delta.overflowRight)}px 벗어나 페이지 가로 스크롤이 발생합니다.`;
    case 'element-out': {
      // 양쪽으로 모두 나갔으면 오른쪽 → 왼쪽 문장을 공백으로 잇는다
      const parts: string[] = [];
      if ((delta.overflowRight ?? 0) > 0) {
        parts.push(`요소의 오른쪽 끝(${n(measured.elementRight)}px)이 ${vp} 화면 너비(${n(expected.layoutWidth)}px)를 ${n(delta.overflowRight)}px 벗어납니다.`);
      }
      if ((delta.overflowLeft ?? 0) > 0) {
        parts.push(`요소의 왼쪽 끝(${n(measured.elementLeft)}px)이 화면 왼쪽 경계를 ${n(delta.overflowLeft)}px 벗어납니다.`);
      }
      return parts.join(' ');
    }
    case 'hidden-clip': {
      // overflowRight가 있으면 그 값, 없으면 overflowLeft
      const amount = (delta.overflowRight ?? 0) > 0 ? delta.overflowRight : delta.overflowLeft;
      return `요소가 ${vp} 화면 너비(${n(expected.layoutWidth)}px)를 ${n(amount)}px 벗어나지만, html/body의 overflow-x: hidden 때문에 스크롤 없이 잘립니다.`;
    }
  }
}

/** occurrence 하나의 Evidence 문장. c는 그 occurrence의 viewport 수집 데이터 */
export function evidenceText(issue: RawIssue, c: CollectedViewport): string {
  if (c.viewport !== issue.viewport) throw new Error(`Expected ${issue.viewport} data, got ${c.viewport}`);
  const sentence = base(issue, c);
  if (issue.type === 'viewport-overflow' && issue.affectedDescendants > 0) {
    return `${sentence} 하위 요소 ${issue.affectedDescendants}개가 함께 화면 밖으로 나갑니다.`;
  }
  return sentence;
}
