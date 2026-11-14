import { splitFencedBlocks, splitInlineCode } from '@/lib/markdownLite';
import { cn } from '@/lib/utils';

// 서버가 만든 Markdown 문자열을 텍스트로만 보여준다. HTML로 해석하지 않는다(AGENTS.md 8장)

export function InlineCodeText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('wrap-anywhere', className)}>
      {splitInlineCode(text).map((segment, index) =>
        segment.kind === 'code' ? (
          <code key={index} className="rounded-sm bg-background-tertiary px-1 font-mono text-code">
            {segment.text}
          </code>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </span>
  );
}

export function CodeBlock({ code, className }: { code: string; className?: string }) {
  // DESIGN_GUIDE 6.12: pre-wrap으로 가로 스크롤을 만들지 않는다
  return (
    <pre className={cn('rounded-md bg-background-secondary p-3 font-mono text-code whitespace-pre-wrap wrap-anywhere text-text-primary', className)}>
      <code>{code}</code>
    </pre>
  );
}

export function MarkdownText({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {splitFencedBlocks(source).map((block, index) =>
        block.kind === 'code' ? (
          <CodeBlock key={index} code={block.code} />
        ) : (
          <p key={index} className="whitespace-pre-line">
            <InlineCodeText text={block.text} />
          </p>
        ),
      )}
    </div>
  );
}
