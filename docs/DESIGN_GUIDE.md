# AI Website Inspector — Design Guide

> Version: 1.1
> Status: Draft
> Related Documents: PRD.md (v1.2), USER_FLOW.md (v1.1), WIREFRAME.md (v1.1)

### Changelog (v1.0 → v1.1)

- 글꼴 이름 수정: CSS에 없는 `"Noto Sans Korean"` 대신 `next/font/google`의 `Noto_Sans_KR`을 CSS 변수로 연결
- 설치된 Next.js(16.4.6)의 `next/font` 데이터로 Noto Sans KR, Google Sans Code 지원 여부와 weight 범위 확인
- 색 대비를 WCAG AA(본문 4.5:1)에 맞춰 조정: 색을 **표시용(solid)**, **텍스트용(text)**, **배경용(tint)** 토큰으로 분리
- Tailwind CSS v4 `@theme` 기준으로 토큰 정의 방식 변경
- 빠져 있던 컴포넌트 스타일 추가: 상태 배지(6종), viewport 태그, certainty, Confidence, 검사 범위 안내, Needs Review 그룹, 스크린샷 마커, 하이라이트 크롭, 프롬프트 textarea
- 범위 밖 요소(Viewport 선택) 관련 규칙 제거

> 화면 구조는 WIREFRAME, 동작은 USER_FLOW, 기능 규칙은 PRD를 따른다. 이 문서는 시각 스타일만 정한다.

---

## 1. Design Philosophy

### 1.1 Core Direction

**Minimal. Clear. Precise.**

Apple Human Interface Guidelines의 기본 원칙(명확성, 콘텐츠 중심, 자연스러운 깊이감)에서 영감을 받은 미니멀한 인터페이스를 지향한다. 많은 정보를 보여주더라도 사용자가 핵심을 빠르게 파악하고 작업을 이어갈 수 있어야 한다. 디자인은 돋보이는 것보다 사용성을 높이는 데 집중한다.

Apple의 디자인을 그대로 복제하지 않는다. 원칙만 참고해 자체 제품 UI를 만든다.

### 1.2 Design Principles

#### Clarity — 명확성

- 정보의 위계가 명확해야 한다.
- 불필요한 장식과 시각적 노이즈를 없앤다.
- 아이콘만으로 의미를 전달해야 하면 라벨을 함께 둔다.
- 중요한 정보와 보조 정보를 시각적으로 구분한다.

#### Deference — 콘텐츠 중심

- 스크린샷과 검사 결과가 화면의 중심이 되도록 한다.
- 테두리, 배경, 카드를 최소한으로 쓴다.
- 장식 그래픽보다 실제 데이터와 증거를 강조한다.

#### Depth — 자연스러운 깊이감

- 배경, 콘텐츠, 오버레이(패널, 시트, 툴팁)를 구분한다.
- 그림자는 오버레이에만 쓴다.
- Hover, Focus, Selected 상태에 절제된 변화를 준다.

### 1.3 Overall Visual Direction

| Category | Direction |
|---|---|
| Style | Minimal / Modern / Clean |
| Layout | Spacious and Structured |
| Typography | Noto Sans KR (기본), Google Sans Code (기술 정보) |
| Color | Neutral with Restrained Accents |
| Components | Simple and Consistent |
| Interaction | Subtle and Responsive |
| Information Density | High, but Readable |

---

## 2. Color System

### 2.1 Color Philosophy

색은 장식이 아니라 정보 전달과 상태 구분에 쓴다. 기본 UI는 중립색으로 구성하고, 강조색은 행동 유도와 중요한 상태에만 쓴다.

### 2.2 토큰 구조

의미가 있는 색은 용도별로 세 가지 토큰을 둔다. 같은 의미라도 용도에 따라 필요한 대비가 다르기 때문이다.

| 접미사 | 용도 | 대비 기준 |
|---|---|---|
| `-solid` | 아이콘, 점, 마커 테두리, 큰 그래픽 | 배경 대비 3:1 이상 (WCAG 비텍스트) |
| `-text` | 텍스트, 텍스트 배지 | 흰 배경과 자기 tint 배경 모두에서 4.5:1 이상 |
| `-tint` | 배지와 강조 영역의 배경 | — |

- 넓은 영역에 `-solid` 색을 쓰지 않는다.
- 아래 대비값은 WCAG 2.x 공식으로 계산한 값이다.

### 2.3 Neutral Palette

