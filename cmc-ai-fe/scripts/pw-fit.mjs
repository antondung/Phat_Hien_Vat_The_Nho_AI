/**
 * Kiểm tra vừa khung (không cuộn document) + screenshot 7 viewport × 2 theme × 4 trang = 56.
 * Assertion overflow lặp thêm deviceScaleFactor 1 / 1.25 / 1.5.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('/workspace/pwtest/node_modules/playwright-core');
const BASE = process.env.FE_URL || 'http://127.0.0.1:4175';
const OUT = process.env.SHOT_DIR || '/workspace/fe-shots';
const EMAIL = 'admin@cmc.edu.vn';
const PASS = 'admin123';

const VIEWPORTS = [
  [1229, 603],
  [1280, 577],
  [1280, 649],
  [1366, 625],
  [1366, 657],
  [1536, 730],
  [1920, 937],
];
const PAGES = [
  { key: 'camera-don', path: '/giam-sat/camera', title: 'Camera đơn' },
  { key: 'he-thong', path: '/giam-sat/he-thong', title: 'Hệ thống camera' },
  { key: 'dashboard', path: '/dashboard', title: 'Bảng điều khiển' },
  { key: 'phan-tich', path: '/phan-tich', title: 'Phân tích' },
  { key: 'lich-su', path: '/lich-su', title: 'Lịch sử' },
  { key: 'cai-dat', path: '/cai-dat/quy-tac', title: 'Cài đặt' },
];
const THEMES = ['light', 'dark'];
const DPRS = [1, 1.25, 1.5];

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

async function measure(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement || document.documentElement;
    const ih = window.innerHeight, iw = window.innerWidth;
    const labels = [...document.querySelectorAll('.sidebar .nav-item span, .sidebar .nav-subitem')].map((el) => {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const visible = r.width > 4 && r.height > 8 && st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0;
      return { text: (el.textContent || '').trim(), visible };
    });
    const wanted = ['Giám sát', 'Camera đơn', 'Hệ thống camera'];
    const labelOk = wanted.every((w) => labels.some((l) => l.text.includes(w) && l.visible));
    const cam = document.querySelector('.cam-strip');
    const alerts = document.querySelector('.alert-panel');
    const inView = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), ok: r.top >= -2 && r.bottom <= ih + 2 };
    };
    return {
      innerHeight: ih,
      innerWidth: iw,
      scrollHeight: se.scrollHeight,
      scrollWidth: se.scrollWidth,
      overflowY: se.scrollHeight - ih,
      overflowX: se.scrollWidth - iw,
      noDocScroll: se.scrollHeight <= ih + 1 && se.scrollWidth <= iw + 1,
      labels,
      labelOk,
      camStrip: inView(cam),
      alertPanel: inView(alerts),
    };
  });
}

const results = [];
const shotList = [];
let fail = 0;
let shotI = 0;

const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

for (const dpr of DPRS) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: dpr });
  const p = await ctx.newPage();
  p.setDefaultTimeout(20000);
  await login(p);

  for (const [w, h] of VIEWPORTS) {
    await p.setViewportSize({ width: w, height: h });
    for (const theme of THEMES) {
      await setTheme(p, theme);
      for (const pg of PAGES) {
        await p.goto(`${BASE}${pg.path}`, { waitUntil: 'domcontentloaded' });
        await p.waitForSelector('.sidebar');
        await p.waitForTimeout(150);
        const m = await measure(p);
        const needLabels = w >= 1200;
        const row = {
          viewport: `${w}x${h}`,
          dpr,
          theme,
          page: pg.key,
          noDocScroll: m.noDocScroll,
          overflowY: m.overflowY,
          overflowX: m.overflowX,
          labelOk: needLabels ? m.labelOk : true,
          camStripOk: pg.key !== 'camera-don' || !m.camStrip || m.camStrip.ok,
          alertOk: pg.key !== 'camera-don' || !m.alertPanel || m.alertPanel.ok,
          camStrip: m.camStrip,
          alertPanel: m.alertPanel,
        };
        row.pass = row.noDocScroll && row.labelOk && row.camStripOk && row.alertOk;
        if (!row.pass) fail++;
        results.push(row);

        if (dpr === 1) {
          shotI++;
          const name = `${String(shotI).padStart(2, '0')}_${pg.key}_${theme}_${w}x${h}.png`;
          const fp = path.join(OUT, name);
          await p.screenshot({ path: fp, fullPage: false });
          shotList.push(name);
        }
      }
    }
  }
  await ctx.close();
}

await browser.close();

const report = { fail, total: results.length, shots: shotList.length, results };
fs.writeFileSync(path.join(OUT, 'fit-report.json'), JSON.stringify(report, null, 2));
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.viewport} dpr=${r.dpr} ${r.theme} ${r.page} scrollY=${r.overflowY} scrollX=${r.overflowX} labels=${r.labelOk} cam=${r.camStripOk} alert=${r.alertOk}`);
}
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed, shots=${shotList.length}, fail=${fail}`);
if (fail) process.exit(1);
