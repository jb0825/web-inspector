import 'server-only';
import { getRuntimeEnv } from '@/server/env';
import { resolveHostPolicy } from '@/server/security/policy';

/** 서버 시작 때 확인하는 환경값 (PRD 8.7). 실패하면 서버가 뜨지 않는다 */
export function assertStartupEnv(): void {
  resolveHostPolicy(getRuntimeEnv());
}
