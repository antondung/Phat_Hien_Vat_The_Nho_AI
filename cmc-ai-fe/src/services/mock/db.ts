/** "CSDL" giả lập: bộ nhớ + localStorage */
import type { Alert, Camera, RulesSettings, User } from '../../types';
import { load, save } from './storage';
import { defaultRules, seedAlerts, seedCameras, seedUsers } from './seed';
import { Emitter } from '../../lib/emitter';
import type { RealtimeEvents } from '../../types';

const MAX_ALERTS = 1500;

class MockDb {
  users: User[] = load('users', seedUsers);
  cameras: Camera[] = load('cameras', seedCameras);
  rules: RulesSettings = load('rules', defaultRules);
  alerts: Alert[] = load('alerts', () => seedAlerts(this.cameras, this.users));

  /** "bus" nội bộ: mock API phát sự kiện qua đây, mock WebSocket chuyển tiếp cho UI */
  bus = new Emitter<RealtimeEvents>();

  private alertTimer: number | undefined;

  persist(key: 'users' | 'cameras' | 'rules') {
    save(key, this[key]);
  }

  persistAlerts() {
    // gom ghi để tránh ghi localStorage quá dày
    if (this.alertTimer) return;
    this.alertTimer = window.setTimeout(() => {
      this.alertTimer = undefined;
      if (this.alerts.length > MAX_ALERTS) this.alerts.length = MAX_ALERTS;
      save('alerts', this.alerts);
    }, 800);
  }
}

export const db = new MockDb();
