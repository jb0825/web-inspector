import 'server-only';
import { VIEWPORT_LABEL } from '@/server/evidence/sentences';
import { TYPE_LABEL } from '@/server/evidence/title';
import { singleLine } from '@/server/prompt/markdown';
import type { DevTask, Issue, IssueType, Priority, Viewport, ViewportTag } from '@/types/inspection';

// 태스크 그룹화 (PRD 5.8.1). 코드가 정하고 AI는 바꾸지 않는다.
// 결정적이어야 한다(AGENTS.md 6장 불변 조건 5): 입력 순서와 Map/Set 순회 순서를 출력 순서로 쓰지 않고,
// 모든 정렬에 명시적인 키(Priority → Issue 번호)를 쓴다.

/** PRD 5.8.1 규칙 3: 한 태스크에 넣는 이슈 최대 개수 */
export const MAX_ISSUES_PER_TASK = 8;

const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** PRD 5.8.1 기본 제목의 viewportTag 라벨. null은 한 viewport가 실패한 검사(PRD 5.6 "비교 불가") */
export const VIEWPORT_TAG_LABEL: Record<ViewportTag | 'null', string> = {
  'mobile-only': 'Mobile',
  'desktop-only': 'Desktop',
  both: 'Desktop + Mobile',
  null: '비교 불가',
};

/** 기본 제목에서 landmark가 없을 때 (PRD 5.8.1) */
export const NO_LANDMARK_LABEL = '페이지';

/** 그룹화 결과. 프롬프트와 Acceptance Criteria를 붙이면 DevTask가 된다 */
export type GroupedTask = Omit<DevTask, 'acceptanceCriteria' | 'prompt'> & {
  /** issueIds 순서(오름차순)의 이슈 */
  issues: Issue[];
};

/** ISS-001 → 1. ID가 같은 자릿수라는 가정에 기대지 않고 숫자로 비교한다 */
export function issueNumber(id: string): number {
  const m = id.match(/(\d+)$/);
  if (!m) throw new Error(`Invalid issue ID: ${id}`);
  return Number(m[1]);
}

const byId = (a: Issue, b: Issue) => issueNumber(a.id) - issueNumber(b.id);
const byPriorityThenId = (a: Issue, b: Issue) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byId(a, b);

export const formatTaskId = (n: number): string => `TASK-${String(n).padStart(3, '0')}`;

/** 배열 index 기반 union-find. 대표는 항상 더 작은 index라 결과가 순회 순서와 무관하다 */
class DisjointSet {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

/** members를 연결 관계로 묶은 덩어리. 각 덩어리 안과 덩어리 사이 모두 sorted 순서를 따른다 */
function components(sorted: readonly Issue[], linked: (a: Issue, b: Issue) => boolean): Issue[][] {
  const set = new DisjointSet(sorted.length);
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) if (linked(sorted[i], sorted[j])) set.union(i, j);
  }
  const roots: number[] = [];
  const byRoot = new Map<number, Issue[]>();
  sorted.forEach((issue, i) => {
    const root = set.find(i);
    if (!byRoot.has(root)) {
      byRoot.set(root, []);
      roots.push(root);
    }
    byRoot.get(root)?.push(issue);
  });
  // roots는 sorted에서 처음 나온 순서다(Map 순회 순서를 쓰지 않는다)
  return roots.map((root) => byRoot.get(root) ?? []);
}

const related = (a: Issue, b: Issue) => a.relatedIssueIds.includes(b.id) || b.relatedIssueIds.includes(a.id);

/**
 * PRD 5.8.1 규칙 3: 8개씩 나눈다. 그룹 안을 Priority → ID로 정렬하고, relatedIssueIds로 연결된 이슈는 같은 조각에 둔다.
 * 연결된 덩어리 하나가 8개를 넘으면(같은 요소의 이슈끼리만 연결되므로 실제로는 생기지 않는다) 그 덩어리만 순서대로 자른다.
 */
