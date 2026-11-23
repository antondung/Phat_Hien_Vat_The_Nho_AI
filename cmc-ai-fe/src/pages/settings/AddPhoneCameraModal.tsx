/**
 * Hộp thoại thêm camera điện thoại cho buổi demo: ưu tiên cắm USB (Windows + iPhone / DroidCam),
 * dự phòng quét mã QR (cùng Wi-Fi, không cần cài app), cuối cùng là nhập địa chỉ luồng.
 */
import { useEffect, useRef, useState } from 'react';
import { Cable, Check, CheckCircle2, ClipboardCopy, Info, Loader2, MonitorUp, QrCode, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import { listBrowserCameras, startLocalPush } from '../../lib/localPush';
import QRCode from 'qrcode';
import { api, API_MODE } from '../../services';
import type { ConnectionTestResult, PhoneCameraCreated, WebcamInfo } from '../../services/api';
import { hasNoPicture, isDroidCamName, preferredWebcam, rankWebcams, webcamLabel, webcamUrl } from '../../lib/webcams';
import { DROIDCAM_GREEN_HINT, hintIfSolidFrame } from '../../lib/solidFrame';
import type { CameraPosition } from '../../types';
import { useLive } from '../../context/LiveContext';
import { useToast } from '../../context/ToastContext';
import { Field, Toggle } from '../../components/ui/Controls';
import { Modal } from '../../components/ui/Modal';

type Tab = 'usb' | 'qr' | 'addr';
const TABS: { k: Tab; label: string; hint: string }[] = [
  { k: 'usb', label: 'Cắm dây USB', hint: 'Chắc nhất' },
  { k: 'qr', label: 'Quét mã QR', hint: 'Dự phòng' },
  { k: 'addr', label: 'Nhập địa chỉ camera', hint: '' },
];

const IP_WEBCAM_URL = 'http://localhost:8080/video';
const REAL = API_MODE === 'real';

const FALLBACK_CAMS: WebcamInfo[] = [0, 1, 2, 3].map((i) => ({
  index: i,
  name: `Webcam ${i}`,
  url: `webcam://${i}`,
}));

function defaultQrHost(): string {
  const env = String(import.meta.env.VITE_PHONE_LAN_HOST || '').replace(/\/$/, '');
  if (env && !isLoopback(env)) return env;
  return window.location.origin;
}

function isLoopback(origin: string): boolean {
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '::1';
  } catch {
    return false;
  }
}

