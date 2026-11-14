import type { Issue, IssueOccurrence, Priority, Viewport, ViewportTag } from '@/types/inspection';

// 분석·그룹화·프롬프트 테스트용 Issue. 필요한 값만 넘기면 나머지는 기본값으로 채운다.
// 불변 조건(S-7 등)을 맞추지 않으므로, 불변 조건 검사가 필요한 테스트는 site()나 P-01 데이터를 쓴다.

export function occurrence(overrides: Partial<IssueOccurrence> = {}): IssueOccurrence {
  return {
    viewport: 'mobile',
    selector: '.target',
    boundingBox: { x: 0, y: 100, width: 200, height: 40 },
    measured: {},
    expected: {},
    delta: {},
    evidenceText: 'evidence',
    relatedElements: [],
    cropRect: null,
    computedStyle: {},
    sourceHints: { htmlSnippet: '<div class="target">', stableAttributes: {}, ancestorPath: 'body' },
    confidence: 1,
    ...overrides,
  };
}

export interface IssueSpec {
  id?: string;
  type?: Issue['type'];
  subtype?: string;
  priority?: Priority;
  viewportTag?: ViewportTag | null;
  landmark?: string;
  relatedIssueIds?: string[];
  needsReview?: boolean;
  occurrences?: Partial<IssueOccurrence>[];
}

const TAG_VIEWPORTS: Record<ViewportTag, Viewport[]> = { 'mobile-only': ['mobile'], 'desktop-only': ['desktop'], both: ['desktop', 'mobile'] };

export function issue(spec: IssueSpec = {}): Issue {
  const tag = spec.viewportTag === undefined ? 'mobile-only' : spec.viewportTag;
  const viewports = tag === null ? ['desktop' as const] : TAG_VIEWPORTS[tag];
  const sourceHints = { htmlSnippet: '<div class="target">', stableAttributes: {}, ancestorPath: 'body', ...(spec.landmark ? { landmark: spec.landmark } : {}) };
  const occurrences = (spec.occurrences ?? viewports.map(() => ({}))).map((o, i) =>
    occurrence({ viewport: viewports[i] ?? viewports[0], sourceHints, ...o }),
  );
  const needsReview = spec.needsReview ?? false;
  return {
    id: spec.id ?? 'ISS-001',
    type: spec.type ?? 'viewport-overflow',
    subtype: spec.subtype ?? 'page-scroll',
    title: 'title',
    viewports: occurrences.map((o) => o.viewport),
    viewportTag: tag,
    selector: occurrences[0].selector,
    sourceHints: occurrences[0].sourceHints,
    occurrences,
    relatedIssueIds: spec.relatedIssueIds ?? [],
    scores: { S: 4, I: 4, R: 5, score100: 430 },
    priority: spec.priority ?? 'P2',
    confidence: needsReview ? 0.4 : 1,
    needsReview,
  };
}
