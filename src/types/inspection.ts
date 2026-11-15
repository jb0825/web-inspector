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
  /** 스크린샷만 실패함. viewport 실패가 아니다(ViewportResult.screenshotUrl = null, PRD 5.2.4) */
  | 'SCREENSHOT_FAILED'
  | 'TIME_BUDGET_EXCEEDED'
  | 'STORAGE_FAILED'
  | 'AI_FAILED'
  | 'INTERNAL_ERROR'
  /** 사용자가 검사를 중지함 (POST /api/inspections/:id/cancel) */
  | 'CANCELLED';

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
  /**
   * 스크린샷 URL. 촬영에 실패했으면(SCREENSHOT_FAILED, PRD 5.2.4) null이고, 이때 screenshotWidth/Height도 null,
   * screenshotTruncated는 false다. 측정과 이슈는 그대로 있고 이 viewport의 cropRect는 모두 null이다.
   */
  screenshotUrl: string | null;
  /** 저장된 스크린샷 너비 (CSS px). Mobile 축소 시 layoutWidth보다 넓을 수 있다 */
  screenshotWidth: number | null;
  /** 저장된 스크린샷 높이 (CSS px) */
  screenshotHeight: number | null;
  screenshotTruncated: boolean;
  elementsInspected: number;
  elementsTruncated: boolean;
  hasCanvas: boolean;
  /** selector 목록 */
  overlaysDetected: string[];
  /**
   * 페이지 구성 도면 (DETECTION_RULES 16장). 스크린샷 성공 여부와 관계없이 항상 저장한다.
   * 이 필드가 생기기 전에 저장된 문서에는 없다. 없으면 화면은 최소 도면을 그린다.
   */
  layoutMap?: LayoutMap;
}

export type LayoutBlockKind =
  | 'header'
  | 'nav'
  | 'main'
  | 'section'
  | 'footer'
  | 'aside'
  | 'form'
  | 'heading'
  | 'text'
  | 'image'
  | 'button'
  | 'input'
  | 'canvas'
  | 'video'
  | 'iframe'
  | 'card';

export interface LayoutBlock {
  kind: LayoutBlockKind;
  /** 문서 기준, 정수, [0, scrollWidth] × [0, height] 안 */
  rect: Rect;
  /** 페이지에서 가져온 문자열(최대 40자). 화면에는 문자열로만 렌더링한다 */
  label?: string;
  /** 이 블록을 감싸는 구조 블록 수 */
  depth: number;
}

export interface LayoutMap {
  /** layoutWidth (화면 너비) */
  width: number;
  /** 문서 가로 범위 = max(layoutWidth, documentScrollWidth). 화면 밖으로 나간 블록까지 담는다 */
  scrollWidth: number;
  /** documentHeight (상한 LAYOUT_MAX_HEIGHT, 넘으면 truncated) */
  height: number;
  /** 블록 수나 높이 상한에 걸렸는지 */
  truncated: boolean;
  /** 문서 순서 */
  blocks: LayoutBlock[];
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
    /** PRD 5.7.1: 규칙 기반 분석('rule') 또는 AI 분석('ai') */
    source: 'rule' | 'ai';
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
