import { describe, expect, it } from 'vitest';
import { analyzeIssues } from '@/server/analysis/analyze';
import { buildAcceptanceCriteria } from '@/server/tasks/acceptance';
import { buildTasks } from '@/server/tasks/build';
import { groupIssues, MAX_ISSUES_PER_TASK } from '@/server/tasks/group';
import type { Inspection, Issue } from '@/types/inspection';
import { issue, type IssueSpec } from './helpers/issue';
import { P01_ISSUE, P01_VIEWPORTS } from './helpers/p01';
import { shuffled } from './helpers/collected';

// T10: 태스크 그룹화 (PRD 5.8.1 규칙 1~5)와 Acceptance Criteria (PRD 5.8.2)

const id = (n: number) => `ISS-${String(n).padStart(3, '0')}`;
const mk = (n: number, spec: IssueSpec = {}): Issue => issue({ id: id(n), ...spec });
const groups = (issues: Issue[]) => groupIssues(issues).map((t) => `${t.id} ${t.priority} ${t.viewportTag} [${t.issueIds.join(',')}]${t.needsReview ? ' NR' : ''}`);

const VIEWPORTS = P01_VIEWPORTS;

describe('groupIssues (PRD 5.8.1)', () => {
  it('규칙 1: 같은 viewportTag + 같은 landmark끼리 묶는다. landmark 없음도 하나의 값', () => {
    const issues = [
      mk(1, { landmark: 'Hero' }),
      mk(2, { landmark: 'Hero' }),
      mk(3, { landmark: 'Hero', viewportTag: 'both' }),
      mk(4, { landmark: 'Footer' }),
      mk(5),
      mk(6),
    ];
    expect(groups(issues)).toEqual([
      'TASK-001 P2 mobile-only [ISS-001,ISS-002]',
      'TASK-002 P2 both [ISS-003]',
      'TASK-003 P2 mobile-only [ISS-004]',
      'TASK-004 P2 mobile-only [ISS-005,ISS-006]',
    ]);
  });

  it('규칙 2: 연결 이슈는 다른 landmark여도 합친다. 태그는 viewport 합집합, landmark가 다르면 없음', () => {
    const issues = [
      mk(1, { landmark: 'Hero', viewportTag: 'mobile-only', relatedIssueIds: [id(2)] }),
      mk(2, { landmark: 'Nav', viewportTag: 'desktop-only', relatedIssueIds: [id(1)] }),
      mk(3, { landmark: 'Hero', viewportTag: 'mobile-only' }),
    ];
    const [task] = groupIssues(issues);
    expect(task.issueIds).toEqual([id(1), id(2), id(3)]);
    expect(task.viewportTag).toBe('both');
    expect(task.landmark).toBeUndefined();
    expect(task.title).toBe('페이지 영역 Viewport Overflow 수정 (Desktop + Mobile)');
    expect(groupIssues(issues)).toHaveLength(1);
  });

  it('규칙 3: 9개 이슈는 Priority → ID 순으로 8개 + 1개로 나눈다', () => {
    const issues = Array.from({ length: 9 }, (_, i) => mk(i + 1, { landmark: 'Hero', priority: i === 8 ? 'P0' : 'P2' }));
    expect(groups(issues)).toEqual([
      'TASK-001 P0 mobile-only [ISS-001,ISS-002,ISS-003,ISS-004,ISS-005,ISS-006,ISS-007,ISS-009]',
      'TASK-002 P2 mobile-only [ISS-008]',
    ]);
  });

  it('규칙 3: 연결된 이슈가 분할 경계에 걸리면 같은 조각으로 옮긴다', () => {
    // 정렬 순서로는 ISS-008이 첫 조각의 8번째, ISS-009가 두 번째 조각이 된다
    const issues = Array.from({ length: 9 }, (_, i) =>
      mk(i + 1, { landmark: 'Hero', relatedIssueIds: i === 7 ? [id(9)] : i === 8 ? [id(8)] : [] }),
    );
    const tasks = groupIssues(issues);
    expect(tasks.map((t) => t.issueIds)).toEqual([[1, 2, 3, 4, 5, 6, 7].map(id), [id(8), id(9)]]);
    expect(tasks.every((t) => t.issueIds.length <= MAX_ISSUES_PER_TASK)).toBe(true);
  });

  it('규칙 4·5: 태스크 Priority는 가장 높은 이슈, 정렬은 needsReview → Priority → 가장 작은 Issue ID', () => {
    const issues = [
      mk(1, { landmark: 'A', priority: 'P2' }),
      mk(2, { landmark: 'B', priority: 'P1' }),
      mk(3, { landmark: 'A', priority: 'P0' }),
      mk(4, { landmark: 'C', priority: 'P1' }),
      mk(5, { landmark: 'A', priority: 'P0', needsReview: true }),
    ];
    expect(groups(issues)).toEqual([
      'TASK-001 P0 mobile-only [ISS-001,ISS-003]',
      'TASK-002 P1 mobile-only [ISS-002]',
      'TASK-003 P1 mobile-only [ISS-004]',
      'TASK-004 P0 mobile-only [ISS-005] NR',
    ]);
  });

  it('Needs Review 이슈는 같은 landmark여도 일반 이슈와 따로 묶고, 템플릿 제목이다', () => {
    const issues = [mk(1, { landmark: 'Hero' }), mk(2, { landmark: 'Hero', needsReview: true, type: 'element-overlap', subtype: 'other' })];
    const tasks = groupIssues(issues);
    expect(tasks.map((t) => [t.issueIds, t.needsReview])).toEqual([[[id(1)], false], [[id(2)], true]]);
    expect(tasks[1].titleSource).toBe('template');
    expect(tasks[1].title).toBe('Hero 영역 Element Overlap 수정 (Mobile)');
  });

  it('viewportTag null(한 viewport 실패)도 하나의 값으로 묶는다', () => {
    const issues = [mk(1, { viewportTag: null, landmark: 'Hero' }), mk(2, { viewportTag: null, landmark: 'Hero' })];
    const [task] = groupIssues(issues);
    expect(task.issueIds).toEqual([id(1), id(2)]);
    expect(task.viewportTag).toBeNull();
    expect(task.title).toBe('Hero 영역 Viewport Overflow 수정 (비교 불가)');
  });

  it('제목의 type 목록은 Priority → ID 순, description은 Evidence 문장 나열', () => {
    const issues = [
      mk(1, { landmark: 'Hero', type: 'text-overflow', subtype: 'clipped', priority: 'P1', occurrences: [{ evidenceText: '잘림\n문장' }] }),
      mk(2, { landmark: 'Hero', priority: 'P0', occurrences: [{ evidenceText: '넘침 문장' }] }),
    ];
    const [task] = groupIssues(issues);
    expect(task.title).toBe('Hero 영역 Viewport Overflow, Text Overflow 수정 (Mobile)');
    expect(task.description).toBe('- ISS-001 (Mobile): 잘림 문장\n- ISS-002 (Mobile): 넘침 문장');
  });

  it('결정성: 같은 입력을 두 번 넣어도, 입력 순서를 섞어도 tasks JSON이 같다', async () => {
    const issues = Array.from({ length: 20 }, (_, i) =>
      mk(i + 1, {
        landmark: ['A', 'B', undefined][i % 3],
        viewportTag: (['mobile-only', 'both', 'desktop-only'] as const)[i % 3],
        priority: (['P0', 'P1', 'P2', 'P3'] as const)[i % 4],
        needsReview: i % 7 === 0,
        relatedIssueIds: i === 3 ? [id(5)] : i === 4 ? [id(4)] : [],
      }),
    );
    const { issues: analyzed } = await analyzeIssues(issues);
    const once = JSON.stringify(buildTasks(analyzed, VIEWPORTS));
    expect(JSON.stringify(buildTasks(analyzed, VIEWPORTS))).toBe(once);
    expect(JSON.stringify(buildTasks(shuffled(analyzed), VIEWPORTS))).toBe(once);
    expect(JSON.stringify(buildTasks([...analyzed].reverse(), VIEWPORTS))).toBe(once);
  });
});

