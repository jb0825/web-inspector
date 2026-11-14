import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { buttonClassName } from '@/components/ui/Button';

// 없는 경로(T13). 결과 없음 화면(WIREFRAME 4.6, features/inspection-progress의 NotFoundState)과 같은 톤으로 쓴다.
// 검사 결과가 없거나 만료된 /report/[id], /inspections/[id]는 각 화면이 polling 결과로 직접 처리한다.
export const metadata: Metadata = {
  title: '페이지를 찾을 수 없습니다',
};

export default function NotFound() {
  return (
    <>
      <Header />
      <PageContainer className="py-12">
        <section className="flex flex-col items-start gap-6" aria-labelledby="page-not-found-title">
          <div className="flex flex-col gap-2">
            <h1 id="page-not-found-title" className="text-h1 font-semibold">
              페이지를 찾을 수 없습니다
            </h1>
            <p className="text-body-lg text-text-secondary">주소가 바뀌었거나 없는 페이지입니다. 주소를 다시 확인해 주세요.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/" className={buttonClassName('secondary', 'md', 'min-h-11')}>
              홈으로
            </Link>
            <Link href="/report/sample" className={buttonClassName('tertiary', 'md', 'min-h-11')}>
              샘플 리포트 보기
              <ChevronRight aria-hidden size={16} strokeWidth={1.75} />
            </Link>
          </div>
        </section>
      </PageContainer>
    </>
  );
}
