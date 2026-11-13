import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: false,
  },
  // cacheComponents와 partialPrefetching은 쓰지 않는다. cacheComponents가 켜져 있으면
  // route의 `runtime` export를 쓸 수 없고(AGENTS.md 7장), 이 서비스는 polling과
  // 동적 결과 화면이 대부분이라 캐시 이점이 거의 없다. partialPrefetching은 cacheComponents가 필요하다.
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