describe('buildAcceptanceCriteria (PRD 5.8.2)', () => {
  const crit = (issues: Issue[], viewports: Inspection['viewports'] = VIEWPORTS) => buildAcceptanceCriteria({ issues, viewportTag: groupIssues(issues)[0].viewportTag }, viewports);

  it('viewport-overflow page-scroll: layoutWidth로 scrollWidth 조건. 한쪽 viewport면 다른 viewport 항목', () => {
    expect(crit([P01_ISSUE])).toEqual([
      '390px viewport에서 `document.documentElement.scrollWidth`가 390 이하이다.',
      '1440px viewport의 레이아웃은 변경되지 않는다.',
    ]);
  });

  it('element-out / hidden-clip: 넘친 방향의 끝 조건', () => {
    const out = mk(1, { subtype: 'element-out', occurrences: [{ selector: '.img', delta: { overflowRight: 10, overflowLeft: 4 } }] });
    expect(crit([out])).toEqual([
      '390px viewport에서 `.img`의 오른쪽 끝(요소와 텍스트 영역)이 390px 이하이다.',
      '390px viewport에서 `.img`의 왼쪽 끝(요소와 텍스트 영역)이 0px 이상이다.',
      '1440px viewport의 레이아웃은 변경되지 않는다.',
    ]);
  });

  it('text-overflow clipped: 잘린 축의 scroll/client 조건', () => {
    const c = mk(1, { type: 'text-overflow', subtype: 'clipped', viewportTag: 'both', occurrences: [{ viewport: 'desktop', delta: { overflowX: 4 } }, { viewport: 'mobile', delta: { overflowX: 47, overflowY: 3 } }] });
    expect(crit([c])).toEqual([
      '1440px viewport에서 `.target`의 `scrollWidth`가 `clientWidth`를 넘지 않는다.',
      '390px viewport에서 `.target`의 `scrollWidth`가 `clientWidth`를 넘지 않는다.',
      '390px viewport에서 `.target`의 `scrollHeight`가 `clientHeight`를 넘지 않는다.',
    ]);
  });

  it('spill과 overlap', () => {
    const s = mk(1, { type: 'text-overflow', subtype: 'spill', viewportTag: 'desktop-only', occurrences: [{ selector: '.text', relatedElements: [{ role: 'bordered-ancestor', selector: '.card', tag: 'div', boundingBox: { x: 0, y: 0, width: 1, height: 1 } }] }] });
    expect(crit([s])).toEqual([
      '1440px viewport에서 `.text`의 텍스트 영역(`Range.getClientRects()`)이 `.card`의 테두리 안에 있다.',
      '390px viewport의 레이아웃은 변경되지 않는다.',
    ]);
    const box = { x: 0, y: 0, width: 1, height: 1 };
    const o = mk(2, { type: 'element-overlap', subtype: 'interactive', occurrences: [{ selector: '.save', relatedElements: [{ role: 'overlap-target', selector: '.cancel', tag: 'button', boundingBox: box }, { role: 'overlap-target', selector: '.help', tag: 'a', boundingBox: box }] }] });
    expect(crit([o])[0]).toBe('390px viewport에서 `.save`의 표시 영역이 `.cancel`, `.help`의 표시 영역과 겹치지 않는다.');
  });

  it('같은 문장은 하나만 남긴다 (page-scroll 원인이 여럿이어도 scrollWidth 조건은 1개)', () => {
    const lines = crit([mk(1, { occurrences: [{ selector: '.a' }] }), mk(2, { occurrences: [{ selector: '.b' }] })]);
    expect(lines).toEqual(['390px viewport에서 `document.documentElement.scrollWidth`가 390 이하이다.', '1440px viewport의 레이아웃은 변경되지 않는다.']);
  });

  it('viewportTag null이면 다른 viewport 항목을 넣지 않는다. 모든 태스크는 1개 이상', () => {
    const lines = crit([mk(1, { viewportTag: null, occurrences: [{ viewport: 'desktop' }] })], { desktop: VIEWPORTS.desktop, mobile: null });
    expect(lines).toEqual(['1440px viewport에서 `document.documentElement.scrollWidth`가 1440 이하이다.']);
  });
});
