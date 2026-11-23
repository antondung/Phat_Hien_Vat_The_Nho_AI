/**
 * Vẽ lớp phủ kết quả AI: bbox (thẳng), hộp xoay/polygon, nhãn, độ tin cậy và khung xương 17 điểm COCO.
 * Hỗ trợ cả toạ độ chuẩn hoá (0..1) và pixel (kèm width/height của frame).
 */
import type { CoordSpace, Detection, PoseDet } from '../types';
import { CLASS_COLOR, CLASS_LABEL, CLASS_ON, LEVEL_COLOR, LEVEL_LABEL } from './labels';
import type { AlertLevel } from '../types';
import { type Rect } from './geometry';
import { mapperForFrame, resolveOverlaySpace } from './overlayMap';
import { INVIGILATOR_COLOR, INVIGILATOR_ON, isInvigilator, personLabel, withInferredRoles } from './roles';
import { objectBoxLabel } from './phoneZoom';

export const COCO_KEYPOINTS = [
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
  'left_knee', 'right_knee', 'left_ankle', 'right_ankle',
];

/** Các cặp nối xương theo COCO */
export const SKELETON: [number, number, 'l' | 'r' | 'c'][] = [
  [0, 1, 'c'], [0, 2, 'c'], [1, 3, 'l'], [2, 4, 'r'],
  [5, 6, 'c'], [5, 7, 'l'], [7, 9, 'l'], [6, 8, 'r'], [8, 10, 'r'],
  [5, 11, 'l'], [6, 12, 'r'], [11, 12, 'c'],
  [11, 13, 'l'], [13, 15, 'l'], [12, 14, 'r'], [14, 16, 'r'],
];

const LIMB_COLOR = { l: '#38BDF8', r: '#A3E635', c: '#FACC15' };

export interface OverlayLayers {
  box: boolean;
  pose: boolean;
  label: boolean;
  conf: boolean;
}

export interface OverlayFrame {
  coord: CoordSpace;
  width: number;
  height: number;
  objects: Detection[];
  poses: PoseDet[];
}

