'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createInspection } from '@/components/api/inspections';
import { errorDetail, ERROR_MESSAGES, isInspectionStep, requestErrorMessage, STEP_LABELS } from '@/components/inspection/labels';
import { StatusBadge } from '@/components/inspection/StatusBadge';
import { useInspectionPolling } from '@/components/polling/useInspectionPolling';
import { Button, buttonClassName } from '@/components/ui/Button';
import { Notice } from '@/components/ui/Notice';
import { Spinner } from '@/components/ui/Spinner';
import { formatElapsed, parseIsoMs } from '@/lib/format';
import type { Inspection } from '@/types/inspection';
import { useNow } from '../hooks/useNow';
import { buildStepViews, elapsedRange, isReportReady } from '../steps';
import { NotFoundState } from './NotFoundState';
import { StepList } from './StepList';

// PRD 7.2, WIREFRAME 4장. analyzing부터는 결과 화면이 이어서 polling하므로 여기서는 멈추고 이동한다(API_SPEC 7장)
const stopAtReport = (inspection: Inspection) => isReportReady(inspection.status);

export function InspectionProgress({ id }: { id: string }) {
  const router = useRouter();
  const { state, retry } = useInspectionPolling(id, { stopWhen: stopAtReport });
  const inspection = state.inspection;
  const reportReady = inspection !== null && isReportReady(inspection.status);

  useEffect(() => {
    // 뒤로 가기로 진행 화면에 돌아오지 않게 replace를 쓴다
    if (reportReady) router.replace(`/report/${encodeURIComponent(id)}`);
  }, [reportReady, id, router]);

  if (state.phase === 'not-found') return <NotFoundState />;

  if (!inspection) {
    if (state.phase === 'error') return <PollError onRetry={retry} />;
    return (
      <div className="flex items-center gap-2 text-body text-text-secondary" role="status">
        <Spinner />
        검사 상태를 불러오는 중입니다.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <Summary inspection={inspection} />
      {state.phase === 'error' ? <PollError onRetry={retry} /> : null}
      <StepList steps={buildStepViews(inspection)} />
      {inspection.status === 'failed' ? (
        <FailedActions inspection={inspection} />
      ) : reportReady ? (
        <p className="text-body-sm text-text-secondary">
          결과 화면으로 이동합니다.{' '}
          <Link href={`/report/${encodeURIComponent(id)}`} replace className="font-medium text-accent hover:underline">
            바로 이동
          </Link>
        </p>
      ) : (
        <p className="text-body-sm text-text-secondary">검사 결과가 저장되면 결과 화면으로 이동합니다.</p>
      )}
    </div>
  );
}

function headline(inspection: Inspection): string {
  switch (inspection.status) {
    case 'pending':
      return '검사를 기다리는 중입니다';
    case 'running':
      return '웹사이트를 검사하는 중입니다';
    case 'failed':
      return '검사에 실패했습니다';
    default:
      return '검사 결과가 준비되었습니다';
  }
}

function Summary({ inspection }: { inspection: Inspection }) {
  const currentStep = inspection.status === 'running' && isInspectionStep(inspection.step) ? STEP_LABELS[inspection.step] : null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="progress-title">
      {/* 상태 변화만 읽히게 한다. 경과 시간은 매초 바뀌므로 live region 밖에 둔다 */}
      <div aria-live="polite" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={inspection.status} />
          {currentStep ? <span className="text-body-sm text-text-secondary">{currentStep}</span> : null}
        </div>
        <h1 id="progress-title" className="text-h1 font-semibold">
          {headline(inspection)}
        </h1>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-sm">
        <dt className="text-text-secondary">검사 대상</dt>
        <dd className="min-w-0 font-mono text-code wrap-anywhere text-text-primary">{inspection.url}</dd>
        {inspection.finalUrl && inspection.finalUrl !== inspection.url ? (
          <>
            <dt className="text-text-secondary">최종 URL</dt>
            <dd className="min-w-0 font-mono text-code wrap-anywhere text-text-primary">{inspection.finalUrl}</dd>
          </>
        ) : null}
        <dt className="text-text-secondary">경과 시간</dt>
        <dd>
          <Elapsed inspection={inspection} />
        </dd>
      </dl>
    </section>
  );
}

function Elapsed({ inspection }: { inspection: Inspection }) {
  const { startIso, endIso } = elapsedRange(inspection);
  const now = useNow(endIso === null);
  const start = parseIsoMs(startIso);
  const end = parseIsoMs(endIso ?? undefined) ?? now;
  if (start === null) return <span className="text-text-tertiary">-</span>;
  return <span className="font-mono text-code tabular-nums">{formatElapsed(end - start)}</span>;
}

function PollError({ onRetry }: { onRetry: () => void }) {
  return (
    <Notice tone="error" title="상태를 불러오지 못했습니다">
      <div className="flex flex-col items-start gap-2">
        <span>네트워크 연결을 확인한 뒤 다시 불러와 주세요. 검사는 서버에서 계속 진행됩니다.</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          다시 불러오기
        </Button>
      </div>
    </Notice>
  );
}

function FailedActions({ inspection }: { inspection: Inspection }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const error = inspection.error;
  const detail = error ? errorDetail(error) : null;

  async function retryInspection() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setRetryError(null);
    const result = await createInspection(inspection.url);
    if (result.ok) {
      router.push(`/inspections/${encodeURIComponent(result.id)}`);
      return;
    }
    inFlight.current = false;
    setSubmitting(false);
    setRetryError(requestErrorMessage(result.code));
  }

  return (
    <section className="flex flex-col gap-4" aria-label="실패 안내">
      <Notice tone="error" title={error ? ERROR_MESSAGES[error.code] : ERROR_MESSAGES.INTERNAL_ERROR}>
        <div className="flex flex-col gap-1">
          {detail ? <span className="wrap-anywhere">{detail}</span> : null}
          {error ? <code className="font-mono text-caption">{error.code}</code> : null}
        </div>
      </Notice>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={retryInspection} loading={submitting} className="min-h-11 w-full sm:w-auto">
          다시 검사
        </Button>
        <Link href="/" className={buttonClassName('secondary', 'md', 'min-h-11 w-full sm:w-auto')}>
          홈으로
        </Link>
      </div>
      {retryError ? (
        <p role="alert" className="text-body-sm text-error-text">
          {retryError}
        </p>
      ) : null}
    </section>
  );
}
