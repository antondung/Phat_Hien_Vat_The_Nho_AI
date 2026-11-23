/**
 * ĐIỂM CHUYỂN ĐỔI MOCK <-> BACKEND THẬT.
 * Mặc định VITE_API_MODE=real (npm run dev / build). Chế độ mock: npm run dev:mock.
 * Chế độ real không bao giờ rơi về mock và không tiêm dữ liệu mẫu.
 */
import type { ApiClient, RealtimeClient } from './api';
import { mockApi } from './mock/mockApi';
import { MockRealtimeClient } from './mock/mockRealtime';
import { httpApi } from './http/httpApi';
import { WsRealtimeClient } from './http/wsRealtime';

export const API_MODE = import.meta.env.VITE_API_MODE === 'real' ? 'real' : 'mock';
/** Chế độ real không bao giờ rơi về mock: thiếu backend thì API lỗi, UI hiện trạng thái trống. */

export const api: ApiClient = API_MODE === 'real' ? httpApi : mockApi;
export const realtime: RealtimeClient = API_MODE === 'real' ? new WsRealtimeClient() : new MockRealtimeClient();

export type { ApiClient, RealtimeClient } from './api';

export { cameraLiveUrl, snapshotIntervalMs, MAX_GRID_STREAMS, SNAPSHOT_INTERVAL_MS, GRID_SNAPSHOT_WIDTH, GRID_MUX_WS_PATH } from './media';
export type { LiveTransport } from './media';
