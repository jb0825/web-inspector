# AI Website Inspector — Data Model

> **보관 문서 (MVP에서 사용하지 않음)**
> MVP는 데이터베이스 없이 Upstash Redis와 Vercel Blob을 쓴다. 현재 기준은 `docs/PRD.md`(v1.2)와 `docs/DOMAIN_MODEL.md`(v2.0)다. 이 문서는 PRD v1.1 이전에 작성되어 다음 내용이 현재 기준과 다르다. 나중에 데이터베이스를 도입할 때 아래 항목을 먼저 PRD 기준으로 고친다.
> - Priority 공식의 `× Confidence` (현재: Confidence를 곱하지 않고 정수 연산, PRD 5.5.2)
> - Desktop과 Mobile 이슈를 따로 저장 (현재: 같은 요소는 병합하고 `occurrences`로 보관, PRD 5.3.5)
> - snake_case 이슈 유형(`text_overflow`) (현재: `text-overflow`)
> - 상태 `partially_completed`, `cancelled` (현재: `partial`, 취소 없음)
> - 이슈·태스크 상태, Prompt 버전, AI 분석 이력 (현재: MVP 범위 밖)
> - UUID 기반 Issue ID (현재: `ISS-001`)

> Version: 1.0
> Status: Draft  
> Related Documents: PRD.md, USER_FLOW.md, WIREFRAME.md, DESIGN_GUIDE.md, DETECTION_RULES.md, DOMAIN_MODEL.md

---

‼️ 현재는 실제 데이터베이스를 해당 서비스에 사용하지 않으므로, 추후에 기능 확장 및 사용자가 이 서비스를 반복해서 사용할 이유가 생겼을 때 해당 문서를 숙지하여 데이터베이스 스키마를 구현한다.

현재는 이 문서의 해당 라인 아래부터는 읽지 않는다.

---

## 1. Document Overview

### 1.1 Purpose

본 문서는 AI Website Inspector의 데이터 모델과 데이터베이스 구조를 정의한다.

AI Website Inspector는 사용자가 입력한 웹사이트 URL을 검사하고, UI 문제를 탐지한 뒤, 문제의 Evidence, Priority, AI 분석 결과 및 개발 작업을 생성하는 서비스다.

각 단계에서 생성되는 데이터를 일관되게 관리하고, 검사 결과를 조회하거나 재검사 결과와 비교할 수 있도록 데이터 구조를 설계한다.

본 문서는 다음 항목을 정의한다.

- Core Entity 및 Entity 간 관계
- Database Schema
- Field Definition 및 Data Type
- Enum 및 Status Definition
- JSON Data Structure
- Data Validation Rules
- Data Lifecycle 및 Storage Strategy
- Database Integrity 및 Index Strategy

### 1.2 Design Principles

데이터 모델은 다음 원칙을 기반으로 설계한다.

**1. Separation of Concerns**

Inspection, Inspection Viewport, Issue, Evidence, AI Analysis, Development Task를 각각 독립적인 Entity로 관리한다.

**2. Evidence-Based Data**

탐지된 UI 문제와 실제 측정 데이터인 Evidence를 구분한다. AI 분석 결과가 실제 측정 데이터를 변경하거나 대체할 수 없어야 한다.

**3. Traceability**

모든 Issue는 어떤 Inspection과 Viewport에서 발견되었는지 추적할 수 있어야 한다. AI Analysis와 Development Task 역시 원본 Issue와 연결되어야 한다.

**4. Reproducibility**

동일한 URL을 여러 번 검사하더라도 각 Inspection 결과를 독립적으로 보존한다. 이전 검사 결과를 덮어쓰지 않으며, 검사 환경과 Rule Set Version을 함께 기록한다.

**5. Data Integrity**

Foreign Key, Unique Constraint, Check Constraint 및 Transaction을 활용하여 잘못된 데이터 관계가 저장되지 않도록 한다.

**6. Extensibility**

향후 Accessibility, Visual Hierarchy, Design Consistency 등의 새로운 검사 유형을 추가할 수 있도록 확장 가능한 구조를 유지한다.

**7. Type Safety**

TypeScript와 Zod를 활용하여 애플리케이션 내부의 데이터 타입과 API 입력값을 검증한다.

### 1.3 Technology Stack

| Category | Technology |
|---|---|
| Database | SQLite |
| ORM | Drizzle ORM |
| Validation | Zod |
| Language | TypeScript |
| Primary Key | UUID |
| Date Handling | UTC Unix Timestamp (Milliseconds) |
| Serialization | JSON |
| Package Manager | pnpm |

초기 MVP에서는 SQLite를 사용한다. 데이터 규모와 동시성 요구사항이 증가하면 PostgreSQL로 이전할 수 있도록 설계한다.

---

## 2. Entity Relationship Overview

### 2.1 Core Entities

MVP에서 사용하는 핵심 Entity는 다음과 같다.

| Entity | Description |
|---|---|
| Inspection | 사용자가 요청한 웹사이트 검사 작업 |
| Inspection Viewport | Inspection 내 개별 Viewport 검사 실행 결과 |
| Issue | 특정 Viewport에서 탐지된 UI 문제 |
| Evidence | Issue의 근거가 되는 실제 측정 데이터 |
| AI Analysis | Issue에 대한 AI 원인 분석 및 수정 제안 |
| Development Task | 관련 Issue를 그룹화한 개발 작업 |
| Development Task Issue | Development Task와 Issue의 연결 정보 |
| Prompt | 코딩 에이전트에 전달하기 위한 개발 프롬프트 |
| File Cleanup Job | 삭제 대상 Screenshot 파일의 정리 작업 |

### 2.2 Entity Relationship

```text
Inspection
    |
    | 1:N
    |
InspectionViewport
    |
    | 1:N
    |
   Issue
    |
    +------ 1:N ------ Evidence
    |
    +------ 1:N ------ AIAnalysis

Inspection
    |
    | 1:N
    |
DevelopmentTask
    |
    | 1:N
    |
DevelopmentTaskIssue
    |
    | N:1
    |
   Issue

DevelopmentTask
    |
    | 1:N
    |
   Prompt

FileCleanupJob
    |
    +------ File Paths
```

### 2.3 Relationship Rules

- 하나의 Inspection은 여러 Inspection Viewport를 가질 수 있다.
- 하나의 Inspection Viewport는 여러 Issue를 생성할 수 있다.
- 하나의 Issue는 여러 Evidence를 가질 수 있다.
- 하나의 Issue는 여러 AI Analysis 이력을 가질 수 있다.
- 하나의 Development Task는 여러 Issue를 포함할 수 있다.
- MVP에서는 하나의 Issue가 최대 하나의 Development Task에만 연결되도록 한다.
- 하나의 Development Task는 여러 Prompt 버전을 가질 수 있다.
- 하나의 Inspection은 여러 Development Task를 생성할 수 있다.
- 하나의 Inspection에서 생성된 Issue만 해당 Inspection의 Development Task에 연결할 수 있다.

