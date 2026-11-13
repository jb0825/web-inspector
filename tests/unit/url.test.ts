import { describe, expect, it } from 'vitest';
import { InspectionError } from '@/server/errors';
import { createHostChecker, type LookupFn } from '@/server/security/ssrf';
import { validateInspectionUrl } from '@/server/security/url';

// PRD 5.1, 8.6, API_SPEC 3.1

const DNS: Record<string, string[]> = {
  'example.com': ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'],
  'evil.test': ['10.0.0.1'],
  'mixed.test': ['8.8.8.8', '10.0.0.1'],
};

const lookup: LookupFn = async (hostname) => {
  const addresses = DNS[hostname];
  if (!addresses) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

const checker = () => createHostChecker({ lookup });

async function codeOf(input: string): Promise<string> {
  try {
    await validateInspectionUrl(input, checker());
    return 'OK';
  } catch (error) {
    if (error instanceof InspectionError) {
      // 메시지에 입력 URL을 넣지 않는다(AGENTS.md 8장)
      expect(error.message).not.toContain(input);
      return error.code;
    }
    throw error;
  }
}

describe('validateInspectionUrl', () => {
  it.each([
    'http://localhost',
    'http://LOCALHOST.',
    'http://foo.localhost',
    'http://printer.local',
    'http://api.internal',
    'http://127.0.0.1',
    'http://127.1',
    'http://2130706433',
    'http://0x7f000001',
    'http://0177.0.0.1',
    'http://[::1]',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:7f00:1]',
    'http://169.254.169.254',
    'http://169.254.169.254/latest/meta-data/',
    'http://metadata.google.internal',
    'http://10.0.0.1',
    'http://100.64.0.1',
    'http://0.0.0.0',
    'http://evil.test',
    'http://mixed.test',
    'https://localhost:8443/path?q=1',
    'http://metadata',
    'http://intranet/',
    'http://240.0.0.1',
    'http://255.255.255.255',
    'http://198.18.0.1',
    'http://[64:ff9b::7f00:1]',
    'http://[2002:7f00:1::]',
    'http://[::7f00:1]',
  ])('금지 대상: %s → BLOCKED_TARGET', async (input) => {
    expect(await codeOf(input)).toBe('BLOCKED_TARGET');
  });

  it.each([
    'https://user:pass@example.com',
    'https://user@example.com',
    'https://:pass@example.com',
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<p>x</p>',
    'ws://example.com',
    'example.com',
    'http://',
    'not a url',
  ])('형식 오류: %s → INVALID_URL', async (input) => {
    expect(await codeOf(input)).toBe('INVALID_URL');
  });

  it('DNS 조회 실패는 INVALID_URL (API_SPEC 3.1: 주소를 찾을 수 없음)', async () => {
    expect(await codeOf('https://nowhere.test')).toBe('INVALID_URL');
  });

  it('공개 주소는 허용하고 정규화한 URL을 돌려준다 (#fragment는 버림)', async () => {
    const url = await validateInspectionUrl('https://EXAMPLE.com/pricing?plan=pro#top', checker());
    expect(url.href).toBe('https://example.com/pricing?plan=pro');
    expect((await validateInspectionUrl('http://8.8.8.8', checker())).href).toBe('http://8.8.8.8/');
  });
});
