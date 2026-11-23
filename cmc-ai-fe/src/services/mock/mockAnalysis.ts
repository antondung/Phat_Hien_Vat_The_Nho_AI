/** Mô phỏng phân tích ảnh/video tải lên (backend thật: POST /analysis/jobs + WS) */
import type {
  AnalysisAlert,
  AnalysisFrame,
  AnalysisInput,
  AnalysisJob,
  AnalysisJobEvent,
  AnalysisJobState,
  AnalysisProgressEvent,
  AnalysisResult,
  Detection,
  PoseDet,
} from '../../types';
import type { AnalysisJobHandler, ProgressFn } from '../api';
import { db } from './db';
import { RuleEngine } from './ruleEngine';
import { getScene, sceneState, type CameraScene } from '../../scene/sceneModel';
import { mockInvigilatorId, withMockRoles } from './mockRoles';
import { alertMessage, normalizeClass } from '../../lib/labels';
import { uid } from '../../lib/format';
import { mulberry32 } from '../../lib/geometry';
import { mergeAlerts, mergeFrames } from '../../lib/analysisJob';

const STAGES: [number, string][] = [
  [25, 'Đang tải tệp lên máy chủ…'],
  [60, 'Phát hiện đối tượng (YOLO – 4 lớp)…'],
  [85, 'Ước lượng tư thế (YOLO Pose – 17 điểm)…'],
  [100, 'Áp dụng quy tắc & tổng hợp cảnh báo…'],
];

async function runProgress(onProgress: ProgressFn, totalMs: number, signal?: AbortSignal) {
  const start = performance.now();
  return new Promise<void>((resolve, reject) => {
    const step = () => {
      if (signal?.aborted) return reject(new DOMException('Đã huỷ', 'AbortError'));
      const p = Math.min(100, ((performance.now() - start) / totalMs) * 100);
      const stage = STAGES.find(([lim]) => p <= lim)?.[1] ?? STAGES[3][1];
      onProgress(Math.round(p), stage);
      if (p >= 100) resolve();
      else setTimeout(step, 60);
    };
    step();
  });
}

/** Cảnh cho video mẫu: dùng cảnh tổng hợp, ép kịch bản điện thoại rơi vào 0..40s */
export function sampleVideoScene(): CameraScene {
  const base = getScene('sample-video', 'truoc');
  const tid = base.actors[base.actors.length - 2]?.trackId ?? 1;
  const tid2 = base.actors[2]?.trackId ?? 2;
  return {
    ...base,
    phones: [
      { trackId: tid, cycle: 1000, offset: 0, deskFrom: 6, handFrom: 18, handTo: 27 },
      { trackId: tid2, cycle: 1000, offset: 0, deskFrom: 30, handFrom: 1000, handTo: 1000 },
    ],
  };
}

/** Kết quả "thô" như model trả về cho ảnh mẫu (có nhãn 'cell phone' để minh hoạ ánh xạ) */
function rawSampleImage(): { cls: string; conf: number; bbox: [number, number, number, number]; points?: [number, number][]; trackId?: number; id: string }[] {
  const scene = getScene('cam-01', 'truoc', true);
  const st = sceneState(scene, 25000);
  return st.objects.map((o) => ({ ...o, cls: o.cls === 'phone' ? 'cell phone' : o.cls }));
}

function toPx(o: Detection, W: number, H: number): Detection {
  return {
    ...o,
    bbox: [o.bbox[0] * W, o.bbox[1] * H, o.bbox[2] * W, o.bbox[3] * H],
    points: o.points?.map(([x, y]) => [x * W, y * H] as [number, number]),
  };
}
function poseToPx(p: PoseDet, W: number, H: number): PoseDet {
  return { ...p, bbox: [p.bbox[0] * W, p.bbox[1] * H, p.bbox[2] * W, p.bbox[3] * H], keypoints: p.keypoints.map(([x, y, s]) => [x * W, y * H, s]) };
}

function result(fileName: string, mediaType: 'image' | 'video', width: number, height: number, duration: number, frames: AnalysisFrame[], alerts: AnalysisAlert[], coord: 'px' | 'norm' = 'px'): AnalysisResult {
  return {
    id: uid('an-'),
    fileName,
    mediaType,
    width,
    height,
    coord,
    duration,
    fps: mediaType === 'video' ? 5 : 0,
    model: { detector: 'yolo11s-exam-4cls (mô phỏng)', pose: 'yolo11s-pose (mô phỏng)' },
    frames,
    alerts,
    createdAt: Date.now(),
  };
}