### 2.4 Viewport Issue Management

MVP에서는 동일한 문제가 여러 Viewport에서 발견되더라도 각각 별도의 Issue로 저장한다.

예를 들어 동일한 버튼에서 Desktop과 Mobile 모두 Text Overflow가 발생하면 다음과 같이 저장한다.

```text
Inspection A
    |
    +-- Desktop Viewport
    |       |
    |       +-- Issue 1: Text Overflow
    |
    +-- Mobile Viewport
            |
            +-- Issue 2: Text Overflow
```

두 Issue는 동일한 DOM Selector를 가질 수 있지만, 서로 다른 Viewport에서 발생한 독립적인 검사 결과다.

이 구조를 통해 다음 데이터를 정확하게 관리할 수 있다.

- Viewport별 Issue 수
- Viewport별 Priority
- Viewport별 Evidence
- Desktop과 Mobile 간 검사 결과 비교

향후 동일한 문제를 하나의 그룹으로 표현하는 기능은 별도의 Issue Grouping 기능으로 확장한다.

---

## 3. Database Schema

### 3.1 Inspections

Inspection은 사용자가 요청한 웹사이트 검사 작업을 나타낸다.

검사 대상 URL, 전체 검사 상태, 검사 환경 및 실행 시간을 관리한다.

**Table: `inspections`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Inspection 고유 ID |
| url | TEXT | No | 사용자가 입력한 원본 URL |
| normalizedUrl | TEXT | No | 정규화된 URL |
| status | TEXT | No | 전체 검사 상태 |
| browserName | TEXT | No | 사용한 Browser |
| browserVersion | TEXT | Yes | Browser 버전 |
| engineVersion | TEXT | No | Inspection Engine Version |
| ruleSetVersion | TEXT | No | Rule Set Version |
| priorityRuleVersion | TEXT | No | Priority 계산 공식 버전 |
| startedAt | INTEGER | Yes | 검사 시작 시간 |
| completedAt | INTEGER | Yes | 검사 완료 시간 |
| errorCode | TEXT | Yes | 전체 검사 실패 시 오류 코드 |
| errorMessage | TEXT | Yes | 전체 검사 실패 시 오류 메시지 |
| createdAt | INTEGER | No | 생성 시간 |
| updatedAt | INTEGER | No | 수정 시간 |

**Status Definition**

| Status | Description |
|---|---|
| pending | 검사 요청 생성 및 대기 |
| running | 검사 진행 중 |
| completed | 모든 Viewport 검사 완료 |
| partially_completed | 일부 Viewport 검사 성공 |
| failed | 모든 Viewport 검사 실패 또는 검사 실행 불가 |
| cancelled | 검사 취소 |

**Requirements:**

- URL은 HTTP 또는 HTTPS만 허용한다.
- `normalizedUrl`은 URL 정규화 규칙에 따라 생성한다.
- URL 정규화 시 Query Parameter 및 Path를 임의로 제거하지 않는다. 실제로 다른 페이지를 가리킬 수 있기 때문이다.
- Browser와 Inspection Engine의 버전을 기록하여 검사 결과를 재현할 수 있도록 한다.
- `ruleSetVersion`은 검사에 사용된 탐지 규칙 버전을 기록한다.
- `priorityRuleVersion`은 Priority 계산 기준의 변경을 추적한다.
- 검사 시작 및 완료 시간은 UTC Unix Timestamp의 Millisecond 단위로 저장한다.
- 전체 Inspection 상태는 하위 Inspection Viewport의 상태를 기준으로 계산한다.
- 부분 성공을 `completed`로 처리하지 않는다.

### 3.2 Inspection Viewports

Inspection Viewport는 하나의 Inspection에서 실행되는 개별 Viewport 검사를 나타낸다.

Desktop과 Mobile 검사를 독립적으로 실행하고, 각 검사 결과 및 Screenshot을 관리한다.

**Table: `inspection_viewports`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Viewport 검사 고유 ID |
| inspectionId | TEXT (UUID) | No | 연결된 Inspection ID |
| name | TEXT | No | Viewport 이름 |
| width | INTEGER | No | Viewport 너비 |
| height | INTEGER | No | Viewport 높이 |
| status | TEXT | No | 개별 검사 상태 |
| finalUrl | TEXT | Yes | Redirect 이후 최종 URL |
| screenshotPath | TEXT | Yes | 전체 Screenshot 저장 경로 |
| errorCode | TEXT | Yes | 개별 오류 코드 |
| errorMessage | TEXT | Yes | 개별 오류 메시지 |
| startedAt | INTEGER | Yes | 검사 시작 시간 |
| completedAt | INTEGER | Yes | 검사 완료 시간 |
| createdAt | INTEGER | No | 생성 시간 |
| updatedAt | INTEGER | No | 수정 시간 |

**Status Definition**

| Status | Description |
|---|---|
| pending | Viewport 검사 대기 |
| running | Viewport 검사 진행 중 |
| completed | Viewport 검사 완료 |
| failed | Viewport 검사 실패 |
| cancelled | Viewport 검사 취소 |

**Example Data**

```json
[
  {
    "name": "desktop",
    "width": 1440,
    "height": 900,
    "status": "completed"
  },
  {
    "name": "mobile",
    "width": 390,
    "height": 844,
    "status": "failed"
  }
]
```

위 데이터는 하나의 Inspection에 연결된 두 개의 `inspection_viewports` 레코드에 해당한다.

**Requirements:**

- 하나의 Inspection 내에서 동일한 Viewport 설정이 중복 생성되지 않도록 한다.
- `width`, `height`는 양의 정수여야 한다.
- Viewport 검사 상태는 정의된 Status 값만 허용한다.
- Screenshot 경로는 서버에서 관리하는 저장 경로만 허용한다.
- Redirect 이후 URL을 `finalUrl`에 기록한다.
- Viewport 검사는 서로 독립적으로 성공하거나 실패할 수 있어야 한다.
- Viewport 검사 실패가 다른 Viewport의 결과를 삭제하거나 변경해서는 안 된다.
- 하나의 Inspection에서 같은 Viewport 검사를 중복 실행하지 않도록 실행 단계를 관리한다.

**Unique Constraint:**

```text
UNIQUE(inspectionId, name)
```

초기 MVP에서는 Desktop과 Mobile을 지원하며, 향후 Tablet 및 Custom Viewport를 추가할 수 있다.

### 3.3 Issues

Issue는 특정 Inspection Viewport에서 탐지된 UI 문제를 나타낸다.

