# AI Website Inspector — Detection Rules

> Version: 2.4
> Status: Draft
> Related Documents: PRD.md (v1.2), AGENTS.md

### Changelog (v2.3 → v2.4)

- 수정: 배치도 text 블록은 블록 레벨 요소에서만 만들고, 영역은 자신과 inline 자손의 보이는 텍스트 합집합이다. heading·button·input·text의 자손은 중복 블록을 만들지 않는다(16.1). 글자·단어 단위로 쪼갠 애니메이션 텍스트가 막대 수십 개가 되던 문제.
- 추가: 배치도용 canvas 수집 `layoutCanvases`(3.1, 16.1). 탐지 후보 조건(3.2)과 별도이고 조상 opacity·aria-hidden 규칙을 적용하지 않는다. 탐지 후보 조건은 바꾸지 않았다.
- 수정: 구조 블록 label에서 heading 텍스트를 뺐다. 사방 8px 이내로 같은 크기인 구조 블록은 하나로 합치고 label을 `main · section`처럼 묶는다(16.1, 16.2). heading label은 aria-label → innerText(`layoutAttrs.text`, 새 수집) → textSnippet, 길이는 heading 24자, button 16자.

### Changelog (v2.2 → v2.3)

- 추가: 페이지 구성 도면 `layoutMap` 추출 규칙과 상수(16장). 수집한 후보 요소만으로 만들고 브라우저에서 새로 측정하지 않는다. 수집에 label 원재료 `layoutAttrs`(alt, placeholder, input type)를 더했다(3.1).
- 수정: `cropRect`는 크롭 기준 박스가 스크린샷 안에 완전히 들어올 때만 만든다. 일부만 걸치면 `null`(8.3).

### Changelog (v2.1 → v2.2)

- 추가: 분석 단계 명세(13장). 규칙 기반 원인 분석 규칙 표(PRD 5.7.1), 태스크 그룹화 세부 규칙(PRD 5.8.1), Acceptance Criteria 문장(PRD 5.8.2), 프롬프트 조립 세부 규칙(PRD 5.9.1). (T10)
- 추가: 원인 분석 규칙 `VM`(반대쪽 margin이 요소를 화면 밖으로 밀어냄). P-04처럼 고정 너비가 화면보다 작은데 margin으로 밀려난 요소를 위해 V6과 V7 사이에 둔다.
- 장 번호 변경: Out of Scope 13장 → 14장, 새로 정한 값과 규칙 14장 → 15장

### Changelog (v2.0 → v2.1)

- 추가: 보이는 영역 계산(3.6). `overflow`로 잘려 보이지 않는 텍스트·요소 영역을 Overlap 영역(5.1)과 Viewport Overflow 범위(6.1)에서 제외한다.
- 수정: Positive Fixture 판정. 기대하지 않은 이슈 중 `needsReview: false`인 것은 실패로 본다. 허용 이슈(`allowed`)를 둔다(12.2).
- 추가: 단위 테스트 케이스(12.1), 새 파일 `src/server/detect/geometry.ts`
- 추가: `CollectedViewport.elementsTruncated`, `viewportSize`(3.1)
- 수정: 자신 또는 조상의 `opacity`가 0이면 서브트리 전체를 후보에서 뺀다(3.2)
- 수정: 판정에 `innerWidth`/`innerHeight`를 쓰지 않는다. 첫 화면 판정과 overlay 면적은 설정 viewport 크기, cropRect 경계는 실제 스크린샷 크기를 쓴다(3.1, 5.3, 8.3, 9.2)
- 추가: `RawIssue` 구조와 탐지 함수 반환 형태, 모든 유형의 `boundingBox`는 대상 요소의 `rect`(1.4)
- 수정: 겹침 이슈를 쌍이 아니라 `(viewport, 대상 요소, subtype)`마다 하나로 묶는다. 대표 상대 요소, `relatedElements` 최대 5개, `overlapTargetCount`(5.4, 5.6, 7.1)
- 수정: Overlap의 viewport 간 병합은 대상 요소와 subtype만 일치하면 된다(7.3)
- 추가: 검사 1회당 이슈 상한 `MAX_ISSUES = 200`, 처리 순서를 병합 → Priority → 상한 → ID → 연결 → Evidence로 변경(1.3, 7.6)
- 명시: 비교 대상 "말단"의 해석(5.1), 제외 조건 2의 영역 기준(5.5), `rootClip`이면 `unexplainedPageScroll`이 아님(6.4)
- 추가: 새 파일 `src/server/detect/pipeline.ts`(`buildIssues`)와 병합 뒤 중간 타입(1.3, 1.5), 매칭 기준 적용 순서(7.2), 규칙 2의 동점 처리(7.1)
- 명시: Evidence 문장의 세부 규칙(양쪽 element-out, hidden-clip 값, 비율 반올림, 20자 기준), cropRect 반올림(8.1, 8.3), Evidence 단계 함수 `finalizeIssues`(1.3)

### Changelog (v1.0 → v2.0)

v1.0(Detection Guide)은 PRD v1.1 이전 기준이라 PRD와 충돌했다. v2.0은 PRD v1.2 5.3~5.5를 **구현 명세**로 다시 쓴 문서다.

- 삭제: Priority 공식의 `× Confidence`, "Desktop과 Mobile은 별도 Issue" 원칙, 4단계 Severity 분류, 5/20/50% Overlap 등급, Confidence 0.4~0.69 "검토 대상" 정책
- 삭제 (PRD 범위 밖): 세로 Viewport Overflow, `elementFromPoint` 기반 클릭 방해 판정, ellipsis 제목을 검토 대상으로 분류
- 삭제: AI가 그룹화, 태스크 생성, 프롬프트 생성을 맡는다는 역할 정의 (AGENTS.md 불변 조건 1, 3 위반)
- 수정: 처리 순서를 탐지 → Dedup → Evidence → Priority로 고정
- 추가: 수집 데이터 구조, 규칙별 의사코드, 상수표, Dedup과 ID 부여 절차, Evidence 템플릿, Selector 생성 규칙, Fixture 15종 기대 결과, 단위 테스트 목록

> **우선순위:** PRD가 규칙과 임계값의 기준이다. 이 문서는 PRD를 코드로 옮기는 방법을 정한다. 둘이 다르면 PRD를 따르고, 이 문서를 고친다.

---

## 1. Overview

### 1.1 Purpose

브라우저에서 측정한 데이터로 세 가지 UI 문제를 탐지하고, 같은 입력에는 항상 같은 이슈 목록, ID, 우선순위를 만드는 절차를 정의한다.

| Type | Subtype | PRD |
|---|---|---|
| `text-overflow` | `clipped`, `spill` | 5.3.2 |
| `element-overlap` | `interactive`, `text`, `other` | 5.3.3 |
| `viewport-overflow` | `page-scroll`, `element-out`, `hidden-clip` | 5.3.4 |

`element-overlap`의 subtype은 PRD 5.5.3 점수표의 행을 그대로 이름으로 쓴 것이다(3.3.6).

### 1.2 원칙

1. **측정과 판정을 나눈다.** 브라우저 안(`page.evaluate`)에서는 원시 값만 수집한다. 판정은 Node의 순수 함수가 한다(AGENTS.md 7장).
2. **결정적이다.** `src/server/detect`, `src/server/priority`에서는 `Math.random`, 현재 시각, AI 호출을 쓰지 않는다. 모든 정렬에 명시적인 키를 쓴다.
3. **상수는 한 곳에 둔다.** 임계값은 `src/server/detect/constants.ts`, 점수표는 `src/server/priority/rules.ts`에만 둔다(2장).
4. **오탐을 줄인다.** 의도된 디자인은 제외 규칙과 Confidence로 거른다. 제외 규칙에는 PRD 절 번호를 주석으로 남긴다.

### 1.3 Pipeline

```text
[browser, viewport별]
  stabilize (PRD 5.2.2)
  → collectViewport (inpage)          src/server/collect/inpage/*.ts
[node]
  → normalize (반올림, 후보 선정)        src/server/collect/collect.ts
  → detectTextOverflow                src/server/detect/textOverflow.ts
  → detectOverlap                     src/server/detect/overlap.ts
  → detectViewportOverflow            src/server/detect/viewportOverflow.ts
  → dedupWithinViewport (규칙 1, 2)    src/server/detect/dedup.ts
[node, 두 viewport 모두 끝난 뒤]
  → matchAcrossViewports              src/server/compare/match.ts
  → mergeAcrossViewports (규칙 3)      src/server/detect/dedup.ts
  → scorePriority                     src/server/priority/score.ts
  → capIssues (MAX_ISSUES, 7.6)       src/server/detect/order.ts
  → orderAndAssignIds                 src/server/detect/order.ts
  → linkRelated (규칙 4)               src/server/detect/dedup.ts
  → finalizeIssues (Evidence, 8장)     src/server/evidence/finalize.ts
```

`src/server/detect/pipeline.ts`의 `buildIssues({ desktop, mobile })`가 `detectTextOverflow`부터 `linkRelated`까지를 한 번에 실행한다. Evidence 단계는 스크린샷 크기가 필요하므로 따로 부른다: `finalizeIssues(buildIssues(…).issues, { desktop: { collected, screenshot }, mobile: … })`가 `Issue[]`를 만든다(AI 필드 제외). 각 입력은 `CollectedViewport | null`(실패한 viewport는 `null`)이다. viewport 하나의 탐지와 Dedup 규칙 2는 `detectViewport(c)`로 따로 부를 수 있다(10장: 예외가 나면 그 viewport만 `null`로 처리하기 위해서).

- `order.ts`는 AGENTS.md 3장 구조에 없는 새 파일이다. ID 부여를 Dedup과 분리해 단위 테스트하기 위해서다.
- `geometry.ts`(3.6)는 `overlap.ts`와 `viewportOverflow.ts`가 함께 쓰는 보이는 영역 계산 순수 함수다.
- Priority를 ID 부여보다 먼저 계산한다. 상한(7.6)을 점수순으로 적용한 뒤 남은 이슈에만 ID를 붙여야 빈 번호가 생기지 않기 때문이다(DOMAIN_MODEL S-1). Priority는 type, subtype, 요소 정보, 위치로만 계산하므로 ID가 필요 없다.

### 1.4 `RawIssue`와 탐지 함수 반환 형태

탐지 함수는 viewport 하나 안의 이슈 후보 `RawIssue`를 만든다(`src/server/detect/types.ts`). 필드 이름은 `IssueOccurrence`(PRD 8.2)와 같게 두고, 요소는 selector 대신 `CollectedElement.index`로 가리킨다. selector, tag, `RelatedElement.boundingBox`는 Evidence 단계에서 index로 찾아 채운다.

| 필드 | 내용 |
|---|---|
| `viewport`, `type`, `subtype` | type별 union으로 정의해 1.1 표의 조합만 허용한다 |
| `elementIndex` | 대상 요소 |
| `boundingBox` | **모든 유형에서 대상 요소의 `rect`**. 마커가 요소 위치를 가리키게 하기 위해서다(nowrap 제목처럼 글자만 넘친 경우에도 요소 박스를 가리킨다) |
| `measured`, `expected`, `delta` | 4~6장의 측정값 표 |
| `relatedElements` | `{ role, index }[]` |
| `confidence` | 기본 1.0 |
| `axes` | `clipped`만. 잘린 축 |
| `relatedIndex` | Overlap만. 대표 상대 요소(5.6) |
| `affectedDescendants` | Viewport Overflow만 |

탐지 함수는 이슈와 함께 부가 정보를 돌려준다. 그래서 반환값은 배열이 아니라 객체다.

```ts
detectTextOverflow(c: CollectedViewport): { issues: RawIssue[] }
detectOverlap(c: CollectedViewport): { issues: RawIssue[]; overlaysDetected: string[] }        // 5.3
detectViewportOverflow(c: CollectedViewport): { issues: RawIssue[]; unexplainedPageScroll: boolean }  // 6.4
```

출력 순서는 대상 요소 index → subtype → 상대 요소 index다(11장).

### 1.5 병합 뒤의 중간 타입

