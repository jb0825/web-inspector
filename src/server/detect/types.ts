import type { Issue, IssueType, Priority, Rect, RelatedElement, Viewport, ViewportTag } from '@/types/inspection';

// viewport 하나 안에서 탐지 함수가 만드는 이슈 후보. 서버 안에서만 쓴다(AGENTS.md 3.1).
// T06(Dedup·병합·ID), T07(Evidence·Priority)이 이 타입만 보고 IssueOccurrence를 만들 수 있게
// IssueOccurrence(src/types/inspection.ts)와 같은 이름을 쓰고, 요소는 selector 대신 index로 가리킨다.

/** DETECTION_RULES 1.1: type별로 허용되는 subtype (DOMAIN_MODEL S-12) */
export interface SubtypeByType {
  'text-overflow': 'clipped' | 'spill';
  'element-overlap': 'interactive' | 'text' | 'other';
  'viewport-overflow': 'page-scroll' | 'element-out' | 'hidden-clip';
}

/** RelatedElement에서 selector, tag, boundingBox는 index로 요소를 찾아 T07에서 채운다 */
export interface RawRelatedElement {
  role: RelatedElement['role'];
  index: number;
}

interface RawIssueBase {
  viewport: Viewport;
  /** 대상 요소의 CollectedElement.index */
  elementIndex: number;
  /** 대상 요소의 rect (Overlap은 a의 rect, DETECTION_RULES 5.6). 문서 기준 */
  boundingBox: Rect;
  /** DETECTION_RULES 4~6장의 측정값 표 */
  measured: Record<string, number>;
  expected: Record<string, number>;
  delta: Record<string, number>;
  relatedElements: RawRelatedElement[];
  /** 기본 1.0 (DEFAULT_CONFIDENCE) */
  confidence: number;
}

export type TextOverflowIssue =
  | (RawIssueBase & {
      type: 'text-overflow';
      subtype: 'clipped';
      /** 잘린 축 (DETECTION_RULES 4.1) */
      axes: ('x' | 'y')[];
    })
  | (RawIssueBase & { type: 'text-overflow'; subtype: 'spill' });

/**
 * (viewport, 대상 요소 a, subtype)마다 하나다(DETECTION_RULES 5.6).
 * measured에는 대표 쌍의 intersectionArea, overlapRatioPercent와 전체 상대 요소 수 overlapTargetCount가 있다.
 */
export interface OverlapIssue extends RawIssueBase {
  type: 'element-overlap';
  subtype: SubtypeByType['element-overlap'];
  /** 대표 상대 요소의 index(교차 면적 최대, 같으면 index가 작은 쪽). relatedElements[0]과 같다 */
  relatedIndex: number;
}

export interface ViewportOverflowIssue extends RawIssueBase {
  type: 'viewport-overflow';
  subtype: SubtypeByType['viewport-overflow'];
  /** 원인 요소의 자손 중 함께 화면 밖으로 나간 요소 수 (DETECTION_RULES 6.3) */
  affectedDescendants: number;
}

export type RawIssue = TextOverflowIssue | OverlapIssue | ViewportOverflowIssue;

/**
 * 병합(DETECTION_RULES 7.3) 뒤의 이슈. 필드 이름은 Issue(src/types/inspection.ts)와 같다.
 * occurrences는 [desktop, mobile] 순서의 RawIssue이고, 모두 같은 type/subtype이다.
 */
export interface MergedIssue {
  type: IssueType;
  subtype: RawIssue['subtype'];
  viewports: Viewport[];
  /** 한 viewport가 실패한 검사에서는 null (PRD 5.6) */
  viewportTag: ViewportTag | null;
  occurrences: RawIssue[];
  /** Viewport Overflow만. occurrences[0]의 값 */
  affectedDescendants?: number;
  /** occurrence 중 최솟값 (DETECTION_RULES 9.4) */
  confidence: number;
  needsReview: boolean;
}

/** Priority(DETECTION_RULES 9장)까지 계산한 이슈 */
export interface ScoredIssue extends MergedIssue {
  scores: Issue['scores'];
  priority: Priority;
}

/**
 * buildIssues(pipeline.ts)의 결과. ID와 유형 간 연결까지 끝났다.
 * T07(Evidence)이 title, selector, sourceHints, occurrence의 selector·evidenceText·cropRect 등을 채워 Issue로 만든다.
 */
export interface DetectedIssue extends ScoredIssue {
  id: string;
  /** ID 오름차순 (DOMAIN_MODEL S-6) */
  relatedIssueIds: string[];
}

/** 상대 요소 index. Overlap은 relatedIndex, 그 밖은 relatedElements[0], 없으면 -1 */
export function relatedIndexOf(issue: RawIssue): number {
  if (issue.type === 'element-overlap') return issue.relatedIndex;
  return issue.relatedElements[0]?.index ?? -1;
}

/**
 * 탐지 함수의 출력 순서: 대상 요소 index → subtype → 상대 요소 index (DETECTION_RULES 11장).
 * 문자열 비교는 locale에 따라 달라지지 않도록 코드 단위로 한다.
 */
export function compareRawIssues(a: RawIssue, b: RawIssue): number {
  if (a.elementIndex !== b.elementIndex) return a.elementIndex - b.elementIndex;
  if (a.subtype !== b.subtype) return a.subtype < b.subtype ? -1 : 1;
  return relatedIndexOf(a) - relatedIndexOf(b);
}

// RawIssue의 type/subtype이 SubtypeByType 조합만 허용하는지 컴파일 시점에 확인한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type RawIssueMatchesSubtypes = [
  Assert<Same<RawIssue['type'], IssueType>>,
  Assert<Same<Extract<RawIssue, { type: 'text-overflow' }>['subtype'], SubtypeByType['text-overflow']>>,
  Assert<Same<Extract<RawIssue, { type: 'element-overlap' }>['subtype'], SubtypeByType['element-overlap']>>,
  Assert<Same<Extract<RawIssue, { type: 'viewport-overflow' }>['subtype'], SubtypeByType['viewport-overflow']>>,
];