문제 유형, 발생 위치, 심각도, 신뢰도 및 처리 상태를 관리한다.

**Table: `issues`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Issue 고유 ID |
| inspectionId | TEXT (UUID) | No | 연결된 Inspection ID |
| inspectionViewportId | TEXT (UUID) | No | 연결된 Viewport 검사 ID |
| type | TEXT | No | UI 문제 유형 |
| title | TEXT | No | Issue 제목 |
| description | TEXT | No | 문제 설명 |
| selector | TEXT | Yes | 대상 DOM Selector |
| ruleId | TEXT | No | 탐지 규칙 ID |
| severity | INTEGER | No | 심각도 점수 (1~5) |
| impact | INTEGER | No | 사용자 영향 점수 (1~5) |
| reach | INTEGER | No | 영향 범위 점수 (1~5) |
| confidence | REAL | No | 탐지 신뢰도 (0~1) |
| priorityScore | REAL | No | 계산된 Priority Score |
| priority | TEXT | No | 최종 Priority |
| priorityRuleVersion | TEXT | No | Priority 계산 공식 버전 |
| status | TEXT | No | Issue 처리 상태 |
| createdAt | INTEGER | No | 생성 시간 |
| updatedAt | INTEGER | No | 수정 시간 |

**Issue Type Definition**

| Type | Description |
|---|---|
| text_overflow | 텍스트 영역이 컨테이너를 초과하는 문제 |
| element_overlap | UI 요소끼리 겹치는 문제 |
| viewport_overflow | 요소가 Viewport 경계를 벗어나는 문제 |

`type`은 초기 MVP에서 위 세 가지 유형을 사용하며, 향후 새로운 탐지 유형을 추가할 수 있도록 설계한다.

**Priority Definition**

| Priority | Description |
|---|---|
| P0 | 즉시 수정이 필요한 치명적인 문제 |
| P1 | 높은 우선순위로 수정해야 하는 문제 |
| P2 | 일반적인 수정 대상 |
| P3 | 낮은 우선순위의 개선 대상 |

**Issue Status Definition**

| Status | Description |
|---|---|
| open | 발견된 문제 |
| in_progress | 수정 진행 중 |
| resolved | 해결된 문제 |
| ignored | 의도된 동작 또는 수정하지 않을 문제 |

**Requirements:**

- Issue는 반드시 하나의 Inspection 및 Inspection Viewport에 속해야 한다.
- `inspectionId`와 `inspectionViewportId`는 서로 일치해야 한다.
- `severity`, `impact`, `reach`는 1~5 범위의 정수만 허용한다.
- `confidence`는 0~1 범위의 실수만 허용한다.
- `priorityScore`는 정의된 Priority 계산 공식으로 생성한다.
- `priorityRuleVersion`은 해당 Issue의 Priority 계산에 사용된 공식 버전을 기록한다.
- `ruleId`는 어떤 탐지 규칙으로 생성되었는지 추적하기 위한 식별자다.
- Issue의 실제 측정 근거는 Evidence Entity에 저장한다.
- AI Analysis는 Issue의 원본 탐지 데이터와 Priority를 임의로 변경할 수 없다.
- Issue는 검사 결과의 원본 데이터이므로 생성 후 탐지 사실 자체를 수정하지 않는다.
- 사용자가 변경할 수 있는 `status`는 탐지 결과와 독립적으로 관리한다.

**Priority Calculation**

초기 Priority 계산 공식은 다음과 같다.

\[
PriorityScore = (S \times 0.35 + I \times 0.35 + R \times 0.30) \times C
\]

- S: Severity
- I: Impact
- R: Reach
- C: Confidence

초기 Priority 구간:

| Score | Priority |
|---|---|
| 4.0 이상 | P0 |
| 3.0 이상 4.0 미만 | P1 |
| 2.0 이상 3.0 미만 | P2 |
| 2.0 미만 | P3 |

Confidence가 낮은 Issue가 P0로 승격되지 않도록 별도의 제한 규칙을 적용한다.

Priority 계산 및 제한 규칙은 Detection Guide의 정의를 단일 기준으로 사용한다. 점수 계산 로직을 변경하면 새로운 `priorityRuleVersion`을 부여한다.

### 3.4 Evidence

Evidence는 Issue가 실제로 존재한다는 것을 뒷받침하는 측정 데이터다.

검사 시점의 DOM 위치, 크기, CSS 정보 및 관련 Screenshot을 저장한다.

Issue Type과 Evidence Type은 서로 다른 개념으로 관리한다.

하나의 Issue는 여러 종류의 Evidence를 가질 수 있다.

**Table: `evidences`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Evidence 고유 ID |
| issueId | TEXT (UUID) | No | 연결된 Issue ID |
| type | TEXT | No | Evidence 유형 |
| boundingBox | TEXT (JSON) | Yes | 대상 요소의 위치 및 크기 |
| measurements | TEXT (JSON) | No | 실제 측정값 |
| computedStyles | TEXT (JSON) | Yes | 관련 Computed CSS |
| domContext | TEXT (JSON) | Yes | DOM 구조 및 주변 요소 정보 |
| screenshotCropPath | TEXT | Yes | 요소 주변 Crop 이미지 경로 |
| createdAt | INTEGER | No | 생성 시간 |

Viewport 너비와 높이는 연결된 Issue의 Inspection Viewport를 통해 조회한다. 중복 저장으로 인한 데이터 불일치를 방지하기 위해 Evidence에 별도로 저장하지 않는다.

**Evidence Type Definition**

| Type | Description |
|---|---|
| element_bounds | 요소의 위치 및 크기 |
| text_metrics | 텍스트 영역 측정값 |
| overlap_geometry | 요소 간 겹침 측정값 |
| viewport_bounds | Viewport 경계 측정값 |
| computed_styles | 관련 CSS 정보 |
| dom_context | DOM 구조 및 주변 요소 |
| screenshot | 시각적 증거 |

**Bounding Box Structure**

```json
{
  "x": 120,
  "y": 240,
  "width": 320,
  "height": 48,
  "top": 240,
  "right": 440,
  "bottom": 288,
  "left": 120
}
```

Bounding Box는 CSS Pixel 기준의 요소 위치와 크기를 나타낸다.

**Text Metrics Structure**

```json
{
  "scrollWidth": 420,
  "clientWidth": 320,
  "scrollHeight": 48,
  "clientHeight": 48,
  "overflowX": 100,
  "overflowY": 0
}
```

**Overlap Geometry Structure**

```json
{
  "overlapArea": 2400,
  "overlapRatio": 0.35,
  "intersection": {
    "x": 180,
    "y": 260,
    "width": 80,
    "height": 30
  },
  "targetElement": {
    "selector": ".primary-button",
    "width": 160,
    "height": 48
  },
  "overlappingElement": {
    "selector": ".floating-banner",
    "width": 240,
    "height": 80
  }
}
```

