import { describe, expect, it } from 'vitest';
import { buildIssues } from '@/server/detect/pipeline';
import { buildViewportResult, finalizeIssues } from '@/server/evidence/finalize';
import { assertInspectionInvariants, findInspectionViolations, InvariantError, type InvariantStage } from '@/server/store/invariants';
import type { Inspection, Issue } from '@/types/inspection';
import { site } from './helpers/site';

// DOMAIN_MODEL 3.2 (V-1~V-3), 3.3 (S-1~S-13). 조건마다 통과 1개, 위반 1개 이상

const SHOT = { screenshotWidth: 1440, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false };
const SHOT_MOBILE = { screenshotWidth: 616, screenshotHeight: 2000, documentHeight: 2000, screenshotTruncated: false };

/** 브라우저 단계가 끝난 정상 Inspection (이슈 3개: overlap ISS-001, spill ISS-002, page-scroll ISS-003) */
function valid(): Inspection {
  const desktop = site('desktop');
  const mobile = site('mobile');
  const result = buildIssues({ desktop, mobile });
  const issues = finalizeIssues(result.issues, {
    desktop: { collected: desktop, screenshot: SHOT },
    mobile: { collected: mobile, screenshot: SHOT_MOBILE },
  });
  const at = '2026-11-13T00:00:00.000Z';
  return {
    id: 'test',
    url: 'https://example.com/',
    status: 'analyzing',
    createdAt: at,
    updatedAt: at,
    viewports: {
      desktop: buildViewportResult(desktop, SHOT, result.viewports.desktop ?? { overlaysDetected: [] }, 'd.png'),
      mobile: buildViewportResult(mobile, SHOT_MOBILE, result.viewports.mobile ?? { overlaysDetected: [] }, 'm.png'),
    },
    viewportErrors: { desktop: null, mobile: null },
    analysis: { status: 'pending', analyzedIssueCount: 0 },
    issuesDetected: result.issuesDetected,
    issuesTruncated: result.issuesTruncated,
    issues,
    tasks: [],
  };
}

/** AI 단계가 끝난 정상 Inspection: needsReview가 아닌 이슈에는 analysis를 둔다 */
function finalValid(): Inspection {
  const inspection = valid();
  inspection.status = 'completed';
  for (const issue of inspection.issues) {
    if (issue.needsReview) issue.analysisSkippedReason = 'needs-review';
    else issue.analysis = { rootCause: 'r', certainty: 'likely', cssProblem: 'c', fixDirection: 'f', suggestedFix: 's' };
  }
  return inspection;
}

const ids = (inspection: Inspection, stage: InvariantStage = 'browser') => findInspectionViolations(inspection, stage).map((v) => v.id);

/** 이슈 하나를 바꾼 사본으로 검사 */
function violatesWith(mutate: (inspection: Inspection, issues: Issue[]) => void, stage: InvariantStage = 'browser') {
  const inspection = stage === 'final' ? finalValid() : valid();
  mutate(inspection, inspection.issues);
  return ids(inspection, stage);
}

describe('정상 입력', () => {
  it('browser 단계 결과는 위반이 없다', () => {
    const inspection = valid();
    expect(inspection.issues.map((i) => `${i.id} ${i.type}/${i.subtype}`)).toEqual([
      'ISS-001 element-overlap/interactive',
      'ISS-002 text-overflow/spill',
      'ISS-003 viewport-overflow/page-scroll',
    ]);
    expect(ids(inspection)).toEqual([]);
    expect(() => assertInspectionInvariants(inspection, 'browser')).not.toThrow();
  });

  it('final 단계 결과는 위반이 없다', () => {
    expect(ids(finalValid(), 'final')).toEqual([]);
  });

  it('위반이면 조건 ID와 값을 담은 InvariantError를 던진다', () => {
    const inspection = valid();
    inspection.issues[0].priority = 'P3';
    try {
      assertInspectionInvariants(inspection, 'browser');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvariantError);
      expect((error as InvariantError).violations).toEqual([{ id: 'S-7', message: 'ISS-001: priority P3 ≠ P0' }]);
      expect((error as Error).message).toContain('S-7: ISS-001: priority P3 ≠ P0');
    }
  });
});

