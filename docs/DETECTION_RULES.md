# AI Website Inspector — Detection Rules

> Version: 2.1
> Status: Draft
> Related Documents: PRD.md (v1.2), AGENTS.md

### Changelog (v2.0 → v2.1)

- 추가: 보이는 영역 계산(3.6). `overflow`로 잘려 보이지 않는 텍스트·요소 영역을 Overlap 영역(5.1)과 Viewport Overflow 범위(6.1)에서 제외한다.
- 수정: Positive Fixture 판정. 기대하지 않은 이슈 중 `needsReview: false`인 것은 실패로 본다. 허용 이슈(`allowed`)를 둔다(12.2).
- 추가: 단위 테스트 케이스(12.1), 새 파일 `src/server/detect/geometry.ts`

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
  → orderAndAssignIds                 src/server/detect/order.ts
  → linkRelated (규칙 4)               src/server/detect/dedup.ts
  → buildEvidence                     src/server/evidence/*.ts
  → scorePriority                     src/server/priority/score.ts
```

- `order.ts`는 AGENTS.md 3장 구조에 없는 새 파일이다. ID 부여를 Dedup과 분리해 단위 테스트하기 위해서다.
- `geometry.ts`(3.6)는 `overlap.ts`와 `viewportOverflow.ts`가 함께 쓰는 보이는 영역 계산 순수 함수다.
- 탐지 함수의 형태는 `(collected: CollectedViewport) => RawIssue[]`이다(AGENTS.md 9장).

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
  innerWidth: number;
  innerHeight: number;
  layoutWidth: number;            // document.documentElement.clientWidth
  documentScrollWidth: number;    // document.documentElement.scrollWidth
  documentHeight: number;
  hasMetaViewport: boolean;
  rootOverflowX: { html: string; body: string };
  hasCanvas: boolean;
  totalCandidates: number;        // 자르기 전 후보 수
  elements: CollectedElement[];   // 문서 순서, 최대 MAX_CANDIDATES개
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
}
```

- 좌표는 모두 문서 기준이다. 측정은 맨 위로 스크롤한 상태(PRD 5.2.2 4단계 뒤)에서 한다.
- `collect.ts`는 숫자를 `MEASURE_DECIMALS` 자리로 반올림한다. 판정은 반올림한 값으로 한다.
- 수집 함수는 `page.evaluate`에 넘기는 독립 함수다. 바깥 변수와 import를 쓰지 않고, 상수는 인자로 받는다.

### 3.2 후보 선정 (PRD 5.3.1)

브라우저 안에서 문서 순서대로 순회하며 다음을 모두 만족하는 요소를 후보로 넣는다.

```text
candidate(el) :=
  computed.display != 'none'
  && computed.visibility != 'hidden'
  && computed.opacity > 0
  && rect.width > MIN_ELEMENT_SIZE_PX && rect.height > MIN_ELEMENT_SIZE_PX
  && 조상에 [aria-hidden="true"] 없음
  && 자신과 조상이 script, style, noscript, template, svg 내부가 아님 (svg 요소 자신은 후보 가능)
  && 자신과 조상에 clip: rect(0, 0, 0, 0) 또는 clip-path: inset(50%) 없음   // PRD 5.3.1: sr-only 제외
```

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
overlays = elements where flags.fixedRoot && (rect 면적 / (innerWidth × innerHeight)) >= OVERLAY_MIN_VIEWPORT_RATIO
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
      emit pair(min index, max index)
  active += a
```

- `top`/`bottom`은 영역 rect들의 최솟값/최댓값이다.
- 쌍은 항상 (작은 index, 큰 index) 순서로 만들어 같은 쌍이 두 번 나오지 않게 한다.

### 5.5 제외 조건 `excluded(a, b)`

순서대로 확인하고 하나라도 맞으면 제외한다.

1. 한쪽이 다른 쪽의 조상이다. // PRD 5.3.3
2. 한쪽의 `rect`가 다른 쪽의 영역 전체를 포함하고, 포함하는 쪽이 `img`, `video`, `canvas`이거나 `backgroundImage ≠ none`이다. // PRD 5.3.3: 의도된 오버레이
3. 둘 중 정확히 하나만 `fixedOrSticky`이다. // PRD 5.3.3: 스크롤 의존 겹침
4. 한쪽이 overlay이거나 overlay의 자손이다. // PRD 5.3.3

둘 다 `fixedOrSticky`이면 비교한다.

### 5.6 Subtype과 Confidence

| subtype | 조건 (위에서부터) |
|---|---|
| `interactive` | 두 요소 모두 인터랙티브 영역 |
| `text` | 두 요소 모두 텍스트 요소이고, 어느 쪽도 인터랙티브 영역이 아님 |
| `other` | 그 밖 |

Confidence:

```text
confidence = 1.0
if subtype != 'interactive':                     // PRD 5.3.3 예외: 인터랙티브끼리는 낮추지 않음
  if (a 또는 b)가 position: absolute이고 그 요소의 rect가 parentIndex 요소의 rect 안에 완전히 들어감:
    confidence = ABSOLUTE_IN_PARENT_CONFIDENCE
```

측정값:

| measured | expected | delta |
|---|---|---|
| `intersectionArea`, `overlapRatioPercent` (= area / smaller × 100) | `minRatioPercent: 20`, `minAreaPx2: 100` | 없음 (`{}`) |

- 이슈의 대상 요소는 index가 작은 쪽(`a`), 상대 요소는 `relatedElements: [{ role: 'overlap-target', b }]`다.
- `boundingBox`는 두 영역의 교차 영역 합집합이 아니라 대상 요소 `a`의 `rect`다. 마커가 요소 위치를 가리키게 하기 위해서다.

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
- `pageScroll`이 참인데 `page-scroll` 원인이 하나도 없으면(예: 후보가 아닌 요소가 원인) 이슈를 만들지 않고, 탐지 함수의 반환값에 `unexplainedPageScroll: true`를 함께 돌려준다. 이 값은 로그(호스트만 기록)와 테스트 확인용이며, Redis에 저장하거나 화면에 표시하지 않는다(PRD 8.2에 필드가 없다).

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
2. 규칙 2: `(type, subtype, element index, 상대 index)`가 같은 RawIssue를 하나로 합친다. 측정값은 큰 delta를 남긴다. 현재 탐지 로직에서는 생기지 않아야 하지만 방어용으로 둔다.

### 7.2 Viewport 간 매칭 (PRD 5.6)

```text
desktop 요소 d와 mobile 요소 m이 같은 요소인 조건 (위에서부터 처음 맞는 기준 사용):
  1. d.identity.id 또는 testId가 있고 m과 같음
  2. d.selector == m.selector
  3. landmark, tag, textSnippet이 모두 같고 textSnippet이 비어 있지 않음
```

- 매칭은 1:1이다. 한 기준에 후보가 여러 개면 문서 순서상 가장 앞의 것을 고르고, 한 번 짝지어진 요소는 다시 쓰지 않는다.
- 매칭은 이슈가 있는 요소에 대해서만 계산한다.

### 7.3 Viewport 간 병합 (규칙 3)

- 같은 `(type, subtype)`이고 대상 요소가 매칭되면 하나의 이슈로 합친다. Overlap은 상대 요소도 매칭되어야 한다.
- 합친 이슈의 `occurrences`는 `[desktop, mobile]` 순서다.
- `viewportTag`: occurrence가 둘이면 `both`, 하나면 `desktop-only`/`mobile-only`. 한 viewport가 실패한 검사면 `null`(PRD 5.6).

### 7.4 정렬과 ID (PRD 5.3.6)

정렬 키:

```text
1. occurrences[0].viewport          desktop < mobile
2. occurrences[0] 대상 요소 index
3. type                             viewport-overflow < text-overflow < element-overlap
4. subtype                          사전순
5. occurrences[0] 상대 요소 index    없으면 -1
```

정렬된 순서대로 `ISS-001`, `ISS-002`, …를 붙인다. 세 자리를 넘으면 그대로 늘린다(`ISS-1000`).

### 7.5 유형 간 연결 (규칙 4)

같은 viewport의 같은 대상 요소에 `viewport-overflow`와 `text-overflow` 이슈가 모두 있으면 서로의 `relatedIssueIds`에 넣는다. 매칭된 요소라면 다른 viewport의 occurrence도 같은 요소로 본다.

`relatedIssueIds`는 ID 오름차순으로 정렬한다.

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
- `affectedDescendants`가 있으면 문장 끝에 ` 하위 요소 {N}개가 함께 화면 밖으로 나갑니다.`를 붙인다.

### 8.2 Issue Title (PRD 5.4.4)

```text
{type 라벨} · {subtype} — {대상}
Element Overlap은: Element Overlap — {a 대상} ↔ {b 대상}
```

type 라벨: `Text Overflow`, `Element Overlap`, `Viewport Overflow`. Overlap의 subtype은 점수표 구분용이라 제목에 넣지 않는다(PRD 5.4.4 형식에 상대 요소를 더한 것은 이 문서의 결정이다).

### 8.3 `cropRect` (`src/server/evidence/crop.ts`)

```text
box = occurrence.boundingBox (Overlap은 a.rect ∪ b.rect)
r = box를 사방 CROP_PADDING_PX만큼 확장
r의 너비가 CROP_MIN_WIDTH_PX보다 작으면 중심 기준으로 넓힘, 높이도 같은 방식
r을 [0, innerWidth] × [0, screenshotHeight] 안으로 이동 (크기가 더 크면 잘라냄)
if box.y >= screenshotHeight: cropRect = null
```

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
if occurrences 중 하나라도 boundingBox.y < 해당 viewport의 innerHeight: R += 1
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
| `overlap` | 버튼 두 개 → interactive, Confidence 1.0 · absolute 배지(부모 안) → 0.4 · 조상/자손 제외 · img 위 텍스트 제외 · sticky와 일반 요소 제외 · fixed끼리 탐지 · 30% overlay 기록과 제외 · line-height 보정으로 인접 줄 오탐 없음 · 20%와 100px² 경계값 · line-clamp로 숨겨진 줄과 아래 요소는 겹침 아님 · overflow hidden 카드 밖으로 잘린 img는 잘린 영역만 비교 · 완전히 잘린 요소는 비교 대상 아님 |
| `viewportOverflow` | page-scroll 원인 1개와 affectedDescendants · nowrap 텍스트만 넘친 제목이 원인 · ellipsis 제목(자신의 overflow hidden)은 이탈 아님 · 캐러셀(overflow-x auto 조상) 제외 · hidden-clip · 왼쪽 이탈은 element-out · fixed 요소는 page-scroll 아님 |
| `dedup` / `match` | 3가지 매칭 기준과 1:1 보장 · 병합 후 viewportTag · 규칙 4 연결 |
| `order` | 정렬 키 5단계 각각 · 입력 순서를 섞어도 같은 ID |
| `score` | 점수표 9행 · Reach 보정 상한 · **S=I=R=3 → P1** · 경계 399/400, 299/300 |
| `sentences` | subtype별 템플릿 · 반올림 · affectedDescendants 문구 |
| `crop` | 패딩, 최소 크기, 경계 안으로 이동, 범위 밖 null |

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
- 각 Fixture는 의도한 문제 외에 다른 문제가 생기지 않게 최소한으로 만든다.
- Fixture의 기본 스타일은 CJK 폰트(Noto Sans KR)를 쓴다(PRD 5.2.3).
- 결과는 README에 표로 기록한다(PRD 13.2).

---

## 13. Out of Scope

v1.0에 있었지만 PRD v1.2 범위가 아니라 구현하지 않는 것:

| 항목 | 이유 |
|---|---|
| 세로 Viewport Overflow (fixed 요소, Modal이 화면 밖) | PRD 5.3.4는 가로만 다룬다 |
| `elementFromPoint` 기반 클릭 방해 판정 | PRD 5.3.3에 없음. 측정 시점과 스크롤 상태에 따라 결과가 달라진다 |
| ellipsis 제목을 검토 대상으로 분류 | PRD 5.3.2는 ellipsis를 탐지하지 않는다 |
| Severity 4단계 분류 | PRD 5.5는 S 1~5 규칙표를 쓴다 |
| Rule ID, Rule Version 필드 | PRD 8.2 데이터 모델에 없다. 필요하면 PRD를 먼저 고친다 |

---

## 14. 이 문서에서 새로 정한 값과 규칙

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

---

**Document Status:** Draft v2.1
**Next Step:** DOMAIN_MODEL을 PRD v1.2 8.2 기준으로 다시 작성한다.