import { IssueType, Priority, ViewportTag } from '@/schemas/enums';
import type { IssueType as IssueTypeValue, Priority as PriorityValue, ViewportTag as ViewportTagValue } from '@/types/inspection';

// Fixture 15종의 기대 결과 (PRD 13.1, DETECTION_RULES 12.2).
//
// 이 파일의 기대값은 탐지 결과에 맞춰 바꾸지 않는다(AGENTS.md 10장). 값이 틀렸다고 판단되면
// 근거를 보고하고 확인을 받는다. 모든 값은 PRD/DETECTION_RULES의 절과 각 Fixture의 배치로 설명할 수
// 있어야 하며, 그 계산은 각 HTML 파일의 <head> 주석에도 적어 두었다.

/** DETECTION_RULES 1.1: type별로 허용되는 subtype (DOMAIN_MODEL 3.3 S-12) */
export interface SubtypeByType {
  'text-overflow': 'clipped' | 'spill';
  'element-overlap': 'interactive' | 'text' | 'other';
  'viewport-overflow': 'page-scroll' | 'element-out' | 'hidden-clip';
}

interface ExpectedIssueBase {
  priority: PriorityValue;
  viewportTag: ViewportTagValue;
  /** 대상 요소(occurrences[0]의 요소)의 data-testid */
  testId: string;
  /**
   * 상대 요소의 data-testid (relatedElements[0]).
   * element-overlap은 overlap-target, spill은 bordered-ancestor다(DETECTION_RULES 4.2, 5.6).
   */
  relatedTestId?: string;
  /** PRD가 값을 정한 경우에만 둔다 (P-03: PRD 13.1 "Confidence 1.0") */
  confidence?: number;
  /**
   * PRD 5.5.3 표와 Reach 보정으로 계산한 점수 (Issue.scores와 같은 모양, R은 보정 뒤 값).
   * DETECTION_RULES 12.2에는 없는 필드다. T07에서 Priority뿐 아니라 계산 과정까지 확인하기 위해 둔다.
   */
  scores: { S: number; I: number; R: number; score100: number };
}

/** type에 맞는 subtype만 쓸 수 있게 type별로 나눈 union */
export type ExpectedIssue = {
  [K in IssueTypeValue]: ExpectedIssueBase & { type: K; subtype: SubtypeByType[K] };
}[IssueTypeValue];

export type FixtureId =
  | 'P-01' | 'P-02' | 'P-03' | 'P-04' | 'P-05' | 'P-06'
  | 'N-01' | 'N-02' | 'N-03' | 'N-04' | 'N-05' | 'N-06' | 'N-07' | 'N-08' | 'N-09';

export interface FixtureExpectation {
  id: FixtureId;
  kind: 'positive' | 'negative';
  /** public/ 기준 경로. 서버의 URL 경로와 같다 (예: /fixtures/positive/P-01.html) */
  path: string;
  /** 목록과 로그에 쓰는 한 줄 설명 (PRD 13.1 내용) */
  description: string;
  /** 근거 절 */
  refs: string[];
  /**
   * needsReview: false인 이슈의 정확한 개수.
   * needsReview: true인 이슈는 세지 않는다(PRD 13.2: Negative에서 Needs Review는 허용).
   */
  issueCount: number;
  /** needsReview: false인 이슈 목록. 순서는 의미 없다 */
  issues: ExpectedIssue[];
  /**
   * 나와도, 나오지 않아도 통과하는 이슈 (DETECTION_RULES 12.2).
   * PRD가 결과를 둘 중 하나로 허용한 경우에만 둔다.
   */
  allowed?: AllowedIssue[];
}

export interface AllowedIssue {
  type: IssueTypeValue;
  testId: string;
  /** 허용하는 이유와 근거 절 */
  reason: string;
}

/** PRD 5.5.2: score100 = S×35 + I×35 + R×30 */
function scores(S: number, I: number, R: number) {
  return { S, I, R, score100: S * 35 + I * 35 + R * 30 };
}

