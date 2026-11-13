import { describe, expect, it } from 'vitest';
import type { CollectedElement } from '@/server/collect/types';
import type { RawIssue } from '@/server/detect/types';
import { evidenceText, subjectLabel } from '@/server/evidence/sentences';
import { issueTitle } from '@/server/evidence/title';
import { collected, el, r } from './helpers/collected';
import { raw } from './helpers/issues';

// DETECTION_RULES 8.1, 8.2, 12.1 sentences

function withText(spec: Parameters<typeof el>[0], textSnippet?: string, selector?: string): CollectedElement {
  const base = el(spec);
  return {
    ...base,
    ...(selector ? { selector } : {}),
    sourceHints: { ...base.sourceHints, ...(textSnippet !== undefined ? { textSnippet } : {}) },
  };
}

const elements = [
  withText({ index: 1, tag: 'button', rect: r(0, 0, 180, 44), style: { overflowX: 'hidden', overflowY: 'clip' } }, '지금 바로 무료 체험 시작하기'),
  withText({ index: 2, rect: r(0, 100, 300, 100) }, undefined, '.card'),
  withText({ index: 3, tag: 'button', rect: r(0, 300, 90, 44) }, '저장하기'),
  withText({ index: 4, tag: 'button', rect: r(60, 300, 90, 44) }, '취소'),
  withText({ index: 5, tag: 'img', rect: r(0, 400, 300, 200) }, undefined, '[data-testid="hero"]'),
];
const desktop = collected('desktop', elements);
const mobile = collected('mobile', elements);

function issue(base: RawIssue, values: Partial<Pick<RawIssue, 'measured' | 'expected' | 'delta'>> & Record<string, unknown>): RawIssue {
  return { ...base, ...values } as RawIssue;
}

describe('subtype별 템플릿 (8.1)', () => {
  it('clipped x', () => {
    const i = issue(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }), {
      measured: { scrollWidth: 412 },
      expected: { clientWidth: 358 },
      delta: { overflowX: 54 },
    });
    // PRD 5.4.3 예시와 같은 문장
    expect(evidenceText(i, desktop)).toBe('내부 콘텐츠 너비(412px)가 컨테이너 너비(358px)를 54px 초과합니다. (overflow: hidden으로 잘림)');
  });

  it('clipped y', () => {
    const i = issue(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }), {
      axes: ['y'],
      measured: { scrollHeight: 80 },
      expected: { clientHeight: 44 },
      delta: { overflowY: 36 },
    });
    expect(evidenceText(i, desktop)).toBe('내부 콘텐츠 높이(80px)가 컨테이너 높이(44px)를 36px 초과합니다. (overflow: clip으로 잘림)');
  });

  it('clipped 두 축 모두 → 두 문장을 공백으로 잇는다', () => {
    const i = issue(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }), {
      axes: ['x', 'y'],
      measured: { scrollWidth: 200, scrollHeight: 60 },
      expected: { clientWidth: 180, clientHeight: 44 },
      delta: { overflowX: 20, overflowY: 16 },
    });
    expect(evidenceText(i, desktop)).toBe(
      '내부 콘텐츠 너비(200px)가 컨테이너 너비(180px)를 20px 초과합니다. (overflow: hidden으로 잘림) 내부 콘텐츠 높이(60px)가 컨테이너 높이(44px)를 16px 초과합니다. (overflow: clip으로 잘림)',
    );
  });

  it('spill: 방향 목록은 왼쪽, 오른쪽, 위쪽, 아래쪽 순서, 최대 delta', () => {
    const i = issue(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 3, relatedIndex: 2 }), {
      delta: { overflowBottom: 42.4, overflowRight: 12, overflowLeft: 3 },
    });
    expect(evidenceText(i, desktop)).toBe('텍스트가 테두리가 있는 상위 영역(div)의 왼쪽, 오른쪽, 아래쪽 경계를 최대 42px 벗어납니다.');
  });

  it.each(['interactive', 'text', 'other'] as const)('overlap %s', (subtype) => {
    const i = issue(raw({ type: 'element-overlap', subtype, elementIndex: 3, relatedIndex: 4 }), {
      measured: { intersectionArea: 968.4, overlapRatioPercent: 36.5, overlapTargetCount: 1 },
    });
    expect(evidenceText(i, desktop)).toBe('button "저장하기"과 button "취소"의 표시 영역이 968px² 겹칩니다. (작은 요소 면적의 37%)');
  });

  it('page-scroll', () => {
    const i = issue(raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 2 }), {
      measured: { elementRight: 452, documentScrollWidth: 452 },
      expected: { layoutWidth: 390 },
      delta: { overflowRight: 62 },
    });
    // PRD 5.4.3 예시와 같은 문장
    expect(evidenceText(i, mobile)).toBe('요소의 오른쪽 끝(452px)이 Mobile 화면 너비(390px)를 62px 벗어나 페이지 가로 스크롤이 발생합니다.');
  });

  it('element-out 오른쪽 / 왼쪽 / 양쪽', () => {
    const base = raw({ type: 'viewport-overflow', subtype: 'element-out', elementIndex: 2 });
    const right = issue(base, { measured: { elementLeft: 100, elementRight: 1500 }, expected: { layoutWidth: 1440, minLeft: 0 }, delta: { overflowRight: 60 } });
    expect(evidenceText(right, desktop)).toBe('요소의 오른쪽 끝(1500px)이 Desktop 화면 너비(1440px)를 60px 벗어납니다.');
    const left = issue(base, { measured: { elementLeft: -30, elementRight: 170 }, expected: { layoutWidth: 1440, minLeft: 0 }, delta: { overflowLeft: 30 } });
    expect(evidenceText(left, desktop)).toBe('요소의 왼쪽 끝(-30px)이 화면 왼쪽 경계를 30px 벗어납니다.');
    const both = issue(base, {
      measured: { elementLeft: -30, elementRight: 1500 },
      expected: { layoutWidth: 1440, minLeft: 0 },
      delta: { overflowLeft: 30, overflowRight: 60 },
    });
    expect(evidenceText(both, desktop)).toBe(
      '요소의 오른쪽 끝(1500px)이 Desktop 화면 너비(1440px)를 60px 벗어납니다. 요소의 왼쪽 끝(-30px)이 화면 왼쪽 경계를 30px 벗어납니다.',
    );
  });

  it('hidden-clip: overflowRight, 없으면 overflowLeft', () => {
    const base = raw({ type: 'viewport-overflow', subtype: 'hidden-clip', elementIndex: 5 });
    const right = issue(base, { measured: { elementLeft: 1084, elementRight: 1484 }, expected: { layoutWidth: 1440, minLeft: 0 }, delta: { overflowRight: 44 } });
    expect(evidenceText(right, desktop)).toBe('요소가 Desktop 화면 너비(1440px)를 44px 벗어나지만, html/body의 overflow-x: hidden 때문에 스크롤 없이 잘립니다.');
    const left = issue(base, { measured: { elementLeft: -20, elementRight: 280 }, expected: { layoutWidth: 1440, minLeft: 0 }, delta: { overflowLeft: 20 } });
    expect(evidenceText(left, desktop)).toBe('요소가 Desktop 화면 너비(1440px)를 20px 벗어나지만, html/body의 overflow-x: hidden 때문에 스크롤 없이 잘립니다.');
  });
});

