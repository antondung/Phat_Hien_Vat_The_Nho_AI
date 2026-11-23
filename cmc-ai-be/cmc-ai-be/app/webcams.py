"""Liệt kê và mở webcam trên máy chạy BE — Windows (DirectShow + Media Foundation) và Linux (V4L2).

Địa chỉ nguồn (Camera.sourceUrl, sourceType=webcam):
  webcam://N                         chỉ số, tương thích cũ. Windows: thử DirectShow rồi MSMF.
  webcam://dshow/N                   DirectShow, chỉ số N — cùng thứ tự
                                     pygrabber FilterGraph().get_input_devices() (trùng CAP_DSHOW).
                                     Nếu pygrabber lỗi: thứ tự video của ffmpeg -list_devices.
  webcam://msmf/N                    Media Foundation, chỉ số N (MFEnumDeviceSources VIDCAP = OpenCV MSMF)
  webcam://dshow/name/<tên mã hoá>   Đổi tên → chỉ số (pygrabber, rồi ffmpeg), mở CAP_DSHOW(int).
                                     Không resolve được: thử các chỉ số 0..9 chưa có tên.
                                     OpenCV CAP_DSHOW chỉ nhận chỉ số nguyên — không truyền chuỗi tên.
  webcam://msmf/name/<tên mã hoá>    Đổi tên → chỉ số VIDCAP, rồi các chỉ số MSMF 0..9 chưa có tên.
  0  |  /dev/video0                  vẫn nhận (cũ)

Thứ tự mở trên Windows (khi bước trước thất bại hoặc mở được nhưng không đọc được khung):
  1) OpenCV CAP_DSHOW theo chỉ số   2) OpenCV CAP_MSMF (chỉ số VIDCAP, hoặc dò 0..5 nếu enum MF lỗi)
  3) pygrabber FilterGraph (add_video_input_device + sample grabber, luồng BGR)
  4) ffmpeg -f dshow -i video=<tên> -f image2pipe -vcodec mjpeg  (cú pháp ffmpeg, không phải CAP_DSHOW)

Liệt kê luôn đặt url = webcam://dshow/N hoặc webcam://msmf/N khi đã biết chỉ số
(không dùng url theo tên làm url chính). urlByName vẫn có để FE tham chiếu.
Dù enum MF lỗi, vẫn dò cv2 MSMF chỉ số 0..5 (đóng trước khi mở cái sau).
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, unquote

import cv2
import numpy as np

IS_WIN = os.name == "nt"

# MSDN mfidl.h — chỉ dùng VIDCAP, không dùng AUDCAP.
# MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE
GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE = "c60ac5fe-672c-47c7-90a8-8a9ed049c4ae"
# MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID (video capture)
GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP = "8ac3587a-4ae7-42d8-99e0-0d4daefc0b3f"
# MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP_GUID (audio — KHÔNG đưa vào enum)
GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP = "9ea10230-8be4-48e4-93d3-387db36dcc1c"
# MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME (mfidl.h) — GUID cũ 60d0dd49-… là sai,
# khiến GetAllocatedString trả MF_E_ATTRIBUTENOTFOUND và ctypes HRESULT hủy cả enum.
GUID_MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME = "60d0e559-52f8-4fa2-bbce-acdb34a8ec01"

UNIFORM_MSG = (
    'không có hình (khung màu đặc). Với DroidCam bản mới hãy chọn thiết bị '
    '"DroidCam Video"; DroidCam Client phải đang kết nối và đang hiện hình video.'
)
DROIDCAM_UNIFORM_MSG = (
    'không có hình (khung màu đặc). DroidCam Client phải đang kết nối và đang hiện hình video.'
)
NO_FRAME_MSG = "Kết nối được nhưng không đọc được khung hình."
IN_USE_MSG = "thiết bị đang bị app khác dùng"
NOT_FOUND_MSG = "không tìm thấy thiết bị"
NO_PICTURE_MSG = "không có hình"
PRIVACY_HINT = (
    'Kiểm tra Windows: Settings → Privacy & security → Camera → bật '
    '"Let desktop apps access your camera", và đóng các app đang dùng camera.'
)

# Cho phép test rút ngắn; trên máy thật: hâm nóng 2 s rồi đọc 15–30 khung.
PROBE_WARMUP_SEC = 2.0
PROBE_DISCARD = 10
PROBE_WANT = 20
PROBE_TIMEOUT_SEC = 4.0
PROBE_FAIL_SLEEP = 0.05
CAPTURE_SIZES = ((1280, 720), (640, 480))
CAPTURE_FOURCCS = ("MJPG", "YUY2")
# Luôn dò MSMF 0..5 khi liệt kê, kể cả khi enum VIDCAP thất bại.
MSMF_PROBE_MAX = 6

# Lần mở webcam gần nhất — test-connection nêu backend/chỉ số đã thử.
_last_tried: list[tuple[str, int | None]] = []
_last_used: tuple[str | None, int | None] = (None, None)

_AUDIO_NAME_RE = re.compile(
    r"microphone|\bspeakers?\b|\baudio\b|sound mapper|wave in|headset|line in",
    re.IGNORECASE,
)
_VIDEO_NAME_RE = re.compile(r"\bvideo\b|\bcamera\b|\bwebcam\b", re.IGNORECASE)

OPENCV_DIST_NAMES = (
    "opencv-python",
    "opencv-python-headless",
    "opencv-contrib-python",
    "opencv-contrib-python-headless",
)
OPENCV_CONFLICT_NAMES = (
    "opencv-python",
    "opencv-python-headless",
    "opencv-contrib-python",
)


@dataclass
class WebcamSpec:
    backend: str | None  # "dshow" | "msmf" | None (tự chọn)
    index: int | None
    name: str | None
    raw: str = ""

    def url(self) -> str:
        if self.backend and self.name:
            return f"webcam://{self.backend}/name/{quote(self.name, safe='')}"
        if self.backend and self.index is not None:
            return f"webcam://{self.backend}/{self.index}"
        if self.index is not None:
            return f"webcam://{self.index}"
        return self.raw or ""


def parse_webcam_url(url: str | int | None) -> WebcamSpec:
    """Phân tích webcam://..., chỉ số, hoặc /dev/videoN."""
    if isinstance(url, int):
        return WebcamSpec(None, url, None, str(url))
    u = (str(url) if url is not None else "0").strip()
    raw = u
    low = u.lower()
    for pre in ("webcam://", "device://"):
        if low.startswith(pre):
            u = u[len(pre):]
            low = u.lower()
            break
    if low.startswith("/dev/video"):
        rest = u[len("/dev/video"):]
        return WebcamSpec(None, int(rest) if rest.isdigit() else 0, None, raw)
    for be in ("dshow", "msmf"):
        if low.startswith(be + "/name/"):
            return WebcamSpec(be, None, unquote(u[len(be) + 6:]), raw)
        if low.startswith(be + "/"):
            rest = u[len(be) + 1:]
            if rest.isdigit():
                return WebcamSpec(be, int(rest), None, raw)
            return WebcamSpec(be, None, unquote(rest), raw)
    if u.isdigit():
        return WebcamSpec(None, int(u), None, raw)
    if u:
        return WebcamSpec(None, None, unquote(u), raw)
    return WebcamSpec(None, 0, None, raw)


def is_audio_device_name(name: str | None) -> bool:
    """Tên thiết bị thu âm (Microphone, DroidCam Audio, …) — không đưa vào danh sách webcam."""
    n = (name or "").strip()
    if not n:
        return False
    if _VIDEO_NAME_RE.search(n) and not _AUDIO_NAME_RE.search(n):
        return False
    return bool(_AUDIO_NAME_RE.search(n))