병합(7.3)부터 연결(7.5)까지의 결과는 `Issue`(PRD 8.2)가 아니라 서버 전용 타입으로 둔다(`src/server/detect/types.ts`). Evidence가 아직 없기 때문이다. 필드 이름은 `Issue`와 같다.

| 타입 | 단계 | 필드 |
|---|---|---|
| `MergedIssue` | 7.3 | `type`, `subtype`, `viewports`, `viewportTag`, `occurrences: RawIssue[]`(`[desktop, mobile]`), `affectedDescendants`(occurrences[0]의 값), `confidence`, `needsReview` |
| `ScoredIssue` | 9장 | + `scores`, `priority` |
| `DetectedIssue` | 7.4, 7.5 | + `id`, `relatedIssueIds` |

`buildIssues`는 `{ issues: DetectedIssue[], viewports: { desktop, mobile }(각각 overlaysDetected, unexplainedPageScroll 또는 null), issuesDetected, issuesTruncated }`를 돌려준다. Evidence 단계(8장)가 `title`, `selector`, `sourceHints`, occurrence의 `selector`·`evidenceText`·`cropRect`·`computedStyle`·`sourceHints`, `RelatedElement`의 `selector`·`tag`·`boundingBox`를 채워 `Issue`로 만든다.

---

## 2. Constants

`src/server/detect/constants.ts`:

| 상수 | 값 | PRD |
|---|---:|---|
| `TOLERANCE_PX` | 1 | 5.3.1 |
| `MAX_CANDIDATES` | 3000 | 5.3.1 |
| `MIN_ELEMENT_SIZE_PX` | 1 (초과해야 후보) | 5.3.1 |
| `MEASURE_DECIMALS` | 2 | 5.3.1 |
| `OVERLAP_MIN_RATIO` | 0.2 | 5.3.3 |
| `OVERLAP_MIN_AREA_PX2` | 100 | 5.3.3 |
| `OVERLAY_MIN_VIEWPORT_RATIO` | 0.3 | 5.3.3 |
| `ABSOLUTE_IN_PARENT_CONFIDENCE` | 0.4 | 5.3.3 |
| `MAX_OVERLAP_TARGETS` | 5 (겹침 이슈 하나의 `relatedElements` 최대 개수, 대표 포함) | 5.3.3 |
| `MAX_ISSUES` | 200 (검사 1회당 저장하는 이슈 수) | 5.3.7 |
| `NEEDS_REVIEW_BELOW` | 0.5 | 5.5.4 |
| `TEXT_SNIPPET_MAX` | 80 | 5.4.2 |
| `LANDMARK_MAX` | 60 | 5.4.2 |
| `HTML_SNIPPET_MAX` | 300 | 5.4.2 |
| `ANCESTOR_PATH_MAX_DEPTH` | 5 | 5.4.2 |
| `CROP_PADDING_PX` | 24 | 5.4.1 |
| `CROP_MIN_WIDTH_PX` / `CROP_MIN_HEIGHT_PX` | 320 / 160 | 5.4.1 |
| `SCREENSHOT_MAX_HEIGHT` | desktop 10000, mobile 5000 | 5.2.4 |

`src/server/priority/rules.ts`: PRD 5.5.3 점수표(7.1)와 등급 경계(`P0 ≥ 400`, `P1 ≥ 300`, `P2 ≥ 200`), `REACH_MAX = 5`.

---

## 3. 수집 데이터 (`CollectedViewport`)

### 3.1 구조

브라우저 안에서만 만들 수 있는 값(Selector, Source Hints, 텍스트 rect)은 수집 단계에서 만든다. 판정에 필요한 값만 담고, 판정 결과는 담지 않는다.

이 타입은 서버 안에서만 쓰므로 `src/server/collect/types.ts`에 둔다(`src/types/`가 아님).

```ts
interface CollectedViewport {
  viewport: 'desktop' | 'mobile';
  viewportSize: { width: number; height: number };  // 설정값 (PRD 5.2.1: 1440×900 / 390×844). 판정 기준 크기
  innerWidth: number;             // 기록용. 판정에 쓰지 않는다 (3.1.1)
  innerHeight: number;            // 기록용. 판정에 쓰지 않는다 (3.1.1)
  layoutWidth: number;            // document.documentElement.clientWidth
  documentScrollWidth: number;    // document.documentElement.scrollWidth
  documentHeight: number;
  hasMetaViewport: boolean;
  rootOverflowX: { html: string; body: string };
  hasCanvas: boolean;
  totalCandidates: number;        // 자르기 전 후보 수
  elementsTruncated: boolean;     // totalCandidates > MAX_CANDIDATES
  elements: CollectedElement[];   // 문서 순서, 최대 MAX_CANDIDATES개
  layoutCanvases: LayoutCanvas[]; // 16.1 배치도용 canvas. 후보 조건(3.2)과 별도. 탐지에 쓰지 않는다
}

interface LayoutCanvas {
  index: number;                  // 문서 전체 preorder index (CollectedElement.index와 같은 기준)
  ancestorIndices: number[];      // 모든 조상 요소 index, 가까운 순 (html 제외, 후보가 아닌 조상 포함)
  rect: Rect;                     // border box, 문서 기준. 측정 시점(scrollY = 0) 위치. position: fixed도 같다
}

interface CollectedElement {
  index: number;                  // 문서 전체 preorder 순회 index (후보가 아닌 요소 포함)
  parentIndex: number | null;     // 가장 가까운 "후보" 조상의 index
  ancestorIndices: number[];      // 후보 조상 index, 가까운 순
  tag: string;                    // 소문자
  rect: Rect;                     // border box, 문서 기준 (rect + scrollX/Y)
  paddingBox: Rect;               // rect에서 border를 뺀 영역, 문서 기준
  textRects: Rect[];              // 직접 포함한 비어 있지 않은 텍스트 노드의 Range.getClientRects(), 문서 기준
  scrollWidth: number; clientWidth: number;
  scrollHeight: number; clientHeight: number;
  style: {
    position: string; overflowX: string; overflowY: string;
    textOverflow: string; webkitLineClamp: string; whiteSpace: string;
    lineHeight: string;            // px 값 또는 'normal'
    backgroundColor: string; backgroundImage: string;
    borderWidthSum: number; paddingSum: number;
  };
  flags: {
    interactive: boolean;          // 3.3의 인터랙티브 정의, 자신 기준
    heading: boolean;
    inNav: boolean;
    fixedOrSticky: boolean;        // 자신 또는 조상이 fixed/sticky
    fixedRoot: boolean;            // 자신이 fixed이고 fixed 조상이 없음
  };
  computedStyle: Record<string, string>;  // PRD 5.7.2 화이트리스트
  selector: string;                        // 3.4
  sourceHints: SourceHints;                // 3.5
  identity: { id?: string; testId?: string };
  layoutAttrs?: { alt?: string; placeholder?: string; type?: string; text?: string };  // 16.2 label 원재료. 값이 있을 때만. type은 input만(소문자), text는 h1~h3·role=heading의 innerText(공백 정리, TEXT_SNIPPET_MAX자)
}
```

- 좌표는 모두 문서 기준이다. 측정은 맨 위로 스크롤한 상태(PRD 5.2.2 4단계 뒤)에서 한다.
- `collect.ts`는 숫자를 `MEASURE_DECIMALS` 자리로 반올림한다. 판정은 반올림한 값으로 한다.
- 수집 함수는 `page.evaluate`에 넘기는 독립 함수다. 바깥 변수와 import를 쓰지 않고, 상수는 인자로 받는다.
- `viewportSize`는 브라우저에서 측정하지 않고 `collect.ts`가 `devices.ts`의 설정값으로 채운다.

#### 3.1.1 판정 기준 크기

`window.innerWidth`/`innerHeight`는 visual viewport 크기라서 페이지 확대·축소에 따라 달라진다. Mobile 에뮬레이션에서 콘텐츠가 가로로 넘치면 Chromium이 페이지를 축소해 보여주므로 값이 커진다(P-01 실측: 616×1334). 같은 기기라도 페이지 내용에 따라 기준이 바뀌므로 판정에 쓰지 않는다.

| 용도 | 기준 |
|---|---|
| 가로 비교 (화면 이탈, page-scroll) | `layoutWidth` (PRD 5.2.1) |
| 첫 화면 판정 (Reach 보정, 9.2) | `viewportSize.height` (PRD 5.5.3의 "해당 viewport height") |
| overlay 면적 비율 (5.3) | `layoutWidth × viewportSize.height` |
| cropRect 경계 (8.3) | 저장된 스크린샷의 실제 크기 `screenshotWidth × screenshotHeight` |

`innerWidth`/`innerHeight`는 기록과 진단용으로만 남긴다.
루트가 가로를 자르는 페이지(`rootClip`)의 스크린샷 너비는 `layoutWidth`다(PRD 5.2.4).

### 3.2 후보 선정 (PRD 5.3.1)

브라우저 안에서 문서 순서대로 순회하며 다음을 모두 만족하는 요소를 후보로 넣는다.

```text
candidate(el) :=
  computed.display != 'none'
  && computed.visibility != 'hidden'
  && 자신과 모든 조상의 computed.opacity > 0                            // PRD 10장: opacity는 상속되지 않으므로 조상까지 확인
  && rect.width > MIN_ELEMENT_SIZE_PX && rect.height > MIN_ELEMENT_SIZE_PX
  && 조상에 [aria-hidden="true"] 없음
  && 자신과 조상이 script, style, noscript, template, svg 내부가 아님 (svg 요소 자신은 후보 가능)
  && 자신과 조상에 clip: rect(0, 0, 0, 0) 또는 clip-path: inset(50%) 없음   // PRD 5.3.1: sr-only 제외
```

- 조상 중 하나라도 `opacity`가 0이면 그 서브트리 전체를 후보에서 뺀다. 스크롤 연동 애니메이션처럼 투명한 부모 안의 자식은 화면에 보이지 않기 때문이다(PRD 10장).
- 후보가 `MAX_CANDIDATES`를 넘으면 앞에서부터 자르고 `elementsTruncated = true`로 둔다.
- `html`, `body`는 후보에 넣지 않는다. 대신 `rootOverflowX`와 문서 크기를 따로 수집한다.

### 3.3 용어 판정 (PRD 5.3.1)

| 용어 | 판정 |
|---|---|
| 인터랙티브 | 태그 `button`, `a[href]`, `input`(type≠hidden), `select`, `textarea`, `summary`, 또는 `role` ∈ {button, link, tab, menuitem} |
| 인터랙티브 영역 | 자신 또는 후보 조상 중 하나가 인터랙티브 (`button` 안의 `span` 포함) |
| heading | `h1`~`h6` 또는 `role=heading` |
| nav 안 | 조상에 `nav` 또는 `role=navigation` |
| 텍스트 요소 | `textRects`가 1개 이상 |
| 테두리 박스 | `backgroundColor`가 투명이 아님, 또는 `backgroundImage ≠ none`, 또는 `borderWidthSum > 0`, 또는 `paddingSum > 0` |
| 가로 클립 조상 | `overflowX` ∈ {auto, scroll, hidden, clip}인 후보 조상 |

### 3.4 Selector 생성

PRD 5.4.1: 안정적인 속성을 먼저 쓴다. 문서 안에서 유일해야 한다(`querySelectorAll(selector).length === 1`).

1. `id`가 있고, 문서에서 유일하고, 생성된 값처럼 보이지 않으면 `#id`. "생성된 값"은 `:`를 포함하거나, 숫자 4개 이상이 연속되거나, `[0-9a-f]{8,}` 형태인 경우다(예: React `useId`의 `:r1:`).
2. `data-testid`가 유일하면 `[data-testid="…"]`
3. 그 밖에는 경로 selector: 3.4.1의 규칙을 쓰는 가장 가까운 조상 기준점(1번 또는 2번에 해당하는 조상, 없으면 `body`)에서 시작해 `tag` + 안정적인 class 최대 2개를 `>`로 잇는다. 형제 중 같은 태그+class가 있으면 `:nth-of-type(n)`을 붙인다. 최대 5단계이며, 넘으면 앞쪽을 잘라 `… > ` 없이 기준점부터 다시 시작하지 않고 마지막 5단계만 쓴다. 그래도 유일하지 않으면 모든 단계에 `:nth-of-type(n)`을 붙인다.

