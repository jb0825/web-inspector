import { describe, expect, it, vi } from 'vitest';
import { createHostChecker, embeddedIpv4, isBlockedHostname, isBlockedIp, normalizeHostname, type LookupFn } from '@/server/security/ssrf';

// PRD 8.6 차단 범위. 범위마다 경계 안(처음, 끝)과 바로 밖의 값

describe('isBlockedIp: IPv4', () => {
  const cases: [range: string, inside: string[], outside: string[]][] = [
    ['0.0.0.0/8', ['0.0.0.0', '0.255.255.255'], ['1.0.0.0']],
    ['10.0.0.0/8', ['10.0.0.0', '10.0.0.1', '10.255.255.255'], ['9.255.255.255', '11.0.0.0']],
    ['100.64.0.0/10', ['100.64.0.0', '100.64.0.1', '100.127.255.255'], ['100.63.255.255', '100.128.0.0']],
    ['127.0.0.0/8', ['127.0.0.0', '127.0.0.1', '127.255.255.255'], ['126.255.255.255', '128.0.0.0']],
    ['169.254.0.0/16', ['169.254.0.0', '169.254.169.254', '169.254.255.255'], ['169.253.255.255', '169.255.0.0']],
    ['172.16.0.0/12', ['172.16.0.0', '172.31.255.255'], ['172.15.255.255', '172.32.0.0']],
    ['192.168.0.0/16', ['192.168.0.0', '192.168.255.255'], ['192.167.255.255', '192.169.0.0']],
    ['224.0.0.0/4', ['224.0.0.0', '239.255.255.255'], ['223.255.255.255']],
    ['198.18.0.0/15 (추가)', ['198.18.0.0', '198.19.255.255'], ['198.17.255.255', '198.20.0.0']],
    ['240.0.0.0/4 (추가)', ['240.0.0.0', '240.0.0.1', '254.255.255.255'], []], // 바로 아래 239.x는 multicast(224/4),
    ['255.255.255.255 (추가)', ['255.255.255.255'], []],
  ];
  for (const [range, inside, outside] of cases) {
    it(range, () => {
      for (const ip of inside) expect(isBlockedIp(ip), ip).toBe(true);
      for (const ip of outside) expect(isBlockedIp(ip), ip).toBe(false);
    });
  }

  it('공개 IP는 허용한다', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34']) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it('PRD 8.6에 없는 범위는 차단하지 않는다', () => {
    // 문서용 TEST-NET(192.0.2/24, 203.0.113/24)은 PRD에 없다
    for (const ip of ['192.0.2.1', '203.0.113.1', '172.32.0.1']) expect(isBlockedIp(ip), ip).toBe(false);
  });
});

describe('isBlockedIp: IPv6', () => {
  const cases: [range: string, inside: string[], outside: string[]][] = [
    ['::/128', ['::'], ['::1:0:0:0']],
    ['::1/128', ['::1', '0:0:0:0:0:0:0:1'], ['::1:0:0:1']], // ::2는 IPv4-compatible 0.0.0.2로 막힌다,
    ['fc00::/7', ['fc00::', 'fd00::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'], ['fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fe00::']],
    ['fe80::/10', ['fe80::', 'fe80::1', 'febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff'], ['fe7f:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fec0::']],
    ['ff00::/8', ['ff00::', 'ff02::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'], ['feff:ffff:ffff:ffff:ffff:ffff:ffff:ffff']],
  ];
  for (const [range, inside, outside] of cases) {
    it(range, () => {
      for (const ip of inside) expect(isBlockedIp(ip), ip).toBe(true);
      for (const ip of outside) expect(isBlockedIp(ip), ip).toBe(false);
    });
  }

  it('공개 IPv6는 허용한다', () => {
    for (const ip of ['2606:4700::1', '2001:4860:4860::8888']) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it('대괄호 표기도 판정한다', () => {
    expect(isBlockedIp('[::1]')).toBe(true);
    expect(isBlockedIp('[2606:4700::1]')).toBe(false);
  });
});

describe('isBlockedIp: IPv4-mapped IPv6 (::ffff:0:0/96)', () => {
  it('안의 IPv4로 판정한다 (점 표기와 16진수 표기)', () => {
    for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:7F00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:7f00:1']) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808']) expect(isBlockedIp(ip), ip).toBe(false);
  });
});

