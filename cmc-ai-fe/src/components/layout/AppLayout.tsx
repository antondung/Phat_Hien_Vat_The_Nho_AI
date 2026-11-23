import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { LiveProvider, useLive } from '../../context/LiveContext';
import { resumeLocalPush, localPushStates, stopLocalPush } from '../../lib/localPush';
import { useAuth } from '../../context/AuthContext';
import { ConfirmModal } from '../ui/Modal';

export function AppLayout() {
  const [open, setOpen] = useState(false);
  const [askLogout, setAskLogout] = useState(false);
  const loc = useLocation();
  const { logout } = useAuth();
  const nav = useNavigate();
  useEffect(() => setOpen(false), [loc.pathname]);
  // Màn giám sát dùng khung vừa viewport; giao diện sáng/tối theo ThemeContext (đã lưu).
  const live = loc.pathname.startsWith('/giam-sat');
  const single = loc.pathname.startsWith('/giam-sat/camera');
  const fit = live || single || loc.pathname.startsWith('/phan-tich');
  return (
    <LiveProvider>
      <LocalPushResumer />
      <div className="app">
        <Sidebar open={open} onNavigate={() => setOpen(false)} onLogout={() => setAskLogout(true)} />
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <div className="main">
          <Topbar onMenu={() => setOpen(true)} />
          <main className={`content ${live ? 'content-live content-fit' : 'content-page'} ${fit ? 'content-fit' : ''}`}>
            <Outlet />
          </main>
        </div>
      </div>
      <ConfirmModal
        open={askLogout}
        title="Đăng xuất"
        message="Bạn có chắc muốn đăng xuất khỏi CMC AI?"
        confirmText="Đăng xuất"
        onCancel={() => setAskLogout(false)}
        onConfirm={async () => {
          setAskLogout(false);
          await logout();
          nav('/dang-nhap', { replace: true });
        }}
      />
    </LiveProvider>
  );
}

/** Chạy lại các camera "gửi hình qua trình duyệt" đã lưu; dừng camera đã bị xoá. */
function LocalPushResumer() {
  const { cameras, ready } = useLive();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const ids = new Set(cameras.map((c) => c.id));
    if (!done) {
      resumeLocalPush(ids);
      setDone(true);
      return;
    }
    for (const st of localPushStates()) if (!ids.has(st.cameraId)) stopLocalPush(st.cameraId);
  }, [ready, cameras, done]);
  return null;
}
