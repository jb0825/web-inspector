import type { Metadata } from 'next';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { InspectionProgress } from '@/features/inspection-progress';

// 검사 대상 URL이 화면에 나오므로 검색 엔진에 노출하지 않는다(DOMAIN_MODEL 8장, T13)
export const metadata: Metadata = {
  title: '검사 진행 중',
  robots: { index: false, follow: false },
};

// PRD 7.2. 상태는 클라이언트가 polling한다(API_SPEC 7장)
export default async function InspectionProgressPage(props: PageProps<'/inspections/[id]'>) {
  const { id } = await props.params;
  return (
    <>
      <Header />
      <PageContainer className="py-12">
        {/* 다시 검사로 id가 바뀌면 polling 상태를 새로 시작한다 */}
        <InspectionProgress key={id} id={id} />
      </PageContainer>
    </>
  );
}
