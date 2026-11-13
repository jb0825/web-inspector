import type { Inspection } from '@/types/inspection';

// 저장소·API 테스트용 Inspection 문서

export const T0 = Date.parse('2026-11-13T08:20:00.000Z');
export const ID = '9b1f2c4e-6a0d-4c1e-9f8a-2d7e5b3c1a90';

export function pendingDoc(overrides: Partial<Inspection> = {}): Inspection {
  const at = new Date(T0).toISOString();
  return {
    id: ID,
    url: 'https://example.com/',
    status: 'pending',
    createdAt: at,
    updatedAt: at,
    viewports: { desktop: null, mobile: null },
    viewportErrors: { desktop: null, mobile: null },
    analysis: { status: 'pending', analyzedIssueCount: 0 },
    issuesDetected: 0,
    issuesTruncated: false,
    issues: [],
    tasks: [],
    ...overrides,
  };
}
