import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

// DESIGN_GUIDE 6.2. 오류 메시지는 호출한 쪽이 렌더링하고 aria-describedby로 연결한다
interface InputProps extends ComponentProps<'input'> {
  invalid?: boolean;
}

export function Input({ invalid = false, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-12 w-full min-w-0 rounded-md border bg-background px-3 text-body-lg text-text-primary',
        'placeholder:text-text-tertiary',
        'transition-colors duration-(--duration-fast) ease-standard',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid',
        'disabled:bg-background-secondary disabled:text-text-disabled',
        invalid ? 'border-error-solid' : 'border-border-strong focus-visible:border-accent-solid',
        className,
      )}
      {...rest}
    />
  );
}
