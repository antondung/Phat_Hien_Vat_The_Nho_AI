import type { AlertLevel, AlertStatus } from '../../types';
import { LEVEL_LABEL, STATUS_LABEL } from '../../lib/labels';
import { AlertTriangle, AlertOctagon, Info, CheckCircle2, XCircle, Clock } from 'lucide-react';

/** Mức cảnh báo – luôn có chữ đi kèm màu */
export function LevelBadge({ level, solid = false }: { level: AlertLevel; solid?: boolean }) {
  const Icon = level === 'cao' ? AlertOctagon : level === 'trung_binh' ? AlertTriangle : Info;
  return (
    <span className={`badge lv-${level} ${solid ? 'solid' : ''}`}>
      <Icon size={13} strokeWidth={2.5} />
      {LEVEL_LABEL[level]}
    </span>
  );
}

export function StatusBadge({ status }: { status: AlertStatus }) {
  const Icon = status === 'xac_nhan' ? CheckCircle2 : status === 'bo_qua' ? XCircle : Clock;
  return (
    <span className={`badge st-${status}`}>
      <Icon size={13} strokeWidth={2.5} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function LevelIcon({ level, size = 16 }: { level: AlertLevel; size?: number }) {
  const Icon = level === 'cao' ? AlertOctagon : level === 'trung_binh' ? AlertTriangle : Info;
  return (
    <span className={`level-icon lv-${level}`} title={LEVEL_LABEL[level]}>
      <Icon size={size} strokeWidth={2.4} />
    </span>
  );
}

export function OnlineDot({ online, label }: { online: boolean; label?: string }) {
  return (
    <span className={`online-dot ${online ? 'on' : 'off'}`}>
      <i />
      {label ?? (online ? 'Trực tuyến' : 'Mất kết nối')}
    </span>
  );
}

export function Chip({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'blue' | 'green' | 'red' | 'orange' | 'slate' }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
