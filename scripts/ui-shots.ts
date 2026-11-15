// 로컬 dev 서버의 화면을 1440×900과 390×844로 찍어 .tmp/ui-shots/에 저장한다. 사람이 화면을 확인하기 위한 도구다(T11, T12).
//
// 실제 검사 없이 여러 상태를 보려고, 이 스크립트 안에서만 page.route로 GET /api/inspections/:id 응답과 스크린샷 이미지를 바꿔 끼운다.
// 운영 코드에는 mock 모드나 테스트용 분기를 두지 않는다.
//  - 진행 화면: 이 파일의 fakeInspection
//  - 결과 화면: `pnpm test:fixtures`가 만든 .tmp/fixtures-report/{ID}.inspection.json과 {ID}-{viewport}.png
//
// 실행: pnpm test:fixtures → 데모 2개 (pnpm test:fixtures --page demo/landing.html --report-only,
//       pnpm test:fixtures --page demo/canvas-only.html --report-only) → pnpm dev → pnpm ui:shots  (주소를 바꾸려면 UI_SHOTS_BASE_URL)
// 배치도 화면(schematic-*)과 시안 비교(compare-*: 시안과 같은 크기로 찍어 나란히 붙인 이미지)도 만든다. UI_SHOTS_ONLY=compare면 비교만.
// UI_SHOTS_EXTRA_DOC=<Inspection JSON 경로>를 주면 그 문서를 schematic-extra 화면으로 찍는다(production 문서 확인용. 문서는 커밋하지 않는다).
// 390px 화면에서 가로 스크롤이 생기거나 P-01 Mobile 마커 위치가 어긋나면 종료 코드 1로 끝난다.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import type { Inspection, Issue, LayoutBlock, ViewportResult } from '../src/types/inspection';

const BASE_URL = process.env.UI_SHOTS_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), '.tmp', 'ui-shots');
const FIXTURE_DIR = path.join(process.cwd(), '.tmp', 'fixtures-report');
const SHOT_PREFIX = '/__ui-shots/';
const NAVIGATION_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 15_000;
const IMAGE_TIMEOUT_MS = 10_000;
/** P-01 Mobile 마커 위치 허용 오차 (화면 px) */
const MARKER_TOLERANCE_PX = 1.5;

const SIZES = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
] as const;

// ── 진행 화면 (T11) ─────────────────────────────────────────────

function fakeInspection(id: string, overrides: Partial<Inspection>): Inspection {
  const now = Date.now();
  return {
    id,
    url: 'https://www.example.com/products/very-long-path-name/that-should-wrap-on-small-screens?utm_source=newsletter&utm_campaign=autumn',
    status: 'running',
    createdAt: new Date(now - 43_000).toISOString(),
    startedAt: new Date(now - 42_000).toISOString(),
    updatedAt: new Date(now - 1_000).toISOString(),
    viewports: { desktop: null, mobile: null },
    viewportErrors: { desktop: null, mobile: null },
    analysis: { status: 'pending', analyzedIssueCount: 0 },
    issuesDetected: 0,
    issuesTruncated: false,
    issues: [],
    tasks: [],
    ...overrides,
  };
}

const timeout = { code: 'NAVIGATION_TIMEOUT', message: '페이지를 30초 안에 불러오지 못했습니다.' } as const;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = {
  running: uuid(1),
  failed: uuid(2),
  missing: uuid(3),
  desktopFailed: uuid(4),
  p01: uuid(11),
  p03: uuid(13),
  p04: uuid(14),
  p06: uuid(16),
  analyzing: uuid(21),
  partial: uuid(22),
  empty: uuid(23),
  review: uuid(24),
  // 스크린샷 없음(SCREENSHOT_FAILED): 결과 화면과 Issue Detail 유형 4종 (T14)
  noshotP01: uuid(31),
  noshotP02: uuid(32),
  noshotP03: uuid(33),
  noshotP04: uuid(34),
  noshotP05: uuid(35),
  // 배치도 개선: 사진 + 도면, canvas 페이지, 예전 문서(layoutMap 없음), 높이 상한에 걸린 긴 페이지
  hybrid: uuid(41),
  canvas: uuid(42),
  legacy: uuid(43),
  longPage: uuid(44),
  // 글자·단어 단위로 쪼갠 텍스트와 투명 래퍼 안의 canvas (public/demo/split-text.html)
  splitText: uuid(45),
  // UI_SHOTS_EXTRA_DOC로 받은 문서
  extra: uuid(46),
};

