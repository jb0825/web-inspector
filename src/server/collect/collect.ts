import 'server-only';
import type { Page } from 'playwright-core';
import type { Rect, Viewport } from '@/types/inspection';
import { VIEWPORTS } from '@/server/browser/devices';
import {
  ANCESTOR_PATH_MAX_DEPTH,
  COMPUTED_STYLE_WHITELIST,
  GENERATED_ID_PATTERNS,
  HTML_ATTRIBUTE_VALUE_MAX,
  HTML_SNIPPET_MAX,
  LANDMARK_MAX,
  MAX_CANDIDATES,
  MEASURE_DECIMALS,
  MIN_ELEMENT_SIZE_PX,
  SELECTOR_MAX_CLASSES,
  SELECTOR_PATH_MAX_DEPTH,
  TEXT_SNIPPET_MAX,
  UNSTABLE_CLASS_PATTERNS,
} from '@/server/detect/constants';
import { InspectionError, isBrowserGone } from '@/server/errors';
import { collectInPage } from './inpage/collectInPage';
import { roundMeasure } from './round';
import { inPageResultSchema } from './schemas';
import type { CollectedElement, CollectedViewport, InPageArgs, InPageResult } from './types';

/** PRD 8.1.3: viewport당 측정과 스크린샷 시간 제한 */
export const COLLECT_TIMEOUT_MS = 20_000;

export const IN_PAGE_ARGS: InPageArgs = {
  maxCandidates: MAX_CANDIDATES,
  minElementSizePx: MIN_ELEMENT_SIZE_PX,
  textSnippetMax: TEXT_SNIPPET_MAX,
  landmarkMax: LANDMARK_MAX,
  htmlSnippetMax: HTML_SNIPPET_MAX,
  htmlAttributeValueMax: HTML_ATTRIBUTE_VALUE_MAX,
  ancestorPathMaxDepth: ANCESTOR_PATH_MAX_DEPTH,
  selectorPathMaxDepth: SELECTOR_PATH_MAX_DEPTH,
  selectorMaxClasses: SELECTOR_MAX_CLASSES,
  generatedIdPatterns: GENERATED_ID_PATTERNS,
  unstableClassPatterns: UNSTABLE_CLASS_PATTERNS,
  computedStyleProperties: COMPUTED_STYLE_WHITELIST,
};

/**
 * page.evaluate에 넘길 식을 만든다.
 *
 * 번들러 shim: tsx(esbuild keepNames)는 함수 안의 이름 있는 헬퍼에 `__name(fn, "name")` 호출을 끼워 넣는다.
 * 이 헬퍼는 모듈 스코프에만 있어서, 함수를 직렬화해 브라우저에서 실행하면 `ReferenceError: __name is not defined`가 난다(T03에서 확인).
 * 페이지의 전역(window.__name)을 건드리지 않도록, 함수를 `__name`을 매개변수로 받는 클로저로 감싸 렉시컬 스코프에서만 가린다.
 * 번들러가 이 헬퍼를 넣지 않는 환경(Next.js 빌드)에서는 아무 영향이 없다.
 */
export function buildInPageExpression(fn: (args: InPageArgs) => unknown, args: InPageArgs): string {
  return `((__name) => (${fn.toString()}))((fn) => fn)(${JSON.stringify(args)})`;
}