function pushAlerts(alerts: AnalysisAlert[], t: number, cands: ReturnType<RuleEngine['process']>) {
  for (const c of cands) {
    alerts.push({
      id: uid('aa-'),
      t,
      type: c.type,
      level: c.level,
      trackId: c.trackId,
      objectId: c.objectId,
      confidence: Math.round(c.confidence * 1000) / 1000,
      message: alertMessage(c.type, c.trackId),
    });
  }
}

/** Sinh toàn bộ kết quả (đồng bộ) — dùng cho analyze() và job luồng. */
export function buildMockResult(input: AnalysisInput): AnalysisResult {
  const settings = db.rules;
  const engine = new RuleEngine();
  const frames: AnalysisFrame[] = [];
  const alerts: AnalysisAlert[] = [];

  if (input.kind === 'sample-image') {
    const W = 1280,
      H = 720;
    const scene = getScene('cam-01', 'truoc', true);
    const st = sceneState(scene, 25000);
    const objects = rawSampleImage()
      .map((r) => ({ ...r, cls: normalizeClass(r.cls) }))
      .filter((r): r is Detection => r.cls != null)
      .map((o) => toPx(o, W, H));
    const rf = withMockRoles({ objects, poses: st.poses.map((p) => poseToPx(p, W, H)) }, mockInvigilatorId(scene));
    const poses = rf.poses;
    frames.push({ t: 0, objects: rf.objects, poses, roleCounts: rf.roleCounts });
    pushAlerts(alerts, 0, engine.process({ ts: 0, width: W, height: H, coord: 'px', objects: rf.objects, poses }, settings, 'P.503.1', true));
    return result('anh-mau-P503.1.jpg', 'image', W, H, 0, frames, alerts);
  }

  if (input.kind === 'sample-video' || (input.kind === 'file' && input.duration > 0)) {
    const duration = input.kind === 'sample-video' ? input.duration : input.duration;
    const scene = input.kind === 'sample-video' ? sampleVideoScene() : getScene('upload-' + input.file.name, 'truoc');
    const W = input.kind === 'file' ? input.width || 1280 : 1280;
    const H = input.kind === 'file' ? input.height || 720 : 720;
    const step = 0.2;
    const invId = mockInvigilatorId(scene);
    for (let t = 0; t <= duration + 1e-6; t += step) {
      const tt = Math.round(t * 10) / 10;
      const st = withMockRoles(sceneState(scene, tt * 1000), invId);
      frames.push({ t: tt, objects: st.objects, poses: st.poses, roleCounts: st.roleCounts });
      pushAlerts(alerts, tt, engine.process({ ts: tt * 1000, width: W, height: H, coord: 'norm', objects: st.objects, poses: st.poses }, settings, 'P.503.2'));
    }
    const name = input.kind === 'file' ? input.file.name : 'video-mau-phong-thi.webm';
    return result(name, 'video', W, H, duration, frames, alerts, 'norm');
  }

  // Ảnh người dùng tải lên: không có model thật → sinh kết quả giả có tính tái lập theo tên tệp
  const W = input.width || 1280,
    H = input.height || 720;
  const rnd = mulberry32(input.file.size + input.file.name.length);
  const objects: Detection[] = [];
  const poses: PoseDet[] = [];
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const cx = (0.15 + (0.7 * (i + 0.5)) / n) * W;
    const top = (0.25 + rnd() * 0.15) * H;
    const h = (0.45 + rnd() * 0.2) * H;
    const half = h * 0.28;
    const k = (dx: number, dy: number, s = 0.88): [number, number, number] => [cx + dx * h, top + dy * h, s];
    const kps: PoseDet['keypoints'] = [
      k(0, 0.13),
      k(0.03, 0.1),
      k(-0.03, 0.1),
      k(0.065, 0.11),
      k(-0.065, 0.11),
      k(0.17, 0.3),
      k(-0.17, 0.3),
      k(0.22, 0.5),
      k(-0.22, 0.5),
      k(0.08, 0.62),
      k(-0.1, 0.63),
      k(0.11, 0.75, 0.4),
      k(-0.11, 0.75, 0.4),
      k(0.13, 0.88, 0.2),
      k(-0.13, 0.88, 0.2),
      k(0.13, 0.99, 0.1),
      k(-0.13, 0.99, 0.1),
    ];
    const bbox: [number, number, number, number] = [cx - half, top - 0.01 * h, cx + half, Math.min(H, top + h)];
    poses.push({ trackId: i + 1, conf: 0.85, bbox, keypoints: kps });
    objects.push({ id: `person-${i + 1}`, cls: 'person', conf: 0.8 + rnd() * 0.15, bbox, trackId: i + 1 });
    if (i === 0) {
      const px = cx - 0.1 * h,
        py = top + 0.63 * h;
      objects.push({ id: 'phone-1', cls: 'phone', conf: 0.7 + rnd() * 0.2, bbox: [px - 0.03 * h, py - 0.04 * h, px + 0.03 * h, py + 0.04 * h], trackId: 1, source: 'zoom' });
    }
    if (rnd() < 0.5) {
      const px = cx + 0.12 * h,
        py = top + 0.66 * h,
        w = 0.12 * h,
        hh = 0.05 * h,
        a = 0.4;
      const pts: [number, number][] = [
        [-w, -hh],
        [w, -hh],
        [w, hh],
        [-w, hh],
      ].map(([x, y]) => [px + x * Math.cos(a) - y * Math.sin(a), py + x * Math.sin(a) + y * Math.cos(a)]);
      objects.push({
        id: `paper-${i + 1}`,
        cls: 'paper',
        conf: 0.6 + rnd() * 0.2,
        bbox: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))],
        points: pts,
        trackId: i + 1,
      });
    }
  }
  const rf = withMockRoles({ objects, poses }, n >= 3 ? n : undefined);
  frames.push({ t: 0, objects: rf.objects, poses: rf.poses, roleCounts: rf.roleCounts });
  pushAlerts(alerts, 0, engine.process({ ts: 0, width: W, height: H, coord: 'px', objects: rf.objects, poses: rf.poses }, settings, 'P.503.2', true));
  return result(input.file.name, 'image', W, H, 0, frames, alerts);
}

