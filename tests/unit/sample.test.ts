import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectionSchema } from '@/server/store/schemas';
import { assertInspectionInvariants } from '@/server/store/invariants';
import type { Inspection } from '@/types/inspection';
import {
  isAllowedDownloadUrl,
  isDemoTarget,
  parseBaseUrl,
  SAMPLE_SCREENSHOT_URL,
  toSampleDocument,
  validateSample,
} from '../../scripts/sample/core';

// T13: 샘플 리포트(DOMAIN_MODEL 6.3)와 scripts/import-sample.ts의 순수 함수

const SAMPLE_DIR = path.join(process.cwd(), 'public', 'sample');
const readSample = (): unknown => JSON.parse(readFileSync(path.join(SAMPLE_DIR, 'inspection.json'), 'utf8'));
const readPng = (name: string) => new Uint8Array(readFileSync(path.join(SAMPLE_DIR, name)));

describe('public/sample/inspection.json', () => {
  it('스키마와 final 불변 조건을 통과한다', () => {
    const sample = inspectionSchema.parse(readSample());
    expect(() => assertInspectionInvariants(sample, 'final')).not.toThrow();
    expect(sample.status).toBe('completed');
  });

  it('production에서 데모 페이지를 검사한 결과다 (임시 샘플이 아니다)', () => {
    const sample = inspectionSchema.parse(readSample());
    // 로컬 --local로 만든 임시 샘플의 고정 ID (tests/fixtures/run.ts PAGE_INSPECTION_ID)
    expect(sample.id).not.toBe('00000000-0000-4000-8000-00000000d001');
    const target = new URL(sample.url);
    expect(target.protocol).toBe('https:');
    expect(isDemoTarget(sample, new URL(target.origin))).toBe(true);
    expect(sample.viewportErrors).toEqual({ desktop: null, mobile: null });
    expect(sample.analysis.status).toBe('completed');
  });

  it('screenshotUrl이 /sample/로 시작하고, PNG 크기가 문서와 같다', () => {
    const sample = inspectionSchema.parse(readSample());
    for (const v of ['desktop', 'mobile'] as const) {
      expect(sample.viewports[v]?.screenshotUrl).toBe(SAMPLE_SCREENSHOT_URL[v]);
    }
    // 저장소의 샘플은 layoutMap이 생기기 전 검사 결과라 없다. production에서 다시 가져온 뒤 requireLayoutMap 옵션을 지운다
    expect(validateSample(sample, { desktop: readPng('desktop-full.png'), mobile: readPng('mobile-full.png') }, 'sample', { requireLayoutMap: false })).toEqual([]);
  });
});

describe('parseBaseUrl', () => {
  it('origin만 받는다', () => {
    expect(parseBaseUrl('https://inspector.example.com').origin).toBe('https://inspector.example.com');
    expect(parseBaseUrl('https://inspector.example.com/').origin).toBe('https://inspector.example.com');
    expect(() => parseBaseUrl('https://inspector.example.com/report')).toThrow();
    expect(() => parseBaseUrl('https://inspector.example.com/?a=1')).toThrow();
    expect(() => parseBaseUrl('ftp://inspector.example.com')).toThrow();
    expect(() => parseBaseUrl('https://user:pw@inspector.example.com')).toThrow();
  });
});

describe('isAllowedDownloadUrl', () => {
  const base = parseBaseUrl('https://inspector.example.com');

  it('--base origin과 Vercel Blob 공개 스토어만 허용한다', () => {
    expect(isAllowedDownloadUrl('https://inspector.example.com/sample/desktop-full.png', base)).toBe(true);
    expect(isAllowedDownloadUrl('https://abc123.public.blob.vercel-storage.com/inspections/x/desktop-full-AbC.png', base)).toBe(true);
  });

  it('그 밖의 주소는 거부한다', () => {
    expect(isAllowedDownloadUrl('https://evil.example.net/a.png', base)).toBe(false);
    expect(isAllowedDownloadUrl('http://abc123.public.blob.vercel-storage.com/a.png', base)).toBe(false);
    expect(isAllowedDownloadUrl('https://public.blob.vercel-storage.com.evil.net/a.png', base)).toBe(false);
    expect(isAllowedDownloadUrl('https://abc.public.blob.vercel-storage.com:8443/a.png', base)).toBe(false);
    expect(isAllowedDownloadUrl('https://user@abc.public.blob.vercel-storage.com/a.png', base)).toBe(false);
    expect(isAllowedDownloadUrl('http://inspector.example.com/a.png', base)).toBe(false);
    expect(isAllowedDownloadUrl('/sample/desktop-full.png', base)).toBe(false);
  });
});

