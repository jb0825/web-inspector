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

/** 실행 모드 (PRD 8.7). public: 공개 배포(기본값), local: 개발자 PC에서 localhost 검사 */
export const INSPECTOR_MODES = ['public', 'local'] as const;
export type InspectorMode = (typeof INSPECTOR_MODES)[number];

/** PRD 8.4: 공개 배포(Hobby 1 vCPU)의 동시 검사 수 */
export const DEFAULT_MAX_CONCURRENT_PUBLIC = 1;
/** PRD 8.7: 로컬 모드의 동시 검사 수. 개발자 PC는 CPU가 여러 개라 2개까지 겹쳐도 시간 제한에 걸리지 않는다 */
export const DEFAULT_MAX_CONCURRENT_LOCAL = 2;

const runtimeSchema = z.object({
  VERCEL: optionalString,
  INSPECTOR_MODE: z.preprocess((value) => (value === '' ? undefined : value), z.enum(INSPECTOR_MODES).default('public')),
  // PRD 8.7: 쉼표 구분 호스트 이름 또는 IP. 와일드카드·대역 표기는 ssrf.ts가 거부한다
  LOCAL_ALLOW_HOSTS: optionalString,
  MAX_CONCURRENT_INSPECTIONS: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : Number(value)),
    // PRD 8.5: Hobby 1 vCPU에서 검사 두 개가 겹치면 Chromium 두 개가 CPU를 나눠 쓴다(T14). 기본값은 모드별로 정한다
    z.number().int().min(1).max(10).optional(),
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
  /** PRD 8.7. Vercel에서는 항상 public이다(local이면 getter가 실패한다) */
  mode: InspectorMode;
  /** local 모드에서만 쓰는 LOCAL_ALLOW_HOSTS 목록(앞뒤 공백 제거, 빈 항목 제외). public 모드에서는 항상 빈 배열 */
  localAllowHosts: string[];
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

/** 배포 환경에서 로컬 모드를 켜려고 했다. 서버 시작 단계(instrumentation.ts)에서 던져 서버가 뜨지 않게 한다 */
export class LocalModeOnVercelError extends Error {
  constructor() {
    super('INSPECTOR_MODE=local cannot be used on Vercel. Local mode allows localhost targets and must never run in a deployment.');
    this.name = 'LocalModeOnVercelError';
  }
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

/**
 * 로컬 모드 전용 비밀값. Next.js dev 서버는 route마다 모듈을 따로 불러올 수 있어서 모듈 변수가 아니라
 * globalThis에 둔다(같은 프로세스 안에서만 공유된다).
 */
const LOCAL_SECRET_KEY = Symbol.for('web-inspector.local-internal-secret');
function processLocalSecret(): string {
  const holder = globalThis as { [LOCAL_SECRET_KEY]?: string };
  holder[LOCAL_SECRET_KEY] ??= `local-${crypto.randomUUID()}`;
  return holder[LOCAL_SECRET_KEY];
}

/** 로컬 파일 저장소를 쓸지: local 모드이고 해당 외부 저장소 값이 없을 때 (PRD 8.7) */
export interface StorageBackends {
  inspections: 'redis' | 'file';
  screenshots: 'blob' | 'file';
}

/** 테스트에서 임의의 환경값으로 getter를 만들 때 쓴다. */
export function createEnv(source: EnvSource) {
  return {
    getRuntimeEnv: cached((): RuntimeEnv => {
      const parsed = parseGroup('runtime', runtimeSchema, source);
      const isVercel = parsed.VERCEL !== undefined;
      // PRD 8.7: 로컬 모드는 내부 주소 검사를 허용하므로 배포 환경에서는 절대 켜지지 않아야 한다
      if (parsed.INSPECTOR_MODE === 'local' && isVercel) throw new LocalModeOnVercelError();
      const local = parsed.INSPECTOR_MODE === 'local';
      return {
        isVercel,
        mode: parsed.INSPECTOR_MODE,
        localAllowHosts: local
          ? (parsed.LOCAL_ALLOW_HOSTS ?? '')
              .split(',')
              .map((host) => host.trim())
              .filter((host) => host !== '')
          : [],
        platform: process.platform,
        maxConcurrentInspections: parsed.MAX_CONCURRENT_INSPECTIONS ?? (local ? DEFAULT_MAX_CONCURRENT_LOCAL : DEFAULT_MAX_CONCURRENT_PUBLIC),
      };
    }),
    getInternalEnv: cached((): InternalEnv => {
      // PRD 8.7: 로컬 모드에서 INTERNAL_API_SECRET이 없으면 프로세스마다 무작위 값을 만든다.
      // /analyze 호출과 검증이 같은 next dev 프로세스 안에서 일어나므로 값을 공유할 수 있다.
      // public 모드(배포)는 지금처럼 값이 반드시 있어야 한다.
      const runtime = parseGroup('runtime', runtimeSchema, source);
      if (runtime.INSPECTOR_MODE === 'local' && runtime.VERCEL === undefined && (source.INTERNAL_API_SECRET ?? '') === '') {
        return parseGroup('internal', internalSchema, { ...source, INTERNAL_API_SECRET: processLocalSecret() });
      }
      return parseGroup('internal', internalSchema, source);
    }),
    getStoreEnv: cached((): StoreEnv => parseGroup('store', storeSchema, source)),
    /**
     * PRD 8.7: local 모드에서 Upstash 값(URL, TOKEN)이 모두 없으면 검사 문서를, BLOB 토큰이 없으면 스크린샷을 파일에 둔다.
     * public 모드는 항상 Redis·Blob이다(값이 없으면 지금처럼 STORAGE_FAILED).
     */
    getStorageBackends: cached((): StorageBackends => {
      const runtime = parseGroup('runtime', runtimeSchema, source);
      const local = runtime.INSPECTOR_MODE === 'local' && runtime.VERCEL === undefined;
      const missing = (key: string) => (source[key] ?? '') === '';
      return {
        inspections: local && missing('UPSTASH_REDIS_REST_URL') && missing('UPSTASH_REDIS_REST_TOKEN') ? 'file' : 'redis',
        screenshots: local && missing('BLOB_READ_WRITE_TOKEN') ? 'file' : 'blob',
      };
    }),
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
export const getStorageBackends = env.getStorageBackends;