**Viewport Bounds Structure**

```json
{
  "viewportWidth": 390,
  "elementLeft": 350,
  "elementRight": 430,
  "overflowLeft": 0,
  "overflowRight": 40
}
```

**Computed Styles Structure**

```json
{
  "position": "absolute",
  "display": "block",
  "overflow": "hidden",
  "overflowX": "hidden",
  "overflowY": "visible",
  "zIndex": "10",
  "whiteSpace": "nowrap",
  "fontSize": "16px",
  "lineHeight": "24px"
}
```

**DOM Context Structure**

```json
{
  "tagName": "BUTTON",
  "selector": ".primary-button",
  "textContent": "Get Started",
  "parent": {
    "tagName": "DIV",
    "selector": ".button-container"
  },
  "siblings": [
    {
      "tagName": "SPAN",
      "selector": ".button-label"
    }
  ]
}
```

**Requirements:**

- Evidence는 Rule Engine이 수집한 실제 측정값만 저장한다.
- 하나의 Issue는 여러 Evidence를 가질 수 있다.
- Evidence는 생성 이후 원본 측정값을 변경하지 않는 것을 원칙으로 한다.
- Evidence Type에 맞는 JSON Schema를 적용한다.
- Bounding Box는 실제 DOM 측정값을 기반으로 생성한다.
- Screenshot은 데이터베이스에 직접 저장하지 않고 파일 경로를 저장한다.
- 전체 Screenshot은 Inspection Viewport에서 관리한다.
- Crop Screenshot은 Evidence에서 관리한다.
- DOM Context는 필요한 정보만 제한적으로 수집한다.
- 개인정보, 인증 정보 및 불필요하게 큰 DOM 데이터는 저장하지 않는다.

### 3.5 AI Analyses

AI Analysis는 Issue에 대한 원인 분석과 수정 제안을 저장한다.

실제 측정 데이터인 Evidence와 AI가 생성한 해석 및 제안은 반드시 분리한다.

동일한 Issue에 대해 AI 분석을 여러 번 수행할 수 있으며, 각 분석 결과는 독립적인 이력으로 보존한다.

**Table: `ai_analyses`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | AI Analysis 고유 ID |
| issueId | TEXT (UUID) | No | 연결된 Issue ID |
| status | TEXT | No | 분석 진행 상태 |
| model | TEXT | No | 사용된 AI Model |
| rootCause | TEXT | Yes | 추정 원인 |
| explanation | TEXT | Yes | 문제 설명 |
| suggestedFix | TEXT | Yes | 수정 제안 |
| fixCode | TEXT (JSON) | Yes | 선택적 코드 예시 |
| confidence | REAL | Yes | AI 분석 신뢰도 |
| rawResponse | TEXT (JSON) | Yes | 원본 AI 응답 |
| errorCode | TEXT | Yes | 분석 실패 시 오류 코드 |
| errorMessage | TEXT | Yes | 분석 실패 시 오류 메시지 |
| startedAt | INTEGER | Yes | 분석 시작 시간 |
| completedAt | INTEGER | Yes | 분석 완료 시간 |
| createdAt | INTEGER | No | 생성 시간 |

**Status Definition**

| Status | Description |
|---|---|
| pending | 분석 대기 |
| running | 분석 진행 중 |
| completed | 분석 완료 |
| failed | 분석 실패 |

**Analysis Result Structure**

```json
{
  "rootCause": "The fixed width of the container prevents the text from wrapping.",
  "explanation": "The text content exceeds the available container width.",
  "suggestedFix": "Allow the text container to shrink or wrap its content.",
  "fixCode": {
    "language": "css",
    "code": ".text-container {\n  min-width: 0;\n  overflow-wrap: break-word;\n}"
  },
  "confidence": 0.92
}
```

**Requirements:**

- AI Analysis는 반드시 하나의 Issue와 연결한다.
- 하나의 Issue는 여러 AI Analysis를 가질 수 있다.
- AI Analysis의 상태는 독립적으로 관리한다.
- 분석 실패 시 오류 코드와 메시지를 기록한다.
- AI 응답은 사전에 정의된 Zod Schema를 통해 검증한다.
- AI가 Issue ID, Selector, Evidence의 실제 측정값을 임의로 변경할 수 없어야 한다.
- AI Analysis는 원본 Issue 및 Evidence 데이터를 수정할 수 없다.
- AI 분석 이력은 덮어쓰지 않는다.
- 최신 분석 결과는 `createdAt` 내림차순과 `id`를 보조 정렬 기준으로 조회한다.
- `completed` 상태가 아닌 분석 결과는 정상적인 분석 결과로 취급하지 않는다.

### 3.6 Development Tasks

Development Task는 하나 이상의 관련 Issue를 그룹화한 개발 작업이다.

개별 Issue를 단순히 나열하는 대신, 실제 개발자가 하나의 작업 단위로 이해하고 수정할 수 있도록 관리한다.

**Table: `development_tasks`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Task 고유 ID |
| inspectionId | TEXT (UUID) | No | 연결된 Inspection ID |
| title | TEXT | No | 개발 작업 제목 |
| description | TEXT | No | 작업 설명 |
| priority | TEXT | No | 작업 우선순위 |
| status | TEXT | No | 작업 진행 상태 |
| createdAt | INTEGER | No | 생성 시간 |
| updatedAt | INTEGER | No | 수정 시간 |

**Task Status Definition**

| Status | Description |
|---|---|
| open | 생성된 작업 |
| in_progress | 작업 진행 중 |
| completed | 작업 완료 |
| dismissed | 작업 취소 또는 제외 |

**Requirements:**

- 하나의 Task는 하나 이상의 Issue를 포함할 수 있다.
- Task는 동일 Inspection에 속한 Issue만 그룹화한다.
- Task Priority는 포함된 Issue의 Priority를 기준으로 결정한다.
- Task의 수정 상태와 개별 Issue의 상태는 독립적으로 관리한다.
- Task 생성 시 연결할 Issue가 최소 하나 이상 존재해야 한다.
- Task에 연결된 Issue의 Inspection이 Task의 Inspection과 일치해야 한다.
- Task 생성 및 Issue 연결은 하나의 Database Transaction으로 처리한다.

**Task Priority Rule**

초기 MVP에서는 포함된 Issue 중 가장 높은 우선순위를 Task의 우선순위로 사용한다.

예를 들어 P1, P2, P3 Issue가 하나의 Task에 포함되어 있다면 Task Priority는 P1이다.

### 3.7 Development Task Issues

Development Task와 Issue 사이의 관계를 관리하는 연결 테이블이다.

MVP에서는 하나의 Issue가 동시에 여러 Development Task에 포함되지 않도록 제한한다.

