# Before / After 비교

| | Before | After |
|---|---|---|
| 검사 URL | http://127.0.0.1:3000/demo/landing.html | http://127.0.0.1:3000/demo/landing-fixed.html |
| 검사 시각 (UTC) | 2026-11-15T05:19:22.705Z | 2026-11-15T05:19:29.255Z |
| 이슈 / 태스크 | 5 / 4 | 0 / 0 |

## 이슈 수

| 구분 | Before | After | 변화 |
|---|---:|---:|---:|
| 확정 이슈 (needsReview: false) | 4 | 0 | −4 |
| Needs Review | 1 | 0 | −1 |

| Priority | Before | After | 변화 |
|---|---:|---:|---:|
| P0 | 2 | 0 | −2 |
| P1 | 1 | 0 | −1 |
| P2 | 1 | 0 | −1 |
| P3 | 0 | 0 | 0 |

| 유형 | Before | After | 변화 |
|---|---:|---:|---:|
| text-overflow | 2 | 0 | −2 |
| element-overlap | 1 | 0 | −1 |
| viewport-overflow | 1 | 0 | −1 |

| Viewport | Before | After | 변화 |
|---|---:|---:|---:|
| Desktop | 1 | 0 | −1 |
| Mobile | 4 | 0 | −4 |

Priority, 유형, Viewport 표는 확정 이슈(needsReview: false)만 센다. 두 viewport에서 모두 나온 이슈는 Desktop과 Mobile에 각각 센다.

## 해결된 이슈 (Before에만 있음, 5개)

| ID | 유형 | Priority | Viewport | Needs Review | 대상 요소 | 제목 |
|---|---|---|---|---|---|---|
| ISS-001 | element-overlap/other | P2 | both | 예 | `[data-testid="feature-image-1"]` | Element Overlap — [data-testid="feature-image-1"] ↔ span "NEW" |
| ISS-002 | text-overflow/spill | P2 | both |  | `[data-testid="plan-team-note"]` | Text Overflow · spill — p "프로 요금제의 모든 기능에 더해 단일" |
| ISS-003 | element-overlap/interactive | P0 | mobile-only |  | `[data-testid="nav-login"]` | Element Overlap — a "로그인" ↔ a "무료로 시작" |
| ISS-004 | text-overflow/clipped | P1 | mobile-only |  | `[data-testid="hero-cta"]` | Text Overflow · clipped — a "14일 무료 체험 시작하기" |
| ISS-005 | viewport-overflow/page-scroll | P0 | mobile-only |  | `[data-testid="hero-image"]` | Viewport Overflow · page-scroll — [data-testid="hero-image"] |

## 새로 생긴 이슈 (After에만 있음, 0개)

없음

## 남은 이슈 (0개)

없음

매칭 기준: `type`, `subtype`이 같고 대상 요소가 같은 이슈. 대상 요소는 selector를 먼저 비교하고, 다르면 Source Hints(안정 속성, 또는 영역 + 텍스트)로 비교한다. Issue ID는 검사마다 다시 붙으므로 쓰지 않는다.
