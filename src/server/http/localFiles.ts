import 'server-only';
import { readFile } from 'node:fs/promises';
import { getRuntimeEnv, getStorageBackends } from '@/server/env';
import { localDataRoot, resolveLocalFile } from '@/server/store/file';

// /api/local-files 요청 처리 (PRD 8.7). route 파일은 경로 조각만 넘긴다.

const notFound = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

export interface LocalFileDeps {
  mode(): 'public' | 'local';
  screenshotsInFiles(): boolean;
  root: string;
}

const defaultDeps = (): LocalFileDeps => ({
  mode: () => getRuntimeEnv().mode,
  screenshotsInFiles: () => getStorageBackends().screenshots === 'file',
  root: localDataRoot(),
});

export async function handleLocalFile(segments: readonly string[], deps: LocalFileDeps = defaultDeps()): Promise<Response> {
  // public 모드(배포)에서는 존재 여부도 알리지 않는다
  if (deps.mode() !== 'local' || !deps.screenshotsInFiles()) return notFound();
  const file = resolveLocalFile(deps.root, segments);
  if (file === null) return notFound();
  let data: Buffer;
  try {
    data = await readFile(file);
  } catch {
    return notFound();
  }
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
