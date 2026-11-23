/**
 * Chọn địa chỉ IPv4 LAN để điện thoại (cùng Wi-Fi) mở FE.
 * Bỏ qua loopback và card ảo (Docker, VMware, Hyper-V, vEthernet, WSL, VPN…).
 * Ghi đè: biến LAN_IP / PHONE_HOST / DEV_PHONE_HOST, hoặc đối số --host <ip>.
 */
import os from 'node:os';

const SKIP =
  /^(lo|docker|br-|veth|virbr|tun|tap|wg|vmnet|vethernet|virtualbox|vmware|hyper-v|loopback|bluetooth|wsl|isatap|teredo|microsoft|npcap|vpn|tailscale|zerotier|hamachi|default switch|pseudo|cbl|npcap)/i;
const PREFER = /^(eth|enp|ens|eno|enx|wlan|wlp|wls|wi-?fi|wifi|ethernet|local area connection|lan)/i;

export function parseHostOverride(argv = process.argv.slice(2), env = process.env) {
  const eq = argv.find((a) => a.startsWith('--host='));
  if (eq) return eq.slice('--host='.length);
  const i = argv.indexOf('--host');
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1];
  return env.LAN_IP || env.PHONE_HOST || env.DEV_PHONE_HOST || '';
}

export function listLanCandidates() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (SKIP.test(name.trim())) continue;
    for (const a of addrs || []) {
      const family = a.family === 'IPv4' || a.family === 4;
      if (!family || a.internal) continue;
      out.push({ name, address: a.address, preferred: PREFER.test(name.trim()) });
    }
  }
  return out;
}

export function pickLanIp(override) {
  const forced = override ?? parseHostOverride();
  if (forced && forced !== '0.0.0.0' && forced !== 'true') return forced;
  const cands = listLanCandidates();
  return (cands.find((c) => c.preferred) || cands[0])?.address || '';
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('lan-ip.mjs')) {
  const ip = pickLanIp();
  if (!ip) {
    console.error('Không tìm thấy IPv4 LAN. Đặt LAN_IP=x.x.x.x rồi chạy lại.');
    process.exit(1);
  }
  console.log(ip);
}
