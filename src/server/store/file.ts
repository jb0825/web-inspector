import 'server-only';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { InspectionError } from '@/server/errors';
import { applyStaleRule } from '@/server/status';
import type { Inspection, Viewport } from '@/types/inspection';
import type { ScreenshotStorage } from './blob';
import { ANALYZE_LOCK_TTL_SECONDS, CANCEL_FLAG_TTL_SECONDS, InspectionCancelledError, SLOT_TTL_MS, StoredInspectionInvalidError, type InspectionStore } from './redis';
import { inspectionSchema } from './schemas';

// PRD 8.7 로컬 모드의 파일 저장소. Upstash·Blob 계정 없이 개인 PC에서 검사할 때만 쓴다(env.ts getStorageBackends).
// Redis 저장소(redis.ts)와 같은 InspectionStore 규칙을 따른다: 읽을 때 스키마 검증 → 멈춘 검사 처리(DOMAIN_MODEL 4.4),
// 중지 요청이 있으면 브라우저 단계 저장을 거부, analyze 잠금과 동시 실행 슬롯은 만료 시각을 가진 파일로 둔다.
//   .inspector-data/inspections/<id>.json     검사 문서
//   .inspector-data/files/<id>/<viewport>-full.png   스크린샷 (/api/local-files/<id>/<viewport>-full.png로 제공)
//   .inspector-data/state/{slots,locks,cancel}/<id>  만료 시각(ms)
// 검사 문서의 7일 TTL은 적용하지 않는다(개인 PC의 파일이라 사용자가 직접 지운다).

export const LOCAL_DATA_DIR = '.inspector-data';
/** 로컬 스크린샷을 제공하는 route (src/app/api/local-files/[...path]/route.ts) */
export const LOCAL_FILES_ROUTE = '/api/local-files';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** 우리가 만드는 스크린샷 파일 이름만 허용한다 */
const SCREENSHOT_FILE = /^(desktop|mobile)-full\.png$/;

export const isInspectionId = (value: string) => UUID.test(value);
export const isLocalScreenshotName = (value: string) => SCREENSHOT_FILE.test(value);
export const localScreenshotName = (viewport: Viewport) => `${viewport}-full.png`;

export function localDataRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, LOCAL_DATA_DIR);
}

/**
 * /api/local-files/<id>/<file>의 경로 조각을 실제 파일 경로로 바꾼다. 형식이 다르거나 files 폴더 밖이면 null.
 * 조각 형식(UUID, 정해진 파일 이름)으로 먼저 막고, 정규화한 경로가 files 폴더 안인지 한 번 더 확인한다(경로 탈출 방지).
 */
export function resolveLocalFile(root: string, segments: readonly string[]): string | null {
  if (segments.length !== 2) return null;
  const [id, name] = segments as [string, string];
  if (!isInspectionId(id) || !isLocalScreenshotName(name)) return null;
  const base = path.resolve(root, 'files');
  const target = path.resolve(base, id, name);
  const relative = path.relative(base, target);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return target;
}

/**
 * 같은 프로세스 안에서 파일 작업을 한 줄로 세운다(슬롯 개수 확인과 추가가 겹치지 않게).
 * Next.js dev 서버는 route마다 모듈을 따로 불러올 수 있어 globalThis에 둔다.
 */
const QUEUE_KEY = Symbol.for('web-inspector.file-store-queue');
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const holder = globalThis as { [QUEUE_KEY]?: Promise<unknown> };
  const previous = holder[QUEUE_KEY] ?? Promise.resolve();
  const next = previous.then(task, task);
  holder[QUEUE_KEY] = next.catch(() => undefined);
  return next;
}

async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}

async function readExpiry(file: string): Promise<number | null> {
  try {
    const value = Number(await readFile(file, 'utf8'));
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function fsCommand<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof InspectionError || error instanceof InspectionCancelledError || error instanceof StoredInspectionInvalidError) throw error;
    throw new InspectionError('STORAGE_FAILED', `File store ${name} failed`, { cause: error });
  }
}