const EXTRA_DOC = process.env.UI_SHOTS_EXTRA_DOC;

/** 시안 (docs/assets/mock). 같은 크기로 찍어 나란히 비교한다 */
const MOCK_DIR = path.join(process.cwd(), 'docs', 'assets', 'mock');
/** ui-shot 1번의 Mobile 스크린샷 높이 (첫 화면만 저장된 경우) */
const HYBRID_SHOT_HEIGHT = 844;
const HYBRID_SHOT_FILE = `demo-landing-mobile-${HYBRID_SHOT_HEIGHT}.png`;

// ── 결과 화면 (T12): Fixture 문서를 읽어 상태별로 바꾼다 ───────────────

async function fixtureDoc(fixtureId: string, id: string): Promise<Inspection> {
  const file = path.join(FIXTURE_DIR, `${fixtureId}.inspection.json`);
  const doc = JSON.parse(await readFile(file, 'utf8')) as Inspection;
  const now = Date.now();
  const at = (ms: number) => new Date(now - ms).toISOString();
  const viewports = { ...doc.viewports };
  for (const v of ['desktop', 'mobile'] as const) {
    const vr = viewports[v];
    if (vr) viewports[v] = { ...vr, screenshotUrl: `${SHOT_PREFIX}${vr.screenshotUrl}` };
  }
  return {
    ...doc,
    id,
    url: `https://fixtures.example.com${doc.url}`,
    createdAt: at(60_000),
    startedAt: at(59_000),
    updatedAt: at(5_000),
    completedAt: doc.completedAt ? at(5_000) : undefined,
    viewports,
  };
}

/** 분석 전 상태: 이슈의 분석과 태스크를 비운다 (DOMAIN_MODEL 4.3) */
function asAnalyzing(doc: Inspection): Inspection {
  return {
    ...doc,
    status: 'analyzing',
    step: 'analyzing_issues',
    completedAt: undefined,
    analysis: { status: 'running', analyzedIssueCount: 0 },
    issues: doc.issues.map((issue) => {
      const copy = { ...issue };
      delete copy.analysis;
      delete copy.analysisSkippedReason;
      return copy;
    }),
    tasks: [],
  };
}

/** Mobile 실패: Desktop occurrence만 남기고 비교 태그를 없앤다 (PRD 5.6) */
function asMobileFailed(doc: Inspection): Inspection {
  const issues = doc.issues
    .map((issue): Issue | null => {
      const occurrences = issue.occurrences.filter((o) => o.viewport === 'desktop');
      if (occurrences.length === 0) return null;
      return { ...issue, occurrences, viewports: ['desktop'], viewportTag: null };
    })
    .filter((issue): issue is Issue => issue !== null);
  return {
    ...doc,
    status: 'partial',
    viewports: { ...doc.viewports, mobile: null },
    viewportErrors: { desktop: null, mobile: timeout },
    issues,
    tasks: doc.tasks.map((task) => ({ ...task, viewportTag: null })),
  };
}

/** 스크린샷 없음(SCREENSHOT_FAILED, PRD 5.2.4): 두 viewport의 스크린샷 값과 cropRect를 비운다 */
function asNoScreenshot(doc: Inspection): Inspection {
  const viewports = { ...doc.viewports };
  for (const v of ['desktop', 'mobile'] as const) {
    const vr = viewports[v];
    if (vr) viewports[v] = { ...vr, screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false };
  }
  return { ...doc, viewports, issues: doc.issues.map((issue) => ({ ...issue, occurrences: issue.occurrences.map((o) => ({ ...o, cropRect: null })) })) };
}