describe('ViewportResult (3.2)', () => {
  it('V-1: 설정 크기', () => {
    expect(violatesWith((i) => { if (i.viewports.mobile) i.viewports.mobile.width = 375; })).toEqual(['V-1']);
  });

  it('V-2: 높이 상한과 screenshotTruncated', () => {
    expect(violatesWith((i) => {
      if (i.viewports.mobile) Object.assign(i.viewports.mobile, { screenshotHeight: 5001, documentHeight: 5001 });
    })).toEqual(['V-2']);
    expect(violatesWith((i) => { if (i.viewports.desktop) i.viewports.desktop.screenshotTruncated = true; })).toEqual(['V-2']);
    // 잘린 경우는 정상
    expect(violatesWith((i) => {
      if (i.viewports.mobile) Object.assign(i.viewports.mobile, { screenshotHeight: 5000, documentHeight: 9000, screenshotTruncated: true });
    })).toEqual([]);
  });

  it('V-3: elementsTruncated이면 elementsInspected = MAX_CANDIDATES', () => {
    expect(violatesWith((i) => { if (i.viewports.desktop) i.viewports.desktop.elementsTruncated = true; })).toEqual(['V-3']);
    expect(violatesWith((i) => { if (i.viewports.desktop) Object.assign(i.viewports.desktop, { elementsTruncated: true, elementsInspected: 3000 }); })).toEqual([]);
  });
});