export function parseInPageResult(value: unknown): InPageResult {
  const parsed = inPageResultSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first ? `${first.path.join('.')}: ${first.message}` : 'unknown';
    // DETECTION_RULES 10장: 수집 실패는 그 viewport 전체를 DETECTION_FAILED로 처리한다.
    throw new InspectionError('DETECTION_FAILED', `Collected data failed validation (${where})`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export { roundMeasure };

function roundRect(rect: Rect, decimals: number): Rect {
  return {
    x: roundMeasure(rect.x, decimals),
    y: roundMeasure(rect.y, decimals),
    width: roundMeasure(rect.width, decimals),
    height: roundMeasure(rect.height, decimals),
  };
}

function normalizeElement(el: CollectedElement, decimals: number): CollectedElement {
  const r = (value: number) => roundMeasure(value, decimals);
  const identity: CollectedElement['identity'] = {};
  if (el.identity.id !== undefined) identity.id = el.identity.id;
  if (el.identity.testId !== undefined) identity.testId = el.identity.testId;

  const sourceHints: CollectedElement['sourceHints'] = {
    htmlSnippet: el.sourceHints.htmlSnippet,
    stableAttributes: { ...el.sourceHints.stableAttributes },
    ancestorPath: el.sourceHints.ancestorPath,
  };
  if (el.sourceHints.textSnippet !== undefined) sourceHints.textSnippet = el.sourceHints.textSnippet;
  if (el.sourceHints.landmark !== undefined) sourceHints.landmark = el.sourceHints.landmark;

  // 키 순서를 types.ts 순서로 고정해 같은 입력이 바이트 단위로 같은 JSON이 되게 한다(DETECTION_RULES 11장).
  const normalized: CollectedElement = {
    index: el.index,
    parentIndex: el.parentIndex,
    ancestorIndices: [...el.ancestorIndices],
    tag: el.tag,
    rect: roundRect(el.rect, decimals),
    paddingBox: roundRect(el.paddingBox, decimals),
    textRects: el.textRects.map((rect) => roundRect(rect, decimals)),
    scrollWidth: r(el.scrollWidth),
    clientWidth: r(el.clientWidth),
    scrollHeight: r(el.scrollHeight),
    clientHeight: r(el.clientHeight),
    style: {
      position: el.style.position,
      overflowX: el.style.overflowX,
      overflowY: el.style.overflowY,
      textOverflow: el.style.textOverflow,
      webkitLineClamp: el.style.webkitLineClamp,
      whiteSpace: el.style.whiteSpace,
      lineHeight: el.style.lineHeight,
      backgroundColor: el.style.backgroundColor,
      backgroundImage: el.style.backgroundImage,
      borderWidthSum: r(el.style.borderWidthSum),
      paddingSum: r(el.style.paddingSum),
    },
    flags: {
      interactive: el.flags.interactive,
      heading: el.flags.heading,
      inNav: el.flags.inNav,
      fixedOrSticky: el.flags.fixedOrSticky,
      fixedRoot: el.flags.fixedRoot,
    },
    computedStyle: { ...el.computedStyle },
    selector: el.selector,
    sourceHints,
    identity,
  };
  if (el.layoutAttrs) {
    const layoutAttrs: NonNullable<CollectedElement['layoutAttrs']> = {};
    if (el.layoutAttrs.alt !== undefined) layoutAttrs.alt = el.layoutAttrs.alt;
    if (el.layoutAttrs.placeholder !== undefined) layoutAttrs.placeholder = el.layoutAttrs.placeholder;
    if (el.layoutAttrs.type !== undefined) layoutAttrs.type = el.layoutAttrs.type;
    normalized.layoutAttrs = layoutAttrs;
  }
  return normalized;
}

/**
 * 검증된 inpage 결과를 CollectedViewport로 정규화한다. 순수 함수다.
 * - 숫자를 MEASURE_DECIMALS 자리로 반올림한다(PRD 5.3.1).
 * - 후보를 maxCandidates개로 자르고 elementsTruncated를 정한다(DETECTION_RULES 3.2).
 */
export function normalizeCollected(
  raw: InPageResult,
  viewport: Viewport,
  options: { decimals?: number; maxCandidates?: number } = {},
): CollectedViewport {
  const decimals = options.decimals ?? MEASURE_DECIMALS;
  const maxCandidates = options.maxCandidates ?? MAX_CANDIDATES;
  const r = (value: number) => roundMeasure(value, decimals);
  const elements = raw.elements.slice(0, maxCandidates).map((el) => normalizeElement(el, decimals));
  const totalCandidates = Math.max(raw.totalCandidates, raw.elements.length);

  return {
    viewport,
    // DETECTION_RULES 3.1.1: 판정 기준 크기는 측정값이 아니라 설정값이다
    viewportSize: { width: VIEWPORTS[viewport].width, height: VIEWPORTS[viewport].height },
    innerWidth: r(raw.innerWidth),
    innerHeight: r(raw.innerHeight),
    layoutWidth: r(raw.layoutWidth),
    documentScrollWidth: r(raw.documentScrollWidth),
    documentHeight: r(raw.documentHeight),
    hasMetaViewport: raw.hasMetaViewport,
    rootOverflowX: { html: raw.rootOverflowX.html, body: raw.rootOverflowX.body },
    hasCanvas: raw.hasCanvas,
    totalCandidates,
    elementsTruncated: totalCandidates > elements.length,
    elements,
  };
}


/**
 * 안정화가 끝난 page에서 측정 데이터를 수집한다(DETECTION_RULES 1.3).
 * 시간 제한을 넘기면 TIME_BUDGET_EXCEEDED를 던진다. 이때 브라우저 안의 실행은 멈추지 않으므로 호출한 쪽이 page를 닫는다.
 */
export async function collectViewport(
  page: Page,
  viewport: Viewport,
  options: { timeoutMs?: number } = {},
): Promise<CollectedViewport> {
  const timeoutMs = options.timeoutMs ?? COLLECT_TIMEOUT_MS;
  const expression = buildInPageExpression(collectInPage, IN_PAGE_ARGS);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new InspectionError('TIME_BUDGET_EXCEEDED', `Collect timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });

  let raw: unknown;
  try {
    raw = await Promise.race([page.evaluate(expression), timeout]);
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    if (isBrowserGone(error)) {
      throw new InspectionError('BROWSER_CRASH', 'Page crashed during collect', { cause: error });
    }
    throw new InspectionError('DETECTION_FAILED', 'In-page collect failed', { cause: error });
  } finally {
    clearTimeout(timer);
  }

  return normalizeCollected(parseInPageResult(raw), viewport);
}