| Token | Hex | Usage | 흰 배경 대비 |
|---|---|---|---|
| `background` | #FFFFFF | 기본 배경 | — |
| `background-secondary` | #F5F5F7 | 보조 배경, AI 분석 영역, 코드 영역 | — |
| `background-tertiary` | #EBEBED | 중첩 배경, 선택된 행 hover | — |
| `surface` | #FFFFFF | 패널, 시트 | — |
| `border` | #E5E5EA | 기본 구분선 | — |
| `border-strong` | #D1D1D6 | 입력창 테두리, 강조 구분선 | — |
| `text-primary` | #1D1D1F | 본문, 제목 | 16.8 |
| `text-secondary` | #6E6E73 | 보조 텍스트 | 5.07 |
| `text-tertiary` | #707075 | 메타데이터, 캡션 | 4.93 (`background-secondary` 위 4.52) |
| `text-disabled` | #AEAEB2 | 비활성 요소에만 사용 | 2.21 (비활성 요소는 WCAG 예외) |

v1.0의 `text-tertiary`(#86868B)는 흰 배경 대비가 3.62로 본문 기준(4.5:1)에 못 미쳐 바꿨다.

### 2.4 Accent

| Token | Hex | Usage | 대비 |
|---|---|---|---|
| `accent-solid` | #0A84FF | Focus ring, 선택된 마커, 활성 탭 밑줄 | 흰 배경 3.65 (비텍스트 기준 충족) |
| `accent` | #0066CC | Primary 버튼 배경, 링크 텍스트 | 흰 글씨 5.57 |
| `accent-hover` | #005BB8 | Primary 버튼 hover | 흰 글씨 6.59 |
| `accent-tint` | #E8F2FF | 선택된 항목 배경 | `accent` 텍스트 4.92 |

v1.0의 `#0A84FF` 배경 + 흰 글씨는 대비가 3.65라 버튼 텍스트(14~16px)에 쓸 수 없다. 그래서 텍스트와 버튼에는 `accent`(#0066CC)를 쓰고, `#0A84FF`는 비텍스트 용도로만 남긴다.

강조색을 모든 요소에 쓰지 않는다.

### 2.5 Priority Colors

| Priority | `-solid` (흰 배경 대비) | `-text` | `-tint` | text 대비 (흰 / tint) |
|---|---|---|---|---|
| P0 | #E5484D (3.91) | #B4313A | #FDECEC | 6.10 / 5.34 |
| P1 | #D4700F (3.43) | #9A5207 | #FDF1E3 | 5.86 / 5.26 |
| P2 | #AD8200 (3.52) | #806500 | #FBF5DC | 5.56 / 5.08 |
| P3 | #8E8E93 (3.26) | #5F5F64 | #F0F0F2 | 6.35 / 5.58 |

v1.0의 P1(#E58A24, 2.63)과 P2(#D5A500, 2.28)는 비텍스트 기준(3:1)에도 못 미쳐 `-solid` 값도 조정했다.

사용 원칙:
- Priority 배지는 `-tint` 배경 + `-text` 글자 + `P0` 같은 텍스트 라벨로 표시한다. 색만으로 구분하지 않는다.
- `-solid`는 스크린샷 마커와 작은 점에만 쓴다.
- P0만 필요한 곳에서 시각적으로 더 강조한다(예: Summary의 P0 숫자 굵게).

### 2.6 Semantic Colors

| 의미 | `-solid` | `-text` | `-tint` | 쓰는 곳 |
|---|---|---|---|---|
| success | #30A46C | #1A7346 | #E6F4EC | 완료 상태, `confirmed` |
| warning | #D4700F | #9A5207 | #FDF1E3 | 일부 실패(`partial`), 검사 범위 안내 |
| error | #E5484D | #B4313A | #FDECEC | 실패, 입력 오류 |
| info | #0A84FF | #0066CC | #E8F2FF | 진행 중, AI 분석 중, `likely` |
| neutral | #8E8E93 | #5F5F64 | #F0F0F2 | 대기, `uncertain`, viewport 태그 |

warning과 P1, error와 P0는 같은 값을 쓴다. 색 종류를 늘리지 않기 위해서다.

### 2.7 Color Usage Rules

1. 화면의 대부분은 Neutral Palette로 구성한다.
2. 강조색은 핵심 액션과 선택 상태에만 쓴다.
3. Semantic 색은 의미가 분명할 때만 쓴다.
4. 같은 의미에는 같은 색을 쓴다.
5. 텍스트에는 항상 `-text` 토큰을 쓴다.
6. MVP는 Light Theme만 제공한다(13장).

---

## 3. Typography

### 3.1 Font Family

| 역할 | 글꼴 | `next/font/google` | 비고 |
|---|---|---|---|
| 기본 (UI, 본문, 한글) | Noto Sans KR | `Noto_Sans_KR` | weight 100~900, variable |
| 기술 정보 (코드, selector, 측정값) | Google Sans Code | `Google_Sans_Code` | weight 300~800, variable. 한글 글리프 없음 |

설치된 Next.js 16.4.6의 `next/font` 데이터(`node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`)에서 두 글꼴과 weight 범위를 확인했다.

**주의: CSS family 이름을 직접 쓰지 않는다.**
- `next/font`는 고유한 family 이름(예: `__Noto_Sans_KR_xxxx`)을 만든다. 그래서 `font-family: "Noto Sans KR"`처럼 이름을 직접 쓰면 적용되지 않을 수 있다. 반드시 `variable` 옵션으로 만든 CSS 변수를 쓴다.
- v1.0의 `"Noto Sans Korean"`은 존재하지 않는 이름이라 전체 UI가 `sans-serif`로 대체되는 문제가 있었다.

```ts
// src/app/layout.tsx
import { Noto_Sans_KR, Google_Sans_Code } from 'next/font/google';

const notoSansKr = Noto_Sans_KR({
  variable: '--font-noto-sans-kr',
  subsets: ['latin'],        // 'korean' subset 옵션은 없다. 한글은 unicode-range로 나뉜 파일이 필요할 때 로드된다
  weight: ['400', '500', '600'],
  display: 'swap',
});

const googleSansCode = Google_Sans_Code({
  variable: '--font-google-sans-code',
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
});
// <html lang="ko" className={`${notoSansKr.variable} ${googleSansCode.variable}`}>
```

- 한글 글리프가 실제로 표시되는지 첫 구현 때 브라우저에서 확인한다.
- `<html lang="ko">`로 둔다.

### 3.2 Font Stack

```css
--font-sans: var(--font-noto-sans-kr), system-ui, sans-serif;
--font-mono: var(--font-google-sans-code), var(--font-noto-sans-kr), ui-monospace, monospace;
```

`--font-mono`에 Noto Sans KR을 두 번째로 둬서, Google Sans Code에 없는 한글이 Noto Sans KR로 표시되게 한다.

### 3.3 Font Usage

| UI Area | 글꼴 |
|---|---|
| 제목, 본문, 버튼, 입력창, 내비게이션 | sans |
| 진행 단계 라벨 | sans (한국어 문장이므로) |
| 실패 코드(`NAVIGATION_TIMEOUT`) | mono |
| CSS Selector, HTML, CSS 코드 | mono |
| 측정값 표의 키와 값 | mono |
| Bounding Box, 좌표, px 값 | mono |
| Issue ID, Task ID | mono |
| 프롬프트 textarea | mono |
| Evidence 문장, AI 분석 문장 | sans |

- 한국어 문장은 기술 정보 안에 있어도 sans를 쓴다. 라벨, 값, 설명을 별도 요소로 나눠 각각 알맞은 글꼴을 적용한다.
- v1.0은 진행 단계를 mono로 정했지만, USER_FLOW v1.1에서 단계 라벨이 한국어 문장이 되어 sans로 바꿨다.

### 3.4 Type Scale

| Token | Size | Weight | Line Height | Usage |
|---|---:|---|---|---|
| `display` | 40px | 600 | 1.2 | Home 제목 |
| `h1` | 28px | 600 | 1.25 | 페이지 제목 |
| `h2` | 20px | 600 | 1.3 | 섹션 제목 |
| `h3` | 16px | 600 | 1.4 | 패널 소제목, 태스크 제목 |
| `body-lg` | 16px | 400 | 1.6 | 중요한 본문 |
| `body` | 14px | 400 | 1.55 | 기본 본문, 목록 |
| `body-sm` | 13px | 400 | 1.5 | 보조 정보, Evidence 요약 |
| `caption` | 12px | 400 | 1.4 | 메타데이터 |
| `label` | 12px | 500 | 1.3 | 배지, 표 머리글 |
| `code` | 13px | 400 | 1.6 | mono 영역 |

- Display가 모바일에서 넘치지 않도록 Mobile breakpoint에서는 `display`를 28px로 줄인다.
- 결과 화면은 정보 밀도가 높아 `h1`을 v1.0의 32px에서 28px로 줄였다.

### 3.5 Typography Rules

- Weight는 400, 500, 600만 쓴다.
- 한 화면에서 글자 크기는 5단계 이하로 쓴다.
- 숫자 비교가 필요한 곳(Summary 개수, 측정값, 경과 시간, Viewport 크기)에는 `font-variant-numeric: tabular-nums`를 쓴다.

---

## 4. Spacing System

### 4.1 Base Unit

기본 단위는 4px이다. Tailwind의 기본 spacing scale(`1` = 4px)을 그대로 쓴다.

| Token | Value | Tailwind |
|---|---:|---|
| space-1 | 4px | `1` |
| space-2 | 8px | `2` |
| space-3 | 12px | `3` |
| space-4 | 16px | `4` |
| space-5 | 20px | `5` |
| space-6 | 24px | `6` |
| space-8 | 32px | `8` |
| space-10 | 40px | `10` |
| space-12 | 48px | `12` |
| space-16 | 64px | `16` |

### 4.2 Usage

| Element | Spacing |
|---|---|
| 아이콘 + 텍스트 | 8px |
| 버튼 내부 좌우 padding | 16px (Small 12px) |
| 입력창 내부 padding | 12px |
| 목록 행 세로 padding | 12px |
| 컴포넌트 내부 간격 | 12–16px |
| 컴포넌트 그룹 간격 | 24px |
| 섹션 간격 | 32–48px |

### 4.3 Layout Width

| 화면 | 최대 너비 |
|---|---|
| Home, Progress, 결과 없음 | 720px |
| 결과 화면 | 1440px |
| Issue Detail 패널 | 480px (Tablet 420px) |
| 페이지 좌우 여백 | Desktop 32px, Tablet 24px, Mobile 16px |

---

## 5. Border Radius & Elevation

### 5.1 Border Radius

| Token | Value | Usage |
|---|---:|---|
| `radius-sm` | 6px | 배지, 작은 버튼, 코드 인라인 |
| `radius-md` | 10px | 버튼, 입력창, textarea |
| `radius-lg` | 14px | 미리보기 영역, 패널, 안내 박스 |
| `radius-full` | 9999px | 상태 점, 마커 번호 |

모든 요소를 둥글게 만들지 않는다. 표와 목록 행에는 radius를 주지 않는다.

### 5.2 Shadows

```css
--shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
--shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
--shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);
```

| 대상 | Shadow |
|---|---|
| 툴팁, 드롭다운(필터) | `shadow-md` |
| Issue Detail 패널(오버레이일 때), Mobile 시트 | `shadow-lg` |
| 일반 콘텐츠 영역 | 없음 (배경과 border로 구분) |

---

## 6. Component Design

### 6.1 Button

| 종류 | 스타일 | 예 |
|---|---|---|
| Primary | `accent` 배경 + 흰 글씨, hover `accent-hover` | 검사 시작, 프롬프트 복사 |
| Secondary | `background-secondary` 배경 + `text-primary` | 다시 시도, 새 검사 |
| Tertiary | 투명 배경 + `accent` 글씨 | 샘플 리포트 보기, 링크 복사 |

| Size | Height |
|---|---:|
| Small | 32px |
| Medium | 40px |
| Large | 48px (Home 검사 시작) |

States: Default, Hover, Active, Focus(2px `accent-solid` focus ring, 2px offset), Disabled(`text-disabled`), Loading(라벨 유지 + 스피너, 너비 고정).

Destructive 버튼은 MVP에 필요한 곳이 없어 정의하지 않는다.

### 6.2 Input

- 흰 배경, `border-strong` 테두리, `radius-md`, 높이 48px(Home)
- Focus: `accent-solid` 테두리 + focus ring
- 오류: `error-solid` 테두리 + 입력창 아래 `error-text` 메시지(`body-sm`). 입력값은 유지한다.
- placeholder: `https://example.com` (`text-tertiary`)

### 6.3 Badge

공통: 높이 20px, `label` 타입, `radius-sm`, 좌우 padding 6px, `-tint` 배경 + `-text` 글자.

| 배지 | 값 → 색 |
|---|---|
| Priority | P0~P3 → 2.5 |
| 상태 | 6.4 |
| Viewport 태그 | `mobile-only` / `desktop-only` / `both` → neutral. 텍스트로 구분하고 색을 다르게 하지 않는다 |
| Certainty | `confirmed` → success, `likely` → info, `uncertain` → neutral |
| 이슈 유형 | 배지로 만들지 않고 텍스트(`Text Overflow · clipped`)로 쓴다 |

같은 의미의 배지를 한 줄에 중복해서 쓰지 않는다.

### 6.4 Status Badge

| Status | 라벨 | 색 | 점 |
|---|---|---|---|
| `pending` | 대기 중 | neutral | ● |
| `running` | 검사 중 | info | ● (pulse) |
| `analyzing` | AI 분석 중 | info | ● (pulse) |
| `completed` | 완료 | success | ✓ |
| `partial` | 일부 실패 | warning | ! |
| `failed` | 실패 | error | ✕ |

pulse 애니메이션은 reduced motion에서 끈다(8.5).

### 6.5 Confidence

- 1.0이면 표시하지 않는다(Issue Detail 헤더는 예외로 항상 표시).
- 1.0 미만이면 `Confidence 0.4`처럼 `caption` 크기, `text-secondary`, mono 숫자로 표시한다. 색으로 강조하지 않는다.

### 6.6 Notice (검사 범위 안내, 오류 안내)

- `radius-lg`, 좌우 padding 16px, 세로 12px
- 검사 범위 안내: `warning-tint` 배경, 아이콘 `warning-solid`, 텍스트 `text-primary`
- 정보 안내(샘플 리포트 표시 등): `info-tint` 배경
- 오류 안내: `error-tint` 배경
- 여러 항목은 한 Notice 안에 목록으로 넣는다. Notice를 여러 개 쌓지 않는다.

### 6.7 Panel / Sheet

- Issue Detail 패널: `surface` 배경, 왼쪽 `border`, 넓은 화면에서는 그림자 없이 나란히 배치한다. Tablet에서 오버레이일 때만 `shadow-lg`를 쓴다.
- Mobile 시트: 전체 화면, 상단에 "← 결과로" 헤더 고정
- 섹션 구분은 카드가 아니라 섹션 제목(`h3`)과 24px 간격으로 한다.

### 6.8 Table / List

- 목록 행: 세로 padding 12px, 아래 `border` 구분선
- Hover: `background-secondary`
- Selected: `accent-tint` 배경 + 왼쪽 3px `accent-solid` 막대
- 긴 selector와 텍스트는 한 줄 말줄임. 전체 내용은 `title` 속성과 Issue Detail에서 확인한다.
- 측정값 표: 키는 `text-secondary`, 값은 `text-primary` + 오른쪽 정렬 + tabular nums

### 6.9 Tabs

- 텍스트 탭 + 활성 탭 아래 2px `accent-solid` 밑줄
- 탭 라벨 옆 개수는 `text-secondary`
- 키보드: 좌우 방향키로 이동(WAI-ARIA Tabs 패턴)

### 6.10 Tooltip

- 마커 hover와 말줄임 텍스트에만 쓴다.
- 핵심 정보를 툴팁에만 두지 않는다.
- `text-primary` 배경 + 흰 글씨, `body-sm`, `shadow-md`

### 6.11 Needs Review Group

- 접힌 상태: 펼침 아이콘 + "검토 필요 {N}" + `text-secondary` 설명 한 줄
- 펼친 항목: 일반 목록 행과 같지만 글자색을 `text-secondary`로 낮춘다. Confidence는 항상 표시한다.

### 6.12 Code Block / Prompt Textarea

- `background-secondary` 배경, `radius-md`, padding 12px, mono `code` 타입
- 프롬프트 textarea: 높이 320px(Mobile 240px), 세로 스크롤, 크기 조절 핸들은 세로만 허용
- 줄바꿈: `white-space: pre-wrap`. 가로 스크롤이 생기지 않게 한다.
- 복사 버튼은 textarea 오른쪽 위에 Primary Small로 둔다.

### 6.13 AI Analysis 영역

측정한 사실과 AI 추론을 시각적으로 구분한다.

| 영역 | 스타일 |
|---|---|
| Evidence (측정) | `surface` 배경, 측정값 표는 mono |
| AI 원인 분석 | `background-secondary` 배경 + `radius-lg` + 제목 옆 "AI 추론" 라벨(`caption`, `text-secondary`) + certainty 배지 |
| AI 분석 없음 | 같은 영역에 `text-secondary` 문구만 표시 |

AI 문장을 측정값처럼 표나 mono로 표현하지 않는다.

---

## 7. Iconography

### 7.1 Icon Library

`lucide-react`를 쓴다(이미 의존성에 있다).

### 7.2 Icon Rules

- 기본 크기 16px, 주요 액션 20px
- Stroke width 1.75
- 같은 기능에는 같은 아이콘을 쓴다.
- 장식 아이콘은 `aria-hidden`으로 보조 기술에서 숨긴다.

| 용도 | 아이콘 |
|---|---|
| 완료 | `Check` |
| 실패 | `X` |
| 진행 중 | `Loader2` (회전, reduced motion에서는 정지) |
| 범위 안내 | `Info` |
| 경고 | `AlertTriangle` |
| 복사 | `Copy` → 완료 시 `Check` |
| 이동 | `ChevronRight` |
| 닫기 | `X` |

### 7.3 Icon + Label

다음 기능은 아이콘만으로 표시하지 않는다: 검사 시작, 실패 상태, Priority, 프롬프트 복사, 태스크 이동.

---

## 8. Motion & Interaction

### 8.1 Motion Philosophy

애니메이션은 행동에 대한 피드백과 화면 관계를 이해시키는 용도로만 쓴다.

### 8.2 Duration

| Token | Duration | Usage |
|---|---:|---|
| `duration-fast` | 120ms | Hover, Focus |
| `duration-normal` | 180ms | 버튼, 선택 |
| `duration-moderate` | 240ms | 드롭다운, 툴팁, 그룹 펼치기 |
| `duration-slow` | 320ms | 패널, 시트 열기 |

### 8.3 Easing

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-enter: cubic-bezier(0, 0, 0.2, 1);
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
```

### 8.4 Interaction Examples

| 대상 | 동작 |
|---|---|
| 버튼 | Hover 배경색 변화, Active 살짝 어둡게 |
| 목록 행 | Hover `background-secondary`, Selected `accent-tint` |
| 스크린샷 마커 | Hover 테두리 두껍게, Selected 9.2 |
| 선택한 이슈로 스크롤 | 부드러운 스크롤 (reduced motion에서는 즉시 이동) |

### 8.5 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

이 CSS는 서비스 UI용이다. 검사 대상 페이지에 주입하는 애니메이션 차단 CSS(PRD 5.2.2)와는 별개다.

---

## 9. Screenshot & Evidence Visualization

### 9.1 Screenshot Viewer

- 원본 비율을 유지한다. 이미지 너비는 컨테이너에 맞추고 높이는 비율대로 둔다.
- 미리보기 영역은 고정 높이(Desktop 640px, Mobile 미리보기 영역도 같은 높이) 안에서 세로 스크롤한다.
- 이미지 로딩 중에는 `background-secondary` 배경을 보여준다.
- 미리보기 상단 라벨: `DESKTOP 1440 × 900` (`label` 타입, mono 숫자)
- 스크린샷이 잘렸으면 이미지 끝에 점선과 "스크린샷 끝 ({screenshotHeight}px)" 캡션을 둔다.

### 9.2 Issue Marker (SVG 오버레이)

스크린샷은 어떤 색이든 될 수 있으므로, 마커는 어느 배경에서도 보이도록 두 겹 테두리를 쓴다.

| 상태 | 스타일 |
|---|---|
| 기본 | 2px Priority `-solid` 테두리 + 바깥 1px 흰색 halo + 채우기 없음 |
| Hover | 테두리 3px |
| Selected | 3px `accent-solid` 테두리 + 흰색 halo + `accent-solid` 12% 채우기 |
| Needs Review | 1.5px 점선 neutral 테두리 (그룹을 펼쳤을 때만 표시) |

- 마커 번호: 박스 왼쪽 위에 20px 원, `text-primary` 배경 + 흰 글씨(`label`). Priority `-solid` 색 위에 흰 글씨를 쓰면 대비가 4.5:1에 못 미치기 때문이다(예: P1 #D4700F 위 흰 글씨 3.43).
- SVG `stroke`는 `vector-effect: non-scaling-stroke`로 두어 이미지 축소 비율과 관계없이 선 두께를 유지한다.

### 9.3 Highlight Crop (Issue Detail)

- 전체 스크린샷을 `cropRect` 영역만 보이게 잘라 표시한다(CSS `object-view-box` 또는 `overflow: hidden` + 위치 이동).
- 대상 요소 박스는 9.2의 Selected 스타일로 그린다. Overlap은 상대 요소를 기본 스타일로 함께 그린다.
- 표시 너비는 패널 너비에 맞추고, 최대 높이는 320px이다.
- `cropRect`가 `null`이면 같은 크기의 `background-secondary` 상자에 "스크린샷 범위 밖"을 표시한다.

### 9.4 Evidence Presentation

**측정 증거**
- Evidence 문장(sans, `body`)을 먼저 보여준다.
- 그 아래 측정값 표(mono, tabular nums)
- Selector는 mono + 복사 버튼

**AI 분석**
- 6.13을 따른다.

---

## 10. Screen-specific Design Rules

### 10.1 Home

- 가장 중요한 요소는 URL 입력창이다.
- 검사 환경과 검사 항목은 `body-sm`, `text-secondary`의 한 줄 안내로 둔다. 선택 UI처럼 보이게 만들지 않는다.
- 일러스트와 장식을 쓰지 않는다.

### 10.2 Inspection Progress

- 세로 Step List로 표시한다. 진행 중인 단계만 `text-primary` + 진행 아이콘, 대기 단계는 `text-tertiary`.
- 경과 시간은 mono + tabular nums
- 과한 로딩 애니메이션을 쓰지 않는다.

### 10.3 Inspection Result

- Summary는 한 줄의 숫자 나열로 간결하게 둔다. 큰 카드를 여러 개 쓰지 않는다.
- 미리보기가 화면의 주요 콘텐츠다. Desktop 미리보기를 더 넓게 둔다(약 2:1).
- Priority는 배지와 텍스트를 함께 쓴다.
- Selector, 좌표, 측정값은 mono를 쓴다.

### 10.4 Issue Detail

- 측정 증거를 가장 먼저 보여준다.
- 측정 영역과 AI 영역을 분명히 구분한다(6.13).
- 페이지에서 가져온 HTML은 코드 블록에 문자열로만 표시한다.

### 10.5 Development Tasks

- 선택된 태스크를 목록에서 분명하게 구분한다(6.8 Selected).
- 프롬프트는 읽고 복사하기 편하게 둔다(6.12).
- 복사 피드백은 즉시 보여준다(버튼 라벨 "복사됨", 2초).

---

## 11. Responsive Design

### 11.1 Breakpoints

Tailwind v4 기본 breakpoint를 그대로 쓴다.

| 구분 | 범위 | Tailwind |
|---|---|---|
| Mobile | < 640px | 기본 |
| Tablet | 640px–1023px | `sm:`, `md:` |
| Desktop | ≥ 1024px | `lg:` 이상 |

### 11.2 Responsive Principles

- 콘텐츠가 잘리거나 겹치지 않아야 한다. 이 서비스 자체가 Text Overflow, Overlap, Viewport Overflow를 검사하므로 특히 지킨다.
- 서비스 화면에 가로 스크롤이 생기면 안 된다. 긴 URL, selector, HTML은 말줄임이나 `overflow-wrap: anywhere`로 처리한다.
- 2열 레이아웃은 Mobile에서 1열로 바꾼다.

### 11.3 Inspection Preview

검사 대상 viewport와 서비스 화면의 반응형 레이아웃은 별개다.

- 검사 대상 viewport: Desktop 1440×900 / Mobile 390×844 (고정)
- Inspector UI: 사용자의 브라우저 너비에 맞춰 반응형으로 동작

---

## 12. Accessibility

### 12.1 Contrast

- 본문 텍스트는 4.5:1, 큰 텍스트(24px 이상, 또는 18.66px 이상 굵게)와 비텍스트 요소는 3:1 이상
- 텍스트에는 `-text` 토큰만 쓴다(2.2).
- Priority와 상태는 색 외에 텍스트 라벨을 함께 둔다.

### 12.2 Keyboard

- Tab으로 주요 UI에 접근할 수 있다.
- Focus는 2px `accent-solid` ring으로 분명하게 표시한다.
- Enter와 Space로 버튼을 실행한다.
- Escape로 패널, 시트, 툴팁을 닫는다. 패널을 닫으면 패널을 연 요소로 focus를 돌려준다.

### 12.3 Screen Reader

- 시맨틱 HTML을 쓴다(`header`, `main`, `nav`, `table`, `button`).
- 아이콘 버튼에는 접근 가능한 이름을 둔다.
- 진행 상태 변화, AI 분석 완료, 복사 완료는 `aria-live="polite"`로 알린다.
- 장식 아이콘은 숨긴다.

### 12.4 Touch Target

터치 대상은 최소 44×44px로 둔다. 시각적 크기가 작으면 padding으로 터치 영역을 넓힌다.

---

## 13. Dark Mode

- MVP는 Light Theme만 제공한다. Theme Switcher를 만들지 않는다.
- 현재 `globals.css`의 `prefers-color-scheme: dark` 블록(create-next-app 기본값)은 제거한다. 남겨 두면 다크 모드 사용자에게 배경만 어두워지고 나머지 토큰은 밝은 값이 섞여 보인다.
- Dark Theme을 추가할 때를 위해 색은 모두 토큰으로만 쓴다.

---

## 14. Design Tokens (Tailwind CSS v4)

Tailwind v4는 `@theme` 안의 변수로 유틸리티 클래스를 만든다(예: `--color-p0-text` → `text-p0-text`, `bg-p0-text`). 그래서 토큰은 `:root`가 아니라 `@theme`에 정의한다.

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  /* Neutral */
  --color-background: #ffffff;
  --color-background-secondary: #f5f5f7;
  --color-background-tertiary: #ebebed;
  --color-surface: #ffffff;
  --color-border: #e5e5ea;
  --color-border-strong: #d1d1d6;
  --color-text-primary: #1d1d1f;
  --color-text-secondary: #6e6e73;
  --color-text-tertiary: #707075;
  --color-text-disabled: #aeaeb2;

  /* Accent */
  --color-accent-solid: #0a84ff;
  --color-accent: #0066cc;
  --color-accent-hover: #005bb8;
  --color-accent-tint: #e8f2ff;

  /* Priority */
  --color-p0-solid: #e5484d;  --color-p0-text: #b4313a;  --color-p0-tint: #fdecec;
  --color-p1-solid: #d4700f;  --color-p1-text: #9a5207;  --color-p1-tint: #fdf1e3;
  --color-p2-solid: #ad8200;  --color-p2-text: #806500;  --color-p2-tint: #fbf5dc;
  --color-p3-solid: #8e8e93;  --color-p3-text: #5f5f64;  --color-p3-tint: #f0f0f2;

  /* Semantic */
  --color-success-solid: #30a46c;  --color-success-text: #1a7346;  --color-success-tint: #e6f4ec;
  --color-warning-solid: #d4700f;  --color-warning-text: #9a5207;  --color-warning-tint: #fdf1e3;
  --color-error-solid: #e5484d;    --color-error-text: #b4313a;    --color-error-tint: #fdecec;
  --color-info-solid: #0a84ff;     --color-info-text: #0066cc;     --color-info-tint: #e8f2ff;
  --color-neutral-solid: #8e8e93;  --color-neutral-text: #5f5f64;  --color-neutral-tint: #f0f0f2;

  /* Typography (next/font 변수 연결, 3.2) */
  --font-sans: var(--font-noto-sans-kr), system-ui, sans-serif;
  --font-mono: var(--font-google-sans-code), var(--font-noto-sans-kr), ui-monospace, monospace;

  --text-display: 40px;
  --text-h1: 28px;
  --text-h2: 20px;
  --text-h3: 16px;
  --text-body-lg: 16px;
  --text-body: 14px;
  --text-body-sm: 13px;
  --text-caption: 12px;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  /* Shadow */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.12);

  /* Motion */
  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0, 0, 0.2, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);
}

:root {
  --duration-fast: 120ms;
  --duration-normal: 180ms;
  --duration-moderate: 240ms;
  --duration-slow: 320ms;
}

body {
  background: var(--color-background);
  color: var(--color-text-primary);
  font-family: var(--font-sans);
}
```

- Tailwind 기본 색(`red-500` 등)은 쓰지 않는다. 화면마다 임의의 색과 간격을 만들지 않는다.
- 값 → 토큰 변환(예: `P0` → `p0`)은 배지 컴포넌트 한 곳에서만 한다(WIREFRAME 8장).

---

## 15. Do & Don't

### Do

- 명확한 정보 위계
- 일관된 토큰 사용
- 텍스트에는 `-text` 토큰
- 기본 UI에 Noto Sans KR, 기술 정보에 Google Sans Code
- 한국어 문장은 sans로 분리
- 측정 증거와 AI 추론 분리
- Loading / Error / Empty 상태 준비

### Don't

- 모든 영역을 카드로 감싸기
- 넓은 영역에 `-solid` 색 쓰기
- Priority 색 위에 흰 글씨 쓰기
- 글꼴 family 이름을 직접 쓰기
- 색만으로 상태 구분하기
- AI 문장을 측정값처럼 표현하기
- 페이지에서 가져온 HTML을 렌더링하기
- 서비스 화면에 가로 스크롤 만들기

---

## 16. Design Quality Checklist

### Visual Consistency
- [ ] 모든 색이 14장 토큰에서 나오는가?
- [ ] 텍스트에 `-text` 토큰만 쓰는가?
- [ ] Radius, 간격, 글꼴 크기가 정의된 단계만 쓰는가?

### Font Rendering
- [ ] Noto Sans KR이 `next/font` 변수로 적용되고 한글이 정상 표시되는가?
- [ ] mono 영역의 한글이 Noto Sans KR로 대체 표시되는가?
- [ ] 글꼴 로딩에 실패해도 텍스트가 보이는가(`display: swap`)?

### Product-specific
- [ ] 마커가 어두운 배경과 밝은 배경의 스크린샷 모두에서 보이는가?
- [ ] 이미지 크기를 바꿔도 마커가 요소 위치와 맞는가?
- [ ] 측정 증거와 AI 분석이 구분되는가?
- [ ] 6가지 상태 배지가 색 외에 라벨과 아이콘으로 구분되는가?
- [ ] 프롬프트를 읽고 복사하기 편한가?

### Responsive & Accessibility
- [ ] 390px 너비에서 가로 스크롤이 없는가? (이 서비스로 자기 화면을 검사해 본다)
- [ ] 키보드만으로 검사 시작, 이슈 선택, 프롬프트 복사가 가능한가?
- [ ] Focus가 분명하게 보이는가?

---

## 17. Implementation Notes

1. `globals.css`를 14장 토큰으로 바꾸고, 다크 모드 블록과 Geist 글꼴 설정을 지운다.
2. `layout.tsx`에서 Geist 대신 3.1의 글꼴을 로드하고 `lang="ko"`로 바꾼다.
3. 공통 Button, Input, Badge, Notice, Tabs를 먼저 만든다.
4. 배지의 값 → 토큰 변환은 한 곳에 둔다.
5. 실제 검사 데이터(긴 URL, 긴 selector, 이슈 0개, 100개)로 레이아웃이 깨지지 않는지 확인한다.

---

**Document Status:** Draft v1.1
**Next Step:** DETECTION_RULES를 PRD v1.2 기준으로 다시 작성한다.