def normalize_frame(frame):
    """Đưa khung về BGR uint8. Chuyển BGRA / ảnh xám / NV12 nếu OpenCV trả format thô."""
    if frame is None:
        return None
    try:
        arr = np.asarray(frame)
    except Exception:
        return None
    if arr.size == 0:
        return None
    if arr.dtype != np.uint8:
        if np.issubdtype(arr.dtype, np.floating):
            scale = 255.0 if float(np.nanmax(arr)) <= 1.5 else 1.0
            arr = np.clip(arr * scale, 0, 255).astype(np.uint8)
        else:
            arr = np.clip(arr, 0, 255).astype(np.uint8)
    try:
        if arr.ndim == 2:
            h, w = arr.shape
            if w >= 16 and h == w * 3 // 2:
                try:
                    return cv2.cvtColor(arr, cv2.COLOR_YUV2BGR_NV12)
                except Exception:
                    pass
            return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
        if arr.ndim == 3 and arr.shape[2] == 4:
            return cv2.cvtColor(arr, cv2.COLOR_BGRA2BGR)
        if arr.ndim == 3 and arr.shape[2] == 3:
            return arr
    except Exception:
        return None
    return None


def _grey_small(frame, size: int = 64):
    f = normalize_frame(frame)
    if f is None:
        return None
    try:
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) if f.ndim == 3 else f
        return cv2.resize(g, (size, size), interpolation=cv2.INTER_AREA)
    except Exception:
        return None


def is_uniform_frame(frame, max_std: float = 3.0, max_range: int | None = None) -> bool:
    """True nếu khung gần như một màu (xanh DroidCam / đen / không có hình).

    Dùng độ lệch chuẩn trên ảnh xám thu nhỏ (mặc định < 3). max_range giữ để tương thích
    chữ ký cũ, không còn dùng làm điều kiện chính.
    """
    del max_range
    g = _grey_small(frame)
    if g is None:
        return True
    return float(g.std()) < float(max_std)


def frames_nearly_identical(frames: list, max_mean_abs: float = 3.0) -> bool:
    greys = [_grey_small(f) for f in frames]
    greys = [g for g in greys if g is not None]
    if len(greys) < 2:
        return True
    ref = greys[0].astype(np.float32)
    for g in greys[1:]:
        if float(np.mean(np.abs(g.astype(np.float32) - ref))) > max_mean_abs:
            return False
    return True


def frames_have_picture(frames: list) -> bool:
    """Có hình thật nếu ít nhất một khung (sau hâm nóng) không phải màu đặc."""
    if not frames:
        return False
    real = [normalize_frame(f) for f in frames]
    real = [f for f in real if f is not None]
    if not real:
        return False
    if any(not is_uniform_frame(f) for f in real):
        return True
    # Tất cả khung std xám < 3 → màu đặc (đen/xanh kẹt), kể cả khi độ sáng hơi đổi.
    return False


def resize_jpeg(jpg: bytes, max_w: int | None, quality: int = 70) -> bytes:
    """Thu nhỏ JPEG theo chiều rộng (giữ tỉ lệ). Nếu đã nhỏ hơn max_w thì trả nguyên bản."""
    if not jpg or not max_w or max_w <= 0:
        return jpg
    arr = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
    if arr is None:
        return jpg
    h, w = arr.shape[:2]
    if w <= max_w:
        return jpg
    new = cv2.resize(arr, (max_w, max(1, int(h * max_w / w))), interpolation=cv2.INTER_AREA)
    ok, enc = cv2.imencode(".jpg", new, [cv2.IMWRITE_JPEG_QUALITY, int(quality)])
    return enc.tobytes() if ok else jpg


def _try_open(source, api) -> cv2.VideoCapture | None:
    cap = cv2.VideoCapture(source, api)
    if cap is not None and cap.isOpened():
        return cap
    if cap is not None:
        try:
            cap.release()
        except Exception:
            pass
    return None


def _configure_capture_format(cap: cv2.VideoCapture, fourcc: str, w: int, h: int) -> None:
    try:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, w)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, h)
        cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*fourcc))
    except Exception:
        pass


def prepare_capture(cap: cv2.VideoCapture, backend: str | None = None, name: str | None = None) -> bool:
    """Đặt buffer nhỏ. Khung rỗng (đặc biệt DroidCam/OBS): thử 1280×720 và 640×480 + MJPG/YUY2."""
    if cap is None or not cap.isOpened():
        return False
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    ok, frame = cap.read()
    frame = normalize_frame(frame) if ok else None
    if frame is not None:
        return True
    if not IS_WIN:
        return False
    # Camera ảo thường không ra khung cho đến khi đặt size + fourcc.
    for w, h in CAPTURE_SIZES:
        for fourcc in CAPTURE_FOURCCS:
            _configure_capture_format(cap, fourcc, w, h)
            for _ in range(4):
                ok, frame = cap.read()
                if ok and normalize_frame(frame) is not None:
                    return True
    return False


def capture_is_usable(cap, backend: str | None = None, name: str | None = None) -> bool:
    """True nếu mở được và đọc được ít nhất một khung (kể cả màu đặc)."""
    if cap is None:
        return False
    try:
        if not cap.isOpened():
            return False
    except Exception:
        return False
    return prepare_capture(cap, backend, name)


def installed_opencv_packages() -> dict[str, str]:
    import importlib.metadata as md
    found: dict[str, str] = {}
    for name in OPENCV_DIST_NAMES:
        try:
            found[name] = md.version(name)
        except md.PackageNotFoundError:
            continue
        except Exception:
            continue
    return found


def videoio_backend_names() -> list[str]:
    try:
        reg = cv2.videoio_registry
        return [reg.getBackendName(b) for b in reg.getBackends()]
    except Exception:
        return []


def opencv_conflict_warning(pkgs: dict[str, str] | None = None) -> str | None:
    """Cảnh báo khi cài chồng nhiều bánh OpenCV — làm hỏng DirectShow trên Windows."""
    pkgs = installed_opencv_packages() if pkgs is None else pkgs
    keys = [k for k in OPENCV_CONFLICT_NAMES if k in pkgs]
    if len(keys) <= 1 and len(pkgs) <= 1:
        return None
    listed = ", ".join(f"{k}=={pkgs[k]}" for k in pkgs)
    return (
        f"Cảnh báo: đang cài đồng thời {listed}. "
        "Nhiều gói OpenCV cùng lúc làm hỏng backend DirectShow "
        "('can't be used to capture by index/name', unknown C++ exception). "
        "Gỡ hết rồi chỉ giữ một gói: pip uninstall opencv-python opencv-python-headless "
        "opencv-contrib-python opencv-contrib-python-headless "
        'rồi pip install "opencv-python>=4.9".'
    )


def format_env_report(pkgs: dict[str, str] | None = None) -> str:
    pkgs = installed_opencv_packages() if pkgs is None else pkgs
    pkg_s = ", ".join(f"{k}=={v}" for k, v in pkgs.items()) or "(không thấy distribution opencv*)"
    backends = ", ".join(videoio_backend_names()) or "(không đọc được videoio_registry)"
    lines = [
        f"Python {sys.version.split()[0]} ({sys.executable})",
        f"cv2.__version__ = {getattr(cv2, '__version__', '?')}",
        f"opencv packages: {pkg_s}",
        f"videoio backends: {backends}",
    ]
    warn = opencv_conflict_warning(pkgs)
    if warn:
        lines.append("WARN: " + warn)
    return "\n".join(lines)


_env_checked = False


def check_env(*, force: bool = False, silent: bool = False) -> dict:
    """In Python/OpenCV/backend và cảnh báo gói trùng. Gọi khi khởi động BE và CLI."""
    global _env_checked
    pkgs = installed_opencv_packages()
    info = {
        "python": sys.version.split()[0],
        "executable": sys.executable,
        "cv2": getattr(cv2, "__version__", None),
        "packages": pkgs,
        "backends": videoio_backend_names(),
        "warning": opencv_conflict_warning(pkgs),
    }
    if silent:
        return info
    if _env_checked and not force:
        return info
    _env_checked = True
    for line in format_env_report(pkgs).splitlines():
        print(f"[webcams] {line}", flush=True)
    return info


