/**
 * Tốc độ phân tích thực tế của từng camera, đo từ các gói `detections` nhận qua WebSocket
 * (không dùng FPS của luồng video – video gốc chạy theo tốc độ riêng của nó).
 */

/** cửa sổ trượt để đếm kết quả phân tích */
export const RATE_WINDOW_MS = 5000;
/** quá thời gian này không có kết quả mới → lớp phủ mờ đi (kết quả cũ) */
export const STALE_MS = 3000;
/** độ mờ của lớp phủ khi kết quả đã cũ */
export const STALE_ALPHA = 0.4;

/** Số kết quả/giây trong cửa sổ trượt; null = chưa có kết quả nào trong cửa sổ. */
export function analysisRate(times: number[] | undefined, since: number | undefined, now = Date.now()): number | null {
  if (!times?.length) return null;
  const from = now - RATE_WINDOW_MS;
  let i0 = times.length;
  while (i0 > 0 && times[i0 - 1] > from) i0--;
  const n = times.length - i0;
  if (!n) return null;
  // đủ ≥ 3 kết quả: lấy trung bình khoảng cách giữa các kết quả (ít dao động hơn đếm trong cửa sổ)
  if (n >= 3) return ((n - 1) * 1000) / Math.max(1, times[times.length - 1] - times[i0]);
  // mới kết nối / quá thưa: chia cho thời gian đã quan sát (tối thiểu 1 giây)
  const span = Math.max(1000, Math.min(RATE_WINDOW_MS, now - (since ?? from)));
  return (n * 1000) / span;
}

/** Làm tròn dễ đọc: ≥ 0,75 → số nguyên (1,1–1,4 → ~1); ≥ 0,375 → ~0,5; nhỏ hơn → 1 chữ số thập phân. */
export function roundRate(r: number): number {
  if (r >= 0.75) return Math.round(r);
  if (r >= 0.375) return Math.round(r * 2) / 2;
  return Math.max(0.1, Math.round(r * 10) / 10);
}

export const fmtRateNumber = (r: number) => String(roundRate(r)).replace('.', ',');

/** "Phân tích ~1 khung/giây" · "Phân tích ~0,5 khung/giây" · "Chưa có kết quả phân tích" */
export function fmtAnalysisRate(r: number | null): string {
  return r == null ? 'Chưa có kết quả phân tích' : `Phân tích ~${fmtRateNumber(r)} khung/giây`;
}
