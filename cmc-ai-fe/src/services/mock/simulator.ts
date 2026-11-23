/**
 * Bộ mô phỏng "backend AI": cảnh giả lập (video gốc) chạy mượt trên canvas, còn kết quả phân tích
 * (DetectionFrame) chỉ sinh ~1 khung/giây cho mỗi camera – giống backend chạy YOLO trên CPU –
 * rồi chạy RuleEngine và phát cảnh báo.
 */
import type { Alert, CameraStatus, Detection, DetectionFrame, PoseDet } from '../../types';
import { db } from './db';
import { RuleEngine } from './ruleEngine';
import { sceneForCamera, sceneState } from '../../scene/sceneModel';
import { alertMessage } from '../../lib/labels';
import { uid } from '../../lib/format';
import { clamp } from '../../lib/geometry';
import { mockInvigilatorId, withMockRoles } from './mockRoles';

/** Clip mô phỏng (AlertReplay phát lại cảnh giả lập); có sau ~3,5 giây như backend thật */
export const MOCK_CLIP = 'mock:replay';
const MOCK_CLIP_DELAY_MS = 3500;

const TICK_MS = 125;
/** chu kỳ phân tích mỗi camera (~1 khung/giây, dao động ±12% như máy thật) */
export const MOCK_ANALYSIS_MS = 1000;
const ANALYSIS_JITTER = 0.12;
const STATUS_MS = 2000;

export function isReachable(url: string): boolean {
  // Quy ước mock: địa chỉ 10.0.0.x được coi là không truy cập được (camera offline)
  return !url.includes('10.0.0.');
}

export class Simulator {
  private engines = new Map<string, RuleEngine>();
  private timer: number | undefined;
  private statusTimer: number | undefined;
  private frameId = 0;
  private fpsState = new Map<string, number>();
  /** thời điểm đến lượt phân tích tiếp theo của từng camera */
  private nextDue = new Map<string, number>();

