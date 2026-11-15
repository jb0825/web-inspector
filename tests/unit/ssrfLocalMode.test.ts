import { describe, expect, it } from 'vitest';
import { createHostChecker, invalidLocalAllowHosts, isAlwaysBlockedIp, isLoopbackIp, type LookupFn } from '@/server/security/ssrf';
import { InvalidLocalAllowHostsError, resolveHostPolicy } from '@/server/security/policy';

// PRD 8.7 로컬 모드의 주소 정책. public 모드 동작은 ssrf.test.ts가 그대로 검증한다.

const fakeLookup =
  (table: Record<string, string[]>): LookupFn =>
  async (hostname) => {
    const addresses = table[hostname];
    if (!addresses) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };

const local = (allowHosts: string[] = [], table: Record<string, string[]> = {}) =>
  createHostChecker({ policy: { mode: 'local', allowHosts }, lookup: fakeLookup(table) });

describe('public 모드 (기본값)', () => {
  it('localhost와 loopback은 계속 차단한다', async () => {
    const checker = createHostChecker({ lookup: fakeLookup({}) });
    expect(await checker.check('localhost')).toEqual({ allowed: false, reason: 'blocked-hostname' });
    expect(await checker.check('app.localhost')).toEqual({ allowed: false, reason: 'blocked-hostname' });
    expect(await checker.check('127.0.0.1')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('::1')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await createHostChecker({ policy: { mode: 'public' } }).check('127.0.0.1')).toEqual({ allowed: false, reason: 'blocked-ip' });
  });

  it('resolveHostPolicy는 public 모드에서 LOCAL_ALLOW_HOSTS를 쓰지 않는다', () => {
    expect(resolveHostPolicy({ mode: 'public', localAllowHosts: ['192.168.0.10'] })).toEqual({ mode: 'public' });
  });
});

describe('local 모드', () => {
  it('localhost, *.localhost, 127.0.0.0/8, ::1을 허용한다', async () => {
    const checker = local();
    for (const host of ['localhost', 'app.localhost', '127.0.0.1', '127.1.2.3', '[::1]', '::ffff:127.0.0.1', '2130706433']) {
      expect((await checker.check(host)).allowed, host).toBe(true);
    }
    expect(await checker.check('localhost')).toEqual({ allowed: true, reason: 'local-loopback' });
  });

  it('169.254.169.254(메타데이터), 링크 로컬, 0.0.0.0은 항상 차단한다', async () => {
    const checker = local();
    for (const host of ['169.254.169.254', '169.254.0.1', '[fe80::1]', 'fe80::1%25en0', '0.0.0.0', '0', '::', '::ffff:169.254.169.254']) {
      expect(await checker.check(host), host).toMatchObject({ allowed: false });
    }
  });

  it('LOCAL_ALLOW_HOSTS에 없는 사설 주소(192.168.x)는 차단한다', async () => {
    const checker = local();
    expect(await checker.check('192.168.0.10')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('10.0.0.5')).toEqual({ allowed: false, reason: 'blocked-ip' });
  });

  it('LOCAL_ALLOW_HOSTS에 적은 IP와 호스트 이름만 추가로 허용한다', async () => {
    const checker = local(['192.168.0.10', 'nas.lan', 'devbox'], { 'nas.lan': ['192.168.0.20'], devbox: ['10.0.0.7'], 'other.lan': ['192.168.0.30'] });
    expect(await checker.check('192.168.0.10')).toEqual({ allowed: true, reason: 'local-allow-listed' });
    expect(await checker.check('192.168.0.11')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('nas.lan')).toEqual({ allowed: true, reason: 'local-allow-listed' });
    // 점 없는 이름도 명시하면 허용한다
    expect(await checker.check('devbox')).toEqual({ allowed: true, reason: 'local-allow-listed' });
    expect(await checker.check('other.lan')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('intranet')).toEqual({ allowed: false, reason: 'blocked-hostname' });
  });

  it('허용한 이름이라도 조회 결과에 메타데이터·링크 로컬 주소가 있으면 차단한다', async () => {
    const checker = local(['nas.lan'], { 'nas.lan': ['192.168.0.20', '169.254.169.254'] });
    expect(await checker.check('nas.lan')).toEqual({ allowed: false, reason: 'blocked-ip' });
  });

  it('공개 이름이 loopback으로 조회되면 허용하지만, 메타데이터로 조회되면 차단한다', async () => {
    const checker = local([], { 'lvh.example': ['127.0.0.1'], 'evil.example': ['169.254.169.254'], 'public.example': ['93.184.216.34'] });
    expect(await checker.check('lvh.example')).toEqual({ allowed: true, reason: 'local-loopback' });
    expect(await checker.check('evil.example')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('public.example')).toEqual({ allowed: true, reason: 'public' });
  });

  it('리다이렉트 hop처럼 같은 checker로 이어서 물어도 메타데이터 주소는 차단한다', async () => {
    // routeGuard.ts는 처음 URL, 리다이렉트 hop, 하위 요청을 모두 같은 checker로 판정한다
    const checker = local();
    expect((await checker.check('localhost')).allowed).toBe(true);
    expect(await checker.check('169.254.169.254')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('metadata.google.internal')).toMatchObject({ allowed: false });
  });
});

describe('LOCAL_ALLOW_HOSTS 형식', () => {
  it('와일드카드, 대역, 포트, 경로, 항상 차단 주소, 메타데이터 이름은 받지 않는다', () => {
    expect(invalidLocalAllowHosts(['*.lan', '192.168.0.0/24', '192.168.0.10:3000', 'nas.lan/x', '169.254.169.254', 'fe80::1', 'metadata.google.internal', '0.0.0.0'])).toHaveLength(8);
    expect(invalidLocalAllowHosts(['192.168.0.10', 'nas.lan', 'devbox', 'fd00::1'])).toEqual([]);
  });

  it('잘못된 항목이 있으면 정책을 만들지 않는다(조용히 버리지 않는다)', () => {
    expect(() => resolveHostPolicy({ mode: 'local', localAllowHosts: ['*.lan'] })).toThrow(InvalidLocalAllowHostsError);
    expect(() => createHostChecker({ policy: { mode: 'local', allowHosts: ['10.0.0.0/8'] } })).toThrow();
    expect(resolveHostPolicy({ mode: 'local', localAllowHosts: ['nas.lan'] })).toEqual({ mode: 'local', allowHosts: ['nas.lan'] });
  });
});

describe('isAlwaysBlockedIp / isLoopbackIp', () => {
  it('경계값', () => {
    expect(isAlwaysBlockedIp('169.254.0.0')).toBe(true);
    expect(isAlwaysBlockedIp('169.254.255.255')).toBe(true);
    expect(isAlwaysBlockedIp('169.255.0.0')).toBe(false);
    expect(isAlwaysBlockedIp('febf::1')).toBe(true);
    expect(isAlwaysBlockedIp('fec0::1')).toBe(false);
    expect(isAlwaysBlockedIp('0.0.0.1')).toBe(false); // 0.0.0.0/8의 나머지는 public 규칙(isBlockedIp)이 막는다
    expect(isLoopbackIp('127.255.255.255')).toBe(true);
    expect(isLoopbackIp('128.0.0.1')).toBe(false);
    expect(isLoopbackIp('::2')).toBe(false);
    expect(isLoopbackIp('64:ff9b::7f00:1')).toBe(false); // NAT64는 실제 loopback이 아니다
  });
});
