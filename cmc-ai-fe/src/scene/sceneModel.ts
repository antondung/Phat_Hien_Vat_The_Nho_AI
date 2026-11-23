/**
 * Mô hình "cảnh phòng thi" tất định theo thời gian.
 * Cùng một hàm sceneState(scene, t) được dùng bởi:
 *  - bộ vẽ video giả (renderScene) để vẽ khung hình,
 *  - bộ mô phỏng backend (simulator) để sinh detections/pose khớp với hình,
 *  - modal "Xem" để phát lại đoạn clip quanh thời điểm cảnh báo.
 */
import type { BBox, Detection, Keypoint, PoseDet } from '../types';
import { bboxFromPoints, hashStr, mulberry32, rotatedRect } from '../lib/geometry';

export const SCENE_ASPECT = 16 / 9;
export const SAMPLE_IMAGE_URL = '/samples/phong-thi-P503.jpg';

export type PoseMode = 'write' | 'phone_desk' | 'phone_hand' | 'think';

export interface Actor {
  trackId: number;
  cx: number;
  top: number;
  h: number; // chiều cao (chuẩn hoá theo chiều cao frame)
  wScale: number;
  facing: 1 | -1; // 1 = nhìn về camera (camera phía trước), -1 = quay lưng (camera phía sau)
  shirt: string;
  hair: string;
  skin: string;
  seed: number;
  row: number;
}

export interface PhoneScript {
  trackId: number;
  cycle: number; // giây
  offset: number; // giây
  deskFrom: number;
  handFrom: number;
  handTo: number;
}

export interface StaticObj {
  id: string;
  cls: 'paper' | 'calculator';
  trackId: number;
  points?: [number, number][];
  bbox: BBox;
}

export interface CameraScene {
  cameraId: string;
  kind: 'photo' | 'synthetic';
  seed: number;
  actors: Actor[];
  phones: PhoneScript[];
  statics: StaticObj[];
  palette: { wall: string; floor: string; desk: string; deskFront: string };
  rows: { y: number; h: number; x1: number; x2: number }[];
}

export interface SceneState {
  t: number;
  poses: PoseDet[];
  objects: Detection[];
  modes: Record<number, PoseMode>;
}

const SHIRTS = ['#F8FAFC', '#E2E8F0', '#1E293B', '#93C5FD', '#FDE68A', '#FCA5A5', '#A7F3D0', '#CBD5E1', '#334155', '#F1F5F9'];
const HAIRS = ['#111827', '#1F2937', '#292524', '#3F3F46'];
const SKINS = ['#F2C9A0', '#E8B98E', '#D9A47A', '#F5D0B0'];

/* ---------- Cảnh từ ảnh thật (P.503.1) ---------- */
// Toạ độ đo trên ảnh chụp màn hình công cụ gán nhãn (khung ảnh: x 53..806, y 80..503.5)
const N = (x: number, y: number): [number, number] => [(x - 53) / 753, (y - 80) / 423.5];
const NB = (x1: number, y1: number, x2: number, y2: number): BBox => [...N(x1, y1), ...N(x2, y2)] as BBox;

const PHOTO_PEOPLE: { id: number; box: BBox }[] = [
  { id: 1, box: NB(140, 345, 250, 452) },
  { id: 2, box: NB(490, 328, 625, 503) },
  { id: 3, box: NB(360, 205, 447, 330) },
  { id: 4, box: NB(565, 192, 672, 330) },
  { id: 5, box: NB(100, 252, 188, 345) },
  { id: 6, box: NB(450, 133, 522, 240) },
  { id: 7, box: NB(628, 128, 682, 200) },
  { id: 8, box: NB(158, 163, 207, 222) },
  { id: 9, box: NB(330, 118, 372, 186) },
  { id: 10, box: NB(284, 112, 322, 160) },
  { id: 11, box: NB(120, 152, 152, 196) },
];