def _ffmpeg_exe() -> str | None:
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe:
            return exe
    except Exception:
        pass
    import shutil
    return shutil.which("ffmpeg")


class PygrabberCapture:
    """Đọc khung BGR qua pygrabber DirectShow (không dùng OpenCV CAP_DSHOW).

    FilterGraph: add_video_input_device + add_sample_grabber + add_null_render +
    prepare_preview_graph / run + grab_frame trên một luồng riêng.
    """

    def __init__(self, index: int, *, ready_timeout: float = 3.0):
        self.source = int(index)
        self.api = "pygrabber"
        self._open = False
        self._frame = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._error: str | None = None
        self._graph = None
        self._thread = threading.Thread(
            target=self._run, name=f"pygrabber-{self.source}", daemon=True)
        self._thread.start()
        self._ready.wait(max(0.2, float(ready_timeout)))
        if self._error:
            self._open = False

    def _on_frame(self, image) -> None:
        if image is None:
            return
        try:
            f = np.asarray(image)
        except Exception:
            return
        if f.ndim != 3 or f.shape[2] not in (3, 4):
            return
        # Sample grabber RGB24 của pygrabber thường đã ở dạng dùng được với cv2 (BGR).
        with self._lock:
            self._frame = f.copy()
        self._open = True
        self._ready.set()

    def _run(self) -> None:
        graph = None
        try:
            from pygrabber.dshow_graph import FilterGraph
            graph = FilterGraph()
            graph.add_video_input_device(int(self.source))
            graph.add_sample_grabber(self._on_frame)
            graph.add_null_render()
            graph.prepare_preview_graph()
            graph.run()
            self._graph = graph
            # Chỉ _ready khi có khung (hoặc lỗi) — tránh accept một graph chưa ra hình.
            while not self._stop.is_set():
                try:
                    graph.grab_frame()
                except Exception:
                    pass
                self._stop.wait(0.03)
        except Exception as e:
            self._error = f"{type(e).__name__}: {e}"
            self._open = False
            self._ready.set()
        finally:
            if graph is not None:
                try:
                    graph.stop()
                except Exception:
                    pass
            self._graph = None

    def isOpened(self) -> bool:
        return self._frame is not None and not self._stop.is_set() and self._error is None

    def read(self):
        if self._stop.is_set() or self._error:
            return False, None
        with self._lock:
            f = None if self._frame is None else self._frame.copy()
        if f is None:
            return False, None
        return True, f

    def release(self) -> None:
        self._stop.set()
        self._open = False
        th = self._thread
        if th is not None and th.is_alive() and threading.current_thread() is not th:
            th.join(timeout=2.0)
        self._graph = None

    def set(self, prop, val) -> bool:
        return False

    def get(self, prop) -> float:
        return 0.0


class FFmpegCapture:
    """Đọc MJPEG từ `ffmpeg -f dshow -i video=<tên>` (cú pháp ffmpeg, không phải OpenCV CAP_DSHOW)."""

    def __init__(self, name: str, *, ready_timeout: float = 4.0):
        self.source = name
        self.api = "ffmpeg"
        self._open = False
        self._frame = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._ready = threading.Event()
        self._error: str | None = None
        self._proc: subprocess.Popen | None = None
        self._thread = threading.Thread(
            target=self._run, name=f"ffmpeg-dshow-{name}", daemon=True)
        self._thread.start()
        self._ready.wait(max(0.2, float(ready_timeout)))
        if self._error and self._frame is None:
            self._open = False

    def _run(self) -> None:
        exe = _ffmpeg_exe()
        if not exe:
            self._error = "không tìm thấy ffmpeg"
            self._ready.set()
            return
        args = [
            exe, "-hide_banner", "-loglevel", "error",
            "-f", "dshow", "-i", f"video={self.source}",
            "-f", "image2pipe", "-vcodec", "mjpeg", "-",
        ]
        kw: dict = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        if IS_WIN:
            kw["creationflags"] = 0x08000000  # CREATE_NO_WINDOW
        try:
            self._proc = subprocess.Popen(args, **kw)
        except Exception as e:
            self._error = f"{type(e).__name__}: {e}"
            self._ready.set()
            return
        self._open = True
        buf = b""
        try:
            while not self._stop.is_set() and self._proc.stdout is not None:
                chunk = self._proc.stdout.read(4096)
                if not chunk:
                    break
                buf += chunk
                if len(buf) > 8_000_000:
                    soi = buf.find(bytes((0xFF, 0xD8)))
                    buf = buf[soi:] if soi >= 0 else b""
                while True:
                    soi = buf.find(bytes((0xFF, 0xD8)))
                    if soi < 0:
                        buf = b""
                        break
                    eoi = buf.find(bytes((0xFF, 0xD9)), soi + 2)
                    if eoi < 0:
                        if soi > 0:
                            buf = buf[soi:]
                        break
                    jpg = buf[soi:eoi + 2]
                    buf = buf[eoi + 2:]
                    img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
                    if img is None:
                        continue
                    with self._lock:
                        self._frame = img
                    self._open = True
                    self._ready.set()
        except Exception as e:
            self._error = f"{type(e).__name__}: {e}"
        finally:
            self._ready.set()
            self._kill_proc()

    def _kill_proc(self) -> None:
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        try:
            proc.kill()
        except Exception:
            pass
        try:
            proc.wait(timeout=1)
        except Exception:
            pass

    def isOpened(self) -> bool:
        return bool(self._open) and not self._stop.is_set() and self._frame is not None

    def read(self):
        if not self.isOpened():
            return False, None
        with self._lock:
            f = None if self._frame is None else self._frame.copy()
        if f is None:
            return False, None
        return True, f

    def release(self) -> None:
        self._stop.set()
        self._open = False
        self._kill_proc()
        th = self._thread
        if th is not None and th.is_alive() and threading.current_thread() is not th:
            th.join(timeout=2.0)

    def set(self, prop, val) -> bool:
        return False

    def get(self, prop) -> float:
        return 0.0


def _open_pygrabber_capture(index: int | None, name: str | None = None):
    """Mở sample grabber pygrabber theo chỉ số DirectShow. None nếu không dùng được."""
    if not IS_WIN:
        return None
    if index is None and name:
        index = dshow_index_for_name(name)
    if index is None:
        return None
    _note_try("pygrabber", int(index))
    try:
        cap = PygrabberCapture(int(index))
        if cap.isOpened():
            print(f"[webcams] mở pygrabber DirectShow index {index}"
                  + (f" ({name})" if name else ""), flush=True)
            return cap
        cap.release()
    except Exception as e:
        print(f"[webcams] pygrabber grab_frame lỗi: {type(e).__name__}: {e}", flush=True)
    return None


def _open_ffmpeg_capture(name: str | None, index: int | None = None):
    """Mở ffmpeg dshow theo tên thiết bị (không phải cv2.CAP_DSHOW)."""
    if not IS_WIN:
        return None
    resolved = (name or "").strip()
    if not resolved and index is not None:
        resolved = (dshow_device_names().get(index) or "").strip()
    if not resolved:
        return None
    _note_try("ffmpeg", index)
    try:
        cap = FFmpegCapture(resolved)
        if cap.isOpened():
            print(f"[webcams] mở ffmpeg dshow video={resolved}", flush=True)
            return cap
        cap.release()
    except Exception as e:
        print(f"[webcams] ffmpeg dshow lỗi: {type(e).__name__}: {e}", flush=True)
    return None


def is_virtual_cam(name: str | None) -> bool:
    n = (name or "").lower()
    return any(k in n for k in ("droidcam", "obs", "iriun", "unity capture"))


def uniform_message(name: str | None = None) -> str:
    if name and "droidcam" in name.lower():
        return DROIDCAM_UNIFORM_MSG
    if is_virtual_cam(name):
        return DROIDCAM_UNIFORM_MSG
    return UNIFORM_MSG


