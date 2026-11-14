import type { ReactNode } from 'react';
import { CodeBlock } from '@/components/ui/MarkdownText';
import type { SourceHints as SourceHintsData } from '@/types/inspection';

// WIREFRAME 6.5: 값이 없는 항목은 줄째로 생략한다. HTML은 코드 블록에 문자열로만 표시한다(AGENTS.md 8장)
export function SourceHints({ hints }: { hints: SourceHintsData }) {
  const attributes = Object.entries(hints.stableAttributes);
  const rows: { key: string; label: string; value: ReactNode }[] = [];
  if (hints.landmark) rows.push({ key: 'section', label: 'Section', value: <span className="wrap-anywhere">{hints.landmark}</span> });
  if (hints.textSnippet) rows.push({ key: 'text', label: 'Text', value: <span className="wrap-anywhere">&ldquo;{hints.textSnippet}&rdquo;</span> });
  if (attributes.length > 0)
    rows.push({
      key: 'attributes',
      label: 'Attributes',
      value: (
        <ul className="flex flex-col gap-0.5 font-mono text-code">
          {attributes.map(([name, value]) => (
            <li key={name} className="wrap-anywhere">
              {name}=&quot;{value}&quot;
            </li>
          ))}
        </ul>
      ),
    });
  if (hints.htmlSnippet) rows.push({ key: 'html', label: 'HTML', value: <CodeBlock code={hints.htmlSnippet} /> });
  if (hints.ancestorPath) rows.push({ key: 'path', label: 'Path', value: <span className="font-mono text-code wrap-anywhere">{hints.ancestorPath}</span> });
  if (rows.length === 0) return <p className="text-body-sm text-text-secondary">수집한 소스 단서가 없습니다.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-body-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.key} className="contents">
          <dt className="text-text-secondary">{row.label}</dt>
          <dd className="min-w-0 text-text-primary">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
