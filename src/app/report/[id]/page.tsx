import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { ReportSkeleton } from '@/features/report';
import { ReportScreen } from './ReportScreen';

// 공유 리포트에는 검사한 페이지의 텍스트와 스크린샷이 들어 있어 검색 엔진에 노출하지 않는다(DOMAIN_MODEL 8장, T13)
export const metadata: Metadata = {
  title: '검사 결과',
  robots: { index: false, follow: false },
};

// PRD 7.3, WIREFRAME 5장. 결과는 클라이언트가 polling으로 받는다(API_SPEC 7장).
// 선택 상태(useSearchParams)를 읽는 부분은 Suspense 경계 안에 둔다.
export default async function ReportPage(props: PageProps<'/report/[id]'>) {
  const { id } = await props.params;
  return (
    <>
      <Header />
      <PageContainer size="wide" className="py-8">
        <Suspense fallback={<ReportSkeleton />}>
          {/* 다른 검사로 이동하면 polling과 화면 상태를 새로 시작한다 */}
          <ReportScreen key={id} id={id} />
        </Suspense>
      </PageContainer>
    </>
  );
}
