import { describe, expect, it } from 'vitest';
import { buildIssues } from '@/server/detect/pipeline';
import { buildViewportResult, finalizeIssues, type ViewportArtifacts } from '@/server/evidence/finalize';
import type { Viewport } from '@/types/inspection';
import { shuffled } from './helpers/collected';
import { site } from './helpers/site';

// T07: 중간 이슈 → Issue (PRD 8.2, DOMAIN_MODEL 3.3)

/** P-01 mobile처럼 스크린샷이 layoutWidth보다 넓은 경우를 포함한다 */
const SCREENSHOTS = {
  desktop: { screenshotWidth: 1440, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false },
  mobile: { screenshotWidth: 616, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false },
} as const;

function run(input: Record<Viewport, ReturnType<typeof site>> = { desktop: site('desktop'), mobile: site('mobile') }) {
  const result = buildIssues(input);
  const artifacts: Record<Viewport, ViewportArtifacts> = {
    desktop: { collected: input.desktop, screenshot: SCREENSHOTS.desktop },
    mobile: { collected: input.mobile, screenshot: SCREENSHOTS.mobile },
  };
  return { result, issues: finalizeIssues(result.issues, artifacts) };
}

describe('finalizeIssues', () => {
  it('ID, Priority, 측정값, 순서를 바꾸지 않고 Issue 필드를 채운다', () => {
    const { result, issues } = run();
    expect(issues.map((i) => i.id)).toEqual(result.issues.map((i) => i.id));
    expect(issues.map((i) => i.priority)).toEqual(result.issues.map((i) => i.priority));
    expect(issues.map((i) => i.occurrences.map((o) => o.measured))).toEqual(result.issues.map((i) => i.occurrences.map((o) => o.measured)));

    const overlap = issues.find((i) => i.type === 'element-overlap');
    expect(overlap?.title).toBe('Element Overlap — [data-testid="save"] ↔ [data-testid="cancel"]');
    expect(overlap?.occurrences[0].relatedElements).toEqual([
      { role: 'overlap-target', selector: '[data-testid="cancel"]', tag: 'button', boundingBox: { x: 80, y: 304, width: 100, height: 44 } },
    ]);
    // DETECTION_RULES 8.3: Overlap의 crop 기준 박스는 대상 ∪ 상대 = (16, 300)–(180, 348)
    expect(overlap?.occurrences[0].cropRect).toEqual({ x: 0, y: 244, width: 320, height: 160 });

    const pageScroll = issues.find((i) => i.subtype === 'page-scroll');
    expect(pageScroll?.occurrences[0].evidenceText).toBe(
      '요소의 오른쪽 끝(616px)이 Mobile 화면 너비(390px)를 226px 벗어나 페이지 가로 스크롤이 발생합니다. 하위 요소 1개가 함께 화면 밖으로 나갑니다.',
    );
    expect(pageScroll?.affectedDescendants).toBe(1);
    // 박스 (16, 100, 600×100) → 패딩 (-8, 76, 648×148) → 높이 최소 160 (y 70) → 너비는 스크린샷 경계 616 (layoutWidth 390이 아니다)
    expect(pageScroll?.occurrences[0].cropRect).toEqual({ x: 0, y: 70, width: 616, height: 160 });

    const spill = issues.find((i) => i.subtype === 'spill');
    expect(spill?.occurrences[0].relatedElements[0]).toMatchObject({ role: 'bordered-ancestor', selector: '[data-testid="card"]', tag: 'div' });
  });

  it('selector와 sourceHints는 occurrences[0]의 값이고, AI 필드는 비어 있다 (S-5, DOMAIN_MODEL 4.2)', () => {
    for (const issue of run().issues) {
      expect(issue.selector).toBe(issue.occurrences[0].selector);
      expect(issue.sourceHints).toEqual(issue.occurrences[0].sourceHints);
      expect(issue).not.toHaveProperty('analysis');
      expect(issue).not.toHaveProperty('analysisSkippedReason');
    }
  });

  it('결정성: 같은 입력이면 JSON이 같고, 입력 순서를 섞어도 같다', () => {
    const a = JSON.stringify(run().issues);
    expect(JSON.stringify(run().issues)).toBe(a);
    const d = site('desktop');
    const m = site('mobile');
    expect(JSON.stringify(run({ desktop: { ...d, elements: shuffled(d.elements) }, mobile: { ...m, elements: shuffled(m.elements) } }).issues)).toBe(a);
  });

  it('입력(중간 이슈, 수집 데이터)을 바꾸지 않는다', () => {
    const input = { desktop: site('desktop'), mobile: site('mobile') };
    const result = buildIssues(input);
    const before = JSON.stringify({ input, result });
    const issues = finalizeIssues(result.issues, {
      desktop: { collected: input.desktop, screenshot: SCREENSHOTS.desktop },
      mobile: { collected: input.mobile, screenshot: SCREENSHOTS.mobile },
    });
    issues[0].occurrences[0].measured.x = 1;
    issues[0].sourceHints.stableAttributes.x = 'y';
    expect(JSON.stringify({ input, result })).toBe(before);
  });

  it('occurrence의 viewport 수집 데이터가 없으면 예외', () => {
    const { result } = run();
    expect(() => finalizeIssues(result.issues, { desktop: null, mobile: null })).toThrow();
  });
});

describe('buildViewportResult', () => {
  it('PRD 8.2 ViewportResult를 만든다', () => {
    const c = site('mobile');
    const vr = buildViewportResult(
      { ...c, innerWidth: 616, innerHeight: 1334 },
      { screenshotWidth: 616, screenshotHeight: 1334, documentHeight: 1334, screenshotTruncated: false },
      { overlaysDetected: ['#banner'] },
      'https://blob.example/mobile.png',
    );
    expect(vr).toEqual({
      width: 390,
      height: 844,
      innerWidth: 616,
      layoutWidth: 390,
      hasMetaViewport: true,
      documentHeight: 1334,
      screenshotUrl: 'https://blob.example/mobile.png',
      screenshotWidth: 616,
      screenshotHeight: 1334,
      screenshotTruncated: false,
      elementsInspected: c.elements.length,
      elementsTruncated: false,
      hasCanvas: false,
      overlaysDetected: ['#banner'],
    });
  });
});
