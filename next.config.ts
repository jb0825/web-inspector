import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: false,
  },
  // cacheComponents와 partialPrefetching은 쓰지 않는다. cacheComponents가 켜져 있으면
  // route의 `runtime` export를 쓸 수 없고(AGENTS.md 7장), 이 서비스는 polling과
  // 동적 결과 화면이 대부분이라 캐시 이점이 거의 없다. partialPrefetching은 cacheComponents가 필요하다.

  // 번들하지 않고 Node의 require/import로 불러온다. 두 패키지 모두 Next.js 기본 목록에도 있지만,
  // 브라우저 실행에 꼭 필요하므로 명시해 둔다(AGENTS.md 7장).
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],

  // pnpm 심볼릭 링크 구조와 런타임 경로 계산 때문에 트레이싱에서 빠질 수 있는 파일을 포함시킨다.
  // - @sparticuz/chromium/bin: Chromium, 폰트 설정, swiftshader 압축 파일
  // - public/fonts: Vercel에서 등록할 Noto Sans KR (AGENTS.md 7.1)
  // - playwright-core/browsers.json: coreBundle.js가 import 시점에 계산한 경로로 읽어서 트레이서가
  //   찾지 못한다. 빠지면 route 모듈 로드 단계에서 실패해 본문 없는 500이 난다(T02 Vercel 확인).
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
      "./node_modules/playwright-core/browsers.json",
      "./public/fonts/*.ttf",
      "./public/fonts/OFL.txt",
      "./public/fonts/OFL-Liberation.txt",
    ],
  },

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
