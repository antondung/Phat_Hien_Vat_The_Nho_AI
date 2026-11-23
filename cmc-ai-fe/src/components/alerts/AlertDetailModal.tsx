import { useEffect, useRef, useState } from 'react';
import { Camera as CamIcon, Check, Clock, MapPin, User as UserIcon, X } from 'lucide-react';
import type { Alert } from '../../types';
import { Modal } from '../ui/Modal';
import { LevelBadge, StatusBadge } from '../ui/Badges';
import { AlertReplay } from './AlertReplay';
import { useLive } from '../../context/LiveContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { cameraOf, cropFor, drawAlertFrame } from './sceneRender';
import { getSampleImage } from '../../scene/renderScene';
import { fmtDateTime, fmtDuration, fmtPct } from '../../lib/format';
import { LEVEL_COLOR, trackText, typeLabel } from '../../lib/labels';
import { API_MODE } from '../../services';

/** Ảnh chụp thật từ backend; tab "Phóng to" cắt quanh thí sinh theo personBbox/objectBbox (chuẩn hoá 0..1) */
function RealSnapshot({ alert, zoom }: { alert: Alert; zoom: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!zoom) return;
    const img = new Image();
    img.onload = () => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext('2d')!;
      const v = cropFor(alert, true);
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      ctx.fillStyle = '#0f1113';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, v.x * iw, v.y * ih, v.w * iw, v.h * ih, 0, 0, cv.width, cv.height);
      const map = (b: number[]) => [((b[0] - v.x) / v.w) * cv.width, ((b[1] - v.y) / v.h) * cv.height, ((b[2] - b[0]) / v.w) * cv.width, ((b[3] - b[1]) / v.h) * cv.height] as const;
      const color = LEVEL_COLOR[alert.level];
      ctx.lineWidth = 3;
      if (alert.personBbox) {
        ctx.setLineDash([8, 5]);
        ctx.strokeStyle = color;
        ctx.strokeRect(...map(alert.personBbox));
        ctx.setLineDash([]);
      }
      if (alert.objectBbox) {
        ctx.strokeStyle = color;
        ctx.strokeRect(...map(alert.objectBbox));
      }
    };
    img.src = alert.snapshotUrl!;
  }, [alert, zoom]);
  if (!zoom) return <img src={alert.snapshotUrl} alt="Ảnh chụp" className="snapshot" />;
  return <canvas ref={ref} className="snapshot" width={720} height={540} aria-label="Phóng to thí sinh" />;
}

function Snapshot({ alert, zoom }: { alert: Alert; zoom: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cameras } = useLive();
  useEffect(() => {
    if (alert.snapshotUrl) return;
    const draw = () => {
      const cv = ref.current;
      if (cv) drawAlertFrame(cv.getContext('2d')!, alert, cameraOf(alert, cameras), alert.ts, cv.width, cv.height, cropFor(alert, zoom));
    };
    draw();
    const img = getSampleImage();
    if (!img.complete) img.addEventListener('load', draw, { once: true });
    return () => img.removeEventListener('load', draw);
  }, [alert, cameras, zoom]);
  if (alert.snapshotUrl) return <RealSnapshot alert={alert} zoom={zoom} />;
  return <canvas ref={ref} className="snapshot" width={zoom ? 720 : 960} height={540} />;
}

