import { describe, expect, it } from 'vitest';
import { buildIssues } from '@/server/detect/pipeline';
import { buildViewportResult, finalizeIssues } from '@/server/evidence/finalize';
import { analyzeIssueByRules } from '@/server/analysis/rules';
import { assertInspectionInvariants, findInspectionViolations, InvariantError, type InvariantStage } from '@/server/store/invariants';
import { buildTasks } from '@/server/tasks/build';
import type { Inspection, Issue } from '@/types/inspection';
import { site } from './helpers/site';

// DOMAIN_MODEL 3.1 (I-1~I-11), 3.2 (V-1~V-3), 3.3 (S-1~S-13), 3.4 (T-1~T-8), 규칙 분석 A-1·A-2(T10).
// 조건마다 통과 1개, 위반 1개 이상

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

/** 분석 단계가 끝난 정상 Inspection: needsReview가 아닌 이슈에는 규칙 분석, 태스크와 프롬프트까지 만든다 */
function finalValid(): Inspection {
  const inspection = valid();
  inspection.status = 'completed';
  // I-6, I-8: AI 단계가 끝난 문서
  inspection.analysis = { status: 'completed', analyzedIssueCount: inspection.issues.filter((i) => !i.needsReview).length };
  inspection.completedAt = '2026-11-13T00:05:00.000Z';
  for (const issue of inspection.issues) {
    if (issue.needsReview) issue.analysisSkippedReason = 'needs-review';
    else issue.analysis = analyzeIssueByRules(issue);
  }
  inspection.tasks = buildTasks(inspection.issues, inspection.viewports);
  return inspection;
}

const ids = (inspection: Inspection, stage: InvariantStage = 'browser') => findInspectionViolations(inspection, stage).map((v) => v.id);

