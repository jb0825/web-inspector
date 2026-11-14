import 'server-only';
import { inlineCode } from '@/server/prompt/markdown';
import type { Inspection, Issue, IssueOccurrence, Viewport } from '@/types/inspection';
import type { GroupedTask } from './group';

// Acceptance Criteria (PRD 5.8.2). 코드가 측정값으로 만들고, 너비는 해당 viewport의 layoutWidth를 쓴다.
// 문장마다 브라우저에서 다시 측정해 확인할 수 있는 조건만 쓴다.

const OTHER: Record<Viewport, Viewport> = { desktop: 'mobile', mobile: 'desktop' };

/** 측정한 layoutWidth (Evidence 문장과 같은 정수 반올림). analyze 함수가 playwright를 불러오지 않게 devices.ts의 설정값은 쓰지 않는다 */
function widthOf(viewport: Viewport, viewports: Inspection['viewports'], occ?: IssueOccurrence): number | undefined {
  const value = viewports[viewport]?.layoutWidth ?? occ?.expected.layoutWidth;
  return value === undefined ? undefined : Math.round(value);
}

const has = (record: Record<string, number>, key: string) => (record[key] ?? 0) > 0;

function occurrenceCriteria(issue: Issue, occ: IssueOccurrence, viewports: Inspection['viewports']): string[] {
  // occurrence가 있는 viewport는 항상 성공했으므로 ViewportResult가 있다(DOMAIN_MODEL S-3)
  const lw = widthOf(occ.viewport, viewports, occ) ?? 0;
  const at = `${lw}px viewport에서`;
  const sel = inlineCode(occ.selector);
  switch (issue.type) {
    case 'viewport-overflow': {
      if (issue.subtype === 'page-scroll') return [`${at} \`document.documentElement.scrollWidth\`가 ${lw} 이하이다.`];
      const out: string[] = [];
      if (has(occ.delta, 'overflowRight')) out.push(`${at} ${sel}의 오른쪽 끝(요소와 텍스트 영역)이 ${lw}px 이하이다.`);
      if (has(occ.delta, 'overflowLeft')) out.push(`${at} ${sel}의 왼쪽 끝(요소와 텍스트 영역)이 0px 이상이다.`);
      return out;
    }
    case 'text-overflow': {
      if (issue.subtype === 'clipped') {
        const out: string[] = [];
        if ('overflowX' in occ.delta) out.push(`${at} ${sel}의 \`scrollWidth\`가 \`clientWidth\`를 넘지 않는다.`);
        if ('overflowY' in occ.delta) out.push(`${at} ${sel}의 \`scrollHeight\`가 \`clientHeight\`를 넘지 않는다.`);
        return out;
      }
      const box = occ.relatedElements.find((r) => r.role === 'bordered-ancestor');
      const where = box ? `${inlineCode(box.selector)}의 테두리 안` : '테두리가 있는 상위 영역 안';
      return [`${at} ${sel}의 텍스트 영역(\`Range.getClientRects()\`)이 ${where}에 있다.`];
    }
    case 'element-overlap': {
      const targets = occ.relatedElements.map((r) => inlineCode(r.selector)).join(', ');
      return [`${at} ${sel}의 표시 영역이 ${targets}의 표시 영역과 겹치지 않는다.`];
    }
  }
}

/**
 * 태스크의 Acceptance Criteria. 이슈(ID 순) → occurrence(desktop → mobile) 순으로 만들고 같은 문장은 하나만 남긴다.
 * 한쪽 viewport 태스크면 "다른 viewport의 레이아웃은 변경되지 않는다"를 마지막에 넣는다(PRD 5.8.2).
 * 한 viewport가 실패한 검사(viewportTag null)는 다른 viewport를 측정하지 못했으므로 이 항목을 넣지 않는다.
 */
export function buildAcceptanceCriteria(task: Pick<GroupedTask, 'issues' | 'viewportTag'>, viewports: Inspection['viewports']): string[] {
  const lines = task.issues.flatMap((issue) => issue.occurrences.flatMap((occ) => occurrenceCriteria(issue, occ, viewports)));
  if (task.viewportTag === 'mobile-only' || task.viewportTag === 'desktop-only') {
    const other = OTHER[task.viewportTag === 'mobile-only' ? 'mobile' : 'desktop'];
    const width = widthOf(other, viewports);
    if (width !== undefined) lines.push(`${width}px viewport의 레이아웃은 변경되지 않는다.`);
  }
  return [...new Set(lines)];
}
