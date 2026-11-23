import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, BellRing, CheckCircle2, Cctv, ChevronRight, ScanSearch, XCircle, Activity } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../services';
import type { Alert, DashboardStats } from '../types';
import { useAuth } from '../context/AuthContext';
import { useLive, useAnalysisRate } from '../context/LiveContext';
import { fmtRateNumber } from '../lib/analysisRate';
import { Card, EmptyState } from '../components/ui/Controls';
import { AddCameraCta } from '../components/ui/AddCameraCta';
import { LevelBadge, LevelIcon, StatusBadge } from '../components/ui/Badges';
import { Sparkline } from '../components/charts/Sparkline';
import { AlertDetailModal } from '../components/alerts/AlertDetailModal';
import { typeShort, LEVEL_COLOR } from '../lib/labels';
import { fmtDate, timeAgo } from '../lib/format';

function StatCard({ tone, icon, label, value, sub, trend, spark, goodWhenUp = true, neutral = false }: { tone: 'blue' | 'red' | 'green' | 'slate'; icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; trend: number; spark?: number[]; goodWhenUp?: boolean; neutral?: boolean }) {
  const up = trend >= 0;
  const good = up === goodWhenUp;
  const color = { blue: '#1F2328', red: '#DC2626', green: '#15803D', slate: '#57606A' }[tone];
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        {spark && spark.length > 0 ? <Sparkline data={spark} color={color} /> : <span />}
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        <span className={`trend ${neutral ? 'neutral' : good ? 'good' : 'bad'}`} title={neutral ? 'Chỉ số khối lượng xử lý – tăng/giảm không mang nghĩa tốt/xấu' : undefined}>
          {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
          {Math.abs(trend)}%
        </span>
        <span className="muted small">{sub ?? 'so với hôm qua'}</span>
      </div>
    </div>
  );
}