**Table: `development_task_issues`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | 연결 데이터 고유 ID |
| taskId | TEXT (UUID) | No | Development Task ID |
| issueId | TEXT (UUID) | No | Issue ID |
| inspectionId | TEXT (UUID) | No | 공통 Inspection ID |
| createdAt | INTEGER | No | 연결 시간 |

`inspectionId`는 Task와 Issue가 동일한 Inspection에 속하는지 데이터베이스 수준에서 검증하기 위한 필드다.

**Constraints:**

- `taskId`와 `issueId` 조합은 중복될 수 없다.
- 하나의 Issue는 하나의 Task에만 연결할 수 있다.
- `issueId`에는 Unique Constraint를 적용한다.
- `taskId`와 `inspectionId`는 Development Task의 조합을 참조한다.
- `issueId`와 `inspectionId`는 Issue의 조합을 참조한다.
- Task와 Issue의 Inspection이 일치하지 않으면 저장할 수 없어야 한다.

**Composite Foreign Key Strategy**

다음과 같은 복합 참조를 사용한다.

```text
development_tasks:
  UNIQUE(id, inspectionId)

issues:
  UNIQUE(id, inspectionId)

development_task_issues:
  FOREIGN KEY(taskId, inspectionId)
    REFERENCES development_tasks(id, inspectionId)

  FOREIGN KEY(issueId, inspectionId)
    REFERENCES issues(id, inspectionId)

  UNIQUE(issueId)
```

이 구조를 통해 애플리케이션의 검증 실수와 관계없이 서로 다른 Inspection에 속한 Task와 Issue가 연결되는 것을 방지한다.

### 3.8 Prompts

Prompt는 Development Task를 코딩 에이전트에 전달하기 위한 실행 가능한 개발 지시문이다.

하나의 Task에서 여러 버전의 Prompt를 생성할 수 있도록 관리한다.

**Table: `prompts`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Prompt 고유 ID |
| taskId | TEXT (UUID) | No | 연결된 Development Task ID |
| version | INTEGER | No | Prompt 버전 |
| targetAgent | TEXT | Yes | 대상 코딩 에이전트 |
| templateVersion | TEXT | No | Prompt Template Version |
| content | TEXT | No | 생성된 Prompt 내용 |
| createdAt | INTEGER | No | 생성 시간 |

**Target Agent Definition**

| Value | Description |
|---|---|
| codex | OpenAI Codex |
| claude_code | Claude Code |
| generic | 특정 에이전트에 종속되지 않는 일반 Prompt |

**Requirements:**

- Prompt는 반드시 하나의 Development Task에 연결한다.
- 같은 Task에서 Prompt를 다시 생성하면 새로운 버전으로 저장한다.
- `version`은 Task별로 1부터 순차 증가한다.
- `(taskId, version)` 조합에 Unique Constraint를 적용한다.
- Prompt Template이 변경되면 `templateVersion`을 갱신한다.
- 기존 Prompt는 덮어쓰지 않는다.
- Prompt에는 관련 Issue 및 Evidence를 참조할 수 있는 정보가 포함되어야 한다.
- Prompt 생성 결과는 사용자가 복사하여 외부 코딩 에이전트에 전달할 수 있어야 한다.

Prompt 생성 시 Task와 연결된 Issue 및 Evidence를 조회하여 내용을 구성한다. Prompt 자체에는 생성 당시의 완성된 지시문을 저장하여 이후 원본 데이터가 변경되더라도 기존 Prompt 내용을 재현할 수 있도록 한다.

### 3.9 File Cleanup Jobs

Screenshot 및 Crop 이미지 파일은 데이터베이스 외부에 저장한다.

Inspection 삭제 시 DB 레코드와 파일 시스템의 데이터가 서로 다른 Transaction에 속하기 때문에, DB 삭제와 파일 삭제를 별도로 관리해야 한다.

**Table: `file_cleanup_jobs`**

| Field | Type | Nullable | Description |
|---|---|---|---|
| id | TEXT (UUID) | No | Cleanup Job 고유 ID |
| paths | TEXT (JSON) | No | 삭제 대상 파일 경로 목록 |
| status | TEXT | No | 정리 작업 상태 |
| attempts | INTEGER | No | 실행 시도 횟수 |
| errorMessage | TEXT | Yes | 마지막 실패 메시지 |
| createdAt | INTEGER | No | 생성 시간 |
| completedAt | INTEGER | Yes | 완료 시간 |

**Status Definition**

| Status | Description |
|---|---|
| pending | 파일 삭제 대기 |
| running | 파일 삭제 진행 중 |
| completed | 파일 삭제 완료 |
| failed | 파일 삭제 실패 |

**Requirements:**

- 파일 삭제 대상은 서버가 관리하는 Storage 경로만 허용한다.
- 사용자 입력값을 파일 시스템 경로로 직접 사용하지 않는다.
- Inspection 삭제 시 관련 파일 경로를 먼저 수집한다.
- Cleanup Job 생성과 DB 레코드 삭제는 하나의 Transaction으로 처리한다.
- Transaction이 실패하면 Inspection과 관련 데이터가 삭제되지 않아야 한다.
- DB Transaction이 성공한 이후 별도 Cleanup Worker가 파일 삭제를 수행한다.
- 파일 삭제 실패 시 재시도할 수 있어야 한다.
- 이미 삭제된 파일에 대한 삭제 요청은 성공으로 처리할 수 있어야 한다.

초기 MVP에서는 동일 Next.js 프로젝트 내에서 Cleanup Worker를 구현할 수 있다. 향후 별도 Worker로 분리할 수 있도록 작업 상태와 재시도 구조를 유지한다.

---

## 4. Data Type & Enum Definition

### 4.1 Primary Key

모든 핵심 Entity는 UUID를 Primary Key로 사용한다.

SQLite에서는 UUID를 TEXT 형식으로 저장한다.

Example:

```text
550e8400-e29b-41d4-a716-446655440000
```

UUID는 애플리케이션 레이어에서 생성한다.

### 4.2 Timestamp

모든 날짜 및 시간 데이터는 UTC Unix Timestamp를 사용한다.

SQLite에서는 INTEGER로 저장하며 Millisecond 단위로 통일한다.

TypeScript 예시:

```ts
const now = Date.now();
```

**Requirements:**

- 모든 Timestamp는 Millisecond 단위로 통일한다.
- UTC 기준으로 저장한다.
- 사용자에게 표시할 때만 사용자의 시간대로 변환한다.
- DB 및 API 사이에서 초 단위와 밀리초 단위를 혼용하지 않는다.

### 4.3 JSON Storage

구조가 유동적이거나 Entity 유형에 따라 달라지는 데이터는 JSON 형태로 저장한다.

주요 대상:

