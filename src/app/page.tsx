import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { PageContainer } from '@/components/layout/PageContainer';
import { InspectionForm } from '@/features/inspection-form';

// PRD 7.1, WIREFRAME 3장
export default function HomePage() {
  return (
    <>
      <Header showNewInspection={false} />
      <PageContainer className="flex flex-col gap-8 py-12 sm:py-16">
        <div className="flex flex-col gap-3">
          <h1 className="text-h1 font-semibold sm:text-display">웹사이트 UI 문제를 찾아드립니다</h1>
          <p className="text-body-lg text-text-secondary">
            URL을 입력하면 Desktop과 Mobile에서 페이지를 렌더링해 텍스트 넘침, 요소 겹침, 화면 밖 넘침을 측정하고, 고칠 일을 개발 태스크와
            코딩 에이전트용 프롬프트로 정리합니다.
          </p>
        </div>

        <InspectionForm />

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm text-text-secondary">
          <dt className="font-medium text-text-primary">검사 환경</dt>
          <dd className="tabular-nums">Desktop 1440 × 900 · Mobile 390 × 844</dd>
          <dt className="font-medium text-text-primary">검사 항목</dt>
          <dd>Text Overflow · Element Overlap · Viewport Overflow</dd>
        </dl>

        <Link
          href="/report/sample"
          className="inline-flex h-11 items-center gap-1 self-start rounded-md text-body font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid"
        >
          샘플 리포트 보기
          <ChevronRight aria-hidden size={16} strokeWidth={1.75} />
        </Link>
      </PageContainer>
    </>
  );
}
