/**
 * Kiểm tra ánh xạ overlay: hộp biết trước trên frame 1280×720 phải trùng
 * khi hiện contain 70% (cạnh video) và khi toàn màn hình.
 */
import { containRect, makeMapper } from '../src/lib/geometry.ts';
import { frameContainRect, mapperForFrame, resolveOverlaySpace, shouldDrawDetection, DETECTION_HOLD_MS, DETECTION_SYNC_MS } from '../src/lib/overlayMap.ts';

function almost(a: number, b: number, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`expected ${b}, got ${a}`);
}

// 1280x720 box [160, 90, 480, 450] (px)
const BOX: [number, number, number, number] = [160, 90, 480, 450];
const FRAME_W = 1280;
const FRAME_H = 720;

function mapBox(dstW: number, dstH: number, coord: 'px' | 'norm' = 'px', mirror = false) {
  const f = {
    coord,
    width: FRAME_W,
    height: FRAME_H,
    mirror,
    objects: [{ id: 'p1', cls: 'person' as const, conf: 1, bbox: coord === 'px' ? BOX : [BOX[0] / FRAME_W, BOX[1] / FRAME_H, BOX[2] / FRAME_W, BOX[3] / FRAME_H] }],
    poses: [],
  };
  const space = resolveOverlaySpace(f);
  const rect = frameContainRect(space, dstW, dstH);
  const m = mapperForFrame(space, rect);
  if (!m) throw new Error('no mapper');
  const bb = f.objects[0].bbox;
  return { x1: m.x(bb[0]), y1: m.y(bb[1]), x2: m.x(bb[2]), y2: m.y(bb[2]), rect, space };
}

// --- contain math on a 70%-width panel (e.g. 896 x 500, not 16:9) ---
{
  const dstW = 896, dstH = 500; // typical 70% column
  const r = containRect(FRAME_W, FRAME_H, dstW, dstH);
  const s = Math.min(dstW / FRAME_W, dstH / FRAME_H);
  almost(r.w, FRAME_W * s);
  almost(r.h, FRAME_H * s);
  almost(r.x, (dstW - r.w) / 2);
  almost(r.y, (dstH - r.h) / 2);
  const mapped = mapBox(dstW, dstH, 'px');
  almost(mapped.x1, r.x + BOX[0] * s);
  almost(mapped.y1, r.y + BOX[1] * s);
  almost(mapped.x2, r.x + BOX[2] * s);
  almost(mapped.y2, r.y + BOX[3] * s);
  // norm phải ra cùng chỗ
  const norm = mapBox(dstW, dstH, 'norm');
  almost(norm.x1, mapped.x1);
  almost(norm.y1, mapped.y1);
  console.log('ok 70% panel', { s: +s.toFixed(4), letterboxY: +r.y.toFixed(2) });
}

// --- fullscreen 1920x1080 (cùng 16:9, không letterbox) ---
{
  const dstW = 1920, dstH = 1080;
  const r = containRect(FRAME_W, FRAME_H, dstW, dstH);
  almost(r.x, 0);
  almost(r.y, 0);
  almost(r.w, 1920);
  almost(r.h, 1080);
  const s = 1920 / 1280;
  const mapped = mapBox(dstW, dstH, 'px');
  almost(mapped.x1, BOX[0] * s);
  almost(mapped.y1, BOX[1] * s);
  almost(mapped.x2, BOX[2] * s);
  almost(mapped.y2, BOX[3] * s);
  console.log('ok fullscreen 1920x1080', { s });
}

// --- tự nhận norm khi coord ghi nhầm 'px' nhưng giá trị 0..1 ---
{
  const space = resolveOverlaySpace({
    coord: 'px',
    width: 1280,
    height: 720,
    objects: [{ id: 'a', cls: 'person', conf: 1, bbox: [0.1, 0.2, 0.5, 0.8] }],
  });
  if (space.coord !== 'norm') throw new Error('should detect norm');
  console.log('ok auto coord norm');
}

// --- không tự gương ---
{
  const r = containRect(FRAME_W, FRAME_H, 1280, 720);
  const m0 = makeMapper('px', FRAME_W, FRAME_H, r, false);
  const m1 = makeMapper('px', FRAME_W, FRAME_H, r, true);
  almost(m0.x(160), 160);
  almost(m1.x(160), 1280 - 160);
  const space = resolveOverlaySpace({ width: 1280, height: 720, objects: [] });
  if (space.mirror) throw new Error('must not mirror by default');
  console.log('ok mirror only when asked');
}

// --- drop stale ---
{
  const now = 1_000_000;
  if (!shouldDrawDetection({ receivedAt: now - 400, ts: now - 400 }, now)) throw new Error('400ms should keep');
  if (shouldDrawDetection({ receivedAt: now - (DETECTION_HOLD_MS + 1), ts: now - (DETECTION_HOLD_MS + 1) }, now)) throw new Error('hold exceeded');
  if (shouldDrawDetection({ frameTs: now - (DETECTION_SYNC_MS + 50), receivedAt: now, ts: now }, now, now)) throw new Error('sync drop');
  console.log('ok stale/sync thresholds', { HOLD: DETECTION_HOLD_MS, SYNC: DETECTION_SYNC_MS });
}

console.log('ALL OVERLAY MAP TESTS PASSED');