/** 한 viewport만 스크린샷 없음으로 바꾼다 */
function withoutScreenshot(doc: Inspection, v: 'desktop' | 'mobile'): Inspection {
  const vr = doc.viewports[v];
  if (!vr) return doc;
  return {
    ...doc,
    viewports: { ...doc.viewports, [v]: { ...vr, screenshotUrl: null, screenshotWidth: null, screenshotHeight: null, screenshotTruncated: false } },
    issues: doc.issues.map((issue) => ({ ...issue, occurrences: issue.occurrences.map((o) => (o.viewport === v ? { ...o, cropRect: null } : o)) })),
  };
}

/**
 * ui-shot 1: Desktop 스크린샷 없음 + Mobile은 첫 화면(844px)만 저장된 경우.
 * 일부만 걸치거나 범위 밖인 cropRect는 서버 규칙(DETECTION_RULES 8.3)대로 null로 둔다.
 */
function asHybrid(doc: Inspection): Inspection {
  const noDesktop = withoutScreenshot(doc, 'desktop');
  const mobile = noDesktop.viewports.mobile;
  if (!mobile) return noDesktop;
  const height = HYBRID_SHOT_HEIGHT;
  return {
    ...noDesktop,
    viewports: { ...noDesktop.viewports, mobile: { ...mobile, screenshotUrl: `${SHOT_PREFIX}${HYBRID_SHOT_FILE}`, screenshotHeight: height, screenshotTruncated: mobile.documentHeight > height } },
    issues: noDesktop.issues.map((issue) => ({
      ...issue,
      occurrences: issue.occurrences.map((o) => (o.viewport === 'mobile' && o.cropRect && o.boundingBox.y + o.boundingBox.height > height ? { ...o, cropRect: null } : o)),
    })),
  };
}

/** ui-shot 3: layoutMap이 생기기 전에 저장된 문서 */
function asLegacy(doc: Inspection): Inspection {
  const viewports = { ...doc.viewports };
  for (const v of ['desktop', 'mobile'] as const) {
    const vr = viewports[v];
    if (!vr) continue;
    const copy: ViewportResult = { ...vr };
    delete copy.layoutMap;
    viewports[v] = copy;
  }
  return { ...doc, viewports };
}

/** ui-shot 4: Desktop 문서 높이가 도면 상한(10,000px)을 넘는 긴 페이지. 데모 페이지의 블록을 아래로 반복해 만든다 */
function asLongPage(doc: Inspection): Inspection {
  const base = withoutScreenshot(doc, 'desktop');
  const desktop = base.viewports.desktop;
  const map = desktop?.layoutMap;
  if (!desktop || !map) return base;
  const limit = 10_000;
  const blocks: LayoutBlock[] = [];
  for (let offset = 0; offset < limit && blocks.length < 400; offset += map.height) {
    for (const b of map.blocks) {
      const y = b.rect.y + offset;
      if (y >= limit || blocks.length >= 400) continue;
      blocks.push({ ...b, rect: { ...b.rect, y, height: Math.min(b.rect.height, limit - y) } });
    }
  }
  return {
    ...base,
    viewports: { ...base.viewports, desktop: { ...desktop, documentHeight: 14_000, layoutMap: { ...map, height: limit, truncated: true, blocks } } },
  };
}

/** Needs Review 그룹 확인용: 대표 이슈를 복제해 검토 필요 이슈와 태스크를 하나씩 더한다 */
function withNeedsReview(doc: Inspection): Inspection {
  const base = doc.issues[0];
  const baseTask = doc.tasks[0];
  if (!base || !baseTask) return doc;
  const rest = { ...base };
  delete rest.analysis;
  const review: Issue = {
    ...rest,
    id: 'ISS-002',
    priority: 'P2',
    confidence: 0.4,
    needsReview: true,
    analysisSkippedReason: 'needs-review',
    occurrences: rest.occurrences.map((o) => ({ ...o, confidence: 0.4, boundingBox: { ...o.boundingBox, y: o.boundingBox.y + 120 } })),
  };
  return {
    ...doc,
    issuesDetected: doc.issuesDetected + 1,
    issues: [...doc.issues, review],
    tasks: [...doc.tasks, { ...baseTask, id: 'TASK-002', priority: 'P2', needsReview: true, issueIds: ['ISS-002'], title: `${baseTask.title} (검토 필요)` }],
  };
}

