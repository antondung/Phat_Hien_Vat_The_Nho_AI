/**
 * Job phân tích luồng: POST /api/analysis/jobs, WS /ws/analysis/{jobId}, GET poll, DELETE huỷ.
 * Nếu /jobs trả 404 (BE cũ) thì fallback POST /api/analysis, vẫn trả job ngay để phát video trong lúc chờ.
 */
import type { AnalysisDoneEvent, AnalysisInput, AnalysisJob, AnalysisJobState, AnalysisResult } from '../../types';
import type { AnalysisJobHandler } from '../api';
import { normalizeJob } from '../../lib/analysisJob';
import { uid } from '../../lib/format';
import { API_BASE, getToken, mediaUrl, notifyUnauthorized, wsUrl } from './config';
import { ApiError } from './errors';

async function errorMessage(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.message === 'string') return j.message;
    if (typeof j?.detail === 'string') return j.detail;
  } catch {
    /* ignore */
  }
  return res.status >= 500 ? `Máy chủ gặp lỗi (${res.status}). Vui lòng thử lại.` : `Lỗi ${res.status}`;
}

function authHeaders(json = false): HeadersInit {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function formFor(input: AnalysisInput): FormData {
  const fd = new FormData();
  if (input.kind === 'file') fd.append('file', input.file);
  else fd.append('sample', input.kind === 'sample-image' ? 'sample-image' : 'sample-video');
  return fd;
}

function jobFromInput(input: AnalysisInput, raw?: Record<string, unknown>): AnalysisJob {
  const fallback = {
    jobId: '',
    fileName: input.kind === 'file' ? input.file.name : input.kind === 'sample-image' ? 'anh-mau-P503.1.jpg' : 'video-mau-phong-thi.webm',
    mediaType: (input.kind === 'sample-image' || (input.kind === 'file' && input.duration <= 0) ? 'image' : 'video') as 'image' | 'video',
    width: input.kind === 'file' ? input.width : 0,
    height: input.kind === 'file' ? input.height : 0,
    fps: 0,
    duration: input.kind === 'sample-video' ? input.duration : input.kind === 'file' ? input.duration : 0,
    model: { detector: '', pose: '' } as { detector: string; pose: string },
  };
  const job = normalizeJob(raw ?? {}, fallback);
  return { ...job, mediaUrl: mediaUrl(job.mediaUrl) };
}

/* ---------- BE cũ: POST /analysis chạy nền ---------- */
type LegacyRec = {
  job: AnalysisJob;
  status: AnalysisJobState['status'];
  progress: number;
  analysedSec: number;
  frames: AnalysisResult['frames'];
  alerts: AnalysisResult['alerts'];
  message?: string;
  duration: number;
  xhr?: XMLHttpRequest;
  handlers: Set<AnalysisJobHandler>;
};

const legacy = new Map<string, LegacyRec>();

function startLegacyJob(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisJob> {
  const jobId = uid('legacy-');
  const job = jobFromInput(input, { jobId });
  const rec: LegacyRec = {
    job,
    status: 'running',
    progress: 0,
    analysedSec: 0,
    frames: [],
    alerts: [],
    duration: job.duration,
    handlers: new Set(),
  };
  legacy.set(jobId, rec);

  const fd = formFor(input);
  const token = getToken();
  const xhr = new XMLHttpRequest();
  rec.xhr = xhr;
  xhr.open('POST', API_BASE + '/analysis');
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) rec.progress = Math.min(0.45, (e.loaded / e.total) * 0.45);
  };
  xhr.onload = () => {
    if (xhr.status < 300) {
      try {
        const r = JSON.parse(xhr.responseText) as AnalysisResult;
        rec.job = {
          ...rec.job,
          fileName: r.fileName || rec.job.fileName,
          mediaType: r.mediaType || rec.job.mediaType,
          mediaUrl: mediaUrl(r.mediaUrl) ?? rec.job.mediaUrl,
          width: r.width || rec.job.width,
          height: r.height || rec.job.height,
          fps: r.fps || rec.job.fps,
          duration: r.duration || rec.job.duration,
          model: r.model || rec.job.model,
          coord: r.coord || rec.job.coord,
        };
        rec.frames = r.frames ?? [];
        rec.alerts = r.alerts ?? [];
        rec.duration = rec.job.duration;
        rec.analysedSec = rec.job.mediaType === 'image' ? 0 : rec.duration;
        rec.progress = 1;
        rec.status = 'done';
        const done: AnalysisDoneEvent = { type: 'done', progress: 1, duration: rec.duration, totalFrames: rec.frames.length, totalAlerts: rec.alerts.length };
        rec.handlers.forEach((h) => {
          h.onProgress({ type: 'progress', progress: 1, analysedSec: rec.analysedSec, frames: rec.frames, alerts: rec.alerts });
          h.onDone(done);
        });
      } catch (e) {
        rec.status = 'error';
        rec.message = e instanceof Error ? e.message : 'Không đọc được kết quả phân tích.';
        rec.handlers.forEach((h) => h.onError({ type: 'error', message: rec.message! }));
      }
      return;
    }
    let msg = `Lỗi ${xhr.status}`;
    try {
      msg = JSON.parse(xhr.responseText).message ?? msg;
    } catch {
      /* ignore */
    }
    if (xhr.status === 401) notifyUnauthorized();
    rec.status = 'error';
    rec.message = msg;
    rec.handlers.forEach((h) => h.onError({ type: 'error', message: msg }));
  };
  xhr.onerror = () => {
    rec.status = 'error';
    rec.message = 'Lỗi mạng';
    rec.handlers.forEach((h) => h.onError({ type: 'error', message: rec.message! }));
  };
  xhr.onabort = () => {
    rec.status = 'error';
    rec.message = 'Đã huỷ phân tích.';
    rec.handlers.forEach((h) => h.onError({ type: 'error', message: rec.message! }));
  };
  signal?.addEventListener('abort', () => xhr.abort());
  xhr.send(fd);
  return Promise.resolve(job);
}

