import 'server-only';
import { promises as dns } from 'node:dns';
import { BlockList, isIP } from 'node:net';

// PRD 8.6: 내부망, 메타데이터, 로컬 주소 차단. 범위 판정은 node:net의 BlockList(비트 비교)로 한다.

/** PRD 8.6: DNS 조회 1회의 시간 제한. 넘으면 조회 실패로 본다 */
export const DNS_LOOKUP_TIMEOUT_MS = 5_000;

/** PRD 8.6의 차단 범위. 이 목록 밖의 범위는 차단하지 않는다 */
export const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // 사설
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (클라우드 메타데이터 169.254.169.254 포함)
  ['172.16.0.0', 12], // 사설
  ['192.168.0.0', 16], // 사설
  ['198.18.0.0', 15], // 벤치마크 (PRD 8.6 추가 범위)
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // 예약 (PRD 8.6 추가 범위)
  ['255.255.255.255', 32], // 브로드캐스트 (240/4에 포함되지만 PRD 8.6에 따로 적혀 있어 명시한다)
] as const;

export const BLOCKED_IPV6_RANGES = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // ULA
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const;

const BLOCK_LIST = (() => {
  const list = new BlockList();
  for (const [network, prefix] of BLOCKED_IPV4_RANGES) list.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of BLOCKED_IPV6_RANGES) list.addSubnet(network, prefix, 'ipv6');
  return list;
})();

