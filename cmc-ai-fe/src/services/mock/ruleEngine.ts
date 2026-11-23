/**
 * Bộ quy tắc đơn giản (mô phỏng logic phía backend):
 *  - Cao        : điện thoại gần cổ tay (keypoint 9/10) của thí sinh
 *  - Trung bình : điện thoại nằm trong vùng làm bài (bàn trước mặt thí sinh)
 *  - Thông tin  : có giấy / máy tính cầm tay (tự tắt nếu phòng cho phép)
 * Mỗi tình huống phải kéo dài >= persistSeconds mới bắn, và được chống trùng (dedupe) theo
 * khoá camera|loại|thí sinh trong dedupeCooldownSeconds.
 */
import type { AlertLevel, AlertType, BBox, Detection, PoseDet, RulesSettings } from '../../types';
import { bboxCenter } from '../../lib/geometry';

export const INFO_COOLDOWN_MS = 10 * 60 * 1000;

export interface FrameInput {
  ts: number;
  width: number;
  height: number;
  coord: 'norm' | 'px';
  objects: Detection[];
  poses: PoseDet[];
}

export interface Candidate {
  key: string;
  type: AlertType;
  level: AlertLevel;
  trackId: number;
  objectId?: string;
  confidence: number;
  startedAt: number;
  personBbox?: BBox;
  objectBbox?: BBox;
}

interface Track {
  since: number;
  lastSeen: number;
  fired: boolean;
  conf: number;
}

const GAP_TOLERANCE_MS = 2500; // chịu được 1 lần mất detection khi phân tích ~1 khung/giây

export class RuleEngine {
  private tracks = new Map<string, Track>();
  private lastFired = new Map<string, number>();

  reset() {
    this.tracks.clear();
    this.lastFired.clear();
  }

  /** ignorePersist = true cho ảnh tĩnh */
  process(f: FrameInput, settings: RulesSettings, room: string, ignorePersist = false): Candidate[] {
    const toN = (b: BBox): BBox => (f.coord === 'px' ? [b[0] / f.width, b[1] / f.height, b[2] / f.width, b[3] / f.height] : b);
    const aspect = f.width / f.height;
    const roomOpt = settings.rooms.find((r) => r.room === room);
    const rule = (t: AlertType) => settings.rules.find((r) => r.type === t);

    // Giám thị không bị tính cảnh báo thí sinh (giống BE khi có model vai trò)
    const persons = f.poses.filter((p) => p.role !== 'invigilator').map((p) => ({
      trackId: p.trackId,
      bbox: toN(p.bbox),
      wrists: [9, 10]
        .map((i) => p.keypoints[i])
        .filter((k) => k && k[2] >= 0.3)
        .map((k) => (f.coord === 'px' ? [k[0] / f.width, k[1] / f.height] : [k[0], k[1]])),
    }));

    const nearestPerson = (c: [number, number], hint?: number) => {
      if (hint != null) {
        const p = persons.find((x) => x.trackId === hint);
        if (p) return p;
      }
      let best = persons[0];
      let bd = Infinity;
      for (const p of persons) {
        const [px, py] = bboxCenter(p.bbox);
        const d = Math.hypot((px - c[0]) * aspect, py - c[1]);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return best;
    };

    const conds = new Map<string, Omit<Candidate, 'startedAt'>>();
    const add = (c: Omit<Candidate, 'startedAt'>) => {
      const prev = conds.get(c.key);
      if (!prev || prev.confidence < c.confidence) conds.set(c.key, c);
    };

    for (const o of f.objects) {
      const b = toN(o.bbox);
      const c = bboxCenter(b);
      if (o.cls === 'phone') {
        const p = nearestPerson(c, o.trackId);
        if (!p) continue;
        const ph = p.bbox[3] - p.bbox[1];
        const rNear = rule('phone_near_hand');
        const dHand = Math.min(Infinity, ...p.wrists.map((w) => Math.hypot((w[0] - c[0]) * aspect, w[1] - c[1])));
        if (rNear?.enabled && o.conf >= rNear.minConfidence && dHand / ph <= rNear.nearHandThreshold) {
          add({ key: `phone_near_hand|${p.trackId}`, type: 'phone_near_hand', level: rNear.level, trackId: p.trackId, objectId: o.id, confidence: o.conf, personBbox: p.bbox, objectBbox: b });
          continue;
        }
        const rWork = rule('phone_in_work_area');
        const pw = p.bbox[2] - p.bbox[0];
        const work: BBox = [p.bbox[0] - pw * 0.6, p.bbox[1] + ph * 0.4, p.bbox[2] + pw * 0.6, p.bbox[3] + ph * 0.05];
        const inWork = c[0] >= work[0] && c[0] <= work[2] && c[1] >= work[1] && c[1] <= work[3];
        if (rWork?.enabled && o.conf >= rWork.minConfidence && inWork) {
          // Giống BE: thấy cổ tay nhưng điện thoại không gần tay → Thông tin phone_on_desk, không bắn Cao/Trung bình.
          if (p.wrists.length) {
            add({ key: `phone_on_desk|${p.trackId}`, type: 'phone_on_desk', level: 'thong_tin', trackId: p.trackId, objectId: o.id, confidence: o.conf, personBbox: p.bbox, objectBbox: b });
          } else {
            add({ key: `phone_in_work_area|${p.trackId}`, type: 'phone_in_work_area', level: rWork.level, trackId: p.trackId, objectId: o.id, confidence: o.conf, personBbox: p.bbox, objectBbox: b });
          }
        }
      } else if (o.cls === 'paper' || o.cls === 'calculator') {
        const type: AlertType = o.cls === 'paper' ? 'paper_present' : 'calculator_present';
        const allowed = o.cls === 'paper' ? roomOpt?.allowPaper : roomOpt?.allowCalculator;
        const r = rule(type);
        if (allowed || !r?.enabled || o.conf < r.minConfidence) continue;
        const p = nearestPerson(c, o.trackId);
        if (!p) continue;
        add({ key: `${type}|${p.trackId}`, type, level: r.level, trackId: p.trackId, objectId: o.id, confidence: o.conf, personBbox: p.bbox, objectBbox: b });
      }
    }

    const out: Candidate[] = [];
    const cooldown = settings.dedupeCooldownSeconds * 1000;
    for (const [key, c] of conds) {
      let t = this.tracks.get(key);
      if (!t) {
        t = { since: f.ts, lastSeen: f.ts, fired: false, conf: c.confidence };
        this.tracks.set(key, t);
      }
      t.lastSeen = f.ts;
      t.conf = Math.max(t.conf * 0.9, c.confidence);
      const persist = (rule(c.type)?.persistSeconds ?? 3) * 1000;
      if (!t.fired && (ignorePersist || f.ts - t.since >= persist)) {
        t.fired = true;
        const last = this.lastFired.get(key);
        // Mức "Thông tin" chỉ báo 1 lần cho mỗi thí sinh trong 10 phút (giống backend)
        const cd = c.level === 'thong_tin' ? Math.max(cooldown, INFO_COOLDOWN_MS) : cooldown;
        if (last == null || f.ts - last >= cd) {
          this.lastFired.set(key, f.ts);
          out.push({ ...c, confidence: t.conf, startedAt: t.since });
        }
      }
    }
    // dọn các tình huống đã kết thúc
    for (const [key, t] of this.tracks) {
      if (f.ts - t.lastSeen > GAP_TOLERANCE_MS) this.tracks.delete(key);
    }
    return out;
  }
}
