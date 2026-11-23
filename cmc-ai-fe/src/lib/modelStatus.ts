/**
 * Ghép "Trạng thái model" từ dữ liệu BE thật (không đoán).
 * Ưu tiên GET /api/cameras/{id}/diag + camera_status (WS / /api/cameras/status)
 * và tooltip từ GET /api/system/model.
 * Khi không có bất kỳ thông tin nào: kind = 'unknown' → "Chưa có thông tin từ BE".
 */
import type { CameraStatus, DetectionFrame, DetectorState, ModelInfo } from '../types';
import type { SystemHealthPayload, SystemModelPayload } from '../services/api';
import { objectCount, shouldDrawDetection } from './overlayMap';
import { analysisRate } from './analysisRate';

export type ModelStatusKind = 'off' | 'idle' | 'run' | 'lost' | 'unknown';

export type ModelStatusView = {
  kind: ModelStatusKind;
  /** Một dòng hiện trên chip */
  label: string;
  /** Tooltip chi tiết */
  tooltip: string;
};

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}
function arrStr(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || !v.length) return undefined;
  const s = v
    .map((x) =>
      typeof x === 'string'
        ? x
        : x && typeof x === 'object' && 'name' in (x as object)
          ? String((x as { name: unknown }).name)
          : '',
    )
    .filter(Boolean);
  return s.length ? s : undefined;
}

/** Lấy bản ghi per-camera nếu BE bọc trong `cameras` / `byCamera`. */
export function pickCameraPayload(raw: SystemModelPayload | null | undefined, cameraId?: string): SystemModelPayload | null {
  if (!raw) return null;
  if (!cameraId) return raw;
  const bags = [raw.cameras, raw.byCamera, raw.cameraStats, raw.stats];
  for (const bag of bags) {
    if (Array.isArray(bag)) {
      const hit = bag.find((x) => x && typeof x === 'object' && [(x as { cameraId?: string }).cameraId, (x as { id?: string }).id].includes(cameraId));
      if (hit && typeof hit === 'object') return { ...raw, ...(hit as SystemModelPayload) };
    } else if (bag && typeof bag === 'object' && cameraId in (bag as object)) {
      const hit = (bag as Record<string, unknown>)[cameraId];
      if (hit && typeof hit === 'object') return { ...raw, ...(hit as SystemModelPayload) };
    }
  }
  return raw;
}

export function readFields(raw: SystemModelPayload | null | undefined) {
  const r = raw ?? {};
  const name = str(r.detModel) ?? str(r.name) ?? str(r.model) ?? str(r.modelName);
  const classes = arrStr(r.classes) ?? arrStr(r.labels);
  const device = str(r.device) ?? str(r.accelerator) ?? str(r.hw);
  const fps = num(r.detectFps) ?? num(r.fps) ?? num(r.analyseFps) ?? num(r.analysisFps) ?? num(r.inferFps);
  const objects = num(r.objectsPerFrame) ?? num(r.objects) ?? num(r.nObjects) ?? num(r.objectCount);
  const analysed = num(r.analysedFrames) ?? num(r.analyzedFrames) ?? num(r.frames) ?? num(r.frameCount);
  const inferenceMs = num(r.inferenceMs) ?? num(r.inferMs) ?? num(r.latencyMs);
  const lastError = str(r.lastError) ?? str(r.error) ?? str(r.message) ?? str(r.reason);
  const lastFrameTs = num(r.lastDetectTs) ?? num(r.lastFrameTs) ?? num(r.lastFrameAt) ?? num(r.frameTs);
  const running = bool(r.running) ?? bool(r.ok) ?? bool(r.active);
  return { name, classes, device, fps, objects, analysed, inferenceMs, lastError, lastFrameTs, running };
}

function fmtRate(r: number | null | undefined): string | undefined {
  if (r == null || !Number.isFinite(r) || r <= 0) return undefined;
  const n = r >= 0.75 ? Math.round(r) : r >= 0.375 ? Math.round(r * 2) / 2 : Math.round(r * 10) / 10;
  return `${String(n).replace('.', ',')} khung/giây`;
}

function fmtTime(ts?: number): string | undefined {
  if (!ts || !Number.isFinite(ts)) return undefined;
  const ms = ts < 1e12 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return undefined;
  }
}

function fmtClasses(classes?: string[]): string | undefined {
  if (!classes?.length) return undefined;
  if (classes.length <= 8) return classes.join(', ');
  const highlight = classes.filter((c) => /person|cell phone|phone|laptop|book|paper|calculator/i.test(c));
  if (highlight.length) return `${highlight.join(', ')} (+${classes.length - highlight.length} lớp khác)`;
  return `${classes.slice(0, 6).join(', ')} (+${classes.length - 6} lớp khác)`;
}

