import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ConnectPhoneButton } from '../../pages/settings/ConnectPhoneButton';

export function AddCameraCta({ compact = false }: { compact?: boolean }) {
  const { hasRole } = useAuth();
  if (!hasRole('admin')) {
    return <p className="muted small">Nhờ quản trị viên thêm camera hoặc kết nối điện thoại để bắt đầu giám sát.</p>;
  }
  return (
    <div className="empty-actions">
      <Link to="/cai-dat/camera" className={`btn btn-primary ${compact ? 'btn-sm' : ''}`}>
        <Plus size={16} /> Thêm camera
      </Link>
      <ConnectPhoneButton className={`btn ${compact ? 'btn-sm' : ''} btn-ghost`} navOnClose />
    </div>
  );
}
