import { describe, expect, it } from 'vitest';
import type { CollectedElement, CollectedViewport } from '@/server/collect/types';
import { MAX_CANDIDATES } from '@/server/detect/constants';
import { detectOverlap } from '@/server/detect/overlap';
import { detectTextOverflow } from '@/server/detect/textOverflow';
import { detectViewportOverflow } from '@/server/detect/viewportOverflow';
import { collected, el, r, shuffled } from './helpers/collected';

// DETECTION_RULES 11장 결정성, 3.1.1 판정 기준 크기, 성능

function runAll(c: CollectedViewport) {
  return {
    text: detectTextOverflow(c),
    overlap: detectOverlap(c),
    overflow: detectViewportOverflow(c),
  };
}

/** 세 탐지 함수가 모두 이슈를 내는 Mobile 입력 */
function mixedMobile(): CollectedViewport {
  const elements: CollectedElement[] = [
    // page-scroll 원인과 자손
    el({ index: 1, rect: r(16, 100, 600, 100) }),
    el({ index: 2, ancestors: [1], rect: r(420, 110, 180, 60), textRects: [r(430, 120, 150, 20)] }),
    // clipped 버튼
    el({
      index: 3,
      tag: 'button',
      rect: r(16, 300, 180, 44),
      textRects: [r(32, 312, 230, 20)],
      scrollWidth: 246,
      clientWidth: 180,
      style: { overflowX: 'hidden', overflowY: 'hidden', backgroundColor: 'rgb(0, 0, 0)' },
      flags: { interactive: true },
    }),
    // 겹친 버튼 두 개
    el({ index: 4, tag: 'button', rect: r(16, 400, 100, 44), textRects: [r(30, 412, 60, 20)], flags: { interactive: true } }),
    el({ index: 5, tag: 'button', rect: r(80, 404, 100, 44), textRects: [r(94, 416, 60, 20)], flags: { interactive: true } }),
    // spill 카드
    el({ index: 6, rect: r(16, 500, 300, 100), style: { backgroundColor: 'rgb(255, 248, 197)', paddingSum: 32 } }),
    el({ index: 7, ancestors: [6], tag: 'p', rect: r(32, 516, 268, 120), textRects: [r(32, 516, 260, 24), r(32, 610, 200, 24)] }),
    // 왼쪽 이탈
    el({ index: 8, tag: 'img', rect: r(-30, 700, 200, 100) }),
  ];
  return collected('mobile', elements, { documentScrollWidth: 616 });
}

describe('결정성 (DETECTION_RULES 11장)', () => {
  it('입력 예시가 세 유형을 모두 만든다', () => {
    const result = runAll(mixedMobile());
    expect(result.text.issues.map((i) => i.subtype)).toEqual(['clipped', 'spill']);
    expect(result.overlap.issues.map((i) => i.subtype)).toEqual(['interactive']);
    expect(result.overflow.issues.map((i) => `${i.subtype}@${i.elementIndex}`)).toEqual(['page-scroll@1', 'element-out@8']);
  });

  it('같은 입력을 두 번 넣으면 JSON이 같다', () => {
    expect(JSON.stringify(runAll(mixedMobile()))).toBe(JSON.stringify(runAll(mixedMobile())));
  });

  it('입력 elements 순서를 섞어도(index는 유지) 결과가 같다', () => {
    const base = mixedMobile();
    const mixed = { ...base, elements: shuffled(base.elements) };
    expect(mixed.elements.map((e) => e.index)).not.toEqual(base.elements.map((e) => e.index));
    expect(JSON.stringify(runAll(mixed))).toBe(JSON.stringify(runAll(base)));
  });

  it('innerWidth/innerHeight만 바꿔도 결과가 같다 (DETECTION_RULES 3.1.1)', () => {
    const base = mixedMobile();
    // P-01 mobile 실측처럼 페이지가 축소되어 커진 값
    const zoomedOut = { ...base, innerWidth: 616, innerHeight: 1334 };
    expect(JSON.stringify(runAll(zoomedOut))).toBe(JSON.stringify(runAll(base)));
  });

  it('overlay 면적은 innerWidth/innerHeight가 아니라 layoutWidth × viewportSize.height 기준이다', () => {
    // 390 × 844 = 329,160의 30% = 98,748. 배너 390 × 260 = 101,400 → overlay
    const banner = el({ index: 1, rect: r(0, 584, 390, 260), flags: { fixedOrSticky: true, fixedRoot: true } });
    const base = collected('mobile', [banner]);
    expect(detectOverlap(base).overlaysDetected).toHaveLength(1);
    // innerWidth/innerHeight로 계산하면 616 × 1334의 12%라 overlay가 아니게 된다
    expect(detectOverlap({ ...base, innerWidth: 616, innerHeight: 1334 }).overlaysDetected).toHaveLength(1);
  });

  it('입력을 바꾸지 않는다', () => {
    const input = mixedMobile();
    const before = JSON.stringify(input);
    runAll(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

/** 섹션 100개 × (카드 + 제목 + 본문 + 버튼 2 + 이미지 + 배지 등) = 후보 3,000개 */
function largeInput(): CollectedViewport {
  const elements: CollectedElement[] = [];
  let index = 0;
  for (let s = 0; elements.length < MAX_CANDIDATES; s += 1) {
    const y = s * 400;
    const section = (index += 1);
    elements.push(el({ index: section, rect: r(0, y, 1440, 400) }));
    for (let c = 0; c < 4 && elements.length < MAX_CANDIDATES; c += 1) {
      const x = 16 + c * 352;
      const card = (index += 1);
      elements.push(el({ index: card, ancestors: [section], rect: r(x, y + 10, 340, 380), style: { overflowX: 'hidden', overflowY: 'hidden', backgroundColor: 'rgb(255, 255, 255)' } }));
      const kids: [string, ReturnType<typeof r>, boolean][] = [
        ['img', r(x, y + 10, 340, 180), false],
        ['span', r(x + 8, y + 170, 60, 30), true],
        ['h3', r(x + 16, y + 200, 308, 28), true],
        ['p', r(x + 16, y + 236, 308, 72), true],
        ['button', r(x + 16, y + 320, 120, 44), true],
        ['button', r(x + 100, y + 324, 120, 44), true],
      ];
      for (const [tag, rect, hasText] of kids) {
        if (elements.length >= MAX_CANDIDATES) break;
        elements.push(
          el({
            index: (index += 1),
            ancestors: [card, section],
            tag,
            rect,
            textRects: hasText ? [r(rect.x, rect.y, rect.width + (tag === 'h3' ? 80 : 0), Math.min(rect.height, 24))] : [],
            flags: { interactive: tag === 'button' },
            style: tag === 'span' ? { position: 'absolute' } : {},
          }),
        );
      }
    }
  }
  return collected('desktop', elements, { documentHeight: 40_000 });
}

describe('성능', () => {
  it('후보 3,000개짜리 합성 입력에서 세 탐지 함수 합계가 2초 안에 끝난다', () => {
    const input = largeInput();
    expect(input.elements).toHaveLength(MAX_CANDIDATES);
    const started = performance.now();
    const result = runAll(input);
    const elapsed = performance.now() - started;
    expect(result.overlap.issues.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(2000);
    console.info(
      `[perf] 3,000 candidates: ${elapsed.toFixed(0)}ms (text ${result.text.issues.length}, overlap ${result.overlap.issues.length}, overflow ${result.overflow.issues.length})`,
    );
  });
});
