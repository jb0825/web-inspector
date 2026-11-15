import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleLocalFile } from '@/server/http/localFiles';
import { STALE_AFTER_MS } from '@/server/status';
import { createFileInspectionStore, createFileScreenshotStorage, resolveLocalFile } from '@/server/store/file';
import { InspectionCancelledError, SLOT_TTL_MS, StoredInspectionInvalidError, type InspectionStore } from '@/server/store/redis';
import { ID, pendingDoc, T0 } from './helpers/inspection';

// PRD 8.7: 로컬 모드 파일 저장소. Redis 저장소(store.test.ts)와 같은 InspectionStore 규칙을 지키는지 확인한다

let root: string;
let now = T0;
let store: InspectionStore;
const OTHER = '00000000-0000-4000-8000-000000000002';
const THIRD = '00000000-0000-4000-8000-000000000003';

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'inspector-data-'));
  now = T0;
  store = createFileInspectionStore({ root, now: () => now });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('createFileInspectionStore', () => {
  it('create → read → save, 같은 ID는 다시 만들지 않는다', async () => {
    const doc = pendingDoc();
    await store.create(doc);
    expect(await store.read(doc.id)).toEqual(doc);
    await expect(store.create(doc)).rejects.toMatchObject({ code: 'STORAGE_FAILED' });

    now = T0 + 1_000;
    const saved = await store.save({ ...doc, status: 'running' });
    expect(saved.updatedAt).toBe(new Date(T0 + 1_000).toISOString());
    expect((await store.read(doc.id))?.status).toBe('running');
    expect(readFileSync(path.join(root, 'inspections', `${doc.id}.json`), 'utf8')).toContain('"running"');
  });

  it('없는 문서는 null이고, 없는 문서를 save하면 STORAGE_FAILED다', async () => {
    expect(await store.read(ID)).toBeNull();
    expect(await store.read('../../etc/passwd')).toBeNull();
    await expect(store.save(pendingDoc())).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  });

  it('형식이 맞지 않는 문서는 StoredInspectionInvalidError다', async () => {
    await mkdir(path.join(root, 'inspections'), { recursive: true });
    await writeFile(path.join(root, 'inspections', `${ID}.json`), '{"nope":1}');
    await expect(store.read(ID)).rejects.toBeInstanceOf(StoredInspectionInvalidError);
  });

  it('읽을 때 멈춘 검사 처리를 적용한다 (DOMAIN_MODEL 4.4)', async () => {
    await store.create(pendingDoc());
    now = T0 + STALE_AFTER_MS;
    expect((await store.read(ID))?.error?.code).toBe('TIME_BUDGET_EXCEEDED');
  });

  it('중지 요청이 있으면 브라우저 단계 저장을 거부한다', async () => {
    await store.create(pendingDoc());
    expect(await store.isCancelRequested(ID)).toBe(false);
    await store.requestCancel(ID);
    expect(await store.isCancelRequested(ID)).toBe(true);
    await expect(store.save(pendingDoc(), { unlessCancelled: true })).rejects.toBeInstanceOf(InspectionCancelledError);
    // 중지 API 자신의 저장은 막지 않는다
    await expect(store.save(pendingDoc())).resolves.toBeDefined();
  });

  it('동시 실행 슬롯: 상한, 반환, 만료 (PRD 8.4)', async () => {
    expect(await store.acquireSlot(ID, 2)).toBe(true);
    expect(await store.acquireSlot(OTHER, 2)).toBe(true);
    expect(await store.acquireSlot(THIRD, 2)).toBe(false);
    await store.releaseSlot(ID);
    expect(await store.acquireSlot(THIRD, 2)).toBe(true);
    now = T0 + SLOT_TTL_MS + 1;
    expect(await store.acquireSlot(ID, 1)).toBe(true);
  });

  it('동시에 슬롯을 요청해도 상한을 넘지 않는다', async () => {
    const results = await Promise.all([ID, OTHER, THIRD].map((id) => store.acquireSlot(id, 2)));
    expect(results.filter(Boolean)).toHaveLength(2);
  });

  it('analyze 잠금은 한 번만 잡힌다', async () => {
    expect(await store.acquireAnalyzeLock(ID)).toBe(true);
    expect(await store.acquireAnalyzeLock(ID)).toBe(false);
  });
});

describe('로컬 스크린샷 파일', () => {
  it('upload는 files/<id>/<viewport>-full.png에 쓰고 /api/local-files 경로를 돌려준다', async () => {
    const url = await createFileScreenshotStorage({ root }).upload(ID, 'mobile', Buffer.from('png'));
    expect(url).toBe(`/api/local-files/${ID}/mobile-full.png`);
    expect(readFileSync(path.join(root, 'files', ID, 'mobile-full.png'), 'utf8')).toBe('png');
  });

  it('resolveLocalFile은 우리가 만든 형식만 허용하고 경로 탈출을 막는다', () => {
    expect(resolveLocalFile(root, [ID, 'desktop-full.png'])).toBe(path.join(root, 'files', ID, 'desktop-full.png'));
    for (const segments of [
      ['..', 'desktop-full.png'],
      [ID, '..'],
      [ID, '../../inspections/x.json'],
      [ID, 'desktop-full.png', 'x'],
      [ID],
      ['not-an-id', 'desktop-full.png'],
      [ID, 'tablet-full.png'],
      [ID, 'desktop-full.png%00'],
      [`${ID}/..`, 'desktop-full.png'],
    ]) {
      expect(resolveLocalFile(root, segments), segments.join('/')).toBeNull();
    }
  });

  it('handleLocalFile: public 모드에서는 파일이 있어도 404, local 모드에서는 PNG를 돌려준다', async () => {
    await createFileScreenshotStorage({ root }).upload(ID, 'desktop', Buffer.from('png'));
    const deps = (mode: 'public' | 'local', inFiles = true) => ({ mode: () => mode, screenshotsInFiles: () => inFiles, root });
    expect((await handleLocalFile([ID, 'desktop-full.png'], deps('public'))).status).toBe(404);
    expect((await handleLocalFile([ID, 'desktop-full.png'], deps('local', false))).status).toBe(404);
    const ok = await handleLocalFile([ID, 'desktop-full.png'], deps('local'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/png');
    expect(await ok.text()).toBe('png');
    expect((await handleLocalFile([ID, 'mobile-full.png'], deps('local'))).status).toBe(404);
    expect((await handleLocalFile(['..', '..', 'package.json'], deps('local'))).status).toBe(404);
  });
});
