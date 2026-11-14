import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { InspectionProgress } from '@/features/inspection-progress';

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
