import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 6.3: 높이 20px, label 타입, radius-sm, 좌우 6px, -tint 배경 + -text 글자
/** p0~p3는 Priority 색 토큰(DESIGN_GUIDE 2.5). 값 → 색 변환은 components/inspection이 한다 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'p0' | 'p1' | 'p2' | 'p3';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-tint text-neutral-text',
  info: 'bg-info-tint text-info-text',
  success: 'bg-success-tint text-success-text',
  warning: 'bg-warning-tint text-warning-text',
  error: 'bg-error-tint text-error-text',
  p0: 'bg-p0-tint text-p0-text',
  p1: 'bg-p1-tint text-p1-text',
  p2: 'bg-p2-tint text-p2-text',
  p3: 'bg-p3-tint text-p3-text',
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
