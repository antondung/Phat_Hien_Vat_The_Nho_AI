import { Navigate, Outlet, useLocation, Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import type { Role } from '../../types';
import { useAuth } from '../../context/AuthContext';

export function homeFor(role: Role) {
  return role === 'admin' ? '/dashboard' : '/giam-sat/he-thong';
}

export function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="boot">Đang tải…</div>;
  if (!user) return <Navigate to="/dang-nhap" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: Role[] }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role))
    return (
      <div className="forbidden">
        <ShieldAlert size={44} />
        <h2>Không có quyền truy cập</h2>
        <p className="muted">Trang này chỉ dành cho Quản trị viên. Tài khoản của bạn là Giám thị.</p>
        <Link className="btn btn-primary" to={user ? homeFor(user.role) : '/dang-nhap'}>
          Về trang chính
        </Link>
      </div>
    );
  return <Outlet />;
}

export function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? homeFor(user.role) : '/dang-nhap'} replace />;
}
