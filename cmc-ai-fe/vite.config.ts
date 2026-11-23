import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * Proxy tới backend CMC AI (mặc định http://localhost:8000) cho cả `vite` (dev) và `vite preview`:
 *   /api   -> REST + luồng MJPEG camera
 *   /ws    -> WebSocket realtime
 *   /media -> ảnh chụp, clip cảnh báo, tệp đã phân tích
 * Nhờ vậy FE gọi đường dẫn tương đối, không vướng CORS. Đổi đích bằng BACKEND_URL trong .env.
 *
 * `npm run dev:phone` (DEV_PHONE=1) bật HTTPS (chứng chỉ tự ký) để Safari/iPhone mở được camera.
 * Mọi script npm dùng cờ Vite / file .env.* — không gán biến kiểu POSIX (FOO=bar cmd), chạy được trên Windows.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const target = process.env.BACKEND_URL || env.BACKEND_URL || 'http://localhost:8000';
  const phone = process.env.DEV_PHONE === '1';
  const proxy = {
    '/api': { target, changeOrigin: true },
    '/media': { target, changeOrigin: true },
    '/ws': { target: target.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
  };
  return {
    plugins: [react(), ...(phone ? [basicSsl()] : [])],
    server: { port: 5173, host: true, proxy },
    preview: { port: 4173, host: true, proxy },
  };
});
