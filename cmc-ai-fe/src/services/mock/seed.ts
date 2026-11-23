/** Dữ liệu mẫu ban đầu (được ghi vào localStorage ở lần chạy đầu tiên) */
import type { Alert, AlertStatus, AlertType, Camera, RulesSettings, User } from '../../types';
import { alertMessage } from '../../lib/labels';
import { mulberry32 } from '../../lib/geometry';
import { personBbox, phaseStart, sceneForCamera } from '../../scene/sceneModel';

const now = () => Date.now();

export function seedUsers(): User[] {
  const t = now() - 86400000 * 30;
  return [
    { id: 'u-admin', name: 'Nguyễn Văn An', email: 'admin@examguard.vn', role: 'admin', active: true, password: 'admin123', createdAt: t },
    { id: 'u-gt1', name: 'Trần Thị Bình', email: 'giamthi@examguard.vn', role: 'giam_thi', active: true, password: 'giamthi123', createdAt: t + 3600e3 },
    { id: 'u-gt2', name: 'Lê Minh Châu', email: 'chau.le@examguard.vn', role: 'giam_thi', active: true, password: 'giamthi123', createdAt: t + 7200e3 },
    { id: 'u-gt3', name: 'Phạm Quốc Dũng', email: 'dung.pham@examguard.vn', role: 'giam_thi', active: false, password: 'giamthi123', createdAt: t + 9000e3 },
  ];
}

export function seedCameras(): Camera[] {
  const t = now() - 86400000 * 20;
  const c = (i: number, room: string, position: 'truoc' | 'sau', sourceType: Camera['sourceType'], sourceUrl: string, enabled = true): Camera => ({
    id: `cam-0${i}`,
    name: `CAM ${String(i).padStart(2, '0')}`,
    room,
    position,
    sourceType,
    sourceUrl,
    enabled,
    createdAt: t + i * 1000,
  });
  return [
    c(1, 'P.503.1', 'truoc', 'rtsp', 'rtsp://192.168.1.21:554/stream1'),
    c(2, 'P.503.1', 'sau', 'rtsp', 'rtsp://192.168.1.22:554/stream1'),
    c(3, 'P.503.2', 'truoc', 'rtsp', 'rtsp://192.168.1.23:554/stream1'),
    c(4, 'P.503.2', 'sau', 'rtsp', 'rtsp://192.168.1.24:554/stream1'),
    c(5, 'P.504', 'truoc', 'file', 'mau-phong-504.mp4'),
    c(6, 'P.504', 'sau', 'rtsp', 'rtsp://10.0.0.26:554/stream1'),
    c(7, 'P.601', 'truoc', 'rtsp', 'rtsp://192.168.1.27:554/stream1'),
    c(8, 'P.601', 'sau', 'rtsp', 'rtsp://192.168.1.28:554/stream1'),
    c(9, 'P.602', 'truoc', 'rtsp', 'rtsp://192.168.1.29:554/stream1'),
  ];
}

export const DEFAULT_ROOM_OPTION = { allowPaper: true, allowCalculator: false } as const;

export function defaultRules(): RulesSettings {
  return {
    rules: [
      { type: 'phone_near_hand', enabled: true, level: 'cao', minConfidence: 0.5, nearHandThreshold: 0.15, persistSeconds: 2 },
      { type: 'phone_in_work_area', enabled: true, level: 'trung_binh', minConfidence: 0.45, nearHandThreshold: 0.15, persistSeconds: 4 },
      { type: 'paper_present', enabled: true, level: 'thong_tin', minConfidence: 0.4, nearHandThreshold: 0.15, persistSeconds: 8 },
      { type: 'calculator_present', enabled: true, level: 'thong_tin', minConfidence: 0.4, nearHandThreshold: 0.15, persistSeconds: 8 },
    ],
    // Mặc định giống backend: cho phép giấy nháp, không cho phép máy tính cầm tay
    rooms: ['P.503.1', 'P.503.2', 'P.504', 'P.601', 'P.602'].map((room) => ({ room, ...DEFAULT_ROOM_OPTION })),
    dedupeCooldownSeconds: 20,
  };
}