**안정적인 class:** 다음 패턴에 해당하지 않는 class.
- CSS-in-JS 해시: `^css-`, `^sc-`, `^jsx-`, `^_`, `__`, `[0-9a-f]{5,}`
- 상태나 변형을 담은 Tailwind 유틸리티: `:` 또는 `[`를 포함

### 3.5 Source Hints 생성 (PRD 5.4.2)

| 항목 | 규칙 |
|---|---|
| `textSnippet` | `textContent`의 공백을 한 칸으로 줄이고 앞뒤 공백을 지운 뒤 앞 `TEXT_SNIPPET_MAX`자. 비면 생략 |
| `landmark` | 가장 가까운 `section`, `header`, `footer`, `nav`, `main` 조상에서 `id` → `aria-label` → 그 안 첫 heading 텍스트 순으로 처음 있는 값, 최대 `LANDMARK_MAX`자. 셋 다 없으면 태그 이름(`footer` 등). 그런 조상이 없으면 생략 |
| `htmlSnippet` | 자식을 뺀 여는 태그 `<tag attr="…">`. 속성값은 각 80자까지. 전체 `HTML_SNIPPET_MAX`자 |
| `stableAttributes` | `id`, `data-testid`, `name`, `aria-label`, `role` 중 있는 것 |
| `ancestorPath` | 가까운 조상 `ANCESTOR_PATH_MAX_DEPTH`개를 `tag.class1.class2`(안정적인 class 최대 2개) 형태로 바깥쪽부터 `>`로 연결 |

`landmark`가 없을 때 태그 이름을 대신 쓰는 것은 PRD에 없는 결정이다. 태스크 그룹화(PRD 5.8.1)에서 "landmark 없음" 그룹이 지나치게 커지지 않게 하기 위해서다.

### 3.6 보이는 영역 (`src/server/detect/geometry.ts`)

`Range.getClientRects()`와 border box는 `overflow`로 잘려 화면에 보이지 않는 부분까지 포함한다. ellipsis 제목의 숨겨진 글자, line-clamp로 숨긴 줄, 카드 밖으로 잘린 이미지가 그 예다. 이 부분이 겹침이나 화면 이탈로 다시 잡히지 않도록, 판정 전에 보이는 영역으로 자른다.

```text
clipChain(el, includeSelf) :=
  [el(includeSelf일 때만), ...el.ancestorIndices의 후보 조상(가까운 순)]
  단, position: fixed인 요소(자신 포함)를 만나면 그 요소까지만 포함하고 멈춘다
  // fixed 요소는 조상의 overflow에 잘리지 않는다

clipRects(rects, chain):
  for c in chain:
    if c.style.overflowX != 'visible': 각 rect의 가로 범위를 c.paddingBox의 [left, right]로 자른다
    if c.style.overflowY != 'visible': 각 rect의 세로 범위를 c.paddingBox의 [top, bottom]으로 자른다
  너비 또는 높이가 0 이하가 된 rect는 버린다

visibleTextRects(el) = clipRects(el.textRects, clipChain(el, includeSelf = true))
visibleRect(el)      = clipRects([el.rect], clipChain(el, includeSelf = false))[0] 또는 없음
// 요소 자신의 overflow는 자기 border box를 자르지 않는다
```

- `overflow` 값이 `hidden`, `clip`, `auto`, `scroll`이면 모두 자른다. 축별로 따로 판정한다.
- 적용하는 곳: Overlap 비교 영역(5.1), Viewport Overflow 넘침 범위(6.1)
- 적용하지 않는 곳:
  - Text Overflow `clipped`(4.1): 잘린 사실 자체를 탐지하므로 잘리기 전 값을 쓴다.
  - Text Overflow `spill`(4.2): 경로에 `overflow`가 `visible`이 아닌 요소가 있으면 이미 판정하지 않는다.
- `-webkit-line-clamp`는 보통 `overflow: hidden`과 함께 쓰이므로 이 규칙으로 숨겨진 줄이 빠진다. `overflow: visible`이면 Chromium에서도 줄이 보이므로 자르지 않는다.
- **한계 (MVP에서 받아들임):**
  - 후보 조상만 확인한다. 후보가 아닌 조상(크기 1px 이하 등)의 `overflow`는 반영하지 않는다.
  - `position: absolute` 요소는 실제로는 위치 기준(containing block)이 아닌 조상의 `overflow`에 잘리지 않지만, DOM 조상 순서로 근사한다.
  - 스크롤 컨테이너 안의 내용은 측정 시점의 스크롤 위치 기준이다.

---

## 4. Text Overflow (PRD 5.3.2)

### 4.1 `clipped`

```text
for el in elements:
  if el.style.textOverflow == 'ellipsis' or el.style.webkitLineClamp not in ('none', ''):
    continue                                   // PRD 5.3.2: 의도된 잘림
  axes = []
  if el.style.overflowX in (hidden, clip) and el.scrollWidth  > el.clientWidth  + TOLERANCE_PX: axes += 'x'
  if el.style.overflowY in (hidden, clip) and el.scrollHeight > el.clientHeight + TOLERANCE_PX: axes += 'y'
  // overflow auto/scroll은 위 조건에 걸리지 않는다 — PRD 5.3.2: 스크롤 영역 제외
  if axes is empty: continue
  texts = el과 후보 자손의 textRects 중, 축 방향으로 el.paddingBox 밖으로 TOLERANCE_PX 넘게 나간 rect
  if texts is empty: continue                  // PRD 5.3.2: 텍스트가 아닌 넘침 제외
  emit RawIssue(text-overflow, clipped, el, axes, texts)
```

- **가장 깊은 요소만 보고:** `el`이 넘친 텍스트 rect가 모두 `el`의 자손 중 또 다른 `clipped` 요소에 속하면 `el`은 보고하지 않는다.
- `html`, `body`는 후보가 아니므로 자동으로 빠진다(PRD 5.3.2).

측정값:

| 축 | measured | expected | delta |
|---|---|---|---|
| x | `scrollWidth` | `clientWidth` | `overflowX = scrollWidth − clientWidth` |
| y | `scrollHeight` | `clientHeight` | `overflowY = scrollHeight − clientHeight` |

`relatedElements`: 없음 (잘림이 `el` 자신에서 일어나므로).

### 4.2 `spill`

```text
for T in 텍스트 요소:
  B = T 자신부터 위로 올라가며 처음 만나는 테두리 박스 (body에 닿으면 없음)
  if B is none: continue                       // PRD 5.3.2: body까지 없으면 판정하지 않음
  if T부터 B까지(양 끝 포함) 중 overflowX 또는 overflowY가 visible이 아닌 요소가 있음: continue
  out = T.textRects 중 B.rect 밖으로 어느 방향이든 TOLERANCE_PX 넘게 나간 rect
  if out is empty: continue
  emit RawIssue(text-overflow, spill, T, related = B)
```

- 같은 넘침이 여러 깊이에서 잡히지 않는다. `spill`은 텍스트를 직접 가진 요소에서만 판정하기 때문이다.
- `ellipsis`/`line-clamp` 제외는 `T`와 `B`에 모두 적용한다.

측정값 (넘친 방향만 기록):

| measured | expected | delta |
|---|---|---|
| `textLeft`, `textRight`, `textTop`, `textBottom` (넘친 rect들의 합집합) | `containerLeft`, `containerRight`, `containerTop`, `containerBottom` (B의 border box) | `overflowLeft`, `overflowRight`, `overflowTop`, `overflowBottom` 중 0보다 큰 값 |

`relatedElements`: `[{ role: 'bordered-ancestor', B }]`

---

## 5. Element Overlap (PRD 5.3.3)

### 5.1 비교 대상

- 대상: 텍스트 요소, 인터랙티브 요소, `img`, `video`, `canvas` 중 **다른 비교 대상을 자손으로 갖지 않는 요소**(말단)
  - 예외: 인터랙티브 요소는 자손에 텍스트 요소가 있어도 대상에 넣는다. 둘은 조상/자손 관계라 서로 비교되지 않는다.
  - 말단 판정은 후보 자손 중 "텍스트 요소, 인터랙티브 요소, `img`/`video`/`canvas`"가 있는지로 한다. 인터랙티브 요소는 그런 자손이 **모두 텍스트 요소**일 때만 예외로 대상에 넣는다. 예: `<a href><img></a>`는 `a`가 빠지고 `img`를 비교한다.
- 영역:
  - 텍스트 요소(인터랙티브가 아닌 것): `textRects`에 line-height 보정(5.2)을 적용한 뒤 보이는 영역으로 자른(3.6) rect 목록
  - 그 밖: `visibleRect(el)` 하나(3.6)
  - 자른 결과 영역이 비면 그 요소는 비교 대상에서 뺀다. 화면에 보이지 않기 때문이다.
- 면적: 영역 rect 면적의 합

### 5.2 line-height 보정 (PRD 5.3.3)

```text
if style.lineHeight != 'normal' and rect.height > lineHeightPx:
  rect.y += (rect.height - lineHeightPx) / 2
  rect.height = lineHeightPx
```

### 5.3 Overlay 처리

```text
overlays = elements where flags.fixedRoot && (rect 면적 / (layoutWidth × viewportSize.height)) >= OVERLAY_MIN_VIEWPORT_RATIO   // 3.1.1
```

- `overlaysDetected`에 selector를 기록한다.
- overlay와 그 자손은 비교 대상에서 뺀다(PRD 5.3.3).
- 판정용 rect는 문서 기준이지만 fixed 요소는 측정 시점(scrollY = 0)의 위치다.

### 5.4 쌍 찾기 (sweep)

```text
items를 (top, index) 오름차순 정렬
active = []
for a in items:
  active에서 bottom <= a.top 인 항목 제거
  for b in active:
    if 가로 범위가 겹치지 않음: continue
    if excluded(a, b): continue
    area = Σ intersection(ra, rb)   for ra in a.rects, rb in b.rects
    smaller = min(area(a), area(b))
    if area >= OVERLAP_MIN_AREA_PX2 or area >= smaller * OVERLAP_MIN_RATIO:
      addToGroup(min index, max index)                // 5.6: 대상 요소 기준으로 묶는다
  active += a
```

- `top`/`bottom`은 영역 rect들의 최솟값/최댓값이다.
- 쌍은 항상 (작은 index, 큰 index) 순서로 만들어 같은 쌍이 두 번 나오지 않게 한다.
- 쌍 목록 전체를 쌓지 않는다. `(대상 요소, subtype)`마다 상위 `MAX_OVERLAP_TARGETS`개 쌍과 전체 개수만 유지한다(5.6). 쌍 수는 요소 수의 제곱까지 늘 수 있기 때문이다.

### 5.5 제외 조건 `excluded(a, b)`

순서대로 확인하고 하나라도 맞으면 제외한다.

1. 한쪽이 다른 쪽의 조상이다. // PRD 5.3.3
2. 한쪽의 `rect`가 다른 쪽의 영역 전체를 포함하고, 포함하는 쪽이 `img`, `video`, `canvas`이거나 `backgroundImage ≠ none`이다. // PRD 5.3.3: 의도된 오버레이
   - 포함하는 쪽은 `visibleRect`(3.6), 포함되는 쪽은 5.1의 영역(자른 뒤 rect 목록)으로 판정한다. 잘려서 보이지 않는 부분으로 포함 여부가 바뀌지 않게 하기 위해서다.
   - 포함 판정에는 `TOLERANCE_PX`를 둔다(PRD 5.3.1). 5.6의 "부모 rect 안에 완전히 들어감"도 같다.
3. 둘 중 정확히 하나만 `fixedOrSticky`이다. // PRD 5.3.3: 스크롤 의존 겹침
4. 한쪽이 overlay이거나 overlay의 자손이다. // PRD 5.3.3

둘 다 `fixedOrSticky`이면 비교한다.

### 5.6 Subtype과 Confidence