const PHOTO_STATICS: StaticObj[] = [
  poly('paper-p1', 'paper', 3, [N(383, 310), N(430, 297), N(447, 324), N(400, 338)]),
  poly('paper-p2', 'paper', 3, [N(452, 336), N(498, 329), N(521, 352), N(474, 363)]),
  poly('paper-p3', 'paper', 2, [N(410, 386), N(451, 356), N(516, 384), N(478, 411)]),
  box('paper-p4', 'paper', 2, NB(322, 402, 436, 487)),
  poly('paper-p5', 'paper', 1, [N(143, 470), N(208, 431), N(238, 484), N(170, 500)]),
  poly('paper-p6', 'paper', 1, [N(118, 352), N(166, 335), N(183, 361), N(133, 378)]),
  poly('paper-p7', 'paper', 2, [N(520, 356), N(551, 350), N(561, 386), N(528, 389)]),
  box('calc-c1', 'calculator', 1, NB(182, 345, 208, 358)),
  box('calc-c2', 'calculator', 5, NB(150, 266, 176, 280)),
  box('calc-c3', 'calculator', 9, NB(378, 150, 402, 162)),
  box('calc-c4', 'calculator', 6, NB(522, 180, 546, 192)),
];

function poly(id: string, cls: 'paper' | 'calculator', trackId: number, pts: [number, number][]): StaticObj {
  return { id, cls, trackId, points: pts, bbox: bboxFromPoints(pts) };
}
function box(id: string, cls: 'paper' | 'calculator', trackId: number, b: BBox): StaticObj {
  return { id, cls, trackId, bbox: b };
}

function photoScene(cameraId: string): CameraScene {
  const actors: Actor[] = PHOTO_PEOPLE.map((p, i) => {
    const h = p.box[3] - p.box[1];
    const w = p.box[2] - p.box[0];
    return {
      trackId: p.id,
      cx: (p.box[0] + p.box[2]) / 2,
      top: p.box[1],
      h,
      wScale: w / ((0.52 * h) / SCENE_ASPECT),
      facing: 1,
      shirt: '#fff',
      hair: '#000',
      skin: '#000',
      seed: i * 31 + 7,
      row: 0,
    };
  });
  return {
    cameraId,
    kind: 'photo',
    seed: 503,
    actors,
    phones: [
      { trackId: 2, cycle: 95, offset: 0, deskFrom: 6, handFrom: 22, handTo: 34 },
      { trackId: 3, cycle: 130, offset: 70, deskFrom: 4, handFrom: 30, handTo: 38 },
    ],
    statics: PHOTO_STATICS,
    palette: { wall: '#ddd', floor: '#ccc', desk: '#fff', deskFront: '#eee' },
    rows: [],
  };
}

/* ---------- Cảnh tổng hợp (vẽ bằng canvas) ---------- */
function syntheticScene(cameraId: string, facing: 1 | -1): CameraScene {
  const seed = hashStr(cameraId);
  const rnd = mulberry32(seed);
  const layout = [
    { top: 0.2, h: 0.2, xs: [0.2, 0.4, 0.6, 0.8] },
    { top: 0.31, h: 0.27, xs: [0.14, 0.38, 0.62, 0.86] },
    { top: 0.47, h: 0.36, xs: [0.18, 0.5, 0.82] },
  ];
  const actors: Actor[] = [];
  const rows: CameraScene['rows'] = [];
  let id = 1;
  layout.forEach((r, ri) => {
    rows.push({ y: r.top + 0.56 * r.h, h: r.h, x1: r.xs[0] - 0.14, x2: r.xs[r.xs.length - 1] + 0.14 });
    r.xs.forEach((x) => {
      if (rnd() < 0.12 && actors.length > 3) {
        id++;
        return; // chỗ trống
      }
      actors.push({
        trackId: id++,
        cx: x + (rnd() - 0.5) * 0.02,
        top: r.top + (rnd() - 0.5) * 0.01,
        h: r.h,
        wScale: 0.9 + rnd() * 0.25,
        facing,
        shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)],
        hair: HAIRS[Math.floor(rnd() * HAIRS.length)],
        skin: SKINS[Math.floor(rnd() * SKINS.length)],
        seed: Math.floor(rnd() * 1000),
        row: ri,
      });
    });
  });

  // vật tĩnh: giấy (hộp xoay) và máy tính cầm tay
  const statics: StaticObj[] = [];
  actors.forEach((a) => {
    const deskY = a.top + 0.6 * a.h;
    if (rnd() < 0.45) {
      const cx = a.cx + ((facing * 0.12 * a.h) / SCENE_ASPECT) * (rnd() < 0.5 ? 1 : -0.6);
      const pts = rotatedRect(cx, deskY + 0.01 * a.h, (0.2 * a.h) / SCENE_ASPECT, 0.06 * a.h, (rnd() - 0.5) * 0.9, SCENE_ASPECT);
      statics.push({ id: `paper-${a.trackId}`, cls: 'paper', trackId: a.trackId, points: pts, bbox: bboxFromPoints(pts) });
    }
    if (rnd() < 0.22) {
      const cx = a.cx - (facing * 0.2 * a.h) / SCENE_ASPECT;
      const w = (0.07 * a.h) / SCENE_ASPECT;
      statics.push({
        id: `calc-${a.trackId}`,
        cls: 'calculator',
        trackId: a.trackId,
        bbox: [cx - w / 2, deskY - 0.005, cx + w / 2, deskY + 0.035 * a.h],
      });
    }
  });

  // kịch bản điện thoại: 1–2 thí sinh
  const phones: PhoneScript[] = [];
  const pool = [...actors].sort(() => rnd() - 0.5);
  const nPhones = 1 + (rnd() < 0.6 ? 1 : 0);
  for (let i = 0; i < nPhones && i < pool.length; i++) {
    const cycle = 100 + Math.floor(rnd() * 50);
    phones.push({
      trackId: pool[i].trackId,
      cycle,
      offset: Math.floor(rnd() * cycle),
      deskFrom: 5,
      handFrom: 22 + Math.floor(rnd() * 6),
      handTo: 36 + Math.floor(rnd() * 6),
    });
  }

  const warm = rnd() < 0.5;
  return {
    cameraId,
    kind: 'synthetic',
    seed,
    actors,
    phones,
    statics,
    palette: warm
      ? { wall: '#E7E2D6', floor: '#B9B2A4', desk: '#F4F1EA', deskFront: '#CFC8B8' }
      : { wall: '#DCE3EA', floor: '#A9B3BD', desk: '#F3F5F7', deskFront: '#C4CCD4' },
    rows,
  };
}

