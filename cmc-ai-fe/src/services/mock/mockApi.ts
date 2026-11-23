/** Cài đặt ApiClient bằng dữ liệu giả lập (localStorage) */
import type { Alert, AlertFilter, AlertType, Camera, DashboardStats, ModelInfo, Paged, RulesSettings, Session, User } from '../../types';
import type { ApiClient, NewCamera, NewUser } from '../api';
import { db } from './db';
import { defaultRules } from './seed';
import { delay, load, remove, save } from './storage';
import { simulator, isReachable } from './simulator';
import { mockAnalyze, mockCancelJob, mockGetJob, mockStartJob, mockSubscribeJob } from './mockAnalysis';
import { startOfDay, uid } from '../../lib/format';

const lat = () => delay(120 + Math.random() * 180);
const strip = (u: User): User => {
  const { password: _pw, ...rest } = u;
  void _pw;
  return rest;
};

function applyFilter(list: Alert[], f: AlertFilter): Alert[] {
  const q = f.q?.trim().toLowerCase();
  return list.filter(
    (a) =>
      (!f.cameraId || a.cameraId === f.cameraId) &&
      (!f.room || a.room === f.room) &&
      (!f.type || a.type === f.type) &&
      (!f.level || a.level === f.level) &&
      (!f.status || a.status === f.status) &&
      (f.from == null || a.ts >= f.from) &&
      (f.to == null || a.ts <= f.to) &&
      (!q || `${a.message} ${a.cameraName} ${a.room} #${a.trackId}`.toLowerCase().includes(q)),
  );
}

