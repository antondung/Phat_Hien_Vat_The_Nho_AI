/** E2E thật: model giám thị/thí sinh (BE + role_best.pt) — Phân tích ảnh/video, trang Mô hình, camera gửi hình qua trình duyệt. */
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/workspace/pwtest/node_modules/playwright-core');
const BASE = process.env.FE_URL || 'http://127.0.0.1:5182';
const BE = process.env.BE_URL || 'http://127.0.0.1:8031';
const OUT = process.env.OUT || '/workspace/fe-shots/roles-real';
const IMG = process.env.IMG || '/workspace/exam-monitor-fe/public/samples/phong-thi-P503.jpg';
const VID = process.env.VID || '/tmp/rr/p503-20s.mp4';
const VID2 = process.env.VID2 || '/workspace/video-test-phan-tich-49s.mp4';
const FAKE = process.env.FAKE || '/tmp/rr/p503.mjpeg';
const STEPS = (process.env.STEPS || 'img,vid,vid2,model,push').split(',');

const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${FAKE}`] });
const ctx = await b.newContext({ viewport: { width: 1229, height: 603 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
const persons = (frames) => frames.flatMap((f) => (f.objects || []).filter((o) => o.cls === 'person').map((o) => ({ t: f.t, trackId: o.trackId, role: o.role, label: o.label, studentNo: o.studentNo, source: o.source, roleConf: o.roleConf })));
const jobFrames = [];
const liveDet = [];
const alertsSeen = [];
p.on('websocket', (ws) => {
  ws.on('framereceived', (fr) => {
    if (typeof fr.payload !== 'string' || fr.payload.length < 10) return;
    try {
      const m = JSON.parse(fr.payload);
      const d = m.data ?? m;
      if (Array.isArray(d.frames)) jobFrames.push(...d.frames);
      if (m.type === 'detections') liveDet.push(d);
      if (m.type === 'alert') alertsSeen.push(d);
    } catch {}
  });
});
p.on('response', async (r) => {
  if (/\/api\/analysis\/jobs\/[^/?]+(\?|$)/.test(r.url()) && r.request().method() === 'GET') {
    try { const j = await r.json(); if (Array.isArray(j.frames)) jobFrames.push(...j.frames); } catch {}
  }
});
await p.goto(`${BASE}/dang-nhap`);
await p.fill('input[type="email"]', 'admin@cmc.edu.vn'); await p.fill('input[type="password"]', 'admin123');
await p.click('button.btn-primary'); await p.waitForSelector('.sidebar');
const tok = await p.evaluate(() => Object.entries(localStorage).find(([k]) => /token|auth/i.test(k))?.[1]);
const authTok = (() => { try { const v = JSON.parse(tok); return v.token || v.accessToken || v; } catch { return tok; } })();
const api = async (path) => (await fetch(`${BE}/api${path}`, { headers: { Authorization: `Bearer ${authTok}` } })).json();

const summarize = (label) => {
  const ps = persons(jobFrames);
  const byRole = ps.reduce((m, x) => ((m[x.role ?? 'none'] = (m[x.role ?? 'none'] || 0) + 1), m), {});
  const bad = ps.filter((x) => x.role !== 'invigilator' && x.label !== `#${x.trackId}`);
  const inv = ps.filter((x) => x.role === 'invigilator');
  const zoomPhones = jobFrames.flatMap((f) => (f.objects || []).filter((o) => o.cls === 'phone').map((o) => ({ t: f.t, source: o.source, conf: o.conf, trackId: o.trackId })));
  const last = jobFrames[jobFrames.length - 1] || {};
  console.log(label, 'frames', jobFrames.length, 'person-instances', ps.length, 'byRole', JSON.stringify(byRole),
    'labelMismatch', bad.length, 'invLabels', [...new Set(inv.map((x) => `${x.label}/no=${x.studentNo}/tid=${x.trackId}`))].slice(0, 5).join(' '),
    'sourceRole', ps.filter((x) => x.source === 'role').length, 'frameKeys', Object.keys(last).join(','),
    'roleEnabled', last.roleEnabled, 'roleCounts', JSON.stringify(last.roleCounts),
    'phones', zoomPhones.length, 'sourceZoom', zoomPhones.filter((x) => x.source === 'zoom').length,
    'zoomSample', JSON.stringify(zoomPhones.filter((x) => x.source === 'zoom').slice(0, 5)));
};

