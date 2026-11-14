# AI Website Inspector — API Specification

> Version: 2.0
> Status: Draft
> Related Documents: PRD.md (v1.2), DOMAIN_MODEL.md (v2.0), USER_FLOW.md (v1.1), AGENTS.md

### Changelog (v1.0 → v2.0)

v1.0은 서버 메모리 저장소와 In-Memory Job Queue, 사용자가 직접 호출하는 AI 분석·태스크·프롬프트 API 10개를 전제로 했다. 이 구조는 Vercel 서버리스에서 동작하지 않고, PRD v1.2의 "코드가 자동으로 그룹화하고 조립한다"는 흐름과도 맞지 않았다. v2.0은 PRD 8.3 기준으로 다시 썼다.

- 삭제: Issue 상세, AI 분석 생성, Task 생성·조회, Prompt 생성·조회, Artifact(PNG) 조회 API, 요청의 `viewports` 필드, `{ success, data }` 응답 감싸기, Idempotency-Key, In-Memory Store와 Job Queue, `queued` 상태, `src/application/`·`src/domain/` 폴더
- 추가: 내부 전용 `/analyze` API, 내부 호출 규칙(절대 URL, 배포 보호 우회), 동시 실행 제한, 멈춘 검사 처리, 페이지 라우트가 데이터를 읽는 방식

> **우선순위:** PRD 8.3이 API의 기준이다. 데이터 구조는 PRD 8.2와 DOMAIN_MODEL을 따른다.

---

## 1. Overview

### 1.1 Endpoints

| Method | Path | 호출자 | 설명 |
|---|---|---|---|
| `POST` | `/api/inspections` | 브라우저 | 검사 생성 |
| `GET` | `/api/inspections/:id` | 브라우저 (polling) | 상태와 결과 조회 |
| `POST` | `/api/inspections/:id/analyze` | 서버 내부 | AI 단계 실행 (공유 비밀로 보호) |
| `POST` | `/api/inspections/:id/cancel` | 브라우저 (진행 화면) | 검사 중지 (6A장) |

페이지 라우트(API 아님):

| Path | 데이터를 얻는 방식 |
|---|---|
| `/` | 없음 |
| `/inspections/[id]` | 클라이언트 컴포넌트가 `GET /api/inspections/:id`를 polling |
| `/report/[id]` | 서버 컴포넌트가 `src/server/store`로 Redis를 직접 읽고, `analyzing` 상태면 클라이언트 컴포넌트가 이어서 polling |
| `/report/sample` | `public/sample/inspection.json` import (DOMAIN_MODEL 6.3) |

`/report/[id]` 서버 컴포넌트가 자기 API를 다시 fetch하지 않는 이유: 같은 배포 안에서 HTTP를 한 번 더 거칠 이유가 없고, 배포 보호(4.3)에 막힐 수 있기 때문이다.

### 1.2 Principles

1. **API는 3개뿐이다.** 이슈, 태스크, 프롬프트는 모두 `GET /api/inspections/:id` 응답 안에 들어 있다.
2. **비동기로 처리한다.** 검사와 AI 분석은 응답을 보낸 뒤 `after()` 안에서 실행한다(PRD 8.1.2).
3. **응답 형식은 단순하다.** 성공하면 본문 그대로, 실패하면 `{ code, message }`다. 감싸는 객체를 두지 않는다.
4. **route 파일에는 비즈니스 로직을 두지 않는다.** 요청 파싱, 서버 함수 호출, 응답 변환만 한다(AGENTS.md 3.1).
5. **스크린샷은 응답에 넣지 않는다.** Blob URL만 돌려준다(PRD 8.1.2, AGENTS.md 13장).

---

## 2. Common Conventions

### 2.1 형식

- 요청과 응답 본문은 `application/json; charset=utf-8`이다.
- 성공 응답은 각 API 절에 정의된 본문을 그대로 쓴다.
- 오류 응답은 다음 형식이다.

```ts
// src/types/api.ts
interface ApiError {
  code: ErrorCode | 'NOT_FOUND' | 'INVALID_STATE' | 'UNAUTHORIZED';
  message: string;   // 사용자에게 보여줄 수 있는 한국어 문구
}
```

