/**
 * ApiClient gọi backend thật CMC AI (FastAPI) theo API_CONTRACT.md.
 * Bật bằng VITE_API_MODE=real. Toàn bộ chỗ "lệch" giữa backend và UI được xử lý tại đây,
 * các trang không phải biết đang chạy mock hay thật.
 */
import type { ApiClient, ConnectionTestResult, PhoneCameraCreated, SystemHealthPayload, SystemModelPayload, WebcamInfo } from '../api';
import type { Alert, Paged, Session } from '../../types';
import { API_BASE, TOKEN_KEY, getToken, mediaUrl, notifyUnauthorized } from './config';
import { ApiError } from './errors';
export { ApiError } from './errors';
import { httpAnalyze, httpCancelJob, httpGetJob, httpStartJob, httpSubscribeJob } from './analysisJobs';

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.message === 'string') return j.message;
    if (typeof j?.detail === 'string') return j.detail; // phòng khi lỗi validate mặc định của FastAPI
  } catch {
    /* body không phải JSON (vd 500 "Internal Server Error") */
  }
  return res.status >= 500 ? `Máy chủ gặp lỗi (${res.status}). Vui lòng thử lại.` : `Lỗi ${res.status}`;
}

async function req<T>(method: string, path: string, body?: unknown, opts: { auth401?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method,
    signal: opts.signal,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await errorMessage(res);
    // Token hết hạn / bị thu hồi -> đăng xuất (trừ chính lệnh đăng nhập)
    if (res.status === 401 && opts.auth401 !== false && token) {
      notifyUnauthorized();
      // Đang chuyển về trang đăng nhập: treo lời gọi thay vì ném lỗi, để các trang không báo lỗi thừa
      return new Promise<T>(() => {});
    }
    throw new ApiError(msg, res.status);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const qs = (o: object) => {
  const p = new URLSearchParams();
  Object.entries(o).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/**
 * snapshotUrl/clipUrl là /media/... tính từ gốc server.
 * clipUrl = null nghĩa là clip đang được ghép; backend sẽ đẩy `alert_update` kèm clipUrl sau ~3–5 giây.
 */
export function normAlert(a: Alert): Alert {
  return { ...a, snapshotUrl: mediaUrl(a.snapshotUrl), clipUrl: a.clipUrl === null ? null : mediaUrl(a.clipUrl) };
}

export const httpApi: ApiClient = {
  auth: {
    async login(email, password) {
      const s = await req<Session>('POST', '/auth/login', { email, password }, { auth401: false });
      localStorage.setItem(TOKEN_KEY, s.token);
      return s;
    },
    async logout() {
      localStorage.removeItem(TOKEN_KEY);
    },
    async me() {
      const token = getToken();
      if (!token) return null;
      try {
        const s = await req<Session>('GET', '/auth/me', undefined, { auth401: false });
        return { token: s.token || token, user: s.user };
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) localStorage.removeItem(TOKEN_KEY);
        return null;
      }
    },
  },
  cameras: {
    list: () => req('GET', '/cameras'),
    // webcam: backend nhận "0", "webcam://0" hoặc "/dev/video0" -> gửi nguyên giá trị của form ("webcam://0")
    create: (c) => req('POST', '/cameras', c),
    update: (id, p) => req('PATCH', `/cameras/${encodeURIComponent(id)}`, p),
    remove: (id) => req('DELETE', `/cameras/${encodeURIComponent(id)}`),
    async testConnection(s) {
      // RTSP sai địa chỉ có thể làm máy chủ chờ rất lâu -> tự ngắt sau 25 giây
      const ac = new AbortController();
      const timer = window.setTimeout(() => ac.abort(), 25000);
      try {
        return await req<ConnectionTestResult>('POST', '/cameras/test-connection', { sourceType: s.sourceType, sourceUrl: s.sourceUrl, cameraId: s.cameraId }, { signal: ac.signal });
      } catch (e) {
        if ((e as Error).name === 'AbortError') return { ok: false, message: 'Hết thời gian chờ (25 giây). Kiểm tra lại địa chỉ hoặc mạng.' };
        return { ok: false, message: (e as Error).message };
      } finally {
        clearTimeout(timer);
      }
    },
    status: () => req('GET', '/cameras/status'),
    diag: (id) => req('GET', `/cameras/${encodeURIComponent(id)}/diag`),
    async listWebcams() {
      try {
        const r = await req<WebcamInfo[]>('GET', '/sources/webcams');
        return Array.isArray(r) ? r : [];
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 501)) return [];
        throw e;
      }
    },
    createPhone: (body) => req<PhoneCameraCreated>('POST', '/cameras/phone', body ?? {}),
  },
  alerts: {
    async list(f) {
      const r = await req<Paged<Alert>>('GET', `/alerts${qs(f)}`);
      return { ...r, items: r.items.map(normAlert) };
    },
    recent: async (limit) => (await req<Alert[]>('GET', `/alerts/recent${qs({ limit })}`)).map(normAlert),
    async get(id) {
      try {
        return normAlert(await req<Alert>('GET', `/alerts/${encodeURIComponent(id)}`));
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
    updateStatus: async (id, status, note) => normAlert(await req<Alert>('PATCH', `/alerts/${encodeURIComponent(id)}`, note === undefined ? { status } : { status, note })),
  },
  rules: {
    get: () => req('GET', '/rules'),
    update: (s) => req('PUT', '/rules', s),
    reset: () => req('POST', '/rules/reset'),
  },
  users: {
    list: () => req('GET', '/users'),
    create: (u) => req('POST', '/users', u),
    async update(id, p) {
      const body = { ...p };
      if (!body.password) delete body.password;
      try {
        return await req('PATCH', `/users/${encodeURIComponent(id)}`, body);
      } catch (e) {
        // Backend trả 409 khi trùng email; giữ câu báo dễ hiểu kể cả khi thiếu message
        if (e instanceof ApiError && e.status === 409) throw new ApiError(e.message.startsWith('Lỗi') ? 'Email đã tồn tại' : e.message, 409);
        throw e;
      }
    },
    remove: (id) => req('DELETE', `/users/${encodeURIComponent(id)}`),
  },
  // Backend tính theo giờ Việt Nam (Asia/Saigon) -> dùng thẳng
  stats: { dashboard: () => req('GET', '/stats/dashboard') },
  analysis: {
    analyze: httpAnalyze,
    startJob: httpStartJob,
    getJob: httpGetJob,
    cancelJob: httpCancelJob,
    subscribeJob: httpSubscribeJob,
  },
  models: { list: () => req('GET', '/models') },
  system: {
    async model(cameraId) {
      const q = cameraId ? `?cameraId=${encodeURIComponent(cameraId)}` : '';
      const paths = [
        `/system/model${q}`,
        `/system/status${q}`,
        cameraId ? `/cameras/${encodeURIComponent(cameraId)}/model` : '',
        cameraId ? `/cameras/${encodeURIComponent(cameraId)}/stats` : '',
      ].filter(Boolean);
      for (const path of paths) {
        try {
          return await req<SystemModelPayload>('GET', path);
        } catch (e) {
          if (e instanceof ApiError && (e.status === 404 || e.status === 405)) continue;
          throw e;
        }
      }
      return null;
    },
    async health() {
      try {
        return await req<SystemHealthPayload>('GET', '/health');
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
        throw e;
      }
    },
  },
};

