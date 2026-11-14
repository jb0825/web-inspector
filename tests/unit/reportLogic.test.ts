import { describe, expect, it } from 'vitest';
import { ANALYSIS_SOURCE_LABELS, ANALYSIS_UNAVAILABLE_MESSAGES, NO_ISSUES_MESSAGES, SCOPE_NOTICE_MESSAGES, SHARE_DISCLOSURE, TASK_TAB_MESSAGES } from '@/components/inspection/labels';
import { buildIssueList, EMPTY_FILTER, isViewportFilterAvailable, issueTarget, sortIssues, summarizeIssues } from '@/features/report/logic/issues';
import { layoutMarkers, placeBox } from '@/features/report/logic/markers';
import { buildScopeNotices } from '@/features/report/logic/scope';
import { parseSelection, selectionSearch } from '@/features/report/logic/selection';
import type { Inspection, ViewportResult } from '@/types/inspection';
import { pendingDoc } from './helpers/inspection';
import { issue, occurrence } from './helpers/issue';
import { P01_ISSUE, P01_VIEWPORTS } from './helpers/p01';

const params = (query: string) => new URLSearchParams(query);

describe('parseSelection (WIREFRAME 8장)', () => {
  const doc = { issues: [issue({ id: 'ISS-001' })], tasks: [{ id: 'TASK-001' }] } as unknown as Pick<Inspection, 'issues' | 'tasks'>;

  it('tab, issue, task를 읽는다', () => {
    expect(parseSelection(params('tab=tasks&issue=ISS-001&task=TASK-001'), doc)).toEqual({ tab: 'tasks', issueId: 'ISS-001', taskId: 'TASK-001' });
  });

  it('없는 ID와 모르는 tab은 무시한다', () => {
    expect(parseSelection(params('tab=other&issue=ISS-999&task=TASK-404'), doc)).toEqual({ tab: 'issues', issueId: null, taskId: null });
  });

  it('문서가 아직 없으면 ID를 고르지 않는다', () => {
    expect(parseSelection(params('issue=ISS-001'), null).issueId).toBeNull();
  });

  it('기본값은 query에 넣지 않는다', () => {
    expect(selectionSearch({ tab: 'issues', issueId: null, taskId: null })).toBe('');
    expect(selectionSearch({ tab: 'tasks', issueId: 'ISS-002', taskId: 'TASK-001' })).toBe('?tab=tasks&issue=ISS-002&task=TASK-001');
  });
});

describe('summarizeIssues (PRD 7.3)', () => {
  it('Needs Review를 전체·Priority·viewport 개수에서 모두 뺀다', () => {
    const summary = summarizeIssues([
      issue({ id: 'ISS-001', priority: 'P0', viewportTag: 'mobile-only' }),
      issue({ id: 'ISS-002', priority: 'P1', viewportTag: 'both' }),
      issue({ id: 'ISS-003', priority: 'P1', viewportTag: 'desktop-only', needsReview: true }),
    ]);
    expect(summary).toEqual({ total: 2, byPriority: { P0: 1, P1: 1, P2: 0, P3: 0 }, byViewport: { desktop: 1, mobile: 2 }, needsReview: 1 });
  });
});

describe('정렬과 필터 (WIREFRAME 5.8~5.10)', () => {
  const issues = [
    issue({ id: 'ISS-003', priority: 'P2', type: 'text-overflow', subtype: 'clipped', viewportTag: 'both' }),
    issue({ id: 'ISS-001', priority: 'P1', type: 'element-overlap', subtype: 'interactive', viewportTag: 'mobile-only' }),
    issue({ id: 'ISS-002', priority: 'P1', type: 'text-overflow', subtype: 'spill', viewportTag: 'mobile-only' }),
    issue({ id: 'ISS-004', priority: 'P0', viewportTag: 'desktop-only', needsReview: true }),
  ];

  it('Priority → Issue ID 순으로 정렬하고 입력을 바꾸지 않는다', () => {
    const copy = [...issues];
    expect(sortIssues(issues).map((i) => i.id)).toEqual(['ISS-004', 'ISS-001', 'ISS-002', 'ISS-003']);
    expect(issues).toEqual(copy);
  });

  it('필터가 없으면 일반 이슈 다음에 Needs Review 번호가 이어진다', () => {
    const list = buildIssueList(issues, EMPTY_FILTER);
    expect(list.regular.map((l) => [l.issue.id, l.number])).toEqual([['ISS-001', 1], ['ISS-002', 2], ['ISS-003', 3]]);
    expect(list.needsReview.map((l) => [l.issue.id, l.number])).toEqual([['ISS-004', 4]]);
  });

  it('Priority, Category, Viewport 필터를 조합한다', () => {
    const list = buildIssueList(issues, { priority: 'P1', type: 'text-overflow', viewportTag: 'mobile-only' });
    expect(list.regular.map((l) => l.issue.id)).toEqual(['ISS-002']);
    expect(list.regular[0]!.number).toBe(1);
    expect(list.regularTotal).toBe(3);
    expect(list.needsReview).toEqual([]);
    expect(list.needsReviewTotal).toBe(1);
  });

  it('조건에 맞는 이슈가 없으면 빈 목록', () => {
    expect(buildIssueList(issues, { ...EMPTY_FILTER, priority: 'P3' }).regular).toEqual([]);
  });

  it('한 viewport가 실패하면 Viewport 필터를 숨긴다', () => {
    expect(isViewportFilterAvailable({ desktop: null, mobile: null })).toBe(true);
    expect(isViewportFilterAvailable({ desktop: null, mobile: { code: 'NAVIGATION_TIMEOUT', message: '' } })).toBe(false);
  });
});

