import 'server-only';
import { Redis } from '@upstash/redis';
import { getStoreEnv } from '@/server/env';
import { InspectionError } from '@/server/errors';
import { applyStaleRule } from '@/server/status';
import type { Inspection } from '@/types/inspection';
import { inspectionSchema } from './schemas';

// DOMAIN_MODEL 6.1: Redis 키와 쓰기 방식. 상태는 Redis에만 둔다(함수 메모리에 두지 않는다, AGENTS.md 13장).

/** PRD 8.1.4: 검사 문서 보존 7일 */
export const INSPECTION_TTL_SECONDS = 604_800;
/** PRD 8.4: 슬롯 만료는 시작 후 300초 */
export const SLOT_TTL_MS = 300_000;
/** DOMAIN_MODEL 6.1: analyze 잠금 300초 */
export const ANALYZE_LOCK_TTL_SECONDS = 300;
/** PRD 8.1.3 "저장 15s": Redis 명령 1회의 시간 제한 */
export const REDIS_COMMAND_TIMEOUT_MS = 15_000;

export const RUNNING_SET_KEY = 'inspections:running';
export const inspectionKey = (id: string) => `inspection:${id}`;
export const analyzeLockKey = (id: string) => `inspection:${id}:analyze-lock`;
/** 검사 중지 요청 표시. 브라우저 단계는 최대 300초라 그 뒤에는 필요 없다 */
export const cancelKey = (id: string) => `inspection:${id}:cancel`;
export const CANCEL_FLAG_TTL_SECONDS = 300;

/**
 * 중지 요청이 없을 때만 문서를 다시 쓴다(SET … KEEPTTL XX). 검사 중지와 브라우저 단계 저장이 겹쳐도
 * 중지 뒤의 저장이 failed(CANCELLED) 문서를 덮어쓰지 않게 한다.
 * KEYS[1] = inspection:{id}, KEYS[2] = inspection:{id}:cancel, ARGV[1] = 문서 JSON.
 * 반환: 1 저장, 0 중지 요청 있음, -1 문서 없음
 */
export const SAVE_UNLESS_CANCELLED_SCRIPT = `
if redis.call('EXISTS', KEYS[2]) == 1 then
  return 0
end
if redis.call('SET', KEYS[1], ARGV[1], 'KEEPTTL', 'XX') then
  return 1
end
return -1
`;

/**
 * PRD 8.4: 만료 member 제거 → 개수 확인 → 추가를 원자적으로 한다.
 * KEYS[1] = inspections:running, ARGV = [현재 시각 ms, 만료 시각 ms, 상한, inspection id]. 반환: 1 획득, 0 거부
 */
