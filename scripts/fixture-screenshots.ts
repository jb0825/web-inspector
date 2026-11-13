// Fixture 15종을 Desktop/Mobile로 열어 전체 페이지 스크린샷을 남기고, 폰트와 가로 너비를 표로 출력한다.
// 사람이 눈으로 확인하기 위한 도구다. 탐지는 하지 않는다(T03).
//
// 실행: pnpm fixtures:shots  (node --conditions=react-server: server-only를 빈 모듈로 불러온다, AGENTS.md 10장)

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '@/server/browser/launch';
import { createViewportContext } from '@/server/browser/devices';
import type { Viewport } from '@/types/inspection';
import { FIXTURE_EXPECTATIONS } from '../tests/fixtures/expected';
import { start } from '../tests/fixtures/server';

const OUT_DIR = path.join(process.cwd(), '.tmp', 'fixture-shots');
const VIEWPORT_ORDER: Viewport[] = ['desktop', 'mobile'];
const NAVIGATION_TIMEOUT_MS = 15_000;
const FONTS_READY_TIMEOUT_MS = 5_000;

interface Row {
  id: string;
  viewport: Viewport;
  fontsCheck: boolean;
  facesLoaded: string;
  layoutWidth: number;
  scrollWidth: number;
  wider: string;
  docHeight: number;
  failedRequests: number;
}

/** page.evaluate로 실행한다. 바깥 변수를 참조하지 않는다(AGENTS.md 7장). */
function measure() {
  const root = document.documentElement;
  const faces = [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'Noto Sans KR');
  return {
    fontsCheck: document.fonts.check('16px "Noto Sans KR"'),
    facesLoaded: faces.filter((face) => face.status === 'loaded').length,
    facesTotal: faces.length,
    layoutWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    docHeight: Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0),
  };
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const server = await start();
  const browser = await launchBrowser();
  const rows: Row[] = [];
  const errors: string[] = [];

  try {
    for (const viewport of VIEWPORT_ORDER) {
      const context = await createViewportContext(browser, viewport);
      try {
        for (const fixture of FIXTURE_EXPECTATIONS) {
          const page = await context.newPage();
          let failedRequests = 0;
          page.on('requestfailed', () => {
            failedRequests += 1;
          });
          page.on('response', (response) => {
            if (response.status() >= 400) failedRequests += 1;
          });
          page.on('pageerror', (error) => errors.push(`${fixture.id}/${viewport}: ${error.message}`));

          try {
            await page.goto(`${server.baseUrl}${fixture.path}`, {
              waitUntil: 'load',
              timeout: NAVIGATION_TIMEOUT_MS,
            });
            await page.evaluate(
              (timeoutMs) =>
                Promise.race([
                  document.fonts.ready.then(() => true),
                  new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
                ]),
              FONTS_READY_TIMEOUT_MS,
            );
            const m = await page.evaluate(measure);
            await page.screenshot({
              path: path.join(OUT_DIR, `${fixture.id}-${viewport}.png`),
              fullPage: true,
              // PRD 5.2.1: Mobile 스크린샷은 CSS px 크기로 저장한다.
              scale: 'css',
            });
            rows.push({
              id: fixture.id,
              viewport,
              fontsCheck: m.fontsCheck,
              facesLoaded: `${m.facesLoaded}/${m.facesTotal}`,
              layoutWidth: m.layoutWidth,
              scrollWidth: m.scrollWidth,
              wider: m.scrollWidth > m.layoutWidth ? 'YES' : '',
              docHeight: m.docHeight,
              failedRequests,
            });
          } catch (error) {
            errors.push(`${fixture.id}/${viewport}: ${error instanceof Error ? error.message : String(error)}`);
          } finally {
            await page.close();
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  rows.sort((a, b) => a.id.localeCompare(b.id) || VIEWPORT_ORDER.indexOf(a.viewport) - VIEWPORT_ORDER.indexOf(b.viewport));
  console.table(rows);
  console.log(`스크린샷 ${rows.length}장: ${path.relative(process.cwd(), OUT_DIR)}/`);

  if (errors.length > 0) {
    console.error('오류:');
    for (const message of errors) console.error(`  - ${message}`);
    process.exitCode = 1;
  }
  if (rows.some((row) => row.failedRequests > 0)) {
    console.error('실패한 요청이 있는 페이지가 있습니다(failedRequests 열).');
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
