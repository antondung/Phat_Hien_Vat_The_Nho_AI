/** Gộp khung/cảnh báo job phân tích và chọn khung theo thời điểm phát. */
import type { AnalysisAlert, AnalysisFrame, AnalysisJob, CoordSpace } from '../types';

/** Không vẽ lớp phủ nếu khung gần nhất ≤ thời điểm phát lệch quá khoảng này. */
export const OVERLAY_SKEW_SEC = 0.4;

export function roundT(t: number): number {
  return Math.round(t * 1000) / 1000;
}

/** Khung có t gần nhất mà t ≤ thời điểm phát; lệch quá maxSkew thì không vẽ (tránh khung cũ đứng yên). */
export function frameAtPlayhead(frames: AnalysisFrame[], t: number, maxSkew = OVERLAY_SKEW_SEC): AnalysisFrame | undefined {
  if (!frames.length) return undefined;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t + 1e-3) lo = mid;
    else hi = mid - 1;
  }
  const f = frames[lo];
  if (!f || f.t > t + 1e-3) return undefined;
  if (t - f.t > maxSkew) return undefined;
  return f;
}

export function mergeFrames(existing: AnalysisFrame[], incoming: AnalysisFrame[]): AnalysisFrame[] {
  if (!incoming.length) return existing;
  if (!existing.length) return incoming.slice().sort((a, b) => a.t - b.t);
  const map = new Map<number, AnalysisFrame>();
  for (const f of existing) map.set(roundT(f.t), f);
  for (const f of incoming) map.set(roundT(f.t), f);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export function mergeAlerts(existing: AnalysisAlert[], incoming: AnalysisAlert[]): AnalysisAlert[] {
  if (!incoming.length) return existing;
  if (!existing.length) return incoming.slice().sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
  const map = new Map<string, AnalysisAlert>();
  for (const a of existing) map.set(a.id, a);
  for (const a of incoming) if (a?.id) map.set(a.id, a);
  return [...map.values()].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

export function normalizeModel(m: unknown): { detector: string; pose: string } {
  if (m && typeof m === 'object') {
    const o = m as { detector?: unknown; pose?: unknown; detModel?: unknown; poseModel?: unknown };
    const detector = String(o.detector ?? o.detModel ?? '');
    const pose = String(o.pose ?? o.poseModel ?? '');
    if (detector || pose) return { detector, pose };
  }
  if (typeof m === 'string' && m.trim()) return { detector: m, pose: '' };
  return { detector: '', pose: '' };
}

export function normalizeCoord(c: unknown, fallback: CoordSpace = 'px'): CoordSpace {
  return c === 'norm' || c === 'px' ? c : fallback;
}

export function normalizeJob(raw: Record<string, unknown>, fallback?: Partial<AnalysisJob>): AnalysisJob {
  const mediaType = raw.mediaType === 'image' || fallback?.mediaType === 'image' ? 'image' : 'video';
  const duration = Number(raw.duration ?? fallback?.duration) || 0;
  return {
    jobId: String(raw.jobId ?? raw.id ?? fallback?.jobId ?? ''),
    fileName: String(raw.fileName ?? raw.filename ?? fallback?.fileName ?? ''),
    mediaType,
    mediaUrl: typeof raw.mediaUrl === 'string' ? raw.mediaUrl : fallback?.mediaUrl,
    width: Number(raw.width ?? fallback?.width) || 0,
    height: Number(raw.height ?? fallback?.height) || 0,
    fps: Number(raw.fps ?? fallback?.fps) || (mediaType === 'video' ? 5 : 0),
    duration: mediaType === 'image' ? duration : duration || Number(fallback?.duration) || 0,
    model: raw.model != null ? normalizeModel(raw.model) : fallback?.model ?? { detector: '', pose: '' },
    coord: normalizeCoord(raw.coord, fallback?.coord ?? 'px'),
  };
}