export async function httpStartJob(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisJob> {
  const fd = formFor(input);
  const token = getToken();
  const res = await fetch(API_BASE + '/analysis/jobs', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd, signal });
  if (res.status === 404) return startLegacyJob(input, signal);
  if (!res.ok) {
    const msg = await errorMessage(res);
    if (res.status === 401 && token) notifyUnauthorized();
    throw new ApiError(msg, res.status);
  }
  const raw = (await res.json()) as Record<string, unknown>;
  return jobFromInput(input, raw);
}

export async function httpGetJob(jobId: string, since?: number): Promise<AnalysisJobState> {
  const rec = legacy.get(jobId);
  if (rec) {
    const s = since ?? 0;
    return {
      status: rec.status,
      progress: rec.progress,
      analysedSec: rec.analysedSec,
      frames: since === undefined ? rec.frames : rec.frames.filter((f) => f.t > s),
      alerts: since === undefined ? rec.alerts : rec.alerts.filter((a) => a.t > s),
      message: rec.message,
      duration: rec.duration,
      totalFrames: rec.frames.length,
      totalAlerts: rec.alerts.length,
    };
  }
  const q = since !== undefined ? `?since=${encodeURIComponent(String(since))}` : '';
  const res = await fetch(API_BASE + `/analysis/jobs/${encodeURIComponent(jobId)}${q}`, { headers: authHeaders() });
  if (!res.ok) {
    const msg = await errorMessage(res);
    if (res.status === 401 && getToken()) notifyUnauthorized();
    throw new ApiError(msg, res.status);
  }
  const raw = (await res.json()) as AnalysisJobState;
  return {
    status: raw.status,
    progress: Number(raw.progress) || 0,
    analysedSec: Number(raw.analysedSec) || 0,
    frames: Array.isArray(raw.frames) ? raw.frames : [],
    alerts: Array.isArray(raw.alerts) ? raw.alerts : [],
    message: raw.message,
    duration: raw.duration,
    totalFrames: raw.totalFrames,
    totalAlerts: raw.totalAlerts,
  };
}

