/** Kênh realtime giả lập, hành xử như WebSocket: kết nối, mất kết nối, tự kết nối lại có backoff */
import type { ConnectionState, RealtimeEvents } from '../../types';
import type { RealtimeClient } from '../api';
import { Emitter } from '../../lib/emitter';
import { db } from './db';
import { simulator } from './simulator';

export class MockRealtimeClient implements RealtimeClient {
  private em = new Emitter<RealtimeEvents>();
  private unsubs: (() => void)[] = [];
  private _state: ConnectionState = 'disconnected';
  private retryTimer: number | undefined;
  private attempt = 0;
  private failUntilAttempt = 0;
  private connectTimer: number | undefined;

  get state() {
    return this._state;
  }

  on<K extends keyof RealtimeEvents>(type: K, cb: (p: RealtimeEvents[K]) => void) {
    return this.em.on(type, cb);
  }

  private setState(state: ConnectionState, nextRetryMs?: number) {
    this._state = state;
    this.em.emit('connection', { state, attempt: this.attempt, nextRetryMs });
  }

  connect() {
    if (this._state === 'connected' || this._state === 'connecting') return;
    this.setState(this.attempt > 0 ? 'reconnecting' : 'connecting');
    clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      if (this.attempt > 0 && this.attempt < this.failUntilAttempt) {
        this.scheduleRetry();
        return;
      }
      this.attempt = 0;
      this.bindBus();
      simulator.start();
      this.setState('connected');
    }, 600);
  }

  private bindBus() {
    this.unbindBus();
    (['detections', 'alert', 'alert_update', 'camera_status'] as const).forEach((t) => {
      this.unsubs.push(db.bus.on(t, (p) => this.em.emit(t, p as never)));
    });
  }

  private unbindBus() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  private scheduleRetry() {
    this.attempt++;
    const wait = Math.min(8000, 1000 * 2 ** (this.attempt - 1));
    this.setState('reconnecting', wait);
    this._state = 'reconnecting';
    this.retryTimer = window.setTimeout(() => {
      this._state = 'disconnected';
      this.connect();
    }, wait);
  }

  disconnect() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    this.unbindBus();
    simulator.stop();
    this.attempt = 0;
    this.setState('disconnected');
  }

  /** Demo: mất kết nối, lần thử 1 thất bại, lần thử 2 thành công */
  simulateDrop() {
    if (this._state !== 'connected') return;
    this.unbindBus();
    simulator.stop();
    this.attempt = 0;
    this.failUntilAttempt = 2;
    this.setState('disconnected');
    this.scheduleRetry();
  }
}
