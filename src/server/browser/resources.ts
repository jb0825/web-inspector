import 'server-only';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

// 함수 인스턴스의 자원 사용량 (T14). 같은 인스턴스에서 브라우저를 여러 번 띄운 뒤 실행이 바로 실패하는 문제를 진단하려고 둔다.
// Linux(/proc)에서만 값을 낸다. 읽을 수 없으면 null이다(macOS 로컬). 페이지 내용, URL, 실행 인자는 넣지 않는다.

/** /tmp를 셀 때 볼 파일 수 상한. 넘으면 그때까지 센 값을 낸다(로그가 검사를 늦추지 않게) */
const TMP_SCAN_MAX_FILES = 20_000;
/** 로그에 남길 /tmp 상위 항목 수 */
const TMP_TOP_ENTRIES = 8;

export interface ResourceSnapshot {
  /** 이 Node 프로세스가 연 파일 디스크립터 수(/proc/self/fd) */
  fdCount: number;
  /** 종류별 수: socket, pipe, anon_inode, file */
  fdKinds: Record<string, number>;
  /** /tmp 전체 크기(KB)와 파일 수. scanCapped면 상한까지만 센 값이다 */
  tmpKb: number;
  tmpFiles: number;
  tmpScanCapped: boolean;
  /** /tmp 바로 아래 항목 중 큰 순서 (이름, KB) */
  tmpTop: { name: string; kb: number }[];
  /** 살아 있는 Chromium 프로세스 수(좀비 포함)와 그중 좀비 수 */
  chromeProcesses: number;
  chromeZombies: number;
}

async function fdStats(): Promise<{ count: number; kinds: Record<string, number> }> {
  const entries = await readdir('/proc/self/fd');
  const kinds: Record<string, number> = {};
  for (const entry of entries) {
    let kind = 'file';
    try {
      const target = await readlink(`/proc/self/fd/${entry}`);
      if (target.startsWith('socket:')) kind = 'socket';
      else if (target.startsWith('pipe:')) kind = 'pipe';
      else if (target.startsWith('anon_inode:')) kind = 'anon_inode';
    } catch {
      kind = 'closed';
    }
    kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  return { count: entries.length, kinds };
}

async function dirSize(dir: string, budget: { files: number }): Promise<number> {
  let bytes = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    if (budget.files >= TMP_SCAN_MAX_FILES) break;
    const full = path.join(dir, name);
    try {
      const stat = await lstat(full);
      budget.files += 1;
      if (stat.isDirectory()) bytes += await dirSize(full, budget);
      else bytes += stat.size;
    } catch {
      // 그사이 지워진 항목
    }
  }
  return bytes;
}

async function tmpStats(): Promise<Pick<ResourceSnapshot, 'tmpKb' | 'tmpFiles' | 'tmpScanCapped' | 'tmpTop'>> {
  const budget = { files: 0 };
  const top: { name: string; kb: number }[] = [];
  let total = 0;
  for (const name of await readdir('/tmp').catch(() => [] as string[])) {
    const full = path.join('/tmp', name);
    let bytes = 0;
    try {
      const stat = await lstat(full);
      budget.files += 1;
      bytes = stat.isDirectory() ? await dirSize(full, budget) : stat.size;
    } catch {
      continue;
    }
    total += bytes;
    top.push({ name: name.slice(0, 60), kb: Math.round(bytes / 1024) });
  }
  top.sort((a, b) => b.kb - a.kb || a.name.localeCompare(b.name));
  return { tmpKb: Math.round(total / 1024), tmpFiles: budget.files, tmpScanCapped: budget.files >= TMP_SCAN_MAX_FILES, tmpTop: top.slice(0, TMP_TOP_ENTRIES) };
}

async function chromeStats(): Promise<{ count: number; zombies: number }> {
  let count = 0;
  let zombies = 0;
  for (const pid of (await readdir('/proc')).filter((name) => /^\d+$/.test(name))) {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
      const comm = stat.slice(stat.indexOf('(') + 1, stat.lastIndexOf(')'));
      if (!/chrom|headless/i.test(comm)) continue;
      count += 1;
      if (stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) === 'Z') zombies += 1;
    } catch {
      // 그사이 끝난 프로세스
    }
  }
  return { count, zombies };
}

/** 자원 사용량. /proc가 없으면(Linux가 아니면) null */
export async function resourceSnapshot(): Promise<ResourceSnapshot | null> {
  try {
    const [fd, tmp, chrome] = await Promise.all([fdStats(), tmpStats(), chromeStats()]);
    return { fdCount: fd.count, fdKinds: fd.kinds, ...tmp, chromeProcesses: chrome.count, chromeZombies: chrome.zombies };
  } catch {
    return null;
  }
}

/** 로그 한 줄에 넣을 평평한 값. /tmp 항목은 이름과 KB만 남긴다 */
export function flattenSnapshot(snapshot: ResourceSnapshot): Record<string, number | string> {
  return {
    fdCount: snapshot.fdCount,
    ...Object.fromEntries(Object.entries(snapshot.fdKinds).map(([kind, n]) => [`fd_${kind}`, n])),
    tmpKb: snapshot.tmpKb,
    tmpFiles: snapshot.tmpFiles,
    ...(snapshot.tmpScanCapped ? { tmpScanCapped: 'yes' } : {}),
    tmpTop: snapshot.tmpTop.map((entry) => `${entry.name}:${entry.kb}`).join(','),
    chromeProcesses: snapshot.chromeProcesses,
    chromeZombies: snapshot.chromeZombies,
  };
}