async function buildResponses(): Promise<Record<string, { status: number; body: unknown }>> {
  const ok = (body: Inspection) => ({ status: 200, body });
  const p01 = await fixtureDoc('P-01', ID.p01);
  const p03 = await fixtureDoc('P-03', ID.p03);
  return {
    [ID.running]: ok(fakeInspection(ID.running, { step: 'rendering_mobile' })),
    [ID.failed]: ok(
      fakeInspection(ID.failed, {
        status: 'failed',
        step: 'rendering_mobile',
        error: timeout,
        viewportErrors: { desktop: timeout, mobile: timeout },
        completedAt: new Date(Date.now() - 2_000).toISOString(),
      }),
    ),
    [ID.desktopFailed]: ok(fakeInspection(ID.desktopFailed, { step: 'rendering_mobile', viewportErrors: { desktop: timeout, mobile: null } })),
    [ID.missing]: { status: 404, body: { code: 'NOT_FOUND', message: '검사 결과를 찾을 수 없습니다. 결과는 7일 동안 보관됩니다.' } },
    [ID.p01]: ok(p01),
    [ID.p03]: ok(p03),
    [ID.p04]: ok(await fixtureDoc('P-04', ID.p04)),
    [ID.p06]: ok(await fixtureDoc('P-06', ID.p06)),
    [ID.analyzing]: ok(asAnalyzing(await fixtureDoc('P-03', ID.analyzing))),
    [ID.partial]: ok(asMobileFailed(await fixtureDoc('P-03', ID.partial))),
    [ID.empty]: ok(await fixtureDoc('N-01', ID.empty)),
    [ID.review]: ok(withNeedsReview(await fixtureDoc('P-03', ID.review))),
    [ID.noshotP01]: ok(asNoScreenshot(await fixtureDoc('P-01', ID.noshotP01))),
    [ID.noshotP02]: ok(asNoScreenshot(await fixtureDoc('P-02', ID.noshotP02))),
    [ID.noshotP03]: ok(asNoScreenshot(await fixtureDoc('P-03', ID.noshotP03))),
    [ID.noshotP04]: ok(asNoScreenshot(await fixtureDoc('P-04', ID.noshotP04))),
    [ID.noshotP05]: ok(asNoScreenshot(await fixtureDoc('P-05', ID.noshotP05))),
    [ID.hybrid]: ok(asHybrid(await fixtureDoc('demo-landing', ID.hybrid))),
    [ID.canvas]: ok(asNoScreenshot(await fixtureDoc('demo-canvas-only', ID.canvas))),
    [ID.legacy]: ok(asLegacy(asNoScreenshot(await fixtureDoc('P-01', ID.legacy)))),
    [ID.longPage]: ok(asLongPage(await fixtureDoc('demo-landing', ID.longPage))),
    [ID.splitText]: ok(asNoScreenshot(await fixtureDoc('demo-split-text', ID.splitText))),
    ...(EXTRA_DOC ? { [ID.extra]: ok(asNoScreenshot({ ...(JSON.parse(await readFile(EXTRA_DOC, 'utf8')) as Inspection), id: ID.extra })) } : {}),
  };
}

interface Screen {
  name: string;
  path: string;
  ready: string;
  /** 화면을 찍기 전에 실행한다 */
  before?: (page: Page) => Promise<void>;
  /** 페이지를 열기 전에 실행한다 (sessionStorage 등) */
  init?: (page: Page) => Promise<void>;
  /** 고정 패널이 열린 화면은 보이는 영역만 찍는다 */
  fullPage?: boolean;
}