| subtype | 조건 (위에서부터) |
|---|---|
| `interactive` | 두 요소 모두 인터랙티브 영역 |
| `text` | 두 요소 모두 텍스트 요소이고, 어느 쪽도 인터랙티브 영역이 아님 |
| `other` | 그 밖 |

Confidence (쌍마다 계산):

```text
confidence = 1.0
if subtype != 'interactive':                     // PRD 5.3.3 예외: 인터랙티브끼리는 낮추지 않음
  if (a 또는 b)가 position: absolute이고 그 요소의 rect가 parentIndex 요소의 rect 안에 완전히 들어감:
    confidence = ABSOLUTE_IN_PARENT_CONFIDENCE
```

**대상 요소 기준으로 묶기** (PRD 5.3.3):

```text
쌍 (a, b)의 대상은 index가 작은 쪽 a다.
(viewport, a, subtype)마다 이슈를 하나만 만든다.
  targets = 그 그룹의 상대 요소 b들을 (교차 면적 내림차순, index 오름차순)으로 정렬
  대표 상대 요소 = targets[0]
  relatedElements = targets 앞에서부터 MAX_OVERLAP_TARGETS개, 모두 role 'overlap-target'
  측정값과 confidence = 대표 쌍의 값
  overlapTargetCount = targets 전체 개수
```

- 요소 하나가 여러 요소와 겹치면 고칠 대상은 대개 그 요소 하나다. 하나의 원인이 이슈 여러 개를 만들지 않게 하는 Dedup 원칙(PRD 5.3.5)과 같은 방향이다.
- 이슈 수는 최악의 경우에도 "후보 수 × subtype 3개" 이내다. 쌍 단위로는 요소 수의 제곱까지 늘 수 있다(3,000개가 한 구간에 몰리면 쌍 279,000개 → 묶은 뒤 2,999개).
- confidence는 대표 쌍의 값을 쓴다. Evidence 문장(측정값)과 Confidence가 같은 쌍을 가리키게 하기 위해서다.

측정값:

| measured | expected | delta |
|---|---|---|
| `intersectionArea`, `overlapRatioPercent` (= area / smaller × 100, 대표 쌍), `overlapTargetCount` | `minRatioPercent: 20`, `minAreaPx2: 100` | 없음 (`{}`) |

- 이슈의 대상 요소는 index가 작은 쪽(`a`), `relatedElements[0]`은 대표 상대 요소다.
- `boundingBox`는 두 영역의 교차 영역 합집합이 아니라 대상 요소 `a`의 `rect`다(1.4).

---

## 6. Viewport Overflow (PRD 5.3.4)

### 6.1 넘침 범위 (`extent`)

```text
extent(el) = union(el.rect, ...visibleTextRects(el))     // 3.6
isOut(el)  = extent.right > layoutWidth + TOLERANCE_PX || extent.left < -TOLERANCE_PX
```

텍스트 rect를 포함하는 이유: `white-space: nowrap` 제목처럼 박스는 화면 안이지만 글자만 밖으로 나가는 경우를 잡기 위해서다(PRD 5.3.4).

`visibleTextRects`를 쓰는 이유: `text-overflow: ellipsis` 제목처럼 요소 자신의 `overflow`로 잘려 보이지 않는 글자는 화면 밖으로 나간 것이 아니다(N-02). 조상의 가로 클립은 6.2에서 요소 전체가 제외되므로, 여기서 실제로 영향을 주는 것은 요소 자신의 `overflow`다.

### 6.2 제외

```text
outs = elements where isOut(el)
  && 가로 클립 조상이 없음          // PRD 5.3.4: 캐러셀, 가로 스크롤 영역
```

가로 클립 조상이 있으면 그 요소는 조상 안에서 잘리거나 스크롤되므로 제외한다. 조상 자신이 화면 밖으로 나가면 조상이 따로 `outs`에 들어간다.

오프캔버스 메뉴(`visibility: hidden`, `aria-hidden`)는 3.2 후보 조건에서 이미 빠진다.

### 6.3 원인 요소

```text
causes = outs where (parentIndex == null || !isOut(parent))
// 부모는 화면 안에 있는데 자신은 밖으로 나간 요소
causes에서 다른 cause의 자손인 요소 제거        // 바깥쪽 하나만
for c in causes: c.affectedDescendants = outs 중 c의 자손 수
```

`outs` 중 cause가 아닌 요소는 이슈로 만들지 않는다(Dedup 규칙 1).

### 6.4 Subtype

```text
pageScroll = documentScrollWidth > layoutWidth + TOLERANCE_PX
rootClip   = rootOverflowX.html in (hidden, clip) || rootOverflowX.body in (hidden, clip)

for c in causes:
  if rootClip:
    subtype = 'hidden-clip'
  else if pageScroll && extent(c).right > layoutWidth + TOLERANCE_PX && !c.flags.fixedOrSticky:
    subtype = 'page-scroll'
  else:
    subtype = 'element-out'
```

- `rootClip`을 먼저 확인한다. html/body가 `overflow-x: hidden`이어도 `documentElement.scrollWidth`는 넘친 콘텐츠 너비를 그대로 보고할 수 있어서, `pageScroll`을 먼저 보면 P-04가 `page-scroll`로 잘못 분류된다. 실제 Chromium 동작은 P-04 Fixture로 확인한다.
- 왼쪽으로 나간 요소와 fixed 요소는 문서 가로 스크롤을 만들지 않으므로 `page-scroll`이 아니다.
- `pageScroll`이 참이고 `rootClip`이 거짓인데 `page-scroll` 원인이 하나도 없으면(예: 후보가 아닌 요소가 원인) 이슈를 만들지 않고, 탐지 함수의 반환값에 `unexplainedPageScroll: true`를 함께 돌려준다. 이 값은 로그(호스트만 기록)와 테스트 확인용이며, Redis에 저장하거나 화면에 표시하지 않는다(PRD 8.2에 필드가 없다).
- `rootClip`이면 문서에 가로 스크롤이 생기지 않으므로 `unexplainedPageScroll`은 항상 거짓이다. P-04처럼 `scrollWidth`가 넘친 너비를 보고해도 마찬가지다.

측정값:

| subtype | measured | expected | delta |
|---|---|---|---|
| `page-scroll` | `elementRight`, `documentScrollWidth` | `layoutWidth` | `overflowRight` |
| `element-out`, `hidden-clip` | `elementLeft`, `elementRight` | `layoutWidth`, `minLeft: 0` | `overflowLeft`, `overflowRight` 중 0보다 큰 값 |

`elementLeft`/`elementRight`는 `extent`의 값이다.

---

## 7. Dedup, 매칭, ID (PRD 5.3.5, 5.3.6, 5.6)

### 7.1 Viewport 안 (규칙 1, 2)

1. 규칙 1은 6.3에서 처리된다.
2. 규칙 2: `(type, subtype, element index)`가 같은 RawIssue를 하나로 합친다. 측정값은 큰 delta(delta 값 중 최댓값)를 가진 RawIssue를 통째로 남기고, 같으면 출력 순서(1.4)가 앞인 것을 남긴다. Overlap은 5.6에서 이미 대상 요소 기준으로 묶이고, 다른 유형도 현재 탐지 로직에서는 생기지 않아야 하지만 방어용으로 둔다.

### 7.2 Viewport 간 매칭 (PRD 5.6)

```text
desktop 요소 d와 mobile 요소 m이 같은 요소인 조건 (위에서부터 처음 맞는 기준 사용):
  1. d.identity.id 또는 testId가 있고 m과 같음
  2. d.selector == m.selector
  3. landmark, tag, textSnippet이 모두 같고 textSnippet이 비어 있지 않음
```

- 매칭은 1:1이다. 한 기준에 후보가 여러 개면 문서 순서상 가장 앞의 것을 고르고, 한 번 짝지어진 요소는 다시 쓰지 않는다.
- 기준은 단계별로 적용한다. 기준 1로 가능한 짝을 문서 순서대로 모두 정한 뒤, 남은 요소끼리 기준 2, 그다음 기준 3을 시도한다. 약한 기준(selector)의 짝이 강한 기준(id/testId)의 짝을 먼저 가져가지 않게 하기 위해서다.
- 기준 1은 desktop 요소에 `id` 또는 `testId`가 **있을 때만** 쓴다(값이 없는 요소끼리 같다고 보지 않는다).
- 매칭은 요소 단위다. 병합(7.3)과 유형 간 연결(7.5)이 같은 매칭 결과를 쓴다.
- 매칭은 이슈가 있는 요소에 대해서만 계산한다.

### 7.3 Viewport 간 병합 (규칙 3)

- 같은 `(type, subtype)`이고 대상 요소가 매칭되면 하나의 이슈로 합친다. Overlap도 대상 요소와 subtype만 일치하면 된다. 대표 상대 요소(5.6)는 viewport마다 다를 수 있어서, 상대 요소까지 매칭을 요구하면 같은 문제가 두 이슈로 갈라지기 때문이다. 각 occurrence는 자기 viewport의 `relatedElements`를 그대로 가진다.
- 합친 이슈의 `occurrences`는 `[desktop, mobile]` 순서다.
- `viewportTag`: occurrence가 둘이면 `both`, 하나면 `desktop-only`/`mobile-only`. 한 viewport가 실패한 검사면 `null`(PRD 5.6).

### 7.4 정렬과 ID (PRD 5.3.6)

정렬 키:

```text
1. occurrences[0].viewport          desktop < mobile
2. occurrences[0] 대상 요소 index
3. type                             viewport-overflow < text-overflow < element-overlap
4. subtype                          사전순
5. occurrences[0] 상대 요소 index    없으면 -1 (Overlap은 대표 상대 요소)
```

정렬된 순서대로 `ISS-001`, `ISS-002`, …를 붙인다. 세 자리를 넘으면 그대로 늘린다(`ISS-1000`).

ID는 상한(7.6)을 적용한 뒤 **남은 이슈에만** 붙인다. 그래야 `ISS-001`부터 빈 번호가 없다(DOMAIN_MODEL S-1).

### 7.5 유형 간 연결 (규칙 4)

같은 viewport의 같은 대상 요소에 `viewport-overflow`와 `text-overflow` 이슈가 모두 있으면 서로의 `relatedIssueIds`에 넣는다. 매칭된 요소라면 다른 viewport의 occurrence도 같은 요소로 본다.

`relatedIssueIds`는 ID 오름차순으로 정렬한다. 상한(7.6)으로 버려진 이슈는 연결하지 않는다.

### 7.6 이슈 수 상한 (PRD 5.3.7)

5.6의 묶기가 근본 대책이고, 이 상한은 그래도 많이 남는 경우를 막는 안전장치다.

```text
issuesDetected = 병합(7.3)이 끝난 이슈 수
if issuesDetected > MAX_ISSUES:
  이슈를 (score100 내림차순, 7.4 정렬 키) 순으로 정렬해 앞에서 MAX_ISSUES개만 남긴다
issuesTruncated = issuesDetected > MAX_ISSUES
남은 이슈에 7.4로 ID를 붙인다
```

- 점수가 높은 P0·P1이 먼저 남고, 영향이 적은 P2·P3부터 버린다.
- 동점이면 7.4의 정렬 키를 쓰므로 결과가 결정적이다.
- 200개로 정한 이유: 이슈 하나가 Source Hints를 포함해 1~3KB라 200개면 문서가 수백 KB다. 응답 크기 제한(4.5MB)과 Upstash 요청 한도 안에 넉넉히 들어간다. AI 분석은 이미 최대 30개(PRD 5.7.2)라 영향이 없고, 태스크는 하나에 이슈 최대 8개라 25~40개 수준이다.
- 결과 화면에 "상위 200개만 표시" 안내를 띄운다(PRD 5.3.7, WIREFRAME).

---

## 8. Evidence (PRD 5.4)

### 8.1 Evidence 문장 (`src/server/evidence/sentences.ts`)

숫자는 `Math.round`한 정수 px로 넣는다. `{vp}`는 `Desktop` 또는 `Mobile`이다.

