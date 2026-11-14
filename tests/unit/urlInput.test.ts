import { describe, expect, it } from 'vitest';
import { normalizeUrlInput } from '@/features/inspection-form/normalizeUrl';

describe('normalizeUrlInput', () => {
  it('앞뒤 공백을 지운다', () => {
    expect(normalizeUrlInput('  https://example.com/pricing \n')).toEqual({ ok: true, url: 'https://example.com/pricing' });
  });

  it('빈 값과 공백만 있는 값은 empty', () => {
    expect(normalizeUrlInput('')).toEqual({ ok: false, error: 'empty' });
    expect(normalizeUrlInput('   ')).toEqual({ ok: false, error: 'empty' });
  });

  it('스킴이 없으면 https://를 붙인다', () => {
    expect(normalizeUrlInput('example.com')).toEqual({ ok: true, url: 'https://example.com' });
    expect(normalizeUrlInput('example.com/a?b=1')).toEqual({ ok: true, url: 'https://example.com/a?b=1' });
    expect(normalizeUrlInput('example.com:8080')).toEqual({ ok: true, url: 'https://example.com:8080' });
  });

  it('이미 http:// 또는 https://면 그대로 둔다', () => {
    expect(normalizeUrlInput('http://example.com')).toEqual({ ok: true, url: 'http://example.com' });
    expect(normalizeUrlInput('HTTPS://Example.com')).toEqual({ ok: true, url: 'HTTPS://Example.com' });
  });

  it('http/https가 아닌 스킴은 protocol', () => {
    expect(normalizeUrlInput('ftp://example.com')).toEqual({ ok: false, error: 'protocol' });
    expect(normalizeUrlInput('javascript:alert(1)')).toEqual({ ok: false, error: 'protocol' });
    expect(normalizeUrlInput('mailto:a@example.com')).toEqual({ ok: false, error: 'protocol' });
  });

  it('URL로 해석되지 않으면 invalid', () => {
    expect(normalizeUrlInput('https://')).toEqual({ ok: false, error: 'invalid' });
    expect(normalizeUrlInput('exa mple.com')).toEqual({ ok: false, error: 'invalid' });
  });

  it('2,048자를 넘으면 invalid', () => {
    expect(normalizeUrlInput(`https://example.com/${'a'.repeat(2100)}`)).toEqual({ ok: false, error: 'invalid' });
  });

  it('금지 대상 판정은 하지 않는다 (서버가 한다)', () => {
    expect(normalizeUrlInput('localhost:3000')).toEqual({ ok: true, url: 'https://localhost:3000' });
  });
});
