import { describe, expect, it } from 'vitest';
import { RETRY_URL_STORAGE_KEY, stashRetryUrl, takeRetryUrl } from '@/components/inspection/retryUrl';
import { formatConfidence, formatDateTime, formatPx } from '@/lib/format';
import { splitFencedBlocks, splitInlineCode } from '@/lib/markdownLite';
import { intersectBox } from '@/lib/rect';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

describe('다시 시도 URL (WIREFRAME 3.4, 4.5)', () => {
  it('저장한 URL을 한 번만 돌려준다', () => {
    const storage = new MemoryStorage();
    expect(stashRetryUrl('https://example.com/a', storage)).toBe(true);
    expect(takeRetryUrl(storage)).toBe('https://example.com/a');
    expect(storage.data.has(RETRY_URL_STORAGE_KEY)).toBe(false);
    expect(takeRetryUrl(storage)).toBeNull();
  });

  it('저장소가 없거나 예외를 던지면 조용히 실패한다', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(stashRetryUrl('https://example.com', broken)).toBe(false);
    expect(takeRetryUrl(broken)).toBeNull();
    expect(stashRetryUrl('https://example.com', null)).toBe(false);
    expect(takeRetryUrl(null)).toBeNull();
  });
});

describe('format', () => {
  it('px는 정수로 반올림하고 천 단위 구분', () => {
    expect(formatPx(10000)).toBe('10,000');
    expect(formatPx(53.6)).toBe('54');
  });
  it('Confidence', () => {
    expect(formatConfidence(1)).toBe('1.0');
    expect(formatConfidence(0.4)).toBe('0.4');
    expect(formatConfidence(0.45)).toBe('0.45');
  });
  it('검사 시각은 지정한 시간대로 표시한다', () => {
    expect(formatDateTime('2026-11-13T08:20:00.000Z', { locale: 'ko-KR', timeZone: 'Asia/Seoul' })).toContain('17:20');
    expect(formatDateTime('2026-11-13T08:20:00.000Z', { locale: 'ko-KR', timeZone: 'UTC' })).toContain('08:20');
    expect(formatDateTime('not a date')).toBeNull();
  });
});

describe('markdownLite (문자열로만 렌더링)', () => {
  it('펜스 코드 블록과 텍스트를 나눈다', () => {
    expect(splitFencedBlocks('수정 방향.\n\n```css\n.a {\n  width: auto;\n}\n```\n\n※ 안내')).toEqual([
      { kind: 'text', text: '수정 방향.' },
      { kind: 'code', lang: 'css', code: '.a {\n  width: auto;\n}' },
      { kind: 'text', text: '※ 안내' },
    ]);
  });
  it('닫히지 않은 펜스는 끝까지 코드', () => {
    expect(splitFencedBlocks('a\n```\nb')).toEqual([{ kind: 'text', text: 'a' }, { kind: 'code', lang: '', code: 'b' }]);
  });
  it('인라인 코드를 나누고 HTML은 글자 그대로 둔다', () => {
    expect(splitInlineCode('근거: `position: absolute`, <b>x</b> `')).toEqual([
      { kind: 'text', text: '근거: ' },
      { kind: 'code', text: 'position: absolute' },
      { kind: 'text', text: ', <b>x</b> `' },
    ]);
  });
});

describe('intersectBox', () => {
  it('교집합, 겹치지 않으면 null', () => {
    expect(intersectBox({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersectBox({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBeNull();
  });
});
