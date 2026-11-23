/**
 * Ánh xạ toạ độ detections từ frame của BE lên vùng video (object-fit: contain).
 * - Chỉ scale theo width/height của gói detections, không dùng cỡ mặc định 1920×1080
 *   và không dùng kích thước phần tử làm hệ số scale.
 * - Tự phân biệt toạ độ chuẩn hoá (0..1) và pixel khi trường `coord` lệch.
 * - Chỉ gương ngang khi BE gửi mirror/mirrored/flipX = true.
 * - Không vẽ gói đã cũ (hold tối đa ~2s; đồng bộ theo frameTs khi có).
 */
import type { CoordSpace, Detection, DetectionFrame, PoseDet } from '../types';
import { containRect, makeMapper, type Rect } from './geometry';

/** Nếu có mốc thời gian khung video, bỏ detections trễ hơn khoảng này. */
export const DETECTION_SYNC_MS = 500;
/** Khi không còn gói mới (và không có frameTs video), giữ lớp phủ tối đa chừng này rồi xoá. */
export const DETECTION_HOLD_MS = 2000;

export type OverlaySpace = {
  coord: CoordSpace;
  width: number;
  height: number;
  mirror: boolean;
};

type FrameLike = {
  coord?: string;
  width?: number;
  height?: number;
  w?: number;
  h?: number;
  frameWidth?: number;
  frameHeight?: number;
  frameW?: number;
  frameH?: number;
  mirror?: boolean;
  mirrored?: boolean;
  flipX?: boolean;
  objects?: Detection[];
  poses?: PoseDet[];
  frameTs?: number;
  ts?: number;
  receivedAt?: number;
};

export function collectCoordValues(f: { objects?: Detection[]; poses?: PoseDet[] }): number[] {
  const out: number[] = [];
  for (const o of f.objects ?? []) {
    if (o.bbox) out.push(o.bbox[0], o.bbox[1], o.bbox[2], o.bbox[3]);
    if (o.points) for (const p of o.points) out.push(p[0], p[1]);
  }
  for (const p of f.poses ?? []) {
    if (p.bbox) out.push(p.bbox[0], p.bbox[1], p.bbox[2], p.bbox[3]);
    if (p.keypoints) for (const k of p.keypoints) out.push(k[0], k[1]);
  }
  return out.filter((n) => Number.isFinite(n));
}

/** Đọc cỡ frame / hệ toạ độ / gương từ gói BE, không gán mặc định dataset. */
export function resolveOverlaySpace(f: FrameLike): OverlaySpace {
  const vals = collectCoordValues(f);
  const max = vals.length ? Math.max(...vals.map((n) => Math.abs(n))) : 0;
  let coord: CoordSpace = f.coord === 'norm' || f.coord === 'px' ? f.coord : max <= 1.5 ? 'norm' : 'px';
  if (vals.length) coord = max <= 1.5 ? 'norm' : 'px';
  const width = Number(f.frameW ?? f.width ?? f.frameWidth ?? f.w) || 0;
  const height = Number(f.frameH ?? f.height ?? f.frameHeight ?? f.h) || 0;
  const mirror = f.mirror === true || f.mirrored === true || f.flipX === true;
  return { coord, width, height, mirror };
}

/**
 * Vùng chứa video trên canvas (letter/pillarbox), theo tỉ lệ frame detections
 * (fallback tỉ lệ ảnh chỉ khi BE không gửi width/height).
 */
export function frameContainRect(space: OverlaySpace, dstW: number, dstH: number, imgW = 0, imgH = 0): Rect {
  const srcW = space.width || imgW || 16;
  const srcH = space.height || imgH || 9;
  return containRect(srcW, srcH, dstW, dstH);
}

export function mapperForFrame(space: OverlaySpace, rect: Rect) {
  const fw = space.width || 1;
  const fh = space.height || 1;
  if (space.coord === 'px' && (!space.width || !space.height)) return null;
  return makeMapper(space.coord, fw, fh, rect, space.mirror);
}

/**
 * true = được vẽ. Dùng receivedAt để biết gói còn mới với đồng hồ máy khách.
 * Nếu truyền displayFrameTs (mốc khung video đang hiện), bỏ detections trễ > 500ms.
 */
/** Khung đã phân tích nhưng không có đối tượng (objects:[], poses:[]) — xoá lớp phủ ngay. */
export function isEmptyDetection(f: { objects?: Detection[]; poses?: PoseDet[] } | undefined): boolean {
  if (!f) return true;
  if (!Array.isArray(f.objects) && !Array.isArray(f.poses)) return false;
  return (f.objects?.length ?? 0) === 0 && (f.poses?.length ?? 0) === 0;
}

export function shouldDrawDetection(
  f: { frameTs?: number; ts?: number; receivedAt?: number },
  now = Date.now(),
  displayFrameTs?: number,
): boolean {
  const recv = f.receivedAt ?? f.ts;
  if (recv != null && now - recv > DETECTION_HOLD_MS) return false;
  if (displayFrameTs != null && f.frameTs != null) {
    const skew = displayFrameTs - f.frameTs;
    if (skew > DETECTION_SYNC_MS) return false;
  }
  return true;
}

export function objectCount(f: { objects?: Detection[]; poses?: PoseDet[] } | undefined): number {
  if (!f) return 0;
  const n = f.objects?.length ?? 0;
  return n || (f.poses?.length ?? 0);
}

/** Chuẩn hoá một số alias trường của BE trước khi lưu vào LiveContext. */
export function normalizeIncomingFrame(f: DetectionFrame & FrameLike): DetectionFrame {
  const space = resolveOverlaySpace(f);
  return {
    ...f,
    coord: space.coord,
    width: space.width || f.width,
    height: space.height || f.height,
    frameW: space.width || f.frameW,
    frameH: space.height || f.frameH,
    mirror: space.mirror || undefined,
  };
}
