import { describe, expect, it } from 'vitest';
import { buildIssueDiagram, devtoolsQuery, DIAGRAM_MIN_HEIGHT_PX, DIAGRAM_MIN_WIDTH_PX, DIAGRAM_PADDING_PX, openablePageUrl } from '@/features/issue-detail/diagram';
import type { IssueOccurrence, RelatedElement } from '@/types/inspection';

// T14 / WIREFRAME 6.4: 스크린샷이 없는 viewport의 이슈 도면. 저장된 측정값만 쓴다.
// 입력 값은 Fixture 결과(.tmp/fixtures-report)의 실제 occurrence 값이다.

type Occ = Pick<IssueOccurrence, 'boundingBox' | 'measured' | 'expected' | 'relatedElements'>;
const related = (role: RelatedElement['role'], boundingBox: RelatedElement['boundingBox']): RelatedElement => ({ role, selector: '#r', tag: 'div', boundingBox });
const kinds = (shapes: { kind: string }[]) => shapes.map((s) => s.kind);

describe('buildIssueDiagram: 유형별 도형', () => {
  it('viewport-overflow (P-04 hidden-clip): elementLeft~elementRight 중 화면 밖 부분만 강조한다', () => {
    const occ: Occ = { boundingBox: { x: 1084, y: 163.39, width: 400, height: 300 }, measured: { elementLeft: 1084, elementRight: 1484 }, expected: { layoutWidth: 1440, minLeft: 0 }, relatedElements: [] };
    const d = buildIssueDiagram({ type: 'viewport-overflow', subtype: 'hidden-clip' }, occ, 1440);
    expect(kinds(d.shapes)).toEqual(['target', 'overflow']);
    expect(d.shapes[1]).toMatchObject({ box: { x: 1440, y: 163.39, width: 44, height: 300 }, label: '화면 밖 44px' });
    // 영역: 넘친 범위(1084~1484)를 여백 24px로 감싼다. 화면 경계(1440)로 자르지 않는다
    expect(d.region).toEqual({ x: 1060, y: 139.39, width: 448, height: 348 });
    expect(d.layoutWidth).toBe(1440);
  });

  it('viewport-overflow 왼쪽으로 나간 경우와 page-scroll(elementLeft 없음)', () => {
    const left = buildIssueDiagram({ type: 'viewport-overflow', subtype: 'element-out' }, { boundingBox: { x: -30, y: 0, width: 100, height: 40 }, measured: { elementLeft: -30, elementRight: 70 }, expected: {}, relatedElements: [] }, 390);
    expect(left.shapes.find((s) => s.kind === 'overflow')).toMatchObject({ box: { x: -30, y: 0, width: 30, height: 40 }, label: '화면 밖 30px' });
    // P-01 Mobile: boundingBox 16~616, elementRight 616, layoutWidth 390
    const page = buildIssueDiagram({ type: 'viewport-overflow', subtype: 'page-scroll' }, { boundingBox: { x: 16, y: 197.38, width: 600, height: 105.8 }, measured: { elementRight: 616, documentScrollWidth: 616 }, expected: { layoutWidth: 390 }, relatedElements: [] }, 390);
    expect(page.shapes.find((s) => s.kind === 'overflow')).toMatchObject({ box: { x: 390, width: 226 }, label: '화면 밖 226px' });
  });

  it('spill (P-05): 컨테이너(bordered-ancestor) 박스와 넘친 방향의 텍스트 띠', () => {
    const occ: Occ = {
      boundingBox: { x: 272, y: 1093.59, width: 328, height: 120 },
      measured: { textBottom: 1211.59 },
      expected: { containerBottom: 1169.8 },
      relatedElements: [related('bordered-ancestor', { x: 256, y: 1049.8, width: 360, height: 120 })],
    };
    const d = buildIssueDiagram({ type: 'text-overflow', subtype: 'spill' }, occ, 1440);
    expect(kinds(d.shapes)).toEqual(['related', 'target', 'overflow']);
    expect(d.shapes[0]!.label).toBe('테두리가 있는 상위 요소');
    expect(d.shapes[2]).toMatchObject({ box: { x: 256, y: 1169.8, width: 360 }, label: '아래로 넘친 텍스트 41.79px' });
    expect(d.shapes[2]!.box.height).toBeCloseTo(41.79, 6);
  });

  it('spill: 컨테이너 정보가 없으면 넘침 띠를 그리지 않는다', () => {
    const d = buildIssueDiagram({ type: 'text-overflow', subtype: 'spill' }, { boundingBox: { x: 0, y: 0, width: 10, height: 10 }, measured: { textRight: 40 }, expected: {}, relatedElements: [] }, 390);
    expect(kinds(d.shapes)).toEqual(['target']);
  });

  it('clipped (P-02): 요소 박스와 scrollWidth − clientWidth 만큼의 잘린 내용, 위치가 근사라는 안내', () => {
    const occ: Occ = { boundingBox: { x: 16, y: 1232.56, width: 180, height: 44 }, measured: { scrollWidth: 227 }, expected: { clientWidth: 180 }, relatedElements: [] };
    const d = buildIssueDiagram({ type: 'text-overflow', subtype: 'clipped' }, occ, 390);
    expect(kinds(d.shapes)).toEqual(['target', 'overflow']);
    expect(d.shapes[1]).toMatchObject({ box: { x: 196, y: 1232.56, width: 47, height: 44 }, label: '잘린 내용 가로 47px' });
    expect(d.notes).toHaveLength(1);
    const y = buildIssueDiagram({ type: 'text-overflow', subtype: 'clipped' }, { ...occ, measured: { scrollHeight: 90 }, expected: { clientHeight: 44 } }, 390);
    expect(y.shapes[1]).toMatchObject({ box: { x: 16, y: 1276.56, width: 180, height: 46 }, label: '잘린 내용 세로 46px' });
  });

  it('element-overlap (P-03): 두 요소 박스와 교차 영역', () => {
    const occ: Occ = {
      boundingBox: { x: 277, y: 209.98, width: 90.89, height: 44 },
      measured: { intersectionArea: 968.04, overlapRatioPercent: 35.8, overlapTargetCount: 1 },
      expected: {},
      relatedElements: [related('overlap-target', { x: 341, y: 217.98, width: 61.45, height: 44 })],
    };
    const d = buildIssueDiagram({ type: 'element-overlap', subtype: 'interactive' }, occ, 1440);
    expect(kinds(d.shapes)).toEqual(['related', 'target', 'intersection']);
    const area = d.shapes[2]!.box;
    expect(area.x).toBe(341);
    expect(area.width).toBeCloseTo(26.89, 6);
    expect(area.width * area.height).toBeCloseTo(968.04, 1);
  });

  it('작은 요소도 최소 320×160 영역으로 그린다 (cropRect와 같은 기준)', () => {
    const d = buildIssueDiagram({ type: 'text-overflow', subtype: 'clipped' }, { boundingBox: { x: 100, y: 100, width: 10, height: 10 }, measured: {}, expected: {}, relatedElements: [] }, 390);
    expect(d.region.width).toBe(DIAGRAM_MIN_WIDTH_PX);
    expect(d.region.height).toBe(DIAGRAM_MIN_HEIGHT_PX);
    expect(d.region.x + d.region.width / 2).toBe(105);
    expect(DIAGRAM_PADDING_PX).toBe(24);
  });
});

