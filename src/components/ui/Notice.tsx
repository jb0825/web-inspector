import { AlertTriangle, Info, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 6.6. 여러 항목은 Notice 하나 안에 목록으로 넣는다
export type NoticeTone = 'info' | 'warning' | 'error';

const TONE: Record<NoticeTone, { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: 'bg-info-tint', icon: 'text-info-solid', Icon: Info },
  warning: { box: 'bg-warning-tint', icon: 'text-warning-solid', Icon: AlertTriangle },
  error: { box: 'bg-error-tint', icon: 'text-error-solid', Icon: XCircle },
};

interface NoticeProps {
  tone: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Notice({ tone, title, children, className }: NoticeProps) {
  const { box, icon, Icon } = TONE[tone];
  return (
    <div className={cn('flex gap-2 rounded-lg px-4 py-3 text-body text-text-primary', box, className)}>
      <Icon aria-hidden size={16} strokeWidth={1.75} className={cn('mt-0.5 shrink-0', icon)} />
      <div className="flex min-w-0 flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-body-sm text-text-secondary">{children}</div> : null}
      </div>
    </div>
  );
}