/** UI_SHOTS_ONLY=sample 처럼 이름 앞부분으로 찍을 화면을 고른다 */
const ONLY = process.env.UI_SHOTS_ONLY ?? '';

const RETRY_URL = 'https://www.example.com/pricing?plan=team';

const SCREENS: Screen[] = [
  { name: 'home', path: '/', ready: 'form' },
  // T13 샘플 리포트: 정적 문서(public/sample)라 API mock이 필요 없다
  { name: 'sample', path: '/report/sample', ready: 'text=샘플 리포트입니다' },
  { name: 'sample-detail', path: '/report/sample?issue=ISS-005', ready: 'aside h2', fullPage: false },
  { name: 'sample-tasks', path: '/report/sample?tab=tasks&task=TASK-002', ready: 'textarea' },
  {
    name: 'home-retry',
    path: '/',
    ready: `input[value="${RETRY_URL}"]`,
    init: async (page) => {
      await page.addInitScript((url) => window.sessionStorage.setItem('inspector:retry-url', url), RETRY_URL);
    },
  },
  { name: 'progress-running', path: `/inspections/${ID.running}`, ready: 'ol' },
  { name: 'progress-desktop-failed', path: `/inspections/${ID.desktopFailed}`, ready: 'text=NAVIGATION_TIMEOUT' },
  { name: 'progress-failed', path: `/inspections/${ID.failed}`, ready: 'text=다시 시도' },
  { name: 'progress-not-found', path: `/inspections/${ID.missing}`, ready: 'text=검사 결과를 찾을 수 없습니다' },
  { name: 'report-not-found', path: `/report/${ID.missing}`, ready: 'text=검사 결과를 찾을 수 없습니다' },
  { name: 'report-p01', path: `/report/${ID.p01}`, ready: 'h1:has-text("검사 결과")' },
  { name: 'report-p01-detail', path: `/report/${ID.p01}?issue=ISS-001`, ready: 'aside h2', fullPage: false },
  { name: 'report-p04-detail', path: `/report/${ID.p04}?issue=ISS-001`, ready: 'aside h2', fullPage: false },
  { name: 'report-p06-detail', path: `/report/${ID.p06}?issue=ISS-001`, ready: 'aside h2', fullPage: false },
  { name: 'report-tasks', path: `/report/${ID.p03}?tab=tasks`, ready: 'nav[aria-label="태스크 목록"]' },
  { name: 'report-tasks-selected', path: `/report/${ID.p03}?tab=tasks&task=TASK-001`, ready: 'textarea' },
  { name: 'report-analyzing', path: `/report/${ID.analyzing}`, ready: 'h1:has-text("검사 결과")' },
  { name: 'report-analyzing-detail', path: `/report/${ID.analyzing}?issue=ISS-001`, ready: 'aside h2', fullPage: false },
  { name: 'report-analyzing-tasks', path: `/report/${ID.analyzing}?tab=tasks`, ready: 'text=원인 분석과 태스크 생성 중입니다' },
  { name: 'report-partial', path: `/report/${ID.partial}`, ready: 'text=Mobile 검사에 실패했습니다' },
  { name: 'report-empty', path: `/report/${ID.empty}`, ready: 'text=검사한 항목에서 문제가 발견되지 않았습니다' },
  // 스크린샷 없음(SCREENSHOT_FAILED): 미리보기 도면과 Issue Detail 이슈 도면 (T14, WIREFRAME 5.6·6.4)
  { name: 'report-noshot', path: `/report/${ID.noshotP01}`, ready: 'h1:has-text("검사 결과")' },
  { name: 'report-noshot-viewport-overflow', path: `/report/${ID.noshotP04}?issue=ISS-001`, ready: 'aside figure svg', fullPage: false },
  { name: 'report-noshot-spill', path: `/report/${ID.noshotP05}?issue=ISS-001`, ready: 'aside figure svg', fullPage: false },
  { name: 'report-noshot-clipped', path: `/report/${ID.noshotP02}?issue=ISS-001`, ready: 'aside figure svg', fullPage: false },
  { name: 'report-noshot-overlap', path: `/report/${ID.noshotP03}?issue=ISS-001`, ready: 'aside figure svg', fullPage: false },
  // 배치도 개선 (사진이 없는 부분은 도면으로 채운다)
  // 1. Desktop 스크린샷 없음 + Mobile 첫 화면만 + 범위 밖 이슈(ISS-004, Mobile 874px)의 Issue Detail
  { name: 'schematic-hybrid', path: `/report/${ID.hybrid}?issue=ISS-004`, ready: 'aside figure svg', fullPage: false },
  { name: 'schematic-hybrid-full', path: `/report/${ID.hybrid}`, ready: 'h1:has-text("검사 결과")' },
  // 2. canvas 위주 페이지, 이슈 0개
  { name: 'schematic-canvas', path: `/report/${ID.canvas}`, ready: 'text=검사한 항목에서 문제가 발견되지 않았습니다' },
  // 2-1. 글자·단어 단위로 쪼갠 텍스트, 투명 래퍼 안의 canvas, 같은 크기 구조 블록
  { name: 'schematic-split-text', path: `/report/${ID.splitText}`, ready: 'text=검사한 항목에서 문제가 발견되지 않았습니다' },
  ...(EXTRA_DOC ? [{ name: 'schematic-extra', path: `/report/${ID.extra}`, ready: 'h1:has-text("검사 결과")' }] : []),
  // 3. layoutMap이 없는 예전 문서 → 최소 도면
  { name: 'schematic-legacy', path: `/report/${ID.legacy}`, ready: 'text=표시할 구조 요소를 찾지 못했습니다' },
  // 4. 높이 상한(Desktop 10,000px)에 걸린 긴 페이지: 미리보기를 "배치도 끝" 근처로 스크롤해서 찍는다
  {
    name: 'schematic-long-page',
    path: `/report/${ID.longPage}`,
    ready: 'h1:has-text("검사 결과")',
    before: async (page) => {
      await page.locator('section[aria-label="Desktop 미리보기"] .overflow-y-auto').evaluate((el) => {
        const svg = el.querySelector('svg');
        const height = svg ? svg.getBoundingClientRect().height : el.scrollHeight;
        el.scrollTop = (10_000 / 14_000) * height - el.clientHeight / 2;
      });
    },
  },
  {
    name: 'report-needs-review',
    path: `/report/${ID.review}`,
    ready: 'h1:has-text("검사 결과")',
    before: async (page) => {
      await page.getByRole('button', { name: /검토 필요/ }).first().click();
      await page.locator('#needs-review-group ul').waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
    },
  },
];

