import { deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { InspectionError } from '@/server/errors';
import {
  captureFullPage,
  isRootClip,
  readPngSize,
  screenshotAttemptTimeout,
  screenshotClip,
  screenshotPlans,
  SCREENSHOT_MAX_DEVICE_PX,
  SCREENSHOT_MIN_ATTEMPT_MS,
  type ScreenshotAttemptFailure,
} from '@/server/browser/screenshot';

// PNG 헤더(IHDR) 파싱. 이미지 크기는 페이지 측정값이 아니라 저장된 PNG에서 읽는다(DETECTION_RULES 3.1.1)

function crc32(bytes: Uint8Array): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}

/** 실제로 디코딩 가능한 회색조 PNG */
function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const raw = Buffer.alloc((width + 1) * height); // 행마다 필터 바이트 1개
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ]);
}

describe('readPngSize', () => {
  it('정상 PNG에서 너비와 높이를 읽는다', () => {
    expect(readPngSize(png(616, 1334))).toEqual({ width: 616, height: 1334 });
    expect(readPngSize(png(1, 1))).toEqual({ width: 1, height: 1 });
  });

  it('Buffer의 일부(slice, byteOffset ≠ 0)여도 읽는다', () => {
    const padded = Buffer.concat([Buffer.alloc(7), png(390, 844)]);
    expect(readPngSize(padded.subarray(7))).toEqual({ width: 390, height: 844 });
  });

  it('잘못된 버퍼는 거부한다', () => {
    expect(() => readPngSize(Buffer.alloc(0))).toThrow();
    expect(() => readPngSize(Buffer.from('not a png at all, just some text bytes'))).toThrow(/signature/);
    // 시그니처만 있고 짧음
    expect(() => readPngSize(png(10, 10).subarray(0, 20))).toThrow(/short/);
    // 첫 청크가 IHDR가 아님
    const bad = png(10, 10);
    bad.write('IDAT', 12, 'ascii');
    expect(() => readPngSize(bad)).toThrow(/IHDR/);
    // JPEG
    expect(() => readPngSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(30).fill(0)]))).toThrow();
  });

  it('크기가 0이면 거부한다', () => {
    const zero = png(10, 10);
    zero.writeUInt32BE(0, 16);
    expect(() => readPngSize(zero)).toThrow(/zero/);
  });
});

describe('screenshotClip (PRD 5.2.4)', () => {
  const visible = { html: 'visible', body: 'visible' };

  it('자를 필요가 없으면 null', () => {
    expect(screenshotClip({ width: 1440, height: 900 }, 'desktop', { rootOverflowX: visible, layoutWidth: 1440 })).toBeNull();
  });

  it('rootClip이면 너비를 layoutWidth로 자른다 (P-04: 1484 → 1440, mobile 674 → 390)', () => {
    expect(screenshotClip({ width: 1484, height: 900 }, 'desktop', { rootOverflowX: { html: 'visible', body: 'hidden' }, layoutWidth: 1440 })).toEqual({
      x: 0,
      y: 0,
      width: 1440,
      height: 900,
    });
    expect(screenshotClip({ width: 674, height: 1459 }, 'mobile', { rootOverflowX: { html: 'clip', body: 'visible' }, layoutWidth: 390 })).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 1459,
    });
  });

  it('rootClip이 아니면 Mobile 축소로 넓어진 페이지도 실제 너비 그대로 (P-01: 616)', () => {
    expect(screenshotClip({ width: 616, height: 1334 }, 'mobile', { rootOverflowX: visible, layoutWidth: 390 })).toBeNull();
  });

  it('높이 상한: desktop 10000, mobile 5000', () => {
    expect(screenshotClip({ width: 1440, height: 12345 }, 'desktop', { rootOverflowX: visible, layoutWidth: 1440 })).toEqual({ x: 0, y: 0, width: 1440, height: 10000 });
    expect(screenshotClip({ width: 616, height: 12345 }, 'mobile', { rootOverflowX: visible, layoutWidth: 390 })).toEqual({ x: 0, y: 0, width: 616, height: 5000 });
    // 너비와 높이를 함께 자른다
    expect(screenshotClip({ width: 500, height: 6000 }, 'mobile', { rootOverflowX: { html: 'hidden', body: 'visible' }, layoutWidth: 390 })).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 5000,
    });
  });

  it('rootClip 판정은 DETECTION_RULES 6.4와 같다 (hidden, clip만)', () => {
    expect(isRootClip({ html: 'hidden', body: 'visible' })).toBe(true);
    expect(isRootClip({ html: 'visible', body: 'clip' })).toBe(true);
    expect(isRootClip({ html: 'auto', body: 'scroll' })).toBe(false);
    expect(isRootClip(visible)).toBe(false);
  });
});

describe('screenshotPlans (T14: 실패하면 줄여서 다시 찍기)', () => {
  const visible = { rootOverflowX: { html: 'visible', body: 'visible' }, layoutWidth: 390 };

  it('전체 → 실제 픽셀 상한 → 첫 화면 순서다', () => {
    // Mobile 배율 3: 실제 픽셀 8192 → CSS 2730px
    expect(screenshotPlans({ width: 390, height: 4925 }, 'mobile', visible)).toEqual([
      { mode: 'full', clip: null },
      { mode: 'reduced', clip: { x: 0, y: 0, width: 390, height: Math.floor(SCREENSHOT_MAX_DEVICE_PX / 3) } },
      { mode: 'first-screen', clip: { x: 0, y: 0, width: 390, height: 844 } },
    ]);
  });

  it('높이 상한(PRD 5.2.4)을 적용한 clip에서 시작한다', () => {
    const plans = screenshotPlans({ width: 1440, height: 12345 }, 'desktop', { ...visible, layoutWidth: 1440 });
    expect(plans.map((p) => [p.mode, p.clip?.height])).toEqual([
      ['full', 10000],
      ['reduced', 8192],
      ['first-screen', 900],
    ]);
  });

  it('이미 작은 페이지는 더 작아지는 방식만 넣는다', () => {
    expect(screenshotPlans({ width: 390, height: 2000 }, 'mobile', visible).map((p) => p.mode)).toEqual(['full', 'first-screen']);
    expect(screenshotPlans({ width: 1440, height: 900 }, 'desktop', { ...visible, layoutWidth: 1440 })).toEqual([{ mode: 'full', clip: null }]);
  });

  it('너비도 실제 픽셀 상한 안으로 줄인다', () => {
    const plans = screenshotPlans({ width: 3000, height: 1000 }, 'mobile', visible);
    expect(plans[1]).toEqual({ mode: 'reduced', clip: { x: 0, y: 0, width: 2730, height: 1000 } });
  });
});