| subtype | 템플릿 |
|---|---|
| `clipped` (x) | 내부 콘텐츠 너비({scrollWidth}px)가 컨테이너 너비({clientWidth}px)를 {overflowX}px 초과합니다. (overflow: {overflowX 값}으로 잘림) |
| `clipped` (y) | 내부 콘텐츠 높이({scrollHeight}px)가 컨테이너 높이({clientHeight}px)를 {overflowY}px 초과합니다. (overflow: {overflowY 값}으로 잘림) |
| `spill` | 텍스트가 테두리가 있는 상위 영역({B 태그})의 {방향 목록} 경계를 최대 {max delta}px 벗어납니다. |
| `interactive` / `text` / `other` | {a 대상}과 {b 대상}의 표시 영역이 {intersectionArea}px² 겹칩니다. (작은 요소 면적의 {overlapRatioPercent}%) |
| `page-scroll` | 요소의 오른쪽 끝({elementRight}px)이 {vp} 화면 너비({layoutWidth}px)를 {overflowRight}px 벗어나 페이지 가로 스크롤이 발생합니다. |
| `element-out` (오른쪽) | 요소의 오른쪽 끝({elementRight}px)이 {vp} 화면 너비({layoutWidth}px)를 {overflowRight}px 벗어납니다. |
| `element-out` (왼쪽) | 요소의 왼쪽 끝({elementLeft}px)이 화면 왼쪽 경계를 {overflowLeft}px 벗어납니다. |
| `hidden-clip` | 요소가 {vp} 화면 너비({layoutWidth}px)를 {overflowRight 또는 overflowLeft}px 벗어나지만, html/body의 overflow-x: hidden 때문에 스크롤 없이 잘립니다. |

- 두 축이 모두 넘친 `clipped`는 두 문장을 공백으로 잇는다.
- 방향 목록: `왼쪽`, `오른쪽`, `위쪽`, `아래쪽` 중 delta가 있는 것을 이 순서로 `, `로 연결
- `{a 대상}`: `tag "textSnippet 앞 20자"`, 텍스트가 없으면 selector
- `affectedDescendants`가 있으면 문장 끝에 ` 하위 요소 {N}개가 함께 화면 밖으로 나갑니다.`를 붙인다. 0이면 붙이지 않는다.
- `overlapRatioPercent`도 다른 숫자처럼 `Math.round`한 정수로 넣는다.
- `element-out`이 양쪽으로 모두 나갔으면 오른쪽 문장 다음에 왼쪽 문장을 공백으로 잇는다.
- `hidden-clip`의 값은 `overflowRight`가 있으면 그 값, 없으면 `overflowLeft`다.
- `spill`의 `{B 태그}`는 `relatedElements[0]`(bordered-ancestor)의 태그다.
- "앞 20자"는 코드 포인트 기준이다(이모지를 반으로 자르지 않는다). 말줄임표는 붙이지 않는다.
- 문장은 occurrence마다 그 viewport의 측정값으로 만든다. 병합된 이슈는 occurrence마다 문장이 다를 수 있다.

### 8.2 Issue Title (PRD 5.4.4)

```text
{type 라벨} · {subtype} — {대상}
Element Overlap은: Element Overlap — {a 대상} ↔ {b 대상}
```

type 라벨: `Text Overflow`, `Element Overlap`, `Viewport Overflow`. Overlap의 subtype은 점수표 구분용이라 제목에 넣지 않는다(PRD 5.4.4 형식에 상대 요소를 더한 것은 이 문서의 결정이다).

### 8.3 `cropRect` (`src/server/evidence/crop.ts`)

```text
box = occurrence.boundingBox
if type == element-overlap:    box = a.rect ∪ b.rect
if type == viewport-overflow:  box = box ∪ ([measured.elementLeft, measured.elementRight] × box의 세로 범위)
if subtype == spill:           box = box ∪ ([textLeft, textRight] × [textTop, textBottom])
// clipped는 잘린 글자가 화면에 보이지 않으므로 넓히지 않는다
r = box를 사방 CROP_PADDING_PX만큼 확장
r의 너비가 CROP_MIN_WIDTH_PX보다 작으면 중심 기준으로 넓힘, 높이도 같은 방식
if box가 [0, screenshotWidth] × [0, screenshotHeight] 안에 완전히 들어오지 않음 (허용치 1px): cropRect = null   // v2.3
r을 [0, screenshotWidth] × [0, screenshotHeight] 안으로 이동 (크기가 더 크면 잘라냄)   // 3.1.1: 실제 스크린샷 크기
```

- **완전 포함 조건 (v2.3):** 크롭 기준 박스(패딩 전)가 스크린샷 밖이거나 일부만 걸치면 `cropRect`는 `null`이다. 일부만 보이는 크롭은 문제 부분(화면 밖으로 나간 쪽, 아래로 넘친 쪽)을 잘라 보여주기 때문이다. 화면은 이때 측정값으로 그린 배치도(16장)를 보여준다. 판정 함수는 서버와 화면이 함께 쓰는 `src/lib/cropBasis.ts`의 `cropBasisFitsScreenshot`이다. 허용치는 PRD 5.3.1의 1px이다.
  - 예: P-04 Desktop `hidden-clip`(넘침 범위 1084~1484, 스크린샷 너비 1440)은 `cropRect = null`이다.

- 스크린샷을 찍지 못한 viewport(`SCREENSHOT_FAILED`, PRD 5.2.4)는 계산하지 않고 모든 occurrence의 `cropRect`가 `null`이다(`src/server/evidence/finalize.ts`).

- Overlap의 b는 대표 상대 요소(`relatedElements[0]`)다.
- `box`는 크롭으로 **무엇을 보여줄지**만 정한다. 하이라이트 위치인 `boundingBox`는 요소의 rect 그대로다.
- Viewport Overflow와 `spill`은 넘친 범위까지 `box`를 넓힌다. 글자가 요소 박스 밖으로 나간 모습이 이 이슈의 핵심 증거이기 때문이다(P-06: 박스 너비 358px, 글자 오른쪽 끝 493px).
- 좌표와 크기는 `MEASURE_DECIMALS` 자리로 반올림한다. 반올림 뒤 끝이 경계를 넘으면 시작을 당겨 크기(최소 320×160)를 유지한다.
- 경계로 쓰는 스크린샷 크기는 PNG 헤더에서 읽은 실제 크기다(`src/server/browser/screenshot.ts`).
  - Mobile에서 페이지가 축소되면 `layoutWidth`보다 넓다(P-01: 616×1334).
  - 루트가 가로를 자르는 페이지(`rootClip`)는 스크린샷 너비가 `layoutWidth`다(PRD 5.2.4). 사용자가 볼 수 없는 영역을 보여주지 않기 위해서다.
- `boundingBox`는 스크린샷 밖으로 나갈 수 있다(예: `hidden-clip`). 이때는 기준 박스도 밖으로 나가므로 `cropRect`가 `null`이다.

### 8.4 `computedStyle`

PRD 5.7.2 화이트리스트 값을 그대로 넣는다. 수집 단계에서 이미 걸러져 있다(3.1).

---

## 9. Priority (PRD 5.5)

### 9.1 점수표 (`rules.ts`)

위에서부터 처음 맞는 행을 쓴다.

| # | type / subtype | 추가 조건 | S | I | R |
|---|---|---|:-:|:-:|:-:|
| 1 | viewport-overflow / page-scroll | — | 4 | 4 | 5 |
| 2 | element-overlap / interactive | — | 5 | 4 | 3 |
| 3 | text-overflow / clipped | 대상이 인터랙티브 영역이거나 nav 안 | 4 | 4 | 3 |
| 4 | viewport-overflow / hidden-clip | — | 3 | 4 | 4 |
| 5 | text-overflow / clipped | 그 밖 (heading, 본문) | 3 | 3 | 3 |
| 6 | element-overlap / text | — | 3 | 3 | 3 |
| 7 | text-overflow / spill | — | 2 | 3 | 3 |
| 8 | viewport-overflow / element-out | — | 2 | 2 | 3 |
| 9 | element-overlap / other | — | 2 | 2 | 2 |

병합된 이슈의 "추가 조건"은 대표 occurrence(`occurrences[0]`)의 요소로 판정한다.

### 9.2 Reach 보정

```text
R = base R
if occurrences 중 하나라도 boundingBox.y < 해당 viewport의 viewportSize.height: R += 1   // 3.1.1, PRD 5.5.3
if occurrences.length == 2: R += 1
R = min(R, REACH_MAX)
```

### 9.3 점수와 등급

```text
score100 = S * 35 + I * 35 + R * 30          // 정수 연산 (PRD 5.5.2)
priority = score100 >= 400 ? 'P0' : score100 >= 300 ? 'P1' : score100 >= 200 ? 'P2' : 'P3'
```

부동소수점 곱셈(`S * 0.35`)을 쓰지 않는다. 테스트에 `S=I=R=3 → 300 → P1` 경계 케이스를 반드시 넣는다.

### 9.4 Confidence와 Needs Review

```text
issue.confidence  = min(occurrence.confidence)
issue.needsReview = issue.confidence < NEEDS_REVIEW_BELOW
```

Priority는 Confidence와 관계없이 9.3으로 계산한다(PRD 5.5.4).

---

## 10. 실패 처리

- 한 viewport의 수집이나 탐지 중 예외가 나면 그 viewport 전체를 `DETECTION_FAILED`로 처리한다(PRD 6.2.4). 규칙 하나만 건너뛰고 나머지를 계속하지 않는다. 일부 규칙만 실행된 결과는 "이슈 없음"과 구분할 수 없어 사용자를 오해하게 만들기 때문이다.
- 실패한 viewport의 결과는 `null`이고, 다른 viewport만으로 병합 이후 단계를 진행한다.
- 이 정책은 v1.0의 "개별 Rule 실패 시 계속 진행"을 바꾼 결정이다.

---

## 11. 결정성 체크리스트

- [ ] 모든 정렬에 7.4, 5.4 같은 명시적인 키가 있다. `Array.prototype.sort`의 비교 함수가 동점일 때 index로 다시 비교한다.
- [ ] `Map`/`Set` 순회 결과를 출력 순서로 쓰지 않는다.
- [ ] 판정 전에 측정값을 반올림한다(3.1).
- [ ] 점수는 정수 연산이다(9.3).
- [ ] 탐지, 우선순위 코드에 `Date`, `Math.random`, AI 호출이 없다.
- [ ] 같은 `CollectedViewport` JSON을 두 번 넣으면 출력 JSON이 바이트 단위로 같다(단위 테스트).

---

## 12. Testing

### 12.1 단위 테스트 (`tests/unit/`)

입력은 손으로 만든 `CollectedViewport` JSON이다. 브라우저 없이 실행한다.

