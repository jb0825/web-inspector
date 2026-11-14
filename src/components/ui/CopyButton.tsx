'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './Button';

// DESIGN_GUIDE 10.5: 복사하면 2초 동안 "복사됨". 결과는 live region으로 알린다(WIREFRAME 11.4)
export const COPIED_DURATION_MS = 2000;

/** Clipboard API로 복사한다. 권한이 없거나 지원하지 않으면 false */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  /** 누른 시점의 내용을 돌려준다 (프롬프트는 textarea의 현재 값) */
  getText: () => string;
  label?: string;
  copiedLabel?: string;
  /** live region으로 읽을 문구 */
  announcement?: string;
  failureMessage?: string;
  /** 복사에 실패했을 때 (예: textarea 전체 선택) */
  onFailure?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** 아이콘만 보이는 버튼의 접근 가능한 이름 */
  ariaLabel?: string;
  iconOnly?: boolean;
}

export function CopyButton({
  getText,
  label = '복사',
  copiedLabel = '복사됨',
  announcement = '복사되었습니다',
  failureMessage = '복사하지 못했습니다. 직접 복사해 주세요.',
  onFailure,
  variant = 'secondary',
  size = 'sm',
  className,
  ariaLabel,
  iconOnly = false,
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function onClick() {
    const ok = await copyText(getText());
    if (timer.current) clearTimeout(timer.current);
    if (ok) {
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), COPIED_DURATION_MS);
    } else {
      setState('failed');
      onFailure?.();
    }
  }

  const copied = state === 'copied';
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={iconOnly ? (ariaLabel ?? label) : undefined}
        className={buttonClassName(variant, size, cn(iconOnly && 'px-2', className))}
      >
        {copied ? <Check aria-hidden size={14} strokeWidth={1.75} /> : <Copy aria-hidden size={14} strokeWidth={1.75} />}
        {iconOnly ? null : copied ? copiedLabel : label}
      </button>
      <span aria-live="polite" className={cn('text-caption', state === 'failed' ? 'text-error-text' : 'sr-only')}>
        {copied ? announcement : state === 'failed' ? failureMessage : ''}
      </span>
    </span>
  );
}
