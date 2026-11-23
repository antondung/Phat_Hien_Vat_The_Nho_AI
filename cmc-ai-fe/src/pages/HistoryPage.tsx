import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Download, Eye, FilterX, Search, X, Calendar } from 'lucide-react';
import { api } from '../services';
import type { Alert, AlertFilter, AlertLevel, AlertStatus, AlertType, Paged } from '../types';
import { useLive } from '../context/LiveContext';
import { useToast } from '../context/ToastContext';
import { Card, Pagination, EmptyState } from '../components/ui/Controls';
import { LevelBadge, StatusBadge } from '../components/ui/Badges';
import { AlertThumb } from '../components/alerts/AlertThumb';
import { AlertDetailModal } from '../components/alerts/AlertDetailModal';
import { LEVEL_LABEL, STATUS_LABEL, TYPE_LABEL, trackText, typeLabel } from '../lib/labels';
import { fmtDate, fmtDateTime, fmtPct, fmtTime, startOfDay, toLocalInput } from '../lib/format';

const PAGE_SIZE = 10;
type Range = 'today' | '24h' | '7d' | 'all' | 'custom';

export default function HistoryPage() {
  const [sp, setSp] = useSearchParams();
  const { cameras, alerts: live, setAlertStatus } = useLive();
  const toast = useToast();
  const [data, setData] = useState<Paged<Alert> | null>(null);
  const [view, setView] = useState<Alert | null>(null);
  const [loading, setLoading] = useState(true);

  const get = (k: string) => sp.get(k) ?? '';
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    if (k !== 'page') n.delete('page');
    setSp(n, { replace: true });
  };
  const range = (get('range') || '7d') as Range;
  const page = Number(get('page') || 1);

  const filter = useMemo<AlertFilter>(() => {
    const now = Date.now();
    let from: number | undefined;
    let to: number | undefined;
    if (range === 'today') from = startOfDay(now);
    else if (range === '24h') from = now - 864e5;
    else if (range === '7d') from = now - 7 * 864e5;
    else if (range === 'custom') {
      from = get('from') ? new Date(get('from')).getTime() : undefined;
      to = get('to') ? new Date(get('to')).getTime() : undefined;
    }
    return {
      cameraId: get('cam') || undefined,
      room: get('room') || undefined,
      type: (get('type') || undefined) as AlertType | undefined,
      level: (get('level') || undefined) as AlertLevel | undefined,
      status: (get('status') || undefined) as AlertStatus | undefined,
      q: get('q') || undefined,
      from,
      to,
      page,
      pageSize: PAGE_SIZE,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);

  // tải lại khi bộ lọc đổi hoặc có cảnh báo mới / cập nhật trạng thái (đồng bộ với màn giám sát)
  const liveKey = live.length ? live[0].id + ':' + live.filter((a) => a.status !== 'moi').length : '';
  useEffect(() => {
    let alive = true;
    api.alerts.list(filter).then((d) => {
      if (alive) {
        setData(d);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [filter, liveKey]);

  const rooms = useMemo(() => [...new Set(cameras.map((c) => c.room))].sort(), [cameras]);
  const active = ['cam', 'room', 'type', 'level', 'status', 'q', 'from', 'to'].some((k) => sp.get(k)) || range !== '7d';

  const act = async (a: Alert, s: AlertStatus) => {
    const u = await setAlertStatus(a.id, s);
    setData((d) => d && { ...d, items: d.items.map((x) => (x.id === u.id ? u : x)) });
    toast(s === 'xac_nhan' ? 'Đã xác nhận cảnh báo' : 'Đã bỏ qua cảnh báo');
  };

  const exportCsv = async () => {
    const all = await api.alerts.list({ ...filter, page: 1, pageSize: 5000 });
    const head = ['Thời gian', 'Camera', 'Phòng', 'Thí sinh', 'Loại', 'Mức', 'Độ tin cậy', 'Trạng thái', 'Người xử lý', 'Ghi chú'];
    const rows = all.items.map((a) => [fmtDateTime(a.ts), a.cameraName, a.room, trackText(a.trackId), typeLabel(a.type, a.message), LEVEL_LABEL[a.level], fmtPct(a.confidence, 0), STATUS_LABEL[a.status], a.status !== 'moi' ? a.handledBy ?? '' : '', a.note ?? '']);
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    el.download = `lich-su-canh-bao-${fmtDate(Date.now()).replace(/\//g, '-')}.csv`;
    el.click();
    toast(`Đã xuất ${all.items.length} dòng CSV`);
  };

  return (
    <div className="page">
      <Card
        className="history"
        pad={false}
        title="Lịch sử cảnh báo"
        actions={
          <button className="btn btn-ghost btn-sm" onClick={exportCsv}>
            <Download size={15} /> Xuất CSV
          </button>
        }
      >
        <div className="filters">
          <div className="input-icon search-sm">
            <Search size={16} />
            <input value={get('q')} onChange={(e) => set('q', e.target.value)} placeholder="Tìm #id, camera, phòng, mô tả…" aria-label="Tìm kiếm" />
          </div>
          <select className="select" value={get('room')} onChange={(e) => set('room', e.target.value)} aria-label="Phòng">
            <option value="">Tất cả phòng</option>
            {rooms.map((r) => (
              <option key={r} value={r}>
                Phòng {r}
              </option>
            ))}
          </select>
          <select className="select" value={get('cam')} onChange={(e) => set('cam', e.target.value)} aria-label="Camera">
            <option value="">Tất cả camera</option>
            {cameras
              .filter((c) => !get('room') || c.room === get('room'))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.room}
                </option>
              ))}
          </select>
          <select className="select" value={get('type')} onChange={(e) => set('type', e.target.value)} aria-label="Loại">
            <option value="">Mọi loại</option>
            {(Object.keys(TYPE_LABEL) as AlertType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="select" value={get('level')} onChange={(e) => set('level', e.target.value)} aria-label="Mức">
            <option value="">Mọi mức</option>
            {(Object.keys(LEVEL_LABEL) as AlertLevel[]).map((t) => (
              <option key={t} value={t}>
                {LEVEL_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="select" value={get('status')} onChange={(e) => set('status', e.target.value)} aria-label="Trạng thái">
            <option value="">Mọi trạng thái</option>
            {(Object.keys(STATUS_LABEL) as AlertStatus[]).map((t) => (
              <option key={t} value={t}>
                {STATUS_LABEL[t]}
              </option>
            ))}
          </select>
          <div className="input-icon">
            <Calendar size={16} />
            <select className="select bare" value={range} onChange={(e) => set('range', e.target.value === '7d' ? '' : e.target.value)} aria-label="Khoảng thời gian">
              <option value="today">Hôm nay</option>
              <option value="24h">24 giờ qua</option>
              <option value="7d">7 ngày qua</option>
              <option value="all">Toàn bộ</option>
              <option value="custom">Tuỳ chọn…</option>
            </select>
          </div>
          {range === 'custom' && (
            <>
              <input className="input" type="datetime-local" value={get('from') || toLocalInput(Date.now() - 864e5)} onChange={(e) => set('from', e.target.value)} aria-label="Từ" />
              <input className="input" type="datetime-local" value={get('to') || toLocalInput(Date.now())} onChange={(e) => set('to', e.target.value)} aria-label="Đến" />
            </>
          )}
          {active && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
              <FilterX size={15} /> Xoá lọc
            </button>
          )}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ảnh</th>
                <th>Thời gian</th>
                <th>Camera · Phòng</th>
                <th>Thí sinh</th>
                <th>Loại</th>
                <th>Mức</th>
                <th>Tin cậy</th>
                <th>Trạng thái</th>
                <th className="right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {data?.items.map((a) => (
                <tr key={a.id} onClick={() => setView(a)} className="clickable">
                  <td>
                    <AlertThumb alert={a} width={56} />
                  </td>
                  <td>
                    <div className="strong">{fmtTime(a.ts)}</div>
                    <div className="muted small">{fmtDate(a.ts)}</div>
                  </td>
                  <td>
                    <div className="strong">{a.cameraName}</div>
                    <span className="chip chip-gray">{a.room}</span>
                  </td>
                  <td>
                    <span className="track-id">{trackText(a.trackId)}</span>
                  </td>
                  <td>{typeLabel(a.type, a.message)}</td>
                  <td>
                    <LevelBadge level={a.level} />
                  </td>
                  <td className="mono">{fmtPct(a.confidence, 0)}</td>
                  <td>
                    <StatusBadge status={a.status} />
                    {/* cảnh báo đã mở lại (chưa xử lý) thì không hiện người xử lý cũ */}
                    {a.status !== 'moi' && a.handledBy && <div className="muted tiny">{a.handledBy}</div>}
                  </td>
                  <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                    <div className="row-actions">
                    <button className="btn btn-sm btn-quiet" onClick={() => setView(a)} title="Xem ảnh chụp và clip">
                      <Eye size={15} /> Xem
                    </button>
                    {a.status === 'moi' && (
                      <>
                        <button className="btn btn-sm btn-confirm" onClick={() => act(a, 'xac_nhan')} title="Xác nhận nghi vấn">
                          <Check size={15} /> Xác nhận
                        </button>
                        <button className="btn btn-sm btn-quiet" onClick={() => act(a, 'bo_qua')} title="Bỏ qua">
                          <X size={15} /> Bỏ qua
                        </button>
                      </>
                    )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && data?.items.length === 0 && (
            <EmptyState
              icon={<FilterX size={32} />}
              title={active ? 'Không có cảnh báo phù hợp' : 'Chưa có cảnh báo'}
              text={active ? 'Thử nới rộng khoảng thời gian hoặc xoá bớt bộ lọc.' : 'Chưa có dữ liệu. Cảnh báo sẽ xuất hiện sau khi có camera và mô hình chạy — chế độ thật không dùng dữ liệu mẫu.'}
            />
          )}
        </div>
        {data && data.total > 0 && <Pagination page={page} total={data.total} pageSize={PAGE_SIZE} onPage={(p) => set('page', String(p))} />}
      </Card>
      <AlertDetailModal alert={view} onClose={() => setView(null)} onChanged={(u) => setData((d) => d && { ...d, items: d.items.map((x) => (x.id === u.id ? u : x)) })} />
    </div>
  );
}
