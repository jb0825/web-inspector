import 'server-only';
import { getStorageBackends } from '@/server/env';
import { createBlobStorage, type ScreenshotStorage } from './blob';
import { createFileInspectionStore, createFileScreenshotStorage } from './file';
import { getRedisInspectionStore, type InspectionStore } from './redis';

// 서비스 코드가 쓰는 저장소. 저장소 선택은 이 파일에서만 한다.
// public 모드는 항상 Redis·Blob이다. local 모드에서 Upstash·Blob 값이 없을 때만 .inspector-data/ 파일 저장소를 쓴다(PRD 8.7).

let fileStore: InspectionStore | undefined;

export function getInspectionStore(): InspectionStore {
  if (getStorageBackends().inspections === 'file') return (fileStore ??= createFileInspectionStore());
  return getRedisInspectionStore();
}

export function getScreenshotStorage(): ScreenshotStorage {
  return getStorageBackends().screenshots === 'file' ? createFileScreenshotStorage() : createBlobStorage();
}
