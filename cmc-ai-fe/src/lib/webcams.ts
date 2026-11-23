import type { WebcamInfo } from '../services/api';

/**
 * Gửi nguyên URL backend trả về: ưu tiên urlByName với DroidCam Video,
 * còn lại dùng url. Không tự phân tích schema (webcam://dshow/N, msmf, mở theo tên đều giữ nguyên).
 */
export function webcamUrl(c: WebcamInfo): string {
  const byName = (c.urlByName || '').trim();
  const u = (c.url || '').trim();
  if (isDroidCamVideo(c.name) && byName) return byName;
  return u || byName || `webcam://${c.index}`;
}

export function isDroidCamVideo(name: string): boolean {
  return /droid\s*cam\s*video/i.test(name || '');
}

export function isLegacyDroidCamSource(name: string): boolean {
  return /droid\s*cam\s*source/i.test(name || '');
}

export function isDroidCamName(name: string): boolean {
  return /droid\s*cam/i.test(name || '');
}

export function hasNoPicture(c: WebcamInfo): boolean {
  return c.hasPicture === false;
}

/** Nhãn hiển thị: đánh dấu driver bản cũ / khung không có hình. */
export function webcamLabel(c: WebcamInfo | string): string {
  const name = typeof c === 'string' ? c : c.name;
  const noPic = typeof c !== 'string' && hasNoPicture(c);
  let label = name;
  if (isLegacyDroidCamSource(name)) label = `${name} (bản cũ – có thể ra màn hình xanh)`;
  if (noPic) label += ' — chưa thấy hình lúc dò';
  return label;
}

function rank(c: WebcamInfo): number {
  const pic = !hasNoPicture(c);
  if (isDroidCamVideo(c.name) && pic && !c.inUse) return 0;
  // hasPicture chỉ để tham khảo: DroidCam Video vẫn đứng đầu dù lúc dò chưa thấy hình.
  if (isDroidCamVideo(c.name)) return 1;
  if (isDroidCamVideo(c.name) && pic) return 1;
  if (isDroidCamName(c.name) && !isLegacyDroidCamSource(c.name) && pic && !c.inUse) return 2;
  if (isDroidCamName(c.name) && !isLegacyDroidCamSource(c.name) && pic) return 3;
  if (pic && !c.inUse) return 4;
  if (pic) return 5;
  if (isLegacyDroidCamSource(c.name)) return 80;
  return 90;
}

/** Ưu tiên “DroidCam Video” có hình, rồi thiết bị rảnh. Khung màu đặc xếp cuối. */
export function rankWebcams(list: WebcamInfo[]): WebcamInfo[] {
  return [...list].sort((a, b) => rank(a) - rank(b) || a.index - b.index || a.name.localeCompare(b.name, 'vi'));
}

export function preferredWebcam(list: WebcamInfo[]): WebcamInfo | undefined {
  const ranked = rankWebcams(list);
  return ranked.find((c) => isDroidCamVideo(c.name)) ?? ranked.find((c) => !hasNoPicture(c) && !c.inUse) ?? ranked.find((c) => !hasNoPicture(c)) ?? ranked[0];
}
