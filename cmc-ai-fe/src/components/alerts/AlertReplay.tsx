/**
 * Đoạn clip ngắn quanh thời điểm cảnh báo.
 *  - backend thật: <video src={clipUrl}> (−4s → +3s); clipUrl = null thì hiện ảnh chụp + "Đang tạo clip…"
 *  - mock: phát lại cảnh mô phỏng từ ts−5s đến ts+2s (cũng chờ alert_update như backend)
 */
import { useEffect, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Alert } from '../../types';
import { useLive } from '../../context/LiveContext';
import { useTicker } from '../../hooks/useTicker';
import { cameraOf, drawAlertFrame } from './sceneRender';
import { fmtTime } from '../../lib/format';

/** Quá thời gian này mà vẫn chưa có clip (vd ghép lỗi) thì thôi chờ, chỉ hiện ảnh chụp */
const CLIP_GIVE_UP_MS = 60000;

/** khoảng phát lại mô phỏng quanh cảnh báo (giây) */
const BEFORE = 5;
const AFTER = 2;

/**
 * clipUrl = null: clip đang được ghép. Không gọi thử /media (sẽ 404) mà chờ sự kiện `alert_update`
 * mang clipUrl — LiveContext cập nhật cảnh báo, component tự chuyển sang phát clip.
 */
function ClipPending({ alert }: { alert: Alert }) {
  const { cameras } = useLive();
  const ref = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  const late = Date.now() - alert.ts > CLIP_GIVE_UP_MS;
  useEffect(() => {
    if (late) return;
    const t = window.setTimeout(() => force((n) => n + 1), alert.ts + CLIP_GIVE_UP_MS - Date.now() + 50);
    return () => clearTimeout(t);
  }, [alert.ts, late]);
  useEffect(() => {
    const cv = ref.current;
    if (cv) drawAlertFrame(cv.getContext('2d')!, alert, cameraOf(alert, cameras), alert.ts, cv.width, cv.height, { x: 0, y: 0, w: 1, h: 1 }, true);
  }, [alert, cameras]);
  return (
    <div className="replay-wait">
      {alert.snapshotUrl ? <img src={alert.snapshotUrl} alt="Ảnh chụp cảnh báo" /> : <canvas ref={ref} width={960} height={540} />}
      <span className="replay-wait-note">{late ? 'Chưa có clip cho cảnh báo này – đang hiện ảnh chụp.' : 'Đang tạo clip quanh thời điểm cảnh báo…'}</span>
    </div>
  );
}

function ClipVideo({ alert }: { alert: Alert }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [alert.clipUrl]);
  if (failed) {
    return (
      <div className="replay-wait">
        {alert.snapshotUrl && <img src={alert.snapshotUrl} alt="Ảnh chụp cảnh báo" />}
        <span className="replay-wait-note">Không phát được clip – đang hiện ảnh chụp.</span>
      </div>
    );
  }
  return <video className="replay-video" src={alert.clipUrl!} controls autoPlay muted loop playsInline onError={() => setFailed(true)} />;
}

export function AlertReplay({ alert }: { alert: Alert }) {
  const { cameras } = useLive();
  const ref = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(true);
  const [pos, setPos] = useState(0); // giây trong clip
  const last = useRef(performance.now());
  const total = BEFORE + AFTER;
  // mock: không có tệp clip -> phát lại cảnh mô phỏng (clipUrl "mock:replay" hoặc không có)
  const simulated = alert.clipUrl === undefined || (typeof alert.clipUrl === 'string' && alert.clipUrl.startsWith('mock:'));

  useEffect(() => {
    setPos(0);
    setPlaying(true);
  }, [alert.id]);

  useTicker((now) => {
    const dt = (now - last.current) / 1000;
    last.current = now;
    let p = pos;
    if (playing) {
      p = pos + Math.min(dt, 0.1);
      if (p > total) p = 0;
      setPos(p);
    }
    const cv = ref.current;
    if (!cv) return;
    drawAlertFrame(cv.getContext('2d')!, alert, cameraOf(alert, cameras), alert.ts - BEFORE * 1000 + p * 1000, cv.width, cv.height, { x: 0, y: 0, w: 1, h: 1 }, p >= BEFORE - 0.05 ? Math.floor(now / 300) % 2 === 0 : false);
  }, simulated);

  if (alert.clipUrl === null) return <ClipPending alert={alert} />;
  if (!simulated) return <ClipVideo alert={alert} />;

  const markerPct = (BEFORE / total) * 100;
  return (
    <div className="replay">
      <canvas ref={ref} width={960} height={540} />
      <div className="replay-bar">
        <button className="icon-btn light" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Tạm dừng' : 'Phát'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn light" onClick={() => setPos(0)} aria-label="Phát lại từ đầu">
          <RotateCcw size={16} />
        </button>
        <div className="replay-track">
          <input type="range" min={0} max={total} step={0.05} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Tua clip" />
          <span className="replay-marker" style={{ left: `${markerPct}%` }} title="Thời điểm cảnh báo" />
        </div>
        <span className="mono small">{fmtTime(alert.ts - BEFORE * 1000 + pos * 1000)}</span>
      </div>
    </div>
  );
}
