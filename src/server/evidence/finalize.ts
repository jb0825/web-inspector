import 'server-only';
import type { ScreenshotMeta } from '@/server/browser/screenshot';
import type { CollectedViewport } from '@/server/collect/types';
import { buildLookup } from '@/server/detect/geometry';
import type { ViewportDetection } from '@/server/detect/pipeline';
import type { DetectedIssue, RawIssue } from '@/server/detect/types';
import { buildLayoutMap } from '@/server/layout/buildLayoutMap';
import type { Issue, IssueOccurrence, RelatedElement, Viewport, ViewportResult } from '@/types/inspection';
import { computeCropRect, cropBasisBox } from './crop';
import { evidenceText } from './sentences';
import { issueTitle } from './title';

// buildIssues(T06)의 중간 이슈를 Issue(PRD 8.2)로 완성한다. AI 필드(analysis, analysisSkippedReason)는 비워 둔다(DOMAIN_MODEL 4.2).
// 측정값, ID, Priority, 정렬은 바꾸지 않는다.

/** viewport 하나의 수집 데이터와 저장된 스크린샷 크기. 스크린샷을 찍지 못했으면(SCREENSHOT_FAILED) null이다 */
export interface ViewportArtifacts {
  collected: CollectedViewport;
  screenshot: Pick<ScreenshotMeta, 'screenshotWidth' | 'screenshotHeight'> | null;
}

function toOccurrence(raw: RawIssue, artifacts: ViewportArtifacts): IssueOccurrence {
  const { collected, screenshot } = artifacts;
  const lookup = buildLookup(collected);
  const find = (index: number) => {
    const el = lookup.get(index);
    if (!el) throw new Error(`Element ${index} not found in ${collected.viewport}`);
    return el;
  };
  const el = find(raw.elementIndex);
  const relatedElements: RelatedElement[] = raw.relatedElements.map((related) => {
    const target = find(related.index);
    return { role: related.role, selector: target.selector, tag: target.tag, boundingBox: { ...target.rect } };
  });
  // DETECTION_RULES 8.3: 크롭으로 보여줄 범위. boundingBox(하이라이트 위치)는 그대로 둔다
  const cropBox = cropBasisBox(raw, raw.type === 'element-overlap' ? find(raw.relatedIndex).rect : undefined);
  return {
    viewport: raw.viewport,
    selector: el.selector,
    boundingBox: { ...raw.boundingBox },
    measured: { ...raw.measured },
    expected: { ...raw.expected },
    delta: { ...raw.delta },
    evidenceText: evidenceText(raw, collected),
    relatedElements,
    // PRD 5.2.4: 스크린샷이 없는 viewport의 cropRect는 모두 null이다
    cropRect: screenshot ? computeCropRect(cropBox, screenshot.screenshotWidth, screenshot.screenshotHeight) : null,
    computedStyle: { ...el.computedStyle },
    sourceHints: structuredClone(el.sourceHints),
    confidence: raw.confidence,
  };
}

export function finalizeIssues(issues: readonly DetectedIssue[], viewports: Record<Viewport, ViewportArtifacts | null>): Issue[] {
  return issues.map((issue): Issue => {
    const occurrences = issue.occurrences.map((raw) => {
      const artifacts = viewports[raw.viewport];
      if (!artifacts) throw new Error(`Missing ${raw.viewport} artifacts for ${issue.id}`);
      return toOccurrence(raw, artifacts);
    });
    const first = issue.occurrences[0];
    const firstArtifacts = viewports[first.viewport];
    if (!firstArtifacts) throw new Error(`Missing ${first.viewport} artifacts for ${issue.id}`);
    return {
      id: issue.id,
      type: issue.type,
      subtype: issue.subtype,
      title: issueTitle(first, firstArtifacts.collected),
      viewports: [...issue.viewports],
      viewportTag: issue.viewportTag,
      // DOMAIN_MODEL S-5: occurrences[0]의 값
      selector: occurrences[0].selector,
      sourceHints: structuredClone(occurrences[0].sourceHints),
      occurrences,
      relatedIssueIds: [...issue.relatedIssueIds],
      ...(issue.affectedDescendants !== undefined ? { affectedDescendants: issue.affectedDescendants } : {}),
      scores: { ...issue.scores },
      priority: issue.priority,
      confidence: issue.confidence,
      needsReview: issue.needsReview,
    };
  });
}

/**
 * PRD 8.2 ViewportResult. screenshotUrl은 T09에서 Blob URL이 들어간다.
 * 스크린샷을 찍지 못했으면(SCREENSHOT_FAILED, PRD 5.2.4) screenshot과 screenshotUrl이 null이고, 스크린샷 값은 모두 null,
 * screenshotTruncated는 false, documentHeight는 수집 시점의 값이다(DOMAIN_MODEL V-2).
 */
export function buildViewportResult(
  collected: CollectedViewport,
  screenshot: ScreenshotMeta | null,
  detection: Pick<ViewportDetection, 'overlaysDetected'>,
  screenshotUrl: string | null,
): ViewportResult {
  const shot = screenshot && screenshotUrl !== null ? { meta: screenshot, url: screenshotUrl } : null;
  return {
    width: collected.viewportSize.width,
    height: collected.viewportSize.height,
    innerWidth: collected.innerWidth,
    layoutWidth: collected.layoutWidth,
    hasMetaViewport: collected.hasMetaViewport,
    // 스크린샷 촬영 시점의 값. screenshotTruncated와 같은 기준이어야 V-2가 성립한다
    documentHeight: shot ? shot.meta.documentHeight : collected.documentHeight,
    screenshotUrl: shot ? shot.url : null,
    screenshotWidth: shot ? shot.meta.screenshotWidth : null,
    screenshotHeight: shot ? shot.meta.screenshotHeight : null,
    screenshotTruncated: shot ? shot.meta.screenshotTruncated : false,
    elementsInspected: collected.elements.length,
    elementsTruncated: collected.elementsTruncated,
    hasCanvas: collected.hasCanvas,
    overlaysDetected: [...detection.overlaysDetected],
    // 스크린샷 성공 여부와 관계없이 항상 만든다 (DETECTION_RULES 16장)
    layoutMap: buildLayoutMap(collected),
  };
}
