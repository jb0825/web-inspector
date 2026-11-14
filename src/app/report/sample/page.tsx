import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { buttonClassName } from '@/components/ui/Button';
import { ReportSkeleton } from '@/features/report';
import { inspectionSchema } from '@/server/store/schemas';
import sampleDocument from '../../../../public/sample/inspection.json';
import { StaticReportContent } from '../ReportContent';

// WIREFRAME 5.13, DOMAIN_MODEL 6.3, PRD 8.1.4: 저장소에 포함된 정적 JSON으로 그린다. polling, fetch, Redis를 쓰지 않는다.
// 문서는 빌드할 때 스키마로 확인한다. 형식이 맞지 않으면 빌드가 실패한다(샘플은 scripts/import-sample.ts로만 바꾼다).
const sample = inspectionSchema.parse(sampleDocument);

export const metadata: Metadata = {
  title: '샘플 리포트',
  description: '데모 랜딩 페이지를 Desktop과 Mobile에서 검사한 결과 예시입니다. 이슈, Evidence, 개발 태스크와 프롬프트를 미리 볼 수 있습니다.',
};

function SampleBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-lg bg-info-tint px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-0.5">
        <p className="text-body font-medium text-text-primary">샘플 리포트입니다</p>
        <p className="text-body-sm text-text-secondary">이 서비스가 직접 만든 데모 페이지를 미리 검사한 결과입니다.</p>
      </div>
      <Link href="/" className={buttonClassName('primary', 'md', 'min-h-11 w-full shrink-0 sm:w-auto')}>
        내 사이트 검사하기
      </Link>
    </div>
  );
}

export default function SampleReportPage() {
  return (
    <>
      <Header />
      <PageContainer size="wide" className="py-8">
        {/* 선택 상태(useSearchParams)를 읽는 부분은 Suspense 경계 안에 둔다 */}
        <Suspense fallback={<ReportSkeleton />}>
          <StaticReportContent inspection={sample} banner={<SampleBanner />} />
        </Suspense>
      </PageContainer>
    </>
  );
}
