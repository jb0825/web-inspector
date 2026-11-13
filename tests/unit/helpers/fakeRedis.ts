import { ACQUIRE_SLOT_SCRIPT, type RedisClient, type SetOptions } from '@/server/store/redis';

// redis.ts가 쓰는 명령만 흉내 내는 메모리 Redis. 시계를 주입해 TTL 만료를 확인한다.
// eval은 ACQUIRE_SLOT_SCRIPT만 지원하고, 스크립트와 같은 순서(만료 제거 → 개수 확인 → 추가)로 동작한다.
// 실제 Redis에서 스크립트가 같은 결과를 내는지는 T09 로컬 확인(실제 Upstash)에서 본다.

export class FakeRedis implements RedisClient {
  readonly strings = new Map<string, { value: string; expiresAt: number | null }>();
  readonly zsets = new Map<string, Map<string, number>>();
  /** 다음 명령에서 던질 오류 (저장 실패 흉내) */
  failNext: { command: keyof RedisClient; error: Error } | null = null;
  readonly calls: { command: string; key: string; options?: SetOptions }[] = [];

  constructor(private readonly clock: () => number) {}

  private maybeFail(command: keyof RedisClient) {
    if (this.failNext?.command === command) {
      const { error } = this.failNext;
      this.failNext = null;
      throw error;
    }
  }

  private live(key: string) {
    const entry = this.strings.get(key);
    if (entry && entry.expiresAt !== null && entry.expiresAt <= this.clock()) {
      this.strings.delete(key);
      return undefined;
    }
    return entry;
  }

  ttlSeconds(key: string): number | null {
    const entry = this.live(key);
    if (!entry) return -2;
    return entry.expiresAt === null ? null : (entry.expiresAt - this.clock()) / 1000;
  }

  async get(key: string) {
    this.maybeFail('get');
    this.calls.push({ command: 'get', key });
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string, options: SetOptions) {
    this.maybeFail('set');
    this.calls.push({ command: 'set', key, options });
    const existing = this.live(key);
    if ('nx' in options && existing) return null;
    if ('xx' in options && !existing) return null;
    const expiresAt = 'keepTtl' in options ? (existing?.expiresAt ?? null) : this.clock() + options.ex * 1000;
    this.strings.set(key, { value, expiresAt });
    return 'OK';
  }

  async eval(script: string, keys: string[], args: string[]) {
    this.maybeFail('eval');
    if (script !== ACQUIRE_SLOT_SCRIPT) throw new Error('FakeRedis: unknown script');
    const [now, expiresAt, max, member] = args;
    const set = this.zsets.get(keys[0]) ?? new Map<string, number>();
    this.zsets.set(keys[0], set);
    for (const [m, score] of set) if (score <= Number(now)) set.delete(m); // ZREMRANGEBYSCORE -inf now
    if (set.size >= Number(max)) return 0;
    set.set(member, Number(expiresAt));
    return 1;
  }

  async zrem(key: string, member: string) {
    this.maybeFail('zrem');
    const set = this.zsets.get(key);
    return set?.delete(member) ? 1 : 0;
  }
}