/** IPv6 주소(isIP === 6인 값)를 16바이트로 푼다. 끝의 점 표기 IPv4(`::ffff:1.2.3.4`)도 처리한다 */
function ipv6ToBytes(address: string): number[] {
  let text = address;
  const tail: number[] = [];
  const lastColon = text.lastIndexOf(':');
  if (text.slice(lastColon + 1).includes('.')) {
    tail.push(...text.slice(lastColon + 1).split('.').map(Number));
    text = text.slice(0, lastColon + 1) + '0:0'; // 자리만 맞추고 아래에서 덮어쓴다
  }
  const [head, rest] = text.includes('::') ? text.split('::') : [text, undefined];
  const parse = (part: string | undefined) => (part ? part.split(':').filter((g) => g !== '').map((g) => parseInt(g, 16)) : []);
  const left = parse(head);
  const right = parse(rest);
  const groups = rest === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
  const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

const startsWith = (bytes: number[], prefix: number[]) => prefix.every((b, i) => bytes[i] === b);

/**
 * IPv4를 담는 IPv6 형식이면 안의 IPv4를 꺼낸다 (PRD 8.6).
 * - IPv4-mapped `::ffff:0:0/96`, IPv4-compatible `::/96`, NAT64 `64:ff9b::/96`: 마지막 32비트
 * - 6to4 `2002::/16`: 17~48번째 비트
 */
export function embeddedIpv4(ipv6: string): string | null {
  const bytes = ipv6ToBytes(ipv6);
  const zeros = (n: number) => Array(n).fill(0) as number[];
  let v4: number[] | null = null;
  if (startsWith(bytes, [...zeros(10), 0xff, 0xff]) || startsWith(bytes, zeros(12)) || startsWith(bytes, [0x00, 0x64, 0xff, 0x9b, ...zeros(8)])) {
    v4 = bytes.slice(12, 16);
  } else if (startsWith(bytes, [0x20, 0x02])) {
    v4 = bytes.slice(2, 6);
  }
  return v4 ? v4.join('.') : null;
}

/**
 * IP 주소가 PRD 8.6의 차단 범위에 있는지. IP가 아니면 true(판정할 수 없는 값은 막는다).
 * IPv4를 담는 IPv6(mapped, compatible, NAT64, 6to4)는 안의 IPv4로도 판정한다.
 */
export function isBlockedIp(ip: string): boolean {
  const address = stripZone(stripBrackets(ip));
  const family = isIP(address);
  if (family === 0) return true;
  if (family === 4) return BLOCK_LIST.check(address, 'ipv4');
  if (BLOCK_LIST.check(address, 'ipv6')) return true;
  const v4 = embeddedIpv4(address);
  return v4 !== null && BLOCK_LIST.check(v4, 'ipv4');
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

/** link-local의 zone 표기(`fe80::1%eth0`)는 떼고 주소만 판정한다 */
function stripZone(address: string): string {
  const index = address.indexOf('%');
  return index === -1 ? address : address.slice(0, index);
}

/** PRD 8.6: 금지 호스트 이름 (metadata.google.internal은 *.internal에 포함된다) */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

/**
 * 호스트 이름을 판정용으로 정규화한다. WHATWG URL 파서를 거쳐 소문자, punycode, IPv4 표기(10진수, 16진수, 축약형)를
 * 정규화하고, 괄호와 끝의 점 하나를 뗀다. 호스트로 쓸 수 없는 값이면 null.
 */
export function normalizeHostname(input: string): string | null {
  const raw = input.trim();
  if (raw === '') return null;
  const wrapped = isIP(raw) === 6 ? `[${raw}]` : raw;
  let hostname: string;
  try {
    const url = new URL(`http://${wrapped}/`);
    // 호스트 이외의 부분(포트, 경로, 계정 정보)이 섞여 있으면 거부한다
    if (url.port !== '' || url.username !== '' || url.password !== '' || url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
    hostname = url.hostname;
  } catch {
    return null;
  }
  hostname = stripBrackets(hostname);
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  return hostname === '' ? null : hostname;
}

/** IP 리터럴이 아닌 정규화된 호스트 이름. 점이 없는 이름(`metadata`, `intranet`)은 내부 이름으로 보고 막는다(PRD 8.6) */
export function isBlockedHostname(hostname: string): boolean {
  if (!hostname.includes('.')) return true;
  return BLOCKED_HOSTNAMES.has(hostname) || BLOCKED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export type HostCheckResult =
  /** local-loopback, local-allow-listed: 로컬 모드 정책으로만 허용된 대상 (PRD 8.7) */
  | { allowed: true; reason: 'allow-listed' | 'public' | 'local-loopback' | 'local-allow-listed' }
  /** 금지 대상 (BLOCKED_TARGET) */
  | { allowed: false; reason: 'invalid-host' | 'blocked-hostname' | 'blocked-ip' }
  /** 조회 실패. 금지 대상과 구분한다 (요청 단계는 INVALID_URL, API_SPEC 3.1) */
  | { allowed: false; reason: 'dns-failed' | 'dns-timeout' };

export type HostBlockReason = Extract<HostCheckResult, { allowed: false }>['reason'];

export function isLookupFailure(result: HostCheckResult): boolean {
  return result.reason === 'dns-failed' || result.reason === 'dns-timeout';
}

export interface LookupAddress {
  address: string;
  family: number;
}

/** 테스트에서 가짜 DNS를 넣기 위한 조회 함수. 기본값은 dns.promises.lookup */
export type LookupFn = (hostname: string) => Promise<LookupAddress[]>;

export const systemLookup: LookupFn = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

// ---------------------------------------------------------------------------
// PRD 8.7 로컬 모드 정책. public 모드의 판정(위의 함수들)은 바꾸지 않고, local 모드에서만 아래 규칙을 먼저 적용한다.

/** 모드와 관계없이 항상 차단: 링크 로컬(클라우드 메타데이터 169.254.169.254 포함)과 unspecified 주소 (PRD 8.7) */
export const ALWAYS_BLOCKED_IPV4_RANGES = [
  ['169.254.0.0', 16],
  ['0.0.0.0', 32],
] as const;
export const ALWAYS_BLOCKED_IPV6_RANGES = [
  ['fe80::', 10],
  ['::', 128],
] as const;
/** local 모드에서 추가로 허용하는 loopback 범위 */
const LOOPBACK_IPV4: readonly [string, number] = ['127.0.0.0', 8];
const LOOPBACK_IPV6: readonly [string, number] = ['::1', 128];

const ALWAYS_BLOCK_LIST = (() => {
  const list = new BlockList();
  for (const [network, prefix] of ALWAYS_BLOCKED_IPV4_RANGES) list.addSubnet(network, prefix, 'ipv4');
  for (const [network, prefix] of ALWAYS_BLOCKED_IPV6_RANGES) list.addSubnet(network, prefix, 'ipv6');
  return list;
})();
const LOOPBACK_LIST = (() => {
  const list = new BlockList();
  list.addSubnet(LOOPBACK_IPV4[0], LOOPBACK_IPV4[1], 'ipv4');
  list.addSubnet(LOOPBACK_IPV6[0], LOOPBACK_IPV6[1], 'ipv6');
  return list;
})();

/** IP를 v4/v6로 나누고, IPv4를 담는 IPv6면 안의 IPv4도 함께 돌려준다 */
function ipForms(ip: string): { address: string; family: 'ipv4' | 'ipv6' }[] {
  const address = stripZone(stripBrackets(ip));
  const family = isIP(address);
  if (family === 4) return [{ address, family: 'ipv4' }];
  if (family !== 6) return [];
  const v4 = embeddedIpv4(address);
  return v4 === null ? [{ address, family: 'ipv6' }] : [{ address, family: 'ipv6' }, { address: v4, family: 'ipv4' }];
}

/** 모드와 관계없이 항상 차단하는 IP인지 (PRD 8.7). IP가 아니면 true */
export function isAlwaysBlockedIp(ip: string): boolean {
  const forms = ipForms(ip);
  if (forms.length === 0) return true;
  return forms.some((f) => ALWAYS_BLOCK_LIST.check(f.address, f.family));
}

/**
 * loopback(127.0.0.0/8, ::1)인지. IPv4-mapped(`::ffff:127.0.0.1`)만 안의 IPv4로 판정한다.
 * NAT64·6to4·IPv4-compatible 형식은 실제로 loopback으로 가지 않으므로 loopback으로 보지 않는다.
 */
export function isLoopbackIp(ip: string): boolean {
  const address = stripZone(stripBrackets(ip));
  const family = isIP(address);
  if (family === 4) return LOOPBACK_LIST.check(address, 'ipv4');
  if (family !== 6) return false;
  if (LOOPBACK_LIST.check(address, 'ipv6')) return true;
  const bytes = ipv6ToBytes(address);
  const mapped = startsWith(bytes, [...(Array(10).fill(0) as number[]), 0xff, 0xff]);
  return mapped && LOOPBACK_LIST.check(bytes.slice(12, 16).join('.'), 'ipv4');
}

/**
 * 실행 모드별 주소 정책 (PRD 8.6, 8.7).
 * - public: PRD 8.6 그대로
 * - local: loopback 이름(localhost, *.localhost)과 주소(127.0.0.0/8, ::1), LOCAL_ALLOW_HOSTS에 적힌 호스트·IP를 추가로 허용.
 *   단, 링크 로컬·메타데이터(169.254.0.0/16, fe80::/10)와 0.0.0.0, ::은 항상 차단한다.
 */
export type HostPolicy = { mode: 'public' } | { mode: 'local'; allowHosts: readonly string[] };

export const PUBLIC_POLICY: HostPolicy = { mode: 'public' };

/** LOCAL_ALLOW_HOSTS 항목 하나가 정확한 호스트 이름 또는 IP인지. 와일드카드(*), 대역(/), 포트, 경로는 받지 않는다 */
export function parseLocalAllowHost(entry: string): string | null {
  if (/[*/\\?#@\s]/.test(entry)) return null;
  const hostname = normalizeHostname(entry);
  if (hostname === null) return null;
  // 항상 차단 대상은 목록에 적어도 허용하지 않는다
  if (isIP(hostname) !== 0 && isAlwaysBlockedIp(hostname)) return null;
  // 클라우드 메타데이터 이름은 목록에 적어도 허용하지 않는다
  if (CLOUD_METADATA_HOSTNAMES.has(hostname)) return null;
  return hostname;
}

/** LOCAL_ALLOW_HOSTS를 검증한다. 잘못된 항목이 있으면 그 항목 목록을 돌려준다(값을 조용히 버리지 않는다) */
export function invalidLocalAllowHosts(entries: readonly string[]): string[] {
  return entries.filter((entry) => parseLocalAllowHost(entry) === null);
}

const LOOPBACK_HOSTNAMES = new Set(['localhost']);
const CLOUD_METADATA_HOSTNAMES = new Set(['metadata.google.internal', 'metadata']);
const LOOPBACK_SUFFIX = '.localhost';

export interface HostCheckerOptions {
  /** 실행 모드별 정책 (PRD 8.7). 기본값은 public */
  policy?: HostPolicy;
  lookup?: LookupFn;
  lookupTimeoutMs?: number;
  /**
   * 테스트 하네스 전용(PRD 8.6 테스트 예외). 여기 있는 호스트는 판정을 건너뛴다.
   * API route와 서비스 코드는 이 값을 넘기지 않는다. 환경변수로 채우는 경로를 만들지 않는다(AGENTS.md 8장).
   */
  allowHosts?: readonly string[];
}

export interface HostChecker {
  check(hostname: string): Promise<HostCheckResult>;
}

class LookupTimeout extends Error {}

async function lookupWithTimeout(lookup: LookupFn, hostname: string, timeoutMs: number): Promise<LookupAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup(hostname),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new LookupTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 검사 1회마다 새로 만든다. 같은 검사 안에서는 호스트별 결과를 캐시한다(PRD 8.6).
 * 동시에 같은 호스트를 물어도 조회는 한 번만 한다(Promise를 캐시한다).
 */
export function createHostChecker(options: HostCheckerOptions = {}): HostChecker {
  const lookup = options.lookup ?? systemLookup;
  const timeoutMs = options.lookupTimeoutMs ?? DNS_LOOKUP_TIMEOUT_MS;
  const allowHosts = new Set((options.allowHosts ?? []).map((host) => normalizeHostname(host)).filter((host) => host !== null));
  const policy = options.policy ?? PUBLIC_POLICY;
  const localAllow =
    policy.mode === 'local'
      ? new Set(
          policy.allowHosts.map((entry) => {
            const host = parseLocalAllowHost(entry);
            // 잘못된 항목을 조용히 버리면 사용자가 허용됐다고 오해한다. checker를 만들 때 실패시킨다
            if (host === null) throw new Error('LOCAL_ALLOW_HOSTS contains an invalid entry (exact host names or IPs only)');
            return host;
          }),
        )
      : new Set<string>();
  const cache = new Map<string, Promise<HostCheckResult>>();

  async function resolve(hostname: string): Promise<LookupAddress[] | HostCheckResult> {
    let addresses: LookupAddress[];
    try {
      addresses = await lookupWithTimeout(lookup, hostname, timeoutMs);
    } catch (error) {
      return { allowed: false, reason: error instanceof LookupTimeout ? 'dns-timeout' : 'dns-failed' };
    }
    if (addresses.length === 0) return { allowed: false, reason: 'dns-failed' };
    return addresses;
  }

  /**
   * PRD 8.7 local 모드 판정. 항상 차단 → loopback·명시 허용 → 나머지는 public 판정과 같다.
   * 리다이렉트 hop과 하위 요청도 이 checker를 거치므로(routeGuard.ts) 같은 정책이 적용된다.
   */
  async function evaluateLocal(hostname: string): Promise<HostCheckResult> {
    // 주소 하나의 판정: 항상 차단 > loopback 허용 > 명시 허용(IP) > public 규칙
    const addressResult = (ip: string, namedAllowed: boolean): HostCheckResult => {
      if (isAlwaysBlockedIp(ip)) return { allowed: false, reason: 'blocked-ip' };
      if (isLoopbackIp(ip)) return { allowed: true, reason: 'local-loopback' };
      const normalized = normalizeHostname(ip);
      if (namedAllowed || (normalized !== null && localAllow.has(normalized))) return { allowed: true, reason: 'local-allow-listed' };
      return isBlockedIp(ip) ? { allowed: false, reason: 'blocked-ip' } : { allowed: true, reason: 'public' };
    };
    // 여러 주소의 판정: 하나라도 막히면 막는다(PRD 8.6과 같다). 허용 사유는 가장 "로컬"인 것을 남긴다
    const combine = (results: HostCheckResult[]): HostCheckResult => {
      const blocked = results.find((r) => !r.allowed);
      if (blocked) return blocked;
      return results.find((r) => r.reason === 'local-allow-listed') ?? results.find((r) => r.reason === 'local-loopback') ?? results[0]!;
    };

    if (isIP(hostname) !== 0) return addressResult(hostname, false);
    // localhost, *.localhost: Chromium이 DNS를 묻지 않고 loopback으로 연결한다(RFC 6761). 그래서 조회 없이 허용한다
    if (LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(LOOPBACK_SUFFIX)) return { allowed: true, reason: 'local-loopback' };
    const named = localAllow.has(hostname);
    // 명시 허용한 이름만 점 없는 이름, *.local, *.internal 차단을 건너뛴다. metadata.google.internal은 목록에 적어도 아래 IP 판정에서 막힌다
    if (!named && isBlockedHostname(hostname)) return { allowed: false, reason: 'blocked-hostname' };
    const addresses = await resolve(hostname);
    if (!Array.isArray(addresses)) return addresses;
    return combine(addresses.map((entry) => addressResult(entry.address, named)));
  }

  async function evaluate(hostname: string): Promise<HostCheckResult> {
    if (allowHosts.has(hostname)) return { allowed: true, reason: 'allow-listed' };
    if (policy.mode === 'local') return evaluateLocal(hostname);
    if (isIP(hostname) !== 0) return isBlockedIp(hostname) ? { allowed: false, reason: 'blocked-ip' } : { allowed: true, reason: 'public' };
    if (isBlockedHostname(hostname)) return { allowed: false, reason: 'blocked-hostname' };
    let addresses: LookupAddress[];
    try {
      addresses = await lookupWithTimeout(lookup, hostname, timeoutMs);
    } catch (error) {
      return { allowed: false, reason: error instanceof LookupTimeout ? 'dns-timeout' : 'dns-failed' };
    }
    if (addresses.length === 0) return { allowed: false, reason: 'dns-failed' };
    // PRD 8.6: 조회 결과 중 하나라도 차단 대상이면 차단한다
    return addresses.some((entry) => isBlockedIp(entry.address)) ? { allowed: false, reason: 'blocked-ip' } : { allowed: true, reason: 'public' };
  }

  return {
    check(input) {
      const hostname = normalizeHostname(input);
      if (hostname === null) return Promise.resolve({ allowed: false, reason: 'invalid-host' });
      let result = cache.get(hostname);
      if (!result) {
        result = evaluate(hostname);
        cache.set(hostname, result);
      }
      return result;
    },
  };
}
