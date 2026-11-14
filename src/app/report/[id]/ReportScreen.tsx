'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useInspectionPolling } from '@/components/polling/useInspectionPolling';
import { NotFoundState } from '@/features/inspection-progress';
import { parseSelection, ReportFailedState, ReportLoadError, ReportSkeleton } from '@/features/report';
import { ReportContent } from '../ReportContent';

// 결과 화면: polling으로 문서를 받고 상태별 화면을 고른다. 본문 조립은 ReportContent(/report/sample과 공용)가 한다.
export function ReportScreen({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 종료 상태(completed / partial / failed)가 될 때까지 polling한다(USER_FLOW 5.6)
  const { state, retry } = useInspectionPolling(id);
  const inspection = state.inspection;
  const selection = parseSelection(searchParams, inspection);
  const inProgress = inspection !== null && (inspection.status === 'pending' || inspection.status === 'running');

  useEffect(() => {
    // 결과가 아직 없으면 진행 화면으로 보낸다. 뒤로 가기로 이 화면에 돌아오지 않게 replace
    if (inProgress) router.replace(`/inspections/${encodeURIComponent(id)}`);
  }, [inProgress, id, router]);

  if (state.phase === 'not-found') return <NotFoundState />;
  if (!inspection) return state.phase === 'error' ? <ReportLoadError onRetry={retry} /> : <ReportSkeleton />;
  if (inProgress) return <ReportSkeleton />;
  if (inspection.status === 'failed') return <ReportFailedState inspection={inspection} />;

  return (
    <>
      {state.phase === 'error' ? <ReportLoadError onRetry={retry} /> : null}
      <ReportContent inspection={inspection} variant="live" selection={selection} />
    </>
  );
}
