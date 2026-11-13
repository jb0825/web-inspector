import 'server-only';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// PRD 5.2.3, AGENTS.md 7.1. 폰트 원본은 public/fonts/ 한 곳뿐이다.
// 실행 환경은 launch.ts가 판별해 target으로 넘긴다. 이 파일은 환경을 직접 판별하지 않는다.

export type FontTarget = 'vercel' | 'linux' | 'macos';

export interface EnsureFontsResult {
  /** 브라우저 실행 옵션의 env에 더할 값. 없으면 빈 객체 */
  env: Record<string, string>;
}

const FONT_FILES = ['NotoSansKR-Regular.ttf', 'NotoSansKR-Bold.ttf'] as const;

/** Vercel 함수에서도 process.cwd()는 트레이싱된 파일의 루트다(outputFileTracingIncludes로 public/fonts 포함). */
export function getBundledFontDir(): string {
  return path.join(process.cwd(), 'public', 'fonts');
}

export function getBundledFontPaths(): string[] {
  const dir = getBundledFontDir();
  return FONT_FILES.map((file) => path.join(dir, file));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 로컬 Linux용 fonts.conf. 시스템 설정을 포함하고 번들 폰트 디렉터리를 더한다. */
export function buildFontsConf(fontDir: string, cacheDir: string): string {
  return [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    '  <include ignore_missing="yes">/etc/fonts/fonts.conf</include>',
    `  <dir>${escapeXml(fontDir)}</dir>`,
    `  <cachedir>${escapeXml(cacheDir)}</cachedir>`,
    '</fontconfig>',
    '',
  ].join('\n');
}

async function copyIfChanged(source: string, target: string): Promise<void> {
  const [from, to] = await Promise.all([stat(source), stat(target).catch(() => null)]);
  if (to && to.size === from.size) return;
  await copyFile(source, target);
}

/**
 * Vercel: @sparticuz/chromium 153에는 폰트 등록 함수가 없다. 대신 executablePath()가
 * /tmp/fonts에 fonts.conf를 풀고(FONTCONFIG_PATH=/tmp/fonts), 그 fonts.conf가 /tmp/fonts를
 * 폰트 디렉터리로 지정한다. 그래서 번들 폰트를 그 아래로 복사한다.
 *
 * 순서가 중요하다. @sparticuz/chromium은 /tmp/fonts가 이미 있으면 압축 해제를 건너뛰므로,
 * 먼저 복사하면 fonts.conf가 생기지 않는다. 반드시 executablePath() 다음에 호출해야 한다.
 */
async function registerVercelFonts(): Promise<EnsureFontsResult> {
  const fontconfigDir = path.join(tmpdir(), 'fonts');
  if (!existsSync(path.join(fontconfigDir, 'fonts.conf'))) {
    throw new Error('fonts.conf가 없다. @sparticuz/chromium executablePath()를 먼저 호출해야 한다.');
  }
  const target = path.join(fontconfigDir, 'noto-sans-kr');
  await mkdir(target, { recursive: true });
  await Promise.all(
    getBundledFontPaths().map((file) => copyIfChanged(file, path.join(target, path.basename(file)))),
  );
  // FONTCONFIG_PATH는 @sparticuz/chromium이 import 시점에 설정하고, 브라우저는 그 환경을 물려받는다.
  return { env: {} };
}

async function registerLinuxFonts(): Promise<EnsureFontsResult> {
  const dir = path.join(tmpdir(), 'web-inspector-fontconfig');
  const cacheDir = path.join(dir, 'cache');
  await mkdir(cacheDir, { recursive: true });
  const confPath = path.join(dir, 'fonts.conf');
  await writeFile(confPath, buildFontsConf(getBundledFontDir(), cacheDir), 'utf8');
  return { env: { FONTCONFIG_FILE: confPath } };
}

function warnMacos(): EnsureFontsResult {
  console.warn(
    '[fonts] macOS에서는 OS 폰트 대체 순서를 따르므로 외부 사이트 측정값이 Vercel과 다를 수 있다. ' +
      'Fixture는 @font-face로 /fonts/의 Noto Sans KR을 쓰므로 영향을 받지 않는다. (AGENTS.md 7.1)',
  );
  return { env: {} };
}

const pending = new Map<FontTarget, Promise<EnsureFontsResult>>();

/** 브라우저 실행 전에 호출한다. 같은 함수 인스턴스에서는 target별로 한 번만 실행한다. */
export function ensureFonts(target: FontTarget): Promise<EnsureFontsResult> {
  const existing = pending.get(target);
  if (existing) return existing;

  const run =
    target === 'vercel'
      ? registerVercelFonts()
      : target === 'linux'
        ? registerLinuxFonts()
        : Promise.resolve(warnMacos());

  const guarded = run.catch((error: unknown) => {
    // 실패하면 다음 호출에서 다시 시도할 수 있게 기억을 지운다.
    pending.delete(target);
    throw error;
  });
  pending.set(target, guarded);
  return guarded;
}
