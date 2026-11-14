import type { Inspection, Issue } from '@/types/inspection';

// P-01 Fixture(Mobile에서 width: 600px 고정 박스)의 브라우저 단계 결과. `pnpm test:fixtures P-01`이 만든
// .tmp/fixtures-report/P-01.json에서 옮겼다(macOS 로컬). 프롬프트 스냅샷과 분석 단계 테스트의 입력이다.

export const P01_VIEWPORTS: Inspection['viewports'] = {
  "desktop": {
    "width": 1440,
    "height": 900,
    "innerWidth": 1440,
    "layoutWidth": 1440,
    "hasMetaViewport": true,
    "documentHeight": 900,
    "screenshotUrl": "P-01-desktop.png",
    "screenshotWidth": 1440,
    "screenshotHeight": 900,
    "screenshotTruncated": false,
    "elementsInspected": 20,
    "elementsTruncated": false,
    "hasCanvas": false,
    "overlaysDetected": []
  },
  "mobile": {
    "width": 390,
    "height": 844,
    "innerWidth": 616,
    "layoutWidth": 390,
    "hasMetaViewport": true,
    "documentHeight": 1334,
    "screenshotUrl": "P-01-mobile.png",
    "screenshotWidth": 616,
    "screenshotHeight": 1334,
    "screenshotTruncated": false,
    "elementsInspected": 20,
    "elementsTruncated": false,
    "hasCanvas": false,
    "overlaysDetected": []
  }
};

export const P01_ISSUE: Issue = {
  "id": "ISS-001",
  "type": "viewport-overflow",
  "subtype": "page-scroll",
  "title": "Viewport Overflow · page-scroll — div \"베이직 월 9,900원 프로 월 19\"",
  "viewports": [
    "mobile"
  ],
  "viewportTag": "mobile-only",
  "selector": "[data-testid=\"p01-fixed-box\"]",
  "sourceHints": {
    "htmlSnippet": "<div class=\"plan-table\" data-testid=\"p01-fixed-box\">",
    "stableAttributes": {
      "data-testid": "p01-fixed-box"
    },
    "ancestorPath": "body > main.page",
    "textSnippet": "베이직 월 9,900원 프로 월 19,900원 팀 월 49,900원",
    "landmark": "요금제 한눈에 보기"
  },
  "occurrences": [
    {
      "viewport": "mobile",
      "selector": "[data-testid=\"p01-fixed-box\"]",
      "boundingBox": {
        "x": 16,
        "y": 197.38,
        "width": 600,
        "height": 105.8
      },
      "measured": {
        "elementRight": 616,
        "documentScrollWidth": 616
      },
      "expected": {
        "layoutWidth": 390
      },
      "delta": {
        "overflowRight": 226
      },
      "evidenceText": "요소의 오른쪽 끝(616px)이 Mobile 화면 너비(390px)를 226px 벗어나 페이지 가로 스크롤이 발생합니다. 하위 요소 6개가 함께 화면 밖으로 나갑니다.",
      "relatedElements": [],
      "cropRect": {
        "x": 0,
        "y": 170.28,
        "width": 616,
        "height": 160
      },
      "computedStyle": {
        "display": "flex",
        "position": "static",
        "width": "600px",
        "min-width": "0px",
        "max-width": "none",
        "height": "105.797px",
        "flex": "0 1 auto",
        "flex-wrap": "nowrap",
        "flex-shrink": "1",
        "grid-template-columns": "none",
        "overflow": "visible",
        "overflow-x": "visible",
        "white-space": "normal",
        "word-break": "keep-all",
        "overflow-wrap": "break-word",
        "text-overflow": "clip",
        "font-size": "16px",
        "line-height": "25.6px",
        "padding": "16px",
        "margin": "24px 0px 0px",
        "box-sizing": "border-box",
        "transform": "none",
        "z-index": "auto"
      },
      "sourceHints": {
        "htmlSnippet": "<div class=\"plan-table\" data-testid=\"p01-fixed-box\">",
        "stableAttributes": {
          "data-testid": "p01-fixed-box"
        },
        "ancestorPath": "body > main.page",
        "textSnippet": "베이직 월 9,900원 프로 월 19,900원 팀 월 49,900원",
        "landmark": "요금제 한눈에 보기"
      },
      "confidence": 1
    }
  ],
  "relatedIssueIds": [],
  "affectedDescendants": 6,
  "scores": {
    "S": 4,
    "I": 4,
    "R": 5,
    "score100": 430
  },
  "priority": "P0",
  "confidence": 1,
  "needsReview": false
};
