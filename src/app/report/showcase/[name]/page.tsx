import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { buttonClassName } from '@/components/ui/Button';
import { ReportSkeleton } from '@/features/report';
import { availableShowcases, isShowcaseName, loadShowcase, type ShowcaseName } from '@/server/showcase';
import { StaticReportContent } from '../../ReportContent';

// Before/After 사례 리포트(T14). public/showcase/{before|after}/inspection.json을 빌드할 때 읽어 정적 페이지로 만든다.
// polling, fetch, Redis를 쓰지 않는다(/report/sample과 같은 방식, DOMAIN_MODEL 6.3).
// 파일이 있는 이름만 만들고, 그 밖의 이름(파일이 없는 before/after 포함)은 404다.

export const dynamicParams = false;

export function generateStaticParams(): { name: ShowcaseName }[] {
  return availableShowcases().map((name) => ({ name }));
}

const COPY: Record<ShowcaseName, { label: string; title: string; description: string; other: ShowcaseName; otherLabel: string }> = {
  before: {
    label: 'Before',
    title: 'Before 사례: 수정 전 검사 결과입니다',
    description: '이 리포트의 개발 태스크 프롬프트를 AI 코딩 에이전트에 넘겨 사이트를 고쳤습니다.',
    other: 'after',
    otherLabel: 'After 리포트 보기',
  },
  after: {
    label: 'After',
    title: 'After 사례: 수정 후 다시 검사한 결과입니다',
    description: 'Before 리포트의 프롬프트로 사이트를 고친 뒤, 같은 URL을 다시 검사했습니다.',
    other: 'before',
    otherLabel: 'Before 리포트 보기',
  },
};

export async function generateMetadata(props: PageProps<'/report/showcase/[name]'>): Promise<Metadata> {
  const { name } = await props.params;
  if (!isShowcaseName(name)) return {};
  return {
    title: `${COPY[name].label} 사례 리포트`,
    description: '검사 결과로 만든 프롬프트로 사이트를 고치기 전과 후의 리포트입니다.',
  };
}

function ShowcaseBanner({ name, otherAvailable }: { name: ShowcaseName; otherAvailable: boolean }) {
  const copy = COPY[name];
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-info-tint px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="text-body font-medium text-text-primary">{copy.title}</p>
        <p className="text-body-sm text-text-secondary">{copy.description}</p>
      </div>
      <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
        {otherAvailable ? (
          <Link href={`/report/showcase/${copy.other}`} className={buttonClassName('secondary', 'md', 'min-h-11 w-full sm:w-auto')}>
            {copy.otherLabel}
          </Link>
        ) : null}
        <Link href="/" className={buttonClassName('primary', 'md', 'min-h-11 w-full sm:w-auto')}>
          내 사이트 검사하기
        </Link>
      </div>
    </div>
  );
}

export default async function ShowcaseReportPage(props: PageProps<'/report/showcase/[name]'>) {
  const { name } = await props.params;
  if (!isShowcaseName(name)) notFound();
  const inspection = loadShowcase(name);
  if (!inspection) notFound();
  const otherAvailable = availableShowcases().includes(COPY[name].other);

  return (
    <>
      <Header />
      <PageContainer size="wide" className="py-8">
        {/* 선택 상태(useSearchParams)를 읽는 부분은 Suspense 경계 안에 둔다 */}
        <Suspense fallback={<ReportSkeleton />}>
          <StaticReportContent inspection={inspection} variant="showcase" banner={<ShowcaseBanner name={name} otherAvailable={otherAvailable} />} />
        </Suspense>
      </PageContainer>
    </>
  );
}