async function mockApi(page: Page, responses: Record<string, { status: number; body: unknown }>) {
  await page.route('**/api/inspections/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const response = responses[id];
    if (!response || route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
  await page.route(`**${SHOT_PREFIX}*`, async (route) => {
    const name = path.basename(new URL(route.request().url()).pathname);
    try {
      await route.fulfill({ status: 200, contentType: 'image/png', body: await readFile(path.join(FIXTURE_DIR, name)) });
    } catch {
      await route.fulfill({ status: 404, body: '' });
    }
  });
}

/** 화면에 보이는 이미지가 모두 로드될 때까지 기다린다 (lazy 이미지 중 숨긴 탭은 제외) */
async function waitForVisibleImages(page: Page) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.images)
          .filter((img) => img.checkVisibility() && img.getBoundingClientRect().top < window.innerHeight)
          .every((img) => img.complete && img.naturalWidth > 0),
      undefined,
      { timeout: IMAGE_TIMEOUT_MS },
    )
    .catch(() => console.warn('  (이미지 로드를 기다리다 시간 초과)'));
}

/** P-01 Mobile 마커가 스크린샷의 실제 요소 위치(boundingBox × 표시 배율)와 맞는지 */
async function checkP01Marker(page: Page, expected: { x: number; y: number; width: number; height: number }, screenshotWidth: number): Promise<string | null> {
  const viewer = page.locator('section[aria-label="Mobile 미리보기"]');
  if (!(await viewer.isVisible())) return null;
  const measured = await viewer.evaluate((section) => {
    const img = section.querySelector('img');
    const rect = section.querySelectorAll('svg rect')[1];
    if (!img || !rect) return null;
    const i = img.getBoundingClientRect();
    const r = rect.getBoundingClientRect();
    return { imgWidth: i.width, x: r.left - i.left, y: r.top - i.top, width: r.width, height: r.height };
  });
  if (!measured) return 'P-01 Mobile 마커를 찾지 못했습니다';
  const scale = measured.imgWidth / screenshotWidth;
  const want = { x: expected.x * scale, y: expected.y * scale, width: expected.width * scale, height: expected.height * scale };
  const diff = Math.max(Math.abs(measured.x - want.x), Math.abs(measured.y - want.y), Math.abs(measured.width - want.width), Math.abs(measured.height - want.height));
  console.log(`  P-01 Mobile 마커: 표시 배율 ${scale.toFixed(3)}, 기대 ${JSON.stringify(roundBox(want))}, 실제 ${JSON.stringify(roundBox(measured))}, 최대 차이 ${diff.toFixed(2)}px`);
  return diff > MARKER_TOLERANCE_PX ? `P-01 Mobile 마커 위치가 ${diff.toFixed(2)}px 어긋납니다` : null;
}