def describe_attempts() -> str:
    """Chuỗi ngắn: backend/chỉ số đã thử và đã mở (cho test-connection)."""
    parts: list[str] = []
    if _last_tried:
        labels = [f"{b}/{i}" if i is not None else str(b) for b, i in _last_tried]
        parts.append("đã thử " + ", ".join(labels))
    b, i = _last_used
    if b is not None:
        parts.append(f"đã mở {b}/{i}" if i is not None else f"đã mở {b}")
    return (" (" + "; ".join(parts) + ")") if parts else ""


def _reset_open_trace() -> None:
    global _last_used
    _last_tried.clear()
    _last_used = (None, None)


def _note_try(backend: str, index: int | None) -> None:
    _last_tried.append((backend, index))


def _note_used(backend: str | None, index: int | None) -> None:
    global _last_used
    _last_used = (backend, index)


def _dshow_names_pygrabber() -> list[str] | None:
    """None = không gọi được pygrabber; list (có thể rỗng) = thứ tự CAP_DSHOW."""
    if not IS_WIN:
        return None
    try:
        from pygrabber.dshow_graph import FilterGraph
        return list(FilterGraph().get_input_devices() or [])
    except Exception as e:
        print(f"[webcams] pygrabber không liệt kê được DirectShow: {type(e).__name__}: {e}", flush=True)
        return None


def dshow_index_for_name(name: str) -> int | None:
    """Chỉ số DSHOW của tên: bản đồ pygrabber (bổ sung ffmpeg vào ô trống), rồi danh sách ffmpeg."""
    if not name:
        return None
    want = name.strip().lower()
    for i, n in dshow_device_names().items():
        if (n or "").strip().lower() == want:
            return int(i)
    # pygrabber có thể thiếu camera ảo mà ffmpeg vẫn liệt kê
    for i, n in enumerate(_dshow_names_ffmpeg()):
        if (n or "").strip().lower() == want and not is_audio_device_name(n):
            return i
    return None


def msmf_index_for_name(name: str) -> int | None:
    """Chỉ số MSMF = thứ tự MFEnumDeviceSources (VIDCAP) — OpenCV MSMF dùng cùng thứ tự."""
    if not name:
        return None
    want = name.strip().lower()
    for i, n in enumerate(mf_device_names()):
        if (n or "").strip().lower() == want:
            return i
    return None


def unclaimed_indices(claimed: set[int], hi: int = 9) -> list[int]:
    return [i for i in range(0, hi + 1) if i not in claimed]


def _open_dshow_index(index: int) -> cv2.VideoCapture | None:
    _note_try("dshow", int(index))
    return _try_open(int(index), cv2.CAP_DSHOW)


def _open_msmf_index(index: int) -> cv2.VideoCapture | None:
    _note_try("msmf", int(index))
    return _try_open(int(index), cv2.CAP_MSMF)


def _open_dshow_by_name(name: str) -> cv2.VideoCapture | None:
    """Resolve tên → chỉ số (pygrabber, rồi ffmpeg). Nếu không resolve được, thử chỉ số 0..9
    chưa gắn tên. Không bao giờ truyền chuỗi cho CAP_DSHOW."""
    if not name or not IS_WIN:
        return None
    idx = dshow_index_for_name(name)
    if idx is not None:
        return _open_dshow_index(idx)
    claimed = set(dshow_device_names().keys())
    for i in unclaimed_indices(claimed, 9):
        cap = _open_dshow_index(i)
        if cap is not None:
            return cap
    return None


def _open_msmf_by_name(name: str) -> cv2.VideoCapture | None:
    """OpenCV MSMF không mở theo tên — đổi tên thành chỉ số VIDCAP. Không resolve được: thử 0..9 chưa có tên."""
    if not name:
        return None
    idx = msmf_index_for_name(name)
    if idx is not None:
        return _open_msmf_index(idx)
    claimed = set(range(len(mf_device_names())))
    for i in unclaimed_indices(claimed, 9):
        cap = _open_msmf_index(i)
        if cap is not None:
            return cap
    return None


def _release_cap(cap: cv2.VideoCapture | None) -> None:
    if cap is None:
        return
    try:
        cap.release()
    except Exception:
        pass


def _msmf_fallback_for_dshow(name: str | None, dshow_index: int | None):
    """DirectShow thất bại: MSMF theo chỉ số VIDCAP của cùng tên. Nếu enum MF trống, dò 0..5."""
    resolved = (name or "").strip()
    if not resolved and dshow_index is not None:
        resolved = (dshow_device_names().get(dshow_index) or "").strip()
    idx = msmf_index_for_name(resolved) if resolved else None
    tried: list[int] = []
    if idx is not None:
        tried.append(idx)
        cap = _open_msmf_index(idx)
        if cap is not None:
            print(
                f"[webcams] DirectShow thất bại cho '{resolved}', "
                f"mở MSMF theo chỉ số VIDCAP {idx}.",
                flush=True,
            )
            return cap
    mf_names = mf_device_names()
    # Enum trống (hoặc không resolve được tên) — vẫn thử MSMF 0..5.
    if not mf_names or idx is None:
        for i in range(MSMF_PROBE_MAX):
            if i in tried:
                continue
            cap = _open_msmf_index(i)
            if cap is not None:
                print(
                    f"[webcams] DirectShow thất bại"
                    + (f" cho '{resolved}'" if resolved else "")
                    + f", thử MSMF {i} (enum VIDCAP "
                    + ("trống" if not mf_names else "không khớp tên")
                    + ").",
                    flush=True,
                )
                return cap
    return None


def device_is_listed(spec: WebcamSpec) -> bool:
    """Thiết bị có trong enum DirectShow hoặc Media Foundation (VIDCAP)."""
    if spec.name:
        if is_audio_device_name(spec.name):
            return False
        return dshow_index_for_name(spec.name) is not None or msmf_index_for_name(spec.name) is not None
    if spec.index is None:
        return False
    if spec.backend == "dshow":
        return spec.index in dshow_device_names()
    if spec.backend == "msmf":
        names = mf_device_names()
        return 0 <= spec.index < len(names)
    return spec.index in dshow_device_names() or 0 <= spec.index < len(mf_device_names())


def classify_webcam_failure(*, listed: bool, opened: bool, got_frames: bool,
                            name: str | None = None) -> tuple[str, str]:
    """(reason, message) — phân biệt ba lỗi webcam; kèm backend/chỉ số đã thử."""
    if got_frames:
        msg = uniform_message(name)
    elif opened or listed:
        msg = f"{IN_USE_MSG}. {PRIVACY_HINT}"
        reason = "in_use"
        return reason, (msg + describe_attempts())
    else:
        return "not_found", NOT_FOUND_MSG + describe_attempts()
    return "uniform", msg + describe_attempts()


def _open_by_index(index: int, backend: str | None) -> cv2.VideoCapture | None:
    if IS_WIN:
        if backend == "dshow":
            return _open_dshow_index(index)
        if backend == "msmf":
            return _open_msmf_index(index)
        cap = _open_dshow_index(index)
        if cap is not None:
            return cap
        return _open_msmf_index(index)
    _note_try("v4l2", int(index))
    return _try_open(int(index), cv2.CAP_V4L2) or _try_open(int(index), cv2.CAP_ANY)


def _source_index(cap, fallback: int | None) -> int | None:
    src = getattr(cap, "source", None)
    if isinstance(src, int):
        return src
    return fallback


