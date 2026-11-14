import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isCoreDumpName, removeCrashDumps } from '@/server/browser/crashDumps';

// T14: Vercel /tmp에 쌓이는 Chromium core 덤프 정리

describe('isCoreDumpName', () => {
  it('core 덤프 이름만 고른다', () => {
    for (const name of ['core', 'core.123', 'core.chromium.110', 'core.headless_shell.42']) expect(isCoreDumpName(name)).toBe(true);
    for (const name of ['chromium', 'fonts', 'score.txt', 'core-js', 'corefile', 'core.', 'libvk_swiftshader.so', 'playwright_chromiumdev_profile-x'])
      expect(isCoreDumpName(name)).toBe(false);
  });
});

describe('removeCrashDumps', () => {
  let dir = '';
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('바로 아래의 core 파일만 지우고 크기를 합산한다. 디렉터리와 다른 파일은 남긴다', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'crash-dumps-'));
    await writeFile(path.join(dir, 'core.chromium.110'), Buffer.alloc(100));
    await writeFile(path.join(dir, 'core.259'), Buffer.alloc(50));
    await writeFile(path.join(dir, 'chromium'), Buffer.alloc(10));
    await mkdir(path.join(dir, 'core.dir'));
    await mkdir(path.join(dir, 'fonts'));
    await writeFile(path.join(dir, 'fonts', 'core.1'), Buffer.alloc(5));

    expect(await removeCrashDumps(dir)).toEqual({ removed: 2, bytes: 150 });
    expect((await readdir(dir)).sort()).toEqual(['chromium', 'core.dir', 'fonts']);
    expect(await readdir(path.join(dir, 'fonts'))).toEqual(['core.1']);
  });

  it('디렉터리가 없으면 아무것도 하지 않는다', async () => {
    expect(await removeCrashDumps(path.join(tmpdir(), 'no-such-dir-for-crash-dumps'))).toEqual({ removed: 0, bytes: 0 });
  });
});