describe('반올림과 affectedDescendants', () => {
  it('숫자는 Math.round한 정수', () => {
    const i = issue(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }), {
      measured: { scrollWidth: 226.5 },
      expected: { clientWidth: 179.49 },
      delta: { overflowX: 47.01 },
    });
    expect(evidenceText(i, desktop)).toBe('내부 콘텐츠 너비(227px)가 컨테이너 너비(179px)를 47px 초과합니다. (overflow: hidden으로 잘림)');
  });

  it('affectedDescendants가 있으면 문장 끝에 붙인다, 0이면 붙이지 않는다', () => {
    const base = raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 2 });
    const values = { measured: { elementRight: 616 }, expected: { layoutWidth: 390 }, delta: { overflowRight: 226 } };
    expect(evidenceText(issue(base, { ...values, affectedDescendants: 6 }), mobile)).toBe(
      '요소의 오른쪽 끝(616px)이 Mobile 화면 너비(390px)를 226px 벗어나 페이지 가로 스크롤이 발생합니다. 하위 요소 6개가 함께 화면 밖으로 나갑니다.',
    );
    expect(evidenceText(issue(base, { ...values, affectedDescendants: 0 }), mobile)).not.toContain('하위 요소');
  });

  it('다른 viewport의 수집 데이터는 거부한다', () => {
    const i = raw({ viewport: 'mobile', type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 2 });
    expect(() => evidenceText(i, desktop)).toThrow();
  });
});

describe('{a 대상}과 제목 (8.1, 8.2)', () => {
  it('tag "textSnippet 앞 20자", 텍스트가 없으면 selector', () => {
    expect(subjectLabel(elements[0])).toBe('button "지금 바로 무료 체험 시작하기"');
    const long = withText({ index: 9, tag: 'p', rect: r(0, 0, 1, 1) }, '가나다라마바사아자차카타파하가나다라마바사아자');
    expect(subjectLabel(long)).toBe('p "가나다라마바사아자차카타파하가나다라마바"');
    expect(subjectLabel(elements[1])).toBe('.card');
    expect(subjectLabel(withText({ index: 9, rect: r(0, 0, 1, 1) }, '', '#empty'))).toBe('#empty');
  });

  it('20자는 코드 포인트 기준이다 (이모지를 반으로 자르지 않음)', () => {
    const emoji = withText({ index: 9, tag: 'span', rect: r(0, 0, 1, 1) }, '😀'.repeat(25));
    expect(subjectLabel(emoji)).toBe(`span "${'😀'.repeat(20)}"`);
  });

  it('type별 제목 형식', () => {
    expect(issueTitle(raw({ type: 'text-overflow', subtype: 'clipped', elementIndex: 1 }), desktop)).toBe(
      'Text Overflow · clipped — button "지금 바로 무료 체험 시작하기"',
    );
    expect(issueTitle(raw({ type: 'text-overflow', subtype: 'spill', elementIndex: 3, relatedIndex: 2 }), desktop)).toBe(
      'Text Overflow · spill — button "저장하기"',
    );
    expect(issueTitle(raw({ type: 'viewport-overflow', subtype: 'page-scroll', elementIndex: 2 }), desktop)).toBe('Viewport Overflow · page-scroll — .card');
    expect(issueTitle(raw({ type: 'viewport-overflow', subtype: 'hidden-clip', elementIndex: 5 }), desktop)).toBe(
      'Viewport Overflow · hidden-clip — [data-testid="hero"]',
    );
  });

  it('Overlap 제목은 subtype 없이 상대 요소를 포함한다', () => {
    expect(issueTitle(raw({ type: 'element-overlap', subtype: 'interactive', elementIndex: 3, relatedIndex: 4 }), desktop)).toBe(
      'Element Overlap — button "저장하기" ↔ button "취소"',
    );
    expect(issueTitle(raw({ type: 'element-overlap', subtype: 'other', elementIndex: 5, relatedIndex: 3 }), desktop)).toBe(
      'Element Overlap — [data-testid="hero"] ↔ button "저장하기"',
    );
  });
});
