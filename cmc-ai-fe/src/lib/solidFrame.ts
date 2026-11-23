/** Gợi ý khi khung hình gần như một màu / xanh lá (DroidCam bản cũ chưa có tín hiệu). */
export const DROIDCAM_GREEN_HINT =
  'Khung hình gần như một màu (thường là xanh lá) — thường gặp với driver DroidCam bản cũ (“DroidCam Source 1/2/3”) khi chưa có tín hiệu. Hãy chọn “DroidCam Video” (bản mới), hoặc dùng địa chỉ Wi-Fi http://IP:4747/video, hoặc tab Quét mã QR.';

export function isSolidOrGreenFrame(data: Uint8ClampedArray): { solid: boolean; green: boolean } {
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const step = 16 * 4;
  for (let i = 0; i + 2 < data.length; i += step) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  if (!n) return { solid: false, green: false };
  r /= n;
  g /= n;
  b /= n;
  let varSum = 0;
  for (let i = 0; i + 2 < data.length; i += step) {
    const dr = data[i] - r;
    const dg = data[i + 1] - g;
    const db = data[i + 2] - b;
    varSum += dr * dr + dg * dg + db * db;
  }
  const std = Math.sqrt(varSum / n);
  const solid = std < 18;
  const green = solid && g > 80 && g > r * 1.35 && g > b * 1.35;
  return { solid, green };
}

/** Lấy pixel từ video/ảnh đã có dữ liệu. */
export function sampleElementFrame(el: HTMLVideoElement | HTMLImageElement): ImageData | null {
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return null;
  const cv = document.createElement('canvas');
  const sw = Math.min(160, w);
  const sh = Math.max(1, Math.round((h / w) * sw));
  cv.width = sw;
  cv.height = sh;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(el, 0, 0, sw, sh);
    return ctx.getImageData(0, 0, sw, sh);
  } catch {
    return null;
  }
}

export function hintIfSolidFrame(el: HTMLVideoElement | HTMLImageElement): string | null {
  const img = sampleElementFrame(el);
  if (!img) return null;
  const r = isSolidOrGreenFrame(img.data);
  return r.solid ? DROIDCAM_GREEN_HINT : null;
}