function shortModelName(name?: string): string | undefined {
  if (!name) return undefined;
  const base = name.split(/[/\\]/).pop() || name;
  return base.replace(/\.(pt|onnx|engine)$/i, '').split(/[–(]/)[0].trim() || undefined;
}

function mergeStatus(cam?: CameraStatus, diag?: CameraStatus | null): CameraStatus | undefined {
  if (!cam && !diag) return undefined;
  if (!cam) return diag ?? undefined;
  if (!diag) return cam;
  const camTs = num(cam.lastDetectTs) ?? num(cam.updatedAt) ?? 0;
  const diagTs = num(diag.lastDetectTs) ?? num(diag.updatedAt) ?? 0;
  return camTs >= diagTs ? { ...diag, ...cam } : { ...cam, ...diag };
}

function asDetector(v: unknown): DetectorState | undefined {
  const s = str(v);
  if (s === 'running' || s === 'not_started' || s === 'error' || s === 'no_frames') return s;
  return undefined;
}

export function buildModelStatus(opts: {
  cameraOnline: boolean | undefined;
  camStatus?: CameraStatus;
  diag?: CameraStatus | null;
  systemModel?: SystemModelPayload | null;
  payload?: SystemModelPayload | null;
  payloadMissing: boolean;
  health?: SystemHealthPayload | null;
  models?: ModelInfo[] | null;
  frame?: DetectionFrame;
  detTimes?: number[];
  detSince?: number;
  now?: number;
}): ModelStatusView {
  const now = opts.now ?? Date.now();
  const st = mergeStatus(opts.camStatus, opts.diag);
  const sys = opts.systemModel ?? opts.payload ?? null;
  const fields = readFields(sys);
  const health = opts.health;
  const models = opts.models ?? [];
  const detector = asDetector(st?.detector) ?? asDetector(health?.detector);
  const modelName = fields.name ?? models[0]?.name;
  const classes = fields.classes ?? models[0]?.classes;
  const device = fields.device ?? str(health?.device);
  const frameFresh = opts.frame ? shouldDrawDetection(opts.frame, now) : false;
  const fromFrame = frameFresh && opts.frame ? objectCount(opts.frame) : undefined;
  // 0 từ diag/status cũ không được che số đối tượng trên khung đang hiện.
  const lastObjects = fromFrame != null ? fromFrame : (num(st?.lastObjects) ?? fields.objects);
  const rate = num(st?.detectFps) ?? fields.fps ?? analysisRate(opts.detTimes, opts.detSince, now) ?? undefined;
  const lastTs = num(st?.lastDetectTs) ?? fields.lastFrameTs ?? (frameFresh ? (opts.frame?.frameTs ?? opts.frame?.receivedAt) : undefined);
  const lastErr = str(st?.lastError) ?? fields.lastError ?? str(health?.error) ?? str(health?.message);
  const inferMs = num(st?.inferMs) ?? fields.inferenceMs;
  const framesRead = num(st?.framesRead);
  const analysed = num(st?.analysedFrames) ?? fields.analysed;

  const tooltipParts: string[] = [];
  if (modelName) tooltipParts.push(`Model: ${modelName}`);
  const poseName = str(sys?.poseModel) ?? (models[1]?.name && models[1].name !== modelName ? models[1].name : undefined);
  if (poseName) tooltipParts.push(`Pose: ${poseName}`);
  const clsTxt = fmtClasses(classes);
  if (clsTxt) tooltipParts.push(`Lớp: ${clsTxt}`);
  if (device) tooltipParts.push(`Thiết bị: ${/gpu|cuda/i.test(device) ? 'GPU' : /cpu/i.test(device) ? 'CPU' : device}`);
  if (num(sys?.imgSize) != null) tooltipParts.push(`Kích thước ảnh: ${num(sys?.imgSize)}`);
  if (num(sys?.conf) != null) tooltipParts.push(`Ngưỡng: ${num(sys?.conf)}`);
  if (num(sys?.iou) != null) tooltipParts.push(`IoU: ${num(sys?.iou)}`);
  const liveFps = num(st?.detectFps) ?? rate;
  const cfgFps = num(sys?.detectFps);
  if (liveFps != null && liveFps > 0) tooltipParts.push(`detectFps: ${String(liveFps).replace('.', ',')}`);
  else if (cfgFps != null && cfgFps > 0) tooltipParts.push(`detectFps: ${String(cfgFps).replace('.', ',')}`);
  if (sys?.fallback === true) tooltipParts.push('Fallback: có');
  else if (typeof sys?.fallback === 'string' && sys.fallback.trim()) tooltipParts.push(`Fallback: ${sys.fallback.trim()}`);
  if (detector) tooltipParts.push(`Detector: ${detector}`);
  if (inferMs != null) tooltipParts.push(`Suy luận: ${Math.round(inferMs)} ms`);
  const phoneZoomOn = sys?.phoneZoom === true || st?.phoneZoom === true;
  const phoneZoomOff = sys?.phoneZoom === false && st?.phoneZoom !== true;
  if (phoneZoomOn) tooltipParts.push('Soi kỹ vùng tay: bật');
  else if (phoneZoomOff) tooltipParts.push('Soi kỹ vùng tay: tắt');
  const zoomMs = num(st?.phoneZoomInferMs) ?? num(sys?.phoneZoomInferMs);
  if (zoomMs != null) tooltipParts.push(`Soi kỹ: ${Math.round(zoomMs)} ms`);
  const zoomCrops = num(st?.phoneZoomCrops) ?? num(sys?.phoneZoomCrops);
  if (zoomCrops != null) tooltipParts.push(`Vùng cắt soi kỹ: ${zoomCrops}`);
  const zoomEvery = num(st?.phoneZoomEveryN) ?? num(sys?.phoneZoomEveryN);
  if (zoomEvery != null) tooltipParts.push(`Soi kỹ mỗi ${zoomEvery} khung`);
  if (framesRead != null) tooltipParts.push(`Khung đã đọc: ${framesRead}`);
  if (analysed != null) tooltipParts.push(`Khung đã phân tích: ${analysed}`);
  if (fmtTime(lastTs)) tooltipParts.push(`Khung cuối: ${fmtTime(lastTs)}`);
  if (lastErr) tooltipParts.push(`Lỗi: ${lastErr}`);
  const tooltip = tooltipParts.join('\n') || 'Chưa có thông tin từ BE';

  if (opts.cameraOnline === false || detector === 'no_frames') {
    return { kind: 'lost', label: 'Mất hình từ camera', tooltip };
  }

  const hasBeInfo = !!(st || sys || health || (models && models.length));
  if (!hasBeInfo && opts.payloadMissing) {
    return { kind: 'unknown', label: 'Chưa có thông tin từ BE', tooltip: 'BE chưa có endpoint thống kê model.' };
  }

  if (detector === 'not_started' || detector === 'error') {
    const reason = lastErr ? ` · ${lastErr}` : '';
    return { kind: 'off', label: `Model chưa chạy${reason}`, tooltip };
  }

  if (detector === 'running') {
    const rateTxt = fmtRate(rate);
    const objN = lastObjects ?? 0;
    const shortName = shortModelName(modelName);
    if (objN <= 0) {
      const bits = ['Đang chạy', shortName, rateTxt, '0 đối tượng'].filter(Boolean);
      return { kind: 'idle', label: bits.join(' · '), tooltip };
    }
    return { kind: 'run', label: `Đang chạy · ${objN} đối tượng`, tooltip };
  }

  // BE cũ không gửi detector — suy từ các tín hiệu còn lại, không đoán khi thiếu hết.
  const runningKnown = fields.running;
  const healthDet = str(health?.detector);
  const detectorOff = healthDet === 'off' || healthDet === 'none' || healthDet === '';
  const isRunning = runningKnown === true || (runningKnown !== false && !detectorOff && !!(healthDet || modelName || opts.frame || st));

  if (runningKnown === false || detectorOff) {
    const reason = lastErr ? ` · ${lastErr}` : '';
    return { kind: 'off', label: `Model chưa chạy${reason}`, tooltip };
  }
  if (!isRunning && !hasBeInfo) {
    return { kind: 'unknown', label: 'Chưa có thông tin từ BE', tooltip };
  }
  if (!isRunning) {
    const reason = lastErr ? ` · ${lastErr}` : '';
    return { kind: 'off', label: `Model chưa chạy${reason}`, tooltip };
  }

  const rateTxt = fmtRate(rate);
  const objN = lastObjects ?? 0;
  const shortName = shortModelName(modelName);
  if (objN <= 0) {
    const bits = ['Đang chạy', shortName, rateTxt, '0 đối tượng'].filter(Boolean);
    return { kind: 'idle', label: bits.join(' · '), tooltip };
  }
  return { kind: 'run', label: `Đang chạy · ${objN} đối tượng`, tooltip };
}