describe('captureFullPage 재시도', () => {
  const layout = { rootOverflowX: { html: 'visible', body: 'visible' }, layoutWidth: 390 };

  function fakePage(results: (Buffer | Error)[]) {
    const screenshot = vi.fn(async () => {
      const next = results.shift();
      if (!next || next instanceof Error) throw next ?? new Error('no more');
      return next;
    });
    const page = { evaluate: vi.fn(async () => ({ width: 390, height: 4925, canvasCount: 1 })), screenshot, isClosed: () => false };
    return { page: page as unknown as Page, screenshot };
  }

  it('실패하면 줄여서 다시 찍고, 실패한 시도를 진단 값과 함께 알린다', async () => {
    const { page, screenshot } = fakePage([new Error('Protocol error (Page.captureScreenshot): Unable to capture screenshot'), png(390, 2730)]);
    const failures: ScreenshotAttemptFailure[] = [];
    const shot = await captureFullPage(page, 'mobile', layout, { onAttemptFailed: (f) => failures.push(f) });
    expect(shot.mode).toBe('reduced');
    expect(shot.failedAttempts).toBe(1);
    expect(shot.screenshotHeight).toBe(2730);
    expect(shot.documentHeight).toBe(4925);
    expect(shot.screenshotTruncated).toBe(true);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.diagnostics).toMatchObject({ mode: 'full', cssHeight: 4925, deviceScaleFactor: 3, deviceHeight: 14775, canvasCount: 1 });
  });

  it('모두 실패하면 SCREENSHOT_FAILED를 던지고 마지막 오류를 cause에 둔다', async () => {
    const { page, screenshot } = fakePage([new Error('a'), new Error('b'), new Error('last')]);
    const error = await captureFullPage(page, 'mobile', layout).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InspectionError);
    expect((error as InspectionError).code).toBe('SCREENSHOT_FAILED');
    expect(((error as InspectionError).cause as Error).message).toBe('last');
    expect(screenshot).toHaveBeenCalledTimes(3);
  });

  it('시간 초과가 나면 같은 page에서 다시 찍지 않는다 (T14: 앞 촬영이 page를 붙잡는다)', async () => {
    const timeout = Object.assign(new Error('page.screenshot: Timeout 30000ms exceeded.'), { name: 'TimeoutError' });
    const { page, screenshot } = fakePage([timeout, png(390, 2730)]);
    const failures: ScreenshotAttemptFailure[] = [];
    const error = await captureFullPage(page, 'mobile', layout, { onAttemptFailed: (f) => failures.push(f) }).catch((e: unknown) => e);
    expect((error as InspectionError).code).toBe('SCREENSHOT_FAILED');
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
  });

  it('처음에 성공하면 full이다', async () => {
    const { page } = fakePage([png(390, 4925)]);
    const shot = await captureFullPage(page, 'mobile', layout);
    expect(shot).toMatchObject({ mode: 'full', failedAttempts: 0, screenshotTruncated: false });
  });
});

describe('screenshotAttemptTimeout (남은 시간을 모두 쓴다)', () => {
  it('남은 시간을 그대로 준다. 나누지 않는다', () => {
    expect(screenshotAttemptTimeout(36_300)).toBe(36_300);
    expect(screenshotAttemptTimeout(4_000.7)).toBe(4_000);
  });

  it('남은 시간이 거의 없어도 최소 시간은 준다', () => {
    expect(screenshotAttemptTimeout(500)).toBe(SCREENSHOT_MIN_ATTEMPT_MS);
    expect(screenshotAttemptTimeout(-100)).toBe(SCREENSHOT_MIN_ATTEMPT_MS);
  });
});

describe('captureFullPage 시간 제한', () => {
  const layout = { rootOverflowX: { html: 'visible', body: 'visible' }, layoutWidth: 390 };

  it('deadline이 있으면 시도마다 그때 남은 시간을 모두 준다', async () => {
    const timeouts: number[] = [];
    const page = {
      evaluate: vi.fn(async () => ({ width: 390, height: 4925, canvasCount: 1 })),
      screenshot: vi.fn(async (opts: { timeout: number }) => {
        timeouts.push(opts.timeout);
        throw new Error('Protocol error (Page.captureScreenshot): Unable to capture screenshot');
      }),
      isClosed: () => false,
    } as unknown as Page;
    const failures: ScreenshotAttemptFailure[] = [];
    await expect(captureFullPage(page, 'mobile', layout, { deadline: Date.now() + 12_000, onAttemptFailed: (f) => failures.push(f) })).rejects.toThrow();
    expect(timeouts).toHaveLength(3);
    expect(timeouts[0]).toBeGreaterThan(11_000);
    expect(timeouts[0]).toBeLessThanOrEqual(12_000);
    expect(failures.map((f) => f.timeoutMs)).toEqual(timeouts);
  });
});
