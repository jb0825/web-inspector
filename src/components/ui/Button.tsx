import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

// DESIGN_GUIDE 6.1
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-background hover:bg-accent-hover disabled:bg-background-tertiary disabled:text-text-disabled',
  secondary: 'bg-background-secondary text-text-primary hover:bg-background-tertiary disabled:text-text-disabled',
  tertiary: 'bg-transparent text-accent hover:bg-accent-tint disabled:text-text-disabled',
};

// 터치 대상 44px(DESIGN_GUIDE 12.4)는 sm에서 min-h로 보완하지 않는다. sm은 보조 영역에만 쓴다
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-10 px-4 text-body',
  lg: 'h-12 px-4 text-body-lg',
};

/** Link 등 button이 아닌 요소에 같은 모양을 입힐 때 쓴다 */
export function buttonClassName(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap',
    'transition-colors duration-(--duration-fast) ease-standard',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-solid',
    'disabled:cursor-not-allowed',
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 라벨은 유지하고 스피너를 붙인다. 로딩 중에는 비활성 */
  loading?: boolean;
}

export function Button({ variant, size, loading = false, disabled, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClassName(variant, size, className)}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