- `message`에 스택 트레이스, 내부 경로, 비밀 값, 입력 URL 전체를 넣지 않는다.

### 2.2 HTTP Status

| Status | 쓰는 곳 |
|---|---|
| 200 | GET 조회 성공 |
| 202 | 검사 접수, analyze 접수 |
| 400 | 요청 본문 오류, URL 오류, 금지된 대상 |
| 401 | analyze 공유 비밀 불일치 |
| 404 | 검사가 없음 또는 만료 |
| 409 | analyze를 실행할 수 없는 상태 |
| 413 | 요청 본문이 너무 큼 |
| 429 | 동시 실행 수 초과 |
| 500 | 예상하지 못한 오류, 저장 실패 |

v1.0의 422(URL 오류)는 PRD 8.3에 맞춰 400으로 바꿨다.

### 2.3 오류 코드와 HTTP Status

| code | Status | message 예시 |
|---|---:|---|
| `INVALID_URL` | 400 | 올바른 http:// 또는 https:// 주소를 입력해 주세요. |
| `BLOCKED_TARGET` | 400 | 보안상 검사할 수 없는 주소입니다. |
| `TOO_MANY_INSPECTIONS` | 429 | 다른 검사가 진행 중입니다. 잠시 후 다시 시도해 주세요. |
| `NOT_FOUND` | 404 | 검사 결과를 찾을 수 없습니다. 결과는 7일 동안 보관됩니다. |
| `UNAUTHORIZED` | 401 | (본문 없이 응답해도 된다) |
| `INVALID_STATE` | 409 | 이미 처리 중이거나 처리할 수 없는 상태입니다. |
| `STORAGE_FAILED` | 500 | 검사를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요. |
| `INTERNAL_ERROR` | 500 | 일시적인 오류가 발생했습니다. |

검사 도중의 실패(`NAVIGATION_TIMEOUT`, `HTTP_ERROR` 등)는 API 오류가 아니다. `GET` 응답의 `error`, `viewportErrors`, `analysis.error`에 담긴다(PRD 6.2.4).

### 2.4 Route 설정

브라우저나 AI를 실행하는 route(`POST /api/inspections`, `POST /api/inspections/:id/analyze`)에는 다음을 선언한다.

```ts
export const maxDuration = 300;
```

- AGENTS.md 7장은 `export const runtime = 'nodejs'`도 선언하라고 한다. 그런데 현재 `next.config.ts`에 `cacheComponents: true`가 켜져 있고, 설치된 Next 16.4.6 문서에 따르면 Cache Components가 켜져 있으면 `runtime` export를 쓸 수 없다. 이 충돌은 **결정이 필요하다**(9장). 어느 쪽을 택해도 기본 runtime은 Node.js다.
- Edge runtime은 쓰지 않는다.
- `GET` 응답에는 `Cache-Control: no-store`를 둔다. polling 결과가 캐시되면 안 되기 때문이다.

### 2.5 CORS

- 같은 출처에서만 쓴다. CORS 헤더를 내보내지 않는다.

### 2.6 로그

- 로그에는 검사 ID, 대상 호스트, 단계, 오류 코드, 소요 시간만 남긴다.
- 입력 URL 전체, 쿼리 문자열, 공유 비밀, API Key는 남기지 않는다(AGENTS.md 8장).

---

## 3. `POST /api/inspections`

### 3.1 Request

```http
POST /api/inspections
Content-Type: application/json

{ "url": "https://example.com/pricing" }
```

| 검사 | 기준 | 실패 |
|---|---|---|
| 본문 크기 | 4 KB 이하 (`Content-Length` 또는 읽은 길이) | 413 `INVALID_URL` |
| JSON 파싱 | — | 400 `INVALID_URL` |
| 스키마 | `src/schemas/inspectionRequest.ts`: `z.strictObject({ url: z.string().trim().min(1).max(2048) })` | 400 `INVALID_URL` |
| URL 정규화와 판정 | `src/server/security/url.ts` | 400 `INVALID_URL` 또는 `BLOCKED_TARGET` |

