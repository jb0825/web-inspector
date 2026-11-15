// 서버가 요청을 받기 전에 한 번 실행된다(Next.js instrumentation).
// PRD 8.7: INSPECTOR_MODE=local이 배포 환경(VERCEL)에서 켜져 있거나 LOCAL_ALLOW_HOSTS 형식이 틀리면 서버 시작을 실패시킨다.
// 첫 검사 요청까지 기다리지 않고, 로컬 모드가 배포본에서 한 번도 동작하지 않게 하기 위해서다.
export async function register(): Promise<void> {
  // Next.js가 instrumentation을 Edge용으로도 컴파일한다. NEXT_RUNTIME은 빌드 때 값이 정해지는 Next.js 내장 변수라
  // Edge 번들에서는 아래 import가 빠진다(node_modules/next/dist/docs/01-app/02-guides/instrumentation.md).
  // 서비스 환경변수가 아니므로 env.ts를 거치지 않는 예외로 둔다(AGENTS.md 5장).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertStartupEnv } = await import('./server/startup');
    assertStartupEnv();
  }
}
