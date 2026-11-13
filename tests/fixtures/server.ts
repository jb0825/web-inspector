import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

// Fixture 페이지와 /fonts/를 서빙하는 로컬 정적 서버.
// fixtures:shots(T03), collect(T04), test:fixtures(T06)가 함께 쓴다. Node 내장 모듈만 쓴다.

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

export interface FixtureServer {
  /** 예: http://127.0.0.1:53123 (끝에 / 없음) */
  baseUrl: string;
  close: () => Promise<void>;
}

export interface StartOptions {
  /** 서빙할 디렉터리. 기본값은 저장소의 public/ (스크립트는 저장소 루트에서 실행한다) */
  root?: string;
}

/**
 * 요청 경로를 root 안의 실제 파일 경로로 바꾼다. root 밖이면 null.
 * 순수 함수라 단위 테스트할 수 있다.
 */
export function resolveRequestPath(root: string, requestUrl: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://fixture.local').pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname.endsWith('/')) pathname += 'index.html';

  const resolved = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, resolved);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

export function contentTypeFor(filePath: string): string | undefined {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()];
}

export async function start(options: StartOptions = {}): Promise<FixtureServer> {
  // 심볼릭 링크로 root 밖을 가리키는 경우까지 막기 위해 실제 경로 기준으로 비교한다.
  const root = await realpath(path.resolve(options.root ?? path.join(process.cwd(), 'public')));

  const server = http.createServer((req, res) => {
    void handle(root, req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 포트 0: OS가 빈 포트를 고른다. 외부 인터페이스에는 열지 않는다.
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(root: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed');
  }

  const candidate = resolveRequestPath(root, req.url ?? '/');
  if (!candidate) return send(res, 403, 'Forbidden');

  let filePath: string;
  try {
    filePath = await realpath(candidate);
    const relative = path.relative(root, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return send(res, 403, 'Forbidden');
    if (!(await stat(filePath)).isFile()) return send(res, 404, 'Not Found');
  } catch {
    return send(res, 404, 'Not Found');
  }

  const contentType = contentTypeFor(filePath);
  if (!contentType) return send(res, 415, 'Unsupported Media Type');

  res.writeHead(200, {
    'Content-Type': contentType,
    // Fixture를 고친 뒤 다시 찍을 때 캐시된 파일을 쓰지 않게 한다.
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(filePath)
    .on('error', () => res.destroy())
    .pipe(res);
}

function send(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}
