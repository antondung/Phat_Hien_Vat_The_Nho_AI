/** Khung hiển thị phân tích: phát media ngay, lớp phủ theo khung đã có, đánh dấu đoạn đã phân tích. */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Maximize2, Minimize2, Pause, Play } from 'lucide-react';
import type { AnalysisAlert, AnalysisFrame, CoordSpace } from '../../types';
import type { JobUiStatus } from '../../hooks/useAnalysisJob';
import { useTicker } from '../../hooks/useTicker';
import { drawOverlay, type OverlayLayers } from '../../lib/overlay';
import { containRect } from '../../lib/geometry';
import { frameAtPlayhead } from '../../lib/analysisJob';
import { renderScene } from '../../scene/renderScene';
import { sampleVideoScene } from '../../services/mock/mockAnalysis';
import { fmtDuration, fmtVideoTime } from '../../lib/format';
import { LEVEL_LABEL } from '../../lib/labels';
import { roleCounts, showRoleCounts } from '../../lib/roles';
import { RoleCountChip, RoleLegend, useRoleModel, PhoneZoomChip } from '../../components/video/RoleCountChip';

export type StageSource = { type: 'image'; url: string } | { type: 'video'; url: string } | { type: 'synthetic' };
export interface StageHandle {
  seek(t: number): void;
}

const SYN_BASE = new Date(2026, 5, 12, 7, 45, 0).getTime();

export type MediaStageProps = {
  source: StageSource;
  mediaType: 'image' | 'video';
  width: number;
  height: number;
  duration: number;
  coord?: CoordSpace;
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
  analysedSec: number;
  progress: number;
  status: JobUiStatus;
  layers: OverlayLayers;
};

