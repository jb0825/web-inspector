import type { IssueType, Priority } from '@/types/inspection';
import type { SubtypeByType } from '@/server/detect/types';

// PRD 5.5.2, 5.5.3 점수표 (DETECTION_RULES 9장). 점수 관련 숫자는 이 파일에만 둔다(AGENTS.md 6장).

/** score100 = S × 35 + I × 35 + R × 30 (PRD 5.5.2: 정수 연산) */
export const SCORE_WEIGHTS = { S: 35, I: 35, R: 30 } as const;

/** 등급 경계. 위에서부터 처음 맞는 등급, 어디에도 맞지 않으면 P3 */
export const PRIORITY_THRESHOLDS: readonly { priority: Exclude<Priority, 'P3'>; min: number }[] = [
  { priority: 'P0', min: 400 },
  { priority: 'P1', min: 300 },
  { priority: 'P2', min: 200 },
];

/** Reach 보정 뒤 R의 최댓값 (PRD 5.5.3) */
export const REACH_MAX = 5;

export type ScoreRule = {
  [K in IssueType]: {
    type: K;
    subtype: SubtypeByType[K];
    /** 대상 요소가 인터랙티브 영역이거나 nav 안일 때만 맞는 행 (3행) */
    requiresInteractiveOrNav?: true;
    S: number;
    I: number;
    R: number;
  };
}[IssueType];

/** PRD 5.5.3 표. 위에서부터 처음 맞는 행을 쓴다 */
export const SCORE_RULES: readonly ScoreRule[] = [
  { type: 'viewport-overflow', subtype: 'page-scroll', S: 4, I: 4, R: 5 },
  { type: 'element-overlap', subtype: 'interactive', S: 5, I: 4, R: 3 },
  { type: 'text-overflow', subtype: 'clipped', requiresInteractiveOrNav: true, S: 4, I: 4, R: 3 },
  { type: 'viewport-overflow', subtype: 'hidden-clip', S: 3, I: 4, R: 4 },
  { type: 'text-overflow', subtype: 'clipped', S: 3, I: 3, R: 3 },
  { type: 'element-overlap', subtype: 'text', S: 3, I: 3, R: 3 },
  { type: 'text-overflow', subtype: 'spill', S: 2, I: 3, R: 3 },
  { type: 'viewport-overflow', subtype: 'element-out', S: 2, I: 2, R: 3 },
  { type: 'element-overlap', subtype: 'other', S: 2, I: 2, R: 2 },
];