  start() {
    if (this.timer) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.statusTimer = window.setInterval(() => this.emitStatus(), STATUS_MS);
    this.emitStatus();
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.statusTimer);
    this.timer = this.statusTimer = undefined;
    this.engines.forEach((e) => e.reset());
    this.nextDue.clear();
  }

  get running() {
    return this.timer != null;
  }

  statuses(): CameraStatus[] {
    const t = Date.now();
    return db.cameras.map((c) => {
      const online = c.enabled && isReachable(c.sourceUrl);
      let fps = this.fpsState.get(c.id) ?? 25;
      fps = online ? clamp(fps + (Math.random() - 0.5) * 2.5, 18, 30) : 0;
      this.fpsState.set(c.id, fps || 25);
      return { cameraId: c.id, online, fps: Math.round(fps * 10) / 10, latencyMs: online ? Math.round(60 + Math.random() * 90) : 0, updatedAt: t };
    });
  }

  private emitStatus() {
    db.bus.emit('camera_status', this.statuses());
  }

  private tick() {
    const ts = Date.now();
    this.frameId++;
    for (const cam of db.cameras) {
      if (!cam.enabled || !isReachable(cam.sourceUrl)) continue;
      const due = this.nextDue.get(cam.id);
      if (due === undefined) {
        // lệch pha giữa các camera để kết quả không về cùng lúc
        this.nextDue.set(cam.id, ts + Math.random() * MOCK_ANALYSIS_MS);
        continue;
      }
      if (ts < due) continue;
      this.nextDue.set(cam.id, ts + MOCK_ANALYSIS_MS * (1 + (Math.random() * 2 - 1) * ANALYSIS_JITTER));
      const frame = cam.sourceType === 'webcam' ? this.webcamFrame(cam.id, ts) : this.sceneFrame(cam, ts);
      db.bus.emit('detections', frame);

      let engine = this.engines.get(cam.id);
      if (!engine) {
        engine = new RuleEngine();
        this.engines.set(cam.id, engine);
      }
      const cands = engine.process(frame, db.rules, cam.room);
      for (const c of cands) {
        const alert: Alert = {
          id: uid('al-'),
          cameraId: cam.id,
          cameraName: cam.name,
          room: cam.room,
          type: c.type,
          level: c.level,
          status: 'moi',
          trackId: c.trackId,
          objectId: c.objectId,
          confidence: Math.round(c.confidence * 1000) / 1000,
          ts,
          startedAt: c.startedAt,
          message: alertMessage(c.type, c.trackId),
          personBbox: c.personBbox,
          objectBbox: c.objectBbox,
          clipUrl: null, // giống backend: clip được "ghép" sau vài giây rồi báo qua alert_update
        };
        db.alerts.unshift(alert);
        db.persistAlerts();
        db.bus.emit('alert', alert);
        setTimeout(() => {
          const a = db.alerts.find((x) => x.id === alert.id);
          if (!a) return;
          a.clipUrl = MOCK_CLIP;
          db.persistAlerts();
          db.bus.emit('alert_update', { ...a });
        }, MOCK_CLIP_DELAY_MS);
      }
    }
  }

  private sceneFrame(cam: { id: string; position: 'truoc' | 'sau' }, ts: number): DetectionFrame {
    const scene = sceneForCamera(cam);
    const st = sceneState(scene, ts);
    const j = () => (Math.random() - 0.5) * 0.004;
    const objects: Detection[] = [];
    for (const o of st.objects) {
      if (o.cls === 'phone' && Math.random() < 0.04) continue; // thỉnh thoảng mất detection
      objects.push({
        ...o,
        conf: clamp(o.conf + (Math.random() - 0.5) * 0.08, 0.3, 0.99),
        bbox: [o.bbox[0] + j(), o.bbox[1] + j(), o.bbox[2] + j(), o.bbox[3] + j()],
      });
    }
    const poses: PoseDet[] = st.poses.map((p) => ({
      ...p,
      keypoints: p.keypoints.map(([x, y, s]) => [x + j() * 0.5, y + j() * 0.5, s]),
    }));
    return withMockRoles({ cameraId: cam.id, frameId: this.frameId, ts, frameTs: ts - 350, serverTs: ts, width: 1280, height: 720, coord: 'norm', objects, poses }, mockInvigilatorId(scene));
  }

  /** Webcam: không biết nội dung thật → giả lập 1 người ở giữa khung */
  private webcamFrame(cameraId: string, ts: number): DetectionFrame {
    const t = ts / 1000;
    const cx = 0.5 + Math.sin(t * 0.4) * 0.03;
    const top = 0.18;
    const h = 0.8;
    const A = 16 / 9;
    const X = (dx: number) => cx + (dx * h) / A;
    const Y = (dy: number) => top + dy * h;
    const k = (dx: number, dy: number, s = 0.9): [number, number, number] => [X(dx), Y(dy), s];
    const keypoints = [
      k(0, 0.13), k(0.03, 0.1), k(-0.03, 0.1), k(0.065, 0.11), k(-0.065, 0.11),
      k(0.17, 0.3), k(-0.17, 0.3), k(0.22, 0.5), k(-0.22, 0.5), k(0.1, 0.62), k(-0.1, 0.62),
      k(0.11, 0.75, 0.4), k(-0.11, 0.75, 0.4), k(0.13, 0.88, 0.1), k(-0.13, 0.88, 0.1), k(0.13, 0.99, 0.05), k(-0.13, 0.99, 0.05),
    ] as PoseDet['keypoints'];
    const bbox: [number, number, number, number] = [X(-0.27), top - 0.02, X(0.27), 0.99];
    return withMockRoles({
      cameraId, frameId: this.frameId, ts, frameTs: ts - 350, serverTs: ts, width: 1280, height: 720, coord: 'norm',
      objects: [{ id: 'person-1', cls: 'person', conf: 0.9, bbox, trackId: 1 }],
      poses: [{ trackId: 1, conf: 0.9, bbox, keypoints }],
    } as DetectionFrame, undefined);
  }
}

export const simulator = new Simulator();
