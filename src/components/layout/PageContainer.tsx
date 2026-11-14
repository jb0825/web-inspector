import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 4.3: Home·Progress·결과 없음 720px, 결과 화면 1440px. 좌우 여백 16 / 24 / 32px
export function PageContainer({ size = 'narrow', className, children }: { size?: 'narrow' | 'wide'; className?: string; children: ReactNode }) {
  return (
    <main
      className={cn(
        'mx-auto w-full flex-1 px-4 sm:px-6 lg:px-8',
        size === 'narrow' ? 'max-w-narrow' : 'max-w-wide',
        className,
      )}
    >
      {children}
    </main>
  );
}
