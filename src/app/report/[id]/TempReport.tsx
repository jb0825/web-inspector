// TEMP(T11): T12에서 교체
'use client';

import { StatusBadge } from '@/components/inspection/StatusBadge';
import { useInspectionPolling } from '@/components/polling/useInspectionPolling';
import { Button } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { NotFoundState } from '@/features/inspection-progress';
import type { Viewport } from '@/types/inspection';

const VIEWPORTS: Viewport[] = ['desktop', 'mobile'];

export function TempReport({ id }: { id: string }) {
  const { state, retry } = useInspectionPolling(id);
  const inspection = state.inspection;

  if (state.phase === 'not-found') return <NotFoundState />;
  if (!inspection) {
    if (state.phase === 'error') {
      return (
        <Notice tone="error" title="결과를 불러오지 못했습니다">
          <Button variant="secondary" size="sm" onClick={retry}>
            다시 불러오기
          </Button>
        </Notice>
      );
    }
    return (
      <div className="flex items-center gap-2 text-body text-text-secondary" role="status">
        <Spinner />
        결과를 불러오는 중입니다.
      </div>
    );
  }

  const needsReview = inspection.issues.filter((issue) => issue.needsReview).length;
  return (
    <div className="flex flex-col gap-6">
      <div aria-live="polite" className="flex flex-col items-start gap-2">
        <StatusBadge status={inspection.status} />
        <h1 className="text-h1 font-semibold">검사 결과 (임시 화면)</h1>
      </div>
      <p className="font-mono text-code wrap-anywhere">{inspection.finalUrl ?? inspection.url}</p>
      {state.phase === 'error' ? (
        <Notice tone="error" title="상태를 불러오지 못했습니다">
          <Button variant="secondary" size="sm" onClick={retry}>
            다시 불러오기
          </Button>
        </Notice>
      ) : null}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
        <dt className="text-text-secondary">이슈</dt>
        <dd className="tabular-nums">
          {inspection.issues.length}개 (검토 필요 {needsReview}개)
        </dd>
        <dt className="text-text-secondary">태스크</dt>
        <dd className="tabular-nums">{inspection.status === 'analyzing' ? '생성 중' : `${inspection.tasks.length}개`}</dd>
        {VIEWPORTS.map((viewport) => {
          const result = inspection.viewports[viewport];
          const error = inspection.viewportErrors[viewport];
          return (
            <div key={viewport} className="contents">
              <dt className="text-text-secondary capitalize">{viewport}</dt>
              <dd>
                {result ? (
                  <a href={result.screenshotUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    스크린샷 열기
                  </a>
                ) : error ? (
                  <code className="font-mono text-caption text-error-text">{error.code}</code>
                ) : (
                  <span className="text-text-tertiary">-</span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