- Bounding Box
- Measurements
- Computed Styles
- DOM Context
- AI Raw Response
- AI Fix Code
- File Cleanup Paths

**Requirements:**

- JSON 데이터는 저장 전 Zod Schema로 검증한다.
- 필수 필드와 데이터 타입을 명확히 정의한다.
- 유효하지 않은 JSON은 저장하지 않는다.
- JSON 내부의 필드 구조를 변경할 때는 Schema Version 관리가 필요한지 검토한다.
- 검색 및 필터링이 필요한 핵심 데이터는 JSON 내부에만 저장하지 않고 별도 컬럼으로 관리한다.

### 4.4 Enum Management

Status, Priority, Issue Type 등은 TypeScript에서 공통 상수로 관리한다.

```ts
export const INSPECTION_STATUSES = [
  "pending",
  "running",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;

export const VIEWPORT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;

export const ISSUE_TYPES = [
  "text_overflow",
  "element_overlap",
  "viewport_overflow",
] as const;

export const EVIDENCE_TYPES = [
  "element_bounds",
  "text_metrics",
  "overlap_geometry",
  "viewport_bounds",
  "computed_styles",
  "dom_context",
  "screenshot",
] as const;

export const ISSUE_PRIORITIES = [
  "P0",
  "P1",
  "P2",
  "P3",
] as const;

export const ISSUE_STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "ignored",
] as const;

export const AI_ANALYSIS_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "completed",
  "dismissed",
] as const;

export const CLEANUP_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;
```

Database에는 TEXT로 저장하고 애플리케이션 레이어에서 허용된 값인지 검증한다.

DB Check Constraint도 함께 적용하여 잘못된 Status 값이 저장되는 것을 방지한다.

### 4.5 TypeScript Domain Types

다음은 핵심 Domain Type의 예시다.

```ts
export interface ViewportConfig {
  name: "desktop" | "mobile";
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type EvidenceMeasurements =
  | {
      type: "text_metrics";
      scrollWidth: number;
      clientWidth: number;
      overflowX: number;
      scrollHeight: number;
      clientHeight: number;
      overflowY: number;
    }
  | {
      type: "overlap_geometry";
      overlapArea: number;
      overlapRatio: number;
      intersection: BoundingBox;
    }
  | {
      type: "viewport_bounds";
      viewportWidth: number;
      elementLeft: number;
      elementRight: number;
      overflowLeft: number;
      overflowRight: number;
    };

export interface AIAnalysisResult {
  rootCause: string;
  explanation: string;
  suggestedFix: string;
  fixCode?: {
    language: string;
    code: string;
  };
  confidence?: number;
}
```

실제 구현에서는 Evidence Type별로 더 구체적인 Zod Schema를 정의하고, 해당 Schema를 기준으로 TypeScript 타입을 추론하는 방식을 권장한다.

예를 들어 `EvidenceMeasurements`의 각 Variant는 별도 Zod Schema로 정의하고 Discriminated Union으로 결합한다.

---

## 5. Data Validation & Constraints

### 5.1 Inspection Validation

- URL은 유효한 HTTP 또는 HTTPS URL이어야 한다.
- URL 길이와 입력 크기에 제한을 둔다.
- URL의 Host는 SSRF 방어 정책을 통과해야 한다.
- Redirect 과정에서도 허용되지 않은 Host 또는 IP로 이동하지 못하도록 검증한다.
- Viewport 너비와 높이는 양의 정수여야 한다.
- 지원하지 않는 Viewport 설정은 거부한다.
- Inspection 상태는 정의된 값만 허용한다.
- Browser 및 Rule Set Version은 검사 시작 시점의 값을 기록한다.

### 5.2 Inspection Viewport Validation

- 반드시 하나의 Inspection에 속해야 한다.
- Viewport 크기는 허용된 범위 내의 양의 정수여야 한다.
- 동일 Inspection 내 중복 Viewport 설정을 방지한다.
- 완료된 Viewport 검사는 원본 실행 결과를 덮어쓰지 않는다.
- 검사 실패 시 오류 정보를 기록한다.

### 5.3 Issue Validation

- Issue는 반드시 유효한 Inspection과 Inspection Viewport를 참조해야 한다.
- `inspectionId`와 `inspectionViewportId`는 동일한 Inspection에 속해야 한다.
- Severity, Impact, Reach는 1~5 범위여야 한다.
- Confidence는 0~1 범위여야 한다.
- Priority는 계산된 Priority Score 및 제한 규칙을 기준으로 생성한다.
- Selector는 없을 수 있으므로 Nullable로 관리한다.
- Rule ID는 해당 검사에 사용된 Rule Set에서 정의된 규칙이어야 한다.

### 5.4 Evidence Validation

- Evidence는 반드시 유효한 Issue ID를 참조해야 한다.
- Evidence Type에 따라 필요한 Measurements 구조가 달라진다.
- Bounding Box의 좌표와 크기는 유효한 숫자여야 한다.
- Width와 Height는 음수가 될 수 없다.
- Overlap Ratio는 0~1 범위로 제한한다.
- Screenshot 경로는 서버에서 관리하는 저장 경로만 허용한다.
- Evidence는 생성된 검사 결과의 원본 데이터로 취급한다.

### 5.5 AI Analysis Validation

- AI Analysis는 반드시 유효한 Issue ID를 참조해야 한다.
- AI 응답은 사전에 정의한 Schema를 통과해야 한다.
- 필수 필드가 누락된 응답은 완료된 분석으로 저장하지 않는다.
- AI 응답에 포함된 Selector와 측정값은 원본 Evidence와 별도로 검증한다.
- AI 분석 결과는 원본 Inspection 데이터를 수정할 수 없다.
- 분석 실패 시 오류 정보를 기록하고 재실행할 수 있어야 한다.

### 5.6 Development Task Validation

- Task는 반드시 하나의 Inspection에 속해야 한다.
- Task에는 동일 Inspection에 속한 Issue만 연결할 수 있다.
- Task 생성과 Issue 연결은 하나의 Transaction으로 처리한다.
- Issue는 동시에 여러 Task에 연결할 수 없다.
- Task Priority는 연결된 Issue의 Priority를 기준으로 계산한다.

### 5.7 SQLite Integrity Requirements

SQLite의 데이터 무결성을 유지하기 위해 다음 설정을 필수 적용한다.

**Foreign Key Enforcement**

SQLite 연결마다 Foreign Key 제약이 활성화되어 있어야 한다.

```sql
PRAGMA foreign_keys = ON;
```

Drizzle ORM의 SQLite 연결 설정에서도 Foreign Key Enforcement가 실제로 적용되는지 확인한다.

**Transaction**

다음 작업은 Transaction으로 처리한다.

