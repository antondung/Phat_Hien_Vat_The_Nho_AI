/**
 * Chạy Vite HTTPS (mode real) để iPhone/Safari mở được camera.
 * Không dùng biến môi trường kiểu POSIX (FOO=bar cmd) — chạy được trên Windows (PowerShell/cmd) và Linux/macOS.
 *
 *   npm run dev:phone
 *   npm run dev:phone -- --host 192.168.1.20
 *   set LAN_IP=192.168.1.20 && npm run dev:phone     (cmd)
 *   $env:LAN_IP="192.168.1.20"; npm run dev:phone    (PowerShell)
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickLanIp, listLanCandidates, parseHostOverride } from './lan-ip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.DEV_PHONE_PORT || 5173);
const override = parseHostOverride();
const lan = pickLanIp(override);
const viteJs = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const env = {
  ...process.env,
  DEV_PHONE: '1',
  // Lắng nghe mọi card; in URL LAN cho điện thoại
  VITE_PHONE_LAN_HOST: lan ? `https://${lan}:${port}` : '',
};

const args = ['--mode', 'real', '--host', '0.0.0.0', '--port', String(port), '--strictPort'];
const child = spawn(process.execPath, [viteJs, ...args], { cwd: root, env, stdio: 'inherit' });

const others = listLanCandidates().filter((c) => c.address !== lan);
console.log('\n=== CMC AI · dev:phone (HTTPS, chế độ real) ===');
if (lan) {
  console.log(`  Trang quản trị:     https://${lan}:${port}/`);
  console.log(`  Trang điện thoại:   https://${lan}:${port}/dt`);
  console.log('  Trên iPhone (cùng Wi-Fi): mở Safari, chấp nhận chứng chỉ một lần, rồi cho phép camera.');
} else {
  console.log('  Không chọn được IPv4 LAN (chỉ có localhost). Đặt LAN_IP=x.x.x.x rồi chạy lại.');
}
console.log(`  Máy này cũng mở được: https://localhost:${port}/  (trình duyệt sẽ cảnh báo chứng chỉ tự ký)`);
if (others.length) {
  console.log('  Card khác (không dùng làm mặc định): ' + others.map((c) => `${c.address} (${c.name})`).join(', '));
}
if (override) console.log(`  Đã ghi đè host: ${override}`);
console.log('================================================\n');

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
