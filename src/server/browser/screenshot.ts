import 'server-only';
import type { Page } from 'playwright-core';
import type { CollectedViewport } from '@/server/collect/types';
import { SCREENSHOT_MAX_HEIGHT } from '@/server/detect/constants';
import type { Viewport } from '@/types/inspection';
import { VIEWPORTS } from './devices';

// 전체 페이지 스크린샷 (PRD 5.2.4). 업로드는 하지 않는다(T09에서 Blob에 올린다).

/**
 * 스크린샷 1장의 시간 제한. PRD 8.1.3 "viewport당 측정과 스크린샷 20s" 안에서 스크린샷에 쓰는 몫이다.
 * 수집(COLLECT_TIMEOUT_MS)과 합한 상한은 T09 오케스트레이션에서 남은 예산으로 다시 자른다.
 */
export const SCREENSHOT_TIMEOUT_MS = 10_000;

export interface ScreenshotMeta {
  /** 저장된 이미지의 실제 크기 (CSS px, PNG 헤더에서 읽음) */
  screenshotWidth: number;
  screenshotHeight: number;
  /** 촬영 시점의 document.documentElement.scrollHeight (수집과 같은 기준) */
  documentHeight: number;
  /** documentHeight > screenshotHeight (DOMAIN_MODEL V-2) */
  screenshotTruncated: boolean;
}

export interface CapturedScreenshot extends ScreenshotMeta {
  png: Buffer;
  /** 성공한 촬영 방식. 'full'이 아니면 앞선 방식이 실패해 줄여서 찍은 것이다 */
  mode: ScreenshotMode;
  /** 실패한 시도 수 */
  failedAttempts: number;
}

/**
 * 촬영 방식 (T14). 서버리스 Chromium(single-process, SwiftShader)에서 전체 페이지 촬영이 가끔
 * "Unable to capture screenshot"으로 실패한다(production에서 Desktop·Mobile 모두 확인, 로컬 macOS에서는 재현되지 않음).
 * 측정은 이미 끝났으므로 스크린샷 하나 때문에 viewport 결과를 버리지 않도록, 실패하면 더 작게 다시 찍는다.
 * - full: PRD 5.2.4 그대로 (높이 상한만 적용)
 * - reduced: 실제 픽셀(CSS px × deviceScaleFactor)이 SCREENSHOT_MAX_DEVICE_PX를 넘지 않게 줄인다
 * - first-screen: 첫 화면 높이만
 * 줄여 찍으면 screenshotTruncated가 true가 되어 결과 화면에 "스크린샷 잘림"으로 표시되고,
 * 스크린샷 밖의 이슈는 cropRect가 null이 된다(PRD 5.4.1). 측정과 탐지에는 영향이 없다.
 */
export type ScreenshotMode = 'full' | 'reduced' | 'first-screen';

/**
 * reduced 촬영의 실제 픽셀 상한(가로·세로 각각). PRD에 없는 값이다(T14에서 정함).
 * 많은 GPU·SwiftShader의 최대 텍스처 크기(8192)에 맞췄다. Mobile(배율 3)은 CSS 2,730px, Desktop은 8,192px이다.
 */
export const SCREENSHOT_MAX_DEVICE_PX = 8192;

export interface ScreenshotPlan {
  mode: ScreenshotMode;
  /** null이면 전체 페이지 그대로 */
  clip: ClipRect | null;
}

/** 로그용 진단 값. 페이지 내용(텍스트, URL)은 넣지 않는다 */
export interface ScreenshotDiagnostics {
  mode: ScreenshotMode;
  /** 이번 시도의 촬영 영역 (CSS px) */
  cssWidth: number;
  cssHeight: number;
  deviceScaleFactor: number;
  /** 실제로 그려야 하는 픽셀 크기 */
  deviceWidth: number;
  deviceHeight: number;
  /** 페이지 전체 크기 (CSS px) */
  pageWidth: number;
  pageHeight: number;
  canvasCount: number;
}

