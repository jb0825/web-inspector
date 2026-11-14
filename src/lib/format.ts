/** 경과 시간 표기 (mm:ss, 1시간 이상은 h:mm:ss). 음수(시계 차이)는 0으로 본다 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** ISO 시각 문자열을 epoch ms로. 형식이 잘못되면 null */
export function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** 정수 px 표기 (DETECTION_RULES 8.1과 같은 Math.round). 천 단위 구분 기호를 붙인다 */
export function formatPx(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** 개수 표기 (천 단위 구분) */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Confidence 표기. 1.0, 0.4처럼 소수 첫째 자리까지, 더 정밀한 값은 둘째 자리까지 */
export function formatConfidence(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded * 10) ? rounded.toFixed(1) : rounded.toFixed(2);
}

/** 검사 시각을 사용자 시간대와 로캘로 표시한다. 서버·클라이언트 결과가 다를 수 있으므로 브라우저에서만 호출한다 */
export function formatDateTime(iso: string, options: { locale?: string; timeZone?: string } = {}): string | null {
  const ms = parseIsoMs(iso);
  if (ms === null) return null;
  return new Intl.DateTimeFormat(options.locale ?? 'ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: options.timeZone,
  }).format(ms);
}
