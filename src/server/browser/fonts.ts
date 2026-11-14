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
  /** 등록한 번들 폰트 파일 수 (로그용). macOS는 0 */
  fontFiles: number;
}

/**
 * 번들 폰트. 원본은 public/fonts/ 한 곳이다(라이선스: OFL.txt, OFL-Liberation.txt).
 * - Noto Sans KR: 한글. Fixture는 @font-face로 이 폰트만 쓴다(PRD 5.2.3, 13.1)
 * - Liberation Sans / Serif / Mono: Arial·Helvetica / Times New Roman / Courier New와 글자 폭이 같은(metric-compatible) 폰트.
 *   서버리스 Chromium에는 Open Sans 말고 시스템 폰트가 없어서, 웹 폰트 없이 시스템 폰트를 쓰는 사이트가
 *   모두 Open Sans로 그려졌다(T14, production에서 확인). 글자 폭이 달라지면 Text Overflow 측정값도 달라진다.
 */
const FONT_FILES = [
  'NotoSansKR-Regular.ttf',
  'NotoSansKR-Bold.ttf',
  'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf',
  'LiberationSerif-Regular.ttf',
  'LiberationSerif-Bold.ttf',
  'LiberationSerif-Italic.ttf',
  'LiberationSerif-BoldItalic.ttf',
  'LiberationMono-Regular.ttf',
  'LiberationMono-Bold.ttf',
] as const;

/**
 * 시스템 폰트 이름 → 번들 폰트 (fontconfig alias). 페이지가 @font-face로 불러오는 웹 폰트에는 영향이 없다.
 * Georgia는 글자 폭이 같은 대체 폰트를 번들하지 않아 같은 계열(serif)인 Liberation Serif로 보낸다(폭은 다를 수 있다).
 * 한글처럼 Liberation에 없는 글자는 fontconfig가 글자마다 Noto Sans KR로 대체한다.
 */
export const FONT_ALIASES: readonly { families: readonly string[]; accept: readonly string[] }[] = [
  { families: ['Arial', 'Helvetica', 'Helvetica Neue', 'Arimo'], accept: ['Liberation Sans'] },
  { families: ['Times New Roman', 'Times', 'Tinos', 'Georgia'], accept: ['Liberation Serif'] },
  { families: ['Courier New', 'Courier', 'Cousine'], accept: ['Liberation Mono'] },
];

/** CSS 일반 글꼴 이름의 기본 폰트 (font-family 목록이 모두 없을 때) */
export const GENERIC_FONT_PREFERENCES: readonly { generic: string; prefer: readonly string[] }[] = [
  { generic: 'sans-serif', prefer: ['Liberation Sans', 'Noto Sans KR'] },
  { generic: 'serif', prefer: ['Liberation Serif', 'Noto Sans KR'] },
  { generic: 'monospace', prefer: ['Liberation Mono', 'Noto Sans KR'] },
];

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

const family = (name: string) => `<family>${escapeXml(name)}</family>`;

/** FONT_ALIASES, GENERIC_FONT_PREFERENCES를 fontconfig 규칙으로 만든다 */
export function buildFontAliases(): string[] {
  const lines: string[] = [];
  for (const { families, accept } of FONT_ALIASES) {
    for (const name of families) {
      // binding="same": 원래 이름을 요청한 것과 같은 강도로 대체한다(fontconfig 기본 설정의 metric 별칭과 같은 방식)
      lines.push(`  <alias binding="same">${family(name)}<accept>${accept.map(family).join('')}</accept></alias>`);
    }
  }
  for (const { generic, prefer } of GENERIC_FONT_PREFERENCES) {
    lines.push(`  <alias>${family(generic)}<prefer>${prefer.map(family).join('')}</prefer></alias>`);
  }
  return lines;
}

/**
 * fonts.conf. include한 기본 설정(Linux: /etc/fonts/fonts.conf, Vercel: @sparticuz/chromium의 /tmp/fonts/fonts.conf)에
 * 번들 폰트 디렉터리와 시스템 폰트 별칭을 더한다. 브라우저 실행 env의 FONTCONFIG_FILE로 넘긴다.
 */
