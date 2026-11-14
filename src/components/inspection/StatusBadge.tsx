import { AlertTriangle, Check, Circle, X } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import type { InspectionStatus } from '@/types/inspection';
import { STATUS_LABELS } from './labels';

// DESIGN_GUIDE 6.4: 색 외에 라벨과 아이콘으로 상태를 구분한다. pulse는 reduced motion에서 꺼진다(globals.css)
const STYLE: Record<InspectionStatus, { tone: BadgeTone; icon: 'dot' | 'pulse' | 'check' | 'warn' | 'x' }> = {
  pending: { tone: 'neutral', icon: 'dot' },
  running: { tone: 'info', icon: 'pulse' },
  analyzing: { tone: 'info', icon: 'pulse' },
  completed: { tone: 'success', icon: 'check' },
  partial: { tone: 'warning', icon: 'warn' },
  failed: { tone: 'error', icon: 'x' },
};

function StatusIcon({ icon }: { icon: (typeof STYLE)[InspectionStatus]['icon'] }) {
  const props = { 'aria-hidden': true, size: 12, strokeWidth: 1.75 } as const;
  switch (icon) {
    case 'check':
      return <Check {...props} />;
    case 'warn':
      return <AlertTriangle {...props} />;
    case 'x':
      return <X {...props} />;
    case 'pulse':
      return <Circle {...props} size={8} fill="currentColor" className="animate-pulse" />;
    default:
      return <Circle {...props} size={8} fill="currentColor" />;
  }
}

export function StatusBadge({ status }: { status: InspectionStatus }) {
  const { tone, icon } = STYLE[status];
  return (
    <Badge tone={tone} icon={<StatusIcon icon={icon} />}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
