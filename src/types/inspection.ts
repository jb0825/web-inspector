// PRD 8.2 데이터 모델. 서버와 클라이언트가 공유하는 도메인 타입의 단일 기준이다.
// PRD 8.2와 다르게 바꿔야 하면 먼저 보고한다(AGENTS.md 9장). 런타임 코드를 두지 않는다.

export type Viewport = 'desktop' | 'mobile';
export type ViewportTag = 'mobile-only' | 'desktop-only' | 'both';
export type IssueType = 'text-overflow' | 'element-overlap' | 'viewport-overflow';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type InspectionStatus =
  | 'pending'
  | 'running'
  | 'analyzing'
  | 'completed'
  | 'partial'
  | 'failed';
export type ErrorCode =
  | 'INVALID_URL'
  | 'BLOCKED_TARGET'
  | 'TOO_MANY_INSPECTIONS'
  | 'NAVIGATION_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'HTTP_ERROR'
  | 'BROWSER_CRASH'
  | 'DETECTION_FAILED'
  | 'TIME_BUDGET_EXCEEDED'
  | 'STORAGE_FAILED'
  | 'AI_FAILED'
  | 'INTERNAL_ERROR';

export interface InspectionErrorInfo {
  code: ErrorCode;
  message: string;
}

/** 문서 기준 CSS px */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Inspection {
  id: string;
  url: string;
  finalUrl?: string;
  status: InspectionStatus;
  step?: string;
  /** status가 failed일 때 */
  error?: InspectionErrorInfo;
  /** ISO 8601 UTC */
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  viewports: Record<Viewport, ViewportResult | null>;
  viewportErrors: Record<Viewport, InspectionErrorInfo | null>;
  analysis: {
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
    analyzedIssueCount: number;
    error?: InspectionErrorInfo;
  };
  /** 상한(PRD 5.3.7)을 적용하기 전, viewport 간 병합까지 끝난 이슈 수 */
  issuesDetected: number;
  /** issuesDetected > issues.length */
  issuesTruncated: boolean;
  issues: Issue[];
  tasks: DevTask[];
}

export interface ViewportResult {
  /** 설정값 (1440 / 390) */
  width: number;
  height: number;
  /** 측정값 (기록용, 판정에 쓰지 않음, PRD 5.2.1) */
  innerWidth: number;
  /** document.documentElement.clientWidth */
  layoutWidth: number;
  hasMetaViewport: boolean;
  documentHeight: number;
  screenshotUrl: string;
  /** 저장된 스크린샷 너비 (CSS px). Mobile 축소 시 layoutWidth보다 넓을 수 있다 */
  screenshotWidth: number;
  /** 저장된 스크린샷 높이 (CSS px) */
  screenshotHeight: number;
  screenshotTruncated: boolean;
  elementsInspected: number;
  elementsTruncated: boolean;
  hasCanvas: boolean;
  /** selector 목록 */
  overlaysDetected: string[];
}

export interface RelatedElement {
  role: 'overlap-target' | 'clipping-ancestor' | 'bordered-ancestor' | 'cause-ancestor';
  selector: string;
  tag: string;
  boundingBox: Rect;
}

export interface SourceHints {
  textSnippet?: string;
  landmark?: string;
  htmlSnippet: string;
  stableAttributes: Record<string, string>;
  ancestorPath: string;
}

export interface IssueOccurrence {
  viewport: Viewport;
  selector: string;
  boundingBox: Rect;
  measured: Record<string, number>;
  expected: Record<string, number>;
  delta: Record<string, number>;
  /** 코드가 생성 */
  evidenceText: string;
  relatedElements: RelatedElement[];
  /** PRD 5.4.1 */
  cropRect: Rect | null;
  computedStyle: Record<string, string>;
  sourceHints: SourceHints;
  confidence: number;
}

export interface Issue {
  /** ISS-001 (PRD 5.3.6) */
  id: string;
  type: IssueType;
  subtype: string;
  /** 코드가 생성 (PRD 5.4.4) */
  title: string;
  viewports: Viewport[];
  /** 한 viewport가 실패한 검사에서는 null */
  viewportTag: ViewportTag | null;
  /** occurrences[0].selector */
  selector: string;
  /** occurrences[0].sourceHints */
  sourceHints: SourceHints;
  /** desktop → mobile 순 */
  occurrences: IssueOccurrence[];
  relatedIssueIds: string[];
  affectedDescendants?: number;
  scores: { S: number; I: number; R: number; score100: number };
  priority: Priority;
  /** occurrence 중 최솟값 */
  confidence: number;
  needsReview: boolean;
  analysis?: {
    rootCause: string;
    certainty: 'confirmed' | 'likely' | 'uncertain';
    cssProblem: string;
    fixDirection: string;
    suggestedFix: string;
  };
  analysisSkippedReason?: 'needs-review' | 'limit-exceeded' | 'ai-failed';
}

export interface DevTask {
  /** TASK-001 */
  id: string;
  title: string;
  titleSource: 'ai' | 'template';
  description: string;
  priority: Priority;
  viewportTag: ViewportTag | null;
  landmark?: string;
  issueIds: string[];
  needsReview: boolean;
  /** 코드가 생성 */
  acceptanceCriteria: string[];
  /** 코드가 조립 */
  prompt: string;
}