- Inspection 생성과 Viewport 레코드 생성
- Issue와 Evidence 저장
- Development Task 생성과 Issue 연결
- Prompt 버전 생성
- Inspection 삭제와 File Cleanup Job 생성

**Check Constraints**

다음 조건은 DB Check Constraint와 애플리케이션 검증을 함께 사용한다.

- Severity, Impact, Reach 범위
- Confidence 범위
- Viewport 크기
- Priority 값
- Status 값
- Prompt Version 양수 여부

SQLite는 일부 데이터 타입의 선언만으로 실제 값의 타입이나 범위를 강제하지 않으므로, Check Constraint와 Zod Validation을 함께 적용한다.

---

## 6. Index Strategy

데이터 조회 성능을 위해 다음 인덱스를 생성한다.

| Table | Index | Purpose |
|---|---|---|
| inspections | status | 진행 중인 검사 조회 |
| inspections | createdAt | 최근 검사 목록 정렬 |
| inspection_viewports | inspectionId | Inspection별 Viewport 조회 |
| inspection_viewports | status | Viewport 상태 조회 |
| issues | inspectionId | 특정 Inspection 결과 조회 |
| issues | inspectionViewportId | Viewport별 Issue 조회 |
| issues | priority | 우선순위별 문제 필터링 |
| issues | status | 문제 처리 상태 조회 |
| evidences | issueId | Issue별 Evidence 조회 |
| ai_analyses | issueId, createdAt | 최신 AI 분석 조회 |
| development_tasks | inspectionId | 검사별 개발 작업 조회 |
| development_task_issues | taskId | Task에 포함된 Issue 조회 |
| prompts | taskId, version | Task별 Prompt 버전 조회 |
| file_cleanup_jobs | status, createdAt | 대기 중인 파일 정리 작업 조회 |

**Unique Constraints:**

- `inspection_viewports(inspectionId, name)`
- `issues(id, inspectionId)`
- `development_tasks(id, inspectionId)`
- `development_task_issues(issueId)`
- `development_task_issues(taskId, issueId)`
- `prompts(taskId, version)`

Composite Foreign Key를 위해 `issues(id, inspectionId)`와 `development_tasks(id, inspectionId)`의 복합 Unique Constraint를 유지한다.

추가로 SQLite에서는 Foreign Key 참조 대상 컬럼의 조합이 Unique 또는 Primary Key로 정의되어 있어야 한다.

---

## 7. Data Lifecycle

### 7.1 Inspection Lifecycle

```text
Create Inspection
       |
       v
     Pending
       |
       v
     Running
       |
       v
Create Viewport Records
       |
       +----------------------+
       |                      |
       v                      v
Desktop Inspection     Mobile Inspection
       |                      |
       v                      v
Issue & Evidence       Issue & Evidence
Generation             Generation
       |                      |
       +----------+-----------+
                  |
                  v
       Aggregate Viewport Status
                  |
          +-------+-------+
          |       |       |
          v       v       v
       Complete Partial  Failed
          |       |       |
          +-------+-------+
                  |
                  v
       Inspection Result
                  |
                  v
          AI Analysis
                  |
                  v
       Development Task
                  |
                  v
          Prompt Creation
```

### 7.2 Inspection Status Aggregation

Inspection의 전체 상태는 하위 Viewport의 상태를 기준으로 계산한다.

| Viewport Results | Inspection Status |
|---|---|
| 모든 Viewport가 pending | pending |
| 하나 이상 running | running |
| 모든 Viewport가 completed | completed |
| completed와 failed가 함께 존재 | partially_completed |
| 모든 Viewport가 failed | failed |
| 사용자가 취소하여 전체 중단 | cancelled |

Viewport가 하나라도 성공하면 부분 검사 결과를 보존한다.

검사 중 일부 Viewport가 실패해도 성공한 Viewport의 Issue와 Evidence는 유지한다.

취소 요청이 들어오면 실행 중인 Browser 작업을 중단하고, 각 Viewport의 최종 상태를 반영한다.

### 7.3 Data Creation Order

데이터는 다음 순서로 생성한다.

1. Inspection 생성
2. Inspection Viewport 레코드 생성
3. Inspection 상태를 running으로 변경
4. Viewport별 Playwright 검사 및 Screenshot 생성
5. Rule Engine을 통한 Issue 탐지
6. Issue 및 Evidence 저장
7. 각 Viewport의 완료 또는 실패 상태 저장
8. Inspection 전체 상태 집계
9. AI Analysis 생성
10. Development Task 생성
11. Task와 Issue 연결
12. Prompt 생성

AI Analysis와 Prompt 생성은 검사 완료 이후 별도로 수행할 수 있도록 분리한다.

AI 분석이 실패하더라도 이미 생성된 Inspection, Issue, Evidence 데이터는 보존한다.

### 7.4 Data Immutability

다음 데이터는 생성 이후 원본을 변경하지 않는 것을 원칙으로 한다.

- 완료된 Inspection의 검사 환경 정보
- 완료된 Inspection Viewport의 실행 결과
- Issue의 탐지 결과 및 측정 기준
- Evidence의 실제 측정값
- AI Analysis 이력
- 기존 Prompt 버전

사용자가 변경할 수 있는 Issue 및 Task의 Status는 별도로 관리한다.

재검사가 필요한 경우 기존 Inspection을 수정하지 않고 새로운 Inspection을 생성한다.

### 7.5 Inspection Comparison

MVP에서는 재검사 결과를 별도의 Inspection으로 저장한다.

이전 검사와 신규 검사를 비교하는 기능은 추후 추가한다.

향후 비교 기능에서는 다음 항목을 고려한다.

- 신규 Issue
- 해결된 Issue
- 유지된 Issue
- Priority 변경
- Viewport별 변화
- Rule Set Version 차이

동일한 Selector를 사용하더라도 DOM 구조가 변경될 수 있으므로 Selector만으로 Issue가 동일하다고 판단하지 않는다.

---

## 8. Storage Strategy

### 8.1 Database Storage

다음 데이터는 SQLite에 저장한다.

- Inspection 및 Viewport 실행 정보
- Issue 및 Evidence
- AI Analysis
- Development Task 및 연결 정보
- Prompt
- File Cleanup Job

### 8.2 Screenshot Storage

Screenshot과 Crop 이미지는 데이터베이스에 직접 저장하지 않는다.

파일 시스템 또는 Object Storage에 저장하고 DB에는 경로만 보관한다.

권장 디렉터리 구조:

```text
storage/
└── inspections/
    └── {inspectionId}/
        └── {viewportId}/
            ├── screenshot.png
            └── crops/
                ├── {evidenceId}.png
                └── {evidenceId}.png
```

실제 경로는 서버 내부에서 생성하며, 사용자 입력값으로 파일 경로를 직접 구성하지 않는다.

### 8.3 Storage Requirements