/** Chi tiết cảnh báo: ảnh chụp + clip ngắn + thao tác Xác nhận / Bỏ qua */
export function AlertDetailModal({ alert, onClose, onChanged }: { alert: Alert | null; onClose(): void; onChanged?(a: Alert): void }) {
  const { setAlertStatus, alerts } = useLive();
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState<'clip' | 'snap' | 'zoom'>('clip');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // luôn lấy bản mới nhất (trạng thái có thể đổi ở màn khác)
  const [ov, setOv] = useState<Alert | null>(null);
  const live = alert ? alerts.find((a) => a.id === alert.id) : undefined;
  const cur = alert ? (ov && ov.id === alert.id && (!live || (live.handledAt ?? 0) <= (ov.handledAt ?? 0)) ? ov : live ?? alert) : null;

  useEffect(() => {
    setNote(alert?.note ?? '');
    setTab('clip');
  }, [alert?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return null;

  const act = async (status: 'xac_nhan' | 'bo_qua' | 'moi') => {
    setBusy(true);
    try {
      const a = await setAlertStatus(cur.id, status, note || undefined);
      setOv(a);
      onChanged?.(a);
      toast(status === 'xac_nhan' ? 'Đã xác nhận cảnh báo' : status === 'bo_qua' ? 'Đã bỏ qua cảnh báo' : 'Đã mở lại cảnh báo');
      if (status !== 'moi') onClose();
    } catch {
      toast('Không cập nhật được cảnh báo', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={1040}
      title={
        <span className="row gap-8">
          <LevelBadge level={cur.level} solid /> {cur.message}
        </span>
      }
      footer={
        <>
          <span className="muted small grow">
            {cur.status !== 'moi' && cur.handledBy ? `${cur.status === 'xac_nhan' ? 'Xác nhận' : 'Bỏ qua'} bởi ${cur.handledBy} lúc ${fmtDateTime(cur.handledAt ?? cur.ts)}` : 'Hệ thống chỉ đưa ra nghi vấn – giám thị kiểm tra và quyết định.'}
          </span>
          {cur.status !== 'moi' ? (
            <button className="btn btn-ghost" disabled={busy} onClick={() => act('moi')}>
              Mở lại
            </button>
          ) : (
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => act('bo_qua')}>
                <X size={16} /> Bỏ qua
              </button>
              <button className="btn btn-confirm" disabled={busy} onClick={() => act('xac_nhan')}>
                <Check size={16} /> Xác nhận
              </button>
            </>
          )}
        </>
      }
    >
      <div className="detail-grid">
        <div>
          <div className="tabs small-tabs">
            <button className={tab === 'clip' ? 'active' : ''} onClick={() => setTab('clip')}>
              {API_MODE === 'real' ? 'Clip (−4s → +3s)' : 'Clip (−5s → +2s)'}
            </button>
            <button className={tab === 'snap' ? 'active' : ''} onClick={() => setTab('snap')}>
              Ảnh chụp
            </button>
            <button className={tab === 'zoom' ? 'active' : ''} onClick={() => setTab('zoom')}>
              Phóng to thí sinh
            </button>
          </div>
          <div className="media-box">{tab === 'clip' ? <AlertReplay alert={cur} /> : <Snapshot alert={cur} zoom={tab === 'zoom'} />}</div>
        </div>
        <aside className="detail-side">
          <dl className="kv">
            <dt>Trạng thái</dt>
            <dd>
              <StatusBadge status={cur.status} />
            </dd>
            <dt>Loại</dt>
            <dd>{typeLabel(cur.type, cur.message)}</dd>
            <dt>
              <UserIcon size={14} /> Thí sinh
            </dt>
            <dd>
              <span className="track-id">{trackText(cur.trackId)}</span>
            </dd>
            <dt>
              <CamIcon size={14} /> Camera
            </dt>
            <dd>{cur.cameraName}</dd>
            <dt>
              <MapPin size={14} /> Phòng
            </dt>
            <dd>{cur.room}</dd>
            <dt>
              <Clock size={14} /> Thời điểm
            </dt>
            <dd>{fmtDateTime(cur.ts)}</dd>
            <dt>Kéo dài</dt>
            <dd>{fmtDuration((cur.ts - cur.startedAt) / 1000)} trước khi báo</dd>
            <dt>Độ tin cậy</dt>
            <dd>
              <div className="conf-bar">
                <i style={{ width: fmtPct(cur.confidence, 0) }} />
              </div>
              {fmtPct(cur.confidence, 0)}
            </dd>
          </dl>
          <label className="field">
            <span className="field-label">Ghi chú của giám thị</span>
            <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: đã nhắc nhở thí sinh, cất điện thoại…" disabled={cur.status !== 'moi'} />
          </label>
          <p className="muted small">Người xử lý: {user?.name}</p>
        </aside>
      </div>
    </Modal>
  );
}
