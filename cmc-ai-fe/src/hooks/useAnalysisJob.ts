/** Job phân tích luồng: phát media ngay, nhận khung/cảnh báo dần, cập nhật UI tối đa ~10 Hz. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../services';
import type { AnalysisAlert, AnalysisFrame, AnalysisInput, AnalysisJob, AnalysisProgressEvent } from '../types';
import { mergeAlerts, mergeFrames } from '../lib/analysisJob';

export type JobUiStatus = 'idle' | 'starting' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export type AnalysisJobView = {
  job: AnalysisJob | null;
  status: JobUiStatus;
  progress: number;
  analysedSec: number;
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
  message: string;
  start: (input: AnalysisInput) => Promise<AnalysisJob | null>;
  cancel: () => Promise<void>;
  reset: () => Promise<void>;
};

type Buf = {
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
  progress: number;
  analysedSec: number;
  status: JobUiStatus;
  message: string;
  dirty: boolean;
};

function emptyBuf(status: JobUiStatus = 'idle'): Buf {
  return { frames: [], alerts: [], progress: 0, analysedSec: 0, status, message: '', dirty: true };
}

export function useAnalysisJob(): AnalysisJobView {
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [status, setStatus] = useState<JobUiStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [analysedSec, setAnalysedSec] = useState(0);
  const [frames, setFrames] = useState<AnalysisFrame[]>([]);
  const [alerts, setAlerts] = useState<AnalysisAlert[]>([]);
  const [message, setMessage] = useState('');

  const jobIdRef = useRef<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const cancelByUs = useRef(false);
  const gen = useRef(0);
  const buf = useRef<Buf>(emptyBuf());
  const flush = useCallback((force = false) => {
    const b = buf.current;
    if (!b.dirty && !force) return;
    b.dirty = false;
    setFrames(b.frames);
    setAlerts(b.alerts);
    setProgress(b.progress);
    setAnalysedSec(b.analysedSec);
    setStatus(b.status);
    setMessage(b.message);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => flush(), 100);
    return () => {
      clearInterval(id);
    };
  }, [flush]);

  const applyProgress = useCallback((e: AnalysisProgressEvent) => {
    const b = buf.current;
    b.frames = mergeFrames(b.frames, e.frames ?? []);
    b.alerts = mergeAlerts(b.alerts, e.alerts ?? []);
    if (e.progress != null) b.progress = e.progress;
    if (e.analysedSec != null) b.analysedSec = Math.max(b.analysedSec, e.analysedSec);
    if (b.status === 'starting' || b.status === 'queued' || b.status === 'idle') b.status = 'running';
    b.dirty = true;
  }, []);

  const stopListen = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
  }, []);

  const cancel = useCallback(async () => {
    cancelByUs.current = true;
    stopListen();
    const id = jobIdRef.current;
    jobIdRef.current = null;
    if (id) {
      try {
        await api.analysis.cancelJob(id);
      } catch {
        /* 404 / mạng: vẫn coi là đã huỷ phía FE */
      }
    }
    if (buf.current.status === 'starting' || buf.current.status === 'queued' || buf.current.status === 'running') {
      buf.current.status = 'cancelled';
      buf.current.dirty = true;
      flush(true);
    }
  }, [flush, stopListen]);

  const start = useCallback(
    async (input: AnalysisInput): Promise<AnalysisJob | null> => {
      const my = ++gen.current;
      await cancel();
      if (my !== gen.current) return null;
      cancelByUs.current = false;
      buf.current = emptyBuf('starting');
      setJob(null);
      flush(true);
      let created: AnalysisJob;
      try {
        created = await api.analysis.startJob(input);
      } catch (e) {
        if (my !== gen.current || cancelByUs.current) return null;
        const msg = e instanceof Error && (e as Error).name === 'AbortError' ? 'Đã huỷ phân tích.' : e instanceof Error ? e.message : 'Không tạo được phiên phân tích.';
        if ((e as Error)?.name === 'AbortError') {
          buf.current.status = 'cancelled';
          buf.current.message = '';
        } else {
          buf.current.status = 'error';
          buf.current.message = msg;
        }
        buf.current.dirty = true;
        flush(true);
        return null;
      }
      if (my !== gen.current || cancelByUs.current) {
        void api.analysis.cancelJob(created.jobId).catch(() => {});
        return null;
      }
      jobIdRef.current = created.jobId;
      setJob(created);
      if (buf.current.status === 'starting') {
        buf.current.status = 'running';
        buf.current.dirty = true;
        flush(true);
      }

      try {
        const snap = await api.analysis.getJob(created.jobId);
        if (my !== gen.current) return created;
        applyProgress({ type: 'progress', progress: snap.progress, analysedSec: snap.analysedSec, frames: snap.frames, alerts: snap.alerts });
        if (snap.status === 'queued') buf.current.status = 'queued';
        else if (snap.status === 'running') buf.current.status = 'running';
        else if (snap.status === 'done') {
          buf.current.status = 'done';
          buf.current.progress = 1;
        } else if (snap.status === 'error') {
          buf.current.status = 'error';
          buf.current.message = snap.message || 'Lỗi phân tích';
        }
        buf.current.dirty = true;
        flush(true);
        if (snap.status === 'done' || snap.status === 'error') return created;
      } catch {
        /* GET lỗi: vẫn nghe WS / poll */
      }

      stopListen();
      unsubRef.current = api.analysis.subscribeJob(created.jobId, {
        onProgress: (e) => {
          if (my !== gen.current || cancelByUs.current) return;
          applyProgress(e);
        },
        onDone: (e) => {
          if (my !== gen.current || cancelByUs.current) return;
          buf.current.status = 'done';
          buf.current.progress = 1;
          if (e.duration) buf.current.analysedSec = Math.max(buf.current.analysedSec, e.duration);
          buf.current.dirty = true;
          flush(true);
        },
        onError: (e) => {
          if (my !== gen.current) return;
          // Khi chính FE huỷ thì bỏ qua thông báo "Đã huỷ phân tích." từ WS.
          if (cancelByUs.current) return;
          buf.current.status = 'error';
          buf.current.message = e.message || 'Lỗi phân tích';
          buf.current.dirty = true;
          flush(true);
        },
      });
      return created;
    },
    [applyProgress, cancel, flush, stopListen],
  );

  const reset = useCallback(async () => {
    gen.current += 1;
    await cancel();
    buf.current = emptyBuf('idle');
    setJob(null);
    flush(true);
  }, [cancel, flush]);

  useEffect(() => {
    return () => {
      gen.current += 1;
      cancelByUs.current = true;
      unsubRef.current?.();
      const id = jobIdRef.current;
      jobIdRef.current = null;
      if (id) void api.analysis.cancelJob(id).catch(() => {});
    };
  }, []);

  return { job, status, progress, analysedSec, frames, alerts, message, start, cancel, reset };
}
