import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_EXPECTATIONS } from '../fixtures/expected';
import { contentTypeFor, resolveRequestPath, start, type FixtureServer } from '../fixtures/server';

const PUBLIC_DIR = path.join(process.cwd(), 'public');

function readFixture(urlPath: string): string {
  return readFileSync(path.join(PUBLIC_DIR, urlPath), 'utf8');
}

/** <head> 주석의 설명은 빼고 <body> 안에서만 센다 */
function countTestId(html: string, testId: string): number {
  const body = html.slice(html.indexOf('<body'));
  return body.split(`data-testid="${testId}"`).length - 1;
}

/** PRD 5.5.2 등급 경계 */
function priorityOf(score100: number): string {
  if (score100 >= 400) return 'P0';
  if (score100 >= 300) return 'P1';
  if (score100 >= 200) return 'P2';
  return 'P3';
}

describe('expected.ts (PRD 13.1, DETECTION_RULES 12.2)', () => {
  it('Positive 6개, Negative 9개이고 ID가 겹치지 않는다', () => {
    const ids = FIXTURE_EXPECTATIONS.map((f) => f.id);
    expect(new Set(ids).size).toBe(15);
    expect(FIXTURE_EXPECTATIONS.filter((f) => f.kind === 'positive')).toHaveLength(6);
    expect(FIXTURE_EXPECTATIONS.filter((f) => f.kind === 'negative')).toHaveLength(9);
  });

  it.each(FIXTURE_EXPECTATIONS)('$id: 경로, 이슈 수, kind가 서로 맞다', (fixture) => {
    expect(fixture.path).toBe(`/fixtures/${fixture.kind}/${fixture.id}.html`);
    expect(fixture.issueCount).toBe(fixture.issues.length);
    expect(fixture.issueCount).toBe(fixture.kind === 'negative' ? 0 : 1);
  });

  it.each(FIXTURE_EXPECTATIONS.flatMap((f) => f.issues.map((issue) => ({ id: f.id, issue }))))(
    '$id: score100과 Priority가 PRD 5.5.2와 맞고 R은 1~5다',
    ({ issue }) => {
      const { S, I, R, score100 } = issue.scores;
      expect(score100).toBe(S * 35 + I * 35 + R * 30);
      expect(priorityOf(score100)).toBe(issue.priority);
      for (const value of [S, I, R]) {
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
      }
    },
  );

  it.each(FIXTURE_EXPECTATIONS)('$id: 페이지가 있고, 대상 data-testid가 정확히 하나씩 있다', (fixture) => {
    const html = readFixture(fixture.path);
    for (const issue of fixture.issues) {
      expect(countTestId(html, issue.testId)).toBe(1);
      if (issue.relatedTestId) expect(countTestId(html, issue.relatedTestId)).toBe(1);
    }
  });

  it.each(FIXTURE_EXPECTATIONS)('$id: 공통 규칙 (viewport meta, 공통 CSS, 외부 리소스와 script 없음)', (fixture) => {
    const html = readFixture(fixture.path);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<link rel="stylesheet" href="/fixtures/assets/base.css">');
    expect(html).toContain(`Fixture: ${fixture.id}`);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/(?:src|href)=["'](?:https?:)?\/\//i);
    expect(html).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
  });

  it('목록 페이지가 15개 Fixture를 모두 링크한다', () => {
    const html = readFixture('/fixtures/index.html');
    for (const fixture of FIXTURE_EXPECTATIONS) expect(html).toContain(`href="${fixture.path}"`);
  });

  it('공통 CSS가 /fonts/의 Noto Sans KR 두 굵기를 font-display: block으로 불러온다 (AGENTS.md 7.1)', () => {
    const css = readFixture('/fixtures/assets/base.css');
    expect(css).toContain("url('/fonts/NotoSansKR-Regular.ttf')");
    expect(css).toContain("url('/fonts/NotoSansKR-Bold.ttf')");
    expect(css.match(/font-display: block;/g)).toHaveLength(2);
    expect(css).not.toMatch(/url\(\s*["']?(?:https?:)?\/\//i);
  });
});

describe('Fixture 서버', () => {
  const root = '/srv/public';

  it('public 안의 경로를 실제 파일 경로로 바꾸고, 디렉터리는 index.html로 본다', () => {
    expect(resolveRequestPath(root, '/fixtures/positive/P-01.html')).toBe('/srv/public/fixtures/positive/P-01.html');
    expect(resolveRequestPath(root, '/fixtures/')).toBe('/srv/public/fixtures/index.html');
    expect(resolveRequestPath(root, '/fonts/NotoSansKR-Regular.ttf?v=1')).toBe('/srv/public/fonts/NotoSansKR-Regular.ttf');
  });

  it('public 밖으로 나가는 경로는 막는다', () => {
    // URL 파서가 먼저 정규화하는 `..`는 public 안으로 되돌아온다(안전)
    expect(resolveRequestPath(root, '/../package.json')).toBe('/srv/public/package.json');
    expect(resolveRequestPath(root, '/%2e%2e/package.json')).toBe('/srv/public/package.json');
    // %2f로 인코딩된 `/`는 디코딩 뒤에야 `..`가 되므로 여기서 막아야 한다
    expect(resolveRequestPath(root, '/fixtures/%2e%2e%2f%2e%2e%2f.env.local')).toBeNull();
    expect(resolveRequestPath(root, '/..%2fpackage.json')).toBeNull();
    expect(resolveRequestPath(root, '/a%00.html')).toBeNull();
    expect(resolveRequestPath(root, '/%E0%A4%A')).toBeNull();
    // 어떤 입력이든 결과는 null이거나 root 안이다
    for (const input of ['/..%5c..%5cpackage.json', '/%2e%2e%2f%2e%2e%2fetc/passwd', '//etc/passwd', '/./../../x']) {
      const resolved = resolveRequestPath(root, input);
      if (resolved !== null) expect(resolved.startsWith(`${root}${path.sep}`)).toBe(true);
    }
  });

  it('확장자별 Content-Type', () => {
    expect(contentTypeFor('a.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('a.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('a.svg')).toBe('image/svg+xml');
    expect(contentTypeFor('a.png')).toBe('image/png');
    expect(contentTypeFor('a.ttf')).toBe('font/ttf');
    expect(contentTypeFor('a.exe')).toBeUndefined();
  });

  describe('실제 서버', () => {
    let server: FixtureServer;
    beforeAll(async () => {
      server = await start();
    });
    afterAll(async () => {
      await server.close();
    });

    it('127.0.0.1에 바인딩하고 Fixture와 폰트를 올바른 Content-Type으로 보낸다', async () => {
      expect(server.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const page = await fetch(`${server.baseUrl}/fixtures/positive/P-01.html`);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
      const font = await fetch(`${server.baseUrl}/fonts/NotoSansKR-Bold.ttf`, { method: 'HEAD' });
      expect(font.status).toBe(200);
      expect(font.headers.get('content-type')).toBe('font/ttf');
    });

    it('없는 파일은 404, public 밖은 403 또는 404', async () => {
      expect((await fetch(`${server.baseUrl}/fixtures/none.html`)).status).toBe(404);
      const escaped = await fetch(`${server.baseUrl}/%2e%2e/package.json`);
      expect([403, 404]).toContain(escaped.status);
      expect(await escaped.text()).not.toContain('"name"');
    });
  });
});
