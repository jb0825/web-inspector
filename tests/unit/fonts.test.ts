import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFontsConf, getBundledFontPaths } from '@/server/browser/fonts';
import { resolveLaunchTarget } from '@/server/browser/launch';

describe('fonts (AGENTS.md 7.1)', () => {
  it('번들 폰트 경로는 public/fonts의 절대 경로이고 파일이 실제로 있다', () => {
    const paths = getBundledFontPaths();
    expect(paths.map((p) => path.basename(p))).toEqual(['NotoSansKR-Regular.ttf', 'NotoSansKR-Bold.ttf']);
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
