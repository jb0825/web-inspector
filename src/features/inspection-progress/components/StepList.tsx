import { Check, Circle, X } from 'lucide-react';
import { errorDetail, ERROR_MESSAGES } from '@/components/inspection/labels';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/utils';
import type { StepState, StepView } from '../steps';

// WIREFRAME 4.4: 아이콘만으로 상태를 구분하지 않는다. 스크린리더용 상태 텍스트를 함께 둔다
const STATE_TEXT: Record<StepState, string> = {
  done: '완료',
  current: '진행 중',
  pending: '대기',
  failed: '실패',
};

function StepIcon({ state }: { state: StepState }) {
  const common = { 'aria-hidden': true, size: 16, strokeWidth: 1.75 } as const;
  switch (state) {
    case 'done':
      return <Check {...common} className="shrink-0 text-success-solid" />;
    case 'current':
      return <Spinner className="text-info-solid" />;
    case 'failed':
      return <X {...common} className="shrink-0 text-error-solid" />;
    default:
      return <Circle {...common} className="shrink-0 text-text-disabled" />;
  }
}

export function StepList({ steps }: { steps: StepView[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step) => {
        const detail = step.error ? errorDetail(step.error) : null;
        return (
          <li key={step.step} className="flex gap-2 py-2" aria-current={step.state === 'current' ? 'step' : undefined}>
            <span className="mt-0.5">
              <StepIcon state={step.state} />
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span
                className={cn(
                  'text-body',
                  step.state === 'pending' && 'text-text-tertiary',
                  step.state === 'current' && 'font-medium text-text-primary',
                  step.state === 'done' && 'text-text-secondary',
                  step.state === 'failed' && 'font-medium text-error-text',
                )}
              >
                {step.label}
                <span className="sr-only"> ({STATE_TEXT[step.state]})</span>
              </span>
              {step.error ? (
                <span className="flex flex-col gap-0.5 text-body-sm text-text-secondary">
                  <span>{ERROR_MESSAGES[step.error.code]}</span>
                  {detail ? <span className="wrap-anywhere">{detail}</span> : null}
                  <code className="font-mono text-caption text-text-tertiary">{step.error.code}</code>
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
