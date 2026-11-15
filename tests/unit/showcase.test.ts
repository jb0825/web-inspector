import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { availableShowcases, isShowcaseName, loadShowcase, SHOWCASE_NAMES, showcaseFile } from '@/server/showcase';
import { assertInspectionInvariants } from '@/server/store/invariants';
import { inspectionSchema } from '@/server/store/schemas';
import { isImportTarget, screenshotUrlsFor, toSampleDocument, validateSample } from '../../scripts/sample/core';

// T14: Before/After 사례 리포트(public/showcase/)와 import-sample --target

const readPng = (file: string) => new Uint8Array(readFileSync(file));
const sample = inspectionSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), 'public', 'sample', 'inspection.json'), 'utf8')));

describe.each(SHOWCASE_NAMES)('public/showcase/%s', (name) => {
  const file = showcaseFile(name);

  // 파일이 있으면 보관 문서 검증, 없으면 페이지가 404가 되는 조건(null)을 확인한다. 어느 쪽이든 실제로 검사한다
  if (existsSync(file)) {
    it('스키마, final 불변 조건, 스크린샷 경로와 PNG 크기를 통과한다', () => {
      const doc = inspectionSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      expect(() => assertInspectionInvariants(doc, 'final')).not.toThrow();
      expect(doc.status).toBe('completed');
      const dir = path.dirname(file);
      const pngs = { desktop: readPng(path.join(dir, 'desktop-full.png')), mobile: readPng(path.join(dir, 'mobile-full.png')) };
      // 사례는 layoutMap이 생기기 전에 가져온 것일 수 있다. 화면은 최소 도면으로 보여준다(WIREFRAME 5.6)
      expect(validateSample(doc, pngs, `showcase/${name}`, { requireLayoutMap: false })).toEqual([]);
      expect(loadShowcase(name)).toEqual(doc);
    });
  } else {
    it('파일이 없으면 loadShowcase가 null이다 (페이지 404)', () => {
      expect(loadShowcase(name)).toBeNull();
      expect(availableShowcases()).not.toContain(name);
    });
  }
});

describe('loadShowcase / availableShowcases', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'showcase-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('파일이 있는 이름만 돌려주고, 문서를 스키마로 읽는다', () => {
    expect(availableShowcases(root)).toEqual([]);
    expect(loadShowcase('before', root)).toBeNull();
    mkdirSync(path.join(root, 'public', 'showcase', 'before'), { recursive: true });
    writeFileSync(showcaseFile('before', root), JSON.stringify(toSampleDocument(sample, 'showcase/before')));
    expect(availableShowcases(root)).toEqual(['before']);
    expect(loadShowcase('before', root)?.viewports.desktop?.screenshotUrl).toBe('/showcase/before/desktop-full.png');
  });

  it('형식이 맞지 않는 문서는 예외를 던진다 (빌드 실패)', () => {
    mkdirSync(path.join(root, 'public', 'showcase', 'after'), { recursive: true });
    writeFileSync(showcaseFile('after', root), JSON.stringify({ nope: true }));
    expect(() => loadShowcase('after', root)).toThrow();
  });

  it('before, after만 사례 이름이다', () => {
    expect(isShowcaseName('before')).toBe(true);
    expect(isShowcaseName('after')).toBe(true);
    expect(isShowcaseName('sample')).toBe(false);
    expect(isShowcaseName('../sample')).toBe(false);
  });
});

describe('import 대상(--target)', () => {
  it('대상 폴더의 screenshotUrl로 바꾸고 그 경로만 통과시킨다', () => {
    expect(isImportTarget('showcase/before')).toBe(true);
    expect(isImportTarget('showcase/other')).toBe(false);
    expect(screenshotUrlsFor('showcase/after')).toEqual({ desktop: '/showcase/after/desktop-full.png', mobile: '/showcase/after/mobile-full.png' });

    const before = toSampleDocument(sample, 'showcase/before');
    expect(validateSample(before, undefined, 'showcase/before', { requireLayoutMap: false })).toEqual([]);
    // 다른 대상의 경로를 가리키면 거부한다
    expect(validateSample(before, undefined, 'showcase/after').some((p) => p.includes('screenshotUrl'))).toBe(true);
    expect(validateSample(sample, undefined, 'showcase/before').some((p) => p.includes('screenshotUrl'))).toBe(true);
    // screenshotUrl 말고는 바꾸지 않는다
    expect({ ...before, viewports: sample.viewports }).toEqual(sample);
  });
});