export const MediaStage = forwardRef<StageHandle, MediaStageProps>(function MediaStage(
  { source, mediaType, width, height, duration, coord = 'px', frames, alerts, analysedSec, progress, status, layers },
  ref,
) {
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const media = useRef<HTMLImageElement | HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const last = useRef(performance.now());
  const scene = useMemo(() => sampleVideoScene(), []);
  const isVideo = mediaType === 'video';
  const srcKey = source.type === 'synthetic' ? 'synthetic' : source.url;
  const framesRef = useRef(frames);
  const alertsRef = useRef(alerts);
  const analysedRef = useRef(analysedSec);
  framesRef.current = frames;
  alertsRef.current = alerts;
  analysedRef.current = analysedSec;

  useEffect(() => {
    tRef.current = 0;
    setT(0);
    setPlaying(isVideo);
    if (source.type === 'image') {
      const img = new Image();
      img.src = source.url;
      media.current = img;
    } else if (source.type === 'video') {
      const v = document.createElement('video');
      v.src = source.url;
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      media.current = v;
    } else media.current = null;
    return () => {
      if (media.current instanceof HTMLVideoElement) media.current.pause();
    };
  }, [srcKey, isVideo, source]);

  useEffect(() => {
    const v = media.current;
    if (v instanceof HTMLVideoElement) {
      if (playing) void v.play().catch(() => setPlaying(false));
      else v.pause();
    }
  }, [playing, srcKey]);

  const dur = duration > 0 ? duration : isVideo ? Math.max(duration, 0) : 0;
  const seek = (s: number) => {
    const max = dur > 0 ? dur : 1e9;
    const c = Math.max(0, Math.min(max, s));
    tRef.current = c;
    setT(c);
    if (media.current instanceof HTMLVideoElement) media.current.currentTime = c;
  };
  useImperativeHandle(ref, () => ({ seek }));

  useEffect(() => {
    const onCh = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onCh);
    return () => document.removeEventListener('fullscreenchange', onCh);
  }, []);
  /** Toàn màn hình cả khung (video + lớp nhận diện + tiến độ + thanh tua). Esc để thoát. */
  const toggleFull = async () => {
    const el = root.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else {
        if (document.fullscreenElement) await document.exitFullscreen();
        await el.requestFullscreen();
      }
    } catch {
      /* trình duyệt từ chối / không hỗ trợ */
    }
  };
  const fullBtn = (
    <button
      type="button"
      className="icon-btn stage-full-btn"
      onClick={() => void toggleFull()}
      title={full ? 'Thoát toàn màn hình (Esc)' : 'Xem toàn màn hình (hoặc nhấp đúp vào video)'}
      aria-label={full ? 'Thoát toàn màn hình' : 'Xem toàn màn hình'}
    >
      {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
    </button>
  );

  useTicker((now) => {
    const dt = Math.min(0.1, (now - last.current) / 1000);
    last.current = now;
    const v = media.current;
    const end = dur > 0 ? dur : v instanceof HTMLVideoElement && isFinite(v.duration) ? v.duration : 0;
    if (isVideo && playing) {
      if (v instanceof HTMLVideoElement) tRef.current = v.currentTime;
      else tRef.current += dt;
      if (end && tRef.current >= end - 0.02) {
        tRef.current = end;
        setPlaying(false);
      }
      setT(tRef.current);
    }
    const c = cv.current;
    const w = wrap.current;
    if (!c || !w) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const W = Math.round(w.clientWidth * dpr);
    const H = Math.round(w.clientHeight * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0B1220';
    ctx.fillRect(0, 0, W, H);
    const fw = width || (v instanceof HTMLVideoElement ? v.videoWidth : v instanceof HTMLImageElement ? v.naturalWidth : 0) || 16;
    const fh = height || (v instanceof HTMLVideoElement ? v.videoHeight : v instanceof HTMLImageElement ? v.naturalHeight : 0) || 9;
    const r = containRect(fw, fh, W, H);
    const tt = tRef.current;
    if (source.type === 'synthetic') {
      ctx.save();
      ctx.translate(r.x, r.y);
      renderScene(ctx, scene, tt * 1000, r.w, r.h, { room: 'P.503.2', clockMs: SYN_BASE + tt * 1000, grain: true });
      ctx.restore();
    } else if (v && ((v instanceof HTMLImageElement && v.complete) || (v instanceof HTMLVideoElement && v.readyState >= 2))) {
      ctx.drawImage(v, r.x, r.y, r.w, r.h);
    }
    const f = frameAtPlayhead(framesRef.current, isVideo ? tt : 0);
    if (!f) return;
    const flagged = alertsRef.current.filter((a) => (isVideo ? tt >= a.t && tt - a.t < 4 : true) && a.level !== 'thong_tin');
    drawOverlay(ctx, { coord, width: fw, height: fh, objects: f.objects, poses: f.poses }, r, {
      layers,
      flaggedObjects: new Set(flagged.map((a) => a.objectId!).filter(Boolean)),
      flaggedTracks: new Set(flagged.map((a) => a.trackId).filter((x): x is number => x != null)),
      blinkOn: Math.floor(now / 320) % 2 === 0,
      scale: Math.max(0.6, Math.min(1.4, r.w / 950)),
    });
  });

  const roleModel = useRoleModel();
  const curFrame = frameAtPlayhead(frames, isVideo ? t : 0);
  const curRoleCounts = curFrame ? roleCounts(curFrame) : null;
  const showRoleLegend = !!(curFrame && curRoleCounts && showRoleCounts(curRoleCounts, curFrame.roleEnabled ?? roleModel?.enabled));
  const ahead = isVideo && (status === 'running' || status === 'queued' || status === 'starting') && t > analysedSec + 0.4;
  const pct = Math.max(0, Math.min(100, (progress || 0) * 100));
  const analysedPct = dur > 0 ? Math.max(0, Math.min(100, (analysedSec / dur) * 100)) : pct;
  const statusText =
    status === 'starting' ? 'Đang tải tệp lên…'
    : status === 'queued' ? 'Đang chờ lượt phân tích'
    : status === 'running' && isVideo && dur > 0 ? `Đang phân tích ${fmtDuration(analysedSec)} / ${fmtDuration(dur)}`
    : status === 'running' ? 'Đang phân tích…'
    : status === 'done' ? `Đã phân tích xong · ${alerts.length} cảnh báo`
    : status === 'cancelled' ? 'Đã huỷ phân tích'
    : '';

  return (
    <div ref={root} className={`stage ${full ? 'is-full' : ''}`}>
      <div ref={wrap} className="stage-view" onDoubleClick={() => void toggleFull()}>
        <canvas ref={cv} />
        {curFrame && curRoleCounts && <RoleCountChip className="role-chip-overlay stage-role-chip" counts={curRoleCounts} roleEnabled={curFrame.roleEnabled ?? roleModel?.enabled} />}
        <RoleLegend show={showRoleLegend} className="stage-role-legend" />
        {curFrame && <PhoneZoomChip objects={curFrame.objects} className="role-chip-overlay stage-zoom-chip" />}
        {!isVideo && <div className="stage-full-corner">{fullBtn}</div>}
        {ahead && <div className="stage-ahead">Chưa phân tích tới đoạn này</div>}
      </div>
      {(statusText || status === 'running' || status === 'queued' || status === 'starting' || status === 'done') && (
        <div className={`stage-progress ${status === 'done' ? 'is-done' : ''} ${status === 'queued' ? 'is-queued' : ''}`}>
          {status !== 'done' && status !== 'cancelled' && (
            <div className="progress-track" aria-hidden>
              <div className="progress-fill" style={{ width: `${status === 'queued' ? 8 : pct}%` }} />
            </div>
          )}
          <span className="stage-progress-label">{statusText}</span>
        </div>
      )}
      {isVideo && (
        <div className="stage-controls">
          <button
            className="icon-btn"
            onClick={() => {
              const endAt = dur > 0 ? dur : tRef.current;
              if (!playing && tRef.current >= endAt - 0.05) seek(0);
              setPlaying((p) => !p);
            }}
            aria-label={playing ? 'Tạm dừng' : 'Phát'}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="mono small">{fmtVideoTime(t)}</span>
          <div className="scrub">
            <div className="scrub-analysed" style={{ width: `${analysedPct}%` }} title="Đoạn đã phân tích" />
            <input
              type="range"
              min={0}
              max={dur > 0 ? dur : Math.max(t, 1)}
              step={0.05}
              value={t}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Tua video"
            />
            {alerts.map((a) => (
              <button
                key={a.id}
                className={`scrub-mark lv-bg-${a.level}`}
                style={{ left: `${dur > 0 ? (a.t / dur) * 100 : 0}%` }}
                title={`${fmtVideoTime(a.t)} · ${LEVEL_LABEL[a.level]}: ${a.message}`}
                onClick={() => seek(a.t)}
              />
            ))}
          </div>
          <span className="mono small muted">{fmtVideoTime(dur || t)}</span>
          {fullBtn}
        </div>
      )}
    </div>
  );
});
