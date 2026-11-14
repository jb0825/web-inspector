# Task: 요금제 한눈에 보기 영역 Viewport Overflow 수정 (Mobile)
Priority: P0 | Viewport: mobile-only

## Problem
- ISS-001 (Mobile): 요소의 오른쪽 끝(616px)이 Mobile 화면 너비(390px)를 226px 벗어나 페이지 가로 스크롤이 발생합니다. 하위 요소 6개가 함께 화면 밖으로 나갑니다.

## [ISS-001] Viewport Overflow · page-scroll — div "베이직 월 9,900원 프로 월 19"

### Evidence (measured in browser)
- Mobile (390×844): 요소의 오른쪽 끝(616px)이 Mobile 화면 너비(390px)를 226px 벗어나 페이지 가로 스크롤이 발생합니다. 하위 요소 6개가 함께 화면 밖으로 나갑니다.
  - Selector: `[data-testid="p01-fixed-box"]`

### How to locate the element in source
- Section: 요금제 한눈에 보기
- Text: "베이직 월 9,900원 프로 월 19,900원 팀 월 49,900원"
- Attributes: `data-testid="p01-fixed-box"`
- HTML: `<div class="plan-table" data-testid="p01-fixed-box">`

### Likely Root Cause (likely, rule-based)
요소 너비가 화면 너비보다 커서 고정 너비로 추정됨. 근거(Mobile): `width: 600px`, `max-width: none`, 요소 너비 600px, 요소 오른쪽 끝 616px, 화면 너비 390px

### Required Changes
max-width: 100%를 주거나 반응형 단위(%, fr, min())로 너비를 정한다.

```css
[data-testid="p01-fixed-box"] {
  width: auto;
  max-width: 100%;
}
```

※ selector는 빌드된 DOM 기준이므로 소스 코드의 클래스명이나 컴포넌트 구조와 다를 수 있다. 위 Source Hints로 소스 위치를 찾아 적용한다.

## Constraints
- 다른 viewport(Desktop)의 레이아웃을 깨뜨리지 않는다.
- 관련 없는 컴포넌트와 스타일은 수정하지 않는다.
- 위 Root Cause는 추정일 수 있으니, 소스 코드를 확인한 뒤 수정한다.

## Acceptance Criteria
- 390px viewport에서 `document.documentElement.scrollWidth`가 390 이하이다.
- 1440px viewport의 레이아웃은 변경되지 않는다.
