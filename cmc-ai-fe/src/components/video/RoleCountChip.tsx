/** Ô đếm giám thị / thí sinh (model vai trò của BE). Không có model vai trò → không hiện gì, giao diện như cũ. */
import { useEffect, useState } from 'react';
import type { Detection, RoleCounts } from '../../types';
import { api } from '../../services';
import type { SystemModelPayload } from '../../services/api';
import { useLive } from '../../context/LiveContext';
import { shouldDrawDetection } from '../../lib/overlayMap';
import { readRoleModel, roleCounts, showRoleCounts, type RoleModelInfo } from '../../lib/roles';

import { readPhoneZoom, zoomPhoneCount, type PhoneZoomInfo } from '../../lib/phoneZoom';

/* Dùng chung một lần gọi GET /api/system/model cho mọi ô đếm (máy yếu: không thêm vòng hỏi 5 giây). */
const TTL_MS = 30000;
let cache: { at: number; p: Promise<SystemModelPayload | null> } | null = null;
function loadSystemModel(): Promise<SystemModelPayload | null> {
  const now = Date.now();
  if (!cache || now - cache.at > TTL_MS) {
    cache = { at: now, p: api.system.model().catch(() => null) };
  }
  return cache.p;
}

export function useRoleModel(): RoleModelInfo | null {
  const [info, setInfo] = useState<RoleModelInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void loadSystemModel().then((m) => alive && setInfo(readRoleModel(m)));
    load();
    const t = window.setInterval(load, TTL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return info;
}

export function RoleCountChip({ counts, roleEnabled, className = '' }: { counts: RoleCounts; roleEnabled?: boolean | null; className?: string }) {
  if (!showRoleCounts(counts, roleEnabled)) return null;
  const tip = [
    `Giám thị: ${counts.invigilator}`,
    `Thí sinh: ${counts.student}`,
    counts.unknown ? `Chưa rõ vai trò: ${counts.unknown}` : '',
    'Theo model giám thị / thí sinh của hệ thống',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <span className={`role-chip ${className}`} title={tip} role="status" aria-label={tip.replace(/\n/g, ', ')}>
      <i className="role-dot role-dot-inv" aria-hidden />
      Giám thị <b>{counts.invigilator}</b>
      <i className="role-sep" aria-hidden />
      <i className="role-dot role-dot-stu" aria-hidden />
      Thí sinh <b>{counts.student}</b>
    </span>
  );
}

/** Ô đếm cho Camera đơn: lấy khung detections mới nhất của camera (cập nhật theo frameTick ~10 Hz). */
export function LiveRoleChip({ cameraId, className }: { cameraId: string; className?: string }) {
  const { frames, frameTick } = useLive();
  const role = useRoleModel();
  void frameTick;
  const raw = frames.current.get(cameraId);
  const f = raw && shouldDrawDetection(raw, Date.now()) ? raw : undefined;
  // roleEnabled của gói detections (BE mới) ưu tiên hơn system/model
  return <RoleCountChip counts={roleCounts(f)} roleEnabled={f?.roleEnabled ?? role?.enabled} className={className} />;
}

export function usePhoneZoom(): PhoneZoomInfo | null {
  const [info, setInfo] = useState<PhoneZoomInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void loadSystemModel().then((m) => alive && setInfo(m ? readPhoneZoom(m) : null));
    load();
    const t = window.setInterval(load, TTL_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);
  return info;
}

/** Ghi chú nhỏ khi khung có điện thoại tìm thấy nhờ phóng vùng tay — không đổi màu hộp. */
export function PhoneZoomChip({ objects, className = '' }: { objects?: Detection[] | null; className?: string }) {
  const n = zoomPhoneCount(objects);
  if (!n) return null;
  const tip =
    n === 1
      ? 'Điện thoại này được tìm thấy nhờ phóng to vùng tay / bàn'
      : `${n} điện thoại được tìm thấy nhờ phóng to vùng tay / bàn`;
  return (
    <span className={`zoom-hint-chip ${className}`} title={tip} role="note">
      Điện thoại · soi kỹ
    </span>
  );
}

/** Ô gợi ý soi kỹ cho Camera đơn (cùng nguồn khung với LiveRoleChip). */
export function LivePhoneZoomChip({ cameraId, className }: { cameraId: string; className?: string }) {
  const { frames, frameTick } = useLive();
  void frameTick;
  const raw = frames.current.get(cameraId);
  const f = raw && shouldDrawDetection(raw, Date.now()) ? raw : undefined;
  return <PhoneZoomChip objects={f?.objects} className={className} />;
}

/** Chú thích màu khung: thí sinh (xanh nét đứt) và giám thị (xám nét đứt). */
export function RoleLegend({ show, className = '' }: { show: boolean; className?: string }) {
  if (!show) return null;
  return (
    <span className={`role-legend ${className}`} role="note" aria-label="Chú thích: thí sinh, giám thị">
      <span className="role-legend-item">
        <i className="role-dot role-dot-stu" aria-hidden />
        Thí sinh
      </span>
      <span className="role-legend-item">
        <i className="role-dot role-dot-inv" aria-hidden />
        Giám thị
      </span>
    </span>
  );
}

