/**
 * Gửi hình từ camera trên chính máy đang mở CMC AI (vd. DroidCam Video) về backend, qua trình duyệt.
 * Dùng khi OpenCV ở backend không mở được webcam nhưng trình duyệt thì mở được.
 * Đi đúng đường của trang /dt (camera loại "phone", đẩy JPEG qua WS /ws/cameras/{id}/push, dự phòng HTTP).
 * Lưu danh sách vào localStorage để tự chạy lại khi tải lại trang (Chrome nhớ quyền camera cho localhost).
 */
const KEY = 'cmcai.localPush.v1';
const MAX_W = 960;
const FPS = 5;
const QUALITY = 0.72;

export type LocalPushEntry = { cameraId: string; token: string; deviceId: string; label: string };
export type LocalPushState = { cameraId: string; label: string; running: boolean; sent: number; error: string };

type Runner = {
  e: LocalPushEntry;
  stream: MediaStream | null;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ws: WebSocket | null;
  timer?: number;
  sent: number;
  error: string;
  busy: boolean;
};

const runners = new Map<string, Runner>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function load(): LocalPushEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function save(list: LocalPushEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function pushUrl(kind: 'ws' | 'http', cameraId: string, token: string) {
  const proto = kind === 'ws' ? (location.protocol === 'https:' ? 'wss:' : 'ws:') : location.protocol;
  const path = kind === 'ws' ? `/ws/cameras/${encodeURIComponent(cameraId)}/push` : `/api/cameras/${encodeURIComponent(cameraId)}/frame`;
  return `${proto}//${location.host}${path}?token=${encodeURIComponent(token)}`;
}

/** Xin quyền rồi liệt kê camera mà trình duyệt thấy (có tên). */
export async function listBrowserCameras(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Trình duyệt không hỗ trợ camera (cần Chrome/Edge, mở bằng localhost hoặc https).');
  let list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  if (!list.some((d) => d.label)) {
    const warm = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    warm.getTracks().forEach((t) => t.stop());
    list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  }
  return list;
}

async function openDevice(e: LocalPushEntry): Promise<MediaStream> {
  const base = { width: { ideal: 1280 }, height: { ideal: 720 } };
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: e.deviceId }, ...base }, audio: false });
  } catch (err) {
    // deviceId có thể đổi sau khi cắm lại — tìm lại theo tên
    const again = (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && d.label === e.label);
    if (!again) throw err;
    e.deviceId = again.deviceId;
    save(load().map((x) => (x.cameraId === e.cameraId ? { ...x, deviceId: again.deviceId } : x)));
    return navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: again.deviceId }, ...base }, audio: false });
  }
}

function connectWs(r: Runner) {
  try {
    const ws = new WebSocket(pushUrl('ws', r.e.cameraId, r.e.token));
    ws.binaryType = 'arraybuffer';
    ws.onclose = (ev) => {
      if (r.ws === ws) r.ws = null;
      if (ev.code === 4401 || ev.code === 1008) {
        r.error = 'Phiên gửi hình đã hết hạn. Xoá camera này và thêm lại.';
        emit();
      }
    };
    r.ws = ws;
  } catch {
    r.ws = null;
  }
}

async function tick(r: Runner) {
  if (r.busy) return;
  const v = r.video;
  if (v.readyState < 2 || !v.videoWidth) return;
  r.busy = true;
  try {
    const scale = Math.min(1, MAX_W / v.videoWidth);
    const c = r.canvas;
    c.width = Math.max(2, Math.round((v.videoWidth * scale) / 2) * 2);
    c.height = Math.max(2, Math.round((v.videoHeight * scale) / 2) * 2);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((res) => c.toBlob((b) => res(b), 'image/jpeg', QUALITY));
    if (!blob) return;
    if (r.ws && r.ws.readyState === WebSocket.OPEN) {
      r.ws.send(await blob.arrayBuffer());
    } else {
      if (!r.ws || r.ws.readyState === WebSocket.CLOSED) connectWs(r);
      const resp = await fetch(pushUrl('http', r.e.cameraId, r.e.token), { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      if (resp.status === 401 || resp.status === 403) {
        r.error = 'Phiên gửi hình đã hết hạn. Xoá camera này và thêm lại.';
        emit();
        return;
      }
      if (resp.status === 404) {
        stopLocalPush(r.e.cameraId);
        return;
      }
      if (!resp.ok && resp.status !== 204) return;
    }
    r.sent += 1;
    if (r.error) r.error = '';
    if (r.sent === 1 || r.sent % 25 === 0) emit();
  } catch {
    /* mạng chập chờn: thử lại ở khung sau */
  } finally {
    r.busy = false;
  }
}

async function run(e: LocalPushEntry) {
  if (runners.has(e.cameraId)) return;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  const r: Runner = { e, stream: null, video, canvas: document.createElement('canvas'), ws: null, sent: 0, error: '', busy: false };
  runners.set(e.cameraId, r);
  emit();
  try {
    r.stream = await openDevice(e);
    r.stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      r.error = `Mất tín hiệu từ ${e.label}. Mở lại DroidCam Client rồi tải lại trang.`;
      emit();
    });
    video.srcObject = r.stream;
    await video.play().catch(() => {});
    connectWs(r);
    r.timer = window.setInterval(() => void tick(r), 1000 / FPS);
  } catch {
    r.error = `Trình duyệt không mở được ${e.label}. Kiểm tra DroidCam Client đang chạy và cho phép trang dùng camera.`;
  }
  emit();
}

/** Bắt đầu (và nhớ) gửi hình cho một camera. */
export async function startLocalPush(e: LocalPushEntry) {
  save([...load().filter((x) => x.cameraId !== e.cameraId), e]);
  await run(e);
}

export function stopLocalPush(cameraId: string, forget = true) {
  const r = runners.get(cameraId);
  if (r) {
    if (r.timer) window.clearInterval(r.timer);
    try {
      r.ws?.close();
    } catch {
      /* ignore */
    }
    r.stream?.getTracks().forEach((t) => t.stop());
    r.video.srcObject = null;
    runners.delete(cameraId);
  }
  if (forget) save(load().filter((x) => x.cameraId !== cameraId));
  emit();
}

/** Gọi một lần khi vào app: chạy lại các camera đã lưu; bỏ camera không còn tồn tại. */
export function resumeLocalPush(existingCameraIds?: Set<string>) {
  for (const e of load()) {
    if (existingCameraIds && !existingCameraIds.has(e.cameraId)) {
      stopLocalPush(e.cameraId);
      continue;
    }
    void run(e);
  }
}

export function localPushStates(): LocalPushState[] {
  return [...runners.values()].map((r) => ({ cameraId: r.e.cameraId, label: r.e.label, running: !!r.timer && !r.error, sent: r.sent, error: r.error }));
}
export function isLocalPush(cameraId: string) {
  return load().some((x) => x.cameraId === cameraId);
}
export function subscribeLocalPush(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