`src/server/security/url.ts`의 판정 (PRD 8.6):
1. WHATWG URL로 파싱한다. 실패하면 `INVALID_URL`
2. 프로토콜이 `http:`, `https:`가 아니면 `INVALID_URL`
3. `username` 또는 `password`가 있으면 `INVALID_URL`
4. 호스트 이름이 금지 목록(`localhost`, `*.localhost`, `*.local`, `*.internal`, 메타데이터 호스트)이면 `BLOCKED_TARGET`
5. 호스트가 IP면 그대로, 이름이면 DNS로 조회한 모든 주소를 `src/server/security/ssrf.ts`로 판정한다. 하나라도 금지 범위면 `BLOCKED_TARGET`
6. DNS 조회에 실패하면 `INVALID_URL` ("주소를 찾을 수 없습니다")

URL의 `#fragment`는 버리고, 나머지(경로, 쿼리)는 그대로 둔다.

### 3.2 Processing

```text
1. 요청 검증 (3.1)
2. 동시 실행 슬롯 획득 (Redis Lua, PRD 8.4)     실패 → 429 TOO_MANY_INSPECTIONS
3. id = crypto.randomUUID()
4. Inspection 문서 생성 후 저장 (SET … EX 604800)  실패 → 슬롯 반환, 500 STORAGE_FAILED
     status: pending, url, createdAt, updatedAt,
     viewports/viewportErrors: 모두 null, analysis: { status: 'pending', analyzedIssueCount: 0 },
     issues: [], tasks: []
5. after(() => runInspection(id, createInspectionDeps(origin)))   // finally에서 슬롯 반환
6. 202 { id }
```

- `origin`은 요청의 `request.nextUrl.origin`이다. 4.2의 내부 호출 URL을 만드는 데 쓴다.
- `runInspection(id, deps)`는 검사 URL을 저장된 문서에서 읽는다. 저장소, Blob, 브라우저, 시계, analyze 호출은 `deps`로 받아 테스트에서 가짜 구현을 넣는다.
- 문서에는 정규화한 URL을 `url`로 저장한다.

### 3.3 Response

```http
HTTP/1.1 202 Accepted
Content-Type: application/json

{ "id": "9b1f2c4e-6a0d-4c1e-9f8a-2d7e5b3c1a90" }
```

```ts
// src/types/api.ts
interface CreateInspectionResponse { id: string }
```

### 3.4 Errors

| 상황 | Status | code |
|---|---:|---|
| 본문이 4 KB 초과 | 413 | `INVALID_URL` |
| JSON 아님, 스키마 불일치, URL 형식 오류, 프로토콜, 계정 정보, DNS 실패 | 400 | `INVALID_URL` |
| 금지된 대상 | 400 | `BLOCKED_TARGET` |
| 동시 실행 수 초과 | 429 | `TOO_MANY_INSPECTIONS` |
| Redis 저장 실패 | 500 | `STORAGE_FAILED` |

---

## 4. 검사 실행 (`runInspection`, `after()` 안)

API가 아니라 `POST /api/inspections`의 `after()`에서 실행되는 서버 함수다. 전체 흐름과 시간 예산은 PRD 8.1.2, 8.1.3을 따르고, 쓰는 필드는 DOMAIN_MODEL 4.2를 따른다. 여기서는 API와 맞닿는 부분만 정한다.

### 4.1 상태 저장 시점

| 시점 | 저장 내용 |
|---|---|
| 시작 | `status: running`, `step: initializing_browser`, `startedAt` |
| 각 단계 시작 | `step` |
| 브라우저 단계 종료 | `analyzing` + `viewports`, `viewportErrors`, `issues` 또는 `failed` + `error` (PRD 6.2.2) |

`step`만 바뀌는 저장은 진행 표시용이다. 저장에 실패해도 검사를 멈추지 않는다. 마지막 결과 저장에 실패하면 `STORAGE_FAILED`로 `failed`를 저장하려고 한 번 더 시도한다.

### 4.2 AI 단계 호출

브라우저 단계를 `analyzing`으로 저장한 뒤 analyze를 호출한다.

