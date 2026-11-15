import 'server-only';
import { getRuntimeEnv } from '@/server/env';
import { createHostChecker, invalidLocalAllowHosts, PUBLIC_POLICY, type HostChecker, type HostPolicy } from './ssrf';

// 서비스 코드(API route, runInspection)가 쓰는 host checker. 실행 모드(PRD 8.7)에 맞는 정책을 붙인다.
// 판정 자체는 ssrf.ts의 createHostChecker 한 곳에서만 한다. 이 파일은 환경값을 정책으로 바꾸기만 한다.
// 테스트 하네스용 allowHosts는 여기서 넘기지 않는다(PRD 8.6).

export class InvalidLocalAllowHostsError extends Error {
  constructor(count: number) {
    // 값은 메시지에 넣지 않는다(내부 주소일 수 있다)
    super(`LOCAL_ALLOW_HOSTS has ${count} invalid entr${count === 1 ? 'y' : 'ies'}. Use exact host names or IPs, comma separated (no wildcards or CIDR).`);
    this.name = 'InvalidLocalAllowHostsError';
  }
}

export function resolveHostPolicy(runtime: { mode: 'public' | 'local'; localAllowHosts: readonly string[] }): HostPolicy {
  if (runtime.mode !== 'local') return PUBLIC_POLICY;
  const invalid = invalidLocalAllowHosts(runtime.localAllowHosts);
  if (invalid.length > 0) throw new InvalidLocalAllowHostsError(invalid.length);
  return { mode: 'local', allowHosts: runtime.localAllowHosts };
}

/** 검사 1회용 checker (PRD 8.6: 호스트별 결과는 검사 1회 안에서만 캐시한다) */
export function createServiceHostChecker(): HostChecker {
  return createHostChecker({ policy: resolveHostPolicy(getRuntimeEnv()) });
}