export const ACQUIRE_SLOT_SCRIPT = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[4])
return 1
`;

export type SetOptions = { ex: number; nx: true } | { keepTtl: true; xx: true } | { ex: number };

/** 이 모듈이 쓰는 Redis 명령만. 테스트는 메모리 가짜 구현을 넣는다 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  /** 성공하면 'OK', NX/XX 조건 때문에 쓰지 않았으면 null */
  set(key: string, value: string, options: SetOptions): Promise<string | null>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  zrem(key: string, member: string): Promise<number>;
}

export interface InspectionStore {
  /** 새 문서 (SET … EX 604800 NX) */
  create(inspection: Inspection): Promise<void>;
  /** 문서 전체를 다시 쓴다. updatedAt을 갱신하고 TTL은 유지한다(KEEPTTL). 저장한 문서를 돌려준다 */
  save(inspection: Inspection, options?: SaveOptions): Promise<Inspection>;
  /** 없으면 null. 멈춘 검사 처리(DOMAIN_MODEL 4.4)를 적용한 결과이며 Redis에는 다시 쓰지 않는다 */
  read(id: string): Promise<Inspection | null>;
  acquireSlot(id: string, max: number): Promise<boolean>;
  releaseSlot(id: string): Promise<void>;
  acquireAnalyzeLock(id: string): Promise<boolean>;
  /** 검사 중지 요청을 남긴다 (EX 300). 여러 번 불러도 같다 */
  requestCancel(id: string): Promise<void>;
  isCancelRequested(id: string): Promise<boolean>;
}

export interface SaveOptions {
  /** 브라우저 단계(runInspection)의 저장. 중지 요청이 있으면 쓰지 않고 InspectionCancelledError를 던진다 */
  unlessCancelled?: boolean;
}

/** 검사 중지 요청이 있어 브라우저 단계가 저장하지 않았다. runInspection은 이 오류를 받으면 조용히 멈춘다 */
export class InspectionCancelledError extends Error {
  constructor(readonly inspectionId: string) {
    super('Inspection was cancelled');
    this.name = 'InspectionCancelledError';
  }
}

/** 저장된 문서가 JSON이 아니거나 스키마와 맞지 않음. 응답은 500 INTERNAL_ERROR, 로그에는 ID만 (DOMAIN_MODEL 6.1) */
export class StoredInspectionInvalidError extends Error {
  constructor(readonly inspectionId: string, options?: { cause?: unknown }) {
    super('Stored inspection document is invalid', options);
    this.name = 'StoredInspectionInvalidError';
  }
}

async function command<T>(name: string, run: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis ${name} timed out`)), REDIS_COMMAND_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (error instanceof InspectionError) throw error;
    throw new InspectionError('STORAGE_FAILED', `Redis ${name} failed`, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

export function createInspectionStore(client: RedisClient, options: { now?: () => number } = {}): InspectionStore {
  const now = options.now ?? Date.now;

  return {
    async create(inspection) {
      const result = await command('create', () =>
        client.set(inspectionKey(inspection.id), JSON.stringify(inspection), { ex: INSPECTION_TTL_SECONDS, nx: true }),
      );
      if (result !== 'OK') throw new InspectionError('STORAGE_FAILED', 'Inspection already exists');
    },

    async save(inspection, options = {}) {
      const next: Inspection = { ...inspection, updatedAt: new Date(now()).toISOString() };
      if (options.unlessCancelled) {
        const result = Number(
          await command('save', () =>
            client.eval(SAVE_UNLESS_CANCELLED_SCRIPT, [inspectionKey(inspection.id), cancelKey(inspection.id)], [JSON.stringify(next)]),
          ),
        );
        if (result === 0) throw new InspectionCancelledError(inspection.id);
        if (result !== 1) throw new InspectionError('STORAGE_FAILED', 'Inspection document is missing');
        return next;
      }
      // XX: 만료되었거나 없는 문서를 TTL 없이 새로 만들지 않는다
      const result = await command('save', () =>
        client.set(inspectionKey(inspection.id), JSON.stringify(next), { keepTtl: true, xx: true }),
      );
      if (result !== 'OK') throw new InspectionError('STORAGE_FAILED', 'Inspection document is missing');
      return next;
    },

    async read(id) {
      const raw = await command('read', () => client.get(inspectionKey(id)));
      if (raw === null) return null;
      let parsed: unknown;
      try {
        // automaticDeserialization: false로 만든 클라이언트라 값은 저장한 문자열 그대로다. 파싱은 여기서 한 번만 한다
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new StoredInspectionInvalidError(id, { cause: error });
      }
      const result = inspectionSchema.safeParse(parsed);
      if (!result.success) throw new StoredInspectionInvalidError(id, { cause: result.error });
      return applyStaleRule(result.data, now());
    },

    async acquireSlot(id, max) {
      const at = now();
      const result = await command('acquireSlot', () =>
        client.eval(ACQUIRE_SLOT_SCRIPT, [RUNNING_SET_KEY], [String(at), String(at + SLOT_TTL_MS), String(max), id]),
      );
      return Number(result) === 1;
    },

    async releaseSlot(id) {
      await command('releaseSlot', () => client.zrem(RUNNING_SET_KEY, id));
    },

    async acquireAnalyzeLock(id) {
      const result = await command('acquireAnalyzeLock', () =>
        client.set(analyzeLockKey(id), '1', { ex: ANALYZE_LOCK_TTL_SECONDS, nx: true }),
      );
      return result === 'OK';
    },

    async requestCancel(id) {
      await command('requestCancel', () => client.set(cancelKey(id), '1', { ex: CANCEL_FLAG_TTL_SECONDS }));
    },

    async isCancelRequested(id) {
      return (await command('isCancelRequested', () => client.get(cancelKey(id)))) !== null;
    },
  };
}

/** Upstash 클라이언트를 RedisClient로 감싼다. 자동 직렬화를 꺼서 이중 직렬화·이중 파싱이 생기지 않게 한다 */
function upstashClient(redis: Redis): RedisClient {
  return {
    get: (key) => redis.get<string>(key),
    set: async (key, value, options) => {
      const result = await redis.set(key, value, options);
      return result === null ? null : String(result);
    },
    eval: (script, keys, args) => redis.eval(script, keys, args),
    zrem: (key, member) => redis.zrem(key, member),
  };
}

let store: InspectionStore | undefined;

/**
 * Redis 저장소. 서비스 코드는 이 함수 대신 runtime.ts의 getInspectionStore()를 쓴다(로컬 모드 파일 저장소 선택, PRD 8.7).
 * 운영용 저장소. Upstash 클라이언트는 첫 명령 때 만든다. 환경값 검증(getStoreEnv)이 실패하면
 * 그 명령이 STORAGE_FAILED로 실패하므로, route가 본문 없는 500 대신 정해진 오류 형식으로 응답할 수 있다(AGENTS.md 5장).
 */
export function getRedisInspectionStore(): InspectionStore {
  if (!store) {
    let client: RedisClient | undefined;
    const lazy = (): RedisClient => {
      if (!client) {
        const env = getStoreEnv();
        client = upstashClient(
          new Redis({
            url: env.UPSTASH_REDIS_REST_URL,
            token: env.UPSTASH_REDIS_REST_TOKEN,
            automaticDeserialization: false,
            enableTelemetry: false,
          }),
        );
      }
      return client;
    };
    store = createInspectionStore({
      get: (key) => lazy().get(key),
      set: (key, value, options) => lazy().set(key, value, options),
      eval: (script, keys, args) => lazy().eval(script, keys, args),
      zrem: (key, member) => lazy().zrem(key, member),
    });
  }
  return store;
}
