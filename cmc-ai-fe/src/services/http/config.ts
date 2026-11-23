/**
 * Cấu hình kết nối backend thật (VITE_API_MODE=real).
 * Mặc định dùng đường dẫn tương đối (/api, /ws, /media) để đi qua proxy của Vite (xem vite.config.ts),
 * nên không vướng CORS và không phải đổi gì khi build chung domain với backend.
 */
const env = import.meta.env;

/** Gốc REST, vd "/api" (qua proxy) hoặc "http://localhost:8000/api" */
export const API_BASE = (env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

/** Gốc server (để ghép /media/...). Rỗng = cùng origin với trang. */
export const SERVER_ORIGIN = /^https?:\/\//.test(API_BASE) ? new URL(API_BASE).origin : '';

export function wsUrl(): string {
  const raw = env.VITE_WS_URL || '/ws';
  if (/^wss?:\/\//.test(raw)) return raw;
  if (SERVER_ORIGIN) return SERVER_ORIGIN.replace(/^http/, 'ws') + raw;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${raw}`;
}

/** snapshotUrl / clipUrl / mediaUrl của backend là "/media/..." tính từ gốc server, không nằm dưới /api */
export function mediaUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  if (/^(https?:|blob:|data:)/.test(u)) return u;
  return SERVER_ORIGIN + (u.startsWith('/') ? u : '/' + u);
}

export const TOKEN_KEY = 'cmc-ai.token';
export const getToken = () => localStorage.getItem(TOKEN_KEY);

/** Luồng MJPEG gốc của camera – dùng thẳng trong <img> */
export const cameraStreamUrl = (id: string, fps = 15) => `${API_BASE}/cameras/${encodeURIComponent(id)}/stream.mjpg?fps=${fps}&token=${encodeURIComponent(getToken() ?? '')}`;
/** Ảnh tĩnh mới nhất của camera. `width` (vd 480) nhờ BE thu nhỏ cho lưới 3×3. */
export const cameraSnapshotUrl = (id: string, opts?: { width?: number; quality?: number }) => {
  const q = new URLSearchParams();
  const token = getToken() ?? '';
  if (token) q.set('token', token);
  q.set('t', String(Date.now()));
  if (opts?.width) q.set('w', String(opts.width));
  if (opts?.quality) q.set('q', String(opts.quality));
  return `${API_BASE}/cameras/${encodeURIComponent(id)}/snapshot.jpg?${q.toString()}`;
};

/** Phát sự kiện "phiên hết hạn" để AuthContext đăng xuất và về trang đăng nhập */
export const UNAUTHORIZED_EVENT = 'cmc-ai:unauthorized';
export function notifyUnauthorized() {
  localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
}