export async function mockAnalyze(input: AnalysisInput, onProgress: ProgressFn, signal?: AbortSignal): Promise<AnalysisResult> {
  const isVideo = input.kind === 'sample-video' || (input.kind === 'file' && input.duration > 0);
  await runProgress(onProgress, isVideo ? 3600 : 2200, signal);
  return buildMockResult(input);
}

/* ---------- Job phân tích luồng ---------- */

type MockJobRec = {
  job: AnalysisJob;
  status: AnalysisJobState['status'];
  progress: number;
  analysedSec: number;
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
  pendingFrames: AnalysisFrame[];
  pendingAlerts: AnalysisAlert[];
  duration: number;
  message?: string;
  timer?: ReturnType<typeof setTimeout>;
  listeners: Set<(e: AnalysisJobEvent) => void>;
};

const jobs = new Map<string, MockJobRec>();

function emit(job: MockJobRec, e: AnalysisJobEvent) {
  job.listeners.forEach((fn) => {
    try {
      fn(e);
    } catch (err) {
      console.warn('[mock analysis job]', err);
    }
  });
}

function finish(job: MockJobRec) {
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = undefined;
  }
  job.status = 'done';
  job.progress = 1;
  job.analysedSec = job.duration;
  emit(job, { type: 'done', progress: 1, duration: job.duration, totalFrames: job.frames.length, totalAlerts: job.alerts.length });
}