| 모듈 | 필수 케이스 |
|---|---|
| `textOverflow` | clipped x/y/양축 · 이미지만 넘친 overflow hidden 카드는 없음 · ellipsis/line-clamp 제외 · overflow auto 제외 · 중첩 clipped는 깊은 쪽만 · spill 기본 · 테두리 박스 없음 · 중간에 overflow hidden 있으면 spill 아님 |
| `geometry` | 자신의 overflow hidden으로 잘린 텍스트 rect · 조상 체인에 따른 자르기 · 축별 자르기(overflowX만 hidden) · fixed 요소에서 체인 중단 · 완전히 잘린 rect 제거 · `visibleRect`는 자신의 overflow에 잘리지 않음 |
| `overlap` | 버튼 두 개 → interactive, Confidence 1.0 · absolute 배지(부모 안) → 0.4 · 조상/자손 제외 · img 위 텍스트 제외 · sticky와 일반 요소 제외 · fixed끼리 탐지 · 30% overlay 기록과 제외 · line-height 보정으로 인접 줄 오탐 없음 · 20%와 100px² 경계값 · line-clamp로 숨겨진 줄과 아래 요소는 겹침 아님 · overflow hidden 카드 밖으로 잘린 img는 잘린 영역만 비교 · 완전히 잘린 요소는 비교 대상 아님 · 대상 요소 기준 묶기(대표 = 교차 면적 최대, `relatedElements` 최대 5개, `overlapTargetCount`) · subtype이 다르면 따로 묶음 |
| `viewportOverflow` | page-scroll 원인 1개와 affectedDescendants · nowrap 텍스트만 넘친 제목이 원인 · ellipsis 제목(자신의 overflow hidden)은 이탈 아님 · 캐러셀(overflow-x auto 조상) 제외 · hidden-clip · 왼쪽 이탈은 element-out · fixed 요소는 page-scroll 아님 |
| `dedup` / `match` | 3가지 매칭 기준과 1:1 보장 · 병합 후 viewportTag · 규칙 4 연결 · Overlap은 대표 상대 요소가 달라도 대상 요소와 subtype이 같으면 병합 |
| `order` | 정렬 키 5단계 각각 · 입력 순서를 섞어도 같은 ID · 상한 초과 시 score100 순 선택과 동점 처리(7.4 키) · 상한 뒤 ID에 빈 번호 없음 · `issuesDetected`/`issuesTruncated` |
| `score` | 점수표 9행 · Reach 보정 상한 · **S=I=R=3 → P1** · 경계 399/400, 299/300 · 첫 화면 판정이 `innerHeight`가 아니라 `viewportSize.height` 기준 |
| `sentences` | subtype별 템플릿 · 반올림 · affectedDescendants 문구 |
| `crop` | 패딩, 최소 크기, 경계 안으로 이동, 범위 밖 null · 스크린샷 너비가 `layoutWidth`보다 넓은 경우(Mobile 축소) |

### 12.2 Fixture 테스트 (`pnpm test:fixtures`)

`public/fixtures/`의 15개 페이지를 로컬 브라우저로 검사하고 아래 기대 결과와 비교한다. 기대 결과는 `tests/fixtures/expected.ts`에 둔다. 테스트를 통과시키려고 기대값을 바꾸지 않는다(AGENTS.md 10장).

| ID | 기대 결과 (`needsReview: false`인 이슈 기준) | 페이지 구성 요건 |
|---|---|---|
| P-01 | `viewport-overflow/page-scroll` 1개, P0, `mobile-only`, `affectedDescendants`와 무관하게 이슈 1개 | 600px 고정 박스 안에 자식 요소 몇 개를 둔다 (원인 1개만 보고하는지 확인) |
| P-02 | `text-overflow/clipped` 1개, P1, `mobile-only` | 버튼을 문서 y ≥ 900px에 두고, media query로 Mobile에서만 너비를 줄인다 |
| P-03 | `element-overlap/interactive` 1개, P0, Confidence 1.0 | 같은 부모 안 absolute 버튼 두 개 |
| P-04 | `viewport-overflow/hidden-clip` 1개 이상 | `body { overflow-x: hidden }` + 오른쪽으로 나간 `img` |
| P-05 | `text-overflow/spill` 1개 | 배경색이 있는 고정 높이 카드, 카드와 본문 사이에 overflow hidden 없음 |
| P-06 | `viewport-overflow/page-scroll` 1개(원인 = 제목), 같은 요소의 `text-overflow`는 없거나 `relatedIssueIds`로 연결(`allowed`) | `white-space: nowrap` 제목, Mobile에서만 넘침 |
| N-01 ~ N-09 | 이슈 0개 (`needsReview: true` 허용) | PRD 13.1 |

- Positive 판정:
  - 기대 이슈(`expected`)는 모두 같은 type, subtype, priority, viewportTag, 대상 요소(`data-testid`)로 `needsReview: false`인 상태로 탐지되어야 한다.
  - 기대하지 않은 이슈 중 `needsReview: false`인 것이 있으면 **실패**한다. Positive 페이지는 의도한 문제 외에는 이슈가 없도록 만들었으므로, 추가 이슈는 탐지 코드의 오탐이거나 Fixture의 잘못이다. 어느 쪽인지 확인하고 고친다.
  - 기대하지 않은 이슈 중 `needsReview: true`인 것은 실패로 보지 않고 로그에 남긴다(Negative 기준과 같다).
  - 허용 이슈(`allowed`)에 적힌 이슈는 나와도, 나오지 않아도 통과한다. PRD가 결과를 둘 중 하나로 허용한 경우에만 쓴다(예: P-06의 연결된 `text-overflow`).
- 하네스(`tests/fixtures/run.ts`)는 expected.ts에 값이 있으면 `relatedTestId`, `confidence`, `scores`도 비교한다. 허용 이슈가 나오면 같은 요소의 주 이슈와 `relatedIssueIds`로 연결되어 있어야 한다(PRD 13.1 P-06).
- `pnpm test:fixtures --repeat N`은 전체를 N번 실행하고 `buildIssues` 결과 JSON이 모두 같은지 확인한다(11장).
- 각 Fixture는 의도한 문제 외에 다른 문제가 생기지 않게 최소한으로 만든다.
- Fixture의 기본 스타일은 CJK 폰트(Noto Sans KR)를 쓴다(PRD 5.2.3).
- 결과는 README에 표로 기록한다(PRD 13.2).

---

## 13. 분석 단계 (PRD 5.7~5.9)

AI를 호출하지 않는 MVP의 분석 단계다(PRD 5.7.1). `/analyze`의 `after()`에서 `runAnalysis`(`src/server/analyze.ts`)가 다음 순서로 실행한다(DOMAIN_MODEL 4.3).

```text
analysis.running, step = analyzing_issues 저장
이슈 0개 → analysis.skipped, tasks = [] 로 최종 저장하고 끝
analyzeIssues(issues)                       // 13.1, src/server/analysis/analyze.ts
step = generating_tasks 저장
groupIssues → buildAcceptanceCriteria → buildPrompt   // 13.2~13.4, src/server/tasks/build.ts
analysis.completed + 최종 상태(PRD 6.2.2) + completedAt 을 한 번에 저장
예외 → analysis.failed(AI_FAILED) + partial, 이슈는 브라우저 단계 결과 그대로(analysisSkippedReason: ai-failed), tasks = []
```

모든 함수는 순수 함수다. 같은 입력이면 출력이 바이트 단위로 같고, 입력 이슈의 순서와 무관하다(11장).

### 13.1 규칙 기반 원인 분석 (`src/server/analysis/rules.ts`)

`analyzeIssueByRules(issue)`. `needsReview` 이슈는 분석하지 않고 `analysisSkippedReason: 'needs-review'`만 둔다(DOMAIN_MODEL S-9). 분석 대상 수 제한(PRD 5.7.2의 30개)은 AI 비용 때문이므로 규칙 분석에는 적용하지 않는다.

규칙은 대표 occurrence(`occurrences[0]`)의 측정값과 `computedStyle`로 고른다. 위에서부터 처음 맞는 규칙을 쓴다.

| # | 대상 | 조건 | 원인 요지 | 수정 방향 |
|---|---|---|---|---|
| V1 | viewport-overflow 전체 | `white-space`가 `nowrap` 또는 `pre` | 줄바꿈이 금지되어 내용이 화면 밖으로 나감 | 줄바꿈 허용, 또는 `overflow` + `text-overflow` 처리 |
| V2 | 〃 | `min-width`가 px 값이고 `layoutWidth`보다 큼 | 최소 너비가 화면 너비보다 큼 | `min-width` 제거 또는 `max-width: 100%` |
| V3 | 〃 | `flex-shrink`가 `0`이고 요소 너비 > `layoutWidth` | flex 항목이 줄어들지 않음 | 축소 허용, `min-width: 0`, 또는 `flex-wrap` |
| V4 | 〃 | `grid-template-columns`의 px 트랙 합이 `layoutWidth`보다 큼 | 고정 열 너비 합이 화면보다 큼 | `minmax(0, 1fr)`, `auto-fit` |
| V5 | 〃 | `position`이 `absolute`/`fixed` | 위치 지정 요소가 화면 밖에 놓임 | 위치 값 조정 |
| V6 | 〃 | `transform`이 `none`이 아님 | transform 이동으로 화면 밖에 놓임 | 이동 값 조정 |
| VM | 〃 | 오른쪽으로 넘치면 `margin-left`, 왼쪽으로 넘치면 `margin-right`가 양수 px이고 넘친 양(`overflowRight`/`overflowLeft`) 이상 | 반대쪽 margin이 요소를 화면 밖으로 밀어냄 | margin을 줄이거나 flex 정렬로 배치, `max-width: 100%` |
| V7 | 〃 | 요소 너비(`boundingBox.width`) > `layoutWidth` | 고정 너비로 추정 | `max-width: 100%`, 반응형 단위 |
| C1 | clipped (x축) | `white-space: nowrap` | 한 줄 고정 상태에서 너비가 부족해 잘림 | 줄바꿈 허용, 또는 의도라면 `text-overflow: ellipsis` |
| C2 | clipped (y축) | — | 높이가 고정되어 내용이 잘림 | `height` 대신 `min-height`, 또는 `height: auto` |
| C3 | clipped (x축, C1 아님) | — | 너비가 내용보다 좁음 | 너비 확대, `overflow-wrap` |
| S1 | spill | 아래쪽으로 넘침(`overflowBottom > 0`) | 상위 영역 높이가 고정되어 텍스트가 아래로 넘침 | 상위 영역 `height: auto` 또는 `min-height` |
| S2 | spill | 왼쪽 또는 오른쪽으로 넘침 | 긴 단어나 줄바꿈 금지로 가로로 넘침 | `overflow-wrap: anywhere`, `word-break` |
| O1 | element-overlap | 대상 요소가 `position: absolute`/`fixed` | 위치 지정 요소가 흐름 밖에서 겹침 | 위치 조정, 또는 일반 흐름으로 배치 |
| O2 | 〃 | 대상 요소의 `margin`에 음수 px | 음수 margin으로 겹침 | margin 조정, `gap` 사용 |
| O3 | 〃 | 대상 요소의 `transform`이 `none`이 아님 | transform 이동으로 겹침 | 이동 값 조정 |
| X | 전체 | 위에 해당 없음 | 원인을 특정하지 못함 | 확인한 CSS 값을 나열하고 소스 확인 안내 |

판정 세부:
- 크기 비교(V2, V3, V4, V7, VM)는 Evidence 문장과 같은 정수 반올림 값으로 한다. 문구에 나오는 숫자와 판정 결과가 어긋나지 않게 하기 위해서다.
- 계산된 `margin` 단축 값은 CSS 규칙대로 토큰 1~4개를 좌우 값으로 펼친다. px가 아닌 값(`auto` 등)은 판정에 쓰지 않는다.
- clipped의 축은 `Issue`에 `axes`가 없으므로 `delta`의 `overflowX`/`overflowY` 키로 판단한다.
- O1~O3는 대상 요소의 `computedStyle`만 본다. 상대 요소(`RelatedElement`)의 `computedStyle`은 수집하지 않기 때문이다.
- S1의 근거는 `computedStyle`이 아니라 상위 영역(`bordered-ancestor`)의 측정 높이(`boundingBox.height`)다. 상위 영역의 `computedStyle`은 수집하지 않는다.

출력 (`Issue.analysis`):

| 필드 | 내용 |
|---|---|
| `source` | `'rule'` |
| `certainty` | 맞는 규칙이 있으면 `likely`, X면 `uncertain`. `confirmed`는 쓰지 않는다(PRD 5.7.1) |
| `rootCause` | `{원인 요지}. 근거({Viewport}): {CSS 값}, {측정값}`. occurrence가 2개이고 근거가 같으면 `근거(Desktop, Mobile)` 한 번, 다르면 viewport별로 `;`로 잇는다 |
| `cssProblem` | 판정에 쓴 CSS 속성과 값 (X는 유형별로 확인한 화이트리스트 값) |
| `fixDirection` | 표의 수정 방향 |
| `suggestedFix` | 수정 방향 + 대상 selector를 쓴 CSS 예시 코드 블록 + "selector는 빌드된 DOM 기준이라 소스와 다를 수 있다"는 안내. X는 CSS 예시 없이 소스 확인 안내만 둔다 |

- 숫자는 측정값을 `Math.round`한 정수 px다(8.1). 측정값을 새로 계산하지 않는다.
- 페이지에서 가져온 텍스트(`textSnippet`, `htmlSnippet`, `landmark`)는 문구에 넣지 않는다. selector와 CSS 값만 쓴다.

