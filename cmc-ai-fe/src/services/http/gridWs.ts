/**
 * Một WebSocket /ws/grid cho cả lưới camera (tránh 9 luồng MJPEG / giới hạn 6 kết nối HTTP/1.1).
 * Server: {type:'ready'} rồi {type:'frame',cameraId,ts,w,jpeg:base64}.
 * Client: {type:'subscribe',cameraIds,w,fps}.
 */
import { getToken, notifyUnauthorized, wsUrl } from './config';
import { GRID_SNAPSHOT_WIDTH } from '../media';

export const GRID_WS_FPS = 5;

export function gridWsUrl(opts?: { cameraIds?: string[]; w?: number; fps?: number }): string {
  const root = wsUrl().replace(/\/+$/, '');
  const base = root.endsWith('/grid') ? root : `${root}/grid`;
  const q = new URLSearchParams();
  const token = getToken() ?? '';
  if (token) q.set('token', token);
  if (opts?.cameraIds?.length) q.set('cams', opts.cameraIds.join(','));
  q.set('w', String(opts?.w ?? GRID_SNAPSHOT_WIDTH));
  q.set('fps', String(opts?.fps ?? GRID_WS_FPS));
  return `${base}?${q.toString()}`;
}

export type GridFeedStatus = 'connecting' | 'live' | 'snapshot';

type FrameCb = (url: string) => void;

export class GridWsSession {
  status: GridFeedStatus = 'connecting';
  private ws: WebSocket | null = null;
  private frames = new Map<string, string>();
  private listeners = new Map<string, Set<FrameCb>>();
  private statusListeners = new Set<(s: GridFeedStatus) => void>();
  private closed = false;
  private cameraIds: string[] = [];
  private fallbackTimer: number | undefined;
  private blobs = new Map<string, string>();
  private gen = 0;

  onStatus(cb: (s: GridFeedStatus) => void): () => void {
    this.statusListeners.add(cb);
    cb(this.status);
    return () => this.statusListeners.delete(cb);
  }

  subscribe(cameraId: string, cb: FrameCb): () => void {
    let set = this.listeners.get(cameraId);
    if (!set) this.listeners.set(cameraId, (set = new Set()));
    set.add(cb);
    const cur = this.frames.get(cameraId);
    if (cur) cb(cur);
    return () => {
      set!.delete(cb);
      if (!set!.size) this.listeners.delete(cameraId);
    };
  }

  frame(cameraId: string): string | undefined {
    return this.frames.get(cameraId);
  }

  private setStatus(s: GridFeedStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((cb) => cb(s));
  }

  private fallback() {
    if (this.closed) return;
    this.setStatus('snapshot');
  }

  start(cameraIds: string[], w = GRID_SNAPSHOT_WIDTH, fps = GRID_WS_FPS) {
    this.cameraIds = [...cameraIds];
    this.closed = false;
    const gen = ++this.gen;
    this.setStatus('connecting');
    this.fallbackTimer = window.setTimeout(() => { if (gen === this.gen) this.fallback(); }, 2000);
    try {
      this.ws = new WebSocket(gridWsUrl({ cameraIds, w, fps }));
    } catch {
      this.fallback();
      return;
    }
    this.ws.onopen = () => {
      if (gen !== this.gen) return;
      try {
        this.ws?.send(JSON.stringify({ type: 'subscribe', cameraIds: this.cameraIds, w, fps }));
      } catch {
        this.fallback();
      }
    };
    this.ws.onmessage = (ev) => {
      let msg: { type?: string; cameraId?: string; jpeg?: string };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'ready') {
        window.clearTimeout(this.fallbackTimer);
        this.setStatus('live');
        return;
      }
      if (msg.type !== 'frame' || !msg.cameraId || !msg.jpeg) return;
      window.clearTimeout(this.fallbackTimer);
      this.setStatus('live');
      let url: string;
      try {
        const bin = atob(msg.jpeg);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        const blob = new Blob([arr], { type: 'image/jpeg' });
        url = URL.createObjectURL(blob);
      } catch {
        url = `data:image/jpeg;base64,${msg.jpeg}`;
      }
      const prev = this.blobs.get(msg.cameraId);
      this.blobs.set(msg.cameraId, url);
      this.frames.set(msg.cameraId, url);
      this.listeners.get(msg.cameraId)?.forEach((cb) => cb(url));
      if (prev && prev.startsWith('blob:')) {
        // thu hồi sau khi <img> kịp đổi src
        window.setTimeout(() => URL.revokeObjectURL(prev), 1500);
      }
    };
    this.ws.onerror = () => { if (gen === this.gen) this.fallback(); };
    this.ws.onclose = (e) => {
      if (gen !== this.gen) return;
      if (e.code === 4401) notifyUnauthorized();
      if (!this.closed) this.fallback();
    };
  }

  resubscribe(cameraIds: string[], w = GRID_SNAPSHOT_WIDTH, fps = GRID_WS_FPS) {
    this.cameraIds = [...cameraIds];
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: 'subscribe', cameraIds: this.cameraIds, w, fps }));
        return;
      } catch {
        /* reconnect below */
      }
    }
    this.stop();
    this.start(cameraIds, w, fps);
  }

  stop() {
    this.closed = true;
    this.gen++;
    window.clearTimeout(this.fallbackTimer);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    for (const u of this.blobs.values()) {
      if (u.startsWith('blob:')) URL.revokeObjectURL(u);
    }
    this.blobs.clear();
    this.frames.clear();
  }
}