describe('issueTarget (WIREFRAME 5.9)', () => {
  it('태그 + 텍스트 앞부분, 길면 말줄임하고 전체는 full에 둔다', () => {
    const target = issueTarget({
      ...issue(),
      sourceHints: { htmlSnippet: '<BUTTON class="cta">', textSnippet: '지금 무료로 시작하고 첫 달 요금을 돌려받으세요 지금', stableAttributes: {}, ancestorPath: 'body' },
    });
    expect(target.label).toBe('button "지금 무료로 시작하고 첫 달 요금을 돌려받으…"');
    expect(target.full).toBe('button "지금 무료로 시작하고 첫 달 요금을 돌려받으세요 지금"');
  });

  it('텍스트가 없으면 selector', () => {
    expect(issueTarget(issue()).label).toBe('.target');
  });

  it('Element Overlap은 상대 요소를 붙인다', () => {
    const overlap = issue({
      type: 'element-overlap',
      occurrences: [{ relatedElements: [{ role: 'overlap-target', selector: '#cancel', tag: 'a', boundingBox: { x: 0, y: 0, width: 1, height: 1 } }] }],
    });
    expect(issueTarget(overlap)).toEqual({ label: '.target ↔ a', full: '.target ↔ #cancel' });
  });
});

describe('마커 좌표 (WIREFRAME 5.6, DETECTION_RULES 8.3)', () => {
  const shot = { screenshotWidth: 1440, screenshotHeight: 900 };

  it('boundingBox를 스크린샷 좌표 그대로 쓴다', () => {
    expect(placeBox({ x: 10, y: 20, width: 100, height: 40 }, shot)).toEqual({ rect: { x: 10, y: 20, width: 100, height: 40 }, clipped: false });
  });

  it('y가 스크린샷 높이 이상이면 범위 밖(null)', () => {
    expect(placeBox({ x: 0, y: 900, width: 10, height: 10 }, shot)).toBeNull();
  });

  it('가로로 나간 박스(hidden-clip)는 스크린샷 안으로 자른다', () => {
    // P-04 Desktop: x 1084, width 400 → 1440에서 잘림
    expect(placeBox({ x: 1084, y: 163.39, width: 400, height: 300 }, shot)).toEqual({ rect: { x: 1084, y: 163.39, width: 356, height: 300 }, clipped: true });
  });

  it('완전히 가로 밖이면 그리지 않는다', () => {
    expect(placeBox({ x: 1500, y: 10, width: 50, height: 50 }, shot)).toBeNull();
  });

  it('P-01 Mobile: 축소된 616px 스크린샷의 viewBox에 boundingBox를 그대로 그린다', () => {
    const mobile = P01_VIEWPORTS.mobile as ViewportResult;
    const listed = buildIssueList([P01_ISSUE], EMPTY_FILTER);
    const layout = layoutMarkers(listed, 'mobile', mobile, { includeNeedsReview: false });
    expect(layout.viewBox).toEqual({ width: 616, height: 1334 });
    expect(layout.markers).toHaveLength(1);
    expect(layout.markers[0]!.rect).toEqual(P01_ISSUE.occurrences[0]!.boundingBox);
    expect(layoutMarkers(listed, 'desktop', P01_VIEWPORTS.desktop as ViewportResult, { includeNeedsReview: false }).issueCount).toBe(0);
  });

  it('범위 밖 개수를 세고, Needs Review는 펼쳤을 때만 넣는다', () => {
    const issues = [
      issue({ id: 'ISS-001', viewportTag: 'desktop-only', occurrences: [{ boundingBox: { x: 0, y: 950, width: 10, height: 10 } }] }),
      issue({ id: 'ISS-002', viewportTag: 'desktop-only' }),
      issue({ id: 'ISS-003', viewportTag: 'desktop-only', needsReview: true }),
    ];
    const listed = buildIssueList(issues, EMPTY_FILTER);
    const closed = layoutMarkers(listed, 'desktop', shot, { includeNeedsReview: false });
    expect(closed).toMatchObject({ outOfRange: 1, issueCount: 2 });
    expect(closed.markers.map((m) => [m.issueId, m.number])).toEqual([['ISS-002', 2]]);
    const open = layoutMarkers(listed, 'desktop', shot, { includeNeedsReview: true });
    expect(open.markers.map((m) => [m.issueId, m.number, m.needsReview])).toEqual([['ISS-002', 2, false], ['ISS-003', 3, true]]);
  });
});

