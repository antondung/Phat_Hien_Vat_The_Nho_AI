import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Cctv, Grid2x2, MapPin, Gauge, Unplug, BellRing, Search, MoreHorizontal } from 'lucide-react';
import { ConnectPhoneButton } from './settings/ConnectPhoneButton';
import { AddCameraCta } from '../components/ui/AddCameraCta';
import { EmptyState } from '../components/ui/Controls';
import { VSplit } from '../components/layout/VSplit';
import { FeedStage } from '../components/video/FeedStage';
import { useLive, useAnalysisRate, useFrameLag } from '../context/LiveContext';
import { useTheme } from '../context/ThemeContext';
import { fmtAnalysisRate } from '../lib/analysisRate';
import { CameraFeed } from '../components/video/CameraFeed';
import { ModelStatusChip } from '../components/video/ModelStatusChip';
import { LivePhoneZoomChip, LiveRoleChip, RoleLegend } from '../components/video/RoleCountChip';
import { LayerToggles } from '../components/video/LayerToggles';
import { AlertRow } from '../components/alerts/AlertRow';
import { AlertVirtualList } from '../components/alerts/AlertVirtualList';
import { AlertDetailModal } from '../components/alerts/AlertDetailModal';
import { ConnectionBanner } from '../components/layout/ConnectionBanner';
import { useLocalState } from '../hooks/useLocalState';
import { useNow } from '../hooks/useNow';
import type { Alert, AlertLevel, Camera, CameraStatus } from '../types';
import type { OverlayLayers } from '../lib/overlay';
import { POSITION_LABEL, sourceLabel } from '../lib/labels';
import { fmtDuration, fmtLag } from '../lib/format';
import { isCameraOnline, isSampleCamera, partitionSwitcher } from '../lib/cameras';
import { useAuth } from '../context/AuthContext';

function clampAlertH(h: number) {
  const vh = window.innerHeight || 800;
  // Tối thiểu ~2 hàng cảnh báo gọn; phần còn lại dành cho video 70/30.
  const min = vh < 620 ? 112 : vh < 700 ? 128 : 140;
  const reserved = 140 + 44 + 10 + 48 + 32 + 12; // video min + cam strip + vsplit + topbar + toolbar + padding
  const max = Math.max(min, Math.min(Math.round(vh * 0.4), vh - reserved));
  return Math.min(max, Math.max(min, Math.round(h)));
}

function camQuery(c: Camera) {
  return `${c.name} ${c.room} ${c.id} ${POSITION_LABEL[c.position] ?? ''}`.toLowerCase();
}

function CamStrip({
  currentId,
  main,
  hiddenSamples,
  statuses,
  alerts,
  showSamples,
  onToggleSamples,
  onPick,
  phoneHint,
}: {
  currentId: string;
  main: Camera[];
  hiddenSamples: Camera[];
  statuses: Record<string, CameraStatus>;
  alerts: Alert[];
  showSamples: boolean;
  onToggleSamples(): void;
  onPick(id: string): void;
  phoneHint?: boolean;
}) {
  const [q, setQ] = useState('');
  const openCount = (cid: string) => alerts.filter((a) => a.cameraId === cid && a.status === 'moi').length;
  const needle = q.trim().toLowerCase();
  const pool = showSamples ? [...main, ...hiddenSamples] : main;
  const visible = needle ? pool.filter((c) => camQuery(c).includes(needle)) : pool;

  return (
    <div className="cam-strip" role="region" aria-label="Chọn camera">
      <div className="cam-strip-tools">
        <label className="cam-strip-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Tìm camera, phòng…"
            aria-label="Tìm camera"
          />
        </label>
        <label className="cam-strip-select-wrap">
          <span className="sr-only">Danh sách camera</span>
          <select
            className="select cam-picker cam-strip-select"
            value={currentId}
            aria-label="Chọn camera"
            onChange={(e) => onPick(e.target.value)}
          >
            {main.map((c) => {
              const n = openCount(c.id);
              const on = isCameraOnline(c, statuses[c.id]);
              return (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.room}
                  {on ? '' : ' · ngoại tuyến'}
                  {n ? ` · ${n} cảnh báo` : ''}
                </option>
              );
            })}
            {hiddenSamples.length > 0 && (
              <optgroup label="Camera mẫu đang tắt">
                {hiddenSamples.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.room} · tắt
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>
      <div className="cam-strip-scroll" role="listbox" aria-label="Danh sách nhanh">
        {visible.length === 0 && <span className="cam-strip-empty">Không có camera khớp</span>}
        {visible.map((c) => {
          const n = openCount(c.id);
          const on = isCameraOnline(c, statuses[c.id]);
          const active = c.id === currentId;
          return (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`cam-chip ${active ? 'on' : ''} ${on ? '' : 'off'}`}
              onClick={() => onPick(c.id)}
              title={`${c.name} · ${c.room}${on ? '' : ' · ngoại tuyến'}${n ? ` · ${n} cảnh báo` : ''}`}
            >
              <span className="cam-chip-thumb" aria-hidden>
                <Cctv size={14} />
              </span>
              <span className="cam-chip-meta">
                <span className="cam-chip-name">
                  <i className={on ? 'on' : ''} />
                  {c.name}
                </span>
                <small>
                  {c.room}
                  {n ? ` · ${n}` : ''}
                </small>
              </span>
            </button>
          );
        })}
        {hiddenSamples.length > 0 && (
          <button type="button" className="switch-samples-toggle cam-strip-samples" onClick={onToggleSamples}>
            {showSamples ? 'Ẩn' : 'Hiện'} mẫu ({hiddenSamples.length})
          </button>
        )}
      </div>
      {phoneHint && (
        <p className="muted small switch-hint cam-strip-hint">
          Chưa có camera điện thoại. Dùng nút <strong>Kết nối điện thoại</strong> trên thanh công cụ để thêm.
        </p>
      )}
    </div>
  );
}


