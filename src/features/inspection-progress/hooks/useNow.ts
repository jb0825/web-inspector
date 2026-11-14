'use client';

import { useEffect, useState } from 'react';

/** 경과 시간 표시용 시계. active일 때만 1초마다 갱신한다 (polling과 무관) */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
