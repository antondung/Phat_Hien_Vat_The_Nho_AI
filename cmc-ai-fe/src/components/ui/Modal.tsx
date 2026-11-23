import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  title: ReactNode;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  dark?: boolean;
  className?: string;
}

export function Modal({ open, title, onClose, children, footer, width = 560, dark, className }: Props) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    document.body.classList.add('modal-open');
    const n = Number(document.body.dataset.modalCount || 0) + 1;
    document.body.dataset.modalCount = String(n);
    return () => {
      window.removeEventListener('keydown', k);
      const left = Math.max(0, Number(document.body.dataset.modalCount || 1) - 1);
      document.body.dataset.modalCount = String(left);
      if (left === 0) document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${dark ? 'modal-dark' : ''} ${className || ''}`.trim()} style={{ maxWidth: width }} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Đóng">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmModal({ open, title, message, onCancel, onConfirm, danger = true, confirmText = 'Xác nhận' }: { open: boolean; title: string; message: ReactNode; onCancel(): void; onConfirm(): void; danger?: boolean; confirmText?: string }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onCancel}>
            Huỷ
          </button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="muted">{message}</p>
    </Modal>
  );
}
