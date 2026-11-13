import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { isRootClip, readPngSize, screenshotClip } from '@/server/browser/screenshot';

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
