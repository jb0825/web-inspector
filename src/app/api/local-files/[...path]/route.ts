import { handleLocalFile } from '@/server/http/localFiles';

// GET /api/local-files/<id>/<viewport>-full.png (PRD 8.7). 로컬 모드의 파일 저장소에 둔 스크린샷을 제공한다.
// public 모드에서는 항상 404다(배포본에서는 이 route가 아무것도 읽지 않는다).
export const runtime = 'nodejs';

export async function GET(_request: Request, context: RouteContext<'/api/local-files/[...path]'>): Promise<Response> {
  const { path } = await context.params;
  return handleLocalFile(path);
}
