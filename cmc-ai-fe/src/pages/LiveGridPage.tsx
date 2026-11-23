import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BellRing, ChevronLeft, ChevronRight, Cctv, MapPin } from 'lucide-react';
import { ConnectPhoneButton } from './settings/ConnectPhoneButton';
import { AddCameraCta } from '../components/ui/AddCameraCta';
import { EmptyState } from '../components/ui/Controls';
import { FeedStage } from '../components/video/FeedStage';
import { useLive, activeFlags, useAnalysisRate } from '../context/LiveContext';
import { fmtAnalysisRate } from '../lib/analysisRate';
import { CameraFeed } from '../components/video/CameraFeed';
import { AlertRow } from '../components/alerts/AlertRow';
import { AlertDetailModal } from '../components/alerts/AlertDetailModal';
import { ConnectionBanner } from '../components/layout/ConnectionBanner';
import { Segmented, Toggle } from '../components/ui/Controls';
import { useLocalState } from '../hooks/useLocalState';
import { useHeldIds } from '../hooks/useHeldIds';
import { GridFeedProvider } from '../context/GridFeedContext';
import type { Alert, Camera } from '../types';
import { POSITION_LABEL } from '../lib/labels';

export default function LiveGridPage() {
  const nav = useNavigate();
  const { cameras, ready, statuses, alerts, lastAlertId } = useLive();
  const [size, setSize] = useLocalState<'2' | '3'>('grid.size', '3');
  const [room, setRoom] = useLocalState('grid.room', 'all');
  const [onlyAlert, setOnlyAlert] = useLocalState('grid.onlyAlert', false);
  const [alertFirst, setAlertFirst] = useLocalState('grid.alertFirst', true);
  const [overlay, setOverlay] = useLocalState('grid.overlay', true);
  const [page, setPage] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [view, setView] = useState<Alert | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  // tick chậm (5s) chỉ để hết hạn cờ "cao" — không dùng cho lọc/sắp xếp mỗi giây
  const [flagNow, setFlagNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setFlagNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const rooms = useMemo(() => [...new Set(cameras.map((c) => c.room))].sort(), [cameras]);
  const openBy = useMemo(() => {
    const m = new Map<string, number>();
    alerts.forEach((a) => a.status === 'moi' && m.set(a.cameraId, (m.get(a.cameraId) ?? 0) + 1));
    return m;
  }, [alerts]);
  const highBy = useMemo(() => {
    const s = new Set<string>();
    cameras.forEach((c) => activeFlags(alerts, c.id, flagNow).high && s.add(c.id));
    return s;
  }, [alerts, cameras, flagNow]);

  const desiredIds = useMemo(() => {
    const l = cameras.filter((c) => (room === 'all' || c.room === room) && (!onlyAlert || (openBy.get(c.id) ?? 0) > 0));
    return l.map((c) => c.id);
  }, [cameras, room, onlyAlert, openBy]);

  // Giữ ô vừa mất cảnh báo thêm vài giây để không gắn lại luồng / nhảy layout
  const heldIds = useHeldIds(desiredIds, onlyAlert ? 2800 : 0);
  const shown = useMemo(() => {
    const byId = new Map(cameras.map((c) => [c.id, c] as const));
    const list: Camera[] = [];
    for (const id of heldIds) {
      const c = byId.get(id);
      if (c) list.push(c);
    }
    if (!alertFirst) return list;
    const rank = (id: string) => (highBy.has(id) ? 2 : (openBy.get(id) ?? 0) > 0 ? 1 : 0);
    // Sắp theo nhóm, giữ thứ tự tương đối trong cùng hạng (sort ổn định) — không nhảy từng cảnh báo
    return [...list].sort((a, b) => rank(b.id) - rank(a.id));
  }, [heldIds, cameras, alertFirst, highBy, openBy]);

  const per = size === '2' ? 4 : 9;
  const pages = Math.max(1, Math.ceil(shown.length / per));
  const pg = Math.min(page, pages - 1);
  const visible = shown.slice(pg * per, pg * per + per);
  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);

  const merged = useMemo(() => alerts.filter((a) => room === 'all' || a.room === room).slice(0, 50), [alerts, room]);

  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => setFocus(null), 4000);
    return () => clearTimeout(t);
  }, [focus]);

  const highlight = (a: Alert) => {
    const idx = shown.findIndex((c) => c.id === a.cameraId);
    if (idx < 0) {
      setRoom('all');
      setOnlyAlert(false);
    } else setPage(Math.floor(idx / per));
    setFocus(a.cameraId);
    setTimeout(() => cellRefs.current.get(a.cameraId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  };

  if (!ready) {
    return (
      <div className="grid-page">
        <ConnectionBanner />
        <div className="empty-dark">Đang tải camera…</div>
      </div>
    );
  }

  return (
    <div className="grid-page">
      <ConnectionBanner />
      <div className="grid-toolbar panel-dark">
        <Segmented
          value={size}
          onChange={(v) => {
            setSize(v);
            setPage(0);
          }}
          options={[
            { value: '2', label: 'Lưới 2×2' },
            { value: '3', label: 'Lưới 3×3' },
          ]}
        />
        <select
          className="select"
          value={room}
          onChange={(e) => {
            setRoom(e.target.value);
            setPage(0);
          }}
          aria-label="Lọc theo phòng"
        >
          <option value="all">Tất cả phòng</option>
          {rooms.map((r) => (
            <option key={r} value={r}>
              Phòng {r}
            </option>
          ))}
        </select>
        <Toggle checked={onlyAlert} onChange={(v) => (setOnlyAlert(v), setPage(0))} label="Chỉ cam có cảnh báo" />
        <Toggle checked={alertFirst} onChange={setAlertFirst} label="Đưa cam cảnh báo lên đầu" />
        <Toggle checked={overlay} onChange={setOverlay} label="Lớp phủ AI" />
        <div className="grow" />
        <span className="muted small">
          {shown.length} camera · {highBy.size} đang cảnh báo cao
        </span>
        <ConnectPhoneButton navOnClose />
        {pages > 1 && (
          <div className="row gap-4">
            <button className="icon-btn" disabled={pg === 0} onClick={() => setPage(pg - 1)} aria-label="Trang trước">
              <ChevronLeft size={18} />
            </button>
            <span className="small">
              {pg + 1}/{pages}
            </span>
            <button className="icon-btn" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)} aria-label="Trang sau">
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>

      <GridFeedProvider cameraIds={visibleIds}>
      <div className="grid-body">
        <div className={`cam-grid g${size}`}>
          {cameras.length === 0 && (
            <EmptyState
              icon={<Cctv size={32} />}
              title="Chưa có camera"
              text="Thêm camera hoặc kết nối điện thoại để xem lưới giám sát. Chế độ thật không dùng dữ liệu mẫu."
            >
              <AddCameraCta />
            </EmptyState>
          )}
          {cameras.length > 0 && visible.length === 0 && <div className="empty-dark">Không có camera phù hợp bộ lọc.</div>}
          {visible.map((c) => {
            const s = statuses[c.id];
            const on = c.enabled && (s?.online ?? true);
            const n = openBy.get(c.id) ?? 0;
            const high = highBy.has(c.id);
            const transport = 'snapshot' as const;
            return (
              <div
                key={c.id}
                ref={(el) => {
                  if (el) cellRefs.current.set(c.id, el);
                  else cellRefs.current.delete(c.id);
                }}
                className={`cam-cell ${high ? 'alarm' : ''} ${focus === c.id ? 'focus' : ''}`}
                onClick={() => nav(`/giam-sat/camera/${c.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && nav(`/giam-sat/camera/${c.id}`)}
                role="button"
                tabIndex={0}
                aria-label={`Mở ${c.name}`}
                data-cam={c.id}
                data-transport={transport}
              >
                <FeedStage
                  className="cell-stage"
                  label={c.name}
                  onSingleClick={() => nav(`/giam-sat/camera/${c.id}`)}
                >
                  <CameraFeed camera={c} overlay={overlay} quality="low" osd={size === '2'} dense={size === '3'} transport={transport} />
                </FeedStage>
                <div className="cell-top">
                  <span className="cell-name" title={`${c.name} · ${c.room} · ${POSITION_LABEL[c.position]}`}>
                    {c.name}
                    {size === '3' && <span className="cell-name-room"> · {c.room}</span>}
                  </span>
                  {n > 0 ? (
                    <span
                      className={`count-pill ${high ? 'red' : ''}`}
                      title={`${high ? 'Mức Cao · ' : ''}${n} cảnh báo chưa xử lý`}
                      aria-label={`${high ? 'Mức Cao, ' : ''}${n} cảnh báo chưa xử lý`}
                    >
                      {high && <AlertCircle size={12} aria-hidden="true" />}
                      {size === '3' ? (high ? `Cao · ${n}` : `${n} mới`) : `${high ? 'Cao · ' : ''}${n} chưa xử lý`}
                    </span>
                  ) : on ? (
                    <span className="ok-pill">Bình thường</span>
                  ) : null}
                </div>
                <div className="cell-bottom">
                  {size !== '3' && (
                    <span className="cell-loc" title={`${c.room} · ${POSITION_LABEL[c.position]}`}>
                      <MapPin size={12} aria-hidden="true" />
                      <span className="cell-room">{c.room}</span>
                      <span className="cell-pos">· {POSITION_LABEL[c.position]}</span>
                    </span>
                  )}
                  {on ? (
                    <AnalysisRateStatus cameraId={c.id} />
                  ) : (
                    <span className="cell-status off">
                      <i />
                      {size === '3' ? 'Mất tín hiệu' : 'Mất kết nối'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <aside className="panel-dark merged-panel">
          <header className="panel-head">
            <strong>
              <BellRing size={16} /> Cảnh báo tổng hợp
            </strong>
            <span className="muted small">{merged.filter((a) => a.status === 'moi').length} chưa xử lý</span>
          </header>
          <div className="merged-list">
            {merged.length === 0 && <div className="empty-dark">Chưa có cảnh báo. Hệ thống đang theo dõi…</div>}
            {merged.map((a) => (
              <AlertRow
                key={a.id}
                alert={a}
                compact
                onView={setView}
                onSelect={highlight}
                selected={focus === a.cameraId}
                isNew={a.id === lastAlertId}
              />
            ))}
          </div>
        </aside>
      </div>
      </GridFeedProvider>
      <AlertDetailModal alert={view} onClose={() => setView(null)} />
    </div>
  );
}

/** Tốc độ phân tích thực tế của camera (đo từ gói detections trong ~5 giây gần nhất) */
function AnalysisRateStatus({ cameraId }: { cameraId: string }) {
  const r = useAnalysisRate(cameraId);
  return (
    <span className={`cell-status ${r == null ? 'wait' : 'on'}`} title="Số khung hình AI phân tích mỗi giây (video gốc chạy riêng)">
      <i />
      {fmtAnalysisRate(r)}
    </span>
  );
}
