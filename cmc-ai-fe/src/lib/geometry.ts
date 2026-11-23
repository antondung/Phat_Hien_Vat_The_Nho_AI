import type { BBox, CoordSpace, Keypoint, Points } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tính vùng hiển thị nội dung khi "object-fit: contain" */
export function containRect(srcW: number, srcH: number, dstW: number, dstH: number): Rect {
  if (!srcW || !srcH) return { x: 0, y: 0, w: dstW, h: dstH };
  const s = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * s;
  const h = srcH * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** Bộ chuyển toạ độ từ frame (norm hoặc px) sang canvas. mirror: đảo trục X, chỉ khi BE yêu cầu. */
export function makeMapper(coord: CoordSpace, frameW: number, frameH: number, rect: Rect, mirror = false) {
  const sx = coord === 'norm' ? rect.w : rect.w / Math.max(frameW, 1e-6);
  const sy = coord === 'norm' ? rect.h : rect.h / Math.max(frameH, 1e-6);
  return {
    x: (v: number) => (mirror ? rect.x + rect.w - v * sx : rect.x + v * sx),
    y: (v: number) => rect.y + v * sy,
  };
}

export function bboxCenter(b: BBox): [number, number] {
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}

export function bboxFromPoints(pts: Points): BBox {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Hộp xoay -> 4 đỉnh */
export function rotatedRect(cx: number, cy: number, w: number, h: number, angleRad: number, aspect = 1): Points {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const pts: [number, number][] = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  // aspect dùng để xoay đúng trong không gian chuẩn hoá (w/h của frame)
  return pts.map(([x, y]) => [cx + (x * c - y * s * (1 / aspect)), cy + (x * s * aspect + y * c)] as [number, number]);
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

export function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
}

export function overlap(a: BBox, b: BBox): boolean {
  return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

export function scaleKeypoints(kps: Keypoint[], f: (x: number, y: number) => [number, number]): Keypoint[] {
  return kps.map(([x, y, s]) => {
    const [nx, ny] = f(x, y);
    return [nx, ny, s];
  });
}

/** PRNG có seed – để mô phỏng có tính tái lập */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