function split(members: readonly Issue[]): Issue[][] {
  const sorted = [...members].sort(byPriorityThenId);
  if (sorted.length <= MAX_ISSUES_PER_TASK) return [sorted];
  const chunks: Issue[][] = [];
  let current: Issue[] = [];
  for (const unit of components(sorted, related)) {
    if (unit.length > MAX_ISSUES_PER_TASK) {
      if (current.length > 0) chunks.push(current);
      current = [];
      for (let i = 0; i < unit.length; i += MAX_ISSUES_PER_TASK) chunks.push(unit.slice(i, i + MAX_ISSUES_PER_TASK));
      continue;
    }
    if (current.length + unit.length > MAX_ISSUES_PER_TASK) {
      chunks.push(current);
      current = [];
    }
    current.push(...unit);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** PRD 5.8.1 규칙 2: 포함된 이슈들의 viewport 합집합. 한 viewport가 실패한 검사(null)는 null 그대로 */
function unionTag(issues: readonly Issue[]): ViewportTag | null {
  if (issues.some((i) => i.viewportTag === null)) return null;
  const has = (v: Viewport) => issues.some((i) => i.viewports.includes(v));
  if (has('desktop') && has('mobile')) return 'both';
  return has('desktop') ? 'desktop-only' : 'mobile-only';
}

/** 모든 이슈의 landmark가 같으면 그 값, 다르면 없음(연결 이슈로 다른 landmark가 합쳐진 경우) */
function commonLandmark(issues: readonly Issue[]): string | undefined {
  const first = issues[0]?.sourceHints.landmark;
  return issues.every((i) => i.sourceHints.landmark === first) ? first : undefined;
}

/** PRD 5.8.1 기본 제목: `{landmark 또는 "페이지"} 영역 {type 라벨 목록} 수정 ({viewportTag 라벨})`. type은 Priority → ID 순으로 처음 나온 순서 */
export function templateTitle(issues: readonly Issue[], landmark: string | undefined, viewportTag: ViewportTag | null): string {
  const types: IssueType[] = [];
  for (const issue of [...issues].sort(byPriorityThenId)) if (!types.includes(issue.type)) types.push(issue.type);
  return `${landmark ?? NO_LANDMARK_LABEL} 영역 ${types.map((t) => TYPE_LABEL[t]).join(', ')} 수정 (${VIEWPORT_TAG_LABEL[viewportTag ?? 'null']})`;
}

/** PRD 5.8.1: Problem Description 대신 포함된 이슈들의 Evidence 문장을 나열한다 */
export function templateDescription(issues: readonly Issue[]): string {
  return issues
    .flatMap((issue) => issue.occurrences.map((o) => `- ${issue.id} (${VIEWPORT_LABEL[o.viewport]}): ${singleLine(o.evidenceText)}`))
    .join('\n');
}

/** PRD 5.8.1 규칙 1~2: 한 파티션(일반 또는 Needs Review) 안에서 기본 그룹을 만들고 연결 이슈로 합친다 */
function partition(issues: readonly Issue[]): Issue[][] {
  const sorted = [...issues].sort(byId);
  const baseKey = (i: Issue) => JSON.stringify([i.viewportTag, i.sourceHints.landmark ?? null]);
  return components(sorted, (a, b) => baseKey(a) === baseKey(b) || related(a, b));
}

/**
 * PRD 5.8.1 규칙 1~5. 일반 이슈와 Needs Review 이슈를 따로 묶는다.
 * 결과는 needsReview(false → true) → Priority → 포함된 가장 작은 Issue ID 순이고 TASK-001부터 ID를 붙인다.
 */
export function groupIssues(issues: readonly Issue[]): GroupedTask[] {
  const chunks = [false, true].flatMap((needsReview) =>
    partition(issues.filter((i) => i.needsReview === needsReview))
      .flatMap(split)
      .map((chunk) => ({ needsReview, issues: [...chunk].sort(byId) })),
  );
  const priorityOf = (chunk: { issues: Issue[] }): Priority =>
    chunk.issues.reduce<Priority>((best, i) => (PRIORITY_RANK[i.priority] < PRIORITY_RANK[best] ? i.priority : best), 'P3');
  chunks.sort(
    (a, b) =>
      Number(a.needsReview) - Number(b.needsReview) ||
      PRIORITY_RANK[priorityOf(a)] - PRIORITY_RANK[priorityOf(b)] ||
      byId(a.issues[0], b.issues[0]),
  );
  return chunks.map((chunk, index) => {
    const viewportTag = unionTag(chunk.issues);
    const landmark = commonLandmark(chunk.issues);
    return {
      id: formatTaskId(index + 1),
      // 규칙 분석만 하는 MVP에서는 모든 태스크가 템플릿 제목이다(PRD 5.7.1)
      title: templateTitle(chunk.issues, landmark, viewportTag),
      titleSource: 'template' as const,
      description: templateDescription(chunk.issues),
      priority: priorityOf(chunk),
      viewportTag,
      ...(landmark !== undefined ? { landmark } : {}),
      issueIds: chunk.issues.map((i) => i.id),
      needsReview: chunk.needsReview,
      issues: chunk.issues,
    };
  });
}
