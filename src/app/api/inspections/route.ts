import { after, type NextRequest } from 'next/server';
import { getRuntimeEnv } from '@/server/env';
import { handleCreateInspection } from '@/server/http/inspections';
import { createInspectionDeps, runInspection } from '@/server/inspect';
import { logEvent } from '@/server/log';
import { createHostChecker } from '@/server/security/ssrf';
import { getInspectionStore } from '@/server/store/redis';

// POST /api/inspections (API_SPEC 3장). 브라우저 검사는 응답 뒤 after()에서 실행한다(PRD 8.1.2).
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: NextRequest): Promise<Response> {
  const origin = request.nextUrl.origin;
  return handleCreateInspection(request, {
    store: getInspectionStore(),
    // allowHosts를 넘기지 않는다(PRD 8.6)
    createChecker: () => createHostChecker(),
    maxConcurrentInspections: () => getRuntimeEnv().maxConcurrentInspections,
    newId: () => crypto.randomUUID(),
    now: Date.now,
    schedule: after,
    startInspection: (id) => runInspection(id, createInspectionDeps(origin)),
    log: logEvent,
  });
}
