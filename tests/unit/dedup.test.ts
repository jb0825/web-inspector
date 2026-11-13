import { describe, expect, it } from 'vitest';
import type { ElementMatching } from '@/server/compare/match';
import { dedupWithinViewport, linkRelated, mergeAcrossViewports } from '@/server/detect/dedup';
import { orderAndAssignIds } from '@/server/detect/order';
import { merged, raw, scored } from './helpers/issues';

// DETECTION_RULES 7.1, 7.3, 7.5, 12.1 dedup / match

function matching(pairs: [number, number][] = []): ElementMatching {
  return {
    desktopToMobile: new Map(pairs),
    mobileToDesktop: new Map(pairs.map(([d, m]) => [m, d])),
  };
}

describe('dedupWithinViewport (규칙 2)', () => {
  it('(type, subtype, 요소)가 같으면 하나로 합치고 큰 delta를 남긴다', () => {
    const small = raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 4, delta: { overflowX: 10 } });
    const large = raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 4, delta: { overflowX: 30 } });
    const other = raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 4, relatedIndex: 2, delta: { overflowBottom: 5 } });
    const result = dedupWithinViewport([small, other, large]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(large);
    expect(result[1]).toBe(other);
  });

  it('delta가 같으면 출력 순서가 앞인 쪽을 남기고, 결과는 compareRawIssues 순서다', () => {
    const a = raw({ type: 'element-overlap', subtype: 'other', elementIndex: 2, relatedIndex: 3 });
    const b = raw({ type: 'element-overlap', subtype: 'other', elementIndex: 2, relatedIndex: 5 });
    const c = raw({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 1 });
    expect(dedupWithinViewport([b, c, a])).toEqual([c, a]);
  });
});

describe('mergeAcrossViewports (규칙 3)', () => {
  it('매칭된 요소의 같은 type/subtype은 병합하고 occurrences는 [desktop, mobile]', () => {
    const d = raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 5, confidence: 1 });
    const m = raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 8, confidence: 0.4 });
    const [issue, ...rest] = mergeAcrossViewports([d], [m], matching([[5, 8]]));
    expect(rest).toEqual([]);
    expect(issue.occurrences).toEqual([d, m]);
    expect(issue.viewports).toEqual(['desktop', 'mobile']);
    expect(issue.viewportTag).toBe('both');
    // DETECTION_RULES 9.4: occurrence 중 최솟값
    expect(issue.confidence).toBe(0.4);
    expect(issue.needsReview).toBe(true);
  });

  it('병합 후 viewportTag: desktop-only, mobile-only', () => {
    const d = raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 5 });
    const m = raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 8 });
    // 매칭되지 않으면 따로 남는다
    const result = mergeAcrossViewports([d], [m], matching());
    expect(result.map((i) => i.viewportTag)).toEqual(['desktop-only', 'mobile-only']);
    expect(result.every((i) => i.needsReview === false)).toBe(true);
  });

  it('subtype이 다르면 매칭된 요소라도 병합하지 않는다', () => {
    const d = raw({ viewport: 'desktop', type: 'viewport-overflow', subtype: 'element-out', elementIndex: 5 });
    const m = raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 8 });
    expect(mergeAcrossViewports([d], [m], matching([[5, 8]]))).toHaveLength(2);
  });

  it('Overlap은 대표 상대 요소가 달라도 대상 요소와 subtype이 같으면 병합한다 (7.3)', () => {
    const d = raw({ viewport: 'desktop', type: 'element-overlap', subtype: 'interactive', elementIndex: 5, relatedIndex: 6 });
    // Mobile에서는 다른 요소(매칭되지 않음)가 대표 상대 요소다
    const m = raw({ viewport: 'mobile', type: 'element-overlap', subtype: 'interactive', elementIndex: 8, relatedIndex: 20 });
    const result = mergeAcrossViewports([d], [m], matching([[5, 8], [6, 9]]));
    expect(result).toHaveLength(1);
    expect(result[0].viewportTag).toBe('both');
    // 각 occurrence는 자기 viewport의 relatedElements를 그대로 가진다
    expect(result[0].occurrences.map((o) => o.relatedElements[0].index)).toEqual([6, 20]);
  });

  it('한 viewport가 실패(null)하면 viewportTag는 null', () => {
    const d = raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 5 });
    expect(mergeAcrossViewports([d], null, matching())[0].viewportTag).toBeNull();
    const m = raw({ viewport: 'mobile', type: 'text-overflow', subtype: 'clipped', elementIndex: 5 });
    expect(mergeAcrossViewports(null, [m], matching())[0].viewportTag).toBeNull();
  });

  it('affectedDescendants는 occurrences[0]의 값', () => {
    const d = { ...raw({ viewport: 'desktop', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1 }), affectedDescendants: 3 };
    const m = { ...raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1 }), affectedDescendants: 7 };
    expect(mergeAcrossViewports([d], [m], matching([[1, 1]]))[0].affectedDescendants).toBe(3);
    expect(mergeAcrossViewports([], [m], matching())[0].affectedDescendants).toBe(7);
    const t = raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 1 });
    expect(mergeAcrossViewports([t], [], matching())[0]).not.toHaveProperty('affectedDescendants');
  });
});