const roundBox = (b: { x: number; y: number; width: number; height: number }) => ({
  x: Math.round(b.x * 10) / 10,
  y: Math.round(b.y * 10) / 10,
  width: Math.round(b.width * 10) / 10,
  height: Math.round(b.height * 10) / 10,
});

/** PNG 헤더(IHDR)의 크기 */
function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** 이미지 위쪽 height px만 남긴 PNG를 만든다 (첫 화면만 저장된 스크린샷 흉내) */
async function cropTop(browser: Browser, src: string, dst: string, height: number) {
  const buffer = await readFile(src);
  const { width } = pngSize(buffer);
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    await page.setContent(`<body style="margin:0"><img style="display:block" src="data:image/png;base64,${buffer.toString('base64')}"></body>`);
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    await page.screenshot({ path: dst, clip: { x: 0, y: 0, width, height } });
  } finally {
    await context.close();
  }
}

/** 시안 이미지와 같은 크기(1440 CSS px, 2배율)로 찍어 나란히 붙인 비교 이미지를 만든다 */
const COMPARES = [
  { name: 'compare-hybrid', mock: 'schematic-v2-hybrid.png', path: () => `/report/${ID.hybrid}?issue=ISS-004`, ready: 'aside figure svg' },
  { name: 'compare-canvas', mock: 'schematic-v2-canvas-only.png', path: () => `/report/${ID.canvas}`, ready: 'text=검사한 항목에서 문제가 발견되지 않았습니다' },
  { name: 'compare-split-text', mock: 'schematic-v2-canvas-only.png', path: () => `/report/${ID.splitText}`, ready: 'text=검사한 항목에서 문제가 발견되지 않았습니다' },
] as const;

