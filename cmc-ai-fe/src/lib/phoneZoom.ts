/**
 * Lượt soi kỹ vùng tay/bàn (BE 15:10, API_CHANGES §13).
 * Object điện thoại tìm thấy nhờ phóng crop gắn `source:'zoom'` — các trường khác giữ nguyên.
 * GET /api/system/model: phoneZoom, phoneZoomConf, phoneZoomImgSize, phoneZoomEveryN,
 * phoneZoomMaxCrops, phoneZoomInferMs, phoneZoomCrops, phoneConf.
 * diag / camera_status: phoneZoom, phoneZoomInferMs, phoneZoomCrops, phoneZoomEveryN.
 */
import type { Detection } from '../types';
import type { SystemModelPayload } from '../services/api';

export const ZOOM_HINT = 'soi kỹ';

export function isZoomPhone(d: Pick<Detection, 'cls' | 'source'> | undefined | null): boolean {
  return !!d && d.cls === 'phone' && d.source === 'zoom';
}

export function zoomPhoneCount(objects: Detection[] | undefined | null): number {
  return (objects ?? []).filter(isZoomPhone).length;
}

/** Nhãn vật thể trên lớp phủ: điện thoại source=zoom thêm gợi ý "soi kỹ", không đổi màu mức cảnh báo. */
export function objectBoxLabel(d: Pick<Detection, 'cls' | 'source'>, base: string): string {
  return isZoomPhone(d) ? `${base} · ${ZOOM_HINT}` : base;
}

export interface PhoneZoomInfo {
  /** true khi BE gửi trường phoneZoom (kể cả đang tắt) */
  present: boolean;
  enabled: boolean;
  conf?: number;
  imgSize?: number;
  everyN?: number;
  maxCrops?: number;
  inferMs?: number;
  crops?: number;
  phoneConf?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function readPhoneZoom(raw: SystemModelPayload | null | undefined): PhoneZoomInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    present: r.phoneZoom === true || r.phoneZoom === false,
    enabled: r.phoneZoom === true,
    conf: num(r.phoneZoomConf),
    imgSize: num(r.phoneZoomImgSize),
    everyN: num(r.phoneZoomEveryN),
    maxCrops: num(r.phoneZoomMaxCrops),
    inferMs: num(r.phoneZoomInferMs),
    crops: num(r.phoneZoomCrops),
    phoneConf: num(r.phoneConf),
  };
}
