import 'server-only';
import { roundMeasure } from '@/server/collect/round';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import type { Rect } from '@/types/inspection';
import { DEFAULT_CONFIDENCE, TOLERANCE_PX } from './constants';
import { ancestorsOf, buildLookup, isDescendantOf, right, union, visibleTextRects, type ElementLookup } from './geometry';
import { compareRawIssues, type SubtypeByType, type ViewportOverflowIssue } from './types';

// Viewport Overflow (PRD 5.3.4, DETECTION_RULES 6장)
// 가로 비교의 기준은 layoutWidth다(PRD 5.2.1). innerWidth는 Mobile 축소 시 커지므로 쓰지 않는다(DETECTION_RULES 3.1.1).

const HORIZONTAL_CLIP = ['auto', 'scroll', 'hidden', 'clip'];
const ROOT_CLIP = ['hidden', 'clip'];

/** DETECTION_RULES 6.1: 박스와 보이는 텍스트 rect의 합집합 */
export function extentOf(el: CollectedElement, lookup: ElementLookup): Rect {
  return union([el.rect, ...visibleTextRects(el, lookup)]) as Rect;
}

export function detectViewportOverflow(c: CollectedViewport): {
  issues: ViewportOverflowIssue[];
  unexplainedPageScroll: boolean;
} {
  const lookup = buildLookup(c);
  const extents = new Map<number, Rect>();
  for (const el of lookup.sorted) extents.set(el.index, extentOf(el, lookup));

  const isOut = (index: number): boolean => {
    const extent = extents.get(index);
    if (!extent) return false;
    return right(extent) > c.layoutWidth + TOLERANCE_PX || extent.x < -TOLERANCE_PX;
  };

  // DETECTION_RULES 6.2. PRD 5.3.4: 캐러셀, 가로 스크롤 영역처럼 가로 클립 조상이 있으면 그 안에서 잘리거나 스크롤된다
  const outs = lookup.sorted.filter(
    (el) => isOut(el.index) && !ancestorsOf(el, lookup).some((a) => HORIZONTAL_CLIP.includes(a.style.overflowX)),
  );

  // DETECTION_RULES 6.3: 부모는 화면 안인데 자신은 밖으로 나간 요소 중 가장 바깥쪽 (Dedup 규칙 1)
  const firstOut = outs.filter((el) => el.parentIndex === null || !isOut(el.parentIndex));
  const causes = firstOut.filter((el) => !firstOut.some((other) => other !== el && isDescendantOf(el, other.index)));

  const pageScroll = c.documentScrollWidth > c.layoutWidth + TOLERANCE_PX;
  const rootClip = ROOT_CLIP.includes(c.rootOverflowX.html) || ROOT_CLIP.includes(c.rootOverflowX.body);

  const issues = causes.map((cause): ViewportOverflowIssue => {
    const extent = extents.get(cause.index) as Rect;
    const extentRight = right(extent);
    let subtype: SubtypeByType['viewport-overflow'];
    // DETECTION_RULES 6.4: html/body가 overflow-x: hidden이어도 scrollWidth가 넘친 너비를 보고할 수 있어 rootClip을 먼저 본다
    if (rootClip) subtype = 'hidden-clip';
    // 왼쪽으로 나간 요소와 fixed 요소는 문서 가로 스크롤을 만들지 않는다
    else if (pageScroll && extentRight > c.layoutWidth + TOLERANCE_PX && !cause.flags.fixedOrSticky) subtype = 'page-scroll';
    else subtype = 'element-out';

    const measured: Record<string, number> = {};
    const expected: Record<string, number> = {};
    const delta: Record<string, number> = {};
    if (subtype === 'page-scroll') {
      measured.elementRight = roundMeasure(extentRight);
      measured.documentScrollWidth = c.documentScrollWidth;
      expected.layoutWidth = c.layoutWidth;
      delta.overflowRight = roundMeasure(extentRight - c.layoutWidth);
    } else {
      measured.elementLeft = roundMeasure(extent.x);
      measured.elementRight = roundMeasure(extentRight);
      expected.layoutWidth = c.layoutWidth;
      expected.minLeft = 0;
      if (extent.x < 0) delta.overflowLeft = roundMeasure(-extent.x);
      if (extentRight > c.layoutWidth) delta.overflowRight = roundMeasure(extentRight - c.layoutWidth);
    }

    return {
      viewport: c.viewport,
      type: 'viewport-overflow',
      subtype,
      elementIndex: cause.index,
      boundingBox: { ...cause.rect },
      measured,
      expected,
      delta,
      relatedElements: [],
      confidence: DEFAULT_CONFIDENCE,
      affectedDescendants: outs.filter((el) => isDescendantOf(el, cause.index)).length,
    };
  });

  issues.sort(compareRawIssues);
  // DETECTION_RULES 6.4: 문서가 가로로 스크롤되는데 원인을 찾지 못함. rootClip이면 스크롤이 생기지 않으므로 해당하지 않는다.
  const unexplainedPageScroll = pageScroll && !rootClip && !issues.some((issue) => issue.subtype === 'page-scroll');
  return { issues, unexplainedPageScroll };
}
