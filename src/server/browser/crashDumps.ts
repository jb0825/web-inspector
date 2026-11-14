import 'server-only';
import { lstat, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

// Chromium 크래시 덤프 정리 (T14).
// Vercel의 @sparticuz/chromium(--single-process)은 종료할 때 자주 비정상 종료하고, 커널이 /tmp에 core 파일
// (core.chromium.<pid>, 개당 300~470MB)을 남긴다. 같은 함수 인스턴스에서 브라우저를 계속 띄우면 /tmp가 차서
// (production 측정: 실행 12번에 2.1GB) 다음 브라우저가 실행 직후 죽는다. 브라우저를 닫을 때마다, 그리고 실행 전에 지운다.

/** core 덤프 파일 이름: core, core.<숫자>, core.<프로그램>.<숫자> */
const CORE_FILE = /^core(\.[A-Za-z0-9_-]+)*$/;

export function isCoreDumpName(name: string): boolean {
  return CORE_FILE.test(name);
}

export interface CrashDumpCleanup {
  removed: number;
  bytes: number;
}

/** dir 바로 아래의 core 덤프(일반 파일)를 지운다. 실패한 파일은 건너뛴다 */
export async function removeCrashDumps(dir: string): Promise<CrashDumpCleanup> {
  const result: CrashDumpCleanup = { removed: 0, bytes: 0 };
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return result;
  }
  for (const name of names.filter(isCoreDumpName)) {
    const full = path.join(dir, name);
    try {
      const stat = await lstat(full);
      if (!stat.isFile()) continue;
      await unlink(full);
      result.removed += 1;
      result.bytes += stat.size;
    } catch {
      // 그사이 지워졌거나 지울 수 없는 파일
    }
  }
  return result;
}
