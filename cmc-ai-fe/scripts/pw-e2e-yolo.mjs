import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('/workspace/pwtest/node_modules/playwright-core');
const FE = process.env.FE_URL || 'http://127.0.0.1:4176';
const BE = process.env.BE_URL || 'http://127.0.0.1:8020';
const MJPEG = process.env.MJPEG_URL || 'http://127.0.0.1:8092';
const OUT = process.env.SHOT_DIR || '/workspace/fe-shots/e2e-yolo';
fs.mkdirSync(OUT, { recursive: true });

const EMAIL = 'admin@cmc.edu.vn';
const PASS = 'admin123';

async function loginApi() {
  const r = await fetch(BE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const j = await r.json();
  if (!j.token) throw new Error('login failed ' + JSON.stringify(j));
  return j.token;
}

async function api(token, method, p, body) {
  const r = await fetch(BE + '/api' + p, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  let j; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
  if (!r.ok) throw new Error(`${method} ${p} ${r.status} ${t}`);
  return j;
}

const log = { startedAt: new Date().toISOString(), detections: [], events: [] };
const note = (s, extra) => { log.events.push({ t: Date.now(), s, ...extra }); console.log(s, extra || ''); };

const token = await loginApi();
const cams0 = await api(token, 'GET', '/cameras');
note(`before camera: BE has ${cams0.length} cameras`, { health: await fetch(BE + '/api/health').then((r) => r.json()) });

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.setDefaultTimeout(30000);

const wsPackets = [];
page.on('websocket', (ws) => {
  if (!String(ws.url()).includes('/ws')) return;
  ws.on('framereceived', (ev) => {
    let msg;
    try { msg = JSON.parse(typeof ev.payload === 'string' ? ev.payload : ev.payload.toString()); } catch { return; }
    if (msg.type === 'detections') {
      const d = msg.data || {};
      const rec = {
        t: Date.now(),
        cameraId: d.cameraId,
        frameId: d.frameId,
        frameTs: d.frameTs,
        ts: d.ts,
        width: d.width,
        height: d.height,
        frameW: d.frameW,
        frameH: d.frameH,
        coord: d.coord,
        mirror: d.mirror,
        nObj: (d.objects || []).length,
        nPose: (d.poses || []).length,
        classes: [...new Set((d.objects || []).map((o) => o.cls))],
        bboxes: (d.objects || []).slice(0, 4).map((o) => ({ cls: o.cls, bbox: o.bbox })),
      };
      rec.latencyMs = rec.frameTs ? rec.t - rec.frameTs : rec.ts ? rec.t - rec.ts : null;
      wsPackets.push(rec);
      log.detections.push(rec);
    }
  });
});

await page.goto(FE + '/dang-nhap', { waitUntil: 'domcontentloaded' });
if (page.url().includes('dang-nhap')) {
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !String(u).includes('dang-nhap'), { timeout: 20000 }),
    page.locator('button.btn-primary').click(),
  ]);
}
await page.goto(FE + '/giam-sat/camera', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const emptyText = await page.locator('body').innerText();
const emptyOk = /Chưa có camera/i.test(emptyText);
await page.screenshot({ path: path.join(OUT, '01-empty-before-camera.png') });
note('step1 empty screen', { emptyOk, snippet: emptyText.slice(0, 200) });
if (!emptyOk) console.warn('WARN: expected empty camera state');

// Restart the person clip from the beginning so the walk is ahead of us.
await fetch(MJPEG + '/mode', { method: 'POST', body: 'people' });
await new Promise((r) => setTimeout(r, 400));

const cam = await api(token, 'POST', '/cameras', {
  name: 'E2E Person',
  room: 'P.TEST',
  position: 'truoc',
  sourceType: 'http',
  sourceUrl: MJPEG + '/video',
  enabled: true,
});
note('created camera', cam);

await page.goto(FE + '/giam-sat/camera/' + cam.id, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.live-page, .feed, .live-empty-page', { timeout: 20000 });
await page.waitForTimeout(1000);
await page.screenshot({ path: path.join(OUT, '02-just-connected.png') });

const deadline = Date.now() + 45000;
let gotPerson = false;
while (Date.now() < deadline) {
  const last = [...wsPackets].reverse().find((d) => d.nObj > 0 || d.nPose > 0);
  if (last && (last.classes.includes('person') || last.nPose > 0)) {
    gotPerson = true;
    note('first person detection', last);
    break;
  }
  await page.waitForTimeout(400);
}
if (!gotPerson) {
  note('NO person detection within 45s', { packets: wsPackets.length, last: wsPackets.slice(-3) });
}

const shots = [];
let lastShotT = 0;
for (let i = 0; i < 3; i++) {
  const name = `03-person-${i + 1}.png`;
  const needGap = i === 0 ? 0 : 1200;
  const until = Date.now() + 40000;
  let last = null;
  while (Date.now() < until) {
    const cur = wsPackets[wsPackets.length - 1];
    if (cur && (cur.nObj > 0 || cur.nPose > 0) && cur.t >= lastShotT + needGap && Date.now() - cur.t < 900) {
      last = cur;
      break;
    }
    await page.waitForTimeout(120);
  }
  await page.screenshot({ path: path.join(OUT, name) });
  shots.push({ name, last, chip: await page.evaluate(() => {
    const el = document.querySelector('.model-status');
    return el ? el.textContent.trim() : '';
  }) });
  lastShotT = last ? last.t : Date.now();
  note('person screenshot ' + name, last);
  if (!last) note('WARN no live person packet for ' + name);
}

// Contract checks: diag, system/model, model chip, dashboard spark, models empty metrics
let diag = null, sysModel = null, chip = null, modelsUi = null, dashUi = null;
try {
  diag = await api(token, 'GET', '/cameras/' + cam.id + '/diag');
  sysModel = await fetch(BE + '/api/system/model', { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json());
  chip = await page.evaluate(() => {
    const el = document.querySelector('.model-status');
    return el ? { text: el.textContent.trim(), title: el.getAttribute('title') || '', kind: [...el.classList].find((c) => c.startsWith('kind-')) } : null;
  });
  note('diag + chip', { detector: diag && diag.detector, lastObjects: diag && diag.lastObjects, detectFps: diag && diag.detectFps, inferMs: diag && diag.inferMs, framesRead: diag && diag.framesRead, analysedFrames: diag && diag.analysedFrames, lastError: diag && diag.lastError, chip });

  await page.goto(FE + '/dashboard', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  dashUi = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.stat-card')].map((c) => ({
      label: (c.querySelector('.stat-label')?.textContent || '').trim(),
      hasSpark: !!c.querySelector('svg, canvas, .sparkline'),
    }));
    return { cards, text: document.body.innerText.slice(0, 500) };
  });
  await page.screenshot({ path: path.join(OUT, '05-dashboard.png') });
  note('dashboard spark check', dashUi);

  await page.goto(FE + '/mo-hinh', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const modelsText = await page.locator('body').innerText();
  modelsUi = {
    emptyMetrics: /Chưa có chỉ số đánh giá/i.test(modelsText),
    emptyFps: /Chưa có số đo/i.test(modelsText),
    snippet: modelsText.slice(0, 400),
  };
  await page.screenshot({ path: path.join(OUT, '06-models.png') });
  note('models empty state', modelsUi);

  await page.goto(FE + '/giam-sat/camera/' + cam.id, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.live-page, .feed, .live-empty-page', { timeout: 20000 });
  await page.waitForTimeout(500);
} catch (e) {
  note('contract check failed', { err: String(e && e.message || e) });
}

await fetch(MJPEG + '/mode', { method: 'POST', body: 'black' });
note('switched to black frames');
const tBlack = Date.now();
let goneAt = null;
const waitGone = 8000;
while (Date.now() - tBlack < waitGone) {
  const recent = wsPackets.filter((d) => d.t >= tBlack - 200);
  const last = recent[recent.length - 1] || wsPackets[wsPackets.length - 1];
  if (last && last.t >= tBlack && last.nObj === 0 && last.nPose === 0) {
    goneAt = last.t;
    note('empty detections after black', { ms: goneAt - tBlack, last });
    break;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1800);
await page.screenshot({ path: path.join(OUT, '04-after-black.png') });
note('after black screenshot', { goneAt, delayMs: goneAt ? goneAt - tBlack : null, last: wsPackets.slice(-3) });

// restore people for cleanliness
await fetch(MJPEG + '/mode', { method: 'POST', body: 'people' });

const windowMs = 5000;
const now = Date.now();
const recentDet = log.detections.filter((d) => d.t > now - 30000 && d.t < (tBlack || now));
const dt = recentDet.length >= 2 ? (recentDet[recentDet.length - 1].t - recentDet[0].t) / 1000 : 0;
const fps = dt > 0 ? (recentDet.length - 1) / dt : 0;
const lats = recentDet.map((d) => d.latencyMs).filter((n) => n != null && n > 0 && n < 60000);
const meanLat = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : null;
const last = log.detections.at(-1);
log.summary = {
  emptyOk,
  gotPerson,
  boxesGoneMs: goneAt ? goneAt - tBlack : null,
  detections: log.detections.length,
  fpsBeforeBlack: +fps.toFixed(3),
  meanLatencyMs: meanLat != null ? Math.round(meanLat) : null,
  lastFrameSize: last && { w: last.width, h: last.height, frameW: last.frameW, frameH: last.frameH, coord: last.coord, mirror: last.mirror, cameraId: last.cameraId },
  diag: diag && { detector: diag.detector, detectFps: diag.detectFps, lastObjects: diag.lastObjects, inferMs: diag.inferMs, framesRead: diag.framesRead, analysedFrames: diag.analysedFrames, lastDetectTs: diag.lastDetectTs, lastError: diag.lastError },
  sysModel: sysModel && { detModel: sysModel.detModel, poseModel: sysModel.poseModel, device: sysModel.device, imgSize: sysModel.imgSize, conf: sysModel.conf, iou: sysModel.iou, detectFps: sysModel.detectFps, fallback: sysModel.fallback, nClasses: Array.isArray(sysModel.classes) ? sysModel.classes.length : 0 },
  chip,
  dashCamerasSpark: dashUi && dashUi.cards ? dashUi.cards.find((c) => /Camera/i.test(c.label)) : null,
  modelsUi,
};
fs.writeFileSync(path.join(OUT, 'log.json'), JSON.stringify(log, null, 2));
console.log('SUMMARY', log.summary);

try { await api(token, 'DELETE', '/cameras/' + cam.id); } catch (e) { console.warn('cleanup', e.message); }
await browser.close();

if (!emptyOk || !gotPerson) process.exit(2);