- Screenshot 파일 크기에 제한을 둔다.
- 허용된 이미지 형식만 저장한다.
- 저장 경로는 서버에서 관리한다.
- 사용자에게는 직접적인 서버 파일 시스템 경로를 노출하지 않는다.
- 파일 접근은 별도의 서버 Route Handler를 통해 제어한다.
- 파일 삭제는 File Cleanup Job을 통해 수행한다.
- 파일 저장 실패 시 해당 검사 결과를 정상 완료로 처리하지 않는다.
- DB 저장 실패로 인해 고아 파일이 생성된 경우 정리할 수 있어야 한다.

### 8.4 File Cleanup Process

```text
Inspection Delete Request
          |
          v
Collect File Paths
          |
          v
Create Cleanup Job
          |
          v
Delete DB Records
          |
          v
Commit Transaction
          |
          v
Cleanup Worker
          |
          v
Delete Physical Files
          |
     +----+----+
     |         |
     v         v
 Completed   Failed
               |
               v
             Retry
```

DB Transaction이 실패하면 Cleanup Job과 DB 삭제 모두 Rollback되어야 한다.

파일 삭제는 DB Transaction 완료 이후 수행한다.

---

## 9. Drizzle ORM Implementation Guidelines

### 9.1 Schema Organization

Drizzle Schema는 Entity별로 분리하여 관리한다.

권장 구조:

```text
src/
└── server/
    └── database/
        ├── index.ts
        ├── schema/
        │   ├── inspections.ts
        │   ├── inspection-viewports.ts
        │   ├── issues.ts
        │   ├── evidences.ts
        │   ├── ai-analyses.ts
        │   ├── development-tasks.ts
        │   ├── development-task-issues.ts
        │   ├── prompts.ts
        │   ├── file-cleanup-jobs.ts
        │   └── index.ts
        └── migrations/
```

### 9.2 Schema Definition Rules

- 각 테이블은 별도 Schema 파일로 관리한다.
- Foreign Key와 Unique Constraint를 명시적으로 정의한다.
- 필요한 Composite Foreign Key를 적용한다.
- Timestamp는 공통 생성 규칙을 사용한다.
- DB Schema와 TypeScript Domain Type을 구분한다.
- JSON 데이터는 Zod Schema로 검증한다.
- Schema 변경은 Migration으로 관리한다.
- 기존 Migration 파일을 수정하지 않는다.

### 9.3 SQLite Foreign Key Configuration

Foreign Key 제약은 실제 DB 연결에서 활성화되어야 한다.

마이그레이션을 적용하는 환경과 애플리케이션이 실행되는 환경 모두에서 확인한다.

개발 환경에서 다음 명령을 실행하여 활성화 여부를 검증할 수 있다.

```sql
PRAGMA foreign_keys;
```

결과가 `1`이어야 한다.

### 9.4 Migration Requirements

데이터베이스 구조 변경은 Drizzle Migration을 통해 수행한다.

- 기존 테이블을 임의로 삭제하고 재생성하지 않는다.
- 기존 데이터가 존재하는 경우 Migration의 데이터 보존 여부를 확인한다.
- Unique Constraint 및 Foreign Key 추가 전 기존 데이터의 충돌 여부를 검사한다.
- Migration 적용 후 Foreign Key 및 Check Constraint를 검증한다.
- 테스트 환경에서 Migration을 처음부터 끝까지 재실행할 수 있어야 한다.

---

## 10. MVP Data Scope

### 10.1 Included Entities

| Entity | MVP | Description |
|---|---|---|
| Inspection | Yes | 검사 요청 및 실행 결과 |
| Inspection Viewport | Yes | Viewport별 검사 결과 |
| Issue | Yes | 탐지된 UI 문제 |
| Evidence | Yes | 측정 데이터 및 Screenshot |
| AI Analysis | Yes | AI 원인 분석 및 수정 제안 |
| Development Task | Yes | 관련 Issue 그룹화 |
| Development Task Issue | Yes | Task와 Issue 연결 |
| Prompt | Yes | 코딩 에이전트용 Prompt |
| File Cleanup Job | Yes | Screenshot 파일 정리 |

### 10.2 Excluded Entities

다음 Entity는 MVP에서 구현하지 않는다.

| Entity | Reason |
|---|---|
| User | 초기에는 로그인 기능을 제공하지 않음 |
| Project | 여러 웹사이트를 프로젝트 단위로 관리하는 기능은 추후 추가 |
| Team | 팀 협업 기능은 MVP 범위에서 제외 |
| Scheduled Inspection | 정기 검사 기능은 추후 추가 |
| Agent Execution | 외부 코딩 에이전트 직접 실행 기능은 MVP에서 제외 |
| Issue Group | Viewport 간 동일 문제 그룹화는 추후 추가 |
| Inspection Comparison | 이전 검사와 신규 검사 비교는 추후 추가 |

### 10.3 Future Improvements

향후 다음과 같은 Entity 및 기능을 추가할 수 있다.

**Inspection History**

- 이전 검사 결과와 최신 검사 결과 비교
- 신규 Issue 및 해결된 Issue 추적
- UI 상태 변화 기록

**Issue Grouping**

- 여러 Viewport에서 발견된 동일 문제 그룹화
- 동일 DOM 요소 및 문제 유형 기반 그룹 관리
- 그룹 단위 Priority 및 수정 상태 관리

**Issue Classification**

- Issue Category 확장
- Accessibility 문제
- Visual Hierarchy 문제
- Design Consistency 문제

**Project Management**

- 여러 URL을 하나의 Project로 관리
- 프로젝트별 Inspection History
- 프로젝트별 설정 및 검사 규칙

**Agent Integration**

- Codex 및 Claude Code 연동
- Prompt 실행 상태 관리
- 수정 결과 및 재검사 결과 연결

---

## 11. Open Questions

향후 구현 과정에서 결정해야 할 항목은 다음과 같다.

1. Screenshot을 로컬 파일 시스템에 저장할지, 초기부터 Object Storage를 사용할지 결정한다.
2. Inspection 및 Screenshot 데이터의 보존 기간을 결정한다.
3. AI Analysis를 Issue 단위로 실행할지, 여러 Issue를 묶어서 실행할지 결정한다.
4. Issue와 Development Task의 1:1 연결 제한을 향후 N:M으로 확장할 필요가 있는지 검토한다.
5. Inspection Comparison을 위해 별도의 Snapshot Entity가 필요한지 검토한다.
6. 향후 사용자 인증 기능을 추가할 때 기존 Inspection 데이터에 User ID를 연결하는 방식을 결정한다.
7. Viewport 간 동일 Issue를 그룹화할 때 어떤 기준으로 동일성을 판단할지 결정한다.

---

**Document Status:** Draft  
**Next Step:** API Specification