export async function httpCancelJob(jobId: string): Promise<void> {
  const rec = legacy.get(jobId);
  if (rec) {
    rec.xhr?.abort();
    return;
  }
  const res = await fetch(API_BASE + `/analysis/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', headers: authHeaders() });
  if (res.status === 404 || res.status === 204 || res.ok) return;
  const msg = await errorMessage(res);
  if (res.status === 401 && getToken()) notifyUnauthorized();
  throw new ApiError(msg, res.status);
}

function subscribeLegacy(jobId: string, handler: AnalysisJobHandler): () => void {
  const rec = legacy.get(jobId);
  if (!rec) {
    queueMicrotask(() => handler.onError({ type: 'error', message: 'Không tìm thấy job phân tích.' }));
    return () => {};
  }
  rec.handlers.add(handler);
  if (rec.status === 'done') {
    queueMicrotask(() => {
      handler.onProgress({ type: 'progress', progress: 1, analysedSec: rec.analysedSec, frames: rec.frames, alerts: rec.alerts });
      handler.onDone({ type: 'done', progress: 1, duration: rec.duration, totalFrames: rec.frames.length, totalAlerts: rec.alerts.length });
    });
  } else if (rec.status === 'error') {
    queueMicrotask(() => handler.onError({ type: 'error', message: rec.message || 'Lỗi phân tích' }));
  }
  return () => {
    rec.handlers.delete(handler);
  };
}

export function httpSubscribeJob(jobId: string, handler: AnalysisJobHandler): () => void {
  if (legacy.has(jobId) || jobId.startsWith('legacy-')) return subscribeLegacy(jobId, handler);

  let closed = false;
  let done = false;
  let ws: WebSocket | null = null;
  let pollTimer: number | undefined;
  let retryTimer: number | undefined;
  let analysedSec = 0;
  let haveSnapshot = false;
  let wsAttempt = 0;

  const finish = () => {
    done = true;
    clearInterval(pollTimer);
    clearTimeout(retryTimer);
    pollTimer = undefined;
    retryTimer = undefined;
  };

  const applyState = (snap: AnalysisJobState) => {
    if (closed || done) return;
    if (snap.frames?.length || snap.alerts?.length || snap.progress != null) {
      handler.onProgress({
        type: 'progress',
        progress: Number(snap.progress) || 0,
        analysedSec: Number(snap.analysedSec) || 0,
        frames: snap.frames ?? [],
        alerts: snap.alerts ?? [],
      });
      if (snap.analysedSec != null) analysedSec = Math.max(analysedSec, Number(snap.analysedSec) || 0);
    }
    if (snap.status === 'done') {
      finish();
      handler.onDone({
        type: 'done',
        progress: 1,
        duration: Number(snap.duration) || analysedSec,
        totalFrames: Number(snap.totalFrames) || (snap.frames?.length ?? 0),
        totalAlerts: Number(snap.totalAlerts) || (snap.alerts?.length ?? 0),
      });
    } else if (snap.status === 'error') {
      finish();
      handler.onError({ type: 'error', message: snap.message || 'Lỗi phân tích' });
    }
  };

  const pollOnce = async () => {
    if (closed || done) return;
    try {
      const snap = await httpGetJob(jobId, haveSnapshot ? analysedSec : undefined);
      haveSnapshot = true;
      applyState(snap);
    } catch (e) {
      if (closed || done) return;
      // Giữ poll; chỉ báo lỗi khi job rõ ràng không còn (404).
      if (e instanceof ApiError && e.status === 404) {
        finish();
        handler.onError({ type: 'error', message: e.message || 'Không tìm thấy job phân tích.' });
      }
    }
  };

  const startPoll = () => {
    if (pollTimer !== undefined || closed || done) return;
    void pollOnce();
    pollTimer = window.setInterval(() => void pollOnce(), 1000);
  };

  const stopPoll = () => {
    clearInterval(pollTimer);
    pollTimer = undefined;
  };

  const connectWs = () => {
    if (closed || done) return;
    const token = getToken();
    if (!token) {
      startPoll();
      return;
    }
    const url = `${wsUrl()}/analysis/${encodeURIComponent(jobId)}?token=${encodeURIComponent(token)}`;
    const socket = new WebSocket(url);
    ws = socket;
    let opened = false;
    socket.onopen = () => {
      opened = true;
      wsAttempt = 0;
      stopPoll();
    };
    socket.onmessage = (ev) => {
      if (closed || done) return;
      let msg: { type?: string; data?: unknown; progress?: number; analysedSec?: number; frames?: unknown; alerts?: unknown; message?: string; duration?: number; totalFrames?: number; totalAlerts?: number };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const body = msg.data && typeof msg.data === 'object' && (msg.type === 'progress' || msg.type === 'done' || msg.type === 'error') ? { ...(msg.data as object), type: msg.type } : msg;
      const typ = (body as { type?: string }).type;
      if (typ === 'progress') {
        const p = body as { progress?: number; analysedSec?: number; frames?: AnalysisJobState['frames']; alerts?: AnalysisJobState['alerts'] };
        handler.onProgress({
          type: 'progress',
          progress: Number(p.progress) || 0,
          analysedSec: Number(p.analysedSec) || 0,
          frames: Array.isArray(p.frames) ? p.frames : [],
          alerts: Array.isArray(p.alerts) ? p.alerts : [],
        });
        haveSnapshot = true;
        if (p.analysedSec != null) analysedSec = Math.max(analysedSec, Number(p.analysedSec) || 0);
      } else if (typ === 'done') {
        const d = body as AnalysisDoneEvent;
        finish();
        handler.onDone({
          type: 'done',
          progress: 1,
          duration: Number(d.duration) || analysedSec,
          totalFrames: Number(d.totalFrames) || 0,
          totalAlerts: Number(d.totalAlerts) || 0,
        });
        socket.close();
      } else if (typ === 'error') {
        const message = String((body as { message?: string }).message || 'Lỗi phân tích');
        finish();
        handler.onError({ type: 'error', message });
        socket.close();
      }
    };
    socket.onclose = (ev) => {
      if (ws !== socket || closed || done) return;
      ws = null;
      if (ev.code === 4401) {
        finish();
        notifyUnauthorized();
        handler.onError({ type: 'error', message: 'Phiên đăng nhập đã hết hạn.' });
        return;
      }
      if (ev.code === 4404) {
        finish();
        handler.onError({ type: 'error', message: 'Phiên phân tích đã hết hạn, hãy tải lại file.' });
        return;
      }
      if (!opened) {
        // Bắt tay thất bại hoặc rớt: poll 1 giây một lần, thử lại WS vài lần.
        startPoll();
        wsAttempt += 1;
        if (wsAttempt <= 5 && !closed && !done) {
          const wait = Math.min(8000, 1000 * 2 ** (wsAttempt - 1));
          retryTimer = window.setTimeout(connectWs, wait);
        }
      } else {
        startPoll();
        if (!closed && !done) retryTimer = window.setTimeout(connectWs, 5000);
      }
    };
  };

  connectWs();

  return () => {
    closed = true;
    finish();
    const s = ws;
    ws = null;
    try {
      s?.close();
    } catch {
      /* ignore */
    }
  };
}

/** analyze() cũ: chờ job xong (hoặc POST /analysis nếu startJob đi đường legacy). */
export async function httpAnalyze(input: AnalysisInput, onProgress: ProgressFnCompat, signal?: AbortSignal): Promise<AnalysisResult> {
  const job = await httpStartJob(input, signal);
  onProgress(10, 'Đã tạo job, đang phân tích…');
  return new Promise<AnalysisResult>((resolve, reject) => {
    const unsub = httpSubscribeJob(job.jobId, {
      onProgress: (e) => onProgress(Math.round((e.progress || 0) * 100), `Đang phân tích…`),
      onDone: async () => {
        unsub();
        try {
          const snap = await httpGetJob(job.jobId);
          onProgress(100, 'Hoàn tất');
          resolve({
            id: job.jobId,
            fileName: job.fileName,
            mediaType: job.mediaType,
            width: job.width,
            height: job.height,
            coord: job.coord ?? 'px',
            duration: job.duration || snap.duration || 0,
            fps: job.fps,
            model: job.model,
            frames: snap.frames,
            alerts: snap.alerts,
            createdAt: Date.now(),
            mediaUrl: job.mediaUrl,
          });
        } catch (e) {
          reject(e);
        }
      },
      onError: (e) => {
        unsub();
        reject(Object.assign(new Error(e.message), { name: e.message === 'Đã huỷ phân tích.' ? 'AbortError' : 'Error' }));
      },
    });
    signal?.addEventListener('abort', () => {
      unsub();
      void httpCancelJob(job.jobId);
      reject(new DOMException('Đã huỷ', 'AbortError'));
    });
  });
}

type ProgressFnCompat = (percent: number, stage: string) => void;