def open_webcam(url_or_index):
    """Mở webcam từ chỉ số, tên, hoặc URL webcam://... Luôn trả về một reader
    (cv2.VideoCapture / PygrabberCapture / FFmpegCapture; có thể chưa mở được).

    Thứ tự Windows: cv2 DSHOW (chỉ số nguyên, không bao giờ 'video='), cv2 MSMF,
    pygrabber sample grabber, ffmpeg dshow. Một bước chỉ được chấp nhận khi đọc được khung.
    """
    _reset_open_trace()
    spec = url_or_index if isinstance(url_or_index, WebcamSpec) else parse_webcam_url(url_or_index)
    cap = None
    used = spec.backend
    used_index = spec.index
    name = (spec.name or "").strip() or None
    if not name and spec.index is not None and spec.backend in ("dshow", None):
        name = (dshow_device_names().get(spec.index) or "").strip() or None
    if not name and spec.index is not None and spec.backend == "msmf":
        names = mf_device_names()
        if 0 <= spec.index < len(names):
            name = names[spec.index]

    def accept(c, backend: str, index: int | None) -> bool:
        nonlocal cap, used, used_index
        if capture_is_usable(c, backend, name):
            cap = c
            used = backend
            used_index = _source_index(c, index)
            return True
        _release_cap(c)
        return False

    dshow_idx = spec.index if spec.backend in ("dshow", None) and spec.index is not None else None
    if dshow_idx is None and name:
        dshow_idx = dshow_index_for_name(name)

    if IS_WIN and spec.backend == "msmf":
        c = _open_msmf_by_name(name) if name else None
        if c is None and spec.index is not None:
            c = _open_msmf_index(spec.index)
        idx = _source_index(c, spec.index if c is not None else None)
        if not accept(c, "msmf", idx):
            if not accept(_open_pygrabber_capture(dshow_idx, name), "pygrabber", dshow_idx):
                accept(_open_ffmpeg_capture(name, dshow_idx), "ffmpeg", dshow_idx)
    elif IS_WIN:
        # 1) cv2 DirectShow theo chỉ số
        c = None
        if name:
            c = _open_dshow_by_name(name)
        if (c is None or not c.isOpened()) and dshow_idx is not None:
            _release_cap(c)
            c = _open_dshow_index(dshow_idx)
        idx = _source_index(c, dshow_idx)
        if not accept(c, "dshow", idx):
            # 2) cv2 MSMF
            if not accept(_msmf_fallback_for_dshow(name, dshow_idx), "msmf",
                          msmf_index_for_name(name) if name else None):
                # 3) pygrabber  4) ffmpeg
                if not accept(_open_pygrabber_capture(dshow_idx, name), "pygrabber", dshow_idx):
                    accept(_open_ffmpeg_capture(name, dshow_idx), "ffmpeg", dshow_idx)
    else:
        if spec.index is not None:
            accept(_open_by_index(spec.index, spec.backend), spec.backend or "v4l2", spec.index)

    if cap is None:
        cap = cv2.VideoCapture()
    if cap is not None and cap.isOpened():
        if used_index is None:
            used_index = _source_index(cap, spec.index)
        _note_used(used or spec.backend, used_index)
        # prepare_capture đã chạy trong capture_is_usable khi chấp nhận.
    return cap


def _guid(s: str):
    """Tạo cấu trúc GUID từ chuỗi 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'."""
    import ctypes

    class GUID(ctypes.Structure):
        _fields_ = [
            ("Data1", ctypes.c_uint32),
            ("Data2", ctypes.c_uint16),
            ("Data3", ctypes.c_uint16),
            ("Data4", ctypes.c_ubyte * 8),
        ]

    p = s.strip("{}").split("-")
    d4 = bytes.fromhex(p[3] + p[4])
    g = GUID()
    g.Data1 = int(p[0], 16)
    g.Data2 = int(p[1], 16)
    g.Data3 = int(p[2], 16)
    for i, b in enumerate(d4):
        g.Data4[i] = b
    return g


def _mf_names_ctypes() -> list[str]:
    """Liệt kê tên thiết bị video Media Foundation (VIDCAP only), không thêm thư viện."""
    if not IS_WIN:
        return []
    import ctypes
    from ctypes import wintypes

    ole32 = ctypes.WinDLL("ole32")
    mfplat = ctypes.WinDLL("mfplat")
    try:
        mf = ctypes.WinDLL("mf")
    except OSError as e:
        print(f"[webcams] không tải được mf.dll: {e}", flush=True)
        return []

    HRESULT = ctypes.HRESULT
    ole32.CoInitializeEx.argtypes = [ctypes.c_void_p, wintypes.DWORD]
    ole32.CoInitializeEx.restype = HRESULT
    ole32.CoUninitialize.argtypes = []
    ole32.CoTaskMemFree.argtypes = [ctypes.c_void_p]

    MF_VERSION = (2 << 16) | 0x70
    mfplat.MFStartup.argtypes = [wintypes.ULONG, wintypes.DWORD]
    mfplat.MFStartup.restype = HRESULT
    mfplat.MFShutdown.argtypes = []
    mfplat.MFShutdown.restype = HRESULT

    mfplat.MFCreateAttributes.argtypes = [ctypes.POINTER(ctypes.c_void_p), ctypes.c_uint32]
    mfplat.MFCreateAttributes.restype = HRESULT
    mf.MFEnumDeviceSources.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p)),
        ctypes.POINTER(ctypes.c_uint32),
    ]
    mf.MFEnumDeviceSources.restype = HRESULT

    # IMFAttributes : IUnknown — mfobjects.h
    # 0 QueryInterface, 1 AddRef, 2 Release,
    # 3 GetItem … 13 GetAllocatedString … 24 SetGUID
    IDX_GET_ALLOCATED_STRING = 13
    IDX_SET_GUID = 24
    IDX_RELEASE = 2

    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE = _guid(GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE)
    MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID = _guid(GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP)
    MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME = _guid(GUID_MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME)

    def vtbl(ptr):
        return ctypes.cast(ctypes.c_void_p(ptr), ctypes.POINTER(ctypes.c_void_p))[0]

    def fn(ptr, index, restype, *argtypes):
        table = ctypes.cast(vtbl(ptr), ctypes.POINTER(ctypes.c_void_p))
        return ctypes.WINFUNCTYPE(restype, *argtypes)(table[index])

    def release(ptr):
        if not ptr:
            return
        f = fn(ptr, IDX_RELEASE, ctypes.c_ulong, ctypes.c_void_p)
        f(ptr)

    started = False
    com = False
    names: list[str] = []
    attrs = ctypes.c_void_p()
    activates = ctypes.POINTER(ctypes.c_void_p)()
    count = ctypes.c_uint32(0)
    try:
        hr_com = ole32.CoInitializeEx(None, 0x2)  # COINIT_APARTMENTTHREADED
        # S_OK / S_FALSE / RPC_E_CHANGED_MODE (đã MTA) — vẫn thử enum
        del hr_com
        com = True
        hr = mfplat.MFStartup(MF_VERSION, 1)  # MFSTARTUP_NOSOCKET
        if hr < 0:
            print(f"[webcams] MFStartup thất bại HRESULT=0x{hr & 0xFFFFFFFF:08X}", flush=True)
            return []
        started = True
        if mfplat.MFCreateAttributes(ctypes.byref(attrs), 1) < 0 or not attrs.value:
            print("[webcams] MFCreateAttributes thất bại", flush=True)
            return []
        set_guid = fn(
            attrs.value,
            IDX_SET_GUID,
            HRESULT,
            ctypes.c_void_p,
            ctypes.c_void_p,
            ctypes.c_void_p,
        )
        hr = set_guid(
            attrs.value,
            ctypes.byref(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE),
            ctypes.byref(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID),
        )
        if hr < 0:
            print(f"[webcams] SetGUID(VIDCAP) thất bại HRESULT=0x{hr & 0xFFFFFFFF:08X}", flush=True)
            return []
        if mf.MFEnumDeviceSources(attrs.value, ctypes.byref(activates), ctypes.byref(count)) < 0:
            print("[webcams] MFEnumDeviceSources thất bại", flush=True)
            return []
        # restype c_long (không dùng HRESULT) — HRESULT tự raise OSError khi
        # MF_E_ATTRIBUTENOTFOUND, hủy cả enum. Lỗi từng thiết bị được bắt riêng.
        for i in range(count.value):
            act = activates[i]
            if not act:
                continue
            pwsz = ctypes.c_wchar_p()
            try:
                get_str = fn(
                    act,
                    IDX_GET_ALLOCATED_STRING,
                    ctypes.c_long,  # không phải HRESULT — tự kiểm tra mã lỗi
                    ctypes.c_void_p,
                    ctypes.c_void_p,
                    ctypes.POINTER(ctypes.c_wchar_p),
                    ctypes.POINTER(ctypes.c_uint32),
                )
                length = ctypes.c_uint32(0)
                hr = get_str(
                    act,
                    ctypes.byref(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME),
                    ctypes.byref(pwsz),
                    ctypes.byref(length),
                )
                if hr >= 0 and pwsz.value:
                    names.append(pwsz.value)
                elif hr < 0:
                    print(
                        f"[webcams] MF GetAllocatedString[{i}] "
                        f"HRESULT=0x{hr & 0xFFFFFFFF:08X} — bỏ thiết bị này, tiếp tục.",
                        flush=True,
                    )
            except Exception as e:
                print(
                    f"[webcams] MF đọc tên thiết bị [{i}] lỗi: {type(e).__name__}: {e}",
                    flush=True,
                )
            finally:
                if pwsz:
                    try:
                        ole32.CoTaskMemFree(pwsz)
                    except Exception:
                        pass
                release(act)
        if activates:
            ole32.CoTaskMemFree(activates)
        activates = None
        return names
    except Exception as e:
        print(f"[webcams] MF enum (ctypes) lỗi: {type(e).__name__}: {e}", flush=True)
        return []
    finally:
        if attrs and attrs.value:
            try:
                release(attrs.value)
            except Exception:
                pass
        if started:
            try:
                mfplat.MFShutdown()
            except Exception:
                pass
        if com:
            try:
                ole32.CoUninitialize()
            except Exception:
                pass