export const FIXTURE_EXPECTATIONS: readonly FixtureExpectation[] = [
  // ---------------------------------------------------------------- Positive
  {
    // PRD 13.1 P-01, DETECTION_RULES 12.2 P-01
    // 5.5.3 1행 S4 I4 R5, Reach: 첫 화면 +1, mobile-only +0 → R=min(6,5)=5 → 430
    id: 'P-01',
    kind: 'positive',
    path: '/fixtures/positive/P-01.html',
    description: 'Mobile에서 width: 600px 고정 박스 (자식 요소 포함, 원인 1개만 보고)',
    refs: ['PRD 5.3.4', 'PRD 5.3.5 규칙 1', 'PRD 5.5.3', 'PRD 13.1', 'DETECTION_RULES 6.3', 'DETECTION_RULES 12.2'],
    issueCount: 1,
    issues: [
      {
        type: IssueType['viewport-overflow'],
        subtype: 'page-scroll',
        priority: Priority.P0,
        viewportTag: ViewportTag['mobile-only'],
        testId: 'p01-fixed-box',
        scores: scores(4, 4, 5),
      },
    ],
  },
  {
    // PRD 13.1 P-02 (배치 조건: 문서 y ≥ 900, Mobile에서만 잘림)
    // 5.5.3 3행(clipped + 인터랙티브) S4 I4 R3, Reach: 첫 화면 밖 +0, mobile-only +0 → 370
    id: 'P-02',
    kind: 'positive',
    path: '/fixtures/positive/P-02.html',
    description: '고정 너비 버튼 안의 긴 한글 텍스트, overflow: hidden (Mobile에서만, 첫 화면 아래)',
    refs: ['PRD 5.3.2', 'PRD 5.5.3', 'PRD 5.6', 'PRD 13.1', 'DETECTION_RULES 4.1', 'DETECTION_RULES 12.2'],
    issueCount: 1,
    issues: [
      {
        type: IssueType['text-overflow'],
        subtype: 'clipped',
        priority: Priority.P1,
        viewportTag: ViewportTag['mobile-only'],
        testId: 'p02-cta-button',
        scores: scores(4, 4, 3),
      },
    ],
  },
  {
    // PRD 13.1 P-03 (Confidence 1.0: 5.3.3 인터랙티브 예외)
    // DETECTION_RULES 5.6: subtype interactive, 대상 = 문서 순서가 앞인 요소
    // 5.5.3 2행 S5 I4 R3, Reach: 첫 화면 +1, both +1 → R=5 → 465
    id: 'P-03',
    kind: 'positive',
    path: '/fixtures/positive/P-03.html',
    description: '같은 부모 안의 position: absolute 버튼 두 개가 겹침',
    refs: ['PRD 5.3.3', 'PRD 5.5.3', 'PRD 5.5.4', 'PRD 13.1', 'DETECTION_RULES 5.6', 'DETECTION_RULES 12.2'],
    issueCount: 1,
    issues: [
      {
        type: IssueType['element-overlap'],
        subtype: 'interactive',
        priority: Priority.P0,
        viewportTag: ViewportTag.both,
        testId: 'p03-button-save',
        relatedTestId: 'p03-button-cancel',
        confidence: 1,
        scores: scores(5, 4, 5),
      },
    ],
  },
  {
    // PRD 13.1 P-04, DETECTION_RULES 12.2 P-04("1개 이상"). 이 페이지는 원인 요소를 1개만 둔다.
    // 5.5.3 4행 S3 I4 R4, Reach: 첫 화면 +1, both +1 → R=min(6,5)=5 → 395
    id: 'P-04',
    kind: 'positive',
    path: '/fixtures/positive/P-04.html',
    description: 'body { overflow-x: hidden } + 화면 오른쪽 밖으로 나간 이미지',
    refs: ['PRD 5.3.4', 'PRD 5.5.3', 'PRD 13.1', 'DETECTION_RULES 6.4', 'DETECTION_RULES 12.2'],
    issueCount: 1,
    issues: [
      {
        type: IssueType['viewport-overflow'],
        subtype: 'hidden-clip',
        priority: Priority.P1,
        viewportTag: ViewportTag.both,
        testId: 'p04-image',
        scores: scores(3, 4, 5),
      },
    ],
  },
  {
    // PRD 13.1 P-05, DETECTION_RULES 4.2 (relatedElements: bordered-ancestor)
    // 5.5.3 7행 S2 I3 R3, Reach: 첫 화면 밖 +0, both +1 → R=4 → 295
    id: 'P-05',
    kind: 'positive',
    path: '/fixtures/positive/P-05.html',
    description: '고정 높이 카드(배경색 있음) 안에서 넘치는 본문 텍스트 (첫 화면 아래)',
    refs: ['PRD 5.3.2', 'PRD 5.5.3', 'PRD 13.1', 'DETECTION_RULES 4.2', 'DETECTION_RULES 12.2'],
    issueCount: 1,
    issues: [
      {
        type: IssueType['text-overflow'],
        subtype: 'spill',
        priority: Priority.P2,
        viewportTag: ViewportTag.both,
        testId: 'p05-card-text',
        relatedTestId: 'p05-card',
        scores: scores(2, 3, 4),
      },
    ],
  },
  {
    // PRD 13.1 P-06: 주 이슈 1개. 같은 요소의 Text Overflow는 "생성되지 않거나 relatedIssueIds로 연결".
    // 이 페이지는 제목과 조상에 테두리 박스와 overflow 클립이 없어 Text Overflow가 생기지 않는다.
    // 5.5.3 1행 S4 I4 R5, Reach: 첫 화면 +1, mobile-only +0 → R=min(6,5)=5 → 430
    id: 'P-06',
    kind: 'positive',
    path: '/fixtures/positive/P-06.html',
    description: 'white-space: nowrap 제목이 Mobile에서 넘침 (원인 = 제목 요소)',
    refs: ['PRD 5.3.4', 'PRD 5.3.5 규칙 4', 'PRD 5.5.3', 'PRD 13.1', 'DETECTION_RULES 6.1', 'DETECTION_RULES 12.2'],
    issueCount: 1,
    issues: [
      {
        type: IssueType['viewport-overflow'],
        subtype: 'page-scroll',
        priority: Priority.P0,
        viewportTag: ViewportTag['mobile-only'],
        testId: 'p06-title',
        scores: scores(4, 4, 5),
      },
    ],
    allowed: [
      {
        type: IssueType['text-overflow'],
        testId: 'p06-title',
        reason: 'PRD 13.1 P-06: 같은 요소의 Text Overflow는 생성되지 않거나 relatedIssueIds로 연결된다',
      },
    ],
  },

  // ---------------------------------------------------------------- Negative
  // PRD 13.1, 13.2: needsReview: false인 이슈 0개. needsReview: true는 허용한다.
  {
    id: 'N-01',
    kind: 'negative',
    path: '/fixtures/negative/N-01.html',
    description: 'Hero 배경 이미지 위의 텍스트',
    refs: ['PRD 5.3.3 제외 조건', 'PRD 13.1', 'DETECTION_RULES 5.5'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-02',
    kind: 'negative',
    path: '/fixtures/negative/N-02.html',
    description: 'text-overflow: ellipsis가 적용된 카드 제목 (line-clamp 설명 포함)',
    refs: ['PRD 5.3.2 제외 조건', 'PRD 13.1', 'DETECTION_RULES 4.1'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-03',
    kind: 'negative',
    path: '/fixtures/negative/N-03.html',
    description: 'overflow-x: auto 가로 스크롤 캐러셀',
    refs: ['PRD 5.3.2 제외 조건', 'PRD 5.3.4 제외 조건', 'PRD 13.1', 'DETECTION_RULES 6.2'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-04',
    kind: 'negative',
    path: '/fixtures/negative/N-04.html',
    description: 'position: sticky 헤더',
    refs: ['PRD 5.3.3 제외 조건', 'PRD 13.1', 'DETECTION_RULES 5.5'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-05',
    kind: 'negative',
    path: '/fixtures/negative/N-05.html',
    description: 'transform으로 숨겨진 오프캔버스 메뉴 (visibility: hidden, aria-hidden)',
    refs: ['PRD 5.3.1', 'PRD 5.3.4 제외 조건', 'PRD 13.1', 'DETECTION_RULES 3.2'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-06',
    kind: 'negative',
    path: '/fixtures/negative/N-06.html',
    description: '쿠키 동의 배너 (fixed, 하단)',
    refs: ['PRD 5.3.3 제외 조건', 'PRD 13.1', 'DETECTION_RULES 5.3', 'DETECTION_RULES 5.5'],
    issueCount: 0,
    issues: [],
  },
  {
    // 카드 2의 배지-이미지 겹침은 Confidence 0.4(needsReview: true) 이슈로 나올 수 있고, 그것은 허용된다.
    id: 'N-07',
    kind: 'negative',
    path: '/fixtures/negative/N-07.html',
    description: '이미지 위의 배지 (absolute, 부모 안)',
    refs: ['PRD 5.3.3 제외 조건', 'PRD 5.3.3 Confidence 하향', 'PRD 5.5.4', 'PRD 13.1', 'DETECTION_RULES 5.6'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-08',
    kind: 'negative',
    path: '/fixtures/negative/N-08.html',
    description: 'overflow: hidden + border-radius 카드 안에서 큰 이미지가 잘림 (텍스트는 넘치지 않음)',
    refs: ['PRD 5.3.2', 'PRD 5.3.4 제외 조건', 'PRD 13.1', 'DETECTION_RULES 4.1'],
    issueCount: 0,
    issues: [],
  },
  {
    id: 'N-09',
    kind: 'negative',
    path: '/fixtures/negative/N-09.html',
    description: '.sr-only 스크린리더 전용 텍스트와 left: -9999px skip link',
    refs: ['PRD 5.3.1', 'PRD 13.1', 'DETECTION_RULES 3.2'],
    issueCount: 0,
    issues: [],
  },
];
