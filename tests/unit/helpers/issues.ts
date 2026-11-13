import type { MergedIssue, RawIssue, ScoredIssue } from '@/server/detect/types';
import type { Rect, Viewport } from '@/types/inspection';
import { r } from './collected';

// Dedup·order·score 단위 테스트용 RawIssue/MergedIssue를 만드는 헬퍼.

export interface RawSpec {
  viewport?: Viewport;
  type: RawIssue['type'];
  subtype: RawIssue['subtype'];
  elementIndex: number;
  /** Overlap은 대표 상대 요소, spill은 bordered-ancestor */
  relatedIndex?: number;
  boundingBox?: Rect;
  delta?: Record<string, number>;
  confidence?: number;
}

export function raw(spec: RawSpec): RawIssue {
  const base = {
    viewport: spec.viewport ?? 'desktop',
    elementIndex: spec.elementIndex,
    boundingBox: spec.boundingBox ?? r(0, 100, 100, 40),
    measured: {},
    expected: {},
    delta: spec.delta ?? {},
    confidence: spec.confidence ?? 1,
  };
  switch (spec.type) {
    case 'element-overlap': {
      const relatedIndex = spec.relatedIndex ?? spec.elementIndex + 1;
      return {
        ...base,
        type: spec.type,
        subtype: spec.subtype as 'interactive' | 'text' | 'other',
        relatedIndex,
        relatedElements: [{ role: 'overlap-target', index: relatedIndex }],
      };
    }
    case 'viewport-overflow':
      return {
        ...base,
        type: spec.type,
        subtype: spec.subtype as 'page-scroll' | 'element-out' | 'hidden-clip',
        relatedElements: [],
        affectedDescendants: 0,
      };
    case 'text-overflow':
      if (spec.subtype === 'clipped') return { ...base, type: spec.type, subtype: 'clipped', axes: ['x'], relatedElements: [] };
      return {
        ...base,
        type: spec.type,
        subtype: 'spill',
        relatedElements: spec.relatedIndex === undefined ? [] : [{ role: 'bordered-ancestor', index: spec.relatedIndex }],
      };
  }
}

/** occurrences만으로 MergedIssue를 만든다 (viewportTag는 개수로) */
export function merged(...occurrences: RawIssue[]): MergedIssue {
  const viewports = occurrences.map((o) => o.viewport);
  const confidence = Math.min(...occurrences.map((o) => o.confidence));
  return {
    type: occurrences[0].type,
    subtype: occurrences[0].subtype,
    viewports,
    viewportTag: viewports.length === 2 ? 'both' : viewports[0] === 'desktop' ? 'desktop-only' : 'mobile-only',
    occurrences,
    confidence,
    needsReview: confidence < 0.5,
  };
}

export function scored(issue: MergedIssue, score100: number): ScoredIssue {
  return { ...issue, scores: { S: 0, I: 0, R: 0, score100 }, priority: 'P2' };
}
