import type { NextRequest } from 'next/server';
import { handleCancelInspection } from '@/server/http/inspections';
import { logEvent } from '@/server/log';
import { getInspectionStore } from '@/server/store/redis';

// POST /api/inspections/:id/cancel (API_SPEC 6A장). 검사 ID를 아는 사람(진행 화면, 공유 링크)이 중지할 수 있다
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: NextRequest, context: RouteContext<'/api/inspections/[id]/cancel'>): Promise<Response> {
  const { id } = await context.params;
  return handleCancelInspection(id, { store: getInspectionStore(), now: Date.now, log: logEvent });
}
