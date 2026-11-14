import { describe, expect, it } from 'vitest';
import { buildTaskList, resolveSelectedTask, titleSourceDisplay } from '@/features/dev-tasks/logic';
import type { DevTask } from '@/types/inspection';

const task = (id: string, overrides: Partial<DevTask> = {}): DevTask => ({
  id,
  title: id,
  titleSource: 'template',
  description: '',
  priority: 'P1',
  viewportTag: 'both',
  issueIds: ['ISS-001'],
  needsReview: false,
  acceptanceCriteria: [],
  prompt: '',
  ...overrides,
});

describe('titleSourceDisplay (WIREFRAME 7.4와 다른 결정)', () => {
  it('모두 template이면 목록 위에 한 번만', () => {
    expect(titleSourceDisplay([task('TASK-001'), task('TASK-002')])).toBe('notice');
  });
  it('섞여 있으면 항목별', () => {
    expect(titleSourceDisplay([task('TASK-001', { titleSource: 'ai' }), task('TASK-002')])).toBe('per-item');
  });
  it('모두 AI이거나 없으면 표시하지 않는다', () => {
    expect(titleSourceDisplay([task('TASK-001', { titleSource: 'ai' })])).toBe('none');
    expect(titleSourceDisplay([])).toBe('none');
  });
});

describe('buildTaskList / resolveSelectedTask (WIREFRAME 7.4)', () => {
  const tasks = [task('TASK-001', { issueIds: ['ISS-001', 'ISS-002'] }), task('TASK-002'), task('TASK-003', { needsReview: true, issueIds: ['ISS-009'] })];

  it('Needs Review 태스크는 토글을 켰을 때만 보인다', () => {
    const hidden = buildTaskList(tasks, false);
    expect(hidden.regular.map((t) => t.id)).toEqual(['TASK-001', 'TASK-002']);
    expect(hidden.needsReview).toEqual([]);
    expect(hidden).toMatchObject({ needsReviewTotal: 1, visibleTaskCount: 2, visibleIssueCount: 3 });
    const shown = buildTaskList(tasks, true);
    expect(shown.needsReview.map((t) => t.id)).toEqual(['TASK-003']);
    expect(shown).toMatchObject({ visibleTaskCount: 3, visibleIssueCount: 4 });
  });

  it('선택이 없거나 보이지 않으면 첫 번째 태스크', () => {
    expect(resolveSelectedTask(buildTaskList(tasks, false), null)?.id).toBe('TASK-001');
    expect(resolveSelectedTask(buildTaskList(tasks, false), 'TASK-003')?.id).toBe('TASK-001');
    expect(resolveSelectedTask(buildTaskList(tasks, true), 'TASK-003')?.id).toBe('TASK-003');
    expect(resolveSelectedTask(buildTaskList([], false), null)).toBeNull();
  });
});
