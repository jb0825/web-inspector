import { Notice } from '@/components/ui/Notice';
import type { ScopeNotice as ScopeNoticeItem } from '../logic/scope';

// WIREFRAME 5.4, DESIGN_GUIDE 6.6: 여러 항목은 Notice 하나 안에 목록으로 넣는다. 항목이 없으면 영역 전체를 숨긴다
export function ScopeNotice({ notices }: { notices: readonly ScopeNoticeItem[] }) {
  if (notices.length === 0) return null;
  return (
    <section aria-label="검사 범위 안내">
      <Notice tone="warning" title="검사 범위 안내">
        <ul className="flex list-disc flex-col gap-1 pl-4 text-text-primary">
          {notices.map((notice, index) => (
            <li key={`${notice.kind}-${notice.viewport ?? ''}-${index}`} className="wrap-anywhere">
              {notice.text}
            </li>
          ))}
        </ul>
      </Notice>
    </section>
  );
}
