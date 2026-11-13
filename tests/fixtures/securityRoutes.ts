import type http from 'node:http';

// T08 보안 통합 테스트 전용 경로. start({ securityRoutes: true })일 때만 열린다.
// public/이 아니라 테스트 코드에 두어 배포된 서비스에 포함되지 않게 한다.
//
// "내부 주소"는 두 가지로 만든다.
// - 10.0.0.1, 169.254.169.254, evil.test(가짜 DNS → 10.0.0.1): 차단되는지 확인한다. 실제로 연결되면 시간 초과까지 기다리게 된다.
// - http://localhost:{port}/__secret: 같은 서버를 금지 호스트 이름(localhost)으로 부른다. 허용 목록은 127.0.0.1뿐이라
//   차단되어야 하고, 새어 나가면 서버의 요청 기록에 /__secret이 남는다. 실제 연결 여부를 직접 확인하는 용도다.

function html(res: http.ServerResponse, body: string): true {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>security</title></head><body>${body}</body></html>`);
  return true;
}

const redirectTo = (target: string) => `/__redirect?to=${encodeURIComponent(target)}`;

/** 처리했으면 true. secretOrigin: 예 http://localhost:53123 */
export function handleSecurityRoute(req: http.IncomingMessage, res: http.ServerResponse, secretOrigin: string): boolean {
  const url = new URL(req.url ?? '/', 'http://fixture.local');
  const secret = (tag: string) => `${secretOrigin}/__secret?${tag}`;

  switch (url.pathname) {
    case '/__redirect': {
      const to = url.searchParams.get('to') ?? '/';
      res.writeHead(Number(url.searchParams.get('status') ?? 302), { Location: to, 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
    case '/__secret':
      return html(res, '<p id="secret">SECRET</p>');
    case '/__security/ok':
      return html(res, '<p id="ok">OK</p><img src="relative.png">');
    case '/__security/subresources':
      return html(
        res,
        [
          '<img src="http://10.0.0.1/x.png">',
          '<img src="http://evil.test/x.png">',
          '<script src="http://169.254.169.254/latest/meta-data/"></script>',
          `<img src="${secret('img')}">`,
          // 허용된 호스트에서 시작해 리다이렉트로 내부 주소에 닿으려는 하위 리소스
          `<img src="${redirectTo(secret('img-redirect'))}">`,
          `<script>fetch(${JSON.stringify(redirectTo(secret('fetch-redirect')))}).catch(() => {});</script>`,
          '<p>subresources</p>',
        ].join(''),
      );
    case '/__security/iframe':
      return html(
        res,
        [
          `<iframe src="${redirectTo(secret('iframe-redirect'))}"></iframe>`,
          '<iframe src="http://169.254.169.254/"></iframe>',
          // 허용된 리다이렉트는 따라간다
          `<iframe id="allowed" src="${redirectTo('/__security/ok')}"></iframe>`,
        ].join(''),
      );
    case '/__security/websocket':
      return html(
        res,
        `<script>
          const ws = new WebSocket('ws://' + location.host + '/__ws');
          ws.onopen = () => { document.title = 'open'; };
          ws.onclose = (event) => { document.title = 'closed ' + event.code; };
        </script>`,
      );
    case '/__security/popup':
      return html(
        res,
        `<script>
          window.open('http://10.0.0.1/');
          window.open(${JSON.stringify(redirectTo(secret('popup-redirect')))});
        </script>`,
      );
    case '/__security/blob':
      return html(
        res,
        `<script>location.href = URL.createObjectURL(new Blob(['<p>blob</p>'], { type: 'text/html' }));</script>`,
      );
    case '/__security/js-data':
      return html(res, `<script>location.href = 'data:text/html,<p id=data>data</p>';</script><p id="stay">stay</p>`);
    case '/__security/js-redirect':
      // 로드 뒤(안정화 중) 스크립트로 메인 프레임을 금지 대상으로 옮기려는 페이지
      return html(res, `<p>js</p><script>setTimeout(() => { location.href = ${JSON.stringify(redirectTo(secret('js-redirect')))}; }, 50);</script>`);
    case '/__security/media':
      // PRD 8.6: 동영상·오디오는 불러오지 않는다. 요청 기록에 /__security/clip이 없어야 한다
      return html(res, '<video src="/__security/clip.mp4" autoplay muted preload="auto"></video><audio src="/__security/clip.mp3" preload="auto"></audio><p>media</p>');
    case '/__security/heavy': {
      // 성능 측정용: 요소 3000개와 하위 리소스(이미지) 120개
      const images = Array.from({ length: 120 }, (_, i) => `<img src="/__security/img?${i}" width="8" height="8">`).join('');
      const cells = Array.from({ length: 3000 }, (_, i) => `<span>항목 ${i}</span>`).join('');
      return html(res, `<div>${images}</div><div style="display:flex;flex-wrap:wrap;gap:4px">${cells}</div>`);
    }
    case '/__security/img':
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#888"/></svg>');
      return true;
    default:
      return false;
  }
}
