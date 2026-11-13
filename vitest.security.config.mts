import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// T08 보안 통합 테스트 (로컬 브라우저). pnpm test와 분리한다: 브라우저를 띄워 느리기 때문이다.
// alias는 vitest.config.ts와 같다. mergeConfig는 include 배열을 이어 붙이므로 쓰지 않는다.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    include: ['tests/security/**/*.test.ts'],
    environment: 'node',
    // 같은 브라우저와 Fixture 서버 요청 기록을 공유하므로 순서대로 실행한다
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
