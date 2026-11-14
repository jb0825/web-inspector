'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { errorDetail, ERROR_MESSAGES, NO_ISSUES_MESSAGES } from '@/components/inspection/labels';
import { stashRetryUrl } from '@/components/inspection/retryUrl';
import { StatusBadge } from '@/components/inspection/StatusBadge';
import { Button, buttonClassName } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Inspection } from '@/types/inspection';

/** WIREFRAME 11.2: 결과 첫 조회 전 화면 골격 */
export function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label="검사 결과를 불러오는 중입니다">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full max-w-lg" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-12 w-full" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-120 lg:col-span-2 lg:h-160" />
        <Skeleton className="hidden h-160 lg:block" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <span className="sr-only">검사 결과를 불러오는 중입니다.</span>
    </div>
  );
}

/** WIREFRAME 5.12, USER_FLOW 5.9 */
export function NoIssuesState() {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-background-secondary px-4 py-6 text-center">
      <p className="text-h3 font-semibold">{NO_ISSUES_MESSAGES.title}</p>
      <p className="text-body-sm text-text-secondary">{NO_ISSUES_MESSAGES.body}</p>
    </div>
  );
}

/** status가 failed인 검사를 /report/[id]로 연 경우 (USER_FLOW 9장) */
export function ReportFailedState({ inspection }: { inspection: Inspection }) {
  const router = useRouter();
  const error = inspection.error;
  const detail = error ? errorDetail(error) : null;

  function retryFromHome() {
    stashRetryUrl(inspection.url);
    router.push('/');
  }

  return (
    <section className="flex max-w-narrow flex-col gap-4" aria-labelledby="report-failed-title">
      <div className="flex flex-col items-start gap-2">
        <StatusBadge status="failed" />
        <h1 id="report-failed-title" className="text-h1 font-semibold">
          검사에 실패했습니다
        </h1>
        <p className="font-mono text-code wrap-anywhere text-text-secondary">{inspection.url}</p>
      </div>
      <Notice tone="error" title={error ? ERROR_MESSAGES[error.code] : ERROR_MESSAGES.INTERNAL_ERROR}>
        <div className="flex flex-col gap-1">
          {detail ? <span className="wrap-anywhere">{detail}</span> : null}
          {error ? <code className="font-mono text-caption">{error.code}</code> : null}
        </div>
      </Notice>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={retryFromHome} className="min-h-11 w-full sm:w-auto">
          다시 시도
        </Button>
        <Link href="/report/sample" className={buttonClassName('tertiary', 'md', 'min-h-11 w-full sm:w-auto')}>
          샘플 리포트 보기
        </Link>
      </div>
    </section>
  );
}

/** polling이 재시도 횟수를 넘겨 멈춘 경우 */
export function ReportLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice tone="error" title="결과를 불러오지 못했습니다">
      <div className="flex flex-col items-start gap-2">
        <span>네트워크 연결을 확인한 뒤 다시 불러와 주세요.</span>
        <Button variant="secondary" size="sm" onClick={onRetry} className="min-h-11 sm:min-h-8">
          다시 불러오기
        </Button>
      </div>
    </Notice>
  );
}
