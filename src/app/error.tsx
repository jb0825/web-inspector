'use client';

import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { Button, buttonClassName } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';

// 예상하지 못한 화면 오류 (T13, WIREFRAME 11.3): 무엇이 실패했는지, 할 수 있는 일(다시 시도, 홈, 샘플)을 알린다.
// 스택이나 내부 메시지는 보여주지 않는다. production에서 서버 오류는 digest(서버 로그와 맞춰 볼 식별자)만 전달된다.
// 루트 layout의 오류는 global-error.tsx가 처리한다.

function digestOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('digest' in error)) return null;
  const digest = (error as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.length > 0 ? digest : null;
}

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = digestOf(error);
  return (
    <>
      <Header />
      <PageContainer className="py-12">
        <section className="flex flex-col gap-4" aria-labelledby="app-error-title">
          <div className="flex flex-col gap-2">
            <h1 id="app-error-title" className="text-h1 font-semibold">
              화면을 표시하지 못했습니다
            </h1>
            <p className="text-body-lg text-text-secondary">페이지를 그리는 중에 예상하지 못한 오류가 발생했습니다. 진행 중인 검사와 저장된 결과에는 영향이 없습니다.</p>
          </div>
          <Notice tone="error" title="일시적인 오류일 수 있습니다">
            <div className="flex flex-col gap-1">
              <span>다시 시도해도 같은 화면이 나오면 잠시 뒤 다시 열어 주세요.</span>
              {digest ? <code className="font-mono text-caption wrap-anywhere">오류 ID {digest}</code> : null}
            </div>
          </Notice>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => retry()} className="min-h-11 w-full sm:w-auto">
              <RotateCcw aria-hidden size={16} strokeWidth={1.75} />
              다시 시도
            </Button>
            <Link href="/" className={buttonClassName('secondary', 'md', 'min-h-11 w-full sm:w-auto')}>
              홈으로
            </Link>
            <Link href="/report/sample" className={buttonClassName('tertiary', 'md', 'min-h-11 w-full sm:w-auto')}>
              샘플 리포트 보기
            </Link>
          </div>
        </section>
      </PageContainer>
    </>
  );
}