describe('isDemoTarget', () => {
  const base = parseBaseUrl('https://inspector.example.com');

  it('--base 호스트의 /demo/ 페이지만 데모로 본다', () => {
    expect(isDemoTarget({ url: 'https://inspector.example.com/demo/landing.html' }, base)).toBe(true);
    expect(isDemoTarget({ url: 'https://www.example.org/demo/landing.html' }, base)).toBe(false);
    expect(isDemoTarget({ url: 'https://inspector.example.com/fixtures/positive/P-01.html' }, base)).toBe(false);
  });

  it('리다이렉트된 최종 URL도 확인한다', () => {
    expect(
      isDemoTarget({ url: 'https://inspector.example.com/demo/landing.html', finalUrl: 'https://www.example.org/' }, base),
    ).toBe(false);
  });
});

describe('toSampleDocument / validateSample', () => {
  const sample = inspectionSchema.parse(readSample());

  it('screenshotUrl만 바꾸고 나머지 값은 그대로 둔다', () => {
    const remote: Inspection = {
      ...sample,
      viewports: {
        desktop: sample.viewports.desktop && { ...sample.viewports.desktop, screenshotUrl: 'https://a.public.blob.vercel-storage.com/d.png' },
        mobile: sample.viewports.mobile && { ...sample.viewports.mobile, screenshotUrl: 'https://a.public.blob.vercel-storage.com/m.png' },
      },
    };
    const converted = toSampleDocument(remote);
    expect(converted).toEqual(sample);
    // 원본은 바꾸지 않는다
    expect(remote.viewports.desktop?.screenshotUrl).toBe('https://a.public.blob.vercel-storage.com/d.png');
  });

  it('완료되지 않았거나 /sample/ 밖을 가리키면 문제를 돌려준다', () => {
    expect(validateSample({ ...sample, status: 'partial' })).not.toEqual([]);
    const outside = {
      ...sample,
      viewports: { ...sample.viewports, desktop: sample.viewports.desktop && { ...sample.viewports.desktop, screenshotUrl: 'https://x/d.png' } },
    };
    expect(validateSample(outside).some((p) => p.startsWith('desktop: screenshotUrl'))).toBe(true);
    expect(validateSample({ nope: true })[0]).toMatch(/^schema/);
  });

  it('layoutMap이 없거나 블록이 없는 viewport가 있으면 가져오지 않는다', () => {
    const block = { kind: 'image' as const, rect: { x: 0, y: 0, width: 10, height: 10 }, depth: 0 };
    const withMap = (blocks: (typeof block)[]) => {
      const out = structuredClone(sample);
      for (const v of ['desktop', 'mobile'] as const) {
        const vr = out.viewports[v];
        if (vr) vr.layoutMap = { width: vr.layoutWidth, scrollWidth: vr.layoutWidth, height: vr.documentHeight, truncated: false, blocks };
      }
      return out;
    };
    expect(validateSample(sample).filter((p) => p.includes('layoutMap')).length).toBe(2);
    expect(validateSample(withMap([block])).filter((p) => p.includes('layoutMap'))).toEqual([]);
    expect(validateSample(withMap([])).filter((p) => p.includes('layoutMap has no blocks')).length).toBe(2);
    const oneSide = withMap([block]);
    if (oneSide.viewports.mobile) delete oneSide.viewports.mobile.layoutMap;
    expect(validateSample(oneSide).filter((p) => p.includes('layoutMap'))).toEqual([expect.stringMatching(/^mobile: layoutMap is missing/)]);
  });

  it('PNG 크기가 문서와 다르면 문제를 돌려준다', () => {
    const problems = validateSample(sample, { desktop: readPng('mobile-full.png'), mobile: readPng('mobile-full.png') });
    expect(problems.some((p) => p.startsWith('desktop: PNG'))).toBe(true);
  });
});