async function analyse(file, name, waitMs, shotAt) {
  jobFrames.length = 0;
  await p.goto(`${BASE}/phan-tich`); await p.waitForSelector('.det-grid');
  await p.setInputFiles('input[type="file"]', file);
  await p.waitForTimeout(800);
  const runBtn = p.getByRole('button', { name: /^Phân tích$/ });
  if (await runBtn.count()) await runBtn.first().click().catch(() => {});
  const t0 = Date.now();
  await p.waitForFunction(() => /Đã phân tích xong|Huỷ|Hủy/.test(document.querySelector('.stage-progress-label')?.textContent || '') && /xong/.test(document.querySelector('.stage-progress-label')?.textContent || ''), null, { timeout: waitMs }).catch(() => console.log(name, 'not done within', waitMs));
  console.log(name, 'elapsed', Date.now() - t0, 'ms', 'status', await p.evaluate(() => document.querySelector('.stage-progress-label')?.textContent));
  if (shotAt != null) {
    await p.evaluate(() => document.querySelector('.stage-controls button')?.click()); // pause
    await p.locator('.scrub input[type=range]').fill(String(shotAt)).catch(() => {});
    await p.waitForTimeout(800);
  }
  console.log(name, 'chip', await p.evaluate(() => document.querySelector('.stage-role-chip')?.textContent ?? null));
  console.log(name, 'zoomChip', await p.evaluate(() => document.querySelector('.stage-zoom-chip')?.textContent ?? null));
  const alertTexts = await p.evaluate(() => [...document.querySelectorAll('.det-alert-msg, .det-alert, .alert-row')].map((e) => e.textContent).slice(0, 12));
  console.log(name, 'alerts', JSON.stringify(alertTexts));
  const desk = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.det-alert, li, .alert-item, [class*=alert]')];
    const hit = rows.find((e) => /điện thoại trên bàn/i.test(e.textContent || ''));
    if (hit) { hit.scrollIntoView({ block: 'center' }); return hit.textContent; }
    return null;
  });
  console.log(name, 'phone_on_desk_ui', desk);
  await p.screenshot({ path: `${OUT}/${name}.png` });
  if (desk) await p.screenshot({ path: `${OUT}/${name}-phone-on-desk.png` });
  summarize(name);
}

if (STEPS.includes('img')) await analyse(IMG, 'phan-tich-anh-' + IMG.split('/').pop().replace(/\.[^.]+$/, ''), 120000);
if (STEPS.includes('vid')) await analyse(VID, 'phan-tich-video-' + VID.split('/').pop().replace(/\.[^.]+$/, ''), 240000, 10);
if (STEPS.includes('vid2')) await analyse(VID2, 'phan-tich-video-hanh-lang', 300000, 30);
if (STEPS.includes('model')) {
  const m = await api('/system/model');
  console.log('system/model role', JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith('role')))));
  console.log('system/model phoneZoom', JSON.stringify(Object.fromEntries(Object.entries(m).filter(([k]) => /^phoneZoom|^phoneConf$/.test(k)))));
  await p.goto(`${BASE}/mo-hinh`); await p.waitForTimeout(2500);
  await p.screenshot({ path: `${OUT}/mo-hinh.png` });
  if (await p.locator('.role-model-card').count()) {
    await p.evaluate(() => document.querySelector('.role-model-card').scrollIntoView({ block: 'end' }));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/mo-hinh-role-card.png` });
  }
  if (await p.locator('.phone-zoom-card').count()) {
    await p.evaluate(() => document.querySelector('.phone-zoom-card').scrollIntoView({ block: 'end' }));
    await p.waitForTimeout(400);
    await p.screenshot({ path: `${OUT}/mo-hinh-phone-zoom-card.png` });
  }
}
if (STEPS.includes('push')) {
  await p.goto(`${BASE}/cai-dat/camera`);
  await p.getByRole('button', { name: /Thêm camera điện thoại/ }).click();
  await p.waitForSelector('.phone-browser-push');
  await p.getByRole('button', { name: /Tìm camera trên trình duyệt/ }).click();
  await p.waitForSelector('.phone-browser-row select');
  await p.getByRole('button', { name: /Lưu và gửi hình qua trình duyệt/ }).click();
  await p.waitForTimeout(3000);
  const camId = JSON.parse(await p.evaluate(() => localStorage.getItem('cmcai.localPush.v1'))).slice(-1)[0].cameraId;
  console.log('camera', camId);
  await p.goto(`${BASE}/giam-sat/camera/${camId}`);
  await p.waitForTimeout(25000);
  const mine = liveDet.filter((d) => d.cameraId === camId && (d.objects || []).length);
  const last = mine.slice(-1)[0];
  console.log('live det packets', mine.length, 'last roleEnabled', last?.roleEnabled, 'roleCounts', JSON.stringify(last?.roleCounts));
  console.log('live persons', JSON.stringify((last?.objects || []).filter((o) => o.cls === 'person').map((o) => [o.trackId, o.role, o.label, o.studentNo, o.source, o.roleConf])));
  console.log('live poses roles', JSON.stringify((last?.poses || []).map((o) => [o.trackId, o.role, o.label])));
  const diag = await api(`/cameras/${camId}/diag`);
  console.log('diag', JSON.stringify(diag));
  console.log('chip', await p.evaluate(() => document.querySelector('.live-role-chip')?.textContent ?? null));
  await p.screenshot({ path: `${OUT}/camera-don-browser-push.png` });
  console.log('live alerts', JSON.stringify(alertsSeen.map((a) => [a.type, a.level, a.trackId, a.message])));
  if (process.env.KEEP_CAM !== '1') {
    await p.evaluate(async ({ BE, camId, authTok }) => { }, { BE, camId, authTok });
  }
}
await b.close();
