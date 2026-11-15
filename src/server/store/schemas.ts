import 'server-only';
import { z } from 'zod';
import { errorCodeSchema, inspectionStatusSchema, issueTypeSchema, prioritySchema, viewportTagSchema } from '@/schemas/enums';
import type * as T from '@/types/inspection';

// DOMAIN_MODEL 5.1, 6.1: Redis에서 읽은 Inspection 문서 전체를 검증한다. 타입은 src/types/inspection.ts가 기준이고
// 스키마는 satisfies로 맞춘다(DOMAIN_MODEL 5.3). 저장된 문서에 모르는 필드가 있으면 거부한다(strictObject).

/** PRD 6.2.3 단계. Inspection.step(string)에 들어가는 값 */
export const INSPECTION_STEPS = [
  'initializing_browser',
  'rendering_desktop',
  'rendering_mobile',
  'detecting_issues',
  'saving_results',
  'analyzing_issues',
  'generating_tasks',
] as const;
export type InspectionStep = (typeof INSPECTION_STEPS)[number];

const viewportSchema = z.enum(['desktop', 'mobile']) satisfies z.ZodType<T.Viewport>;
const isoDate = z.iso.datetime();
const numberRecord = z.record(z.string(), z.number());
const stringRecord = z.record(z.string(), z.string());

const errorInfoSchema = z.strictObject({
  code: errorCodeSchema,
  message: z.string(),
}) satisfies z.ZodType<T.InspectionErrorInfo>;

const rectSchema = z.strictObject({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
}) satisfies z.ZodType<T.Rect>;

const intRectSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
}) satisfies z.ZodType<T.Rect>;

const layoutBlockSchema = z.strictObject({
  kind: z.enum([
    'header',
    'nav',
    'main',
    'section',
    'footer',
    'aside',
    'form',
    'heading',
    'text',
    'image',
    'button',
    'input',
    'canvas',
    'video',
    'iframe',
    'card',
  ]),
  rect: intRectSchema,
  label: z.string().min(1).max(40).optional(),
  depth: z.number().int().nonnegative(),
}) satisfies z.ZodType<T.LayoutBlock>;

// 범위(블록 수 상한, 문서 범위 안)는 불변 조건 V-4가 본다
const layoutMapSchema = z.strictObject({
  width: z.number().int().nonnegative(),
  scrollWidth: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  truncated: z.boolean(),
  blocks: z.array(layoutBlockSchema),
}) satisfies z.ZodType<T.LayoutMap>;

const viewportResultSchema = z.strictObject({
  width: z.number(),
  height: z.number(),
  innerWidth: z.number(),
  layoutWidth: z.number(),
  hasMetaViewport: z.boolean(),
  documentHeight: z.number(),
  // null: 스크린샷만 실패한 viewport (SCREENSHOT_FAILED, PRD 5.2.4). 세 값이 함께 null인지는 불변 조건 V-2가 본다
  screenshotUrl: z.string().min(1).nullable(),
  screenshotWidth: z.number().int().positive().nullable(),
  screenshotHeight: z.number().int().positive().nullable(),
  screenshotTruncated: z.boolean(),
  elementsInspected: z.number().int().nonnegative(),
  elementsTruncated: z.boolean(),
  hasCanvas: z.boolean(),
  overlaysDetected: z.array(z.string()),
  // 예전 문서에는 없다 (DOMAIN_MODEL V-4)
  layoutMap: layoutMapSchema.optional(),
}) satisfies z.ZodType<T.ViewportResult>;

const relatedElementSchema = z.strictObject({
  role: z.enum(['overlap-target', 'clipping-ancestor', 'bordered-ancestor', 'cause-ancestor']),
  selector: z.string(),
  tag: z.string(),
  boundingBox: rectSchema,
}) satisfies z.ZodType<T.RelatedElement>;

const sourceHintsSchema = z.strictObject({
  textSnippet: z.string().optional(),
  landmark: z.string().optional(),
  htmlSnippet: z.string(),
  stableAttributes: stringRecord,
  ancestorPath: z.string(),
}) satisfies z.ZodType<T.SourceHints>;

const occurrenceSchema = z.strictObject({
  viewport: viewportSchema,
  selector: z.string(),
  boundingBox: rectSchema,
  measured: numberRecord,
  expected: numberRecord,
  delta: numberRecord,
  evidenceText: z.string(),
  relatedElements: z.array(relatedElementSchema),
  cropRect: rectSchema.nullable(),
  computedStyle: stringRecord,
  sourceHints: sourceHintsSchema,
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<T.IssueOccurrence>;

const issueAnalysisSchema = z.strictObject({
  rootCause: z.string(),
  certainty: z.enum(['confirmed', 'likely', 'uncertain']),
  cssProblem: z.string(),
  fixDirection: z.string(),
  suggestedFix: z.string(),
  source: z.enum(['rule', 'ai']),
}) satisfies z.ZodType<NonNullable<T.Issue['analysis']>>;

const issueSchema = z.strictObject({
  id: z.string(),
  type: issueTypeSchema,
  subtype: z.string(),
  title: z.string(),
  viewports: z.array(viewportSchema),
  viewportTag: viewportTagSchema.nullable(),
  selector: z.string(),
  sourceHints: sourceHintsSchema,
  occurrences: z.array(occurrenceSchema),
  relatedIssueIds: z.array(z.string()),
  affectedDescendants: z.number().int().nonnegative().optional(),
  scores: z.strictObject({ S: z.number(), I: z.number(), R: z.number(), score100: z.number() }),
  priority: prioritySchema,
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
  analysis: issueAnalysisSchema.optional(),
  analysisSkippedReason: z.enum(['needs-review', 'limit-exceeded', 'ai-failed']).optional(),
}) satisfies z.ZodType<T.Issue>;

const devTaskSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  titleSource: z.enum(['ai', 'template']),
  description: z.string(),
  priority: prioritySchema,
  viewportTag: viewportTagSchema.nullable(),
  landmark: z.string().optional(),
  issueIds: z.array(z.string()),
  needsReview: z.boolean(),
  acceptanceCriteria: z.array(z.string()),
  prompt: z.string(),
}) satisfies z.ZodType<T.DevTask>;

export const inspectionSchema = z.strictObject({
  id: z.uuid(),
  url: z.string().min(1),
  finalUrl: z.string().min(1).optional(),
  status: inspectionStatusSchema,
  step: z.enum(INSPECTION_STEPS).optional(),
  error: errorInfoSchema.optional(),
  createdAt: isoDate,
  startedAt: isoDate.optional(),
  completedAt: isoDate.optional(),
  updatedAt: isoDate,
  viewports: z.strictObject({ desktop: viewportResultSchema.nullable(), mobile: viewportResultSchema.nullable() }),
  viewportErrors: z.strictObject({ desktop: errorInfoSchema.nullable(), mobile: errorInfoSchema.nullable() }),
  analysis: z.strictObject({
    status: z.enum(['pending', 'running', 'completed', 'failed', 'skipped']),
    analyzedIssueCount: z.number().int().nonnegative(),
    error: errorInfoSchema.optional(),
  }),
  issuesDetected: z.number().int().nonnegative(),
  issuesTruncated: z.boolean(),
  issues: z.array(issueSchema),
  tasks: z.array(devTaskSchema),
}) satisfies z.ZodType<T.Inspection>;