export interface OverlayOpts {
  layers: OverlayLayers;
  /** id vật thể bị gắn cờ – nhấp nháy đỏ */
  flaggedObjects?: Set<string>;
  flaggedTracks?: Set<number>;
  /** (redesign) mức cảnh báo của vật thể / track bị gắn cờ – để tô đúng màu mức, không phải luôn đỏ */
  objectLevel?: Map<string, AlertLevel>;
  trackLevel?: Map<number, AlertLevel>;
  /** (redesign) ẩn nhãn vật thể không bị gắn cờ – dùng cho lưới nhiều ô */
  flaggedLabelsOnly?: boolean;
  blinkOn?: boolean;
  scale?: number; // hệ số cỡ chữ / nét
  kpThreshold?: number;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, f: OverlayFrame, rect: Rect, o: OverlayOpts) {
  const m = mapperForFrame(resolveOverlaySpace(f), rect);
  if (!m) return;
  const s = o.scale ?? Math.max(0.6, Math.min(1.4, rect.w / 900));
  const thr = o.kpThreshold ?? 0.3;
  ctx.save();
  ctx.lineJoin = 'round';

  // Bổ sung role từ pose/nhãn khi object person thiếu field role (một số đường phân tích chỉ gắn role ở pose).
  const objects = withInferredRoles(f.objects, f.poses);
  // Giám thị (model vai trò của BE): khung xương xám. Pose có thể thiếu role -> khớp theo trackId của person.
  const invTracks = new Set<number>();
  for (const d of objects) if (d.cls === 'person' && d.trackId != null && isInvigilator(d)) invTracks.add(d.trackId);

  if (o.layers.pose) {
    for (const p of f.poses) {
      const inv = isInvigilator(p) || invTracks.has(p.trackId);
      const k = p.keypoints;
      // v = 0 (hoặc x = y = 0, hoặc thiếu điểm) = bị che / không có -> không vẽ điểm và mọi cạnh nối tới nó.
      // Dataset hiện chỉ có 11 điểm (0–10) nên thực tế chỉ vẽ phần thân trên.
      const ok = (i: number) => !!k[i] && k[i][2] > 0 && k[i][2] >= thr && !(k[i][0] === 0 && k[i][1] === 0);
      ctx.lineWidth = 2.2 * s;
      for (const [a, b, side] of SKELETON) {
        if (!ok(a) || !ok(b)) continue;
        ctx.strokeStyle = inv ? INVIGILATOR_COLOR : LIMB_COLOR[side];
        ctx.beginPath();
        ctx.moveTo(m.x(k[a][0]), m.y(k[a][1]));
        ctx.lineTo(m.x(k[b][0]), m.y(k[b][1]));
        ctx.stroke();
      }
      for (let i = 0; i < k.length; i++) {
        if (!ok(i)) continue;
        ctx.fillStyle = inv ? '#E5E7EB' : i === 9 || i === 10 ? '#FDE047' : '#FFFFFF';
        ctx.beginPath();
        ctx.arc(m.x(k[i][0]), m.y(k[i][1]), (i === 9 || i === 10 ? 3.2 : 2.4) * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // vẽ người trước, vật thể sau (để vật thể nằm trên)
  const sorted = [...objects].sort((a, b) => (a.cls === 'person' ? 0 : 1) - (b.cls === 'person' ? 0 : 1));
  for (const d of sorted) {
    const flagged = o.flaggedObjects?.has(d.id) || (d.cls === 'person' && d.trackId != null && o.flaggedTracks?.has(d.trackId));
    if (!o.layers.box && !flagged) continue;
    const lv: AlertLevel = (d.cls === 'person' ? (d.trackId != null ? o.trackLevel?.get(d.trackId) : undefined) : o.objectLevel?.get(d.id)) ?? 'cao';
    const lvColor = LEVEL_COLOR[lv];
    // chỉ mức Cao nhấp nháy (đỡ mỏi mắt); Trung bình/Thông tin giữ màu tĩnh
    const blinkRed = flagged && (lv !== 'cao' || (o.blinkOn ?? true));
    const isPerson = d.cls === 'person';
    // Giám thị: xám trung tính, nét đứt, nhãn "Giám thị" (chỉ đổi màu khi không bị gắn cờ)
    const inv = isPerson && !flagged && isInvigilator(d);
    const baseColor = inv ? INVIGILATOR_COLOR : CLASS_COLOR[d.cls];
    const color = flagged ? (blinkRed ? lvColor : CLASS_COLOR[d.cls]) : baseColor;
    ctx.strokeStyle = color;
    ctx.lineWidth = (flagged ? 3.2 : inv ? 1.8 : isPerson ? 1.4 : 2) * s;
    ctx.setLineDash(isPerson && !flagged ? [6 * s, 4 * s] : []);
    ctx.beginPath();
    if (d.points && d.points.length >= 3) {
      d.points.forEach(([x, y], i) => (i ? ctx.lineTo(m.x(x), m.y(y)) : ctx.moveTo(m.x(x), m.y(y))));
      ctx.closePath();
      ctx.fillStyle = hexA(color, flagged ? 0.22 : 0.14);
      ctx.fill();
    } else {
      ctx.rect(m.x(d.bbox[0]), m.y(d.bbox[1]), m.x(d.bbox[2]) - m.x(d.bbox[0]), m.y(d.bbox[3]) - m.y(d.bbox[1]));
      if (flagged) {
        ctx.fillStyle = hexA(lvColor, blinkRed ? 0.18 : 0.05);
        ctx.fill();
      }
    }
    if (!flagged && d.cls === 'calculator') {
      // viền sáng mảnh bên ngoài để nâu không chìm trên nền tối
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = ctx.lineWidth + 2 * s;
      ctx.stroke();
      ctx.restore();
    }
    if (inv) {
      // viền tối mảnh dưới nét xám để giám thị vẫn rõ trên phòng sáng
      ctx.save();
      ctx.strokeStyle = 'rgba(17,20,24,0.55)';
      ctx.lineWidth = ctx.lineWidth + 1.6 * s;
      ctx.stroke();
      ctx.restore();
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Nhãn người luôn ghi vai trò ("Thí sinh #N" / "Giám thị"). Độ tin cậy: chữ nhỏ, bỏ khi nhãn dài không đủ chỗ.
    // Đối tượng đang có cảnh báo chưa xử lý: nhãn + mức; lưới nhiều ô ẩn nhãn vật thể không gắn cờ.
    const full = flagged && isPerson;
    const showName = isPerson || o.layers.label || flagged;
    const showText = full || (flagged ? !o.flaggedLabelsOnly : !o.flaggedLabelsOnly && (showName || o.layers.conf));
    if (showText) {
      const name = showName || flagged ? (isPerson ? personLabel(d) : objectBoxLabel(d, CLASS_LABEL[d.cls])) : '';
      const levelText = full ? LEVEL_LABEL[lv] : '';
      const wantConf = (full || o.layers.conf) && !o.flaggedLabelsOnly;
      const compact = !full;
      const fs = (compact ? (isPerson ? 11 : 9.5) : 11) * s;
      const confFs = Math.max(8, fs - 2.5);
      const pad = (compact ? 3.5 : 4) * s;
      const gap = 3 * s;
      ctx.font = `700 ${fs}px "Be Vietnam Pro", "Segoe UI", system-ui, sans-serif`;
      const parts: string[] = [];
      if (name) parts.push(name);
      if (levelText) parts.push(levelText);
      const main = parts.join(' · ');
      const mainW = main ? ctx.measureText(main).width : 0;
      ctx.font = `600 ${confFs}px "Be Vietnam Pro", "Segoe UI", system-ui, sans-serif`;
      const confText = wantConf ? d.conf.toFixed(2) : '';
      const confW = confText ? ctx.measureText(confText).width : 0;
      // Nhãn vai trò đã dài ("Thí sinh #12"): chỉ vẽ conf khi còn chỗ trên khung / sân khấu.
      const boxW = Math.abs(m.x(d.bbox[2]) - m.x(d.bbox[0]));
      const keepConf = !!confText && (full || !isPerson || main.length <= 8 || mainW + gap + confW + pad * 2 <= Math.max(boxW, 72 * s));
      const tw = mainW + (keepConf && confW ? gap + confW : 0) + pad * 2;
      const th = fs + (compact ? 5 : 6) * s;
      let lx = m.x(d.points ? Math.min(...d.points.map((p) => p[0])) : d.bbox[0]);
      let ly = m.y(d.points ? Math.min(...d.points.map((p) => p[1])) : d.bbox[1]) - th;
      if (isPerson) ly = m.y(d.bbox[1]);
      lx = Math.max(rect.x, Math.min(lx, rect.x + rect.w - tw));
      ly = Math.max(rect.y, Math.min(ly, rect.y + rect.h - th));
      ctx.fillStyle = flagged ? lvColor : hexA(baseColor, isPerson ? 0.92 : 0.95);
      ctx.fillRect(lx, ly, tw, th);
      const on = flagged ? (lv === 'cao' ? '#FFFFFF' : '#111418') : inv ? INVIGILATOR_ON : CLASS_ON[d.cls];
      ctx.fillStyle = on;
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fs}px "Be Vietnam Pro", "Segoe UI", system-ui, sans-serif`;
      if (main) ctx.fillText(main, lx + pad, ly + th / 2 + 0.5);
      if (keepConf && confText) {
        ctx.font = `600 ${confFs}px "Be Vietnam Pro", "Segoe UI", system-ui, sans-serif`;
        ctx.globalAlpha = 0.85;
        ctx.fillText(confText, lx + pad + mainW + (main ? gap : 0), ly + th / 2 + 0.5);
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 0xff},${n & 0xff},${a})`;
}