describe('Issue Detail 도구', () => {
  it('개발자 도구 코드: selector를 JS 문자열로 안전하게 넣는다', () => {
    expect(devtoolsQuery('[data-testid="plan-team-note"]')).toBe('document.querySelector("[data-testid=\\"plan-team-note\\"]")');
    expect(devtoolsQuery("a[title='x']")).toBe(`document.querySelector("a[title='x']")`);
    expect(devtoolsQuery('div\n</script>')).toBe('document.querySelector("div\\n</script>")');
  });

  it('실제 페이지 열기: http/https만', () => {
    expect(openablePageUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(openablePageUrl('http://example.com')).toBe('http://example.com/');
    expect(openablePageUrl('javascript:alert(1)')).toBeNull();
    expect(openablePageUrl('data:text/html,x')).toBeNull();
    expect(openablePageUrl('not a url')).toBeNull();
    expect(openablePageUrl(undefined)).toBeNull();
  });
});

describe('buildIssueDiagram: 도면 위 치수 문구 (시안 schematic-issue-types.png)', () => {
  it('정수 px로 짧게 쓴다', () => {
    const vo = buildIssueDiagram({ type: 'viewport-overflow', subtype: 'hidden-clip' }, { boundingBox: { x: 1084, y: 163.39, width: 400, height: 300 }, measured: { elementLeft: 1084, elementRight: 1484.4 }, expected: {}, relatedElements: [] }, 1440);
    expect(vo.shapes.find((s) => s.kind === 'overflow')?.mark).toBe('화면 밖 44px');
    const clipped = buildIssueDiagram({ type: 'text-overflow', subtype: 'clipped' }, { boundingBox: { x: 40, y: 1050, width: 278, height: 30 }, measured: { scrollWidth: 326 }, expected: { clientWidth: 278 }, relatedElements: [] }, 390);
    expect(clipped.shapes.find((s) => s.kind === 'overflow')?.mark).toBe('잘린 48px');
    const spill = buildIssueDiagram(
      { type: 'text-overflow', subtype: 'spill' },
      { boundingBox: { x: 20, y: 20, width: 200, height: 150 }, measured: { textBottom: 191.79 }, expected: {}, relatedElements: [related('bordered-ancestor', { x: 10, y: 10, width: 220, height: 140 })] },
      390,
    );
    expect(spill.shapes.find((s) => s.kind === 'overflow')?.mark).toBe('아래쪽 42px 넘침');
  });

  it('Overlap의 대표 상대 요소(relatedElements[0])를 표시한다', () => {
    const d = buildIssueDiagram(
      { type: 'element-overlap', subtype: 'interactive' },
      { boundingBox: { x: 0, y: 0, width: 100, height: 40 }, measured: {}, expected: {}, relatedElements: [related('overlap-target', { x: 60, y: 20, width: 100, height: 40 }), related('overlap-target', { x: 0, y: 30, width: 50, height: 40 })] },
      390,
    );
    expect(d.shapes.filter((s) => s.partner)).toHaveLength(1);
    expect(d.shapes.find((s) => s.partner)?.box.x).toBe(60);
  });
});