def parse_ffmpeg_dshow_devices(text: str) -> list[str]:
    """Lấy tên video từ stderr `ffmpeg -f dshow -list_devices true -i dummy`."""
    names: list[str] = []
    in_video = False
    for line in (text or "").splitlines():
        low = line.lower()
        if "directshow video devices" in low or re.search(r"dshow.*video devices", low):
            in_video = True
            continue
        if in_video and ("audio devices" in low or "directshow audio" in low):
            in_video = False
            continue
        if not in_video:
            continue
        m = re.search(r'"([^"]+)"', line)
        if m:
            names.append(m.group(1))
    return names


def _dshow_names_ffmpeg() -> list[str]:
    if not IS_WIN:
        return []
    exe = "ffmpeg"
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe() or exe
    except Exception:
        pass
    try:
        kw: dict = dict(capture_output=True, text=True, timeout=12)
        if IS_WIN:
            kw["creationflags"] = 0x08000000
        r = subprocess.run(
            [exe, "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            **kw,
        )
        text = (r.stderr or "") + "\n" + (r.stdout or "")
        return parse_ffmpeg_dshow_devices(text)
    except Exception as e:
        print(f"[webcams] FFmpeg liệt kê DirectShow lỗi: {e}", flush=True)
        return []


def _pnp_camera_names() -> list[str]:
    """Tên thiết bị lớp Camera/Image từ WMI (không lấy micro/audio, không ghép vào chỉ số MSMF)."""
    if not IS_WIN:
        return []
    # Chỉ PNPClass Camera hoặc Image — KHÔNG lọc theo tên (DroidCam Audio cũng khớp 'DroidCam').
    script = (
        "Get-CimInstance Win32_PnPEntity | "
        "Where-Object { $_.PNPClass -eq 'Camera' -or $_.PNPClass -eq 'Image' } | "
        "Select-Object -ExpandProperty Name"
    )
    try:
        kw: dict = dict(capture_output=True, text=True, timeout=8)
        if IS_WIN:
            kw["creationflags"] = 0x08000000
        r = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
            **kw,
        )
        if r.returncode != 0:
            return []
        names = [ln.strip() for ln in (r.stdout or "").splitlines() if ln.strip()]
        return [n for n in names if not is_audio_device_name(n)]
    except Exception:
        return []


def dshow_device_names() -> dict[int, str]:
    """Chỉ số DirectShow → tên, trùng thứ tự CAP_DSHOW.

    Ưu tiên pygrabber FilterGraph().get_input_devices(). Nếu pygrabber lỗi, dùng thứ tự
    video của ffmpeg -list_devices. Khi pygrabber chạy được nhưng thiếu một camera ảo
    (thường là DroidCam Video ở chỉ số trống, hay gặp ở ô 0), lấy tên từ ffmpeg để
    lấp ô trống — tránh url kiểu name/ trong khi ASUS/OBS đã có dshow/1, dshow/2.
    """
    if not IS_WIN:
        return {}
    pyg = _dshow_names_pygrabber()
    ff = _dshow_names_ffmpeg()
    out: dict[int, str] = {}

    def _put(i: int, n: str, src: str) -> None:
        if not n:
            return
        if is_audio_device_name(n):
            print(f"[webcams] bỏ qua thiết bị audio DirectShow [{i}] ({src}): {n}", flush=True)
            return
        if i not in out:
            out[i] = n

    if pyg is not None:
        for i, n in enumerate(pyg):
            _put(i, n, "pygrabber")
        # Lấp chỉ số trống / tên thiếu từ ffmpeg, không đẩy lệch chỉ số pygrabber đã có.
        for i, n in enumerate(ff):
            if i not in out:
                _put(i, n, "ffmpeg")
            elif n and not is_audio_device_name(n) and (out[i] or "").strip().lower() != n.strip().lower():
                # Ô đã có tên khác — không ghi đè (giữ chỉ số OpenCV/pygrabber).
                pass
        if ff and not pyg:
            print(f"[webcams] DirectShow (pygrabber rỗng, ffmpeg): {len(out)} thiết bị video.", flush=True)
    else:
        for i, n in enumerate(ff):
            _put(i, n, "ffmpeg")
        if out:
            print(f"[webcams] DirectShow (FFmpeg): {len(out)} thiết bị video.", flush=True)
    return out


def mf_device_names() -> list[str]:
    """Tên video Media Foundation theo thứ tự chỉ số MSMF của OpenCV (VIDCAP)."""
    raw = _mf_names_ctypes()
    if not raw:
        return []
    out: list[str] = []
    for n in raw:
        if is_audio_device_name(n):
            print(f"[webcams] bỏ qua thiết bị audio Media Foundation: {n}", flush=True)
            continue
        out.append(n)
    return out


def v4l2_device_names() -> dict[int, str]:
    names: dict[int, str] = {}
    root = Path("/sys/class/video4linux")
    if not root.exists():
        return names
    for p in sorted(root.glob("video*")):
        try:
            names[int(p.name[5:])] = (p / "name").read_text().strip()
        except Exception:
            pass
    return names


def _frame_stats(frame) -> dict:
    f = normalize_frame(frame)
    if f is None:
        return {"mean": None, "std": None, "shape": None, "dtype": None}
    g = _grey_small(f)
    return {
        "mean": None if g is None else round(float(g.mean()), 2),
        "std": None if g is None else round(float(g.std()), 2),
        "shape": list(f.shape),
        "dtype": str(f.dtype),
    }