describe('buildScopeNotices (WIREFRAME 5.4)', () => {
  const viewport = (overrides: Partial<ViewportResult> = {}): ViewportResult => ({ ...(P01_VIEWPORTS.desktop as ViewportResult), ...overrides });
  const base = pendingDoc({ status: 'completed', viewports: { desktop: viewport(), mobile: viewport({ width: 390, layoutWidth: 390 }) }, analysis: { status: 'completed', analyzedIssueCount: 0 } });

  it('해당 항목이 없으면 빈 배열', () => {
    expect(buildScopeNotices(base)).toEqual([]);
  });

  it('조건별 문구를 만든다', () => {
    const doc: Inspection = {
      ...base,
      status: 'partial',
      viewports: { desktop: viewport({ screenshotTruncated: true, screenshotHeight: 10000, elementsTruncated: true, elementsInspected: 3000, hasCanvas: true, overlaysDetected: ['#cookie'] }), mobile: null },
      viewportErrors: { desktop: null, mobile: { code: 'NAVIGATION_TIMEOUT', message: '' } },
      issuesDetected: 240,
      issuesTruncated: true,
      issues: Array.from({ length: 200 }, (_, i) => issue({ id: `ISS-${i}` })),
    };
    const texts = buildScopeNotices(doc).map((n) => [n.kind, n.text]);
    expect(texts).toEqual([
      ['viewport-failed', 'Mobile 검사에 실패했습니다: 제한 시간 안에 페이지를 불러오지 못했습니다. Desktop 결과만 표시합니다.'],
      ['screenshot-truncated', 'Desktop 스크린샷은 10,000px까지만 저장되었습니다. (측정은 전체 페이지)'],
      ['elements-truncated', '요소가 많아 Desktop 문서 앞쪽 3,000개만 검사했습니다.'],
      ['issues-truncated', '이슈가 240개 발견되어 우선순위가 높은 상위 200개만 표시합니다.'],
      ['canvas', SCOPE_NOTICE_MESSAGES.canvas],
      ['overlays', 'Desktop 화면을 크게 덮는 고정 요소가 있어 겹침 판정에서 제외했습니다: #cookie'],
    ]);
  });

  it('meta viewport가 없으면 측정한 Mobile 너비를 쓴다', () => {
    const doc = { ...base, viewports: { ...base.viewports, mobile: viewport({ hasMetaViewport: false, layoutWidth: 980 }) } };
    expect(buildScopeNotices(doc)).toEqual([{ kind: 'no-meta-viewport', viewport: 'mobile', text: '이 페이지에는 meta viewport가 없어 Mobile 화면 너비가 980px로 측정되었습니다.' }]);
  });

  it('분석 실패: 태스크가 없으면 태스크를 언급하지 않는다', () => {
    const failed = { ...base, analysis: { status: 'failed' as const, analyzedIssueCount: 0 } };
    expect(buildScopeNotices(failed)[0]!.text).toBe(SCOPE_NOTICE_MESSAGES.analysisFailedWithoutTasks);
    const withTasks = { ...failed, tasks: [{} as Inspection['tasks'][number]] };
    expect(buildScopeNotices(withTasks)[0]!.text).toBe(SCOPE_NOTICE_MESSAGES.analysisFailedWithTasks);
  });
});

describe('결과 화면 문구 (PRD 5.7.1)', () => {
  it('"AI"는 source가 ai일 때의 출처 라벨에만 쓴다', () => {
    const texts = [
      ANALYSIS_SOURCE_LABELS.rule,
      ...Object.values(ANALYSIS_UNAVAILABLE_MESSAGES),
      ...Object.values(TASK_TAB_MESSAGES),
      ...Object.values(NO_ISSUES_MESSAGES),
      SHARE_DISCLOSURE,
      ...Object.values(SCOPE_NOTICE_MESSAGES).map((m) => (typeof m === 'string' ? m : (m as (...args: string[]) => string)('A', 'B', 'C'))),
    ];
    for (const text of texts) expect(text).not.toMatch(/AI/);
    expect(ANALYSIS_SOURCE_LABELS.ai).toContain('AI');
  });
});

describe('helpers', () => {
  it('occurrence 헬퍼 기본값', () => {
    expect(occurrence().viewport).toBe('mobile');
  });
});
