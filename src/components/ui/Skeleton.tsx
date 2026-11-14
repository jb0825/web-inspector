import { cn } from '@/lib/utils';

// WIREFRAME 11.2: 결과 첫 조회의 화면 골격. reduced motion에서는 globals.css가 pulse를 멈춘다
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-background-secondary', className)} />;
}