```text
POST {origin}/api/inspections/{id}/analyze
x-internal-secret: {INTERNAL_API_SECRET}
x-vercel-protection-bypass: {VERCEL_AUTOMATION_BYPASS_SECRET}   // 있을 때만
```

- `{origin}`의 1순위는 검사 요청이 들어온 주소(3.2의 `origin`)다. 알 수 없을 때만 `https://{VERCEL_URL}`을 쓴다. 배포별 생성 주소(`VERCEL_URL`)는 기본 배포 보호에서 production 배포도 보호 대상이라 401로 막힐 수 있기 때문이다(PRD 8.1.2).
- 응답이 202면 끝낸다. AI 단계가 끝나기를 기다리지 않는다.
- 리다이렉트를 따라가지 않는다(`redirect: 'manual'`). fetch는 다른 origin으로 리다이렉트해도 `x-internal-secret`을 그대로 보내고, 따라간 끝의 응답(예: 로그인 페이지 200)이 analyze 응답처럼 보이기 때문이다. 3xx도 202가 아닌 응답이라 확실한 실패로 본다. 실패 로그에는 status, 리다이렉트 대상 호스트, `x-matched-path`, content-type만 남긴다.
- 응답 대기 시간은 10초다.
- 확실한 실패(202가 아닌 응답, 연결 거부 등)면 1회 다시 시도한다. 두 번 모두 실패하면 문서를 다시 읽어 `analysis.status`가 아직 `pending`일 때만 `partial` + `analysis: { status: 'failed', error: { code: 'AI_FAILED', … } }`로 저장한다(PRD 8.1.2). 태스크는 만들어지지 않는다.
- 시간 초과면 다시 시도하지 않고 문서도 쓰지 않는다. analyze가 실제로 시작되었다면 정상 완료되고, 그렇지 않다면 300초 뒤 멈춘 검사 처리(DOMAIN_MODEL 4.4)가 `partial`로 보여준다.
- 이슈가 0개여도 analyze를 호출한다. `analysis.status = skipped` 처리는 analyze 쪽 책임이다(PRD 6.2.2).

### 4.3 배포 보호 우회

Vercel 배포에 Deployment Protection이 켜져 있으면 서버가 자기 배포를 호출해도 401로 막힌다. 기본 설정에서는 Preview 배포와, production 배포의 배포별 생성 주소(`VERCEL_URL`)가 보호 대상이다.

- Vercel 프로젝트 설정에서 "Protection Bypass for Automation"을 켜고, 그 값(`VERCEL_AUTOMATION_BYPASS_SECRET`)을 `x-vercel-protection-bypass` 헤더로 보낸다.
- 이 값은 `src/server/env.ts`에서 선택 항목으로 검증한다. AGENTS.md 5장 환경변수 표에 추가해야 한다.
- Preview 확인에 필요하므로 "Protection Bypass for Automation"을 켜고 값을 등록해 둔다.
- 검사용 Chromium은 이 헤더를 보내지 않는다. 보호가 켜진 배포의 Fixture URL(`/fixtures/...`)을 검사하면 401 → `HTTP_ERROR`가 된다. 쿼리 문자열로 우회하지 않는다(비밀 값이 문서의 `url`에 저장되어 공개된다). Fixture 검사는 보호를 끈 배포에서 한다.

---

## 5. `GET /api/inspections/:id`

### 5.1 Request

```http
GET /api/inspections/9b1f2c4e-6a0d-4c1e-9f8a-2d7e5b3c1a90
```

- `id`가 UUID 형식(`z.uuid()`)이 아니면 Redis를 조회하지 않고 404를 반환한다. 400을 쓰지 않는 이유: 사용자 입장에서는 "그런 결과가 없다"와 같은 의미이고, 화면 처리를 하나로 줄일 수 있기 때문이다.

### 5.2 Processing

```text
1. id 형식 확인                              실패 → 404 NOT_FOUND
2. Redis GET inspection:{id}                없음 → 404 NOT_FOUND
3. JSON.parse + inspectionSchema.parse       실패 → 500 INTERNAL_ERROR
4. 멈춘 검사 처리 (DOMAIN_MODEL 4.4)
5. 200 + Inspection JSON, Cache-Control: no-store
```

