import { INSPECTION_STEP_ORDER, isInspectionStep, STEP_LABELS, type InspectionStepName } from '@/components/inspection/labels';
import type { Inspection, InspectionErrorInfo, InspectionStatus, Viewport } from '@/types/inspection';

// PRD 6.2.3 단계 목록의 화면 상태(WIREFRAME 4.4). 서버가 준 status, step, 오류만으로 정한다.

export type StepState = 'done' | 'current' | 'pending' | 'failed';

export interface StepView {
  step: InspectionStepName;
  label: string;
  state: StepState;
  error?: InspectionErrorInfo;
}

const VIEWPORT_STEP: Partial<Record<InspectionStepName, Viewport>> = {
  rendering_desktop: 'desktop',
  rendering_mobile: 'mobile',
};

/** PRD 6.2.1: 이슈와 스크린샷은 analyzing부터 결과 화면에서 보여준다 */
export const REPORT_READY_STATUSES: ReadonlySet<InspectionStatus> = new Set(['analyzing', 'completed', 'partial']);

export function isReportReady(status: InspectionStatus): boolean {
  return REPORT_READY_STATUSES.has(status);
}

export function buildStepViews(inspection: Pick<Inspection, 'status' | 'step' | 'error' | 'viewportErrors' | 'analysis'>): StepView[] {
  const { status } = inspection;
  const finished = status === 'completed' || status === 'partial';
  const currentIndex = isInspectionStep(inspection.step) ? INSPECTION_STEP_ORDER.indexOf(inspection.step) : -1;

  return INSPECTION_STEP_ORDER.map((step, index): StepView => {
    const label = STEP_LABELS[step];
    const viewport = VIEWPORT_STEP[step];
    const viewportError = viewport ? inspection.viewportErrors[viewport] ?? undefined : undefined;

    if (status === 'pending') return { step, label, state: 'pending' };

    if (finished) {
      if (viewportError) return { step, label, state: 'failed', error: viewportError };
      if (step === 'analyzing_issues' && inspection.analysis.status === 'failed') {
        return { step, label, state: 'failed', error: inspection.analysis.error };
      }
      return { step, label, state: 'done' };
    }

    if (index > currentIndex) return { step, label, state: 'pending' };

    if (status === 'failed') {
      if (index === currentIndex) return { step, label, state: 'failed', error: viewportError ?? inspection.error };
      return viewportError ? { step, label, state: 'failed', error: viewportError } : { step, label, state: 'done' };
    }

    // running, analyzing
    if (viewportError) return { step, label, state: 'failed', error: viewportError };
    return { step, label, state: index === currentIndex ? 'current' : 'done' };
  });
}

/** 경과 시간의 시작과 끝 (epoch ms). 시작은 startedAt, 없으면 createdAt */
export function elapsedRange(inspection: Pick<Inspection, 'createdAt' | 'startedAt' | 'completedAt' | 'updatedAt' | 'status'>): {
  startIso: string;
  endIso: string | null;
} {
  const startIso = inspection.startedAt ?? inspection.createdAt;
  const ended = inspection.status === 'failed' || inspection.status === 'completed' || inspection.status === 'partial';
  return { startIso, endIso: ended ? inspection.completedAt ?? inspection.updatedAt : null };
}
