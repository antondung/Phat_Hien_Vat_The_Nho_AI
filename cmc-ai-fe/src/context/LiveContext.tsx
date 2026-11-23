/**
 * Trạng thái giám sát realtime dùng chung toàn app:
 * danh sách camera, trạng thái camera, khung detections mới nhất, cảnh báo, kết nối, âm thanh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Alert, AlertLevel, AlertStatus, Camera, CameraStatus, ConnectionState, DetectionFrame } from '../types';
import { api, realtime } from '../services';
import { beep, unlockAudio } from '../lib/beep';
import { useAuth } from './AuthContext';
import { useLocalState } from '../hooks/useLocalState';
import { useNow } from '../hooks/useNow';
import { analysisRate, RATE_WINDOW_MS } from '../lib/analysisRate';
import { normalizeIncomingFrame } from '../lib/overlayMap';

interface LiveCtx {
  cameras: Camera[];
  /** true sau lần tải danh sách camera / cảnh báo đầu tiên (kể cả khi rỗng) */
  ready: boolean;
  reloadCameras(): Promise<void>;
  statuses: Record<string, CameraStatus>;
  frames: React.MutableRefObject<Map<string, DetectionFrame>>;
  /** thời điểm nhận các gói detections gần đây của từng camera (đo tốc độ phân tích) */
  detTimes: React.MutableRefObject<Map<string, number[]>>;
  /** thời điểm bắt đầu nhận dữ liệu của lần kết nối hiện tại */
  detSince: React.MutableRefObject<number | undefined>;
  alerts: Alert[];
  connection: { state: ConnectionState; attempt: number; nextRetryMs?: number };
  setAlertStatus(id: string, status: AlertStatus, note?: string): Promise<Alert>;
  soundOn: boolean;
  setSoundOn(v: boolean): void;
  simulateDrop?: () => void;
  /** id cảnh báo mới nhất (để hiệu ứng) */
  lastAlertId: string | null;
  /** Nhịp ~10 Hz khi có detections mới — để chip/OSD cập nhật, không re-render theo từng gói WS. */
  frameTick: number;
}

const Ctx = createContext<LiveCtx | null>(null);
const MAX_LIVE = 300;

export function LiveProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [ready, setReady] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, CameraStatus>>({});
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [connection, setConnection] = useState<LiveCtx['connection']>({ state: realtime.state, attempt: 0 });
  const [soundOn, setSoundOn] = useLocalState('sound', true);
  const [lastAlertId, setLastAlertId] = useState<string | null>(null);
  const [frameTick, setFrameTick] = useState(0);
  const frames = useRef(new Map<string, DetectionFrame>());
  const statusBuf = useRef<CameraStatus[] | null>(null);
  const statusTimer = useRef<number | undefined>(undefined);
  const tickTimer = useRef<number | undefined>(undefined);
  const detTimes = useRef(new Map<string, number[]>());
  const detSince = useRef<number | undefined>(undefined);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  const reloadCameras = useCallback(async () => {
    setCameras(await api.cameras.list());
  }, []);

  useEffect(() => {
    setReady(false);
    const boot = Promise.all([
      reloadCameras().catch(() => setCameras([])),
      api.alerts.recent(MAX_LIVE).then(setAlerts).catch(() => setAlerts([])),
      api.cameras.status().then((l) => setStatuses(Object.fromEntries(l.map((s) => [s.cameraId, s])))).catch(() => {}),
    ]).finally(() => setReady(true));
    void boot;

    const offs = [
      realtime.on('detections', (f) => {
        const t = Date.now();
        frames.current.set(f.cameraId, { ...normalizeIncomingFrame(f), receivedAt: t });
        let l = detTimes.current.get(f.cameraId);
        if (!l) detTimes.current.set(f.cameraId, (l = []));
        l.push(t);
        while (l.length && t - l[0] > RATE_WINDOW_MS) l.shift();
        // Giới hạn re-render UI ~10 Hz, không setState từng gói.
        if (tickTimer.current == null) {
          tickTimer.current = window.setTimeout(() => {
            tickTimer.current = undefined;
            setFrameTick((n) => n + 1);
          }, 100);
        }
      }),
      realtime.on('camera_status', (l) => {
        statusBuf.current = l;
        if (statusTimer.current != null) return;
        statusTimer.current = window.setTimeout(() => {
          statusTimer.current = undefined;
          const v = statusBuf.current;
          if (v) setStatuses(Object.fromEntries(v.map((s) => [s.cameraId, s])));
        }, 100);
      }),
      realtime.on('alert', (a) => {
        setAlerts((l) => [a, ...l].slice(0, MAX_LIVE));
        setLastAlertId(a.id);
        if (soundRef.current && a.level === 'cao') beep('cao');
      }),
      realtime.on('alert_update', (a) => setAlerts((l) => l.map((x) => (x.id === a.id ? a : x)))),
      realtime.on('connection', (c) => {
        setConnection(c);
        if (c.state === 'connected') detSince.current = Date.now();
        else {
          frames.current.clear();
          detTimes.current.clear();
          detSince.current = undefined;
        }
      }),
    ];
    realtime.connect(token ?? undefined);
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    return () => {
      offs.forEach((o) => o());
      realtime.disconnect();
      window.removeEventListener('pointerdown', unlock);
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
      if (tickTimer.current) window.clearTimeout(tickTimer.current);
    };
  }, [token, reloadCameras]);

  const setAlertStatus = useCallback(async (id: string, status: AlertStatus, note?: string) => {
    const a = await api.alerts.updateStatus(id, status, note);
    setAlerts((l) => l.map((x) => (x.id === a.id ? a : x)));
    return a;
  }, []);

  const value = useMemo<LiveCtx>(
    () => ({
      cameras,
      ready,
      reloadCameras,
      statuses,
      frames,
      detTimes,
      detSince,
      alerts,
      connection,
      setAlertStatus,
      soundOn,
      setSoundOn,
      simulateDrop: realtime.simulateDrop ? () => realtime.simulateDrop!() : undefined,
      lastAlertId,
      frameTick,
    }),
    [cameras, ready, reloadCameras, statuses, alerts, connection, setAlertStatus, soundOn, setSoundOn, lastAlertId, frameTick],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLive() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useLive ngoài LiveProvider');
  return c;
}

