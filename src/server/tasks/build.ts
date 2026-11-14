import 'server-only';
import { buildPrompt } from '@/server/prompt/template';
import type { DevTask, Inspection, Issue } from '@/types/inspection';
import { buildAcceptanceCriteria } from './acceptance';
import { groupIssues } from './group';

// 분석이 끝난 이슈로 DevTask를 만든다: 그룹화(PRD 5.8.1) → Acceptance Criteria(5.8.2) → 프롬프트(5.9.1). 모두 코드가 만든다.

export function buildTasks(issues: readonly Issue[], viewports: Inspection['viewports']): DevTask[] {
  return groupIssues(issues).map(({ issues: members, ...task }) => {
    const acceptanceCriteria = buildAcceptanceCriteria({ issues: members, viewportTag: task.viewportTag }, viewports);
    const prompt = buildPrompt({ ...task, issues: members, acceptanceCriteria }, viewports);
    return { ...task, acceptanceCriteria, prompt };
  });
}
