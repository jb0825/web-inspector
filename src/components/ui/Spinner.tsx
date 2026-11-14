import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 7.2: 진행 중 아이콘은 Loader2. reduced motion에서는 globals.css가 회전을 멈춘다
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 aria-hidden size={size} strokeWidth={1.75} className={cn('shrink-0 animate-spin', className)} />;
}
