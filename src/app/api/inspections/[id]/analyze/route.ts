import { after, type NextRequest } from 'next/server';
import { runAnalysis } from '@/server/analyze';
import { getInternalEnv } from '@/server/env';
import { handleAnalyze } from '@/server/http/inspections';
import { logEvent } from '@/server/log';
import { getInspectionStore } from '@/server/store/redis';

// POST /api/inspections/:id/analyze (API_SPEC 6장, 내부 전용). 공유 비밀 헤더로 보호한다.
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest, context: RouteContext<'/api/inspections/[id]/analyze'>): Promise<Response> {
  const { id } = await context.params;
  return handleAnalyze(request, id, {
    store: getInspectionStore(),
    internalSecret: () => getInternalEnv().INTERNAL_API_SECRET,
    schedule: after,
    startAnalysis: (inspectionId) => runAnalysis(inspectionId, { store: getInspectionStore(), now: Date.now, log: logEvent }),
    log: logEvent,
  });
}