const cache = new Map<string, CameraScene>();

/** cam-01 dùng ảnh thật của nhóm (P.503.1); các camera khác dùng cảnh tổng hợp */
export function getScene(cameraId: string, position: 'truoc' | 'sau' = 'truoc', usePhoto = false): CameraScene {
  const key = `${cameraId}|${position}|${usePhoto}`;
  let s = cache.get(key);
  if (!s) {
    s = usePhoto ? photoScene(cameraId) : syntheticScene(cameraId, position === 'truoc' ? 1 : -1);
    cache.set(key, s);
  }
  return s;
}

/* ---------- Trạng thái theo thời gian ---------- */
export function phoneMode(script: PhoneScript, tSec: number): PoseMode | null {
  const p = (((tSec + script.offset) % script.cycle) + script.cycle) % script.cycle;
  if (p >= script.handFrom && p < script.handTo) return 'phone_hand';
  if (p >= script.deskFrom && p < script.handFrom) return 'phone_desk';
  return null;
}

/** Thời điểm (s) gần nhất <= tSec mà pha bắt đầu – dùng để căn dữ liệu lịch sử */
export function phaseStart(script: PhoneScript, tSec: number, phase: 'desk' | 'hand'): number {
  const p = (((tSec + script.offset) % script.cycle) + script.cycle) % script.cycle;
  const from = phase === 'hand' ? script.handFrom : script.deskFrom;
  return tSec - p + from;
}

