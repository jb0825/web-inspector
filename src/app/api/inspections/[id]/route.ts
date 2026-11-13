import type { NextRequest } from 'next/server';
import { handleGetInspection } from '@/server/http/inspections';
import { logEvent } from '@/server/log';
import { getInspectionStore } from '@/server/store/redis';

// GET /api/inspections/:id (API_SPEC 5장). 응답은 캐시하지 않는다(Cache-Control: no-store)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: RouteContext<'/api/inspections/[id]'>): Promise<Response> {
  const { id } = await context.params;
  return handleGetInspection(id, { store: getInspectionStore(), log: logEvent });
}
