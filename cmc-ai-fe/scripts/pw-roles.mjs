import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('/workspace/pwtest/node_modules/playwright-core');
const BASE = process.env.BASE || 'http://127.0.0.1:5181', OUT = '/workspace/fe-shots/roles';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const ctx = await b.newContext({ viewport: { width: 1229, height: 603 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(`${BASE}/dang-nhap`);
if (p.url().includes('dang-nhap')) {
  await p.fill('input[type="email"]', 'admin@examguard.vn'); await p.fill('input[type="password"]', 'admin123');
  await p.click('button.btn-primary'); await p.waitForSelector('.sidebar', { timeout: 15000 });
}
for (const cam of (process.env.CAMS || 'cam-02,cam-01').split(',')) {
  await p.goto(`${BASE}/giam-sat/camera/${cam}`);
  await p.waitForSelector('.live-bar'); await p.waitForTimeout(4500);
  const chip = await p.evaluate(() => document.querySelector('.role-chip')?.textContent ?? null);
  const bar = await p.evaluate(() => { const r = document.querySelector('.live-bar-row'); return r ? [r.scrollWidth, r.clientWidth] : null; });
  console.log(cam, 'chip:', chip, 'bar scroll/client:', bar);
  await p.screenshot({ path: `${OUT}/camera-don-${cam}.png` });
}
await p.goto(`${BASE}/mo-hinh`); await p.waitForTimeout(1500);
await p.screenshot({ path: `${OUT}/mo-hinh.png`, fullPage: true });
await p.goto(`${BASE}/phan-tich`); await p.waitForSelector('.det-grid');
await p.click('button.sample >> nth=1'); await p.waitForTimeout(6000);
console.log('analysis chip:', await p.evaluate(() => document.querySelector('.stage-role-chip')?.textContent ?? null));
await p.screenshot({ path: `${OUT}/phan-tich-video-mau.png` });
await p.click('button.sample >> nth=0'); await p.waitForTimeout(3000);
console.log('analysis img chip:', await p.evaluate(() => document.querySelector('.stage-role-chip')?.textContent ?? null));
await p.screenshot({ path: `${OUT}/phan-tich-anh-mau.png` });
await b.close();
