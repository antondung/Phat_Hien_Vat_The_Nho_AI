/**
 * Kênh realtime thật qua WebSocket: ws(s)://<host>/ws?token=...
 * Gói tin server -> client: {type, data} với type = detections | alert | alert_update | camera_status.
 * Tự kết nối lại với backoff luỹ thừa (1s, 2s, 4s… tối đa 15s).
 *
 * Token sai / hết hạn: backend accept rồi đóng với mã 4401 -> đăng xuất ngay, không thử lại.
 * Dự phòng: nếu bắt tay thất bại (chưa mở được kết nối, mã 1006 – vd proxy/máy chủ từ chối ở tầng HTTP),
 * client hỏi /auth/me; 401/403 thì cũng đăng xuất, còn lại thì nối lại với backoff.
 * `alert_update` cũng là kênh báo clip đã ghép xong (clipUrl từ null -> "/media/...").
 */
import type { Alert, ConnectionState, RealtimeEvents } from '../../types';
import type { RealtimeClient } from '../api';
import { Emitter } from '../../lib/emitter';
import { API_BASE, notifyUnauthorized, wsUrl } from './config';
import { normAlert } from './httpApi';

export class WsRealtimeClient implements RealtimeClient {
  private em = new Emitter<RealtimeEvents>();
  private ws: WebSocket | null = null;
  private _state: ConnectionState = 'disconnected';
  private attempt = 0;
  private timer: number | undefined;
  private manual = false;
  private token?: string;
  private cameraIds: string[] | null = null;

  get state() {
    return this._state;
  }

  on<K extends keyof RealtimeEvents>(type: K, cb: (p: RealtimeEvents[K]) => void) {
    return this.em.on(type, cb);
  }

  private set(state: ConnectionState, nextRetryMs?: number) {
    this._state = state;
    this.em.emit('connection', { state, attempt: this.attempt, nextRetryMs });
  }

  /** Chỉ nhận detections của một số camera (null = tất cả). Cảnh báo luôn nhận đủ. */
  subscribe(cameraIds: string[] | null) {
    this.cameraIds = cameraIds;
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 'subscribe', cameraIds }));
  }

  private async tokenStillValid(): Promise<boolean> {
    if (!this.token) return false;
    try {
      const r = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${this.token}` } });
      return r.status !== 401 && r.status !== 403;
    } catch {
      return true; // mất mạng: vẫn thử lại
    }
  }

  private authFailed() {
    this.manual = true;
    clearTimeout(this.timer);
    this.set('disconnected');
    notifyUnauthorized();
  }

  connect(token?: string) {
    clearTimeout(this.timer);
    this.manual = false;
    this.token = token ?? this.token;
    if (!this.token) return this.set('disconnected');
    this.set(this.attempt ? 'reconnecting' : 'connecting');
    const ws = new WebSocket(`${wsUrl()}?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.attempt = 0;
      this.set('connected');
      if (this.cameraIds) ws.send(JSON.stringify({ type: 'subscribe', cameraIds: this.cameraIds }));
    };
    ws.onmessage = (ev) => {
      let msg: { type: keyof RealtimeEvents; data: unknown };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return; // bỏ qua gói tin lỗi
      }
      if (msg.type === 'alert' || msg.type === 'alert_update') this.em.emit(msg.type, normAlert(msg.data as Alert));
      else if (msg.type === 'detections' || msg.type === 'camera_status') this.em.emit(msg.type, msg.data as never);
    };
    ws.onclose = async (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.manual) return this.set('disconnected');
      if (ev.code === 4401) return this.authFailed();
      if (!opened && !(await this.tokenStillValid())) return this.authFailed();
      if (this.manual) return;
      this.attempt++;
      const wait = Math.min(15000, 1000 * 2 ** (this.attempt - 1));
      this.set('reconnecting', wait);
      this.timer = window.setTimeout(() => this.connect(), wait);
    };
  }

  disconnect() {
    this.manual = true;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.set('disconnected');
  }
}
