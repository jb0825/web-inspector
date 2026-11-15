import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { buttonClassName } from '@/components/ui/Button';
import { ReportSkeleton } from '@/features/report';
import { availableShowcases, loadShowcase, type ShowcaseName } from '@/server/showcase';
import { StaticReportContent } from './ReportContent';

// Before/After 사례 리포트(T14). /report/before, /report/after가 함께 쓴다.
// public/showcase/{before|after}/inspection.json을 빌드할 때 읽어 정적 페이지로 만든다(/report/sample과 같은 방식, DOMAIN_MODEL 6.3).
// polling, fetch, Redis를 쓰지 않고, 검사 대상 URL(localhost여도)을 다시 판정하지 않는다. 파일이 없으면 404다.

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

export function showcaseMetadata(name: ShowcaseName): Metadata {
  return {
    title: `${COPY[name].label} 사례 리포트`,
    description: '검사 결과로 만든 프롬프트로 사이트를 고치기 전과 후의 리포트입니다.',
  };
}

function ShowcaseBanner({ name, otherAvailable }: { name: ShowcaseName; otherAvailable: boolean }) {
  const copy = COPY[name];
  const button = 'min-h-11 w-full @md:w-auto';
  // 상세 패널이 열리면 본문 폭이 줄어든다. 화면 폭이 아니라 배너 폭(컨테이너 쿼리)으로 가로 배치를 정한다
  return (
    <div className="@container rounded-lg bg-info-tint px-4 py-3">
      <div className="flex flex-col gap-3 @2xl:flex-row @2xl:items-center @2xl:justify-between">
        <div className="flex flex-col gap-0.5">
          <p className="text-body font-medium text-text-primary">{copy.title}</p>
          <p className="text-body-sm text-text-secondary">{copy.description}</p>
        </div>
        <div className="flex w-full shrink-0 flex-col gap-2 @md:flex-row @md:flex-wrap @2xl:w-auto">
          {otherAvailable ? (
            <>
              <Link href="/showcase" className={buttonClassName('secondary', 'md', button)}>
                비교 보기
              </Link>
              <Link href={`/report/${copy.other}`} className={buttonClassName('secondary', 'md', button)}>
                {copy.otherLabel}
              </Link>
            </>
          ) : null}
          <Link href="/" className={buttonClassName('primary', 'md', button)}>
            내 사이트 검사하기
          </Link>
        </div>
      </div>
    </div>
  );
}

export function ShowcaseReportPage({ name }: { name: ShowcaseName }) {
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
