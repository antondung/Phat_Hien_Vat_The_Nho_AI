import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Smartphone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AddPhoneCameraModal } from './AddPhoneCameraModal';

/** Nút giám sát (admin): mở cùng hộp thoại thêm camera điện thoại, rồi chuyển tới Camera đơn. */
export function ConnectPhoneButton({ className, navOnClose = false }: { className?: string; navOnClose?: boolean }) {
  const { hasRole } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const pending = useRef<string | null>(null);
  if (!hasRole('admin')) return null;

  const go = (id: string) => nav(`/giam-sat/camera/${id}`);

  return (
    <>
      <button type="button" className={className ?? 'btn btn-sm btn-ghost-dark'} onClick={() => setOpen(true)}>
        <Smartphone size={16} /> Kết nối điện thoại
      </button>
      <AddPhoneCameraModal
        open={open}
        onClose={() => {
          setOpen(false);
          const id = pending.current;
          pending.current = null;
          if (navOnClose && id) go(id);
        }}
        onCreated={(id) => {
          pending.current = id;
          if (!navOnClose) go(id);
        }}
      />
    </>
  );
}