/** Tên gọi: "Nguyễn Văn An" -> "An"; tên dạng chức danh ("Quản trị viên", "Giám thị 1") giữ nguyên */
function callName(name: string) {
  if (/^(quản trị|giám thị|admin)/i.test(name.trim()) || /\d/.test(name)) return name.trim();
  return name.trim().split(/\s+/).slice(-1)[0];
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { alerts, cameras, statuses, connection } = useLive();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [view, setView] = useState<Alert | null>(null);
  const nav = useNavigate();
  const newest = alerts[0]?.id;
  const handled = alerts.filter((a) => a.status !== 'moi').length;

  useEffect(() => {
    api.stats.dashboard().then(setStats);
  }, [newest, handled, Object.keys(statuses).length]);
  useEffect(() => {
    const t = setInterval(() => api.stats.dashboard().then(setStats), 15000);
    return () => clearInterval(t);
  }, []);

  const recent = alerts.slice(0, 5);
  const hour = new Date().getHours();
  const greet = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const chart = useMemo(() => stats?.perHour.map((p) => ({ hour: p.hour, chuY: p.total - p.cao, cao: p.cao })) ?? [], [stats]);
  const typeData = useMemo(
    () => stats?.perType.map((p) => ({ name: typeShort(p.type), count: p.count, color: p.type === 'phone_near_hand' ? LEVEL_COLOR.cao : p.type === 'phone_in_work_area' ? LEVEL_COLOR.trung_binh : LEVEL_COLOR.thong_tin })) ?? [],
    [stats],
  );
  const online = connection.state === 'connected';

  return (
    <div className="page dashboard">
      <div className="welcome">
        <div>
          <h2>
            {greet}, {callName(user?.name ?? '')}
          </h2>
          <p className="muted">Chào mừng trở lại! Đây là tình hình các phòng thi hôm nay, {fmtDate(Date.now())}.</p>
        </div>
        <span className={`sys-chip ${online ? 'ok' : 'warn'}`}>
          <i /> {online ? 'Hệ thống trực tuyến' : 'Đang kết nối lại'}
        </span>
      </div>

      {cameras.length === 0 && (
        <EmptyState
          icon={<Cctv size={32} />}
          title="Chưa có dữ liệu giám sát"
          text="Chưa thêm camera nên bảng điều khiển đang trống. Thêm camera hoặc kết nối điện thoại để bắt đầu. Chế độ thật không dùng dữ liệu mẫu."
        >
          <AddCameraCta />
        </EmptyState>
      )}

      <div className="stat-grid">
        <StatCard tone="blue" icon={<Cctv size={20} />} label="Camera đang chạy" value={stats ? `${stats.camerasRunning}/${stats.camerasTotal}` : '–'} trend={stats?.trend.cameras ?? 0} sub="ổn định" />
        <StatCard tone="red" icon={<BellRing size={20} />} label="Cảnh báo hôm nay" value={stats?.alertsToday ?? '–'} trend={stats?.trend.alerts ?? 0} spark={stats?.spark.alerts ?? []} goodWhenUp={false} />
        <StatCard tone="green" icon={<CheckCircle2 size={20} />} label="Đã xác nhận" value={stats?.confirmedToday ?? '–'} trend={stats?.trend.confirmed ?? 0} spark={stats?.spark.confirmed ?? []} neutral />
        <StatCard tone="slate" icon={<XCircle size={20} />} label="Đã bỏ qua" value={stats?.dismissedToday ?? '–'} trend={stats?.trend.dismissed ?? 0} spark={stats?.spark.dismissed ?? []} neutral />
      </div>

      <div className="dash-row dash-actions">
        <Card
          title="Cảnh báo gần đây"
          icon={<BellRing size={18} />}
          actions={
            <Link to="/lich-su" className="link small">
              Xem tất cả <ChevronRight size={14} />
            </Link>
          }
        >
          <div className="recent-list">
            {recent.length === 0 && <div className="muted small">Chưa có cảnh báo.</div>}
            {recent.map((a) => (
              <button key={a.id} className="recent-item" onClick={() => setView(a)}>
                <LevelIcon level={a.level} size={18} />
                <span className="grow">
                  <strong>{a.message}</strong>
                  <small>
                    {a.cameraName} · {timeAgo(a.ts)}
                  </small>
                </span>
                <span className="col-end">
                  <span className="chip chip-blue">{a.room}</span>
                  {a.status === 'moi' ? <LevelBadge level={a.level} /> : <StatusBadge status={a.status} />}
                </span>
              </button>
            ))}
          </div>
        </Card>
        <Card
          title="Trạng thái camera"
          icon={<Cctv size={18} />}
          actions={
            <Link to="/giam-sat/he-thong" className="link small">
              Mở lưới <ChevronRight size={14} />
            </Link>
          }
        >
          <div className="cam-status-list">
            {cameras.length === 0 && <div className="muted small">Chưa có camera.</div>}
            {cameras.map((c) => {
              const s = statuses[c.id];
              const on = c.enabled && (s?.online ?? false);
              return (
                <button key={c.id} className="cam-status" onClick={() => nav(`/giam-sat/camera/${c.id}`)}>
                  <span className={`dot ${on ? 'on' : 'off'}`} />
                  <span className="grow">
                    <strong>{c.name}</strong>
                    <small>{c.room}</small>
                  </span>
                  <span className={`chip ${on ? 'chip-green' : 'chip-gray'}`}>{on ? 'Trực tuyến' : 'Ngoại tuyến'}</span>
                  <AnalysisRateCell cameraId={c.id} on={on} />
                </button>
              );
            })}
          </div>
        </Card>
        <Card title="Thao tác nhanh" icon={<ChevronRight size={18} />}>
          <div className="quick-actions">
            <Link to="/giam-sat/he-thong" className="btn btn-primary btn-block btn-lg">
              <Cctv size={18} /> Mở lưới camera
            </Link>
            <Link to="/lich-su?status=moi" className="btn btn-block btn-lg">
              <BellRing size={18} /> Cảnh báo chưa xử lý
            </Link>
            <Link to="/phan-tich" className="btn btn-block btn-lg">
              <ScanSearch size={18} /> Phân tích ảnh / video
            </Link>
            <p className="muted quick-note">Hệ thống chỉ đưa ra nghi vấn – giám thị kiểm tra và quyết định.</p>
          </div>
        </Card>
      </div>
      <div className="dash-row dash-charts">
        <Card title="Tổng quan cảnh báo theo giờ" icon={<Activity size={18} />} className="span-2" actions={<span className="muted small">Hôm nay</span>}>
          <div className="chart-box">
            {(!chart.length || cameras.length === 0) ? (
              <div className="empty">Chưa có số liệu. Số liệu sẽ xuất hiện sau khi hệ thống có camera và cảnh báo thật.</div>
            ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chart} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 13, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 13, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 13 }} />
                <Area type="monotone" dataKey="chuY" name="Cần chú ý (Trung bình + Thông tin)" stroke="#F59E0B" strokeWidth={2.5} fill="#F59E0B" fillOpacity={0.12} />
                <Area type="monotone" dataKey="cao" name="Nghi vấn mức Cao" stroke="#DC2626" strokeWidth={2.5} fill="#DC2626" fillOpacity={0.12} />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card title="Theo loại cảnh báo" actions={<span className="muted small">Hôm nay</span>}>
          <div className="chart-box">
            {(!typeData.length || cameras.length === 0) ? (
              <div className="empty">Chưa có số liệu theo loại cảnh báo.</div>
            ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={typeData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" horizontal={false} />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 13, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 13, fill: 'var(--text)' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} contentStyle={{ borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)' }} />
                <Bar dataKey="count" name="Số cảnh báo" radius={[0, 8, 8, 0]} barSize={22}>
                  {typeData.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <AlertDetailModal alert={view} onClose={() => setView(null)} />
    </div>
  );
}

/** Cột tốc độ phân tích (thay cho FPS video): "~1 khung/giây" */
function AnalysisRateCell({ cameraId, on }: { cameraId: string; on: boolean }) {
  const r = useAnalysisRate(cameraId);
  return (
    <span className="small fps" title={r == null ? 'Chưa có kết quả phân tích' : 'Tốc độ AI phân tích (video gốc chạy riêng)'}>
      {on && r != null ? `~${fmtRateNumber(r)} khung/giây` : '—'}
    </span>
  );
}