### 13.2 태스크 그룹화 (`src/server/tasks/group.ts`, PRD 5.8.1)

- 일반 이슈와 Needs Review 이슈를 따로 묶는다. 규칙 2(연결 이슈 합치기)도 같은 쪽 이슈끼리만 적용한다.
- 규칙 1의 키는 `(viewportTag, landmark)`이다. `viewportTag: null`(한 viewport 실패)과 "landmark 없음"도 각각 하나의 값이다.
- 규칙 2로 합쳐진 그룹의 landmark: 모든 이슈의 landmark가 같으면 그 값, 다르면 없음(제목은 "페이지").
- 규칙 3: 그룹 안을 Priority → ID로 정렬하고, `relatedIssueIds`로 연결된 덩어리 단위로 앞에서부터 8개(`MAX_ISSUES_PER_TASK`)까지 채운다. 덩어리가 현재 조각에 들어가지 않으면 새 조각을 시작한다. 덩어리 하나가 8개를 넘으면 그 덩어리만 순서대로 자른다(같은 요소의 이슈끼리만 연결되므로 실제로는 생기지 않는다).
- 조각마다 viewportTag(포함된 이슈의 viewport 합집합, `null`이 하나라도 있으면 `null`)와 landmark를 다시 계산한다.
- 기본 제목의 type 목록은 Priority → ID 순으로 처음 나온 순서다. viewportTag 라벨은 `Mobile` / `Desktop` / `Desktop + Mobile` / `비교 불가`(`null`).
- `description`은 `- {issueId} ({Viewport}): {evidenceText}`를 이슈 ID 순, occurrence 순으로 나열한다.
- `issueIds`는 ID 오름차순이다(DOMAIN_MODEL T-3). Issue ID는 문자열이 아니라 번호로 비교한다.
- 규칙 분석만 하는 MVP에서는 모든 태스크가 `titleSource: 'template'`이다.

### 13.3 Acceptance Criteria (`src/server/tasks/acceptance.ts`, PRD 5.8.2)

이슈(ID 순) → occurrence(desktop → mobile) 순으로 만들고, 같은 문장은 하나만 남긴다. `{lw}`는 해당 viewport의 `layoutWidth`(정수 반올림)다.

| 유형 | 문장 |
|---|---|
| `page-scroll` | "{lw}px viewport에서 `document.documentElement.scrollWidth`가 {lw} 이하이다." |
| `element-out`, `hidden-clip` | 오른쪽으로 넘침: "{lw}px viewport에서 {selector}의 오른쪽 끝(요소와 텍스트 영역)이 {lw}px 이하이다." / 왼쪽으로 넘침: "… 왼쪽 끝(요소와 텍스트 영역)이 0px 이상이다." |
| `clipped` | x축: "{lw}px viewport에서 {selector}의 `scrollWidth`가 `clientWidth`를 넘지 않는다." / y축: `scrollHeight`, `clientHeight` |
| `spill` | "{lw}px viewport에서 {selector}의 텍스트 영역(`Range.getClientRects()`)이 {상위 영역 selector}의 테두리 안에 있다." |
| `element-overlap` | "{lw}px viewport에서 {selector}의 표시 영역이 {relatedElements selector 목록}의 표시 영역과 겹치지 않는다." (탐지 임계값보다 엄격하다) |
| 한쪽 viewport 태스크 | 마지막에 "{다른 viewport의 layoutWidth}px viewport의 레이아웃은 변경되지 않는다." |

- `viewportTag: null` 태스크는 다른 viewport를 측정하지 못했으므로 마지막 항목을 넣지 않는다.
- selector는 13.4의 인라인 코드 규칙으로 감싼다.

### 13.4 프롬프트 조립 (`src/server/prompt/template.ts`, PRD 5.9.1)

PRD 5.9.1 템플릿을 그대로 쓴다. PRD가 정하지 않은 경우:
- `Viewport:` 줄의 `viewportTag`가 `null`이면 `비교 불가`.
- `{otherViewportConstraint}`가 `null`이면 `다른 viewport는 검사하지 못했으므로, 수정한 뒤 Desktop과 Mobile에서 모두 레이아웃을 확인한다.`
- `analysis`가 없는 이슈는 certainty와 출처가 없으므로 제목을 괄호 없이 `### Likely Root Cause`로 쓰고, PRD의 대체 문구를 넣는다.
- `Attributes:`는 `key="value"`를 속성 이름 순으로 인라인 코드로 나열한다. Source Hints 항목이 모두 없으면 `### How to locate the element in source` 제목도 생략한다.
- `Evidence`의 크기는 `{layoutWidth}×{ViewportResult.height}`다.

페이지에서 가져온 문자열(selector, `textSnippet`, `htmlSnippet`, `landmark`, 속성값, Evidence 문장, 제목)은 내용을 바꾸지 않고 다음만 처리한다(`src/server/prompt/markdown.ts`):
- 줄바꿈(CR, LF, CRLF, U+2028, U+2029)은 공백 하나로 바꾼다.
- 인라인 코드는 값 안의 가장 긴 백틱 묶음보다 하나 긴 구분자를 쓰고, 값이 백틱으로 시작하거나 끝나면 양쪽에 공백을 둔다(CommonMark).
- 코드 블록(`suggestedFix`)은 내용 안의 백틱 묶음보다 긴 구분자(최소 3개)를 쓴다.

---

## 14. Out of Scope

v1.0에 있었지만 PRD v1.2 범위가 아니라 구현하지 않는 것:

| 항목 | 이유 |
|---|---|
| 세로 Viewport Overflow (fixed 요소, Modal이 화면 밖) | PRD 5.3.4는 가로만 다룬다 |
| `elementFromPoint` 기반 클릭 방해 판정 | PRD 5.3.3에 없음. 측정 시점과 스크롤 상태에 따라 결과가 달라진다 |
| ellipsis 제목을 검토 대상으로 분류 | PRD 5.3.2는 ellipsis를 탐지하지 않는다 |
| Severity 4단계 분류 | PRD 5.5는 S 1~5 규칙표를 쓴다 |
| Rule ID, Rule Version 필드 | PRD 8.2 데이터 모델에 없다. 필요하면 PRD를 먼저 고친다 |

---

## 15. 이 문서에서 새로 정한 값과 규칙

PRD에 없던 구현 결정이다. AGENTS.md 6장에 따라 보고 대상이다.

1. `element-overlap` subtype을 `interactive`, `text`, `other`로 정했다(5.6).
2. `landmark`가 없으면 가장 가까운 랜드마크 태그 이름을 대신 쓴다(3.5).
3. Selector 생성 규칙과 "안정적인 class" 패턴(3.4).
4. Overlap 이슈의 대상은 문서 순서가 앞인 요소이고, `boundingBox`는 그 요소의 rect다(5.6).
5. Viewport Overflow 제외 조건을 "가로 클립 조상이 있으면 제외"로 해석했다(6.2).
6. `page-scroll` 원인을 찾지 못한 경우 이슈를 만들지 않고 `unexplainedPageScroll`로 기록한다(6.4).
7. 탐지 중 예외가 나면 그 viewport 전체를 `DETECTION_FAILED`로 처리한다(10장).
8. Overlap 제목에 상대 요소를 넣는다(8.2).
9. 새 파일 `src/server/detect/order.ts`, `src/server/collect/types.ts`(1.3, 3.1).
10. `spill`의 테두리 박스를 "조상"이 아니라 "자신 또는 조상"에서 찾는다(4.2). 배경이 있는 버튼 밖으로 글자가 넘치는 경우를 잡기 위해서다. PRD 5.3.2도 같이 고쳤다.
11. `hidden-clip` 판정을 `page-scroll`보다 먼저 한다(6.4).
12. Overlap 영역과 Viewport Overflow 범위는 `overflow`로 잘린 부분을 뺀 보이는 영역으로 계산한다(3.6). PRD 5.3.3, 5.3.4의 "의도된 디자인 제외"를 구현하는 방법이다.
13. Positive Fixture에서 기대하지 않은 `needsReview: false` 이슈는 실패로 본다. 허용 이슈(`allowed`)를 둔다(12.2).
14. 새 파일 `src/server/detect/geometry.ts`(3.6).
15. `CollectedViewport`에 `elementsTruncated`, `viewportSize`를 둔다(3.1).
16. 자신 또는 조상의 `opacity`가 0이면 서브트리 전체를 후보에서 뺀다(3.2).
17. 판정에 `innerWidth`/`innerHeight`를 쓰지 않는다. overlay 면적은 `layoutWidth × viewportSize.height`, cropRect 경계는 실제 스크린샷 크기를 쓴다(3.1.1).
18. `RawIssue` 구조와 탐지 함수 반환 형태(객체)를 정했다. 모든 유형의 `boundingBox`는 대상 요소의 `rect`다(1.4). 새 파일 `src/server/detect/types.ts`.
19. 비교 대상 "말단"은 후보 자손 중 텍스트·인터랙티브·미디어 요소가 있는지로 판정하고, 인터랙티브 요소는 그런 자손이 모두 텍스트 요소일 때만 예외로 넣는다(5.1).
20. 제외 조건 2는 포함하는 쪽 `visibleRect`, 포함되는 쪽 5.1 영역으로 판정하고 1px 허용치를 둔다(5.5).
21. `rootClip`이면 `unexplainedPageScroll`은 거짓이다(6.4).
22. 겹침 이슈를 `(viewport, 대상 요소, subtype)`마다 하나로 묶고, 대표 상대 요소와 `relatedElements` 최대 5개, `overlapTargetCount`를 둔다. confidence는 대표 쌍의 값이다(5.6).
23. Overlap의 viewport 간 병합은 대상 요소와 subtype만 일치하면 된다(7.3).
24. 검사 1회당 이슈 상한 `MAX_ISSUES = 200`, score100 순으로 선택한다. 처리 순서를 병합 → Priority → 상한 → ID → 연결 → Evidence로 바꿨다(1.3, 7.6).
25. 새 파일 `src/server/collect/round.ts`: `roundMeasure`를 수집과 판정이 함께 쓰도록 분리했다.
26. 새 파일 `src/server/detect/pipeline.ts`(`buildIssues`, `detectViewport`)와 중간 타입 `MergedIssue`/`ScoredIssue`/`DetectedIssue`(1.3, 1.5).
27. 매칭 기준을 단계별로 적용하고, 기준 1은 값이 있을 때만 쓴다(7.2).
28. 규칙 2에서 delta가 큰 RawIssue를 통째로 남기고, 같으면 출력 순서가 앞인 것을 남긴다(7.1).
29. 병합된 Viewport Overflow 이슈의 `affectedDescendants`는 `occurrences[0]`의 값이다(1.5).
30. `test:fixtures`는 기대 이슈의 `relatedTestId`, `confidence`, `scores`(expected.ts에 값이 있는 경우)까지 비교하고, 허용 이슈(`allowed`)가 나오면 같은 요소의 주 이슈와 `relatedIssueIds`로 연결되어 있는지 확인한다(12.2).
31. Evidence 문장의 세부 규칙: 비율도 정수 반올림, 양쪽 `element-out`은 두 문장, `hidden-clip`은 `overflowRight` 우선, "20자"는 코드 포인트 기준, `affectedDescendants`가 0이면 문구 생략(8.1).
32. cropRect 반올림 방식(8.3).
33. 새 파일 `src/server/browser/screenshot.ts`(`captureFullPage`, `readPngSize`), `src/server/evidence/title.ts`, `src/server/evidence/finalize.ts`(`finalizeIssues`, `buildViewportResult`). 스크린샷 시간 제한 `SCREENSHOT_TIMEOUT_MS = 10s`(PRD 8.1.3 "측정과 스크린샷 20s" 안의 몫).
34. `ViewportResult.documentHeight`는 스크린샷 촬영 시점의 값이다. `screenshotTruncated`와 같은 기준이어야 V-2가 성립하기 때문이다.
35. `rootClip` 페이지의 스크린샷 너비를 `layoutWidth`로 자른다(PRD 5.2.4).
36. Viewport Overflow와 `spill`의 크롭 기준 박스에 넘침 범위를 포함한다(8.3).
37. 원인 분석 규칙 표(13.1). 작업 지시(T10)의 초기 표에 `VM`(margin으로 밀려남)을 V6과 V7 사이에 추가했다. 크기 비교는 정수 반올림 값으로 한다. O1~O3는 대상 요소만 본다.
38. 그룹화 세부 규칙(13.2): 합쳐진 그룹의 landmark가 다르면 없음, 연결 덩어리 단위 분할, viewportTag 라벨 `Desktop + Mobile`·`비교 불가`, 태스크당 최대 8개를 `group.ts`의 상수로 둔다.
39. Acceptance Criteria 문장(13.3). spill과 overlap 문장, 모든 문장 앞의 `{lw}px viewport에서`, `viewportTag: null`이면 다른 viewport 항목 생략.
40. 프롬프트의 PRD 미정 경우(13.4)와 Markdown 처리 규칙. 새 파일 `src/server/prompt/markdown.ts`.
41. 새 폴더 `src/server/analysis/`(`rules.ts`, `analyze.ts`)와 새 파일 `src/server/tasks/build.ts`.
42. 분석 단계 예외(규칙 분석 실패 포함)에도 `AI_FAILED`를 쓴다(PRD 6.2.4). 이름은 AI 연동(T15)을 기준으로 둔다.
43. (v2.3) 페이지 구성 도면 `layoutMap`의 추출 규칙과 상수 전부(16장). 새 폴더 `src/server/layout/`(`buildLayoutMap.ts`, `constants.ts`).
44. (v2.3) 수집에 `layoutAttrs`(alt, placeholder, input type)를 더했다(3.1). label 외에는 쓰지 않는다.
45. (v2.3) `cropRect` 완전 포함 조건과 1px 허용치(8.3).
46. (v2.4) 배치도 text 블록의 블록 레벨 조건, inline 판정(`display`가 `inline`으로 시작하거나 `contents`), 자손 중복 막기(16.1).
47. (v2.4) 배치도용 canvas 수집 `layoutCanvases`와 상한 `LAYOUT_MAX_CANVASES = 20`(3.1, 16.1).
48. (v2.4) 구조 블록 합치기 `LAYOUT_STRUCT_MERGE_TOLERANCE_PX = 8`, 이름 최대 `LAYOUT_STRUCT_MERGE_MAX_NAMES = 2`(16.1, 16.2).
49. (v2.4) heading label 원재료 `layoutAttrs.text`(innerText)와 label 길이 heading 24자, button 16자(16.2).