describe('isBlockedIp: IPv4를 담는 IPv6 (NAT64, 6to4, IPv4-compatible)', () => {
  it('embeddedIpv4가 안의 IPv4를 꺼낸다', () => {
    expect(embeddedIpv4('64:ff9b::7f00:1')).toBe('127.0.0.1');
    expect(embeddedIpv4('64:ff9b::10.0.0.1')).toBe('10.0.0.1');
    expect(embeddedIpv4('2002:7f00:1::')).toBe('127.0.0.1');
    expect(embeddedIpv4('2002:a9fe:a9fe:1234::1')).toBe('169.254.169.254');
    expect(embeddedIpv4('::7f00:1')).toBe('127.0.0.1');
    expect(embeddedIpv4('::10.0.0.1')).toBe('10.0.0.1');
    expect(embeddedIpv4('::ffff:7f00:1')).toBe('127.0.0.1');
    expect(embeddedIpv4('2606:4700::1')).toBeNull();
    // NAT64 접두가 다르면(64:ff9b:1::/48 등) 해당하지 않는다
    expect(embeddedIpv4('64:ff9b:1::7f00:1')).toBeNull();
  });

  it('NAT64 (64:ff9b::/96)', () => {
    for (const ip of ['64:ff9b::7f00:1', '64:ff9b::127.0.0.1', '64:ff9b::a00:1', '64:ff9b::a9fe:a9fe']) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ['64:ff9b::808:808', '64:ff9b::8.8.8.8']) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it('6to4 (2002::/16)', () => {
    for (const ip of ['2002:7f00:1::', '2002:0a00:0001::1', '2002:c0a8:0101::', '2002:a9fe:a9fe::1']) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ['2002:808:808::1', '2002:5db8:d822::']) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it('IPv4-compatible (::/96)', () => {
    for (const ip of ['::7f00:1', '::127.0.0.1', '::a00:1', '::a9fe:a9fe', '::0.0.0.2']) expect(isBlockedIp(ip), ip).toBe(true);
    for (const ip of ['::808:808', '::8.8.8.8']) expect(isBlockedIp(ip), ip).toBe(false);
  });

  it('zone 표기가 붙은 주소도 판정한다', () => {
    expect(isBlockedIp('fe80::1%eth0')).toBe(true);
  });
});

describe('isBlockedIp: IP가 아닌 값', () => {
  it('판정할 수 없으면 막는다', () => {
    for (const value of ['', 'example.com', '127.0.0.1.1', '1.2.3', '::ffff:', 'abc']) expect(isBlockedIp(value), value).toBe(true);
  });
});

describe('normalizeHostname', () => {
  it('URL 파서로 정규화한다', () => {
    expect(normalizeHostname('LOCALHOST.')).toBe('localhost');
    expect(normalizeHostname('Example.COM')).toBe('example.com');
    expect(normalizeHostname('2130706433')).toBe('127.0.0.1');
    expect(normalizeHostname('0x7f000001')).toBe('127.0.0.1');
    expect(normalizeHostname('127.1')).toBe('127.0.0.1');
    expect(normalizeHostname('[::1]')).toBe('::1');
    expect(normalizeHostname('::ffff:127.0.0.1')).toBe('::ffff:7f00:1');
    expect(normalizeHostname('bücher.example')).toBe('xn--bcher-kva.example');
  });

  it('호스트로 쓸 수 없는 값은 null', () => {
    for (const value of ['', '  ', 'a b', 'host:8080', 'user@host', 'host/path', 'host?q', '[::1']) expect(normalizeHostname(value), value).toBeNull();
  });
});

/** 가짜 DNS. 매핑에 없으면 ENOTFOUND */
function fakeLookup(map: Record<string, string[]>): LookupFn & ReturnType<typeof vi.fn> {
  return vi.fn(async (hostname: string) => {
    const addresses = map[hostname];
    if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
    return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  });
}

describe('isBlockedHostname', () => {
  it('점이 없는 호스트 이름은 차단한다 (PRD 8.6)', () => {
    for (const host of ['metadata', 'intranet', 'printer', 'localhost']) expect(isBlockedHostname(host), host).toBe(true);
    for (const host of ['example.com', 'a.b']) expect(isBlockedHostname(host), host).toBe(false);
  });
});

describe('createHostChecker', () => {
  it('금지 호스트 이름은 DNS 조회 없이 차단한다 (대소문자, 끝의 점 정규화)', async () => {
    const lookup = fakeLookup({});
    const checker = createHostChecker({ lookup });
    for (const host of ['localhost', 'LOCALHOST.', 'foo.localhost', 'printer.local', 'api.internal', 'metadata.google.internal', 'METADATA.GOOGLE.INTERNAL.']) {
      expect(await checker.check(host), host).toEqual({ allowed: false, reason: 'blocked-hostname' });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it('점이 없는 이름은 DNS 조회 없이 차단한다. 점이 없는 IP 리터럴(2130706433)은 IP로 판정한다', async () => {
    const lookup = fakeLookup({ metadata: ['8.8.8.8'] });
    const checker = createHostChecker({ lookup });
    expect(await checker.check('metadata')).toEqual({ allowed: false, reason: 'blocked-hostname' });
    expect(await checker.check('METADATA.')).toEqual({ allowed: false, reason: 'blocked-hostname' });
    expect(await checker.check('2130706433')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('134744072')).toEqual({ allowed: true, reason: 'public' }); // 8.8.8.8
    expect(await checker.check('2606:4700::1')).toEqual({ allowed: true, reason: 'public' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('IP 리터럴은 DNS 조회 없이 판정한다', async () => {
    const lookup = fakeLookup({});
    const checker = createHostChecker({ lookup });
    expect(await checker.check('127.0.0.1')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('[::ffff:7f00:1]')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('8.8.8.8')).toEqual({ allowed: true, reason: 'public' });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('DNS 결과 중 하나라도 차단 대상이면 차단한다', async () => {
    const checker = createHostChecker({
      lookup: fakeLookup({ 'evil.test': ['10.0.0.1'], 'mixed.test': ['8.8.8.8', '10.0.0.1'], 'v6.test': ['2606:4700::1', '::1'], 'ok.test': ['93.184.216.34', '2606:4700::1'] }),
    });
    expect(await checker.check('evil.test')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('mixed.test')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('v6.test')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('ok.test')).toEqual({ allowed: true, reason: 'public' });
  });

  it('조회 실패와 시간 초과는 금지 대상과 구분한다', async () => {
    const hang: LookupFn = () => new Promise(() => undefined);
    expect(await createHostChecker({ lookup: fakeLookup({}) }).check('nowhere.test')).toEqual({ allowed: false, reason: 'dns-failed' });
    expect(await createHostChecker({ lookup: fakeLookup({ 'empty.test': [] }) }).check('empty.test')).toEqual({ allowed: false, reason: 'dns-failed' });
    expect(await createHostChecker({ lookup: hang, lookupTimeoutMs: 20 }).check('slow.test')).toEqual({ allowed: false, reason: 'dns-timeout' });
  });

  it('같은 호스트는 한 번만 조회한다 (동시 요청 포함, 정규화한 이름 기준)', async () => {
    const lookup = fakeLookup({ 'example.com': ['93.184.216.34'] });
    const checker = createHostChecker({ lookup });
    await Promise.all([checker.check('example.com'), checker.check('EXAMPLE.com.')]);
    await checker.check('example.com');
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it('checker마다 캐시가 따로다 (검사 1회 = checker 1개)', async () => {
    const lookup = fakeLookup({ 'example.com': ['93.184.216.34'] });
    await createHostChecker({ lookup }).check('example.com');
    await createHostChecker({ lookup }).check('example.com');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('allowHosts가 없으면 127.0.0.1은 항상 차단된다', async () => {
    expect(await createHostChecker().check('127.0.0.1')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await createHostChecker({ allowHosts: [] }).check('127.0.0.1')).toEqual({ allowed: false, reason: 'blocked-ip' });
  });

  it('allowHosts에 있는 호스트만 판정을 건너뛴다', async () => {
    const checker = createHostChecker({ allowHosts: ['127.0.0.1'], lookup: fakeLookup({}) });
    expect(await checker.check('127.0.0.1')).toEqual({ allowed: true, reason: 'allow-listed' });
    // 다른 loopback 주소와 localhost는 여전히 차단
    expect(await checker.check('127.0.0.2')).toEqual({ allowed: false, reason: 'blocked-ip' });
    expect(await checker.check('localhost')).toEqual({ allowed: false, reason: 'blocked-hostname' });
  });

  it('호스트로 쓸 수 없는 값은 차단한다', async () => {
    expect(await createHostChecker().check('')).toEqual({ allowed: false, reason: 'invalid-host' });
  });
});
