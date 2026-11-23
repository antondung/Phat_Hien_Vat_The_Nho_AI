"""Luồng camera trực tiếp: đọc frame -> model -> quy tắc -> đẩy WebSocket, lưu ảnh chụp + clip cảnh báo.

Nguồn hỗ trợ (theo Camera.sourceType / sourceUrl):
  rtsp   : rtsp://... (camera PTZ)
  webcam : chỉ số thiết bị, vd "0"
  file   : đường dẫn video (tuyệt đối hoặc trong data/media/samples), phát lặp
  file + "dataset://<tên video>" : camera giả phát lại các frame của dataset theo thứ tự (để demo)
"""
import collections
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import os
import cv2
import numpy as np

from .webcams import (
    NO_FRAME_MSG,
    UNIFORM_MSG,
    WebcamSpec,
    classify_webcam_failure,
    describe_attempts,
    device_is_listed,
    frames_have_picture,
    is_uniform_frame,
    list_webcam_devices,
    normalize_frame,
    open_webcam,
    parse_webcam_url,
    probe_capture,
    resize_jpeg,
    uniform_message,
)


def _ffmpeg() -> str:
    """ffmpeg trong PATH, không có thì dùng bản đóng gói sẵn của imageio-ffmpeg (tiện cho Windows)."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"

from . import config, db
from .detector import MockDatasetDetector, get_detector
from .pipeline import FramePipeline
from .phone_zoom import PhoneZoomScheduler, apply_phone_zoom, get_phone_zoom
from .roles import RoleScheduler, get_role_detector
from .realtime import hub
from .rules import RuleEngine, alert_message, default_rules

detect_lock = threading.Lock()


class PushFrames:
    """Khung hình do điện thoại đẩy lên (sourceType "phone", sourceUrl rỗng hoặc "push").
    Chỉ giữ khung MỚI NHẤT của mỗi camera; luồng đọc chờ khung mới."""

    def __init__(self):
        self.cv = threading.Condition()
        self.frames: dict[str, tuple[bytes, float, int]] = {}  # cid -> (jpeg, time, seq)

    def put(self, cid: str, jpeg: bytes):
        with self.cv:
            seq = self.frames.get(cid, (b"", 0.0, 0))[2] + 1
            self.frames[cid] = (jpeg, time.time(), seq)
            self.cv.notify_all()

    def last_time(self, cid: str) -> float:
        return self.frames.get(cid, (b"", 0.0, 0))[1]

    def wait(self, cid: str, after_seq: int, timeout: float):
        end = time.time() + timeout
        with self.cv:
            while True:
                f = self.frames.get(cid)
                if f and f[2] > after_seq:
                    return f
                left = end - time.time()
                if left <= 0:
                    return None
                self.cv.wait(left)


push_frames = PushFrames()
PUSH_IDLE_SEC = 5.0


def is_push(source_type: str, url: str | None) -> bool:
    return source_type == "phone" and (not url or url.strip().lower() in ("push", "push://"))
_dataset: MockDatasetDetector | None = None


def dataset() -> MockDatasetDetector:
    global _dataset
    if _dataset is None:
        _dataset = MockDatasetDetector(config.DATASET_DIR)
    return _dataset


def run_detect(frame, hint=None, run_pose: bool = True) -> dict:
    with detect_lock:
        return get_detector().detect(frame, hint, run_pose=run_pose)


def run_roles(frame) -> list[dict] | None:
    """Model vai trò (giám thị/thí sinh) dưới cùng detect_lock. None nếu không bật."""
    rd = get_role_detector()
    if not rd.enabled:
        return None
    with detect_lock:
        return rd.detect(frame)


def analyse_frame(pipe: FramePipeline, frame, hint=None, sched: RoleScheduler | None = None,
                  run_pose: bool = True, raw: dict | None = None,
                  zoom_sched: PhoneZoomScheduler | None = None):
    """DET(+pose) → (mỗi N khung) model vai trò → pipeline → lượt zoom điện thoại.
    Dùng chung cho camera, /api/analysis và jobs."""
    if raw is None:
        raw = run_detect(frame, hint, run_pose=run_pose)
    rd = get_role_detector()
    roles = None
    if rd.enabled and (sched is None or sched.due()):
        roles = run_roles(frame)
        if sched is not None:
            sched.note(rd.last_ms)
    fw = fh = None
    try:
        fh, fw = int(frame.shape[0]), int(frame.shape[1])
    except Exception:
        pass
    objects, poses = pipe.run(raw, roles=roles, role_enabled=rd.enabled,
                              frame_wh=(fw, fh) if fw and fh else None)
    objects = apply_phone_zoom(frame, objects, poses, sched=zoom_sched, lock=detect_lock)
    return objects, poses


def rules_settings() -> dict:
    return db.setting_get("rules") or default_rules()


def now_ms() -> int:
    return int(time.time() * 1000)


class Source:
    """Đọc frame từ một nguồn. read() -> (ok, frame, hint)."""

    def __init__(self, source_type: str, url: str, cam_id: str | None = None):
        self.type, self.url, self.cam_id = source_type, (url or ""), cam_id
        self.push = is_push(source_type, url)
        self.push_seq = 0
        self.cap = None
        self.ds_frames: list[str] = []
        self.ds_i = 0
        self.frame_interval = 0.0
        self._last = 0.0

    def open(self) -> bool:
        if self.push:  # online khi điện thoại vừa gửi khung trong vài giây gần đây
            return bool(self.cam_id) and time.time() - push_frames.last_time(self.cam_id) < PUSH_IDLE_SEC
        if self.url.startswith("dataset://"):
            vid = self.url[len("dataset://"):]
            self.ds_frames = dataset().videos().get(vid, [])
            self.frame_interval = 1.0 / config.DATASET_STREAM_FPS
            return bool(self.ds_frames)
        if self.type == "webcam":
            self.cap = open_webcam(self.url or "0")
        elif self.type == "file":
            p = Path(self.url)
            if not p.is_absolute():
                p = config.MEDIA_DIR / "samples" / self.url
            self.cap = cv2.VideoCapture(str(p))
            fps = self.cap.get(cv2.CAP_PROP_FPS) or 25
            self.frame_interval = 1.0 / fps
        else:  # rtsp://, http(s)://.../video (IP Webcam, DroidCam MJPEG qua Wi-Fi)
            self.cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        if self.cap is not None:
            try:
                if self.type != "file":
                    self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)  # camera thật: giữ khung mới nhất, không dồn trễ
                # DroidCam Wi-Fi / RTSP: không để test-connection hoặc mất mạng làm treo lâu
                if self.type not in ("webcam", "file") and hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
                    self.cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                    self.cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)
            except Exception:
                pass
        return bool(self.cap and self.cap.isOpened())

    def read(self):
        if self.push:
            f = push_frames.wait(self.cam_id, self.push_seq, PUSH_IDLE_SEC)
            if not f:
                return False, None, None
            self.push_seq = f[2]
            frame = cv2.imdecode(np.frombuffer(f[0], np.uint8), cv2.IMREAD_COLOR)
            return frame is not None, frame, None
        if self.frame_interval:
            wait = self._last + self.frame_interval - time.time()
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
        if self.ds_frames:
            stem = self.ds_frames[self.ds_i % len(self.ds_frames)]
            self.ds_i += 1
            frame = cv2.imread(str(dataset().index[stem]["image"]))
            return frame is not None, frame, stem
        ok, frame = self.cap.read() if self.cap is not None else (False, None)
        if not ok and self.type == "file" and self.cap is not None:  # phát lặp
            self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ok, frame = self.cap.read()
        # HTTP/RTSP (DroidCam Wi-Fi chỉ cho 1 client): thử mở lại một lần trước khi bỏ
        if (not ok or frame is None) and self.type not in ("file", "webcam") and not self.push and not self.ds_frames:
            self.close()
            if self.open():
                ok, frame = self.cap.read() if self.cap is not None else (False, None)
        if ok and frame is not None:
            frame = normalize_frame(frame)
            ok = frame is not None
        return ok, frame, None

    def close(self):
        if self.cap is not None:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None


def _small(frame, max_w=1280):
    h, w = frame.shape[:2]
    if w > max_w:
        frame = cv2.resize(frame, (max_w, int(h * max_w / w)))
    return frame


def encode_clip(jpegs: list[bytes], fps: float, out: Path):
    """Ghép các frame JPEG thành mp4 H.264 (phát được trên trình duyệt)."""
    if not jpegs:
        return
    tmp = Path(tempfile.mkdtemp())
    try:
        for i, b in enumerate(jpegs):
            (tmp / f"{i:05d}.jpg").write_bytes(b)
        subprocess.run([_ffmpeg(), "-y", "-loglevel", "error", "-framerate", f"{max(fps, 1):.2f}", "-i",
                        str(tmp / "%05d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(out)], check=False, timeout=120)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _encode_and_publish(aid: str, frames: list[bytes], fps: float):
    out = config.MEDIA_DIR / "alerts" / f"{aid}.mp4"
    tmp = out.with_suffix(".tmp.mp4")
    encode_clip(frames, fps, tmp)
    if not tmp.exists() or tmp.stat().st_size == 0:
        return
    tmp.replace(out)  # đổi tên nguyên tử: file chỉ xuất hiện khi đã ghi xong
    a = db.alert_get(aid)
    if a:
        a["clipUrl"] = f"/media/alerts/{aid}.mp4"
        db.alert_save(a)
        hub.publish("alert_update", a)


class CameraWorker(threading.Thread):
    def __init__(self, cam: dict):
        super().__init__(daemon=True, name=f"cam-{cam['id']}")
        self.cam = cam
        self.stop_evt = threading.Event()
        self.online = False
        self.fps = 0.0
        self.latency_ms = 0
        self.latest_jpeg: bytes | None = None
        self.frame_size = (0, 0)
        self.frame_id = 0
        self._snap_cache: tuple[int, int, int, bytes] | None = None  # frame_id, max_w, quality, jpg
        self.detect_fps = 0.0
        self.last_detect_ts = 0
        self.frames_read = 0
        self.analysed_frames = 0
        self.last_objects = 0
        self.last_error: str | None = None
        self.last_ok_detect_ts = 0
        self._started_loop = False
        self._last_diag_log = 0.0
        self._pose_i = 0
        self._last_raw_poses: list = []
        self.ring: collections.deque = collections.deque()
        self.pending_clips: list[dict] = []
        self.clip_lock = threading.Lock()
        self._latest = None
        self._new_evt = threading.Event()
        self.pipeline = FramePipeline()
        self.rules = RuleEngine()
        self.role_sched = RoleScheduler()
        self.zoom_sched = PhoneZoomScheduler()

    def detector_state(self) -> str:
        if self.last_error and (not self.last_ok_detect_ts or now_ms() - self.last_ok_detect_ts > 8000):
            return "error"
        if not self._started_loop:
            return "not_started"
        if self.frames_read == 0 or not self.online:
            return "no_frames"
        return "running"

    def diag(self) -> dict:
        return {
            "cameraId": self.cam["id"],
            "online": self.online,
            "framesRead": self.frames_read,
            "analysedFrames": self.analysed_frames,
            "detectFps": round(self.detect_fps, 2),
            "lastDetectTs": self.last_detect_ts or None,
            "lastObjects": self.last_objects,
            "inferMs": self.latency_ms,
            "lastError": self.last_error,
            "detector": self.detector_state(),
            "roleEnabled": bool(self.pipeline.role_enabled),
            "roleInferMs": round(self.role_sched.ema_ms, 1),
            "roleEveryN": self.role_sched.n,
            "roleCounts": dict(self.pipeline.last_counts),
            "phoneZoom": bool(config.PHONE_ZOOM),
            "phoneZoomInferMs": round(self.zoom_sched.ema_ms, 1),
            "phoneZoomCrops": get_phone_zoom().last_crops,
            "phoneZoomEveryN": self.zoom_sched.n,
            "fps": round(self.fps, 1) if self.online else 0,
            "updatedAt": now_ms(),
        }

    def status(self) -> dict:
        """Trạng thái gửi qua WS camera_status / GET /api/cameras/status (kèm chẩn đoán)."""
        d = self.diag()
        d["latencyMs"] = self.latency_ms if self.online else 0
        return d

    @staticmethod
    def idle_diag(cid: str) -> dict:
        return {"cameraId": cid, "online": False, "framesRead": 0, "analysedFrames": 0,
                "detectFps": 0, "lastDetectTs": None, "lastObjects": 0, "inferMs": 0,
                "lastError": None, "detector": "not_started", "fps": 0, "latencyMs": 0,
                "phoneZoom": bool(config.PHONE_ZOOM), "phoneZoomInferMs": 0,
                "phoneZoomCrops": 0, "phoneZoomEveryN": config.PHONE_ZOOM_EVERY_N,
                "updatedAt": now_ms()}

    def jpeg_at(self, max_w: int | None = None, quality: int = 70) -> bytes | None:
        """JPEG mới nhất, tuỳ chọn thu nhỏ theo chiều rộng (có cache theo frame)."""
        jpg = self.latest_jpeg
        fid = self.frame_id
        if jpg is None:
            return None
        w = int(max_w or 0)
        if w <= 0:
            return jpg
        cache = self._snap_cache
        if cache and cache[0] == fid and cache[1] == w and cache[2] == quality:
            return cache[3]
        out = resize_jpeg(jpg, w, quality)
        self._snap_cache = (fid, w, int(quality), out)
        return out

    def _note_detect_fps(self, t_end: float, t_start: float):
        dt = max(t_end - t_start, 1e-3)
        # EMA theo khoảng cách giữa các lần phân tích (không phải thời gian chạy model)
        inst = 1.0 / dt
        self.detect_fps = 0.8 * self.detect_fps + 0.2 * inst if self.detect_fps else inst
        self.last_detect_ts = now_ms()

    def _maybe_log_diag(self):
        now = time.time()
        if now - self._last_diag_log < 5:
            return
        self._last_diag_log = now
        err = self.last_error or "-"
        print(
            f"cam {self.cam['id']}: read {self.frames_read} frames, analysed {self.analysed_frames}, "
            f"objects {self.last_objects}, infer {self.latency_ms} ms, err {err}",
            flush=True,
        )

    def _emit_detections(self, objects, poses, ts, fid, w, h):
        # Toạ độ bbox/keypoint là pixel trên khung nguồn kích thước frameW × frameH (cùng hệ với width/height).
        fr = {"cameraId": self.cam["id"], "frameId": fid, "ts": ts, "frameTs": ts, "serverTs": now_ms(),
              "width": w, "height": h, "frameW": w, "frameH": h, "coord": "px",
              "objects": objects, "poses": poses,
              "roleEnabled": bool(self.pipeline.role_enabled),
              "roleCounts": dict(self.pipeline.last_counts) if objects or poses else
              {"invigilator": 0, "student": 0, "unknown": 0}}
        hub.publish("detections", fr, camera_id=self.cam["id"])
        return fr

    def _publish_empty(self, reason: str = "offline"):
        """Gửi detections rỗng để FE xoá lớp phủ khi mất hình / che camera / rớt nguồn."""
        w, h = self.frame_size if self.frame_size[0] else (0, 0)
        self._emit_detections([], [], now_ms(), self.frame_id, w, h)

    def stop(self):
        self.stop_evt.set()

    def run(self):
        backoff = 1.0
        while not self.stop_evt.is_set():
            self._maybe_log_diag()
            src = Source(self.cam["sourceType"], self.cam.get("sourceUrl"), self.cam["id"])
            if not src.open():
                self.online = False
                src.close()
                self.stop_evt.wait(0.5 if src.push else backoff)
                backoff = min(backoff * 2, 15)
                continue
            backoff = 1.0
            self.online = True
            self._loop(src)
            src.close()
            self.online = False
            self.detect_fps = 0.0
            try:
                self._publish_empty("disconnected")
            except Exception as e:
                print(f"[{self.cam['id']}] không gửi được detections rỗng khi rớt nguồn: {e}", flush=True)

    def _loop(self, src: Source):
        """Luồng đọc khung: chỉ đọc + mã hoá JPEG + đẩy MJPEG/clip, không chờ model.
        Một luồng phân tích riêng lấy khung MỚI NHẤT theo DETECT_FPS (áp dụng cho mọi nguồn, kể cả dataset)."""
        self._latest = None
        self._new_evt = threading.Event()
        alive = threading.Event()
        alive.set()
        det = threading.Thread(target=self._detect_loop, args=(alive,), daemon=True, name=f"det-{self.cam['id']}")
        det.start()
        self._started_loop = True
        t_prev = time.time()
        try:
            while not self.stop_evt.is_set():
                ok, frame, hint = src.read()
                if not ok or frame is None:
                    return
                t = time.time()
                self.fps = 0.9 * self.fps + 0.1 * (1.0 / max(t - t_prev, 1e-3)) if self.fps else 1.0 / max(t - t_prev, 1e-3)
                t_prev = t
                ts = now_ms()
                self.frame_id += 1
                self.frames_read += 1
                self._maybe_log_diag()
                h, w = frame.shape[:2]
                self.frame_size = (w, h)
                jpg = cv2.imencode(".jpg", _small(frame), [cv2.IMWRITE_JPEG_QUALITY, 75])[1].tobytes()
                self.latest_jpeg = jpg
                with self.clip_lock:
                    self.ring.append((ts, jpg))
                    while self.ring and ts - self.ring[0][0] > config.CLIP_PRE_SEC * 1000:
                        self.ring.popleft()
                    self._feed_clips(ts, jpg)
                self._latest = (frame, hint, ts, self.frame_id, w, h)
                self._new_evt.set()
        finally:
            alive.clear()
            self._new_evt.set()
            det.join(timeout=5)

    def _detect_loop(self, alive: threading.Event):
        """Chạy cho mọi nguồn (webcam://dshow|msmf, http, rtsp, phone, file)."""
        last_detect = 0.0
        while alive.is_set() and not self.stop_evt.is_set():
            self._new_evt.wait(1.0)
            self._new_evt.clear()
            if not alive.is_set() or self._latest is None:
                continue
            wait = last_detect + 1.0 / max(config.DETECT_FPS, 0.01) - time.time()
            if wait > 0 and self.stop_evt.wait(wait):
                return
            item, self._latest = self._latest, None
            if item is None:
                continue
            frame, hint, ts, fid, w, h = item
            t0 = time.time()
            # Che camera / khung màu đặc: không chạy model, vẫn gửi list rỗng để lớp phủ biến mất
            if is_uniform_frame(frame):
                self.latency_ms = int((time.time() - t0) * 1000)
                self._note_detect_fps(t0, last_detect or t0 - 1.0 / max(config.DETECT_FPS, 1))
                last_detect = t0
                self.analysed_frames += 1
                self.last_objects = 0
                self.last_ok_detect_ts = now_ms()
                self.last_error = None
                self.pipeline.clear_roles()
                self._emit_detections([], [], ts, fid, w, h)
                self._maybe_log_diag()
                continue
            try:
                # Khung BGR gốc (OpenCV). YOLO tự đảo BGR→RGB; box trả về theo frameW×frameH (không phải imgsz).
                run_pose = (self._pose_i % max(config.POSE_EVERY_N, 1) == 0)
                self._pose_i += 1
                raw = run_detect(frame, hint, run_pose=run_pose)
                if not run_pose and self._last_raw_poses:
                    raw = {**raw, "poses": self._last_raw_poses}
                elif raw.get("poses"):
                    self._last_raw_poses = raw["poses"]
                objects, poses = analyse_frame(self.pipeline, frame, hint, self.role_sched, raw=raw,
                                               zoom_sched=self.zoom_sched)
            except Exception as e:
                # Ghi log + lastError; không nuốt im. Không để một khung làm chết luồng camera.
                import traceback
                self.last_error = f"{type(e).__name__}: {e}"
                print(f"[{self.cam['id']}] detect error: {self.last_error}", flush=True)
                traceback.print_exc()
                last_detect = t0
                self._maybe_log_diag()
                continue
            self.latency_ms = int((time.time() - t0) * 1000)
            self._note_detect_fps(time.time(), last_detect or t0 - 1.0 / max(config.DETECT_FPS, 1))
            last_detect = t0
            self.analysed_frames += 1
            self.last_objects = len(objects)
            self.last_ok_detect_ts = now_ms()
            self.last_error = None
            fr = self._emit_detections(objects, poses, ts, fid, w, h)
            self._maybe_log_diag()
            for c in self.rules.process(fr, rules_settings(), self.cam["room"]):
                self._fire(c, ts, frame)

    def _fire(self, c: dict, ts: int, frame):
        aid = f"al-{datetime.now():%Y%m%d}-{uuid.uuid4().hex[:6]}"
        cv2.imwrite(str(config.MEDIA_DIR / "alerts" / f"{aid}.jpg"), _small(frame), [cv2.IMWRITE_JPEG_QUALITY, 85])
        alert = {"id": aid, "cameraId": self.cam["id"], "cameraName": self.cam["name"], "room": self.cam["room"],
                 "type": c["type"], "level": c["level"], "status": "moi", "trackId": c["trackId"],
                 "objectId": c.get("objectId"), "confidence": c["confidence"], "ts": ts, "startedAt": c["startedAt"],
                 "message": alert_message(c["type"], c["trackId"]), "personBbox": c.get("personBbox"),
                 "objectBbox": c.get("objectBbox"), "snapshotUrl": f"/media/alerts/{aid}.jpg",
                 "clipUrl": None}  # có sau khi ghép clip xong, BE đẩy alert_update kèm clipUrl
        db.alert_save(alert)
        hub.publish("alert", alert)
        with self.clip_lock:
            self.pending_clips.append({"id": aid, "until": ts + config.CLIP_POST_SEC * 1000,
                                       "frames": [j for _, j in self.ring]})

    def _feed_clips(self, ts: int, jpg: bytes):
        done = []
        for p in self.pending_clips:
            p["frames"].append(jpg)
            if ts >= p["until"]:
                done.append(p)
        for p in done:
            self.pending_clips.remove(p)
            fps = len(p["frames"]) / (config.CLIP_PRE_SEC + config.CLIP_POST_SEC)
            threading.Thread(target=_encode_and_publish, daemon=True, args=(p["id"], p["frames"], fps)).start()


class StreamManager:
    def __init__(self):
        self.workers: dict[str, CameraWorker] = {}
        self.lock = threading.Lock()
        self._status_thread = None

    def sync(self):
        """Khởi động/dừng luồng theo danh sách camera đang bật."""
        cams = {c["id"]: c for c in db.cameras_all() if c.get("enabled")
                and (config.SAMPLE_CAMERAS or not str(c.get("sourceUrl") or "").startswith("dataset://"))}
        with self.lock:
            for cid in list(self.workers):
                w = self.workers[cid]
                c = cams.get(cid)
                if not c or (c["sourceType"], c.get("sourceUrl")) != (w.cam["sourceType"], w.cam.get("sourceUrl")):
                    w.stop()
                    del self.workers[cid]
                else:
                    w.cam = c  # đổi tên / phòng không cần khởi động lại
            for cid, c in cams.items():
                if cid not in self.workers:
                    w = CameraWorker(c)
                    self.workers[cid] = w
                    w.start()

    def statuses(self) -> list[dict]:
        out = []
        for c in db.cameras_all():
            w = self.workers.get(c["id"])
            out.append(w.status() if w else CameraWorker.idle_diag(c["id"]))
        return out

    def start_status_loop(self):
        def loop():
            while True:
                time.sleep(2)
                hub.publish("camera_status", self.statuses())
        self._status_thread = threading.Thread(target=loop, daemon=True)
        self._status_thread.start()

    def stop_all(self):
        with self.lock:
            for w in self.workers.values():
                w.stop()
            self.workers.clear()


manager = StreamManager()


def _occupied_webcam_specs() -> list[WebcamSpec]:
    out: list[WebcamSpec] = []
    for w in manager.workers.values():
        if w.cam.get("sourceType") == "webcam":
            out.append(parse_webcam_url(w.cam.get("sourceUrl") or "0"))
    return out


def _in_use_webcam_info() -> list[dict]:
    """Khung/kích thước của camera đang chạy — không mở lại thiết bị (DroidCam 1 client)."""
    recs = []
    for w in manager.workers.values():
        if w.cam.get("sourceType") != "webcam":
            continue
        rec = {"spec": parse_webcam_url(w.cam.get("sourceUrl") or "0")}
        if w.frame_size and w.frame_size[0]:
            rec["width"], rec["height"] = w.frame_size
        if w.latest_jpeg:
            arr = cv2.imdecode(np.frombuffer(w.latest_jpeg, np.uint8), cv2.IMREAD_COLOR)
            if arr is not None:
                rec["frame"] = arr
        recs.append(rec)
    return recs


def list_webcams(max_index: int = 6, debug: bool = False):
    """Webcam máy chạy BE. Mặc định trả list (tương thích FE).

    debug=True → {"devices":[...], "hint": str|null} với mean/std/shape/dtype/time/error.
    """
    devices, hint = list_webcam_devices(
        occupied=_occupied_webcam_specs(),
        in_use_info=_in_use_webcam_info(),
        debug=bool(debug),
        max_index=max_index,
    )
    if debug:
        return {"devices": devices, "hint": hint}
    return devices


def test_connection(source_type: str, url: str, cam_id: str | None = None) -> dict:
    """Mở nguồn, đọc vài khung, rồi đóng ngay (DroidCam Wi-Fi chỉ cho một client cùng lúc)."""
    t0 = time.time()
    if is_push(source_type, url):
        age = time.time() - push_frames.last_time(cam_id or "")
        if cam_id and age < PUSH_IDLE_SEC:
            return {"ok": True, "message": "Đang nhận hình từ điện thoại", "latencyMs": int(age * 1000)}
        return {"ok": False, "message": "Chưa nhận được hình từ điện thoại. Mở trang camera trên điện thoại và bấm Bắt đầu."}
    src = Source(source_type, url)
    try:
        if not src.open():
            if (source_type or "").lower() == "webcam":
                spec = parse_webcam_url(url or "0")
                reason, msg = classify_webcam_failure(
                    listed=device_is_listed(spec), opened=False, got_frames=False, name=spec.name)
                return {"ok": False, "message": msg, "reason": reason}
            return {"ok": False, "message": "Không mở được nguồn video. Kiểm tra lại địa chỉ hoặc mạng.",
                    "reason": "no_open"}
        if (source_type or "").lower() == "webcam" and src.cap is not None:
            info = probe_capture(src.cap, already_prepared=False)
            fps = src.cap.get(cv2.CAP_PROP_FPS) if src.cap is not None else 0
            base = {"latencyMs": int((time.time() - t0) * 1000),
                    "fps": round(fps or 0, 1), "hasPicture": bool(info.get("has_picture"))}
            if info.get("width") and info.get("height"):
                base["resolution"] = f"{info['width']}×{info['height']}"
            if not info.get("ok"):
                spec = parse_webcam_url(url or "0")
                reason, msg = classify_webcam_failure(
                    listed=device_is_listed(spec), opened=True, got_frames=False, name=spec.name)
                return {"ok": False, "message": msg, "reason": reason, **base}
            if not base["hasPicture"]:
                # hasPicture chỉ mang tính gợi ý — không chặn Lưu phía BE.
                spec = parse_webcam_url(url or "0")
                msg = uniform_message(spec.name) + describe_attempts()
                return {"ok": True, "message": msg, "reason": "uniform", **base}
            return {"ok": True, "message": "Kết nối thành công", "reason": "ok", **base}

        frames = []
        for i in range(5):
            ok, frame, _ = src.read()
            if not ok or frame is None:
                break
            frames.append(frame)
            if frames_have_picture(frames):
                break
            if i == 0:
                time.sleep(0.05)
        if not frames:
            return {"ok": False, "message": NO_FRAME_MSG, "reason": "no_frames"}
        frame = frames[-1]
        h, w = frame.shape[:2]
        fps = src.cap.get(cv2.CAP_PROP_FPS) if src.cap is not None else config.DATASET_STREAM_FPS
        base = {"latencyMs": int((time.time() - t0) * 1000), "resolution": f"{w}×{h}",
                "fps": round(fps or 0, 1), "hasPicture": frames_have_picture(frames)}
        if not base["hasPicture"]:
            msg = (
                "Kết nối được nhưng không có hình (khung màu đặc). Nếu dùng DroidCam Wi-Fi, "
                "đóng mọi tab/ứng dụng khác đang xem http://IP:4747/video rồi thử lại.")
            return {"ok": False, "message": msg, "reason": "uniform", **base}
        return {"ok": True, "message": "Kết nối thành công", "reason": "ok", **base}
    finally:
        src.close()
        # DroidCam chỉ cho 1 client: nhường nguồn cho luồng thật mở ngay sau khi Kiểm tra
        if (source_type or "").lower() in ("rtsp", "http") or str(url).lower().startswith(("http://", "https://", "rtsp://")):
            time.sleep(0.08)