function MoreMenu({ dark, children }: { dark: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="more-menu" ref={ref}>
      <button type="button" className={`btn btn-sm ${dark ? 'btn-ghost-dark' : 'btn-ghost'} more-btn`} aria-haspopup="menu" aria-expanded={open} aria-label="Thêm tùy chọn" onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal size={16} />
      </button>
      {open && <div className="dropdown more-dd" role="menu">{children}</div>}
    </div>
  );
}

export default function LiveSinglePage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { hasRole } = useAuth();
  const { theme } = useTheme();
  const { cameras, ready, statuses, alerts, connection, simulateDrop, lastAlertId } = useLive();
  const [layers, setLayers] = useLocalState<OverlayLayers>('layers.v2', { box: true, pose: true, label: true, conf: false });
  const [scope, setScope] = useState<'cam' | 'all'>('cam');
  const [level, setLevel] = useState<AlertLevel | 'all'>('all');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [view, setView] = useState<Alert | null>(null);
  const [showSamples, setShowSamples] = useState(false);
  const [alertH, setAlertH] = useLocalState('live.alertH', 148);
  const [since] = useState(Date.now());
  const now = useNow(1000);
  const dark = theme === 'dark';

  const cam = cameras.find((c) => c.id === id);
  const st = cam ? statuses[cam.id] : undefined;
  const online = !!cam?.enabled && (st?.online ?? true);
  const rate = useAnalysisRate(cam?.id);
  const lag = useFrameLag(cam?.id);

  const list = useMemo(
    () =>
      alerts
        .filter((a) => (scope === 'all' || a.cameraId === id) && (level === 'all' || a.level === level) && (!onlyOpen || a.status === 'moi'))
        .slice(0, 60),
    [alerts, scope, id, level, onlyOpen],
  );
  const { main: switchMain, hiddenSamples } = useMemo(() => partitionSwitcher(cameras, statuses, cam?.id), [cameras, statuses, cam?.id]);
  const showPhoneHint = hasRole('admin') && !!cam && isSampleCamera(cam) && !cameras.some((c) => !isSampleCamera(c));

  useEffect(() => {
    document.title = cam ? `${cam.name} · ${cam.room} – CMC AI` : 'Camera đơn – CMC AI';
    return () => {
      document.title = 'CMC AI – Giám sát phòng thi';
    };
  }, [cam]);

  useEffect(() => {
    const onR = () => setAlertH((h) => clampAlertH(h));
    onR();
    window.addEventListener('resize', onR);
    return () => window.removeEventListener('resize', onR);
  }, [setAlertH]);

  const h = clampAlertH(alertH);

  if (!ready) return <div className="live-page loading-dark">Đang tải camera…</div>;
  if (!cameras.length) {
    return (
      <div className="live-page live-empty-page">
        <ConnectionBanner />
        <EmptyState
          icon={<Cctv size={32} />}
          title="Chưa có camera"
          text="Thêm camera hoặc kết nối điện thoại để xem video và chạy mô hình trực tiếp. Chế độ thật không dùng dữ liệu mẫu."
        >
          <AddCameraCta />
        </EmptyState>
      </div>
    );
  }
  if (!id) return <Navigate to={`/giam-sat/camera/${cameras[0].id}`} replace />;
  if (!cam) return <Navigate to={`/giam-sat/camera/${cameras[0].id}`} replace />;

  const btnGhost = `btn btn-sm ${dark ? 'btn-ghost-dark' : 'btn-ghost'}`;

  return (
    <div className="live-page live-page-split" style={{ ['--alert-h' as string]: `${h}px` }}>
      <ConnectionBanner />
      <div className="live-stage">
        <div className="live-bar">
          <div className="live-bar-row">
            <span className="live-chip">
              <i /> Trực tiếp · {fmtDuration((now - since) / 1000)}
            </span>
            <span
              className={`conn-lag ${online && connection.state === 'connected' ? 'on' : 'off'}`}
              title="Trạng thái kết nối và độ trễ từ lúc khung được nhận tới khi hiện trên màn hình"
            >
              <i />
              {!online ? 'Camera ngoại tuyến' : connection.state === 'connected' ? 'Đã kết nối' : 'Đang kết nối lại'}
              {online && lag != null ? ` · ${fmtLag(lag)}` : ''}
            </span>
            <span className="meta meta-room">
              <MapPin size={14} /> {cam.room} · {POSITION_LABEL[cam.position]}
            </span>
            <ModelStatusChip cameraId={cam.id} online={online} camStatus={st} />
            <div className="grow" />
            <LayerToggles dark={dark} value={layers} onChange={setLayers} hide={['conf']} />
            <ConnectPhoneButton className={`${btnGhost} live-bar-connect`} />
            <button className={btnGhost} onClick={() => nav('/giam-sat/he-thong')}>
              <Grid2x2 size={14} /> Lưới
            </button>
            <MoreMenu dark={dark}>
              <button type="button" className={layers.conf ? 'on' : ''} onClick={() => setLayers({ ...layers, conf: !layers.conf })}>
                Độ tin cậy: {layers.conf ? 'bật' : 'tắt'}
              </button>
              {simulateDrop && (
                <button type="button" onClick={simulateDrop} title="Demo: giả lập rớt kết nối WebSocket">
                  <Unplug size={14} /> Mô phỏng mất kết nối
                </button>
              )}
              <div className="more-dd-meta">
                <Gauge size={12} /> {online ? fmtAnalysisRate(rate) : 'Chưa có kết quả phân tích'}
              </div>
            </MoreMenu>
          </div>
        </div>
        <div className="live-videos">
          <section className="live-video live-video-analysis panel-dark">
            <span className="live-video-label">Video phân tích · lớp phủ</span>
            {online && <LiveRoleChip cameraId={cam.id} className="role-chip-overlay live-role-chip" />}
            {online && <RoleLegend show className="live-role-legend" />}
            {online && <LivePhoneZoomChip cameraId={cam.id} className="role-chip-overlay live-zoom-chip" />}
            <FeedStage className="feed-main-stage" label={cam.name}>
              <CameraFeed camera={cam} layers={layers} className="feed-main" transport="stream" />
            </FeedStage>
          </section>
          <section className="live-video live-video-raw panel-dark">
            <span className="live-video-label">Video gốc · {sourceLabel(cam.sourceType)}</span>
            <FeedStage className="feed-raw-stage" label={`Video gốc ${cam.name}`}>
              <CameraFeed camera={cam} overlay={false} className="feed-raw" osd transport="stream" />
            </FeedStage>
          </section>
        </div>
      </div>

      <CamStrip
        currentId={cam.id}
        main={switchMain}
        hiddenSamples={hiddenSamples}
        statuses={statuses}
        alerts={alerts}
        showSamples={showSamples}
        onToggleSamples={() => setShowSamples((v) => !v)}
        onPick={(cid) => nav(`/giam-sat/camera/${cid}`)}
        phoneHint={showPhoneHint}
      />

      <VSplit value={h} onChange={(v) => setAlertH(clampAlertH(v))} min={window.innerHeight < 620 ? 112 : window.innerHeight < 700 ? 128 : 140} max={Math.max(160, Math.round((window.innerHeight || 800) * 0.4))} />

      <section className="panel-dark alert-panel">
        <div className="panel-head">
          <strong>
            <BellRing size={16} /> Cảnh báo trực tiếp
          </strong>
          <div className="row gap-8 wrap">
            <div className="seg-dark">
              <button className={scope === 'cam' ? 'on' : ''} onClick={() => setScope('cam')}>
                Camera này
              </button>
              <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>
                Tất cả camera
              </button>
            </div>
            <div className="seg-dark">
              {(['all', 'cao', 'trung_binh', 'thong_tin'] as const).map((l) => (
                <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>
                  {l === 'all' ? 'Mọi mức' : l === 'cao' ? 'Cao' : l === 'trung_binh' ? 'Trung bình' : 'Thông tin'}
                </button>
              ))}
            </div>
            <label className="check-dark">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Chỉ chưa xử lý
            </label>
          </div>
        </div>
        {list.length === 0 ? (
          <div className="alert-list">
            <div className="empty-dark">
              {alerts.length === 0 ? 'Chưa có cảnh báo. Hệ thống chỉ hiện dữ liệu sau khi có camera và mô hình chạy.' : 'Không có cảnh báo khớp bộ lọc.'}
            </div>
          </div>
        ) : (
          <AlertVirtualList
            items={list}
            estimateRow={72}
            renderRow={(a) => <AlertRow key={a.id} alert={a} onView={setView} isNew={a.id === lastAlertId} />}
          />
        )}
      </section>
      <AlertDetailModal alert={view} onClose={() => setView(null)} />
    </div>
  );
}
