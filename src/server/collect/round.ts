import { MEASURE_DECIMALS } from '@/server/detect/constants';

/**
 * PRD 5.3.1: 측정값을 소수 둘째 자리로 반올림한다. -0은 0으로 둔다(JSON 비교를 단순하게 하기 위해).
 * 수집(collect.ts)과 판정(detect/)이 함께 쓰는 순수 함수라 브라우저 코드와 분리해 둔다.
 */
export function roundMeasure(value: number, decimals: number = MEASURE_DECIMALS): number {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}
