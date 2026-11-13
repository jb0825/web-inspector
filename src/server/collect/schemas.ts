import 'server-only';
import { z } from 'zod';
import type { Rect, SourceHints } from '@/types/inspection';
import type { CollectedElement, InPageResult } from './types';

// page.evaluate 반환값 검증(DOMAIN_MODEL 5.1, 7장). 브라우저에서 넘어온 값도 외부 입력이다.
// 타입은 types.ts가 기준이고, 스키마는 satisfies로 맞춘다(DOMAIN_MODEL 5.3).

const rectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
}) satisfies z.ZodType<Rect>;

const nonNegative = z.number().nonnegative();
const index = z.number().int().nonnegative();

const sourceHintsSchema = z.strictObject({
  textSnippet: z.string().min(1).optional(),
  landmark: z.string().min(1).optional(),
  htmlSnippet: z.string(),
  stableAttributes: z.record(z.string(), z.string()),
  ancestorPath: z.string(),
}) satisfies z.ZodType<SourceHints>;

const elementSchema = z.strictObject({
  index,
  parentIndex: index.nullable(),
  ancestorIndices: z.array(index),
  tag: z.string().min(1),
  rect: rectSchema,
  paddingBox: rectSchema,
  textRects: z.array(rectSchema),
  scrollWidth: nonNegative,
  clientWidth: nonNegative,
  scrollHeight: nonNegative,
  clientHeight: nonNegative,
  style: z.strictObject({
    position: z.string(),
    overflowX: z.string(),
    overflowY: z.string(),
    textOverflow: z.string(),
    webkitLineClamp: z.string(),
    whiteSpace: z.string(),
    lineHeight: z.string(),
    backgroundColor: z.string(),
    backgroundImage: z.string(),
    borderWidthSum: nonNegative,
    paddingSum: nonNegative,
  }),
  flags: z.strictObject({
    interactive: z.boolean(),
    heading: z.boolean(),
    inNav: z.boolean(),
    fixedOrSticky: z.boolean(),
    fixedRoot: z.boolean(),
  }),
  computedStyle: z.record(z.string(), z.string()),
  selector: z.string().min(1),
  sourceHints: sourceHintsSchema,
  identity: z.strictObject({
    id: z.string().min(1).optional(),
    testId: z.string().optional(),
  }),
}) satisfies z.ZodType<CollectedElement>;

export const inPageResultSchema = z
  .strictObject({
    innerWidth: nonNegative,
    innerHeight: nonNegative,
    layoutWidth: nonNegative,
    documentScrollWidth: nonNegative,
    documentHeight: nonNegative,
    hasMetaViewport: z.boolean(),
    rootOverflowX: z.strictObject({ html: z.string(), body: z.string() }),
    hasCanvas: z.boolean(),
    totalCandidates: z.number().int().nonnegative(),
    elements: z.array(elementSchema),
  })
  .refine((value) => value.elements.length <= value.totalCandidates, {
    message: 'elements.length must not exceed totalCandidates',
  })
  .refine((value) => value.elements.every((el, i) => i === 0 || value.elements[i - 1].index < el.index), {
    message: 'elements must be in document order',
  }) satisfies z.ZodType<InPageResult>;