### 5.3 Response

본문은 PRD 8.2의 `Inspection` 그대로다. 상태별로 채워지는 필드:

| status | 채워지는 필드 |
|---|---|
| `pending` | 기본 필드만. `viewports`/`viewportErrors`는 모두 `null`, `issues`/`tasks`는 빈 배열, `issuesDetected`는 0, `issuesTruncated`는 `false` |
| `running` | + `step`, `startedAt` |
| `analyzing` | + `finalUrl`, `viewports`, `viewportErrors`, `issues`(AI 필드 제외), `issuesDetected`, `issuesTruncated`, `analysis.status: running` |
| `completed` / `partial` | + `issues[].analysis` 또는 `analysisSkippedReason`, `tasks`, `completedAt` |
| `failed` | + `error`, `completedAt`. 실패한 viewport의 `viewportErrors` |

예시 (`analyzing`, 일부 생략):

```json
{
  "id": "9b1f2c4e-6a0d-4c1e-9f8a-2d7e5b3c1a90",
  "url": "https://example.com/pricing",
  "finalUrl": "https://www.example.com/pricing",
  "status": "analyzing",
  "step": "analyzing_issues",
  "createdAt": "2026-11-13T08:20:00.000Z",
  "startedAt": "2026-11-13T08:20:01.000Z",
  "updatedAt": "2026-11-13T08:21:05.000Z",
  "viewports": {
    "desktop": { "width": 1440, "height": 900, "innerWidth": 1440, "layoutWidth": 1440, "hasMetaViewport": true, "documentHeight": 4210, "screenshotUrl": "https://…blob.vercel-storage.com/inspections/9b1f…/desktop-full-AbC123.png", "screenshotWidth": 1440, "screenshotHeight": 4210, "screenshotTruncated": false, "elementsInspected": 812, "elementsTruncated": false, "hasCanvas": false, "overlaysDetected": [] },
    "mobile": { "width": 390, "height": 844, "innerWidth": 390, "layoutWidth": 390, "hasMetaViewport": true, "documentHeight": 7020, "screenshotUrl": "https://…/mobile-full-XyZ789.png", "screenshotWidth": 390, "screenshotHeight": 5000, "screenshotTruncated": true, "elementsInspected": 812, "elementsTruncated": false, "hasCanvas": false, "overlaysDetected": [] }
  },
  "viewportErrors": { "desktop": null, "mobile": null },
  "analysis": { "status": "running", "analyzedIssueCount": 0 },
  "issuesDetected": 1,
  "issuesTruncated": false,
  "issues": [
    {
      "id": "ISS-001",
      "type": "viewport-overflow",
      "subtype": "page-scroll",
      "title": "Viewport Overflow · page-scroll — section#hero > div.hero-visual",
      "viewports": ["mobile"],
      "viewportTag": "mobile-only",
      "selector": "section#hero > div.hero-visual",
      "sourceHints": { "landmark": "hero", "htmlSnippet": "<div class=\"hero-visual\">", "stableAttributes": {}, "ancestorPath": "main > section#hero" },
      "occurrences": [ { "viewport": "mobile", "selector": "section#hero > div.hero-visual", "boundingBox": { "x": 0, "y": 120, "width": 600, "height": 320 }, "measured": { "elementRight": 600, "documentScrollWidth": 600 }, "expected": { "layoutWidth": 390 }, "delta": { "overflowRight": 210 }, "evidenceText": "요소의 오른쪽 끝(600px)이 Mobile 화면 너비(390px)를 210px 벗어나 페이지 가로 스크롤이 발생합니다.", "relatedElements": [], "cropRect": { "x": 0, "y": 96, "width": 390, "height": 368 }, "computedStyle": { "width": "600px" }, "sourceHints": { "…": "…" }, "confidence": 1 } ],
      "relatedIssueIds": [],
      "affectedDescendants": 3,
      "scores": { "S": 4, "I": 4, "R": 5, "score100": 430 },
      "priority": "P0",
      "confidence": 1,
      "needsReview": false
    }
  ],
  "tasks": []
}
```

