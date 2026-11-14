import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { ReportSkeleton } from '@/features/report';
import { ReportScreen } from './ReportScreen';

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
