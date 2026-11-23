import type { Camera, CameraStatus } from '../types';

/** Camera mẫu của BE (dataset://). Không dùng cho mock (rtsp/file mp4). */
export function isSampleCamera(c: Camera): boolean {
  return c.sourceType === 'file' && /^dataset:\/\//i.test(c.sourceUrl || '');
}

export function isCameraOnline(c: Camera, st?: CameraStatus): boolean {
  return !!c.enabled && (st?.online ?? true);
}

/** Ưu tiên camera điện thoại / đang trực tuyến; camera mẫu đang tắt để tách riêng. */
export function partitionSwitcher(cameras: Camera[], statuses: Record<string, CameraStatus>, currentId?: string) {
  const main: Camera[] = [];
  const hiddenSamples: Camera[] = [];
  for (const c of cameras) {
    const online = isCameraOnline(c, statuses[c.id]);
    const sample = isSampleCamera(c);
    if (sample && !online && c.id !== currentId) hiddenSamples.push(c);
    else main.push(c);
  }
  const rank = (c: Camera) => {
    const online = isCameraOnline(c, statuses[c.id]);
    const phoneLike = c.sourceType === 'phone' || c.sourceType === 'http' || c.sourceType === 'webcam';
    if (phoneLike && online) return 0;
    if (phoneLike) return 1;
    if (online) return 2;
    return 3;
  };
  main.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'vi'));
  return { main, hiddenSamples };
}
