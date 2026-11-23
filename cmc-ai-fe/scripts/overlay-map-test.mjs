/** Kiểm tra ánh xạ overlay (bản thuần JS, cùng công thức với src/lib/geometry.ts + overlayMap.ts). */
function containRect(srcW, srcH, dstW, dstH) {
  if (!srcW || !srcH) return { x: 0, y: 0, w: dstW, h: dstH };
  const s = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * s, h = srcH * s;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}
function makeMapper(coord, frameW, frameH, rect, mirror = false) {
  const sx = coord === 'norm' ? rect.w : rect.w / Math.max(frameW, 1e-6);
  const sy = coord === 'norm' ? rect.h : rect.h / Math.max(frameH, 1e-6);
  return {
    x: (v) => (mirror ? rect.x + rect.w - v * sx : rect.x + v * sx),
    y: (v) => rect.y + v * sy,
  };
}
function collect(f) {
  const out = [];
  for (const o of f.objects ?? []) {
    if (o.bbox) out.push(...o.bbox);
  }
  return out.filter(Number.isFinite);
}
function resolveOverlaySpace(f) {
  const vals = collect(f);
  const max = vals.length ? Math.max(...vals.map(Math.abs)) : 0;
  let coord = f.coord === 'norm' || f.coord === 'px' ? f.coord : max <= 1.5 ? 'norm' : 'px';
  if (vals.length) coord = max <= 1.5 ? 'norm' : 'px';
  return { coord, width: Number(f.width) || 0, height: Number(f.height) || 0, mirror: f.mirror === true };
}
function almost(a, b, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`expected ${b}, got ${a}`);
}

const BOX = [160, 90, 480, 450];
const FRAME_W = 1280, FRAME_H = 720;
function mapBox(dstW, dstH, coord = 'px') {
  const bbox = coord === 'px' ? BOX : [BOX[0] / FRAME_W, BOX[1] / FRAME_H, BOX[2] / FRAME_W, BOX[3] / FRAME_H];
  const space = resolveOverlaySpace({ coord, width: FRAME_W, height: FRAME_H, objects: [{ bbox }] });
  const rect = containRect(space.width, space.height, dstW, dstH);
  const m = makeMapper(space.coord, space.width, space.height, rect, space.mirror);
  return { x1: m.x(bbox[0]), y1: m.y(bbox[1]), x2: m.x(bbox[2]), y2: m.y(bbox[3]), rect };
}

// 70% panel, not 16:9 — letterbox must be accounted for
{
  const dstW = 896, dstH = 500;
  const r = containRect(FRAME_W, FRAME_H, dstW, dstH);
  const s = Math.min(dstW / FRAME_W, dstH / FRAME_H);
  const mapped = mapBox(dstW, dstH, 'px');
  almost(mapped.x1, r.x + BOX[0] * s);
  almost(mapped.y1, r.y + BOX[1] * s);
  almost(mapped.x2, r.x + BOX[2] * s);
  almost(mapped.y2, r.y + BOX[3] * s);
  const norm = mapBox(dstW, dstH, 'norm');
  almost(norm.x1, mapped.x1);
  almost(norm.y1, mapped.y1);
  console.log('ok 70% panel', { s: +s.toFixed(4), letterboxY: +r.y.toFixed(2) });
}

// 800x600 — letterbox dọc rõ ràng
{
  const dstW = 800, dstH = 600;
  const r = containRect(FRAME_W, FRAME_H, dstW, dstH);
  const s = Math.min(dstW / FRAME_W, dstH / FRAME_H);
  if (!(r.y > 10)) throw new Error('expected vertical letterbox');
  const mapped = mapBox(dstW, dstH, 'px');
  almost(mapped.x1, r.x + BOX[0] * s);
  almost(mapped.y1, r.y + BOX[1] * s);
  console.log('ok letterbox 800x600', { s: +s.toFixed(4), letterboxY: +r.y.toFixed(2) });
}
// fullscreen 1920x1080
{
  const s = 1920 / 1280;
  const mapped = mapBox(1920, 1080, 'px');
  almost(mapped.x1, BOX[0] * s);
  almost(mapped.y1, BOX[1] * s);
  almost(mapped.x2, BOX[2] * s);
  almost(mapped.y2, BOX[3] * s);
  almost(mapped.rect.x, 0);
  almost(mapped.rect.y, 0);
  console.log('ok fullscreen 1920x1080', { s });
}
{
  const space = resolveOverlaySpace({ coord: 'px', width: 1280, height: 720, objects: [{ bbox: [0.1, 0.2, 0.5, 0.8] }] });
  if (space.coord !== 'norm') throw new Error('should detect norm');
  console.log('ok auto coord norm');
}
{
  const r = containRect(FRAME_W, FRAME_H, 1280, 720);
  almost(makeMapper('px', FRAME_W, FRAME_H, r, false).x(160), 160);
  almost(makeMapper('px', FRAME_W, FRAME_H, r, true).x(160), 1280 - 160);
  if (resolveOverlaySpace({ width: 1280, height: 720, objects: [] }).mirror) throw new Error('no default mirror');
  console.log('ok mirror only when asked');
}
console.log('ALL OVERLAY MAP TESTS PASSED');