export function createFileInspectionStore(options: { root?: string; now?: () => number } = {}): InspectionStore {
  const root = options.root ?? localDataRoot();
  const now = options.now ?? Date.now;
  const docFile = (id: string) => {
    if (!isInspectionId(id)) throw new InspectionError('STORAGE_FAILED', 'Invalid inspection id');
    return path.join(root, 'inspections', `${id}.json`);
  };
  const stateFile = (kind: 'slots' | 'locks' | 'cancel', id: string) => {
    if (!isInspectionId(id)) throw new InspectionError('STORAGE_FAILED', 'Invalid inspection id');
    return path.join(root, 'state', kind, id);
  };
  const exists = async (file: string) =>
    stat(file).then(
      () => true,
      () => false,
    );
  const isCancelled = async (id: string) => {
    const expiry = await readExpiry(stateFile('cancel', id));
    return expiry !== null && expiry > now();
  };

  return {
    create: (inspection) =>
      fsCommand('create', async () => {
        const file = docFile(inspection.id);
        await mkdir(path.dirname(file), { recursive: true });
        // wx: 같은 ID의 문서가 있으면 실패한다 (Redis의 NX)
        try {
          await writeFile(file, JSON.stringify(inspection), { flag: 'wx' });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new InspectionError('STORAGE_FAILED', 'Inspection already exists');
          throw error;
        }
      }),

    save: (inspection, saveOptions = {}) =>
      fsCommand('save', () =>
        serialized(async () => {
          const file = docFile(inspection.id);
          const next: Inspection = { ...inspection, updatedAt: new Date(now()).toISOString() };
          // DOMAIN_MODEL 6.1의 SAVE_UNLESS_CANCELLED와 같은 순서: 중지 요청 확인 → 문서가 있을 때만 쓴다(XX)
          if (saveOptions.unlessCancelled && (await isCancelled(inspection.id))) throw new InspectionCancelledError(inspection.id);
          if (!(await exists(file))) throw new InspectionError('STORAGE_FAILED', 'Inspection document is missing');
          await writeAtomic(file, JSON.stringify(next));
          return next;
        }),
      ),

    async read(id) {
      if (!isInspectionId(id)) return null;
      const raw = await fsCommand('read', async () => {
        try {
          return await readFile(docFile(id), 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      });
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new StoredInspectionInvalidError(id, { cause: error });
      }
      const result = inspectionSchema.safeParse(parsed);
      if (!result.success) throw new StoredInspectionInvalidError(id, { cause: result.error });
      return applyStaleRule(result.data, now());
    },

    acquireSlot: (id, max) =>
      fsCommand('acquireSlot', () =>
        serialized(async () => {
          // PRD 8.4와 같은 순서: 만료 항목 제거 → 개수 확인 → 추가
          const dir = path.join(root, 'state', 'slots');
          await mkdir(dir, { recursive: true });
          const at = now();
          let active = 0;
          for (const name of await readdir(dir)) {
            if (!isInspectionId(name)) continue;
            const expiry = await readExpiry(path.join(dir, name));
            if (expiry === null || expiry <= at) await rm(path.join(dir, name), { force: true });
            else active += 1;
          }
          if (active >= max) return false;
          await writeAtomic(stateFile('slots', id), String(at + SLOT_TTL_MS));
          return true;
        }),
      ),

    releaseSlot: (id) =>
      fsCommand('releaseSlot', async () => {
        await rm(stateFile('slots', id), { force: true });
      }),

    acquireAnalyzeLock: (id) =>
      fsCommand('acquireAnalyzeLock', () =>
        serialized(async () => {
          const file = stateFile('locks', id);
          const expiry = await readExpiry(file);
          if (expiry !== null && expiry > now()) return false;
          await writeAtomic(file, String(now() + ANALYZE_LOCK_TTL_SECONDS * 1000));
          return true;
        }),
      ),

    requestCancel: (id) =>
      fsCommand('requestCancel', () => serialized(() => writeAtomic(stateFile('cancel', id), String(now() + CANCEL_FLAG_TTL_SECONDS * 1000)))),

    isCancelRequested: (id) => fsCommand('isCancelRequested', () => isCancelled(id)),
  };
}

/** 로컬 스크린샷 저장. 돌려주는 URL은 같은 서버의 /api/local-files/… 상대 경로다(샘플의 /sample/…과 같은 형식) */
export function createFileScreenshotStorage(options: { root?: string } = {}): ScreenshotStorage {
  const root = options.root ?? localDataRoot();
  return {
    async upload(id, viewport, png) {
      if (!isInspectionId(id)) throw new InspectionError('STORAGE_FAILED', 'Invalid inspection id');
      const name = localScreenshotName(viewport);
      try {
        await writeAtomic(path.join(root, 'files', id, name), png);
      } catch (error) {
        throw new InspectionError('STORAGE_FAILED', `Screenshot save failed (${viewport})`, { cause: error });
      }
      return `${LOCAL_FILES_ROUTE}/${id}/${name}`;
    },
  };
}
