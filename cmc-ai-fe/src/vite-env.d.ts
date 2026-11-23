/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'mock' | 'real';
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_WS_URL?: string;
  /** Origin HTTPS LAN do `npm run dev:phone` gắn, ví dụ https://192.168.1.20:5173 */
  readonly VITE_PHONE_LAN_HOST?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
