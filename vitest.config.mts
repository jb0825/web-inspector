import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `server-only`는 Next.js 밖에서 import하면 에러를 던진다. 테스트에서는 패키지가 함께
      // 제공하는 빈 모듈로 바꾼다. 소스의 `import 'server-only'`는 그대로 둔다(AGENTS.md 10장).
      'server-only': fileURLToPath(new URL('./node_modules/server-only/empty.js', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
