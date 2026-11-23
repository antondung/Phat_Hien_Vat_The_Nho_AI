import { Loader2, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useLive } from '../../context/LiveContext';

/** thông báo “Đã kết nối lại” tự ẩn sau ~3 giây; trạng thái mất kết nối thì giữ nguyên cho tới khi nối lại được */
const OK_NOTICE_MS = 3000;

export function ConnectionBanner() {
  const { connection } = useLive();
  const [left, setLeft] = useState(0);
  const [showOk, setShowOk] = useState(false);
  // ref (không phải state) để việc đặt lại cờ không huỷ hẹn giờ ẩn thông báo
  const wasDown = useRef(false);

  useEffect(() => {
    if (connection.state === 'reconnecting' && connection.nextRetryMs) {
      const until = Date.now() + connection.nextRetryMs;
      setLeft(Math.ceil(connection.nextRetryMs / 1000));
      const t = setInterval(() => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000))), 250);
      return () => clearInterval(t);
    }
  }, [connection]);

  useEffect(() => {
    if (connection.state !== 'connected') {
      if (connection.state === 'reconnecting' || connection.state === 'disconnected') wasDown.current = true;
      setShowOk(false);
      return;
    }
    if (!wasDown.current) return;
    wasDown.current = false;
    setShowOk(true);
    const t = setTimeout(() => setShowOk(false), OK_NOTICE_MS);
    return () => clearTimeout(t);
  }, [connection.state]);

  if (connection.state === 'connected') return showOk ? <div className="conn-banner ok" role="status">Đã kết nối lại – dữ liệu trực tiếp đã khôi phục.</div> : null;
  if (connection.state === 'connecting' && connection.attempt === 0) return null;
  return (
    <div className="conn-banner" role="alert">
      {connection.state === 'disconnected' ? <WifiOff size={18} /> : <Loader2 size={18} className="spin" />}
      <span>
        <strong>Mất kết nối tới máy chủ giám sát.</strong>{' '}
        {connection.state === 'reconnecting' ? (left > 0 ? `Tự động kết nối lại sau ${left}s (lần ${connection.attempt})…` : `Đang kết nối lại (lần ${connection.attempt})…`) : connection.state === 'connecting' ? 'Đang kết nối…' : 'Đã dừng thử lại.'}
      </span>
      <span className="muted small hide-sm">Lớp phủ AI tạm ẩn cho đến khi có kết nối.</span>
    </div>
  );
}
