import { z } from 'zod';
import type * as T from '@/types/inspection';

// DOMAIN_MODEL 5.1: 클라이언트와 서버가 함께 쓰는 enum. 값의 기준은 src/types/inspection.ts(PRD 8.2)다.
// 값 객체가 필요하면 `IssueType['text-overflow']`처럼 아래 export를 쓴다.

export const prioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']) satisfies z.ZodType<T.Priority>;

export const issueTypeSchema = z.enum([
  'viewport-overflow',
  'text-overflow',
  'element-overlap',
]) satisfies z.ZodType<T.IssueType>;

export const viewportTagSchema = z.enum(['mobile-only', 'desktop-only', 'both']) satisfies z.ZodType<T.ViewportTag>;

export const inspectionStatusSchema = z.enum([
  'pending',
  'running',
  'analyzing',
  'completed',
  'partial',
  'failed',
]) satisfies z.ZodType<T.InspectionStatus>;

export const errorCodeSchema = z.enum([
  'INVALID_URL',
  'BLOCKED_TARGET',
  'TOO_MANY_INSPECTIONS',
  'NAVIGATION_TIMEOUT',
  'NAVIGATION_FAILED',
  'HTTP_ERROR',
  'BROWSER_CRASH',
  'DETECTION_FAILED',
  'TIME_BUDGET_EXCEEDED',
  'STORAGE_FAILED',
  'AI_FAILED',
  'INTERNAL_ERROR',
]) satisfies z.ZodType<T.ErrorCode>;

// satisfies는 스키마 값이 타입의 부분집합인지만 본다. 값이 빠지지 않았는지도 컴파일 시점에 확인한다.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type EnumsMatchTypes = [
  Assert<Same<z.output<typeof prioritySchema>, T.Priority>>,
  Assert<Same<z.output<typeof issueTypeSchema>, T.IssueType>>,
  Assert<Same<z.output<typeof viewportTagSchema>, T.ViewportTag>>,
  Assert<Same<z.output<typeof inspectionStatusSchema>, T.InspectionStatus>>,
  Assert<Same<z.output<typeof errorCodeSchema>, T.ErrorCode>>,
];

export const Priority = prioritySchema.enum;
export const IssueType = issueTypeSchema.enum;
export const ViewportTag = viewportTagSchema.enum;
export const InspectionStatus = inspectionStatusSchema.enum;
export const ErrorCode = errorCodeSchema.enum;