---

## 16. 페이지 구성 도면 (`layoutMap`, `src/server/layout/`)

`ViewportResult.layoutMap`(PRD 8.2)은 사진이 없는 부분을 도면으로 채우기 위한 페이지 구성이다. `buildViewportResult`가 스크린샷 성공 여부와 관계없이 **항상** 만든다. 수집한 `CollectedViewport`만으로 만드는 순수 함수 `buildLayoutMap(collected)`이고, 브라우저에서 새로 측정하지 않는다. 탐지 결과, ID, Priority에 영향을 주지 않는다.

### 16.1 블록 선택

후보 요소를 문서 순서(index)로 보며 위에서부터 처음 맞는 순위를 쓴다. 영역은 보이는 영역(3.6 `visibleRect`)이고, 보이는 영역이 없으면 넣지 않는다. canvas는 후보 요소가 아니라 배치도용 canvas(`layoutCanvases`)로만 만든다.

| 순위 | kind | 조건 |
|---|---|---|
| 1 | header, nav, main, section, footer, aside, form | 해당 태그 또는 `role` ∈ {banner, navigation, main, region, contentinfo, complementary, form}. 면적 ≥ `layoutWidth × LAYOUT_STRUCT_MIN_HEIGHT_PX` |
| 2 | canvas | `layoutCanvases`의 항목 전부. 영역은 수집한 rect(보이는 영역으로 자르지 않는다). 후보 목록의 canvas 요소는 쓰지 않는다 |
| 2 | video, iframe | 태그. 크기 조건 없음 |
| 3 | heading | `h1`~`h3`, `role=heading` |
| 4 | button | `button`, `input[type=submit|button|reset|image]`, 또는 자신이 인터랙티브(3.3)이면서 테두리 박스이고 높이 ≤ `LAYOUT_BUTTON_MAX_HEIGHT_PX` (input/select/textarea 제외) |
| 5 | image | `img`, `svg`, `background-image`에 `url(`이 있는 요소. 면적 ≥ `LAYOUT_IMAGE_MIN_AREA_PX2` |
| 6 | input | `input`(hidden 제외, 4의 type 제외), `select`, `textarea` |
| 7 | card | 테두리 박스이고 면적 ≥ `layoutWidth × viewportSize.height × LAYOUT_CARD_MIN_VIEWPORT_RATIO` |
| 8 | text | **블록 레벨 요소만.** 영역 = 자신의 `visibleTextRects` ∪ inline 자손들의 `visibleTextRects`. 높이 ≥ `LAYOUT_TEXT_MIN_HEIGHT_PX` |

**inline 레벨:** `computedStyle.display`가 `inline`으로 시작하거나(`inline`, `inline-block`, `inline-flex`, `inline-grid` …) `contents`인 요소. 값이 없으면 블록 레벨로 본다. inline 레벨 요소는 text 블록을 만들지 않는다. inline 자손은 가장 가까운 후보 조상이 블록 레벨일 때까지 inline만 이어지는 경우에 그 블록 레벨 조상(owner)의 text 영역에 더한다. 글자·단어 단위로 쪼갠 애니메이션 텍스트(`span` 하나에 글자 하나)가 막대 수십 개가 되지 않게 하기 위해서다.

**배치도용 canvas (`layoutCanvases`, 수집 단계):** 문서의 모든 `canvas`를 후보 조건(3.2)과 별도로 수집한다. 자신의 `display`가 `none`이 아니고 크기가 1px보다 크면(조상이 `display: none`이면 크기가 0) 넣는다. 조상 `opacity`, `aria-hidden`, `visibility`, sr-only 규칙은 적용하지 않는다. 인트로 애니메이션 중이거나 장식용으로 숨긴 3D 배경도 화면 구성의 큰 부분이기 때문이다. 좌표는 측정 시점(scrollY = 0)의 문서 좌표이고 `position: fixed`인 canvas도 같다. 문서 순서로 최대 `LAYOUT_MAX_CANVASES`개. 탐지에는 쓰지 않는다(`hasCanvas`는 그대로다).

1. 좌표를 정수로 반올림(Math.round, 네 변 각각)하고 문서 범위 `[0, scrollWidth] × [0, height]`로 자른다. 비면 버린다. `scrollWidth = max(layoutWidth, documentScrollWidth)`, `height = min(documentHeight, LAYOUT_MAX_HEIGHT[viewport])`.
2. 자손 중복 막기: 이미 heading·button·input으로 고른 요소의 자손은 heading·button·input·text 블록을 만들지 않는다. 이미 text로 고른 요소의 자손은 text 블록을 만들지 않는다. (image, card 등 다른 종류는 그대로 만든다.)
3. 중복 제거: 가장 가까운 남은 조상 블록과 사방 `LAYOUT_DEDUP_TOLERANCE_PX` 이내로 같으면 하나만 남긴다. 구조(1)·미디어(2) 블록은 항상 남기고, 한쪽만 그렇다면 그쪽을 남긴다. 둘 다 아니면 순위가 높은 쪽, 같으면 바깥쪽을 남긴다.
4. 구조 블록 합치기: 가장 가까운 남은 구조 조상과 사방 `LAYOUT_STRUCT_MERGE_TOLERANCE_PX` 이내로 같은 크기인 구조 블록은 그 조상(바깥쪽)에 합친다. 합친 블록의 kind와 영역은 바깥쪽 것이고, label은 16.2의 묶음 규칙을 따른다.
5. 블록이 `LAYOUT_MAX_BLOCKS`를 넘으면 순위 → 면적(큰 순) → index로 골라 상한만큼 남기고, 다시 index 순으로 정렬한다.
6. `depth`는 남은 구조 블록 중 조상의 개수다(canvas는 `layoutCanvases.ancestorIndices` 기준).
7. `truncated = documentHeight > LAYOUT_MAX_HEIGHT[viewport] || 블록 수 상한에 걸림`.

### 16.2 label

페이지에서 가져온 문자열이다. 제어 문자와 줄바꿈을 공백으로 바꾸고 공백을 하나로 줄인 뒤, 길이를 넘으면 말줄임(…)한다(UTF-16 길이 기준, 서로게이트 쌍을 자르지 않는다). 화면은 문자열로만 렌더링한다(AGENTS.md 8장).

| kind | label |
|---|---|
| 구조 블록 | 블록마다 이름 `{tag}#{id}` → `{tag} "{aria-label}"` → `{tag}`. role로 판정한 블록은 `{tag}` 대신 kind. heading 텍스트는 쓰지 않는다. 합친 블록은 이름을 바깥쪽부터 ` · `로 최대 `LAYOUT_STRUCT_MERGE_MAX_NAMES`개 잇고, 넘는 수는 ` +{n}`(예: `main · section +1`). 전체 40자 |
| heading | `aria-label` → `layoutAttrs.text`(innerText) → `textSnippet`, 24자. textSnippet은 `<br>`로 나눈 줄 사이 공백이 사라지고 숨긴 반응형 사본까지 붙기 때문이다 |
| button | `aria-label` → `textSnippet`, 16자 |
| text, card | 없음 |
| image | `alt` 20자, 없으면 "이미지" |
| canvas, video | "canvas", "video" |
| iframe | "iframe (내부 미검사)" |
| input | `placeholder` → `name` 20자, 없으면 "입력" |

### 16.3 상수 (`src/server/layout/constants.ts`)

| 상수 | 값 |
|---|---|
| `LAYOUT_MAX_BLOCKS` | 400 |
| `LAYOUT_MAX_HEIGHT` | Desktop 10,000 / Mobile 15,000 |
| `LAYOUT_STRUCT_MIN_HEIGHT_PX` | 40 |
| `LAYOUT_IMAGE_MIN_AREA_PX2` | 48 × 48 |
| `LAYOUT_CARD_MIN_VIEWPORT_RATIO` | 0.02 |
| `LAYOUT_BUTTON_MAX_HEIGHT_PX` | 120 |
| `LAYOUT_TEXT_MIN_HEIGHT_PX` | 12 |
| `LAYOUT_DEDUP_TOLERANCE_PX` | 4 |
| `LAYOUT_STRUCT_MERGE_TOLERANCE_PX` | 8 |
| `LAYOUT_STRUCT_MERGE_MAX_NAMES` | 2 |
| `LAYOUT_MAX_CANVASES` | 20 (수집 상한) |
| label 길이 | 40 / heading 24 / button 16 / image·input 20 |

### 16.4 크기

블록 하나가 약 80~90바이트라 viewport당 최대 약 36KB다. fillout.com(로컬 측정): Desktop 251블록 20.7KB, Mobile 228블록 18.6KB. 문서가 1MB를 넘으면 `LAYOUT_MAX_BLOCKS`를 줄인다(DOMAIN_MODEL 6.1).

### 16.5 테스트 (`tests/unit/layoutMap.test.ts`)

같은 입력 → 바이트 단위로 같은 출력, 입력 순서를 섞어도 같음, 순위별 선택과 label, 블록 상한, 높이 상한, 중첩 중복 제거, canvas만 있는 입력, label 정리와 길이 제한, inline 자손이 text 블록을 만들지 않음, heading·button 자손 중복 없음, opacity 0·aria-hidden 래퍼 안 canvas 포함, 같은 크기 구조 블록 합치기, 구조·heading label 규칙. 재현 페이지는 `public/demo/split-text.html`(Fixture 아님).

---

**Document Status:** Draft v2.4
**Next Step:** DOMAIN_MODEL을 PRD v1.2 8.2 기준으로 다시 작성한다.