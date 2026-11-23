/**
 * Chụp trang Phân tích (dev:mock): upload video, lúc đang phân tích dở và lúc đã xong.
 * Viewport 1229×603 và 1280×577, theme sáng và tối. Kiểm tra không cuộn trang / không cắt.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('/workspace/pwtest/node_modules/playwright-core');
const BASE = process.env.FE_URL || 'http://127.0.0.1:5178';
const OUT = process.env.SHOT_DIR || '/workspace/fe-shots/analysis-stream';
const VIDEO = process.env.VIDEO || '/workspace/fe-shots/analysis-stream/_source.mp4';
const EMAIL = process.env.EMAIL || 'admin@examguard.vn';
const PASS = process.env.PASS || 'admin123';

fs.mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  [1229, 603],
  [1280, 577],
];
const THEMES = ['light', 'dark'];

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

async function measure(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const ih = window.innerHeight,
      iw = window.innerWidth;
    const issues = [];
    if (se.scrollHeight > ih + 1) issues.push(`doc-scroll-y:${se.scrollHeight}>${ih}`);
    if (se.scrollWidth > iw + 1) issues.push(`doc-scroll-x:${se.scrollWidth}>${iw}`);
    const sels = ['.det-grid', '.stage-view', '.stage-controls', '.det-upload', '.det-result', '.det-alerts', '.stage-progress'];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) {
        issues.push('missing:' + sel);
        continue;
      }
      const r = el.getBoundingClientRect();
      if (r.bottom > ih + 3) issues.push(`clip-bottom:${sel}:${r.bottom.toFixed(0)}>${ih}`);
      if (r.right > iw + 3) issues.push(`clip-right:${sel}:${r.right.toFixed(0)}>${iw}`);
      if (r.top < -3) issues.push(`clip-top:${sel}`);
      if (r.left < -3) issues.push(`clip-left:${sel}`);
    }
    const label = document.querySelector('.stage-progress-label');
    return {
      issues,
      label: label ? (label.textContent || '').trim() : '',
      inner: [iw, ih],
      scroll: [se.scrollWidth, se.scrollHeight],
    };
  });
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  const m = await measure(page);
  console.log(name, m.label, m.issues.length ? 'ISSUES ' + m.issues.join(' | ') : 'ok', m.inner, m.scroll);
  return m;
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const report = [];

try {
  for (const [w, h] of VIEWPORTS) {
    for (const theme of THEMES) {
      const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      await login(page);
      await setTheme(page, theme);
      await page.goto(`${BASE}/phan-tich`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.det-grid', { timeout: 15000 });

      await page.setInputFiles('input[type="file"]', VIDEO);

      await page.waitForSelector('.stage-view canvas', { timeout: 20000 });
      // Chờ thanh tiến độ thật (đang phân tích dở)
      await page.waitForFunction(
        () => /Đang phân tích|Đang chờ|Đang tải/.test(document.querySelector('.stage-progress-label')?.textContent || ''),
        { timeout: 15000 },
      );
      // Cho vài lô khung kịp về
      await page.waitForTimeout(1800);
      const midName = `phan-tich_${theme}_${w}x${h}_dang-phan-tich.png`;
      const mid = await shot(page, midName);
      report.push({ name: midName, ...mid });

      await page.waitForFunction(
        () => /Đã phân tích xong/.test(document.querySelector('.stage-progress-label')?.textContent || ''),
        { timeout: 30000 },
      );
      await page.waitForTimeout(400);
      const doneName = `phan-tich_${theme}_${w}x${h}_xong.png`;
      const done = await shot(page, doneName);
      report.push({ name: doneName, ...done });

      await context.close();
    }
  }
} finally {
  await browser.close();
}

const fail = report.filter((r) => r.issues.length);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log('shots', report.length, 'issues', fail.length);
if (fail.length) {
  console.error(fail);
  process.exit(1);
}