describe('Issue (3.3)', () => {
  it('S-1: ID는 ISS-001부터 빈 번호 없이', () => {
    expect(violatesWith((_, issues) => { issues[2].id = 'ISS-004'; })).toContain('S-1');
    expect(violatesWith((_, issues) => issues.reverse())).toContain('S-1');
  });

  it('S-2: occurrence 1~2개, [desktop, mobile]', () => {
    expect(violatesWith((_, issues) => issues[0].occurrences.reverse())).toContain('S-2');
    expect(violatesWith((_, issues) => { issues[0].occurrences = []; })).toContain('S-2');
  });

  it('S-3: viewports = occurrence viewport 목록, 실패한 viewport 없음', () => {
    expect(violatesWith((_, issues) => { issues[2].viewports = ['desktop', 'mobile']; })).toContain('S-3');
    expect(violatesWith((i) => { i.viewports.desktop = null; })).toContain('S-3');
  });

  it('S-4: viewportTag', () => {
    expect(violatesWith((_, issues) => { issues[0].viewportTag = 'desktop-only'; })).toEqual(['S-4']);
    // 한 viewport가 실패한 검사에서는 null이어야 한다
    expect(violatesWith((i, issues) => {
      i.viewports.desktop = null;
      issues.splice(0, 2);
      issues[0].id = 'ISS-001';
    })).toEqual(['S-4']);
    expect(violatesWith((i, issues) => {
      i.viewports.desktop = null;
      issues.splice(0, 2);
      Object.assign(issues[0], { id: 'ISS-001', viewportTag: null });
    })).toEqual([]);
  });

  it('S-5: selector, sourceHints = occurrences[0]', () => {
    expect(violatesWith((_, issues) => { issues[0].selector = '.other'; })).toEqual(['S-5']);
    expect(violatesWith((_, issues) => { issues[0].sourceHints = { ...issues[0].sourceHints, landmark: 'x' }; })).toEqual(['S-5']);
  });

  it('S-6: relatedIssueIds 존재, 자기 자신 아님, 대칭, 오름차순', () => {
    expect(violatesWith((_, issues) => { issues[0].relatedIssueIds = ['ISS-009']; })).toContain('S-6');
    expect(violatesWith((_, issues) => { issues[0].relatedIssueIds = ['ISS-001']; })).toContain('S-6');
    expect(violatesWith((_, issues) => { issues[0].relatedIssueIds = ['ISS-002']; })).toEqual(['S-6']);
    expect(violatesWith((_, issues) => {
      issues[0].relatedIssueIds = ['ISS-003', 'ISS-002'];
      issues[1].relatedIssueIds = ['ISS-001'];
      issues[2].relatedIssueIds = ['ISS-001'];
    })).toEqual(['S-6']);
    expect(violatesWith((_, issues) => {
      issues[1].relatedIssueIds = ['ISS-003'];
      issues[2].relatedIssueIds = ['ISS-002'];
    })).toEqual([]);
  });

  it('S-7: score100 공식, priority 경계, S/I/R 범위', () => {
    expect(violatesWith((_, issues) => { issues[0].scores.score100 += 1; })).toContain('S-7');
    expect(violatesWith((_, issues) => { issues[0].priority = 'P1'; })).toEqual(['S-7']);
    expect(violatesWith((_, issues) => { issues[0].scores = { S: 6, I: 4, R: 3, score100: 6 * 35 + 4 * 35 + 3 * 30 }; })).toEqual(['S-7']);
  });

  it('S-8: confidence = min, needsReview = confidence < 0.5', () => {
    expect(violatesWith((_, issues) => { issues[0].confidence = 0.4; })).toContain('S-8');
    expect(violatesWith((_, issues) => { issues[0].needsReview = true; })).toEqual(['S-8']);
    expect(violatesWith((_, issues) => {
      issues[0].occurrences[1].confidence = 0.4;
      Object.assign(issues[0], { confidence: 0.4, needsReview: true });
    })).toEqual([]);
  });

  it('S-9 (browser): AI 필드가 비어 있어야 한다', () => {
    expect(violatesWith((_, issues) => { issues[0].analysisSkippedReason = 'needs-review'; })).toEqual(['S-9']);
  });

  it('S-9 (final): needsReview이면 analysis 없이 needs-review', () => {
    expect(violatesWith((_, issues) => {
      issues[0].occurrences[1].confidence = 0.4;
      Object.assign(issues[0], { confidence: 0.4, needsReview: true });
    }, 'final')).toEqual(['S-9']);
    expect(violatesWith((_, issues) => {
      issues[0].occurrences[1].confidence = 0.4;
      Object.assign(issues[0], { confidence: 0.4, needsReview: true, analysis: undefined, analysisSkippedReason: 'needs-review' });
      delete issues[0].analysis;
    }, 'final')).toEqual([]);
  });

  it('S-10 (final): analysis와 analysisSkippedReason 중 정확히 하나', () => {
    expect(violatesWith((_, issues) => { delete issues[0].analysis; }, 'final')).toEqual(['S-10']);
    expect(violatesWith((_, issues) => { issues[0].analysisSkippedReason = 'limit-exceeded'; }, 'final')).toEqual(['S-10']);
  });

  it('S-11: cropRect는 스크린샷 안 (innerWidth/layoutWidth가 아니라 screenshotWidth 기준)', () => {
    // page-scroll의 crop 너비 616은 layoutWidth 390보다 넓지만 스크린샷(616) 안이라 정상이다
    expect(valid().issues[2].occurrences[0].cropRect?.width).toBe(616);
    expect(violatesWith((_, issues) => {
      const o = issues[2].occurrences[0];
      if (o.cropRect) o.cropRect.width = 617;
    })).toEqual(['S-11']);
    expect(violatesWith((_, issues) => {
      const o = issues[0].occurrences[0];
      if (o.cropRect) o.cropRect.y = -1;
    })).toEqual(['S-11']);
    expect(violatesWith((_, issues) => { issues[0].occurrences[0].cropRect = null; })).toEqual([]);
  });

  it('S-12: type/subtype 조합', () => {
    expect(violatesWith((_, issues) => { issues[0].subtype = 'clipped'; })).toContain('S-12');
  });

  it('S-13: overlap relatedElements 1~5개, overlap-target, overlapTargetCount ≥ 개수', () => {
    expect(violatesWith((_, issues) => { issues[0].occurrences[0].relatedElements = []; })).toEqual(['S-13']);
    expect(violatesWith((_, issues) => { issues[0].occurrences[0].relatedElements[0].role = 'cause-ancestor'; })).toEqual(['S-13']);
    expect(violatesWith((_, issues) => { issues[0].occurrences[0].measured.overlapTargetCount = 0; })).toEqual(['S-13']);
  });
});
