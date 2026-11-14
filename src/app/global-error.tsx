'use client';

import './globals.css';

// 루트 layout까지 실패한 경우 (T13). layout을 대신하므로 html, body를 직접 그린다.
// metadata export를 쓸 수 없어 React <title>을 쓴다. 내부 메시지와 스택은 보여주지 않는다(WIREFRAME 11.3).
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="ko">
      <body className="flex min-h-full flex-col">
        <title>오류 · AI Website Inspector</title>
        <main className="mx-auto flex w-full max-w-narrow flex-col gap-4 px-4 py-12">
          <h1 className="text-h1 font-semibold">서비스를 표시하지 못했습니다</h1>
          <p className="text-body-lg text-text-secondary">예상하지 못한 오류가 발생했습니다. 다시 시도하거나 홈으로 이동해 주세요.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body font-medium text-background"
            >
              다시 시도
            </button>
            {/* 루트 layout이 실패한 상태라 클라이언트 라우터 대신 전체 페이지 이동을 쓴다 */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="inline-flex min-h-11 items-center rounded-md bg-background-secondary px-4 text-body font-medium text-text-primary">
              홈으로
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
