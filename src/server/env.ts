import 'server-only';
import { z } from 'zod';

// process.env는 이 파일에서만 읽는다(AGENTS.md 5장).
// 검증은 import 시점이 아니라 각 getter를 처음 호출할 때 한다. `next build`가 route 모듈을
// 불러올 때 값이 없어도 실패하지 않게 하고, 로컬 Fixture 테스트가 AI 키나 저장소 값 없이 돌게 하기 위해서다.

type EnvSource = Record<string, string | undefined>;

/** 빈 문자열은 값이 없는 것으로 본다. `.env` 파일의 `KEY=` 줄 때문에 생기는 오판을 막는다. */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);
const requiredString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1),
);

const runtimeSchema = z.object({
  VERCEL: optionalString,
  MAX_CONCURRENT_INSPECTIONS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : Number(value)),
    // PRD 8.5: Hobby 1 vCPU에서 검사 두 개가 겹치면 Chromium 두 개가 CPU를 나눠 쓴다(T14)
    z.number().int().min(1).max(10).default(1),
  ),
});

const internalSchema = z.object({
  // 공유 비밀은 추측할 수 없을 만큼 길어야 한다. 16자는 이 프로젝트에서 정한 최소 길이다.
  INTERNAL_API_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16),
  ),
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalString,
  // Vercel 시스템 환경변수: 현재 배포의 호스트(프로토콜 없음). /analyze 내부 호출 주소에 쓴다(PRD 8.1.2)
  VERCEL_URL: optionalString,
});

const storeSchema = z.object({
  UPSTASH_REDIS_REST_URL: z.preprocess((value) => (value === '' ? undefined : value), z.url()),
  UPSTASH_REDIS_REST_TOKEN: requiredString,
  BLOB_READ_WRITE_TOKEN: requiredString,
});

const aiSchema = z.object({
  AI_API_KEY: requiredString,
  AI_MODEL: requiredString,
});

export interface RuntimeEnv {
  isVercel: boolean;
  /** 로컬 실행 환경 구분용. launch.ts만 사용한다. */
  platform: NodeJS.Platform;
  maxConcurrentInspections: number;
}

export interface InternalEnv {
  INTERNAL_API_SECRET: string;
  VERCEL_AUTOMATION_BYPASS_SECRET?: string;
  /** Vercel에서만 있다. 예: web-inspector-abc123.vercel.app */
  VERCEL_URL?: string;
}

export interface StoreEnv {
  UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
  BLOB_READ_WRITE_TOKEN: string;
}

export interface AiEnv {
  AI_API_KEY: string;
  AI_MODEL: string;
}

export class EnvError extends Error {
  constructor(group: string, keys: string[]) {
    // 값은 메시지에 넣지 않는다. 변수 이름만 알린다(AGENTS.md 8장).
    super(`Invalid or missing environment variables for ${group}: ${keys.join(', ')}`);
    this.name = 'EnvError';
  }
}

function parseGroup<T extends z.ZodType>(group: string, schema: T, source: EnvSource): z.output<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => String(issue.path[0] ?? '?')))].sort();
    throw new EnvError(group, keys);
  }
  return result.data;
}

function cached<T>(load: () => T): () => T {
  let loaded = false;
  let value: T;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value;
  };
}

/** 테스트에서 임의의 환경값으로 getter를 만들 때 쓴다. */
export function createEnv(source: EnvSource) {
  return {
    getRuntimeEnv: cached((): RuntimeEnv => {
      const parsed = parseGroup('runtime', runtimeSchema, source);
      return {
        isVercel: parsed.VERCEL !== undefined,
        platform: process.platform,
        maxConcurrentInspections: parsed.MAX_CONCURRENT_INSPECTIONS,
      };
    }),
    getInternalEnv: cached((): InternalEnv => parseGroup('internal', internalSchema, source)),
    getStoreEnv: cached((): StoreEnv => parseGroup('store', storeSchema, source)),
    getAiEnv: cached((): AiEnv => parseGroup('ai', aiSchema, source)),
  };
}

/**
 * 브라우저 같은 자식 프로세스에 넘길 환경변수. Playwright의 `env` 옵션은 지정하면 기본값
 * (`process.env`)을 통째로 대체하므로, 현재 환경에 추가 값을 합친 결과를 돌려준다.
 */
export function getChildProcessEnv(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) base[key] = value;
  }
  return { ...base, ...extra };
}

const env = createEnv(process.env);

export const getRuntimeEnv = env.getRuntimeEnv;
export const getInternalEnv = env.getInternalEnv;
export const getStoreEnv = env.getStoreEnv;
export const getAiEnv = env.getAiEnv;
