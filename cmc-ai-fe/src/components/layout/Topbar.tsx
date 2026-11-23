import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, Menu, Moon, Search, Sun, Volume2, VolumeX } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useLive } from '../../context/LiveContext';
import { PAGE_TITLES } from './nav';
import { LevelIcon } from '../ui/Badges';
import { timeAgo } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { MockModeBadge } from '../video/ModelStatusChip';

export function Topbar({ onMenu }: { onMenu(): void }) {
  const { theme, toggle } = useTheme();
  const { alerts, soundOn, setSoundOn, connection } = useLive();
  const { hasRole } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [openBell, setOpenBell] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const title = PAGE_TITLES.find(([p]) => loc.pathname.startsWith(p)) ?? ['', 'CMC AI', ''];

  const open = useMemo(() => alerts.filter((a) => a.status === 'moi' && a.level !== 'thong_tin'), [alerts]);

  useEffect(() => {
    const h = (e: MouseEvent) => bellRef.current && !bellRef.current.contains(e.target as Node) && setOpenBell(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <header className="topbar">
      <button className="icon-btn only-mobile" onClick={onMenu} aria-label="Mở menu">
        <Menu size={20} />
      </button>
      <div className="topbar-title">
        <h1>{title[1]}</h1>
        <p>{title[2]}</p>
      </div>
      <form
        className="search-pill"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          nav(`/lich-su?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <Search size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm camera, phòng, #ID…" aria-label="Tìm kiếm" />
      </form>
      <div className="topbar-actions">
        <MockModeBadge />
        <span className={`conn-chip conn-${connection.state}`} title="Trạng thái kết nối trực tiếp">
          <i />
          {connection.state === 'connected' ? 'Trực tiếp' : connection.state === 'disconnected' ? 'Ngoại tuyến' : 'Đang kết nối…'}
        </span>
        <button className="icon-btn" onClick={() => setSoundOn(!soundOn)} aria-label={soundOn ? 'Tắt âm báo' : 'Bật âm báo'} title={soundOn ? 'Âm báo: bật' : 'Âm báo: tắt'}>
          {soundOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
          <span className="icon-btn-label">{soundOn ? 'Âm báo: bật' : 'Âm báo: tắt'}</span>
        </button>
        <div className="bell-wrap" ref={bellRef}>
          <button className="icon-btn" onClick={() => setOpenBell((v) => !v)} aria-label={`Thông báo (${open.length} chưa xử lý)`}>
            <Bell size={18} />
            <span className="icon-btn-label">Cảnh báo</span>
            {open.length > 0 && <span className="bell-badge">{open.length > 99 ? '99+' : open.length}</span>}
          </button>
          {openBell && (
            <div className="dropdown bell-dd">
              <div className="dd-head">
                <strong>Cảnh báo chưa xử lý</strong>
                <span className="muted small">{open.length}</span>
              </div>
              {open.length === 0 && <div className="dd-empty">Không có cảnh báo cần xử lý</div>}
              {open.slice(0, 6).map((a) => (
                <button
                  key={a.id}
                  className="dd-item"
                  onClick={() => {
                    setOpenBell(false);
                    nav(`/giam-sat/camera/${a.cameraId}`);
                  }}
                >
                  <LevelIcon level={a.level} />
                  <span>
                    <strong>{a.message}</strong>
                    <small>
                      {a.cameraName} · {a.room} · {timeAgo(a.ts)}
                    </small>
                  </span>
                </button>
              ))}
              <button
                className="dd-foot"
                onClick={() => {
                  setOpenBell(false);
                  nav('/lich-su?status=moi');
                }}
              >
                Xem tất cả trong Lịch sử
              </button>
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={toggle} aria-label="Đổi giao diện sáng/tối" title={theme === 'light' ? 'Chuyển sang giao diện tối' : 'Chuyển sang giao diện sáng'}>
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          <span className="icon-btn-label">{theme === 'light' ? 'Giao diện tối' : 'Giao diện sáng'}</span>
        </button>
        {!hasRole('admin') && <span className="chip chip-blue hide-sm">Giám thị</span>}
      </div>
    </header>
  );
}
