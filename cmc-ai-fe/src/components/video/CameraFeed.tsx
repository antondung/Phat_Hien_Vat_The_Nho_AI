/**
 * Ô hiển thị một camera: "video" + lớp phủ AI vẽ trên canvas trong suốt.
 *  - mock : vẽ cảnh giả lập (hoặc webcam của trình duyệt) lên canvas (nhịp ticker).
 *  - real : video gốc từ backend nằm trong <img> bên dưới canvas.
 *           Lớp phủ chỉ vẽ lại khi có gói `detections` mới (hoặc resize / hết hạn),
 *           không vẽ mỗi animation frame. Toạ độ theo width/height của frame BE,
 *           có tính letterbox object-fit: contain.
 *           Ẩn tab hoặc ô ra khỏi viewport: dừng MJPEG / snapshot.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { Camera } from '../../types';
import { useLive, activeFlags } from '../../context/LiveContext';
import { useGridFeed } from '../../context/GridFeedContext';
import { useTicker } from '../../hooks/useTicker';
import { sceneForCamera } from '../../scene/sceneModel';
import { renderScene } from '../../scene/renderScene';
import { drawOverlay, type OverlayLayers } from '../../lib/overlay';
import { containRect } from '../../lib/geometry';
import { frameContainRect, isEmptyDetection, resolveOverlaySpace, shouldDrawDetection } from '../../lib/overlayMap';
import { getWebcamStream } from './webcam';
import { API_MODE, realtime } from '../../services';
import { cameraLiveUrl, snapshotIntervalMs, GRID_SNAPSHOT_WIDTH, type LiveTransport } from '../../services/media';
import { Loader2, VideoOff, WifiOff } from 'lucide-react';

interface Props {
  camera: Camera;
  overlay?: boolean;
  layers?: OverlayLayers;
  className?: string;
  quality?: 'low' | 'high';
  osd?: boolean;
  dense?: boolean;
  transport?: LiveTransport;
  snapshotWidth?: number;
}

const ALL_LAYERS: OverlayLayers = { box: true, pose: true, label: true, conf: false };
const REAL = API_MODE === 'real';

function usePageVisible() {
  const [v, setV] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const fn = () => setV(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', fn);
    return () => document.removeEventListener('visibilitychange', fn);
  }, []);
  return v;
}

function useInView(ref: RefObject<HTMLElement | null>) {
  const [v, setV] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setV(e.isIntersecting), { threshold: 0.02 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return v;
}

export function CameraFeed({ camera, overlay = true, layers = ALL_LAYERS, className = '', quality = 'high', osd = true, dense = false, transport, snapshotWidth }: Props) {
  const mode: LiveTransport = transport ?? (quality === 'high' ? 'stream' : 'snapshot');
  const snapW = snapshotWidth ?? (mode === 'snapshot' && quality === 'low' ? GRID_SNAPSHOT_WIDTH : undefined);
  const { frames, alerts, statuses, connection } = useLive();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [webcamState, setWebcamState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const imgRef = useRef<HTMLImageElement>(null);
  const staleRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;
  const layersRef = useRef(layers);
  layersRef.current = layers;
  const denseRef = useRef(dense);
  denseRef.current = dense;
  const overlayRef = useRef(overlay);
  overlayRef.current = overlay;
  const grid = useGridFeed();
  const [gridUrl, setGridUrl] = useState<string | undefined>();
  useEffect(() => (grid ? grid.subscribe(camera.id, setGridUrl) : undefined), [grid, camera.id]);
  const gridLive = !!grid && grid.status === 'live';
  const pageVisible = usePageVisible();
  const inView = useInView(wrapRef);

  const status = statuses[camera.id];
  const online = camera.enabled && (status ? status.online : !REAL);
  const connected = connection.state === 'connected';
  const streamOn = REAL && online && pageVisible && inView;

  // Video gốc: dừng hoàn toàn khi tab ẩn hoặc ô không còn trên màn hình
  useEffect(() => {
    const img = imgRef.current;
    if (!streamOn || !img) {
      if (img) img.removeAttribute('src');
      setImgLoaded(false);
      return;
    }
    if (gridLive) {
      if (gridUrl) img.src = gridUrl;
      return;
    }
    setImgLoaded(false);
    if (mode === 'stream') {
      img.src = cameraLiveUrl(camera.id, 'stream');
      return () => {
        img.removeAttribute('src');
      };
    }
    let alive = true;
    let timer: number | undefined;
    const pull = () => {
      const pre = new Image();
      const url = cameraLiveUrl(camera.id, 'snapshot', { width: snapW });
      const next = () => {
        if (alive) timer = window.setTimeout(pull, snapshotIntervalMs());
      };
      pre.onload = () => {
        if (!alive) return;
        img.src = url;
        next();
      };
      pre.onerror = next;
      pre.src = url;
    };
    pull();
    return () => {
      alive = false;
      clearTimeout(timer);
      img.removeAttribute('src');
    };
  }, [streamOn, mode, camera.id, snapW, gridLive, gridUrl]);

  useEffect(() => {
    if (REAL || camera.sourceType !== 'webcam') return;
    let alive = true;
    getWebcamStream()
      .then((s) => {
        if (!alive) return;
        const v = document.createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.srcObject = s;
        void v.play().catch(() => {});
        videoRef.current = v;
        setWebcamState('ok');
      })
      .catch(() => alive && setWebcamState('fail'));
    return () => {
      alive = false;
      videoRef.current = null;
    };
  }, [camera.sourceType]);

  const paintOverlay = useCallback((ctx: CanvasRenderingContext2D, W: number, H: number, now: number) => {
    const f = overlayRef.current && connected ? frames.current.get(camera.id) : undefined;
    const fresh = f ? shouldDrawDetection(f, Date.now()) : false;
    const empty = f ? isEmptyDetection(f) : true;
    const wrap = wrapRef.current;
    const state = !f || !fresh || empty ? 'none' : 'fresh';
    if (wrap && wrap.dataset.overlay !== state) wrap.dataset.overlay = state;
    if (staleRef.current) staleRef.current.hidden = true;
    if (!f || !fresh || empty) return;
    const space = resolveOverlaySpace(f);
    const img = imgRef.current;
    const r = frameContainRect(space, W, H, img?.naturalWidth || 0, img?.naturalHeight || 0);
    const fl = activeFlags(alertsRef.current, camera.id);
    ctx.save();
    drawOverlay(ctx, f, r, {
      layers: layersRef.current,
      flaggedObjects: fl.objs,
      flaggedTracks: fl.tracks,
      objectLevel: fl.objLevel,
      trackLevel: fl.trackLevel,
      flaggedLabelsOnly: denseRef.current,
      blinkOn: Math.floor(now / 320) % 2 === 0,
      scale: Math.max(0.55, Math.min(1.4, r.w / 950)),
    });
    ctx.restore();
  }, [camera.id, connected, frames]);

  const drawReal = useCallback(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5);
    const W = Math.max(1, Math.round(wrap.clientWidth * dpr));
    const H = Math.max(1, Math.round(wrap.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    const img = imgRef.current;
    if (!online || !img || !imgLoaded) {
      if (staleRef.current) staleRef.current.hidden = true;
      return;
    }
    if (overlayRef.current) paintOverlay(ctx, W, H, performance.now());
  }, [quality, online, imgLoaded, paintOverlay]);

  // Real: chỉ vẽ lại khi detections mới, resize, load ảnh, hoặc hết hạn hold.
  useEffect(() => {
    if (!REAL) return;
    drawReal();
    const wrap = wrapRef.current;
    const ro = wrap ? new ResizeObserver(() => drawReal()) : null;
    if (wrap) ro?.observe(wrap);
    const off = realtime.on('detections', (f) => {
      if (f.cameraId === camera.id) drawReal();
    });
    let hold: number | undefined;
    const arm = () => {
      window.clearTimeout(hold);
      hold = window.setTimeout(drawReal, 2100);
    };
    const off2 = realtime.on('detections', (f) => {
      if (f.cameraId === camera.id) arm();
    });
    arm();
    let blink: number | undefined;
    const maybeBlink = () => {
      const flags = activeFlags(alertsRef.current, camera.id);
      if (flags.high && overlayRef.current) {
        if (!blink) blink = window.setInterval(drawReal, 320);
      } else if (blink) {
        window.clearInterval(blink);
        blink = undefined;
      }
    };
    maybeBlink();
    const blinkWatch = window.setInterval(maybeBlink, 1000);
    return () => {
      ro?.disconnect();
      off();
      off2();
      window.clearTimeout(hold);
      window.clearInterval(blink);
      window.clearInterval(blinkWatch);
    };
  }, [camera.id, drawReal]);

  // Mock: cần ticker để vẽ cảnh / webcam
  useTicker((now) => {
    if (REAL) return;
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const dpr = Math.min(window.devicePixelRatio || 1, quality === 'low' ? 1 : 1.5);
    const W = Math.max(1, Math.round(wrap.clientWidth * dpr));
    const H = Math.max(1, Math.round(wrap.clientHeight * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0B1220';
    ctx.fillRect(0, 0, W, H);
    if (!online) {
      if (staleRef.current) staleRef.current.hidden = true;
      return;
    }
    const r = containRect(16, 9, W, H);
    ctx.save();
    ctx.translate(r.x, r.y);
    const v = videoRef.current;
    if (camera.sourceType === 'webcam' && v && v.readyState >= 2) {
      const vr = containRect(v.videoWidth, v.videoHeight, r.w, r.h);
      ctx.drawImage(v, vr.x, vr.y, vr.w, vr.h);
    } else {
      renderScene(ctx, sceneForCamera(camera), Date.now(), r.w, r.h, { room: camera.room, osd, grain: quality === 'high' });
    }
    ctx.restore();
    paintOverlay(ctx, W, H, now);
  }, !REAL);

  return (
    <div ref={wrapRef} className={`feed ${className}`}>
      {streamOn && <img ref={imgRef} className="feed-img" alt={`Video gốc ${camera.name}`} onLoad={() => setImgLoaded(true)} />}
      {REAL && !pageVisible && online && <div className="feed-msg dim"><strong>Tạm dừng video (tab đang ẩn)</strong></div>}
      <canvas ref={canvasRef} className={REAL ? 'feed-overlay' : undefined} />
      {overlay && quality === 'high' && (
        <div ref={staleRef} className="feed-stale" hidden>
          Đang chờ kết quả phân tích mới
        </div>
      )}
      {streamOn && !imgLoaded && (
        <div className="feed-msg dim">
          <Loader2 size={24} className="spin" />
          <strong>Đang tải video…</strong>
        </div>
      )}
      {!online && (
        <div className="feed-msg">
          <VideoOff size={28} />
          <strong>{camera.enabled ? 'Mất tín hiệu camera' : 'Camera đang tắt'}</strong>
          <span>{camera.enabled ? 'Không nhận được luồng video từ nguồn' : 'Bật lại trong Cài đặt → Camera'}</span>
        </div>
      )}
      {online && !connected && (
        <div className="feed-msg dim">
          {connection.state === 'reconnecting' || connection.state === 'connecting' ? <Loader2 size={24} className="spin" /> : <WifiOff size={24} />}
          <strong>{connection.state === 'disconnected' ? 'Mất kết nối máy chủ' : 'Đang kết nối lại…'}</strong>
        </div>
      )}
      {!REAL && camera.sourceType === 'webcam' && webcamState === 'fail' && online && <div className="feed-note">Không truy cập được webcam – đang dùng cảnh mô phỏng</div>}
    </div>
  );
}
