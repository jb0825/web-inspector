'use client';

import { useId, useRef } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';

// WIREFRAME 7.6, DESIGN_GUIDE 6.12. DevTask.prompt를 그대로 채운다. 편집할 수 있지만 저장하지 않는다.
// 호출한 쪽이 key={task.id}로 그려서, 다른 태스크로 이동하면 원래 내용으로 돌아간다.
export function PromptEditor({ prompt }: { prompt: string }) {
  const id = useId();
  const noteId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <label htmlFor={id} className="pt-1.5 text-h3 font-semibold">
          프롬프트
        </label>
        <CopyButton
          // 복사는 textarea의 현재 내용을 쓴다
          getText={() => ref.current?.value ?? prompt}
          variant="primary"
          label="프롬프트 복사"
          announcement="프롬프트가 복사되었습니다"
          failureMessage="직접 복사해 주세요"
          onFailure={() => {
            ref.current?.focus();
            ref.current?.select();
          }}
          className="min-h-11 sm:min-h-8"
        />
      </div>
      <textarea
        ref={ref}
        id={id}
        defaultValue={prompt}
        spellCheck={false}
        aria-describedby={noteId}
        className="h-60 w-full resize-y rounded-md border border-border bg-background-secondary p-3 font-mono text-code whitespace-pre-wrap text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid sm:h-80"
      />
      <p id={noteId} className="text-caption text-text-secondary">
        수정한 내용은 저장되지 않습니다.
      </p>
    </div>
  );
}
