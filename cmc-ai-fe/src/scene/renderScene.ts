/**
 * Vẽ "video giả lập" của camera phòng thi lên canvas.
 * - Cảnh 'photo': ảnh thật P.503.1 + hiệu ứng nhiễu/giờ CCTV.
 * - Cảnh 'synthetic': vẽ phòng thi, bàn ghế và thí sinh chuyển động theo sceneState.
 */
import { SAMPLE_IMAGE_URL, sceneState, type Actor, type CameraScene, type PoseMode } from './sceneModel';
import type { Keypoint } from '../types';

let sampleImg: HTMLImageElement | null = null;
export function getSampleImage(): HTMLImageElement {
  if (!sampleImg) {
    sampleImg = new Image();
    sampleImg.src = SAMPLE_IMAGE_URL;
  }
  return sampleImg;
}

let noise: HTMLCanvasElement | null = null;
function noiseCanvas(): HTMLCanvasElement {
  if (!noise) {
    noise = document.createElement('canvas');
    noise.width = noise.height = 128;
    const c = noise.getContext('2d')!;
    const d = c.createImageData(128, 128);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    c.putImageData(d, 0, 0);
  }
  return noise;
}

const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const p2 = (n: number) => String(n).padStart(2, '0');

export interface RenderOpts {
  room?: string;
  cameraName?: string;
  osd?: boolean; // hiển thị giờ/nhãn phòng kiểu CCTV
  grain?: boolean;
  /** giờ hiển thị trên OSD (mặc định = tMs) – dùng cho video mẫu có t tính từ 0 */
  clockMs?: number;
}