### 5.4 크기

- 응답은 Vercel 함수 응답 한도(4.5 MB) 안이어야 한다. 이슈 수백 개 기준 수백 KB 수준으로 예상한다(DOMAIN_MODEL 6.1). 스크린샷은 URL만 들어 있다.
- 큰 페이지로 한 번 측정해 확인한다.

---

## 6. `POST /api/inspections/:id/analyze` (내부 전용)

### 6.1 Request

```http
POST /api/inspections/{id}/analyze
x-internal-secret: {INTERNAL_API_SECRET}
```

본문은 없다(있으면 무시한다).

### 6.2 Processing

```text
1. x-internal-secret을 INTERNAL_API_SECRET과 crypto.timingSafeEqual로 비교   불일치 → 401
2. id 형식 확인                                                             실패 → 404
3. 문서 읽기                                                                없음 → 404
4. status == analyzing && analysis.status == pending 인지 확인              아니면 409 INVALID_STATE
5. SET inspection:{id}:analyze-lock 1 NX EX 300                            실패 → 409 INVALID_STATE
6. after(() => runAnalysis(id))
7. 202 {}
```

- 상태를 먼저 확인하고 잠금을 잡는다. 상태가 맞지 않아 409를 돌려줄 때 잠금이 남지 않게 하기 위해서다.
- `runAnalysis`의 순서는 DOMAIN_MODEL 4.3, 시간 상한은 PRD 8.1.3(240초)을 따른다.
- 잠금은 TTL(300초)로 풀린다. 정상 종료 시 지우지 않아도 된다. 종료 상태는 4번 조건으로 다시 막히기 때문이다.
- `INTERNAL_API_SECRET` 설정이 없으면 401로 숨기지 않고 500 `INTERNAL_ERROR`를 반환한다.

### 6.3 Errors

| 상황 | Status | code |
|---|---:|---|
| 비밀 헤더 없음 또는 불일치 | 401 | `UNAUTHORIZED` |
| 검사가 없음 | 404 | `NOT_FOUND` |
| 이미 실행 중이거나 상태가 맞지 않음 | 409 | `INVALID_STATE` |

---

## 6A. `POST /api/inspections/:id/cancel`

진행 화면의 "검사 중지" 버튼이 호출한다. 검사 ID를 아는 사람이면 누구나 호출할 수 있다(공유 URL과 같은 권한, 인증 없음 PRD 9장).

### 6A.1 Request

```http
POST /api/inspections/{id}/cancel
```

본문은 없다.

### 6A.2 Processing

```text
1. id 형식 확인                                            실패 → 404
2. 문서 읽기                                               없음 → 404
3. status가 pending 또는 running인지 확인                   아니면 409 INVALID_STATE
4. SET inspection:{id}:cancel 1 EX 300                     (중지 요청 표시)
5. 문서 다시 읽기 → 아직 pending/running이면                아니면 409 INVALID_STATE
   failed + error { code: CANCELLED } 로 저장 (측정 결과는 비운다, DOMAIN_MODEL I-5)
6. ZREM inspections:running {id}                           (슬롯 바로 반환, 실패는 무시)
7. 200 + 저장한 문서
```

- 표시를 먼저 남기고 다시 읽는다. 브라우저 단계(`runInspection`)의 저장은 모두 "중지 표시가 없을 때만 SET" 하는 Lua 스크립트로 한다(DOMAIN_MODEL 6.1). 그래서 4번 이후에는 브라우저 단계가 문서를 쓸 수 없고, 5번에서 읽은 상태가 마지막 상태다.
- 실행 중인 `runInspection`은 2초마다 표시를 확인한다. 표시를 보면 브라우저를 닫아 진행 중인 렌더링을 끊고, 아무것도 저장하지 않고 끝난다. 슬롯은 `finally`에서 한 번 더 반환한다(중복 반환은 무해).
- `analyzing` 이후(결과 정리, 분석)는 중지할 수 없다. 1초 안팎으로 끝나는 단계이고, 이미 저장된 측정 결과를 지우지 않기 위해서다.