export interface ScreenshotAttemptFailure {
  diagnostics: ScreenshotDiagnostics;
  durationMs: number;
  error: unknown;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * PNG 헤더(IHDR)에서 이미지 크기를 읽는다. 새 의존성 없이 직접 파싱한다.
 * 구조: 시그니처 8바이트 → 첫 청크 길이(4) → 타입 'IHDR'(4) → width(4, big-endian) → height(4)
 */
export function readPngSize(buffer: Uint8Array): { width: number; height: number } {
  if (buffer.length < 24) throw new Error('PNG too short');
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (buffer[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG (bad signature)');
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const type = String.fromCharCode(buffer[12], buffer[13], buffer[14], buffer[15]);
  if (type !== 'IHDR' || view.getUint32(8) !== 13) throw new Error('PNG first chunk is not IHDR');
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw new Error('PNG has zero size');
  return { width, height };
}

/** 루트가 가로를 자르는 페이지 (DETECTION_RULES 6.4의 rootClip과 같은 판정) */
export function isRootClip(rootOverflowX: CollectedViewport['rootOverflowX']): boolean {
  const clips = (value: string) => value === 'hidden' || value === 'clip';
  return clips(rootOverflowX.html) || clips(rootOverflowX.body);
}

export interface ClipRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 스크린샷 clip 영역. 자를 필요가 없으면 null(전체 페이지 그대로).
 * - 높이: 상한(PRD 5.2.4)을 넘으면 상한까지
 * - 너비: rootClip이면 layoutWidth까지. 사용자가 볼 수 없는 영역을 보여주지 않기 위해서다(PRD 5.2.4, DETECTION_RULES 3.1.1).
 *   그 밖(예: Mobile 축소로 넓어진 페이지)은 실제 페이지 너비 그대로다.
 */
export function screenshotClip(
  page: { width: number; height: number },
  viewport: Viewport,
  layout: Pick<CollectedViewport, 'rootOverflowX' | 'layoutWidth'>,
): ClipRect | null {
  const maxHeight = SCREENSHOT_MAX_HEIGHT[viewport];
  const clipWidth = isRootClip(layout.rootOverflowX) && page.width > layout.layoutWidth;
  const clipHeight = page.height > maxHeight;
  if (!clipWidth && !clipHeight) return null;
  return {
    x: 0,
    y: 0,
    width: clipWidth ? layout.layoutWidth : page.width,
    height: Math.min(page.height, maxHeight),
  };
}

/**
 * 시도할 촬영 방식 목록 (순서대로). 앞 방식보다 작아지지 않는 방식은 넣지 않는다. 순수 함수다.
 */
export function screenshotPlans(
  page: { width: number; height: number },
  viewport: Viewport,
  layout: Pick<CollectedViewport, 'rootOverflowX' | 'layoutWidth'>,
): ScreenshotPlan[] {
  const full = screenshotClip(page, viewport, layout);
  const width = full?.width ?? page.width;
  const height = full?.height ?? page.height;
  const plans: ScreenshotPlan[] = [{ mode: 'full', clip: full }];
  let lastWidth = width;
  let lastHeight = height;
  const add = (mode: ScreenshotMode, w: number, h: number) => {
    const nextWidth = Math.max(1, Math.min(lastWidth, w));
    const nextHeight = Math.max(1, Math.min(lastHeight, h));
    if (nextWidth === lastWidth && nextHeight === lastHeight) return;
    plans.push({ mode, clip: { x: 0, y: 0, width: nextWidth, height: nextHeight } });
    lastWidth = nextWidth;
    lastHeight = nextHeight;
  };
  const maxCss = Math.floor(SCREENSHOT_MAX_DEVICE_PX / VIEWPORTS[viewport].deviceScaleFactor);
  add('reduced', maxCss, maxCss);
  add('first-screen', lastWidth, VIEWPORTS[viewport].height);
  return plans;
}

export function screenshotDiagnostics(
  plan: ScreenshotPlan,
  viewport: Viewport,
  page: { width: number; height: number; canvasCount: number },
): ScreenshotDiagnostics {
  const scale = VIEWPORTS[viewport].deviceScaleFactor;
  const cssWidth = plan.clip?.width ?? page.width;
  const cssHeight = plan.clip?.height ?? page.height;
  return {
    mode: plan.mode,
    cssWidth,
    cssHeight,
    deviceScaleFactor: scale,
    deviceWidth: Math.ceil(cssWidth * scale),
    deviceHeight: Math.ceil(cssHeight * scale),
    pageWidth: page.width,
    pageHeight: page.height,
    canvasCount: page.canvasCount,
  };
}

/**
 * 전체 페이지를 CSS px 크기로 찍는다(`scale: 'css'`: Mobile의 deviceScaleFactor 3을 적용하지 않아 이미지 픽셀 = CSS px).
 * 문서 높이가 상한을 넘으면 상한까지만 찍는다(PRD 5.2.4).
 * 이미지 크기는 페이지 측정값으로 추정하지 않고 PNG에서 읽는다. Mobile에서 페이지가 축소되면 너비가 layoutWidth와 다르다(DETECTION_RULES 3.1.1).
 * 촬영이 실패하면 screenshotPlans 순서대로 줄여서 다시 찍는다. 모두 실패하면 마지막 오류를 던진다.
 */
export async function captureFullPage(
  page: Page,
  viewport: Viewport,
  /** 수집 결과의 값. 탐지(rootClip)와 같은 기준으로 자르기 위해 페이지에서 다시 재지 않는다 */
  layout: Pick<CollectedViewport, 'rootOverflowX' | 'layoutWidth'>,
  options: { onAttemptFailed?: (failure: ScreenshotAttemptFailure) => void } = {},
): Promise<CapturedScreenshot> {
  const size = await page.evaluate(() => {
    const root = document.documentElement;
    return {
      height: root.scrollHeight,
      width: Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0),
      canvasCount: document.getElementsByTagName('canvas').length,
    };
  });
  let lastError: unknown = null;
  let failedAttempts = 0;
  for (const plan of screenshotPlans(size, viewport, layout)) {
    const startedAt = Date.now();
    try {
      const png = await page.screenshot({
        type: 'png',
        fullPage: true,
        scale: 'css',
        animations: 'disabled',
        caret: 'hide',
        timeout: SCREENSHOT_TIMEOUT_MS,
        ...(plan.clip ? { clip: plan.clip } : {}),
      });
      const { width, height } = readPngSize(png);
      return {
        png,
        screenshotWidth: width,
        screenshotHeight: height,
        documentHeight: size.height,
        screenshotTruncated: size.height > height,
        mode: plan.mode,
        failedAttempts,
      };
    } catch (error) {
      lastError = error;
      failedAttempts += 1;
      options.onAttemptFailed?.({ diagnostics: screenshotDiagnostics(plan, viewport, size), durationMs: Date.now() - startedAt, error });
      // 페이지나 브라우저가 닫혔으면 다시 찍을 수 없다
      if (page.isClosed()) break;
    }
  }
  throw lastError;
}