def probe_capture(cap: cv2.VideoCapture, *, already_prepared: bool = False) -> dict:
    """Đọc tuần tự: hâm nóng rồi lấy khung đánh giá. Luôn không giữ cap (caller release).

    Trả dict: ok, has_picture, width, height, frames_read, error, mean, std, shape, dtype, time_ms.
    """
    info = {
        "ok": False, "has_picture": False, "width": 0, "height": 0,
        "frames_read": 0, "error": None, "mean": None, "std": None,
        "shape": None, "dtype": None, "time_ms": 0,
    }
    t0 = time.time()
    if cap is None or not cap.isOpened():
        info["error"] = "không mở được"
        info["time_ms"] = int((time.time() - t0) * 1000)
        return info
    if not already_prepared:
        prepare_capture(cap, None)

    warmup_sec = float(PROBE_WARMUP_SEC)
    discard_n = int(PROBE_DISCARD)
    want = int(PROBE_WANT)
    timeout = float(PROBE_TIMEOUT_SEC)
    fail_sleep = float(PROBE_FAIL_SLEEP)

    discarded = 0
    judged: list = []
    warmup_kept: list = []
    read_fail = 0
    last_err = None

    def _read_one():
        nonlocal read_fail, last_err
        try:
            ok, f = cap.read()
        except Exception as e:
            read_fail += 1
            last_err = f"{type(e).__name__}: {e}"
            return None
        if not ok or f is None:
            read_fail += 1
            last_err = "read() không trả khung"
            return None
        f = normalize_frame(f)
        if f is None:
            read_fail += 1
            last_err = "khung không đổi được sang BGR"
            return None
        read_fail = 0
        return f

    # Hâm nóng: bỏ ~10 khung hoặc ~1.5–2 s (cái nào đạt sau).
    while time.time() - t0 < timeout:
        elapsed = time.time() - t0
        if discarded >= discard_n and elapsed >= warmup_sec:
            break
        f = _read_one()
        if f is None:
            if discarded == 0 and read_fail == 3:
                prepare_capture(cap, "msmf")
            if read_fail >= 12:
                break
            time.sleep(fail_sleep)
            continue
        discarded += 1
        warmup_kept.append(f)
        if len(warmup_kept) > 8:
            warmup_kept.pop(0)

    # Đánh giá: 15–30 khung, dừng sớm khi đã thấy hình thật.
    while len(judged) < want and time.time() - t0 < timeout:
        f = _read_one()
        if f is None:
            if judged:
                break
            if read_fail >= 10:
                break
            time.sleep(fail_sleep)
            continue
        judged.append(f)
        if not is_uniform_frame(f):
            break

    # DSHOW đôi khi ra vài khung lúc hâm nóng rồi đứt (ASUS: framesRead=3, timeout).
    # Dùng khung hâm nóng để đánh giá thay vì báo 'không đọc được khung'.
    if not judged and warmup_kept:
        judged = list(warmup_kept)

    info["frames_read"] = discarded + len(judged)
    # không đếm trùng các khung hâm nóng được dùng lại để đánh giá
    if judged and warmup_kept and judged[0] is warmup_kept[0]:
        info["frames_read"] = discarded
    info["time_ms"] = int((time.time() - t0) * 1000)
    if not judged:
        info["ok"] = False
        info["error"] = last_err or "không đọc được khung"
        return info
    last = judged[-1]
    h, w = last.shape[:2]
    st = _frame_stats(last)
    info.update(st)
    info["ok"] = True
    info["width"] = int(w)
    info["height"] = int(h)
    info["has_picture"] = frames_have_picture(judged)
    info["error"] = None
    return info


def sort_webcam_entries(entries: list[dict]) -> list[dict]:
    """DroidCam Video trên DirectShow lên đầu, rồi MSMF cùng tên, rồi DroidCam khác."""

    def key(e: dict):
        name = (e.get("name") or "").lower()
        be = (e.get("backend") or "")
        if "droidcam video" in name and be == "dshow":
            pri = 0
        elif "droidcam video" in name:
            pri = 1
        elif "droidcam" in name:
            pri = 2
        else:
            pri = 3
        pic = 0 if e.get("hasPicture") else 1
        idx = e.get("index") if e.get("index") is not None else 99
        return (pri, pic, be, idx, name)

    return sorted(entries, key=key)


def device_entry(index: int | None, backend: str | None, name: str, *,
                 width: int | None = None, height: int | None = None,
                 in_use: bool = False, has_picture: bool | None = None,
                 opened: bool = False) -> dict:
    spec = WebcamSpec(backend, index, name, "")
    if backend and index is not None:
        url = f"webcam://{backend}/{index}"
    elif backend and name:
        url = spec.url()
    elif index is not None:
        url = f"webcam://{index}"
    else:
        url = spec.url()
    e = {
        "index": index if index is not None else -1,
        "backend": backend or ("v4l2" if not IS_WIN else "auto"),
        "name": name or (f"Webcam {index}" if index is not None else "Webcam"),
        "url": url,
        "inUse": bool(in_use),
    }
    if name:
        be = backend or ("dshow" if IS_WIN else None)
        if be:
            e["urlByName"] = f"webcam://{be}/name/{quote(name, safe='')}"
        else:
            e["urlByName"] = f"webcam://{quote(name, safe='')}"
    if width:
        e["width"] = int(width)
    if height:
        e["height"] = int(height)
    if has_picture is not None:
        e["hasPicture"] = bool(has_picture)
    elif opened:
        e["hasPicture"] = False
    return e


def _public_fields(e: dict) -> dict:
    keys = ("index", "backend", "name", "url", "urlByName", "width", "height",
            "inUse", "hasPicture", "altUrl", "altBackend")
    return {k: e[k] for k in keys if k in e}


def dedupe_by_name(entries: list[dict]) -> list[dict]:
    """Gộp cùng tên, giữ backend thật sự ra được hình (ưu tiên dshow nếu hoà)."""
    groups: dict[str, list[dict]] = {}
    for e in entries:
        key = (e.get("name") or "").strip().lower() or f"#{e.get('backend')}-{e.get('index')}"
        groups.setdefault(key, []).append(e)
    out: list[dict] = []
    for items in groups.values():
        if len(items) == 1:
            out.append(items[0])
            continue

        def score(e: dict):
            name = (e.get("name") or "").lower()
            be = e.get("backend") or ""
            pic = 1 if e.get("hasPicture") else 0
            dshow_bonus = 1 if be == "dshow" else 0
            droid = 1 if "droidcam video" in name and be == "dshow" else 0
            return (pic, droid, dshow_bonus)

        items_sorted = sorted(items, key=score, reverse=True)
        best = dict(items_sorted[0])
        for other in items_sorted[1:]:
            if other.get("url") and other.get("url") != best.get("url"):
                best.setdefault("altUrl", other["url"])
                best.setdefault("altBackend", other.get("backend"))
                break
        out.append(best)
    return out


def _webcam_in_use(spec: WebcamSpec, occupied: list[WebcamSpec]) -> bool:
    for o in occupied:
        if spec.name and o.name and spec.name.lower() == o.name.lower():
            if not spec.backend or not o.backend or spec.backend == o.backend:
                return True
        if spec.index is None or o.index is None or spec.index != o.index:
            continue
        if not spec.backend or not o.backend or spec.backend == o.backend:
            return True
    return False


