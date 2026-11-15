import 'server-only';

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectionSchema } from '@/server/store/schemas';
import type { Inspection } from '@/types/inspection';

// Before/After 사례 리포트(T14). public/showcase/{name}/inspection.json을 읽는다.
// 공유 리포트는 7일 뒤 만료되므로(PRD 8.1.4) 저장소에 정적 파일로 보관한다. 파일은 pnpm import-sample --out public/showcase/{name}로만 바꾼다.
// /report/before, /report/after, /showcase는 빌드할 때 정적으로 만들어지므로 public/ 파일을 함수 번들에 넣지 않아도 된다.

export const SHOWCASE_NAMES = ['before', 'after'] as const;
export type ShowcaseName = (typeof SHOWCASE_NAMES)[number];

export function isShowcaseName(value: string): value is ShowcaseName {
  return (SHOWCASE_NAMES as readonly string[]).includes(value);
}

export function showcaseFile(name: ShowcaseName, root: string = process.cwd()): string {
  return path.join(root, 'public', 'showcase', name, 'inspection.json');
}

/**
 * 보관된 사례 문서. 파일이 없으면 null(페이지는 404).
 * 파일이 있는데 스키마에 맞지 않으면 예외를 던져 빌드가 실패하게 한다(샘플 리포트와 같은 방식).
 */
export function loadShowcase(name: ShowcaseName, root?: string): Inspection | null {
  const file = showcaseFile(name, root);
  if (!existsSync(file)) return null;
  return inspectionSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/** 파일이 있는 사례 이름 (generateStaticParams) */
export function availableShowcases(root?: string): ShowcaseName[] {
  return SHOWCASE_NAMES.filter((name) => existsSync(showcaseFile(name, root)));
}