export function AddPhoneCameraModal({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated?(cameraId: string): void }) {
  const { cameras, reloadCameras } = useLive();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('usb');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('Demo');
  const [position, setPosition] = useState<CameraPosition>('truoc');
  const [enabled, setEnabled] = useState(true);
  const [cams, setCams] = useState<WebcamInfo[]>([]);
  const [camsFromApi, setCamsFromApi] = useState(false);
  const [camsEmpty, setCamsEmpty] = useState(false);
  const [loadingCams, setLoadingCams] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [selected, setSelected] = useState<string>('webcam://0');
  const [url, setUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  const [solidHint, setSolidHint] = useState('');
  const [saving, setSaving] = useState(false);
  const [androidOpen, setAndroidOpen] = useState(false);
  const [hasPreview, setHasPreview] = useState(false);
  const [created, setCreated] = useState<PhoneCameraCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrData, setQrData] = useState('');
  const [qrHost, setQrHost] = useState(() => defaultQrHost());
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [bCams, setBCams] = useState<MediaDeviceInfo[]>([]);
  const [bDev, setBDev] = useState('');
  const [bBusy, setBBusy] = useState(false);
  const [bErr, setBErr] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewStream = useRef<MediaStream | null>(null);

  const rooms = [...new Set(cameras.map((c) => c.room))].sort();
  const nextName = `ĐT · CAM ${String(cameras.filter((c) => c.sourceType === 'phone' || c.sourceType === 'webcam').length + 1).padStart(2, '0')}`;

  const stopPreview = () => {
    const streams: MediaStream[] = [];
    if (previewStream.current) streams.push(previewStream.current);
    const attached = videoRef.current?.srcObject;
    if (attached instanceof MediaStream && attached !== previewStream.current) streams.push(attached);
    for (const s of streams) s.getTracks().forEach((t) => { t.stop(); t.enabled = false; });
    previewStream.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasPreview(false);
  };

  const reset = () => {
    stopPreview();
    setTab('usb');
    setName('');
    setRoom('Demo');
    setPosition('truoc');
    setEnabled(true);
    setSelected('webcam://0');
    setUrl('');
    setTest(null);
    setSolidHint('');
    setCreated(null);
    setCopied(false);
    setQrData('');
    setQrHost(defaultQrHost());
    setErrs({});
    setAndroidOpen(false);
    setCamsEmpty(false);
    setBCams([]);
    setBDev('');
    setBErr('');
  };

  const findBrowserCams = async () => {
    setBBusy(true);
    setBErr('');
    try {
      stopPreview();
      const list = await listBrowserCameras();
      setBCams(list);
      const pick = list.find((d) => isDroidCamName(d.label) && /video/i.test(d.label)) ?? list.find((d) => isDroidCamName(d.label)) ?? list[0];
      setBDev(pick?.deviceId || '');
      if (!list.length) setBErr('Trình duyệt không thấy camera nào. Mở DroidCam Client, bấm Start cho có hình, rồi thử lại.');
    } catch (e) {
      setBErr((e as Error).name === 'NotAllowedError' ? 'Trình duyệt đang chặn camera. Bấm biểu tượng camera trên thanh địa chỉ, chọn Cho phép, rồi thử lại.' : (e as Error).message || 'Không mở được camera trên trình duyệt.');
    } finally {
      setBBusy(false);
    }
  };

  const saveViaBrowser = async () => {
    if (!validateMeta()) return;
    const dev = bCams.find((d) => d.deviceId === bDev);
    if (!dev) {
      setBErr('Chọn một camera trong danh sách trước.');
      return;
    }
    setBBusy(true);
    stopPreview();
    try {
      const r = await api.cameras.createPhone({ name: name.trim(), room: room.trim(), position });
      await startLocalPush({ cameraId: r.camera.id, token: r.pushToken, deviceId: dev.deviceId, label: dev.label || 'camera' });
      await reloadCameras();
      toast(`Đã thêm camera. Trình duyệt đang gửi hình từ ${dev.label || 'camera'} — giữ tab CMC AI này mở.`);
      onCreated?.(r.camera.id);
      onClose();
    } catch (err) {
      setBErr((err as Error).message || 'Không tạo được camera');
    } finally {
      setBBusy(false);
    }
  };

  const loadWebcams = async () => {
    setLoadingCams(true);
    setCamErr('');
    try {
      const list = rankWebcams(await api.cameras.listWebcams());
      if (list.length) {
        setCams(list);
        setCamsFromApi(true);
        setCamsEmpty(false);
        const prefer = preferredWebcam(list) ?? list[0];
        setSelected(webcamUrl(prefer));
      } else {
        setCams(FALLBACK_CAMS);
        setCamsFromApi(false);
        setCamsEmpty(true);
      }
    } catch (e) {
      setCams(FALLBACK_CAMS);
      setCamsFromApi(false);
      setCamsEmpty(false);
      setCamErr((e as Error).message || 'Không lấy được danh sách webcam từ máy chủ — dùng bộ chọn 0–3.');
    } finally {
      setLoadingCams(false);
    }
  };

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    setName((n) => n || nextName);
    void loadWebcams();
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startBrowserPreview = async (labelHint: string) => {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      // xin quyền một lần để enumerateDevices trả về tên thiết bị
      const warm = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      const hit =
        videos.find((d) => d.label && labelHint && d.label.toLowerCase().includes(labelHint.toLowerCase().replace(/webcam\s*/i, '').trim())) ??
        videos.find((d) => isDroidCamName(d.label));
      warm.getTracks().forEach((t) => t.stop());
      if (!hit) return false;
      const s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: hit.deviceId } }, audio: false });
      stopPreview();
      previewStream.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        void videoRef.current.play().catch(() => {});
      }
      setHasPreview(true);
      return true;
    } catch {
      return false;
    }
  };

  const currentSrc = () => {
    if (tab === 'usb') return { sourceType: 'webcam' as const, sourceUrl: selected };
    if (tab === 'addr') {
      const u = url.trim();
      // BE đọc MJPEG/RTSP ở nhánh không phải webcam/file; README yêu cầu sourceType "rtsp" cả khi URL là http(s)://.../video
      return { sourceType: 'rtsp' as const, sourceUrl: u };
    }
    return { sourceType: 'phone' as const, sourceUrl: 'push', cameraId: created?.camera.id };
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setSolidHint('');
    try {
      const src = currentSrc();
      if (tab === 'addr' && !src.sourceUrl) {
        setTest({ ok: false, message: 'Nhập địa chỉ luồng trước khi kiểm tra.' });
        return;
      }
      const r = await api.cameras.testConnection(src);
      setTest(r); // hiện nguyên văn message của backend
      let hint = '';
      const snap = r.snapshot || r.snapshotUrl || r.preview;
      if (snap) {
        try {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            im.onload = () => resolve();
            im.onerror = () => reject(new Error('snap'));
            im.src = snap.startsWith('data:') || /^https?:/i.test(snap) || snap.startsWith('/') ? snap : `data:image/jpeg;base64,${snap}`;
          });
          hint = hintIfSolidFrame(im) || '';
        } catch { /* bỏ qua nếu không đọc được ảnh */ }
      }
      if (!hint && (r.hasPicture === false || /xanh|một màu|mot mau|solid|không có hình|khong co hinh/i.test(r.message || ''))) hint = DROIDCAM_GREEN_HINT;
      setSolidHint(hint);
      // Real: không tự getUserMedia — DroidCam ra khung xanh nếu trình duyệt tranh thiết bị với backend.
      // Mock: xem trước trên trình duyệt vẫn tiện cho buổi demo không có BE.
      if (!REAL && tab === 'usb' && r.ok) {
        const cam = cams.find((c) => webcamUrl(c) === selected);
        await startBrowserPreview(cam?.name || '');
      }
    } finally {
      setTesting(false);
    }
  };

  const validateMeta = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Nhập tên camera';
    if (!room.trim()) e.room = 'Nhập phòng thi';
    setErrs(e);
    return !Object.keys(e).length;
  };

  const saveUsbOrAddr = async () => {
    if (!validateMeta()) return;
    const src = currentSrc();
    if (tab === 'addr') {
      if (!src.sourceUrl) {
        setErrs((e) => ({ ...e, url: 'Nhập địa chỉ luồng' }));
        return;
      }
      if (!/^(rtsps?:\/\/|https?:\/\/)/i.test(src.sourceUrl)) {
        setErrs((e) => ({ ...e, url: 'Địa chỉ phải bắt đầu bằng rtsp://, http:// hoặc https://' }));
        return;
      }
    }
    setSaving(true);
    stopPreview();
    try {
      const cam = await api.cameras.create({
        name: name.trim(),
        room: room.trim(),
        position,
        sourceType: src.sourceType,
        sourceUrl: src.sourceUrl,
        enabled,
      });
      await reloadCameras();
      toast('Đã thêm camera điện thoại');
      onCreated?.(cam.id);
      onClose();
    } catch (err) {
      toast((err as Error).message || 'Không lưu được', 'error');
    } finally {
      setSaving(false);
    }
  };

  const phoneUrl = (host: string, c: PhoneCameraCreated) => {
    const base = host.replace(/\/$/, '');
    const q = new URLSearchParams({ c: c.camera.id, t: c.pushToken });
    return `${base}/dt?${q.toString()}`;
  };

  const copyLink = async (c: PhoneCameraCreated) => {
    const text = phoneUrl(qrHost, c);
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (!ok) throw new Error('copy');
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast('Không sao chép được liên kết', 'error');
    }
  };

  const makeQr = async (c: PhoneCameraCreated, host: string) => {
    const href = phoneUrl(host, c);
    try {
      setQrData(await QRCode.toDataURL(href, { margin: 1, width: 280, color: { dark: '#1F2328', light: '#FFFFFF' }, errorCorrectionLevel: 'M' }));
    } catch {
      setQrData('');
    }
  };

  const createQr = async () => {
    if (!validateMeta()) return;
    setSaving(true);
    try {
      const r = await api.cameras.createPhone({ name: name.trim(), room: room.trim(), position });
      setCreated(r);
      setCopied(false);
      await makeQr(r, qrHost);
      await reloadCameras();
      toast('Đã tạo camera. Quét mã QR bằng điện thoại để bắt đầu gửi hình.');
      onCreated?.(r.camera.id);
    } catch (err) {
      toast((err as Error).message || 'Không tạo được camera', 'error');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (created) void makeQr(created, qrHost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrHost]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} title="Thêm camera điện thoại" width={800} className="phone-add-modal" footer={tabFooter()}>
      <div className="phone-add">
        <p className="muted small phone-add-tip">
          Nên thử cả <strong>cắm dây USB</strong> và <strong>quét mã QR</strong> một lần trước buổi demo, để còn cách dự phòng nếu một bên trục trặc.
        </p>
        <div className="tabs" role="tablist" aria-label="Cách thêm camera điện thoại">
          {TABS.map((t) => (
            <button key={t.k} type="button" role="tab" aria-selected={tab === t.k} className={tab === t.k ? 'active' : ''} onClick={() => { setTab(t.k); setTest(null); setSolidHint(''); stopPreview(); }}>
              {t.k === 'usb' ? <Cable size={14} /> : t.k === 'qr' ? <QrCode size={14} /> : <Wifi size={14} />}
              {t.label}
              {t.hint ? <span className="tab-hint">{t.hint}</span> : null}
            </button>
          ))}
        </div>

        {tab === 'usb' && (
          <div className="phone-tab">
            <p className="phone-note">
              <Info size={16} aria-hidden />
              <span>
                Điện thoại phải cắm vào <strong>cùng máy đang chạy backend CMC AI</strong> (máy cài DroidCam Client) — không phải một máy khác.
              </span>
            </p>
            <ol className="phone-steps">
              <li>
                Cài <strong>DroidCam</strong> trên iPhone (App Store). Trên máy Windows chạy backend, cài <strong>DroidCam Client</strong> và{' '}
                <strong>Apple Devices</strong> (hoặc iTunes).
              </li>
              <li>Cắm dây USB, mở DroidCam trên iPhone, trong <strong>DroidCam Client</strong> (bản mới kiểu OBS) chọn kết nối USB — nguồn trong Client có thể hiện tên điện thoại, ví dụ “anton [USB]”.</li>
              <li>Ở danh sách bên dưới, chọn webcam ảo tên <strong>DroidCam Video</strong> (hoặc tên có chữ DroidCam), rồi bấm <strong>Lưu</strong>.</li>
            </ol>
            <button type="button" className="link-btn" onClick={() => setAndroidOpen((v) => !v)}>
              {androidOpen ? 'Ẩn hướng dẫn Android' : 'Đang dùng Android?'}
            </button>
            {androidOpen && (
              <div className="phone-android muted small">
                <p>Cài DroidCam hoặc Iriun trên điện thoại và trên máy chạy backend, bật Gỡ lỗi USB, cắm dây — webcam sẽ xuất hiện như trên.</p>
                <p>
                  Hoặc dùng IP Webcam: trên máy chạy backend chạy <code>adb forward tcp:8080 tcp:8080</code>, rồi sang tab “Nhập địa chỉ camera” và điền{' '}
                  <code>{IP_WEBCAM_URL}</code>.
                </p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTab('addr'); setUrl(IP_WEBCAM_URL); setTest(null); setSolidHint(''); }}>
                  Điền địa chỉ IP Webcam qua cáp
                </button>
              </div>
            )}
            {metaFields()}
            <div className="phone-cams-head">
              <strong>Webcam trên máy chạy backend</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadWebcams()} disabled={loadingCams}>
                {loadingCams ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Làm mới
              </button>
            </div>
            {camsEmpty && (
              <p className="phone-note">
                <Info size={16} aria-hidden />
                <span>
                  Chưa thấy webcam. Hãy mở <strong>DroidCam Client</strong> trên máy chạy backend, <strong>để cửa sổ chạy</strong>, chọn kết nối USB, rồi bấm <strong>Làm mới</strong>.
                  Webcam ảo trên Windows thường tên <strong>DroidCam Video</strong> (không phải tên nguồn trong Client, ví dụ “anton [USB]”).
                </span>
              </p>
            )}
            {!camsFromApi && !camsEmpty && (
              <p className="muted small">
                {camErr || (REAL ? 'Máy chủ chưa trả danh sách webcam — chọn thiết bị 0–3 rồi bấm Kiểm tra. Nếu đang dùng DroidCam, hãy mở DroidCam Client, để chạy, rồi bấm Làm mới.' : 'Chế độ mô phỏng: danh sách mẫu (có DroidCam).')}
              </p>
            )}
            {camsEmpty && (
              <p className="muted small">Có thể thử thiết bị 0–3 bên dưới rồi bấm Kiểm tra, nếu danh sách máy chủ vẫn trống.</p>
            )}
            {cams.some((c) => hasNoPicture(c)) && (
              <p className="phone-note">
                <Info size={16} aria-hidden />
                <span>Lúc dò, một số thiết bị <strong>chưa thấy hình</strong>. Kết quả này chỉ để tham khảo: anh vẫn chọn được mọi thiết bị, bấm <strong>Kiểm tra</strong> để biết chắc (nên thử <strong>DroidCam Video</strong> trước). Nếu vẫn không được, dùng địa chỉ Wi-Fi <code>http://IP:4747/video</code> hoặc tab Quét mã QR.</span>
              </p>
            )}
            <ul className="phone-cam-list">
              {cams.map((c) => {
                const u = webcamUrl(c);
                const on = selected === u;
                return (
                  <li key={u}>
                    <button type="button" className={`phone-cam ${on ? 'on' : ''} ${c.inUse ? 'busy' : ''}`} onClick={() => { setSelected(u); setTest(null); setSolidHint(''); stopPreview(); }} title={hasNoPicture(c) ? 'Lúc dò chưa thấy hình. Vẫn chọn được, bấm Kiểm tra để biết chắc.' : c.inUse ? 'Thiết bị đang được dùng. Vẫn chọn được, bấm Kiểm tra để biết chắc.' : undefined}>
                      <span className="phone-cam-name">{webcamLabel(c)}</span>
                      <span className="muted small">
                        {u}
                        {c.backend ? ` · ${c.backend}` : ''}
                        {c.width && c.height ? ` · ${c.width}×${c.height}` : ''}
                        {c.inUse ? ' · đang dùng' : ''}
                        {hasNoPicture(c) ? ' · chưa thấy hình lúc dò' : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {testAndPreview()}
            {REAL && browserPush()}
          </div>
        )}

        {tab === 'qr' && (
          <div className="phone-tab">
            {(isLoopback(qrHost) || !/^https:/i.test(qrHost)) && (
              <p className="phone-note">
                <Info size={16} aria-hidden />
                <span>
                  Mã QR đang trỏ tới <code>{qrHost}</code>, điện thoại {isLoopback(qrHost) ? <><strong>không mở được</strong> địa chỉ localhost của máy tính</> : <>mở được trang nhưng <strong>iPhone sẽ chặn camera</strong> vì không phải https</>}.
                  Hãy tắt lệnh đang chạy, chạy <code>npm run dev:phone</code>, rồi mở CMC AI bằng địa chỉ <code>https://IP-LAN:5173</code> mà lệnh in ra. Lần đầu Windows hỏi tường lửa cho Node.js thì chọn <strong>Allow</strong> (mạng Private). Cách nhanh hơn: dùng app DroidCam qua Wi-Fi, nhập <code>http://IP-điện-thoại:4747/video</code> ở tab nhập địa chỉ.
                </span>
              </p>
            )}
            {!created ? (
              <>
                <p>
                  Cách dự phòng, <strong>không cần cài thêm app</strong>: điện thoại và máy chạy CMC AI cùng một mạng Wi-Fi. Mở liên kết bằng{' '}
                  <strong>Safari</strong>, chấp nhận chứng chỉ một lần nếu trình duyệt hỏi, rồi cho phép dùng camera.
                </p>
                {metaFields()}
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => void createQr()}>
                  {saving ? <Loader2 size={16} className="spin" /> : <QrCode size={16} />} Tạo mã QR
                </button>
              </>
            ) : (
              <div className="phone-qr-cols">
                <div className="phone-qr-code">
                  {qrData ? <img src={qrData} alt="Mã QR mở camera điện thoại" width={200} height={200} /> : <p className="muted">Không tạo được ảnh mã QR — dùng nút Sao chép liên kết.</p>}
                </div>
                <div className="phone-qr-side">
                  <ol className="phone-steps">
                    <li>Mở <strong>Safari</strong> trên iPhone (cùng Wi-Fi với máy chạy CMC AI) và quét mã, hoặc bấm <strong>Sao chép liên kết</strong> rồi dán trên điện thoại.</li>
                    <li>Chấp nhận chứng chỉ một lần nếu trình duyệt hỏi, rồi cho phép dùng camera.</li>
                    <li>Bấm <strong>Bắt đầu phát</strong> và hướng máy ra phòng thi.</li>
                  </ol>
                  <Field
                    label="Địa chỉ trên mã QR"
                    hint={
                      isLoopback(qrHost)
                        ? 'Điện thoại không kết nối được tới localhost của máy tính. Sửa thành địa chỉ LAN (và nên dùng https://) rồi mã sẽ được vẽ lại.'
                        : 'Nếu mở CMC AI bằng https, giữ nguyên. Điện thoại phải truy cập được địa chỉ này trên cùng Wi-Fi.'
                    }
                  >
                    <input className="input mono" value={qrHost} onChange={(e) => setQrHost(e.target.value.trim())} />
                  </Field>
                  <button type="button" className="btn btn-ghost btn-sm qr-copy" onClick={() => void copyLink(created)}>
                    {copied ? <Check size={16} /> : <ClipboardCopy size={16} />}
                    {copied ? 'Đã sao chép' : 'Sao chép liên kết'}
                  </button>
                  <p className="muted small">
                    Hết hạn sau {Math.max(1, Math.round(created.expiresInSec / 3600))} giờ. Camera đã được lưu; khi hết hạn hãy tạo camera mới để lấy mã khác (backend hiện chưa cấp lại token cho camera cũ).
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'addr' && (
          <div className="phone-tab">
            <p className="muted small">
              Dùng khi đã có sẵn địa chỉ luồng RTSP hoặc HTTP (IP Webcam, DroidCam Wi-Fi…). Nếu dùng IP Webcam <strong>qua cáp USB</strong>, trên máy chạy
              backend hãy chạy <code>adb forward tcp:8080 tcp:8080</code> rồi dùng địa chỉ bên dưới — điện thoại vẫn phải cắm vào <strong>cùng máy chạy backend</strong>.
            </p>
            {metaFields()}
            <Field label="Địa chỉ luồng" error={errs.url}>
              <input
                className="input mono"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setTest(null); setSolidHint(''); }}
                placeholder="http://localhost:8080/video hoặc rtsp://192.168.1.20:554/stream1"
              />
            </Field>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setUrl(IP_WEBCAM_URL); setTest(null); setSolidHint(''); }}>
              Điền {IP_WEBCAM_URL}
            </button>
            {testAndPreview()}
          </div>
        )}
      </div>
    </Modal>
  );

  function metaFields() {
    return (
      <div className="form-grid">
        <Field label="Tên camera" error={errs.name}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="VD: ĐT · CAM 01" />
        </Field>
        <Field label="Phòng thi" error={errs.room}>
          <input className="input" list="phone-room-list" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="VD: Demo" />
          <datalist id="phone-room-list">
            {rooms.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </Field>
        <Field label="Vị trí đặt">
          <div className="row gap-8">
            <label className="radio">
              <input type="radio" checked={position === 'truoc'} onChange={() => setPosition('truoc')} /> Phía trước
            </label>
            <label className="radio">
              <input type="radio" checked={position === 'sau'} onChange={() => setPosition('sau')} /> Phía sau
            </label>
          </div>
        </Field>
        {tab !== 'qr' && (
          <div className="span-all">
            <Toggle checked={enabled} onChange={setEnabled} label="Bật camera" />
          </div>
        )}
      </div>
    );
  }

  function testAndPreview() {
    return (
      <div className="phone-preview">
        <button type="button" className="btn btn-ghost" disabled={testing} onClick={() => void runTest()}>
          {testing ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} Kiểm tra
        </button>
        {test && (
          <div className={`test-result ${test.ok && !solidHint ? 'ok' : 'fail'}`}>
            {test.ok && !solidHint ? <CheckCircle2 size={18} /> : <Smartphone size={18} />}
            <div>
              <strong>{test.ok && !solidHint ? 'Kết nối thành công' : 'Kết nối thất bại'}</strong>
              <span>{test.message}</span>
              {solidHint && <span className="small">{solidHint}</span>}
              {test.ok && !solidHint && (
                <span className="small muted">
                  {[test.resolution, test.fps ? `${Math.round(test.fps)} FPS` : '', test.latencyMs ? `độ trễ ${test.latencyMs} ms` : ''].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
          </div>
        )}
        {tab === 'usb' && REAL && (
          <>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                if (hasPreview) {
                  stopPreview();
                  return;
                }
                const cam = cams.find((c) => webcamUrl(c) === selected);
                void startBrowserPreview(cam?.name || '').then((ok) => {
                  if (!ok) toast('Không mở được xem trước trên trình duyệt. Dùng kết quả Kiểm tra từ backend, hoặc xem Camera đơn sau khi Lưu.', 'error');
                  else {
                    window.setTimeout(() => {
                      const v = videoRef.current;
                      if (!v) return;
                      const h = hintIfSolidFrame(v);
                      if (h) setSolidHint(h);
                    }, 600);
                  }
                });
              }}
            >
              {hasPreview ? 'Dừng xem trước trên trình duyệt' : 'Xem trước trên trình duyệt'}
            </button>
            <p className="muted small">
              Kết quả Kiểm tra là của máy chạy backend. Không tự mở camera trên trình duyệt vì DroidCam có thể ra khung xanh nếu trình duyệt và backend cùng đọc thiết bị.
              Chỉ dùng “Xem trước trên trình duyệt” khi backend chưa mở webcam (trước khi Lưu). Sau khi Lưu, xem luồng thật ở Camera đơn.
            </p>
          </>
        )}
        <video ref={videoRef} className="phone-preview-video" muted playsInline autoPlay style={{ display: hasPreview ? 'block' : 'none' }} />
        {hasPreview && !REAL && <p className="muted small">Ảnh xem trước từ webcam trên máy đang mở trang này (khớp khi FE và backend chạy cùng máy).</p>}
        {hasPreview && REAL && <p className="muted small">Đang xem trước trên trình duyệt — nhớ dừng trước khi Lưu nếu backend cần độc quyền webcam (DroidCam).</p>}
      </div>
    );
  }

  function browserPush() {
    return (
      <div className="phone-browser-push">
        <div className="phone-cams-head">
          <strong>Kiểm tra báo không mở được? Gửi hình qua trình duyệt</strong>
        </div>
        <p className="muted small">
          Dùng khi app Camera của Windows hoặc trình duyệt thấy hình DroidCam nhưng backend không đọc được. Chrome trên máy này tự mở <strong>DroidCam Video</strong> và gửi hình về backend, giống trang quét mã QR.
          Giữ tab CMC AI mở trong lúc giám sát (thu nhỏ tab thì chỉ còn khoảng 1 khung/giây).
        </p>
        {!bCams.length ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={bBusy} onClick={() => void findBrowserCams()}>
            {bBusy ? <Loader2 size={14} className="spin" /> : <MonitorUp size={14} />} Tìm camera trên trình duyệt
          </button>
        ) : (
          <div className="row gap-8 phone-browser-row">
            <select className="input" value={bDev} onChange={(e) => setBDev(e.target.value)} aria-label="Camera trên trình duyệt">
              {bCams.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" disabled={bBusy || !bDev} onClick={() => void saveViaBrowser()}>
              {bBusy ? <Loader2 size={14} className="spin" /> : <MonitorUp size={14} />} Lưu và gửi hình qua trình duyệt
            </button>
          </div>
        )}
        {bErr && <p className="field-error small">{bErr}</p>}
      </div>
    );
  }

  function tabFooter() {
    if (tab === 'qr') {
      return (
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            {created ? 'Đóng' : 'Huỷ'}
          </button>
        </>
      );
    }
    return (
      <>
        <button className="btn btn-ghost" onClick={onClose}>
          Huỷ
        </button>
        <button className="btn btn-primary" onClick={() => void saveUsbOrAddr()} disabled={saving}>
          {saving && <Loader2 size={16} className="spin" />} Lưu
        </button>
      </>
    );
  }
}