### 6A.3 Errors

| 상황 | Status | code |
|---|---:|---|
| 검사가 없음, UUID가 아님 | 404 | `NOT_FOUND` |
| 이미 끝났거나 `analyzing` 이후 | 409 | `INVALID_STATE` (message: 이미 끝났거나 결과를 정리하는 중이라 검사를 중지할 수 없습니다.) |
| Redis 오류 | 500 | `INTERNAL_ERROR` |

---

## 7. Client Polling

`/inspections/[id]`와 `analyzing` 상태의 `/report/[id]`가 같은 규칙을 쓴다(USER_FLOW 4.7). 두 화면이 서로 다른 feature(`inspection-progress`, `report`)이고 feature끼리는 import할 수 없으므로(AGENTS.md 3.1), polling 훅은 한 곳에 공용으로 둔다. 위치는 9.1-2에서 정한다.

| 항목 | 규칙 |
|---|---|
| 첫 조회 | 진입 즉시 |
| 간격 | 이전 응답을 받은 뒤 2초 |
| 동시 요청 | 1개 (이전 요청이 끝나기 전에는 보내지 않음) |
| 네트워크 오류, 5xx | 3회까지 같은 간격으로 다시 시도, 그 뒤 멈추고 새로고침 안내 |
| 404 | 멈추고 결과 없음 화면 |
| 종료 상태 | `completed`, `partial`, `failed`에서 멈춤 |
| Progress 화면 | `analyzing`이 되면 멈추고 `/report/[id]`로 이동 |
| 화면이 숨겨졌을 때 | `document.visibilityState = hidden`이면 멈추고, 다시 보이면 즉시 조회 |
| 화면을 떠날 때 | 진행 중인 요청 취소(`AbortController`)하고 멈춤 |

---

## 8. Security

PRD 8.6의 API 관련 부분:

- 사용자가 입력한 URL은 `src/server/security/url.ts`를 거치지 않고 브라우저에 넘기지 않는다.
- 입력 단계의 판정(3.1)은 첫 관문일 뿐이다. 리다이렉트와 하위 요청은 브라우저 안에서 `context.route`가 다시 판정한다(PRD 8.6).
- `/analyze`는 공유 비밀로 보호하고, 비교는 `crypto.timingSafeEqual`로 한다. 길이가 다르면 바로 401이다.
- 공유 비밀, API Key, 배포 보호 우회 값은 서버 환경변수로만 다루고 `NEXT_PUBLIC_` 접두어를 붙이지 않는다.
- 응답에 페이지에서 가져온 텍스트와 HTML이 들어 있다. 클라이언트는 이 값을 문자열로만 렌더링한다(`dangerouslySetInnerHTML` 금지).
- 요청 수 제한은 동시 실행 슬롯(PRD 8.4)만 둔다. IP별 요청 제한은 MVP 범위 밖이다. 공개 배포 뒤 남용이 보이면 추가를 검토한다.

---

## 9. 결정이 필요한 것과 새로 정한 것

### 9.1 결정이 필요한 것

1. **`cacheComponents`와 `runtime` export (2.4):** `next.config.ts`의 `cacheComponents: true`를 끄고 AGENTS.md 7장대로 `runtime = 'nodejs'`를 선언할지, `cacheComponents`를 유지하고 AGENTS.md에서 `runtime` 지침을 뺄지 정해야 한다. 권장은 끄는 쪽이다. 이 서비스는 polling과 동적 결과 화면이 대부분이라 캐시 이점이 거의 없다. 구현 1단계 전에 정해야 한다.
2. **polling 훅 위치 (7장):** Progress 화면과 결과 화면이 같은 polling을 쓰는데 feature끼리는 import할 수 없다. 권장: polling 훅을 `src/components/`의 공용 클라이언트 모듈(예: `src/components/polling/useInspectionPolling.ts`)로 두고, 두 feature가 함께 쓴다. AGENTS.md 수정 때 반영한다.

### 9.2 새로 정한 값과 규칙

PRD에 없던 결정이다(AGENTS.md 6장).