/** Cảnh báo "đang mở" của camera: chưa xử lý và còn mới (để tô màu mức + nhãn đầy đủ cho thí sinh/vật thể đó) */
export function activeFlags(alerts: Alert[], cameraId: string, now = Date.now(), windowMs = 60000) {
  const objs = new Set<string>();
  const tracks = new Set<number>();
  const objLevel = new Map<string, AlertLevel>();
  const trackLevel = new Map<number, AlertLevel>();
  const rank = { cao: 0, trung_binh: 1, thong_tin: 2 } as const;
  const keep = <K,>(m: Map<K, AlertLevel>, k: K, l: AlertLevel) => {
    const cur = m.get(k);
    if (!cur || rank[l] < rank[cur]) m.set(k, l);
  };
  let high = false;
  for (const a of alerts) {
    if (a.cameraId !== cameraId || a.status !== 'moi' || now - a.ts > windowMs) continue;
    if (a.objectId) {
      objs.add(a.objectId);
      keep(objLevel, a.objectId, a.level);
    }
    // mọi mức (kể cả Thông tin) đều đánh dấu thí sinh – khung người viền theo màu mức
    if (a.trackId != null && a.trackId >= 0) {
      // cảnh báo cấp phòng (vd không thấy giám thị) không có thí sinh để tô
      tracks.add(a.trackId);
      keep(trackLevel, a.trackId, a.level);
    }
    if (a.level === 'cao') high = true;
  }
  return { objs, tracks, high, objLevel, trackLevel };
}

/** Tốc độ phân tích (kết quả/giây) của camera, cập nhật mỗi giây; null = chưa có kết quả trong ~5 giây gần nhất. */
export function useAnalysisRate(cameraId: string | undefined): number | null {
  const { detTimes, detSince } = useLive();
  const now = useNow(1000);
  return cameraId ? analysisRate(detTimes.current.get(cameraId), detSince.current, now) : null;
}

/** Độ trễ của kết quả phân tích mới nhất (now - frameTs), null = chưa có khung. */
export function useFrameLag(cameraId: string | undefined): number | null {
  const { frames } = useLive();
  const now = useNow(1000);
  if (!cameraId) return null;
  const f = frames.current.get(cameraId);
  if (!f) return null;
  return now - (f.frameTs ?? f.ts);
}
