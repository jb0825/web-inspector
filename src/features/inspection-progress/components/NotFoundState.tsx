import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { buttonClassName } from '@/components/ui/Button';

// WIREFRAME 4.6, USER_FLOW 9.10. /report/[id]의 404에도 같은 화면을 쓴다
export function NotFoundState() {
  return (
    <section className="flex flex-col items-start gap-6" aria-labelledby="not-found-title">
      <div className="flex flex-col gap-2">
        <h1 id="not-found-title" className="text-h1 font-semibold">
          검사 결과를 찾을 수 없습니다
        </h1>
        <p className="text-body-lg text-text-secondary">없는 검사이거나 보관 기간이 지났습니다. 결과는 7일 동안 보관됩니다.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/" className={buttonClassName('secondary', 'md', 'min-h-11')}>
          새 검사
        </Link>
        <Link href="/report/sample" className={buttonClassName('tertiary', 'md', 'min-h-11')}>
          샘플 리포트 보기
          <ChevronRight aria-hidden size={16} strokeWidth={1.75} />
        </Link>
      </div>
    </section>
  );
}
