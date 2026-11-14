import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 6.3: 높이 20px, label 타입, radius-sm, 좌우 6px, -tint 배경 + -text 글자
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-tint text-neutral-text',
  info: 'bg-info-tint text-info-text',
  success: 'bg-success-tint text-success-text',
  warning: 'bg-warning-tint text-warning-text',
  error: 'bg-error-tint text-error-text',
};

export function Badge({ tone, icon, children, className }: { tone: BadgeTone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-label font-medium whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
