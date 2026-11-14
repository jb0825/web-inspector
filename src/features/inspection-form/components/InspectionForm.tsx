'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createInspection } from '@/components/api/inspections';
import { requestErrorMessage } from '@/components/inspection/labels';
import { takeRetryUrl } from '@/components/inspection/retryUrl';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import { normalizeUrlInput, URL_INPUT_MESSAGES } from '../normalizeUrl';

// PRD 7.1, WIREFRAME 3장. 형식 확인 → POST /api/inspections → 202면 진행 화면으로 이동

export function InspectionForm() {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 상태 갱신 전에 Enter를 두 번 눌러도 요청이 한 번만 나가게 한다
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // WIREFRAME 3.4: 다시 시도로 들어오면 이전 URL을 채운다. sessionStorage는 브라우저에만 있으므로 마운트 뒤에 읽는다
  useEffect(() => {
    const retryUrl = takeRetryUrl();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버 렌더링 결과와 맞추려고 마운트 뒤 한 번만 채운다
    if (retryUrl) setValue(retryUrl);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;

    const normalized = normalizeUrlInput(value);
    if (!normalized.ok) {
      setError(URL_INPUT_MESSAGES[normalized.error]);
      inputRef.current?.focus();
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const result = await createInspection(normalized.url);
    if (result.ok) {
      // 이동이 끝날 때까지 버튼을 로딩 상태로 둔다
      router.push(`/inspections/${encodeURIComponent(result.id)}`);
      return;
    }
    inFlight.current = false;
    setSubmitting(false);
    setError(requestErrorMessage(result.code));
    inputRef.current?.focus();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2">
      <label htmlFor={inputId} className="sr-only">
        검사할 웹사이트 URL
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          ref={inputRef}
          id={inputId}
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://example.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          disabled={submitting}
          invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          className="sm:flex-1"
        />
        <Button type="submit" size="lg" loading={submitting} className="w-full sm:w-auto">
          검사 시작
        </Button>
      </div>
      <p id={errorId} role="alert" className={cn('min-h-5 text-body-sm text-error-text', !error && 'sr-only')}>
        {error}
      </p>
    </form>
  );
}
