'use client';

import { RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { stashRetryUrl } from '@/components/inspection/retryUrl';
import { StatusBadge } from '@/components/inspection/StatusBadge';
import { Button } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/CopyButton';
import { formatDateTime } from '@/lib/format';
import type { Inspection } from '@/types/inspection';
import type { ReportVariant } from './ReportView';

// WIREFRAME 5.3

const HEADINGS: Record<ReportVariant, string> = { live: '검사 결과', sample: '샘플 리포트', showcase: '사례 리포트' };

/** 페이지에서 가져온 URL은 http/https일 때만 링크로 만든다(AGENTS.md 8장) */
export function safeExternalHref(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function ExternalUrl({ value }: { value: string }) {
  const href = safeExternalHref(value);
  const className = 'font-mono text-code wrap-anywhere';
  if (!href) return <span className={className}>{value}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={`${className} text-accent hover:underline`}>
      {value}
    </a>
  );
}

const subscribeNothing = () => () => {};

/** 검사 시각은 사용자 시간대로 표시한다. 서버 렌더링에서는 비워 두어 hydration 결과가 달라지지 않게 한다 */
function LocalDateTime({ iso }: { iso: string }) {
  const isClient = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const text = isClient ? formatDateTime(iso, { locale: navigator.language }) : null;
  return (
    <time dateTime={iso} className="tabular-nums">
      {text ?? ''}
    </time>
  );
}

export function ReportHeader({ inspection, variant }: { inspection: Inspection; variant: ReportVariant }) {
  const router = useRouter();
  const redirected = inspection.finalUrl !== undefined && inspection.finalUrl !== inspection.url;
  const desktop = inspection.viewports.desktop;
  const mobile = inspection.viewports.mobile;

  // USER_FLOW 10.3: 다시 검사는 Home으로 이동하면서 같은 URL을 입력창에 채운다
  function reinspect() {
    stashRetryUrl(inspection.url);
    router.push('/');
  }

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-h1 font-semibold">{HEADINGS[variant]}</h1>
          {/* 분석이 끝나 상태가 바뀌면 읽어 준다 */}
          <span aria-live="polite">
            <StatusBadge status={inspection.status} />
          </span>
        </div>
        {variant === 'live' ? (
          <div className="flex flex-wrap items-start gap-2">
            <CopyButton
              getText={() => `${window.location.origin}/report/${encodeURIComponent(inspection.id)}`}
              label="링크 복사"
              copiedLabel="링크가 복사되었습니다"
              announcement="링크가 복사되었습니다"
              failureMessage="링크를 복사하지 못했습니다. 주소창의 URL을 직접 복사해 주세요."
              className="min-h-11 sm:min-h-8"
            />
            <Button variant="secondary" size="sm" onClick={reinspect} className="min-h-11 sm:min-h-8">
              <RotateCcw aria-hidden size={14} strokeWidth={1.75} />
              다시 검사
            </Button>
          </div>
        ) : null}
      </div>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-body-sm">
        <dt className="text-text-secondary">검사 URL</dt>
        <dd className="min-w-0">
          <ExternalUrl value={inspection.url} />
        </dd>
        {redirected && inspection.finalUrl ? (
          <>
            <dt className="text-text-secondary">최종 URL</dt>
            <dd className="min-w-0">
              <ExternalUrl value={inspection.finalUrl} />
            </dd>
          </>
        ) : null}
        <dt className="text-text-secondary">검사 시각</dt>
        <dd className="text-text-primary">
          <LocalDateTime iso={inspection.createdAt} />
          <span className="text-text-secondary">
            {' · '}
            <span className="font-mono tabular-nums">
              Desktop {desktop?.width ?? 1440} / Mobile {mobile?.width ?? 390}
            </span>
          </span>
        </dd>
      </dl>
    </header>
  );
}
