import Link from 'next/link';

// WIREFRAME 2.2: 로고(Home 링크)와 "새 검사". Home 화면에서는 "새 검사"를 숨긴다.
// components/layout은 lib만 import하므로(AGENTS.md 3.1) Secondary Small 버튼 모양을 여기서 직접 쓴다.
// Mobile에서는 터치 대상 44px을 지킨다(WIREFRAME 10.3)
export function Header({ showNewInspection = true }: { showNewInspection?: boolean }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 w-full max-w-wide items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-sm text-h3 font-semibold text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
        >
          AI Website Inspector
        </Link>
        {showNewInspection ? (
          <Link href="/" className="inline-flex h-11 items-center rounded-md sm:h-8 bg-background-secondary px-3 text-body-sm font-medium text-text-primary transition-colors duration-(--duration-fast) hover:bg-background-tertiary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid">
            새 검사
          </Link>
        ) : null}
      </div>
    </header>
  );
}