function poseFor(a: Actor, tSec: number, mode: PoseMode): Keypoint[] {
  const A = SCENE_ASPECT;
  const H = a.h;
  const f = a.facing;
  const X = (dx: number) => a.cx + (f * dx * H * a.wScale) / A;
  const Y = (dy: number) => a.top + dy * H;
  const ph = a.seed * 0.37;
  const bob = 0.008 * Math.sin(tSec * 0.7 + ph);
  const sway = 0.01 * Math.sin(tSec * 0.33 + ph);
  const front = f === 1;
  let headDy = bob + (mode === 'write' ? 0.015 : mode === 'phone_hand' ? 0.03 : 0);
  if (mode === 'think') headDy -= 0.01;
  const hx = sway;
  const faceScore = front ? 0.92 : 0.08;
  const earScore = front ? 0.75 : 0.6;

  let lw: [number, number] = [0.08, 0.62];
  let rw: [number, number] = [-0.1, 0.63];
  let le: [number, number] = [0.22, 0.5];
  let re: [number, number] = [-0.22, 0.5];
  if (mode === 'write') {
    rw = [-0.1 + 0.02 * Math.sin(tSec * 6 + ph), 0.63 + 0.008 * Math.sin(tSec * 9 + ph)];
  } else if (mode === 'phone_hand') {
    rw = [-0.03, 0.5];
    lw = [0.04, 0.52];
    re = [-0.2, 0.56];
    le = [0.2, 0.57];
  } else if (mode === 'think') {
    rw = [-0.05, 0.22];
    re = [-0.2, 0.42];
  }

  const kp = (dx: number, dy: number, s: number): Keypoint => [X(dx), Y(dy), s];
  return [
    kp(hx, 0.13 + headDy, faceScore), // 0 nose
    kp(hx + 0.03, 0.1 + headDy, faceScore), // 1 left_eye
    kp(hx - 0.03, 0.1 + headDy, faceScore), // 2 right_eye
    kp(hx + 0.065, 0.11 + headDy, earScore), // 3 left_ear
    kp(hx - 0.065, 0.11 + headDy, earScore), // 4 right_ear
    kp(0.17, 0.3, 0.95), // 5 left_shoulder
    kp(-0.17, 0.3, 0.95), // 6 right_shoulder
    kp(le[0], le[1], 0.85), // 7 left_elbow
    kp(re[0], re[1], 0.85), // 8 right_elbow
    kp(lw[0], lw[1], 0.8), // 9 left_wrist
    kp(rw[0], rw[1], 0.8), // 10 right_wrist
    kp(0.11, 0.75, 0.4), // 11 left_hip
    kp(-0.11, 0.75, 0.4), // 12 right_hip
    kp(0.13, 0.88, 0.2), // 13 left_knee
    kp(-0.13, 0.88, 0.2), // 14 right_knee
    kp(0.13, 0.99, 0.08), // 15 left_ankle
    kp(-0.13, 0.99, 0.08), // 16 right_ankle
  ];
}

export function personBbox(a: Actor): BBox {
  const half = (0.27 * a.h * a.wScale) / SCENE_ASPECT;
  return [a.cx - half, a.top - 0.01, a.cx + half, Math.min(1, a.top + a.h * 0.92)];
}

export function sceneState(scene: CameraScene, tMs: number): SceneState {
  const tSec = tMs / 1000;
  const modes: Record<number, PoseMode> = {};
  const objects: Detection[] = [];
  const poses: PoseDet[] = [];

  for (const a of scene.actors) {
    let mode: PoseMode = Math.sin(tSec * 0.05 + a.seed) > 0.85 ? 'think' : 'write';
    const script = scene.phones.find((p) => p.trackId === a.trackId);
    const pm = script ? phoneMode(script, tSec) : null;
    if (pm) mode = pm;
    modes[a.trackId] = mode;
    const kps = poseFor(a, tSec, mode);
    poses.push({ trackId: a.trackId, conf: 0.9 - (a.seed % 10) / 100, bbox: personBbox(a), keypoints: kps });
    objects.push({ id: `person-${a.trackId}`, cls: 'person', conf: 0.93 - (a.seed % 7) / 100, bbox: personBbox(a), trackId: a.trackId });

    if (pm) {
      const H = a.h;
      const f = a.facing;
      const X = (dx: number) => a.cx + (f * dx * H * a.wScale) / SCENE_ASPECT;
      let b: BBox;
      if (pm === 'phone_hand') {
        const w = (0.075 * H) / SCENE_ASPECT;
        const cx = X(0.005);
        const cy = a.top + 0.48 * H;
        b = [cx - w / 2, cy - 0.055 * H, cx + w / 2, cy + 0.045 * H];
      } else {
        const w = (0.1 * H) / SCENE_ASPECT;
        const cx = X(-0.34);
        const cy = a.top + 0.63 * H;
        b = [cx - w / 2, cy - 0.022 * H, cx + w / 2, cy + 0.022 * H];
      }
      objects.push({ id: `phone-${a.trackId}`, cls: 'phone', conf: pm === 'phone_hand' ? 0.9 : 0.82, bbox: b, trackId: a.trackId, source: pm === 'phone_hand' ? undefined : 'zoom' });
    }
  }
  for (const s of scene.statics) {
    objects.push({ id: s.id, cls: s.cls, conf: s.cls === 'paper' ? 0.78 : 0.84, bbox: s.bbox, points: s.points, trackId: s.trackId });
  }
  return { t: tMs, poses, objects, modes };
}

/** Chọn cảnh cho một camera: cam-01 dùng ảnh thật P.503.1 của nhóm */
export function sceneForCamera(cam: { id: string; position: 'truoc' | 'sau' }): CameraScene {
  return getScene(cam.id, cam.position, cam.id === 'cam-01');
}
