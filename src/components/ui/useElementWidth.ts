'use client';

import { useEffect, useState, type RefObject } from 'react';

/** 요소의 콘텐츠 너비(px). 처음 측정 전에는 0이다 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const update = () => setWidth(node.clientWidth);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