function tickJob(job: MockJobRec) {
  if (job.status !== 'running') return;
  // Ảnh: 1 khung rồi xong. Video: mỗi 300ms đẩy 3 khung (0,6 s @ 5 fps) → clip 20 s ~ 10 s thật.
  const batchN = job.job.mediaType === 'image' ? Math.max(1, job.pendingFrames.length) : Math.min(3, job.pendingFrames.length);
  const frames = job.pendingFrames.splice(0, batchN);
  const until = frames.length ? frames[frames.length - 1].t : job.analysedSec;
  const alerts: AnalysisAlert[] = [];
  while (job.pendingAlerts.length && job.pendingAlerts[0].t <= until + 1e-6) alerts.push(job.pendingAlerts.shift()!);
  job.frames = mergeFrames(job.frames, frames);
  job.alerts = mergeAlerts(job.alerts, alerts);
  job.analysedSec = job.job.mediaType === 'image' ? 0 : until;
  const total = job.frames.length + job.pendingFrames.length;
  job.progress = total ? job.frames.length / total : 1;
  const ev: AnalysisProgressEvent = { type: 'progress', progress: job.progress, analysedSec: job.analysedSec, frames, alerts };
  emit(job, ev);
  if (!job.pendingFrames.length) {
    finish(job);
    return;
  }
  job.timer = setTimeout(() => tickJob(job), job.job.mediaType === 'image' ? 280 : 300);
}

export async function mockStartJob(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisJob> {
  if (signal?.aborted) throw new DOMException('Đã huỷ', 'AbortError');
  const r = buildMockResult(input);
  const job: AnalysisJob = {
    jobId: r.id,
    fileName: r.fileName,
    mediaType: r.mediaType,
    width: r.width,
    height: r.height,
    fps: r.fps,
    duration: r.duration,
    model: r.model,
    coord: r.coord,
  };
  const rec: MockJobRec = {
    job,
    status: 'running',
    progress: 0,
    analysedSec: 0,
    frames: [],
    alerts: [],
    pendingFrames: r.frames.slice(),
    pendingAlerts: r.alerts.slice().sort((a, b) => a.t - b.t),
    duration: r.duration,
    listeners: new Set(),
  };
  jobs.set(job.jobId, rec);
  rec.timer = setTimeout(() => tickJob(rec), 180);
  if (signal) {
    const onAbort = () => {
      void mockCancelJob(job.jobId);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  }
  return job;
}

export async function mockGetJob(jobId: string, since?: number): Promise<AnalysisJobState> {
  const job = jobs.get(jobId);
  if (!job) {
    return { status: 'error', progress: 0, analysedSec: 0, frames: [], alerts: [], message: 'Không tìm thấy job phân tích.' };
  }
  return {
    status: job.status,
    progress: job.progress,
    analysedSec: job.analysedSec,
    frames: since === undefined ? job.frames : job.frames.filter((f) => f.t > since),
    alerts: since === undefined ? job.alerts : job.alerts.filter((a) => a.t > since),
    message: job.message,
    duration: job.duration,
    totalFrames: job.frames.length + job.pendingFrames.length,
    totalAlerts: job.alerts.length + job.pendingAlerts.length,
  };
}

export async function mockCancelJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  if (job.timer) {
    clearTimeout(job.timer);
    job.timer = undefined;
  }
  if (job.status === 'running' || job.status === 'queued') {
    job.status = 'error';
    job.message = 'Đã huỷ phân tích.';
    emit(job, { type: 'error', message: job.message });
  }
}

export function mockSubscribeJob(jobId: string, handler: AnalysisJobHandler): () => void {
  const job = jobs.get(jobId);
  if (!job) {
    queueMicrotask(() => handler.onError({ type: 'error', message: 'Không tìm thấy job phân tích.' }));
    return () => {};
  }
  const listener = (e: AnalysisJobEvent) => {
    if (e.type === 'progress') handler.onProgress(e);
    else if (e.type === 'done') handler.onDone(e);
    else handler.onError(e);
  };
  job.listeners.add(listener);
  // Giống BE: lúc mới nối gửi lại kết quả đã có.
  queueMicrotask(() => {
    if (!job.listeners.has(listener)) return;
    if (job.frames.length || job.alerts.length || job.progress > 0) {
      handler.onProgress({
        type: 'progress',
        progress: job.progress,
        analysedSec: job.analysedSec,
        frames: job.frames,
        alerts: job.alerts,
      });
    }
    if (job.status === 'done') handler.onDone({ type: 'done', progress: 1, duration: job.duration, totalFrames: job.frames.length, totalAlerts: job.alerts.length });
    else if (job.status === 'error') handler.onError({ type: 'error', message: job.message || 'Lỗi phân tích' });
  });
  return () => {
    job.listeners.delete(listener);
  };
}
