/**
 * Trang mở trên điện thoại (sau khi quét mã QR): gửi khung hình về backend.
 * Không cần đăng nhập quản trị — token trên URL chỉ được phép đẩy hình cho đúng camera.
 */
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Camera, CameraOff, SwitchCamera } from 'lucide-react';
import { fmtLag } from '../lib/format';

function fmtPhoneLag(ms: number): string {
  if (ms < 100) return `Trễ ${Math.max(1, Math.round(ms))} ms`;
  return fmtLag(ms);
}

const MAX_W = 960;
const FPS = 5;
const QUALITY = 0.72;
type Facing = 'environment' | 'user';

export default function PhonePushPage() {
  const [q] = useSearchParams();
  const cameraId = q.get('c') || '';
  const token = q.get('t') || '';
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');
  const [sent, setSent] = useState(0);
  const [via, setVia] = useState<'ws' | 'http' | ''>('');
  const [lagMs, setLagMs] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number>();
  const nRef = useRef(0);
  const facingRef = useRef<Facing>('environment');

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = undefined;
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    wsRef.current = null;
    stopTracks();
    setRunning(false);
    setVia('');
  };

  useEffect(() => () => stop(), []);

  const pushUrl = (kind: 'ws' | 'http') => {
    const proto = kind === 'ws' ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : location.protocol;
    const path = kind === 'ws' ? `/ws/cameras/${encodeURIComponent(cameraId)}/push` : `/api/cameras/${encodeURIComponent(cameraId)}/frame`;
    return `${proto}//${location.host}${path}?token=${encodeURIComponent(token)}`;
  };

  const openCamera = async (mode: Facing) => {
    const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
    try {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { exact: mode }, ...base }, audio: false });
    } catch {
      return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode }, ...base }, audio: false });
    }
  };

  const attachStream = async (s: MediaStream) => {
    streamRef.current = s;
    if (videoRef.current) {
      videoRef.current.srcObject = s;
      await videoRef.current.play().catch(() => {});
    }
  };

  const sendFrame = async () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c || v.readyState < 2) return;
    const t0 = performance.now();
    const scale = Math.min(1, MAX_W / (v.videoWidth || MAX_W));
    c.width = Math.max(2, Math.round((v.videoWidth || 640) * scale / 2) * 2);
    c.height = Math.max(2, Math.round((v.videoHeight || 480) * scale / 2) * 2);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', QUALITY));
    if (!blob) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(await blob.arrayBuffer());
      nRef.current += 1;
      setSent(nRef.current);
      setVia('ws');
      setLagMs(performance.now() - t0);
      return;
    }
    const r = await fetch(pushUrl('http'), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
    if (r.status === 204 || r.ok) {
      nRef.current += 1;
      setSent(nRef.current);
      setVia('http');
      setLagMs(performance.now() - t0);
    } else if (r.status === 401) {
      setErr('Phiên trên mã QR đã hết hạn. Tạo mã mới trên máy tính.');
      stop();
    }
  };

  const start = async () => {
    setErr('');
    if (!cameraId || !token) {
      setErr('Thiếu mã camera hoặc token. Hãy quét lại mã QR từ CMC AI.');
      return;
    }
    try {
      const s = await openCamera(facingRef.current);
      await attachStream(s);
      try {
        const ws = new WebSocket(pushUrl('ws'));
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => setVia('ws');
        ws.onerror = () => {
          /* sẽ chuyển sang HTTP khi gửi khung */
        };
        wsRef.current = ws;
      } catch {
        wsRef.current = null;
      }
      nRef.current = 0;
      setSent(0);
      setLagMs(null);
      setRunning(true);
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = window.setInterval(() => void sendFrame().catch(() => {}), 1000 / FPS);
    } catch {
      setErr('Không mở được camera. Trong Safari hãy cho phép dùng camera, và trang phải mở bằng https (hoặc bạn đã chấp nhận chứng chỉ).');
    }
  };

  const flipCamera = async () => {
    const next: Facing = facingRef.current === 'environment' ? 'user' : 'environment';
    setSwitching(true);
    setErr('');
    try {
      const s = await openCamera(next);
      stopTracks();
      await attachStream(s);
      facingRef.current = next;
    } catch {
      setErr('Không đổi được camera. Hãy cho phép dùng camera và thử lại.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="phone-push">
      <header className="phone-push-head">
        <strong>CMC AI</strong>
        <span>Gửi hình từ điện thoại</span>
      </header>
      <video ref={videoRef} className="phone-push-video" muted playsInline autoPlay />
      <canvas ref={canvasRef} className="phone-push-work" aria-hidden />
      {err && <p className="phone-push-err">{err}</p>}
      <p className="muted small center phone-push-hint">Giữ điện thoại hướng ra phòng thi. Có thể khoá hướng dọc hoặc ngang.</p>

      <div className="phone-push-dock">
        <div className={`phone-push-live ${running ? 'on' : ''}`} role="status">
          {running ? (
            <>
              <i aria-hidden />
              <span>
                {!via
                  ? 'Đang kết nối…'
                  : `Đang phát${sent ? ` · ${sent} khung` : ''}${via === 'http' ? ' (HTTP)' : ''}${lagMs != null ? ` · ${fmtPhoneLag(lagMs)}` : ''}`}
              </span>
            </>
          ) : (
            <span>Camera chưa gửi hình</span>
          )}
        </div>
        {running && (
          <button type="button" className="btn btn-ghost phone-push-flip" onClick={() => void flipCamera()} disabled={switching}>
            <SwitchCamera size={18} /> Đổi camera trước/sau
          </button>
        )}
        <div className="phone-push-actions">
          {!running ? (
            <button type="button" className="btn btn-primary phone-push-start" onClick={() => void start()}>
              <Camera size={18} /> Bắt đầu phát
            </button>
          ) : (
            <button type="button" className="btn phone-push-stop" onClick={stop}>
              <CameraOff size={20} /> Dừng
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