export function buildFontsConf(fontDir: string, cacheDir: string, include: string = '/etc/fonts/fonts.conf'): string {
  return [
    '<?xml version="1.0"?>',
    '<!DOCTYPE fontconfig SYSTEM "fonts.dtd">',
    '<fontconfig>',
    `  <include ignore_missing="yes">${escapeXml(include)}</include>`,
    `  <dir>${escapeXml(fontDir)}</dir>`,
    `  <cachedir>${escapeXml(cacheDir)}</cachedir>`,
    ...buildFontAliases(),
    '</fontconfig>',
    '',
  ].join('\n');
}

/** fonts.conf를 tmp 아래에 쓰고 경로를 돌려준다 */
async function writeFontsConf(fontDir: string, include: string): Promise<string> {
  const dir = path.join(tmpdir(), 'web-inspector-fontconfig');
  const cacheDir = path.join(dir, 'cache');
  await mkdir(cacheDir, { recursive: true });
  const confPath = path.join(dir, 'fonts.conf');
  await writeFile(confPath, buildFontsConf(fontDir, cacheDir, include), 'utf8');
  return confPath;
}

async function copyIfChanged(source: string, target: string): Promise<void> {
  const [from, to] = await Promise.all([stat(source), stat(target).catch(() => null)]);
  if (to && to.size === from.size) return;
  await copyFile(source, target);
}

/**
 * Vercel: @sparticuz/chromium 153에는 폰트 등록 함수가 없다. 대신 executablePath()가
 * /tmp/fonts에 fonts.conf를 풀고(FONTCONFIG_PATH=/tmp/fonts), 그 fonts.conf가 /tmp/fonts를
 * 폰트 디렉터리로 지정한다. 그래서 번들 폰트를 그 아래로 복사한다(T02에서 확인한 방식).
 * 그 fonts.conf에는 별칭 규칙을 넣을 수 없으므로, 그것을 include하고 별칭을 더한 fonts.conf를 따로 만들어
 * FONTCONFIG_FILE로 넘긴다. FONTCONFIG_FILE이 적용되지 않더라도 복사한 폰트는 기본 설정으로 찾을 수 있다.
 *
 * 순서가 중요하다. @sparticuz/chromium은 /tmp/fonts가 이미 있으면 압축 해제를 건너뛰므로,
 * 먼저 복사하면 fonts.conf가 생기지 않는다. 반드시 executablePath() 다음에 호출해야 한다.
 */
async function registerVercelFonts(): Promise<EnsureFontsResult> {
  const fontconfigDir = path.join(tmpdir(), 'fonts');
  const sparticuzConf = path.join(fontconfigDir, 'fonts.conf');
  if (!existsSync(sparticuzConf)) {
    throw new Error('fonts.conf가 없다. @sparticuz/chromium executablePath()를 먼저 호출해야 한다.');
  }
  const target = path.join(fontconfigDir, 'web-inspector');
  await mkdir(target, { recursive: true });
  const files = getBundledFontPaths();
  await Promise.all(files.map((file) => copyIfChanged(file, path.join(target, path.basename(file)))));
  // /tmp/fonts는 include한 설정이 이미 폰트 디렉터리로 지정하므로 dir에는 복사한 폴더를 다시 적어도 중복되지 않는다
  const confPath = await writeFontsConf(target, sparticuzConf);
  return { env: { FONTCONFIG_FILE: confPath }, fontFiles: files.length };
}

async function registerLinuxFonts(): Promise<EnsureFontsResult> {
  const confPath = await writeFontsConf(getBundledFontDir(), '/etc/fonts/fonts.conf');
  return { env: { FONTCONFIG_FILE: confPath }, fontFiles: getBundledFontPaths().length };
}

function warnMacos(): EnsureFontsResult {
  console.warn(
    '[fonts] macOS에서는 OS 폰트 대체 순서를 따르므로 외부 사이트 측정값이 Vercel과 다를 수 있다. ' +
      'Fixture는 @font-face로 /fonts/의 Noto Sans KR을 쓰므로 영향을 받지 않는다. (AGENTS.md 7.1)',
  );
  return { env: {}, fontFiles: 0 };
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
