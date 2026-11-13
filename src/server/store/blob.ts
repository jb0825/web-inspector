import 'server-only';
import { put } from '@vercel/blob';
import { getStoreEnv } from '@/server/env';
import { InspectionError } from '@/server/errors';
import type { Viewport } from '@/types/inspection';

// DOMAIN_MODEL 6.2: 전체 스크린샷을 Vercel Blob에 올린다. 크롭 이미지는 만들지 않는다(PRD 5.4.1).

/** PRD 8.1.3 "저장 15s": 업로드 1회의 시간 제한 */
export const BLOB_UPLOAD_TIMEOUT_MS = 15_000;

export const screenshotPath = (id: string, viewport: Viewport) => `inspections/${id}/${viewport}-full.png`;

export interface ScreenshotStorage {
  /** captureFullPage(T07)가 돌려준 PNG를 그대로 올리고 공개 URL을 돌려준다. 실패하면 STORAGE_FAILED */
  upload(id: string, viewport: Viewport, png: Buffer): Promise<string>;
}

export function createBlobStorage(): ScreenshotStorage {
  return {
    async upload(id, viewport, png) {
      const { BLOB_READ_WRITE_TOKEN: token } = getStoreEnv();
      try {
        const result = await put(screenshotPath(id, viewport), png, {
          access: 'public',
          // DOMAIN_MODEL 6.2: 공개 URL이라 무작위 접미사로 추측할 수 없게 한다
          addRandomSuffix: true,
          contentType: 'image/png',
          token,
          abortSignal: AbortSignal.timeout(BLOB_UPLOAD_TIMEOUT_MS),
        });
        return result.url;
      } catch (error) {
        throw new InspectionError('STORAGE_FAILED', `Screenshot upload failed (${viewport})`, { cause: error });
      }
    },
  };
}
