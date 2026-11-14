// 로컬 dev 서버의 Home과 Progress(진행 중, 실패, 결과 없음)를 1440×900과 390×844로 찍어 .tmp/ui-shots/에 저장한다.
// 사람이 화면을 확인하기 위한 도구다(T11). 진행 중·실패 화면은 실제 검사 없이 보려고, 이 스크립트 안에서만
// page.route로 GET /api/inspections/:id 응답을 바꿔 끼운다. 운영 코드에는 mock 모드를 두지 않는다.
//
// 실행: pnpm dev를 띄운 뒤 pnpm ui:shots  (주소를 바꾸려면 UI_SHOTS_BASE_URL)
// 390px 화면에서 가로 스크롤이 생기면 종료 코드 1로 끝난다.

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import type { Inspection } from '../src/types/inspection';

const BASE_URL = process.env.UI_SHOTS_BASE_URL ?? 'http://localhost:3000';
const OUT_DIR = path.join(process.cwd(), '.tmp', 'ui-shots');
const NAVIGATION_TIMEOUT_MS = 30_000;
const READY_TIMEOUT_MS = 15_000;

const SIZES = [
  { name: 'desktop', width: 1440, height: 900, isMobile: false },
  { name: 'mobile', width: 390, height: 844, isMobile: true },
] as const;

const RUNNING_ID = '00000000-0000-4000-8000-000000000001';
const FAILED_ID = '00000000-0000-4000-8000-000000000002';
const MISSING_ID = '00000000-0000-4000-8000-000000000003';

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

const RESPONSES: Record<string, { status: number; body: unknown }> = {
  [RUNNING_ID]: { status: 200, body: fakeInspection(RUNNING_ID, { step: 'rendering_mobile' }) },
  [FAILED_ID]: {
    status: 200,
    body: fakeInspection(FAILED_ID, {
      status: 'failed',
      step: 'rendering_mobile',
      error: timeout,
      viewportErrors: { desktop: timeout, mobile: timeout },
      completedAt: new Date(Date.now() - 2_000).toISOString(),
    }),
  },
  [MISSING_ID]: { status: 404, body: { code: 'NOT_FOUND', message: '검사 결과를 찾을 수 없습니다. 결과는 7일 동안 보관됩니다.' } },
};

const SCREENS = [
  { name: 'home', path: '/', ready: 'form' },
  { name: 'progress-running', path: `/inspections/${RUNNING_ID}`, ready: 'ol' },
  { name: 'progress-failed', path: `/inspections/${FAILED_ID}`, ready: 'text=다시 검사' },
  { name: 'progress-not-found', path: `/inspections/${MISSING_ID}`, ready: 'text=검사 결과를 찾을 수 없습니다' },
] as const;

async function mockApi(page: Page) {
  await page.route('**/api/inspections/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    const response = RESPONSES[id];
    if (!response || route.request().method() !== 'GET') return route.continue();
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const overflow: string[] = [];
  try {
    for (const size of SIZES) {
      const context = await browser.newContext({
        viewport: { width: size.width, height: size.height },
        isMobile: size.isMobile,
        hasTouch: size.isMobile,
        deviceScaleFactor: size.isMobile ? 2 : 1,
        reducedMotion: 'reduce',
      });
      try {
        for (const screen of SCREENS) {
          const page = await context.newPage();
          await mockApi(page);
          await page.goto(`${BASE_URL}${screen.path}`, { waitUntil: 'load', timeout: NAVIGATION_TIMEOUT_MS });
          await page.locator(screen.ready).first().waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
          await page.evaluate(() => document.fonts.ready);
          const { scrollWidth, clientWidth } = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          }));
          const file = path.join(OUT_DIR, `${screen.name}-${size.name}.png`);
          await page.screenshot({ path: file, fullPage: true });
          const wider = scrollWidth > clientWidth;
          if (wider) overflow.push(`${screen.name}-${size.name}`);
          console.log(`${wider ? '✗' : '✓'} ${path.relative(process.cwd(), file)}  scrollWidth=${scrollWidth} clientWidth=${clientWidth}`);
          await page.close();
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (overflow.length > 0) {
    console.error(`가로 스크롤이 있는 화면: ${overflow.join(', ')}`);
    process.exitCode = 1;
  }
}

void main();