export function renderScene(ctx: CanvasRenderingContext2D, scene: CameraScene, tMs: number, W: number, H: number, opts: RenderOpts = {}) {
  ctx.save();
  if (scene.kind === 'photo') {
    const img = getSampleImage();
    if (img.complete && img.naturalWidth) {
      ctx.drawImage(img, 0, 0, W, H);
      // che dấu giờ in sẵn trong ảnh gốc để vẽ giờ "trực tiếp"
      ctx.fillStyle = 'rgba(90,90,90,0.92)';
      ctx.fillRect(0, H * 0.04, W * 0.31, H * 0.075);
    } else {
      ctx.fillStyle = '#3a3f47';
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    drawSynthetic(ctx, scene, tMs, W, H);
  }

  if (opts.grain !== false) {
    ctx.globalAlpha = 0.05;
    const n = noiseCanvas();
    const ox = Math.floor(Math.random() * 128);
    const oy = Math.floor(Math.random() * 128);
    ctx.translate(-ox, -oy);
    ctx.fillStyle = ctx.createPattern(n, 'repeat')!;
    ctx.fillRect(ox, oy, W, H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  if (opts.osd !== false) {
    const d = new Date(opts.clockMs ?? tMs);
    const txt = `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()} ${WEEKDAY[d.getDay()]} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
    const fs = Math.max(9, H * 0.045);
    ctx.font = `600 ${fs}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.lineWidth = Math.max(2, fs * 0.15);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'top';
    ctx.strokeText(txt, W * 0.012, H * 0.05);
    ctx.fillText(txt, W * 0.012, H * 0.05);
    if (opts.room && scene.kind !== 'photo') {
      const rt = opts.room;
      const tw = ctx.measureText(rt).width;
      ctx.strokeText(rt, W - tw - W * 0.03, H * 0.88);
      ctx.fillText(rt, W - tw - W * 0.03, H * 0.88);
    }
  }
  ctx.restore();
}

function drawSynthetic(ctx: CanvasRenderingContext2D, scene: CameraScene, tMs: number, W: number, H: number) {
  const pal = scene.palette;
  // tường + sàn
  // màu phẳng (không gradient)
  ctx.fillStyle = shade(pal.wall, -6);
  ctx.fillRect(0, 0, W, H * 0.4);
  ctx.fillStyle = shade(pal.floor, -4);
  ctx.beginPath();
  ctx.moveTo(0, H * 0.42);
  ctx.lineTo(W, H * 0.42);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.fill();
  // ron gạch
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = -6; i <= 12; i++) {
    ctx.beginPath();
    ctx.moveTo(W / 2 + i * W * 0.03, H * 0.42);
    ctx.lineTo(W / 2 + i * W * 0.16, H);
    ctx.stroke();
  }
  // bảng / cửa sổ trên tường
  const front = scene.actors[0]?.facing !== -1;
  ctx.fillStyle = front ? 'rgba(255,255,255,0.55)' : '#2F4F3E';
  ctx.fillRect(W * 0.3, H * 0.05, W * 0.4, H * 0.16);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(W * 0.3, H * 0.05, W * 0.4, H * 0.16);
  if (front) {
    ctx.fillStyle = 'rgba(180,210,235,0.55)';
    for (let i = 0; i < 3; i++) ctx.fillRect(W * (0.32 + i * 0.13), H * 0.065, W * 0.11, H * 0.13);
  }
  // đồng hồ treo tường
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(W * 0.86, H * 0.1, H * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#333';
  ctx.stroke();

  const st = sceneState(scene, tMs);
  const tSec = tMs / 1000;
  const kpById = new Map(st.poses.map((p) => [p.trackId, p.keypoints]));
  const rows = [0, 1, 2];
  for (const r of rows) {
    const actors = scene.actors.filter((a) => a.row === r);
    const row = scene.rows[r];
    for (const a of actors) drawBody(ctx, a, kpById.get(a.trackId)!, W, H);
    if (row) drawDesk(ctx, row, pal, W, H);
    for (const a of actors) {
      drawArms(ctx, a, kpById.get(a.trackId)!, W, H);
      // vật thể trên bàn của thí sinh này
      for (const o of st.objects) {
        if (o.trackId !== a.trackId || o.cls === 'person') continue;
        drawObject(ctx, o.cls, o.bbox, o.points, W, H, tSec, st.modes[a.trackId]);
      }
    }
  }
}

function drawBody(ctx: CanvasRenderingContext2D, a: Actor, k: Keypoint[], W: number, H: number) {
  const px = (i: number): [number, number] => [k[i][0] * W, k[i][1] * H];
  const [lsx, lsy] = px(5);
  const [rsx, rsy] = px(6);
  const [lhx, lhy] = px(11);
  const [rhx, rhy] = px(12);
  const hh = a.h * H;
  // ghế
  ctx.fillStyle = 'rgba(40,40,45,0.85)';
  const cw = Math.abs(lsx - rsx) * 1.1;
  ctx.fillRect(a.cx * W - cw / 2, (a.top + a.h * 0.35) * H, cw, hh * 0.3);
  // thân
  ctx.fillStyle = a.shirt;
  ctx.strokeStyle = 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const pad = Math.abs(lsx - rsx) * 0.08;
  ctx.moveTo(lsx + Math.sign(lsx - rsx) * pad, lsy);
  ctx.quadraticCurveTo((lsx + rsx) / 2, lsy - hh * 0.04, rsx - Math.sign(lsx - rsx) * pad, rsy);
  ctx.lineTo(rhx, rhy);
  ctx.lineTo(lhx, lhy);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // cổ + đầu
  const [nx] = px(0);
  const headCx = nx;
  const headCy = (k[3][1] * H + k[4][1] * H) / 2 - hh * 0.005;
  const r = hh * 0.085;
  ctx.fillStyle = a.skin;
  ctx.fillRect(headCx - r * 0.35, headCy + r * 0.6, r * 0.7, hh * 0.1);
  ctx.beginPath();
  ctx.ellipse(headCx, headCy, r * 0.88, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = a.hair;
  ctx.beginPath();
  if (a.facing === 1) {
    ctx.ellipse(headCx, headCy - r * 0.35, r * 0.92, r * 0.7, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    // mắt
    ctx.fillStyle = 'rgba(20,20,20,0.7)';
    const [ex1, ey1] = px(1);
    const [ex2, ey2] = px(2);
    ctx.fillRect(ex1 - r * 0.12, ey1 + r * 0.15, r * 0.24, r * 0.1);
    ctx.fillRect(ex2 - r * 0.12, ey2 + r * 0.15, r * 0.24, r * 0.1);
  } else {
    ctx.ellipse(headCx, headCy - r * 0.1, r * 0.92, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawArms(ctx: CanvasRenderingContext2D, a: Actor, k: Keypoint[], W: number, H: number) {
  const hh = a.h * H;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [s, e, w] of [
    [5, 7, 9],
    [6, 8, 10],
  ]) {
    ctx.strokeStyle = shade(a.shirt === '#F8FAFC' ? '#E5E7EB' : a.shirt, -8);
    ctx.lineWidth = hh * 0.075;
    ctx.beginPath();
    ctx.moveTo(k[s][0] * W, k[s][1] * H);
    ctx.lineTo(k[e][0] * W, k[e][1] * H);
    ctx.stroke();
    ctx.strokeStyle = a.skin;
    ctx.lineWidth = hh * 0.055;
    ctx.beginPath();
    ctx.moveTo(k[e][0] * W, k[e][1] * H);
    ctx.lineTo(k[w][0] * W, k[w][1] * H);
    ctx.stroke();
    ctx.fillStyle = a.skin;
    ctx.beginPath();
    ctx.arc(k[w][0] * W, k[w][1] * H, hh * 0.04, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawDesk(ctx: CanvasRenderingContext2D, row: CameraScene['rows'][number], pal: CameraScene['palette'], W: number, H: number) {
  const y = row.y * H;
  const depth = row.h * 0.1 * H;
  const face = row.h * 0.16 * H;
  const x1 = row.x1 * W;
  const x2 = row.x2 * W;
  const skew = row.h * 0.05 * W;
  ctx.fillStyle = pal.desk;
  ctx.beginPath();
  ctx.moveTo(x1 + skew, y);
  ctx.lineTo(x2 - skew, y);
  ctx.lineTo(x2, y + depth);
  ctx.lineTo(x1, y + depth);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = pal.deskFront;
  ctx.fillRect(x1, y + depth, x2 - x1, face);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.strokeRect(x1, y + depth, x2 - x1, face);
  // chân bàn
  ctx.fillStyle = '#6B7280';
  ctx.fillRect(x1 + 4, y + depth + face, 4, face * 0.7);
  ctx.fillRect(x2 - 8, y + depth + face, 4, face * 0.7);
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  cls: string,
  b: [number, number, number, number],
  pts: [number, number][] | undefined,
  W: number,
  H: number,
  tSec: number,
  mode: PoseMode,
) {
  if (cls === 'paper') {
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath();
    if (pts) {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
    } else ctx.rect(b[0] * W, b[1] * H, (b[2] - b[0]) * W, (b[3] - b[1]) * H);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (cls === 'calculator') {
    ctx.fillStyle = '#374151';
    roundRect(ctx, b[0] * W, b[1] * H, (b[2] - b[0]) * W, (b[3] - b[1]) * H, 2);
    ctx.fill();
    ctx.fillStyle = '#A7F3D0';
    ctx.fillRect(b[0] * W + 2, b[1] * H + 1.5, (b[2] - b[0]) * W - 4, ((b[3] - b[1]) * H) / 3);
  } else if (cls === 'phone') {
    ctx.fillStyle = '#0F172A';
    roundRect(ctx, b[0] * W, b[1] * H, (b[2] - b[0]) * W, (b[3] - b[1]) * H, 3);
    ctx.fill();
    const glow = mode === 'phone_hand' ? 0.75 + 0.2 * Math.sin(tSec * 3) : 0.35;
    ctx.fillStyle = `rgba(147,197,253,${glow})`;
    ctx.fillRect(b[0] * W + 2, b[1] * H + 2, (b[2] - b[0]) * W - 4, (b[3] - b[1]) * H - 4);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16) + amt));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + amt));
  const b = Math.min(255, Math.max(0, (n & 0xff) + amt));
  return `rgb(${r},${g},${b})`;
}
