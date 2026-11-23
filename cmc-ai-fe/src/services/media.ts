/**
 * Adapter URL video gốc.
 * - Camera đơn: MJPEG /api/cameras/{id}/stream.mjpg?token=&fps=15
 * - Lưới: một WebSocket /ws/grid (xem services/http/gridWs.ts). Nếu lỗi, mỗi ô poll
 *   snapshot.jpg?w=480 khoảng 2–5 fps. Không bao giờ mở 9 luồng MJPEG (Chrome ~6 kết nối HTTP/1.1/host).
 */
import { cameraSnapshotUrl, cameraStreamUrl } from './http/config';

export const MAX_GRID_STREAMS = 0; // lưới không dùng MJPEG
export const SNAPSHOT_INTERVAL_MS = 400; // ~2.5 fps khi fallback
export const GRID_SNAPSHOT_WIDTH = 480;
export const GRID_MUX_WS_PATH = '/ws/grid';

export type LiveTransport = 'stream' | 'snapshot';

export function cameraLiveUrl(cameraId: string, transport: LiveTransport, opts?: { width?: number; quality?: number }): string {
  if (transport === 'stream') return cameraStreamUrl(cameraId, 15);
  return cameraSnapshotUrl(cameraId, { width: opts?.width, quality: opts?.quality });
}

export function snapshotIntervalMs(): number {
  return SNAPSHOT_INTERVAL_MS;
}