/** Sinh lịch sử 7 ngày, căn theo kịch bản cảnh để ảnh chụp/clip phát lại khớp với cảnh báo */
export function seedAlerts(cameras: Camera[], users: User[]): Alert[] {
  const rnd = mulberry32(20261104);
  const out: Alert[] = [];
  const nowTs = now();
  const sessions = [
    [7, 30, 9, 30],
    [9, 45, 11, 30],
    [13, 30, 15, 30],
  ];
  const handlers = users.filter((u) => u.active).map((u) => u.name);
  for (let d = 6; d >= 0; d--) {
    const day = new Date(nowTs - d * 86400000);
    day.setHours(0, 0, 0, 0);
    for (const [h1, m1, h2, m2] of sessions) {
      const s = day.getTime() + (h1 * 60 + m1) * 60000;
      const e = day.getTime() + (h2 * 60 + m2) * 60000;
      if (s > nowTs) continue;
      for (const cam of cameras) {
        if (cam.sourceUrl.includes('10.0.0.')) continue;
        const scene = sceneForCamera(cam);
        const n = Math.floor(rnd() * 3.2);
        for (let i = 0; i < n; i++) {
          const tRand = s + rnd() * (Math.min(e, nowTs - 60000) - s);
          if (tRand > nowTs - 60000) continue;
          const roll = rnd();
          let type: AlertType;
          let ts: number;
          let trackId: number;
          let objectId: string | undefined;
          let objectBbox: Alert['objectBbox'];
          if (roll < 0.7 && scene.phones.length) {
            const sc = scene.phones[Math.floor(rnd() * scene.phones.length)];
            const near = roll < 0.4;
            type = near ? 'phone_near_hand' : roll < 0.55 ? 'phone_on_desk' : 'phone_in_work_area';
            const start = phaseStart(sc, tRand / 1000, near ? 'hand' : 'desk');
            ts = (start + (near ? 2.4 : type === 'phone_on_desk' ? 3.4 : 4.4)) * 1000;
            trackId = sc.trackId;
            objectId = `phone-${trackId}`;
          } else {
            const st = scene.statics[Math.floor(rnd() * scene.statics.length)];
            if (!st) continue;
            type = st.cls === 'paper' ? 'paper_present' : 'calculator_present';
            ts = tRand;
            trackId = st.trackId;
            objectId = st.id;
            objectBbox = st.bbox;
          }
          if (ts > nowTs - 30000 || ts < s) continue;
          const actor = scene.actors.find((a) => a.trackId === trackId);
          const level = type === 'phone_near_hand' ? 'cao' : type === 'phone_in_work_area' ? 'trung_binh' : 'thong_tin';
          const ageH = (nowTs - ts) / 3600e3;
          let status: AlertStatus = 'moi';
          if (ageH > 1.5 || rnd() < 0.4) {
            const r2 = rnd();
            status = r2 < (level === 'cao' ? 0.55 : 0.3) ? 'xac_nhan' : r2 < 0.85 ? 'bo_qua' : 'moi';
          }
          out.push({
            id: `al-${Math.floor(ts).toString(36)}-${cam.id}-${i}`,
            cameraId: cam.id,
            cameraName: cam.name,
            room: cam.room,
            type,
            level,
            status,
            trackId,
            objectId,
            confidence: 0.55 + rnd() * 0.42,
            ts,
            startedAt: ts - (level === 'cao' ? 2000 : level === 'trung_binh' ? 4000 : 8000),
            message: alertMessage(type, trackId),
            personBbox: actor ? personBbox(actor) : undefined,
            objectBbox,
            handledBy: status !== 'moi' ? handlers[Math.floor(rnd() * handlers.length)] : undefined,
            handledAt: status !== 'moi' ? ts + 30000 + rnd() * 300000 : undefined,
          });
        }
      }
    }
  }
  return out.sort((a, b) => b.ts - a.ts);
}
