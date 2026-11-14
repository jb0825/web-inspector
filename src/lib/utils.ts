/** 조건부 className 결합. 외부 의존성(clsx 등)을 두지 않는다 */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}
