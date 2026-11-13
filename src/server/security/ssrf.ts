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
  | { allowed: true; reason: 'allow-listed' | 'public' }
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

export interface HostCheckerOptions {
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
  const cache = new Map<string, Promise<HostCheckResult>>();

  async function evaluate(hostname: string): Promise<HostCheckResult> {
    if (allowHosts.has(hostname)) return { allowed: true, reason: 'allow-listed' };
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
