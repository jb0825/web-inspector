import { z } from 'zod';
import type { CreateInspectionRequest } from '@/types/api';

// DOMAIN_MODEL 5.1: POST /api/inspections 요청 본문. 클라이언트(형식 확인)와 서버(본문 파싱)가 함께 쓴다.
// 허용 여부(프로토콜, 계정 정보, 금지 대상)의 실제 판정은 src/server/security/url.ts다(AGENTS.md 3.1).

/** PRD 8.3: URL 최대 2,048자 */
export const INSPECTION_URL_MAX_LENGTH = 2048;

export const inspectionRequestSchema = z.strictObject({
  url: z.string().trim().min(1).max(INSPECTION_URL_MAX_LENGTH),
}) satisfies z.ZodType<CreateInspectionRequest>;