async function compareWithMocks(responses: Record<string, { status: number; body: unknown }>) {
  for (const item of COMPARES) {
    const mock = await readFile(path.join(MOCK_DIR, item.mock));
    const size = pngSize(mock);
    const viewport = { width: size.width / 2, height: Math.round(size.height / 2) };
    // 비교마다 브라우저를 새로 띄운다 (브라우저 하나에 context 하나)
    let ours: Buffer;
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2, reducedMotion: 'reduce' });
      const page = await context.newPage();
      await mockApi(page, responses);
      await page.goto(`${BASE_URL}${item.path()}`, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
      await page.locator(item.ready).first().waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
      await page.evaluate(() => document.fonts.ready);
      await waitForVisibleImages(page);
      ours = await page.screenshot();
      await writeFile(path.join(OUT_DIR, `${item.name}-ours.png`), ours);
      await context.close();
    } finally {
      await browser.close();
    }
    const composer = await chromium.launch();
    try {
      const gap = 24;
      const label = 28;
      const context = await composer.newContext({ viewport: { width: viewport.width * 2 + gap, height: viewport.height + label }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      const img = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
      await page.setContent(`<body style="margin:0;display:flex;gap:${gap}px;background:#d0d4da;font:14px sans-serif">
        <figure style="margin:0;width:${viewport.width}px"><figcaption style="height:${label}px;line-height:${label}px;padding-left:8px">시안 ${item.mock}</figcaption><img style="display:block;width:${viewport.width}px" src="${img(mock)}"></figure>
        <figure style="margin:0;width:${viewport.width}px"><figcaption style="height:${label}px;line-height:${label}px;padding-left:8px">구현 ${item.path()}</figcaption><img style="display:block;width:${viewport.width}px" src="${img(ours)}"></figure></body>`);
      await page.evaluate(() => Promise.all(Array.from(document.images).map((i) => i.decode())));
      const file = path.join(OUT_DIR, `${item.name}.png`);
      await page.screenshot({ path: file });
      console.log(`✓ ${path.relative(process.cwd(), file)}`);
      await context.close();
    } finally {
      await composer.close();
    }
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  // ui-shot 1용: Mobile 스크린샷의 위쪽 844px만 남긴 이미지
  const cropper = await chromium.launch();
  try {
    await cropTop(cropper, path.join(FIXTURE_DIR, 'demo-landing-mobile.png'), path.join(FIXTURE_DIR, HYBRID_SHOT_FILE), HYBRID_SHOT_HEIGHT);
  } finally {
    await cropper.close();
  }
  const responses = await buildResponses();
  const p01 = responses[ID.p01]!.body as Inspection;
  const p01Box = p01.issues[0]!.occurrences.find((o) => o.viewport === 'mobile')!.boundingBox;
  const p01Width = p01.viewports.mobile!.screenshotWidth;
  if (p01Width === null) throw new Error('P-01 Mobile screenshot is missing');

  const overflow: string[] = [];
  const problems: string[] = [];
  // 크기마다 브라우저를 새로 띄운다. 브라우저 하나에 context를 여러 개 열지 않는다(AGENTS.md 7장과 같은 방식)
  for (const size of SIZES) {
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        isMobile: size.isMobile,
        hasTouch: size.isMobile,
        deviceScaleFactor: size.isMobile ? 2 : 1,
        reducedMotion: 'reduce',
      });
      try {
        for (const screen of SCREENS.filter((s) => !ONLY || s.name.startsWith(ONLY))) {
          const page = await context.newPage();
          // 화면의 콘솔 오류(React key 중복 등)를 함께 알린다
          const consoleErrors = new Set<string>();
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.add(message.text().slice(0, 300));
          });
          await mockApi(page, responses);
          await screen.init?.(page);
          await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
          await page.locator(screen.ready).first().waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
          await screen.before?.(page);
          await page.evaluate(() => document.fonts.ready);
          await waitForVisibleImages(page);
          if (screen.name === 'report-p01') {
            const problem = await checkP01Marker(page, p01Box, p01Width);
            if (problem) problems.push(`${screen.name}-${size.name}: ${problem}`);
          }
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          const file = path.join(OUT_DIR, `${screen.name}-${size.name}.png`);
          await page.screenshot({ path: file, fullPage: screen.fullPage ?? true });
          const wider = scrollWidth > clientWidth;
          if (wider) overflow.push(`${screen.name}-${size.name}`);
          console.log(`${wider ? '✗' : '✓'} ${path.relative(process.cwd(), file)}  scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
          for (const text of consoleErrors) console.warn(`  console.error: ${text}`);
          await page.close();
        }
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  if (!ONLY || ONLY.startsWith('compare')) await compareWithMocks(responses);
  if (overflow.length > 0) console.error(`가로 스크롤이 있는 화면: ${overflow.join(', ')}`);
  for (const problem of problems) console.error(problem);
  if (overflow.length > 0 || problems.length > 0) process.exitCode = 1;
}

void main();