1. 요청 본문 크기 상한 4 KB, 넘으면 413(3.1).
2. DNS 조회 실패는 `INVALID_URL`(3.1).
3. URL의 `#fragment`는 버린다(3.1).
4. 형식이 잘못된 id는 400이 아니라 404(5.1).
5. `/report/[id]`는 Redis를 직접 읽고 자기 API를 fetch하지 않는다(1.1).
6. analyze 호출 대기 10초. 확실한 실패만 1회 재시도하고, 시간 초과는 재시도하지 않고 문서를 쓰지 않는다(4.2).
7. 이슈가 0개여도 analyze를 호출한다. skipped 처리는 analyze가 한다(4.2).
8. 배포 보호 우회 환경변수 `VERCEL_AUTOMATION_BYPASS_SECRET`(4.3). AGENTS.md 5장에 추가한다.
9. 오류 코드 `NOT_FOUND`, `INVALID_STATE`, `UNAUTHORIZED`는 API 응답 전용이다. PRD 6.2.4의 검사 실패 코드와 섞지 않는다(2.1).
10. 화면이 숨겨지면 polling을 멈춘다(7장).
11. IP별 요청 제한은 두지 않는다(8장).

---

## 10. Implementation Structure

AGENTS.md 3장을 따른다.

```text
src/app/api/inspections/route.ts                  POST: 3장
src/app/api/inspections/[id]/route.ts             GET: 5장
src/app/api/inspections/[id]/analyze/route.ts     POST: 6장
src/schemas/inspectionRequest.ts                  요청 스키마 (DOMAIN_MODEL 5.1)
src/types/api.ts                                  CreateInspectionResponse, ApiError
src/server/security/url.ts, ssrf.ts               URL 판정
src/server/store/redis.ts                         읽기, 쓰기, 슬롯, 잠금, 멈춘 검사 처리
src/server/inspect.ts                             runInspection (4장)
src/server/analyze.ts                             runAnalysis (DOMAIN_MODEL 4.3)
src/server/analysis/…, src/server/tasks/…, src/server/prompt/…   원인 분석, 태스크, 프롬프트 (DETECTION_RULES 13장)
```

route 파일은 다음만 한다:
1. 요청 읽기와 스키마 검증
2. 서버 함수 호출
3. 서버 함수가 던진 `InspectionError`를 2.3 표에 따라 HTTP 응답으로 변환
4. 응답 반환

---

## 11. Implementation Checklist

### Request / Response
- [ ] 요청 본문을 `src/schemas/inspectionRequest.ts`로 검증한다.
- [ ] 오류 응답이 모두 `{ code, message }` 형식이다.
- [ ] `GET` 응답에 `Cache-Control: no-store`가 있다.
- [ ] 응답에 base64 이미지가 없다.

### Inspection
- [ ] 검사 생성 후 202와 id가 즉시 반환된다.
- [ ] 동시 실행 수를 넘으면 429가 반환되고, 검사가 끝나면 슬롯이 반환된다.
- [ ] `analyzing` 상태에서 이슈와 스크린샷이 조회된다.
- [ ] 함수가 죽어 멈춘 검사가 300초 뒤 `failed`/`partial`로 보인다.

### Analyze
- [ ] 비밀 헤더가 없으면 401이다.
- [ ] 같은 검사에 analyze를 두 번 호출하면 두 번째는 409다.
- [ ] Preview 배포에서 내부 호출이 배포 보호에 막히지 않는다.
- [ ] analyze 호출이 실패해도 브라우저 검사 결과가 남고 `partial`로 끝난다.

### Security
- [ ] `localhost`, 사설 IP, IPv4-mapped IPv6, 10진수·16진수 IP 입력이 `BLOCKED_TARGET`이다(단위 테스트).
- [ ] 계정 정보가 들어간 URL이 `INVALID_URL`이다.
- [ ] 로그에 입력 URL 전체와 비밀 값이 없다.

---

**Document Status:** Draft v2.0
**Next Step:** DATA_MODEL을 `docs/future/`로 옮기고, AGENTS.md를 문서 변경 사항에 맞춰 수정한다.
