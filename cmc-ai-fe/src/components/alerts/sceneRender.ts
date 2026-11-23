/** Vẽ ảnh chụp/khung clip cho một cảnh báo (dùng khi backend chưa trả snapshotUrl/clipUrl) */
import type { Alert, Camera, Detection } from '../../types';
import { sceneForCamera, sceneState } from '../../scene/sceneModel';
import { renderScene } from '../../scene/renderScene';
import { drawOverlay } from '../../lib/overlay';

export function cameraOf(alert: Alert, cameras: Camera[]): { id: string; position: 'truoc' | 'sau'; room: string } {
  const c = cameras.find((x) => x.id === alert.cameraId);
  return { id: alert.cameraId, position: c?.position ?? 'truoc', room: alert.room };
}

export interface FrameView {
  x: number;
  y: number;
  w: number;
  h: number; // vùng cắt (chuẩn hoá) của khung hình
}

export function cropFor(alert: Alert, zoom: boolean): FrameView {
  if (!zoom || !alert.personBbox) return { x: 0, y: 0, w: 1, h: 1 };
  const b = alert.personBbox;
  const ob = alert.objectBbox;
  const x1 = Math.min(b[0], ob?.[0] ?? b[0]);
  const y1 = Math.min(b[1], ob?.[1] ?? b[1]);
  const x2 = Math.max(b[2], ob?.[2] ?? b[2]);
  const y2 = Math.max(b[3], ob?.[3] ?? b[3]);
  let h = Math.max((y2 - y1) * 1.5, ((x2 - x1) * 1.5 * 16) / 9 / (4 / 3), 0.25);
  h = Math.min(1, h);
  const w = Math.min(1, (h * (4 / 3)) / (16 / 9));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h };
}

export function drawAlertFrame(ctx: CanvasRenderingContext2D, alert: Alert, cam: ReturnType<typeof cameraOf>, tMs: number, W: number, H: number, view: FrameView, blinkOn = true, osd = true) {
  const scene = sceneForCamera(cam);
  // vẽ toàn khung lên canvas ảo rồi "phóng" vào vùng cắt
  const fullW = W / view.w;
  const fullH = H / view.h;
  ctx.save();
  ctx.translate(-view.x * fullW, -view.y * fullH);
  renderScene(ctx, scene, tMs, fullW, fullH, { room: cam.room, osd: osd && view.w === 1, grain: false });
  const st = sceneState(scene, tMs);
  const objs: Detection[] = st.objects.filter((o) => o.cls !== 'person' || o.trackId === alert.trackId);
  const poses = st.poses.filter((p) => p.trackId === alert.trackId);
  drawOverlay(
    ctx,
    { coord: 'norm', width: 1280, height: 720, objects: objs, poses },
    { x: 0, y: 0, w: fullW, h: fullH },
    {
      layers: { box: true, pose: true, label: true, conf: false },
      flaggedObjects: new Set(alert.objectId ? [alert.objectId] : []),
      flaggedTracks: new Set(alert.level !== 'thong_tin' && alert.trackId != null ? [alert.trackId] : []),
      blinkOn,
      scale: Math.max(0.6, Math.min(1.3, W / 640)),
    },
  );
  ctx.restore();
}
