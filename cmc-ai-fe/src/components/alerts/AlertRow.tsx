import { Check, Eye, X } from 'lucide-react';
import type { Alert } from '../../types';
import { LevelBadge, StatusBadge } from '../ui/Badges';
import { AlertThumb } from './AlertThumb';
import { hasTrack } from '../../lib/labels';
import { alertPersonLabel, inferPersonRole } from '../../lib/roles';
import { fmtTime, timeAgo } from '../../lib/format';
import { useLive } from '../../context/LiveContext';
import { useToast } from '../../context/ToastContext';

interface Props {
  alert: Alert;
  onView(a: Alert): void;
  onSelect?(a: Alert): void;
  selected?: boolean;
  compact?: boolean;
  isNew?: boolean;
}

/**
 * Một dòng cảnh báo realtime (redesign):
 * - Hàng 1: [Mức] giờ · camera · phòng
 * - Hàng 2: mô tả (Nghi vấn/Cần chú ý … #id), cỡ 14px
 * - Thao tác luôn có CHỮ: Xem · Xác nhận (nút chính, màu primary – không dùng đỏ để tránh lẫn với mức Cao) · Bỏ qua
 * - compact (bảng gộp ở lưới): thao tác xuống dòng riêng, vẫn giữ chữ
 */
export function AlertRow({ alert, onView, onSelect, selected, compact, isNew }: Props) {
  const { setAlertStatus } = useLive();
  const toast = useToast();
  const act = async (s: 'xac_nhan' | 'bo_qua') => {
    await setAlertStatus(alert.id, s);
    const who = hasTrack(alert.trackId) ? ` #${alert.trackId}` : '';
    toast(s === 'xac_nhan' ? `Đã xác nhận cảnh báo${who} – đã lưu vào Lịch sử` : `Đã bỏ qua cảnh báo${who} – đã lưu vào Lịch sử`);
  };
  const handled = alert.status !== 'moi';
  return (
    <div
      className={`alert-row lv-border-${alert.level} ${compact ? 'compact' : ''} ${selected ? 'selected' : ''} ${isNew ? 'is-new' : ''} ${handled ? 'handled' : ''}`}
      onClick={() => onSelect?.(alert)}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <AlertThumb alert={alert} width={compact ? 72 : 96} />
      <div className="alert-main">
        <div className="alert-top">
          <LevelBadge level={alert.level} solid={!handled} />
          <span className="alert-time" title={timeAgo(alert.ts)}>
            {fmtTime(alert.ts)}
          </span>
          <span className="alert-src">
            {alert.cameraName} · {alert.room}
          </span>
          {handled && <StatusBadge status={alert.status} />}
        </div>
        <div className="alert-msg">
          {alert.message}
          {alertPersonLabel(alert) && (
            <span className={`det-alert-who${inferPersonRole(alert) === 'invigilator' ? ' is-inv' : ''}`}>{alertPersonLabel(alert)}</span>
          )}
        </div>
      </div>
      <div className="alert-actions" onClick={(e) => e.stopPropagation()}>
        <button className="btn btn-sm btn-quiet" onClick={() => onView(alert)} title="Xem ảnh chụp và clip">
          <Eye size={15} /> Xem
        </button>
        {!handled && (
          <>
            <button className="btn btn-sm btn-confirm" onClick={() => act('xac_nhan')} title="Xác nhận nghi vấn (lưu vào Lịch sử)">
              <Check size={15} /> Xác nhận
            </button>
            <button className="btn btn-sm btn-quiet" onClick={() => act('bo_qua')} title="Bỏ qua (lưu vào Lịch sử)">
              <X size={15} /> Bỏ qua
            </button>
          </>
        )}
      </div>
    </div>
  );
}