/** 이슈 하나를 바꾼 사본으로 검사 */
function violatesWith(mutate: (inspection: Inspection, issues: Issue[]) => void, stage: InvariantStage = 'browser') {
  const inspection = stage === 'final' ? finalValid() : valid();
  mutate(inspection, inspection.issues);
  if (stage === 'final') {
    // 이슈를 바꾼 뒤에도 태스크와 analyzedIssueCount는 새 이슈 기준으로 다시 만든다(이슈 조건만 확인하기 위해서)
    inspection.tasks = buildTasks(inspection.issues, inspection.viewports);
    inspection.analysis.analyzedIssueCount = inspection.issues.filter((i) => i.analysis !== undefined).length;
  }
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
    // Desktop이 실패한 검사: viewportErrors(I-5)와 issuesDetected(I-11)도 그 검사에 맞춘다
    const desktopFailed = (i: Inspection, issues: Issue[]) => {
      i.viewports.desktop = null;
      i.viewportErrors.desktop = { code: 'NAVIGATION_TIMEOUT', message: 'timeout' };
      issues.splice(0, 2);
      i.issuesDetected = issues.length;
    };
    expect(violatesWith((i, issues) => {
      desktopFailed(i, issues);
      issues[0].id = 'ISS-001';
    })).toEqual(['S-4']);
    expect(violatesWith((i, issues) => {
      desktopFailed(i, issues);
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
    // analysis.status가 completed라 일반 이슈에 analysis가 없으면 A-1도 위반이다
    expect(violatesWith((_, issues) => { delete issues[0].analysis; }, 'final')).toEqual(['S-10', 'A-1']);
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

describe('Inspection (3.1)', () => {
  const ERR = { code: 'NAVIGATION_TIMEOUT', message: 'timeout' } as const;
  const pending = (): Inspection => ({
    ...valid(),
    status: 'pending',
    viewports: { desktop: null, mobile: null },
    issues: [],
    issuesDetected: 0,
    issuesTruncated: false,
  });
  const iIds = (inspection: Inspection, stage: InvariantStage = 'browser') => ids(inspection, stage).filter((id) => id.startsWith('I-'));

  it('pending, running, analyzing, failed, completed 정상 문서는 위반이 없다', () => {
    expect(iIds(pending())).toEqual([]);
    expect(iIds({ ...pending(), status: 'running', step: 'rendering_desktop' })).toEqual([]);
    expect(iIds(valid())).toEqual([]);
    // 렌더링 전 실패: viewports와 viewportErrors가 모두 null
    expect(iIds({ ...pending(), status: 'failed', error: { code: 'BROWSER_CRASH', message: 'x' }, completedAt: 'c' })).toEqual([]);
    // 두 viewport 실패
    expect(iIds({ ...pending(), status: 'failed', error: ERR, viewportErrors: { desktop: ERR, mobile: ERR }, completedAt: 'c' })).toEqual([]);
    expect(iIds(finalValid(), 'final')).toEqual([]);
  });

  it('I-1: status 값', () => {
    expect(iIds({ ...valid(), status: 'queued' as Inspection['status'] })).toContain('I-1');
  });

  it('I-2: failed이면 error가 있고, 그 밖에는 없다', () => {
    expect(iIds({ ...pending(), status: 'failed', completedAt: 'c' })).toEqual(['I-2']);
    expect(iIds({ ...valid(), error: ERR })).toEqual(['I-2']);
  });

  it('I-3: pending/running에서는 이슈, 태스크, viewport가 비어 있다', () => {
    expect(iIds({ ...valid(), status: 'running', issuesDetected: 0, issuesTruncated: false })).toContain('I-3');
  });

  it('I-4: analyzing 이후에는 viewport가 하나 이상 있다', () => {
    const v = valid();
    expect(iIds({ ...v, issues: [], issuesDetected: 0, viewports: { desktop: null, mobile: null }, viewportErrors: { desktop: ERR, mobile: ERR } })).toEqual(['I-4']);
  });

  it('I-5: 브라우저 단계 뒤 viewport마다 결과와 오류 중 정확히 하나', () => {
    expect(iIds({ ...valid(), viewportErrors: { desktop: ERR, mobile: null } })).toEqual(['I-5']);
    expect(iIds({ ...pending(), status: 'failed', error: ERR, viewportErrors: { desktop: ERR, mobile: null }, completedAt: 'c' })).toEqual(['I-5']);
  });

  it('I-6: completed이면 viewport 오류가 없고 analysis는 completed 또는 skipped', () => {
    const f = finalValid();
    expect(iIds({ ...f, analysis: { status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: 'x' } } }, 'final')).toEqual(['I-6']);
  });

  it('I-7: partial이면 viewport 오류나 analysis 실패가 있다', () => {
    expect(iIds({ ...finalValid(), status: 'partial' }, 'final')).toEqual(['I-7']);
    expect(iIds({ ...finalValid(), status: 'partial', analysis: { status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: 'x' } } }, 'final')).toEqual([]);
  });

  it('I-8: 종료 상태에는 completedAt이 있다', () => {
    const f = finalValid();
    delete f.completedAt;
    expect(iIds(f, 'final')).toEqual(['I-8']);
  });

  it('I-9: AI 단계가 끝났고 이슈가 0개면 analysis는 skipped, tasks는 비어 있다', () => {
    const noIssues = { ...finalValid(), issues: [], issuesDetected: 0, tasks: [] };
    expect(iIds(noIssues, 'final')).toEqual(['I-9']);
    expect(iIds({ ...noIssues, analysis: { status: 'skipped', analyzedIssueCount: 0 } }, 'final')).toEqual([]);
    // analyzing에서는 이슈가 0개여도 analysis가 pending이다 (analyze가 skipped로 바꾼다)
    expect(iIds({ ...valid(), issues: [], issuesDetected: 0 })).toEqual([]);
  });

  it('I-10: analysis.error가 있으면 analysis.status = failed, code = AI_FAILED', () => {
    expect(iIds({ ...valid(), analysis: { status: 'pending', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: 'x' } } })).toEqual(['I-10']);
    expect(iIds({ ...finalValid(), status: 'partial', analysis: { status: 'failed', analyzedIssueCount: 0, error: { code: 'INTERNAL_ERROR', message: 'x' } } }, 'final')).toEqual(['I-10']);
  });

  it('I-11: 이슈 수 상한 정보', () => {
    expect(iIds({ ...valid(), issuesDetected: 2 })).toContain('I-11');
    expect(iIds({ ...valid(), issuesDetected: 10, issuesTruncated: false })).toEqual(['I-11']);
    expect(iIds({ ...valid(), issuesDetected: 10, issuesTruncated: true })).toEqual([]);
    expect(iIds({ ...pending(), issuesDetected: 1, issuesTruncated: true })).toEqual(['I-11']);
  });
});

describe('DevTask (3.4)', () => {
  /** 태스크만 바꾼 사본 (태스크를 다시 만들지 않는다) */
  function taskIds(mutate: (inspection: Inspection) => void) {
    const inspection = finalValid();
    mutate(inspection);
    return ids(inspection, 'final');
  }

  it('정상: 이슈 3개(겹침, spill, page-scroll)가 태스크로 묶인다 (landmark 없음 + both인 ISS-001, ISS-002는 한 그룹)', () => {
    const inspection = finalValid();
    expect(inspection.tasks.map((t) => `${t.id} ${t.priority} ${t.viewportTag} [${t.issueIds.join(',')}]`)).toEqual([
      'TASK-001 P0 both [ISS-001,ISS-002]',
      'TASK-002 P0 mobile-only [ISS-003]',
    ]);
    expect(ids(inspection, 'final')).toEqual([]);
  });

  it('T-1: 일반 이슈는 일반 태스크 정확히 하나에 속한다', () => {
    expect(taskIds((i) => { i.tasks.splice(1, 1); })).toEqual(['T-1']);
    expect(taskIds((i) => { i.tasks[1].issueIds = ['ISS-001', 'ISS-003']; })).toContain('T-1');
    expect(taskIds((i) => { i.tasks[0].needsReview = true; })).toContain('T-1');
  });

  it('T-2: Needs Review 이슈는 Needs Review 태스크에 속한다', () => {
    const inspection = finalValid();
    const issue = inspection.issues[0];
    issue.occurrences[1].confidence = 0.4;
    Object.assign(issue, { confidence: 0.4, needsReview: true, analysisSkippedReason: 'needs-review' });
    delete issue.analysis;
    inspection.analysis.analyzedIssueCount = 2;
    // 태스크를 다시 만들지 않으면 Needs Review 이슈가 일반 태스크에 남는다
    expect(ids(inspection, 'final')).toContain('T-2');
    inspection.tasks = buildTasks(inspection.issues, inspection.viewports);
    expect(ids(inspection, 'final')).toEqual([]);
    expect(inspection.tasks.at(-1)?.needsReview).toBe(true);
  });

  it('T-3: issueIds는 1~8개, 존재하는 ID, 오름차순', () => {
    expect(taskIds((i) => { i.tasks[0].issueIds = []; })).toContain('T-3');
    expect(taskIds((i) => { i.tasks[0].issueIds = ['ISS-001', 'ISS-009']; })).toContain('T-3');
    expect(taskIds((i) => {
      i.tasks.splice(1, 1);
      i.tasks[0].issueIds = ['ISS-003', 'ISS-001'];
    })).toContain('T-3');
  });

  it('T-4: priority는 가장 높은 이슈의 Priority', () => {
    expect(taskIds((i) => { i.tasks[0].priority = 'P1'; })).toContain('T-4');
  });

  it('T-5: TASK-001부터 이어지고 needsReview → Priority → 가장 작은 Issue ID 순', () => {
    expect(taskIds((i) => { i.tasks[1].id = 'TASK-005'; })).toEqual(['T-5']);
    expect(taskIds((i) => {
      i.tasks.reverse();
      i.tasks.forEach((t, n) => { t.id = `TASK-00${n + 1}`; });
    })).toEqual(['T-5']);
  });

  it('T-6: Needs Review 태스크는 템플릿 제목', () => {
    const inspection = finalValid();
    const issue = inspection.issues[1];
    issue.occurrences.forEach((o) => { o.confidence = 0.4; });
    Object.assign(issue, { confidence: 0.4, needsReview: true, analysisSkippedReason: 'needs-review' });
    delete issue.analysis;
    inspection.analysis.analyzedIssueCount = 2;
    inspection.tasks = buildTasks(inspection.issues, inspection.viewports);
    expect(ids(inspection, 'final')).toEqual([]);
    const review = inspection.tasks.find((t) => t.needsReview);
    if (review) review.titleSource = 'ai';
    expect(ids(inspection, 'final')).toEqual(['T-6']);
  });

  it('T-7: acceptanceCriteria는 1개 이상', () => {
    expect(taskIds((i) => { i.tasks[0].acceptanceCriteria = []; })).toEqual(['T-7']);
  });

  it('T-8: prompt는 비어 있지 않고 모든 Issue ID를 담는다', () => {
    expect(taskIds((i) => { i.tasks[0].prompt = ''; })).toContain('T-8');
    expect(taskIds((i) => { i.tasks[0].prompt = i.tasks[0].prompt.replaceAll('ISS-001', 'ISS-0O1'); })).toEqual(['T-8']);
  });

  it('분석 단계가 실패했거나 멈춘 문서는 tasks가 비어 있어도 T-1/T-2 위반이 아니다', () => {
    const inspection = finalValid();
    inspection.status = 'partial';
    inspection.analysis = { status: 'failed', analyzedIssueCount: 0, error: { code: 'AI_FAILED', message: 'x' } };
    inspection.tasks = [];
    for (const issue of inspection.issues) {
      delete issue.analysis;
      issue.analysisSkippedReason = issue.needsReview ? 'needs-review' : 'ai-failed';
    }
    expect(ids(inspection, 'final')).toEqual([]);
  });
});

describe('규칙 분석 (A-1, A-2, T10)', () => {
  it('A-1: analysis completed면 일반 이슈의 analysis는 source rule이고 confirmed가 아니다', () => {
    expect(violatesWith((_, issues) => { if (issues[0].analysis) issues[0].analysis.source = 'ai'; }, 'final')).toEqual(['A-1']);
    expect(violatesWith((_, issues) => { if (issues[0].analysis) issues[0].analysis.certainty = 'confirmed'; }, 'final')).toEqual(['A-1']);
  });

  it('A-2: analyzedIssueCount는 analysis가 있는 이슈 수', () => {
    const inspection = finalValid();
    inspection.analysis.analyzedIssueCount = 1;
    expect(ids(inspection, 'final')).toEqual(['A-2']);
  });
});