describe('linkRelated (규칙 4)', () => {
  const withIds = (...issues: ReturnType<typeof scored>[]) => orderAndAssignIds(issues);

  it('같은 viewport의 같은 요소에 viewport-overflow와 text-overflow가 있으면 서로 연결한다 (대칭, 오름차순)', () => {
    const vo = scored(merged(raw({ type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 3 })), 430);
    const clipped = scored(merged(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 3 })), 300);
    const spill = scored(merged(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 3, relatedIndex: 1 })), 265);
    const otherVo = scored(merged(raw({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 9 })), 230);
    const overlap = scored(merged(raw({ type: 'element-overlap', subtype: 'other', elementIndex: 3 })), 200);
    const result = linkRelated(withIds(spill, otherVo, overlap, clipped, vo), matching());
    const byId = Object.fromEntries(result.map((i) => [`${i.type}/${i.subtype}@${i.occurrences[0].elementIndex}`, i]));
    // 정렬: 요소 3의 VO(ISS-001) → clipped(ISS-002) → spill(ISS-003) → overlap(ISS-004) → 요소 9(ISS-005)
    expect(byId['viewport-overflow/page-scroll@3'].relatedIssueIds).toEqual(['ISS-002', 'ISS-003']);
    expect(byId['text-overflow/clipped@3'].relatedIssueIds).toEqual(['ISS-001']);
    expect(byId['text-overflow/spill@3'].relatedIssueIds).toEqual(['ISS-001']);
    expect(byId['element-overlap/other@3'].relatedIssueIds).toEqual([]);
    expect(byId['viewport-overflow/element-out@9'].relatedIssueIds).toEqual([]);
  });

  it('매칭된 요소라면 다른 viewport의 occurrence도 같은 요소로 본다', () => {
    const vo = scored(merged(raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 12 })), 430);
    const text = scored(merged(raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 4 })), 300);
    const linked = linkRelated(withIds(vo, text), matching([[4, 12]]));
    expect(linked.map((i) => i.relatedIssueIds)).toEqual([['ISS-002'], ['ISS-001']]);
    // 매칭되지 않으면 연결하지 않는다
    expect(linkRelated(withIds(vo, text), matching()).map((i) => i.relatedIssueIds)).toEqual([[], []]);
  });

  it('다른 viewport의 같은 index는 매칭 없이는 같은 요소가 아니다', () => {
    const vo = scored(merged(raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 4 })), 430);
    const text = scored(merged(raw({ viewport: 'desktop', type: 'text-overflow', subtype: 'clipped', elementIndex: 4 })), 300);
    expect(linkRelated(withIds(vo, text), matching()).map((i) => i.relatedIssueIds)).toEqual([[], []]);
  });

  it('ID 1000개 이상에서도 숫자 순서로 정렬한다', () => {
    // 요소 1~998의 이슈가 ISS-001~ISS-998을 차지한다
    const fillers = Array.from({ length: 998 }, (_, i) =>
      scored(merged(raw({ type: 'element-overlap', subtype: 'other', elementIndex: 1 + i })), 200),
    );
    const vo1 = scored(merged(raw({ type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 1000 })), 430); // ISS-999
    const text = scored(merged(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1000 })), 300); // ISS-1000
    // 매칭된 mobile 요소의 viewport-overflow (정렬상 맨 뒤)
    const vo2 = scored(merged(raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 7 })), 430); // ISS-1001
    const result = linkRelated(withIds(text, vo1, vo2, ...fillers), matching([[1000, 7]]));
    const clipped = result.find((i) => i.type === 'text-overflow');
    expect(clipped?.id).toBe('ISS-1000');
    // 문자열 정렬이면 ['ISS-1001', 'ISS-999']가 된다
    expect(clipped?.relatedIssueIds).toEqual(['ISS-999', 'ISS-1001']);
  });
});
