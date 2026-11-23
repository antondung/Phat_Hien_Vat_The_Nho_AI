import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail, ShieldCheck, Activity, ScanEye, BellRing, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Brand } from '../components/ui/Logo';
import { homeFor } from '../components/layout/Guards';
import { SAMPLE_IMAGE_URL } from '../scene/sceneModel';
import { API_MODE } from '../services';

const DEMO_MOCK = [
  { email: 'admin@examguard.vn', password: 'admin123', role: 'Quản trị viên', desc: 'Toàn quyền: dashboard, cấu hình, người dùng' },
  { email: 'giamthi@examguard.vn', password: 'giamthi123', role: 'Giám thị', desc: 'Giám sát camera, xử lý cảnh báo' },
];
/** Tài khoản mẫu do backend seed sẵn */
const DEMO_REAL = [
  { email: 'admin@cmc.edu.vn', password: 'admin123', role: 'Quản trị viên', desc: 'Toàn quyền: dashboard, cấu hình, người dùng' },
  { email: 'giamthi@cmc.edu.vn', password: 'giamthi123', role: 'Giám thị', desc: 'Giám sát camera, xử lý cảnh báo' },
];
const DEMO = API_MODE === 'real' ? DEMO_REAL : DEMO_MOCK;

export default function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (e?: React.FormEvent, cred?: { email: string; password: string }) => {
    e?.preventDefault();
    const c = cred ?? { email, password };
    if (!c.email || !c.password) {
      setErr('Vui lòng nhập email và mật khẩu');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const u = await login(c.email, c.password);
      const from = loc.state?.from;
      nav(from && from !== '/dang-nhap' ? from : homeFor(u.role), { replace: true });
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Đăng nhập thất bại');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <section className="login-hero">
        <Brand tone="dark" />
        <div className="hero-copy">
          <h1>Giám sát phòng thi thông minh bằng AI</h1>
          <p>Phát hiện hành vi nghi vấn theo thời gian thực với YOLO và YOLO Pose — hỗ trợ giám thị, không thay thế giám thị.</p>
        </div>
        <div className="hero-shot">
          <img src={SAMPLE_IMAGE_URL} alt="Khung hình camera phòng thi" />
          <span className="live-chip">
            <i /> Trực tiếp · P.503.1
          </span>
          <span className="hero-tag">
            <ScanEye size={14} /> 11 thí sinh · 0 nghi vấn
          </span>
        </div>
        <ul className="hero-feats">
          <li>
            <Activity size={18} /> Theo dõi đa camera, đa phòng
          </li>
          <li>
            <BellRing size={18} /> Cảnh báo phân mức: Cao · Trung bình · Thông tin
          </li>
          <li>
            <ShieldCheck size={18} /> Ẩn danh thí sinh – chỉ hiển thị #ID
          </li>
        </ul>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="only-mobile">
            <Brand />
          </div>
          <h2>Đăng nhập</h2>
          <p className="muted">Chào mừng trở lại! Đăng nhập để tiếp tục.</p>
          <label className="field">
            <span className="field-label">Email</span>
            <div className="input-icon">
              <Mail size={17} />
              <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={API_MODE === 'real' ? 'ten@cmc.edu.vn' : 'ten@examguard.vn'} />
            </div>
          </label>
          <label className="field">
            <span className="field-label">Mật khẩu</span>
            <div className="input-icon">
              <Lock size={17} />
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
              <button type="button" className="input-btn" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {err && <div className="form-error">{err}</div>}
          <button className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <Loader2 size={18} className="spin" />} Đăng nhập
          </button>
          <div className="divider">
            <span>Tài khoản demo</span>
          </div>
          <div className="demo-accounts">
            {DEMO.map((d) => (
              <button
                type="button"
                key={d.email}
                className="demo-acc"
                disabled={busy}
                onClick={() => {
                  setEmail(d.email);
                  setPassword(d.password);
                  void submit(undefined, d);
                }}
              >
                <strong>{d.role}</strong>
                <span className="mono small">{d.email}</span>
                <span className="muted small">{d.desc}</span>
              </button>
            ))}
          </div>
          <p className="muted small center">{API_MODE === 'real' ? 'Đang kết nối máy chủ CMC AI – dữ liệu thật từ backend.' : 'Bản demo giao diện – dữ liệu được mô phỏng trên trình duyệt.'}</p>
        </form>
      </section>
    </div>
  );
}