export const mockApi: ApiClient = {
  auth: {
    async login(email, password) {
      await delay(450);
      const u = db.users.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
      if (!u || u.password !== password) throw new Error('Email hoặc mật khẩu không đúng.');
      if (!u.active) throw new Error('Tài khoản đã bị khoá. Liên hệ quản trị viên.');
      const s: Session = { token: 'mock.' + uid(), user: strip(u) };
      save('session', s);
      return s;
    },
    async logout() {
      remove('session');
    },
    async me() {
      const s = load<Session | null>('session', () => null);
      if (!s) return null;
      const u = db.users.find((x) => x.id === s.user.id && x.active);
      return u ? { ...s, user: strip(u) } : null;
    },
  },

  cameras: {
    async list() {
      await lat();
      return [...db.cameras];
    },
    async create(c: NewCamera) {
      await lat();
      const cam: Camera = { ...c, id: uid('cam-'), createdAt: Date.now() };
      db.cameras.push(cam);
      db.persist('cameras');
      return cam;
    },
    async update(id, patch) {
      await lat();
      const i = db.cameras.findIndex((c) => c.id === id);
      if (i < 0) throw new Error('Không tìm thấy camera');
      db.cameras[i] = { ...db.cameras[i], ...patch };
      db.persist('cameras');
      return db.cameras[i];
    },
    async remove(id) {
      await lat();
      db.cameras = db.cameras.filter((c) => c.id !== id);
      db.persist('cameras');
    },
    async testConnection({ sourceType, sourceUrl }) {
      await delay(900 + Math.random() * 700);
      if (sourceType === 'webcam') {
        if (!navigator.mediaDevices?.getUserMedia) return { ok: false, message: 'Trình duyệt không hỗ trợ webcam (getUserMedia).' };
        try {
          const s = await navigator.mediaDevices.getUserMedia({ video: true });
          const tr = s.getVideoTracks()[0];
          const st = tr?.getSettings();
          s.getTracks().forEach((t) => t.stop());
          return { ok: true, message: 'Đã truy cập được webcam.', resolution: st?.width ? `${st.width}×${st.height}` : undefined, fps: st?.frameRate };
        } catch {
          return { ok: false, message: 'Không truy cập được webcam (bị từ chối quyền hoặc không có thiết bị).' };
        }
      }
      if (sourceType === 'rtsp' || sourceType === 'http') {
        if (sourceType === 'rtsp' && !/^rtsps?:\/\//.test(sourceUrl) && !/^https?:\/\//.test(sourceUrl))
          return { ok: false, message: 'URL không hợp lệ. Ví dụ: rtsp://192.168.1.20:554/stream1 hoặc http://localhost:8080/video' };
        if (sourceType === 'http' && !/^https?:\/\/[^\s]+/.test(sourceUrl))
          return { ok: false, message: 'URL HTTP không hợp lệ. Ví dụ: http://localhost:8080/video' };
        if (!isReachable(sourceUrl)) return { ok: false, message: 'Hết thời gian chờ (timeout 5s) – không kết nối được tới camera.' };
        return { ok: true, message: 'Kết nối thành công (mô phỏng).', latencyMs: Math.round(40 + Math.random() * 120), resolution: '1920×1080', fps: 25 };
      }
      if (sourceType === 'phone') {
        return { ok: true, message: 'Chế độ mô phỏng: camera điện thoại sẽ nhận hình khi mở trang trên điện thoại.', latencyMs: 80 };
      }
      if (!sourceUrl.trim()) return { ok: false, message: 'Chưa nhập đường dẫn tệp video.' };
      if (!/\.(mp4|avi|mov|mkv|webm)$/i.test(sourceUrl)) return { ok: false, message: 'Định dạng tệp không được hỗ trợ (mp4, avi, mov, mkv, webm).' };
      return { ok: true, message: 'Đọc được tệp video (mô phỏng).', resolution: '1280×720', fps: 30 };
    },
    async status() {
      return simulator.statuses();
    },
    async diag(id: string) {
      const st = simulator.statuses().find((s) => s.cameraId === id);
      return {
        cameraId: id,
        online: st?.online ?? true,
        fps: st?.fps ?? 24,
        latencyMs: st?.latencyMs ?? 40,
        updatedAt: Date.now(),
        detectFps: 8,
        framesRead: 100,
        analysedFrames: 80,
        lastDetectTs: Date.now(),
        lastObjects: 3,
        inferMs: 40,
        lastError: null,
        detector: 'running' as const,
      };
    },
    async listWebcams() {
      await lat();
      return [
        { index: 2, name: 'DroidCam Video', backend: 'dshow', url: 'webcam://dshow/2', urlByName: 'webcam://dshow/name/DroidCam%20Video', width: 1280, height: 720, inUse: false, hasPicture: true },
        { index: 0, name: 'DroidCam Source 1', backend: 'dshow', url: 'webcam://dshow/0', urlByName: 'webcam://dshow/name/DroidCam%20Source%201', width: 1280, height: 720, inUse: false, hasPicture: false },
        { index: 1, name: 'Webcam tích hợp', backend: 'msmf', url: 'webcam://msmf/1', width: 1280, height: 720, inUse: false, hasPicture: true },
      ];
    },
    async createPhone(body) {
      await lat();
      const cam = await this.create({
        name: body?.name || `ĐT · CAM ${String(db.cameras.filter((c) => c.sourceType === 'phone').length + 1).padStart(2, '0')}`,
        room: body?.room || 'Demo',
        position: body?.position || 'truoc',
        sourceType: 'phone',
        sourceUrl: 'push',
        enabled: true,
      });
      return { camera: cam, pushToken: 'mock-push-token', pushPath: `/ws/cameras/${cam.id}/push?token=mock-push-token`, expiresInSec: 4 * 3600 };
    },
  },

  alerts: {
    async list(f) {
      await lat();
      const all = applyFilter(db.alerts, f);
      const page = f.page ?? 1;
      const pageSize = f.pageSize ?? 10;
      const res: Paged<Alert> = { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
      return res;
    },
    async recent(limit) {
      return db.alerts.slice(0, limit);
    },
    async get(id) {
      return db.alerts.find((a) => a.id === id) ?? null;
    },
    async updateStatus(id, status, note) {
      await delay(150);
      const a = db.alerts.find((x) => x.id === id);
      if (!a) throw new Error('Không tìm thấy cảnh báo');
      const me = await mockApi.auth.me();
      a.status = status;
      a.note = note ?? a.note;
      a.handledAt = status === 'moi' ? undefined : Date.now();
      a.handledBy = status === 'moi' ? undefined : me?.user.name;
      db.persistAlerts();
      db.bus.emit('alert_update', { ...a });
      return { ...a };
    },
  },

  rules: {
    async get() {
      await lat();
      return structuredClone(db.rules);
    },
    async update(s: RulesSettings) {
      await lat();
      db.rules = structuredClone(s);
      db.persist('rules');
      return structuredClone(db.rules);
    },
    async reset() {
      db.rules = defaultRules();
      db.persist('rules');
      return structuredClone(db.rules);
    },
  },

  users: {
    async list() {
      await lat();
      return db.users.map(strip);
    },
    async create(u: NewUser) {
      await lat();
      if (db.users.some((x) => x.email.toLowerCase() === u.email.toLowerCase())) throw new Error('Email đã tồn tại.');
      const nu: User = { ...u, id: uid('u-'), createdAt: Date.now() };
      db.users.push(nu);
      db.persist('users');
      return strip(nu);
    },
    async update(id, patch) {
      await lat();
      const i = db.users.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('Không tìm thấy người dùng');
      if (patch.email && db.users.some((x) => x.id !== id && x.email.toLowerCase() === patch.email!.toLowerCase())) throw new Error('Email đã tồn tại.');
      const clean = { ...patch };
      if (!clean.password) delete clean.password;
      db.users[i] = { ...db.users[i], ...clean };
      db.persist('users');
      return strip(db.users[i]);
    },
    async remove(id) {
      await lat();
      const admins = db.users.filter((u) => u.role === 'admin' && u.active);
      if (admins.length === 1 && admins[0].id === id) throw new Error('Không thể xoá quản trị viên cuối cùng.');
      db.users = db.users.filter((u) => u.id !== id);
      db.persist('users');
    },
  },

  stats: {
    async dashboard(): Promise<DashboardStats> {
      await lat();
      const today = startOfDay();
      const day = 86400000;
      const statuses = simulator.statuses();
      const running = statuses.filter((s) => s.online).length;
      const inDay = (d: number) => db.alerts.filter((a) => a.ts >= today - d * day && a.ts < today - (d - 1) * day);
      const last7 = [6, 5, 4, 3, 2, 1, 0].map(inDay);
      const todayList = last7[6];
      const yesterday = last7[5];
      const cnt = (l: Alert[], s?: Alert['status']) => (s ? l.filter((a) => a.status === s).length : l.length);
      const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : a ? 100 : 0);
      const perHour: DashboardStats['perHour'] = [];
      const lastH = Math.max(17, new Date().getHours());
      for (let h = Math.min(7, new Date().getHours()); h <= lastH; h++) {
        const l = todayList.filter((a) => new Date(a.ts).getHours() === h);
        perHour.push({ hour: `${String(h).padStart(2, '0')}h`, total: l.length, cao: l.filter((a) => a.level === 'cao').length });
      }
      const types: AlertType[] = ['phone_near_hand', 'phone_in_work_area', 'phone_on_desk', 'paper_present', 'calculator_present', 'no_invigilator'];
      return {
        camerasRunning: running,
        camerasTotal: db.cameras.length,
        alertsToday: todayList.length,
        confirmedToday: cnt(todayList, 'xac_nhan'),
        dismissedToday: cnt(todayList, 'bo_qua'),
        trend: {
          alerts: pct(todayList.length, yesterday.length),
          confirmed: pct(cnt(todayList, 'xac_nhan'), cnt(yesterday, 'xac_nhan')),
          dismissed: pct(cnt(todayList, 'bo_qua'), cnt(yesterday, 'bo_qua')),
          cameras: 0,
        },
        spark: {
          alerts: last7.map((l) => l.length),
          confirmed: last7.map((l) => cnt(l, 'xac_nhan')),
          dismissed: last7.map((l) => cnt(l, 'bo_qua')),
          cameras: [6, 7, 7, 8, 7, 8, running],
        },
        perHour,
        perType: types.map((type) => ({ type, count: todayList.filter((a) => a.type === type).length })),
      };
    },
  },

  analysis: {
    analyze: mockAnalyze,
    startJob: mockStartJob,
    getJob: mockGetJob,
    cancelJob: mockCancelJob,
    subscribeJob: mockSubscribeJob,
  },

  models: {
    async list(): Promise<ModelInfo[]> {
      await lat();
      return [
        {
          name: 'YOLO Detect – exam-4cls',
          task: 'Phát hiện đối tượng',
          version: 'v1.3 (mô phỏng)',
          inputSize: '640×640',
          classes: ['person', 'phone', 'paper', 'calculator'],
          fps: 42,
          params: '9.4M',
          metrics: [
            { label: 'mAP@50', value: 0.871 },
            { label: 'mAP@50-95', value: 0.642 },
            { label: 'Độ chính xác', value: 0.884 },
            { label: 'Độ phủ', value: 0.836 },
          ],
          perClass: [
            { cls: 'person', ap50: 0.962, precision: 0.951, recall: 0.944 },
            { cls: 'phone', ap50: 0.823, precision: 0.857, recall: 0.781 },
            { cls: 'paper', ap50: 0.846, precision: 0.862, recall: 0.812 },
            { cls: 'calculator', ap50: 0.853, precision: 0.866, recall: 0.807 },
          ],
          updatedAt: Date.now() - 86400000 * 3,
        },
        {
          name: 'YOLO Pose – COCO 17 điểm',
          task: 'Ước lượng tư thế',
          version: 'v1.0 (mô phỏng)',
          inputSize: '640×640',
          classes: ['Người (17 điểm khung xương)'],
          fps: 38,
          params: '9.9M',
          metrics: [
            { label: 'mAP@50 (pose)', value: 0.835 },
            { label: 'mAP@50-95 (pose)', value: 0.594 },
            { label: 'OKS trung bình', value: 0.712 },
            { label: 'Tỉ lệ cổ tay nhìn thấy', value: 0.781 },
          ],
          updatedAt: Date.now() - 86400000 * 10,
        },
      ];
    },
  },

  system: {
    async model() {
      return {
        running: true,
        name: 'YOLO Detect – exam-4cls (mô phỏng)',
        classes: ['person', 'phone', 'paper', 'calculator'],
        device: 'cpu',
        fps: 8,
        objectsPerFrame: 3,
        inferenceMs: 40,
        roleEnabled: true,
        roleModel: 'role_best.pt',
        roleClasses: { student: 'student', teacher: 'invigilator' },
        roleModelNames: { 0: 'student', 1: 'teacher' },
        roleImgSize: 480,
        roleConf: 0.35,
        roleEveryN: 3,
        roleAdaptive: true,
        roleInferMs: 120,
        roleError: '',
        phoneZoom: true,
        phoneZoomConf: 0.2,
        phoneZoomImgSize: 416,
        phoneZoomEveryN: 2,
        phoneZoomMaxCrops: 12,
        phoneZoomInferMs: 35,
        phoneZoomCrops: 4,
        phoneConf: 0.25,
      };
    },
    async health() {
      return { ok: true, detector: 'mock', cameras: 8, device: 'cpu' };
    },
  },
};
