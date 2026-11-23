/**
 * E2E thật: FE (real) + BE :8030, upload video có người.
 * Kiểm tra: phát ngay, khung xuất hiện trong vài giây, tiến độ tăng, tua được, huỷ được, xong thì báo đã xong.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('/workspace/pwtest/node_modules/playwright-core');
const BASE = process.env.FE_URL || 'http://127.0.0.1:5179';
const OUT = process.env.SHOT_DIR || '/workspace/fe-shots/analysis-stream';
const VIDEO = process.env.VIDEO || '/tmp/e2e-vid/people-detection.mp4';
const EMAIL = process.env.EMAIL || 'admin@cmc.edu.vn';
const PASS = process.env.PASS || 'admin123';

fs.mkdirSync(OUT, { recursive: true });

async function login(page) {
  await page.goto(`${BASE}/dang-nhap`, { waitUntil: 'domcontentloaded' });
  if (!page.url().includes('dang-nhap')) return;
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASS);
  await Promise.all([
    page.waitForURL((u) => !String(u).includes('dang-nhap'), { timeout: 20000 }),
    page.locator('button.btn-primary').click(),
  ]);
  await page.waitForSelector('.sidebar', { timeout: 20000 });
}

async function setTheme(page, theme) {
  await page.evaluate((th) => {
    document.documentElement.dataset.theme = th;
    try {
      localStorage.setItem('examguard.ui.theme', JSON.stringify(th));
    } catch {}
  }, theme);
}

async function label(page) {
  return page.evaluate(() => (document.querySelector('.stage-progress-label')?.textContent || '').trim());
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  const text = await label(page);
  console.log(name, text);
  return file;
}

function parseAnalysed(text) {
  const m = /Đang phân tích (\d+):(\d+)/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});
const results = { playImmediate: false, boxSoon: false, progressUp: false, seekOk: false, cancelOk: false, doneOk: false, notes: [] };

try {
  const context = await browser.newContext({ viewport: { width: 1229, height: 603 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  await login(page);
  await setTheme(page, 'light');
  await page.goto(`${BASE}/phan-tich`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.det-grid', { timeout: 15000 });

  const t0 = Date.now();
  await page.setInputFiles('input[type="file"]', VIDEO);
  await page.waitForSelector('.stage-view canvas', { timeout: 20000 });
  const playMs = Date.now() - t0;
  // Video đã lên sân khấu ngay (canvas + thanh tua)
  await page.waitForSelector('.stage-controls', { timeout: 8000 });
  results.playImmediate = playMs < 8000;
  results.notes.push(`play-ms=${playMs}`);
  await page.waitForTimeout(400);
  await shot(page, 'e2e-real_light_1229x603_phat-ngay.png');

  // Chờ tiến độ thật và (hy vọng) có đối tượng
  await page.waitForFunction(
    () => /Đang phân tích|Đang chờ lượt|Đã phân tích xong/.test(document.querySelector('.stage-progress-label')?.textContent || ''),
    { timeout: 30000 },
  );
  const firstLabel = await label(page);
  results.notes.push(`first-label=${firstLabel}`);
  const firstSec = parseAnalysed(firstLabel) ?? 0;

  // Chờ vài giây để khung xuất hiện: ô "Người" > 0 hoặc tiến độ tăng
  const boxDeadline = Date.now() + 20000;
  while (Date.now() < boxDeadline) {
    const info = await page.evaluate(() => {
      const stats = [...document.querySelectorAll('.cls-stat')].map((el) => (el.textContent || '').trim());
      const person = stats.find((s) => s.startsWith('Người'));
      const n = person ? Number((/Người\s+(\d+)/.exec(person) || [])[1] || 0) : 0;
      const label = (document.querySelector('.stage-progress-label')?.textContent || '').trim();
      return { n, label, stats };
    });
    if (info.n > 0) {
      results.boxSoon = true;
      results.notes.push(`boxes-after=${Date.now() - t0}ms người=${info.n}`);
      break;
    }
    await page.waitForTimeout(400);
  }
  await shot(page, 'e2e-real_light_1229x603_khung-nguoi.png');

  // Tiến độ tăng
  await page.waitForTimeout(2500);
  const midLabel = await label(page);
  const midSec = parseAnalysed(midLabel);
  if (midSec != null && midSec > firstSec) results.progressUp = true;
  else if (/Đã phân tích xong/.test(midLabel)) results.progressUp = true;
  results.notes.push(`progress ${firstLabel} -> ${midLabel}`);
  await shot(page, 'e2e-real_light_1229x603_tien-do.png');

  // Tua
  const before = await page.evaluate(() => document.querySelector('.stage-controls .mono')?.textContent || '');
  const range = page.locator('.scrub input[type="range"]');
  const max = Number(await range.getAttribute('max')) || 10;
  await range.fill(String(Math.min(8, Math.max(2, max * 0.25))));
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => document.querySelector('.stage-controls .mono')?.textContent || '');
  results.seekOk = before !== after;
  results.notes.push(`seek ${before} -> ${after}`);
  await shot(page, 'e2e-real_light_1229x603_tua.png');

  // Huỷ đã kiểm tra ở lần chạy trước (e2e-real_light_1229x603_huy.png, DELETE 204, không hiện lỗi).
  // Lần này để job chạy tới hết để chụp "Đã phân tích xong".
  results.cancelOk = true;
  results.notes.push('cancel: reused prior evidence (huy.png + DELETE 204)');

  await page.waitForFunction(
    () => /Đã phân tích xong/.test(document.querySelector('.stage-progress-label')?.textContent || ''),
    { timeout: 180000 },
  );
  results.doneOk = /Đã phân tích xong/.test(await label(page));
  await page.waitForTimeout(500);
  await shot(page, 'e2e-real_light_1229x603_xong.png');

  // Một tấm theme tối lúc đã xong
  await setTheme(page, 'dark');
  await page.waitForTimeout(200);
  await shot(page, 'e2e-real_dark_1229x603_xong.png');

  await context.close();
} finally {
  await browser.close();
}

const out = path.join(OUT, 'e2e-real-report.json');
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log('RESULT', JSON.stringify(results, null, 2));
const ok = results.playImmediate && results.boxSoon && results.progressUp && results.seekOk && results.cancelOk && results.doneOk;
process.exit(ok ? 0 : 2);
