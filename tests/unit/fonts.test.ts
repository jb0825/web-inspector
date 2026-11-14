import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFontsConf, FONT_ALIASES, getBundledFontPaths } from '@/server/browser/fonts';
import { resolveLaunchTarget } from '@/server/browser/launch';

describe('fonts (AGENTS.md 7.1)', () => {
  it('번들 폰트 경로는 public/fonts의 절대 경로이고 파일이 실제로 있다', () => {
    const paths = getBundledFontPaths();
    const names = paths.map((p) => path.basename(p));
    expect(names.slice(0, 2)).toEqual(['NotoSansKR-Regular.ttf', 'NotoSansKR-Bold.ttf']);
    expect(names).toContain('LiberationSans-Regular.ttf');
    expect(names).toContain('LiberationSerif-Regular.ttf');
    expect(names).toContain('LiberationMono-Regular.ttf');
    for (const file of paths) {
      expect(path.isAbsolute(file)).toBe(true);
      expect(file).toContain(path.join('public', 'fonts'));
      expect(existsSync(file)).toBe(true);
    }
  });

  it('Linux fonts.conf는 시스템 설정을 포함하고 번들 디렉터리와 캐시 디렉터리를 지정한다', () => {
    const conf = buildFontsConf('/app/public/fonts', '/tmp/cache');
    expect(conf).toContain('<include ignore_missing="yes">/etc/fonts/fonts.conf</include>');
    expect(conf).toContain('<dir>/app/public/fonts</dir>');
    expect(conf).toContain('<cachedir>/tmp/cache</cachedir>');
  });

  it('Vercel은 @sparticuz/chromium의 fonts.conf를 include한다', () => {
    const conf = buildFontsConf('/tmp/fonts/web-inspector', '/tmp/cache', '/tmp/fonts/fonts.conf');
    expect(conf).toContain('<include ignore_missing="yes">/tmp/fonts/fonts.conf</include>');
    expect(conf).not.toContain('/etc/fonts/fonts.conf');
  });

  it('시스템 폰트 이름을 글자 폭이 같은 번들 폰트로 보내고, 일반 글꼴 이름의 기본 폰트를 정한다', () => {
    const conf = buildFontsConf('/app/public/fonts', '/tmp/cache');
    expect(conf).toContain('<alias binding="same"><family>Arial</family><accept><family>Liberation Sans</family></accept></alias>');
    expect(conf).toContain('<alias binding="same"><family>Times New Roman</family><accept><family>Liberation Serif</family></accept></alias>');
    expect(conf).toContain('<alias binding="same"><family>Courier New</family><accept><family>Liberation Mono</family></accept></alias>');
    expect(conf).toContain('<alias><family>sans-serif</family><prefer><family>Liberation Sans</family><family>Noto Sans KR</family></prefer></alias>');
    // 별칭이 가리키는 폰트는 모두 번들되어 있다
    const bundled = getBundledFontPaths().map((p) => path.basename(p));
    for (const { accept } of FONT_ALIASES) {
      for (const name of accept) expect(bundled.some((file) => file.startsWith(name.replace(/ /g, '')))).toBe(true);
    }
  });

  it('fonts.conf가 올바른 XML 구조다 (여는 태그와 닫는 태그 수가 같다)', () => {
    const conf = buildFontsConf('/app/public/fonts', '/tmp/cache');
    for (const tag of ['alias', 'family', 'accept', 'prefer', 'fontconfig']) {
      expect(conf.split(`<${tag}`).length - 1).toBe(conf.split(`</${tag}>`).length - 1);
    }
  });

  it('fonts.conf 경로의 XML 특수문자를 이스케이프한다', () => {
    expect(buildFontsConf('/a&b/<c>', '/tmp')).toContain('<dir>/a&amp;b/&lt;c&gt;</dir>');
  });
});

describe('resolveLaunchTarget', () => {
  it('Vercel이면 플랫폼과 관계없이 vercel', () => {
    expect(resolveLaunchTarget({ isVercel: true, platform: 'linux' })).toBe('vercel');
  });
  it('로컬 Linux는 linux, macOS는 macos', () => {
    expect(resolveLaunchTarget({ isVercel: false, platform: 'linux' })).toBe('linux');
    expect(resolveLaunchTarget({ isVercel: false, platform: 'darwin' })).toBe('macos');
  });
});