def probe_spec(spec: WebcamSpec, name: str, occupied: list[WebcamSpec] | None = None,
               in_use_info: list[dict] | None = None, debug: bool = False) -> dict | None:
    """Mở một thiết bị, đọc, rồi đóng trước khi trả về (không giữ song song nhiều webcam)."""
    occupied = occupied or []
    in_use_info = in_use_info or []
    t0 = time.time()
    if _webcam_in_use(spec, occupied):
        e = device_entry(spec.index, spec.backend, name, in_use=True)
        for rec in in_use_info:
            ospec = rec.get("spec")
            if ospec and _webcam_in_use(ospec, [spec]):
                if rec.get("width"):
                    e["width"] = rec["width"]
                if rec.get("height"):
                    e["height"] = rec["height"]
                frame = rec.get("frame")
                if frame is not None:
                    e["hasPicture"] = frames_have_picture([frame])
                    if debug:
                        e.update(_frame_stats(frame))
                break
        e.setdefault("hasPicture", None)
        if debug:
            e["open"] = True
            e["framesRead"] = 0
            e["error"] = "in_use (không mở lại)"
            e["time"] = int((time.time() - t0) * 1000)
        return e

    cap = None
    try:
        cap = open_webcam(spec)
        opened = bool(cap is not None and cap.isOpened())
        info = probe_capture(cap, already_prepared=True)
        if info["ok"]:
            e = device_entry(spec.index, spec.backend, name, width=info["width"], height=info["height"],
                             in_use=False, has_picture=info["has_picture"], opened=True)
        elif name:
            # Có tên từ enum — vẫn liệt kê (hasPicture chỉ mang tính gợi ý).
            e = device_entry(spec.index, spec.backend, name, in_use=False,
                             has_picture=False, opened=opened)
        else:
            # Không có tên thật và không đọc được khung → không bịa 'Webcam 4/5'.
            return None
        if debug:
            e["open"] = opened
            e["framesRead"] = info["frames_read"]
            e["mean"] = info["mean"]
            e["std"] = info["std"]
            e["shape"] = info["shape"]
            e["dtype"] = info["dtype"]
            e["time"] = info["time_ms"]
            e["error"] = info["error"]
        return e
    except Exception as ex:
        if not name:
            return None
        e = device_entry(spec.index, spec.backend, name, in_use=False, has_picture=False)
        if debug:
            e["open"] = False
            e["framesRead"] = 0
            e["error"] = f"{type(ex).__name__}: {ex}"
            e["time"] = int((time.time() - t0) * 1000)
        return e
    finally:
        if cap is not None:
            try:
                cap.release()
            except Exception:
                pass


def list_webcam_devices(*, occupied: list[WebcamSpec] | None = None,
                        in_use_info: list[dict] | None = None,
                        debug: bool = False,
                        max_index: int = 6) -> tuple[list[dict], str | None]:
    """Liệt kê webcam. Mỗi thiết bị được mở, hâm nóng, đọc, rồi đóng trước khi mở cái tiếp theo."""
    occupied = occupied or []
    in_use_info = in_use_info or []
    raw: list[dict] = []

    def add(e: dict | None):
        if e:
            raw.append(e)

    if IS_WIN:
        dshow = dshow_device_names()
        mf_names = mf_device_names()
        print(
            f"[webcams] DirectShow: {len(dshow)} thiết bị, "
            f"Media Foundation (VIDCAP): {len(mf_names)} thiết bị. Dò lần lượt, đóng trước khi mở cái sau.",
            flush=True,
        )
        for i, name in dshow.items():
            add(probe_spec(WebcamSpec("dshow", i, name, ""), name, occupied, in_use_info, debug))
        probed_msmf = set()
        for i, name in enumerate(mf_names):
            add(probe_spec(WebcamSpec("msmf", i, name, ""), name, occupied, in_use_info, debug))
            probed_msmf.add(i)
        # Dù enum VIDCAP lỗi / trả 0 thiết bị, vẫn dò MSMF 0..5 (đóng trước khi mở cái sau).
        for i in range(MSMF_PROBE_MAX):
            if i in probed_msmf:
                continue
            e = probe_spec(WebcamSpec("msmf", i, None, ""), "", occupied, in_use_info, debug)
            if not e:
                continue
            if not e.get("name") or str(e.get("name")).startswith("Webcam "):
                e["name"] = f"MSMF {i}"
            add(e)

        # Chỉ khi cả hai enum đều trống: thử mở vài chỉ số, chỉ giữ cái mở/đọc được.
        if not raw:
            print("[webcams] không enum được tên — dò chỉ số, bỏ qua index không mở được.", flush=True)
            pnp = _pnp_camera_names()
            for i in range(max_index):
                # Không gán tên WMI cho chỉ số MSMF (thứ tự khác OpenCV).
                e = probe_spec(WebcamSpec("msmf", i, None, ""), "", occupied, in_use_info, debug)
                if e and (e.get("hasPicture") or e.get("width") or (debug and e.get("open"))):
                    if not e.get("name") or e["name"].startswith("Webcam "):
                        e["name"] = f"MSMF {i}"
                    add(e)
                e2 = probe_spec(WebcamSpec("dshow", i, None, ""), "", occupied, in_use_info, debug)
                if e2 and (e2.get("hasPicture") or e2.get("width") or (debug and e2.get("open"))):
                    if not e2.get("name") or e2["name"].startswith("Webcam "):
                        e2["name"] = f"DirectShow {i}"
                    add(e2)
            # Tên Camera/Image từ WMI: thử mở theo tên DirectShow (không bịa chỉ số MSMF).
            have = {(e.get("name") or "").lower() for e in raw}
            for name in pnp:
                if not name or name.lower() in have:
                    continue
                di = dshow_index_for_name(name)
                mi = msmf_index_for_name(name)
                if di is not None:
                    add(probe_spec(WebcamSpec("dshow", di, name, ""), name, occupied, in_use_info, debug))
                elif mi is not None:
                    add(probe_spec(WebcamSpec("msmf", mi, name, ""), name, occupied, in_use_info, debug))
                else:
                    # Không bịa url theo tên khi chưa biết chỉ số — vẫn nêu tên nếu resolve sau này.
                    add(probe_spec(WebcamSpec("dshow", None, name, ""), name, occupied, in_use_info, debug))
                have.add(name.lower())
    else:
        names = v4l2_device_names()
        for i, name in names.items():
            add(probe_spec(WebcamSpec(None, i, name, ""), name, occupied, in_use_info, debug))
        # Chỉ dò chỉ số mù nếu hệ thống có V4L2 nhưng không đọc được sysfs name.
        if not names and Path("/sys/class/video4linux").exists():
            for i in range(max_index):
                e = probe_spec(WebcamSpec(None, i, None, ""), "", occupied, in_use_info, debug)
                if e and (e.get("width") or e.get("hasPicture")):
                    add(e)

    merged = sort_webcam_entries(dedupe_by_name(raw))
    hint_parts: list[str] = []
    if IS_WIN and (not merged or not any(e.get("hasPicture") for e in merged)):
        hint_parts.append(PRIVACY_HINT)
    warn = opencv_conflict_warning()
    if warn:
        hint_parts.append(warn)
    hint = " ".join(hint_parts) if hint_parts else None
    if not debug:
        merged = [_public_fields(e) for e in merged]
    return merged, hint


def format_debug_report(devices: list[dict], hint: str | None,
                        env_text: str | None = None) -> str:
    lines = ["CMC AI — liệt kê webcam (debug)", "-" * 72]
    text = format_env_report() if env_text is None else env_text
    if text:
        for ln in text.splitlines():
            lines.append("  " + ln)
        lines.append("-" * 72)
    if not devices:
        lines.append("(không có thiết bị)")
    for e in devices:
        lines.append(
            f"  [{e.get('backend')}/{e.get('index')}] {e.get('name')}\n"
            f"      url={e.get('url')}  urlByName={e.get('urlByName')}\n"
            f"      open={e.get('open')}  framesRead={e.get('framesRead')}  "
            f"hasPicture={e.get('hasPicture')}  inUse={e.get('inUse')}\n"
            f"      mean={e.get('mean')}  std={e.get('std')}  "
            f"shape={e.get('shape')}  dtype={e.get('dtype')}  time={e.get('time')} ms\n"
            f"      error={e.get('error')}"
        )
    if hint:
        lines.append("-" * 72)
        lines.append("HINT: " + hint)
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    """CLI: python -m app.webcams  — in báo cáo debug để dán khi cần hỗ trợ."""
    del argv
    check_env(force=True)
    devices, hint = list_webcam_devices(debug=True)
    sys.stdout.write(format_debug_report(devices, hint))
    sys.stdout.flush()
    return 0 if devices and any(d.get("hasPicture") for d in devices) else 1


if __name__ == "__main__":
    raise SystemExit(main())
