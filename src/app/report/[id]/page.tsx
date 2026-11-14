// TEMP(T11): T12에서 교체
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { TempReport } from './TempReport';

// 진행 화면이 이동할 대상이 있어야 해서 둔 최소 화면. 본 화면(features/report)은 T12에서 만든다
export default async function ReportPage(props: PageProps<'/report/[id]'>) {
  const { id } = await props.params;
  return (
    <>
      <Header />
      <PageContainer className="py-12">
        <TempReport key={id} id={id} />
      </PageContainer>
    </>
  );
}
