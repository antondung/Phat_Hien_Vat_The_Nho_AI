"""Phân tích streaming cho màn Phân tích: job nền, hàng đợi 1 job, WS tiến độ."""
from __future__ import annotations

import shutil
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import cv2

from . import analysis, config
from .pipeline import FramePipeline, analysis_frame
from .rules import RuleEngine
from .phone_zoom import PhoneZoomScheduler
from .roles import RoleScheduler
from .streams import analyse_frame, rules_settings, run_detect

JOB_TTL_SEC = 3600
WS_BATCH_SEC = 0.5
JOBS_DIR = config.MEDIA_DIR / "jobs"


@dataclass
class AnalysisJob:
    job_id: str
    file_name: str
    media_type: str
    media_url: str
    path: Path
    width: int
    height: int
    fps: float
    duration: float
    model: dict
    hints: list | None = None
    hint: str | None = None
    status: str = "queued"  # queued | running | done | error
    progress: float = 0.0
    analysed_sec: float = 0.0
    frames: list = field(default_factory=list)
    alerts: list = field(default_factory=list)
    message: str | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    cancel: threading.Event = field(default_factory=threading.Event)
    total_frames: int = 0
    total_alerts: int = 0


_lock = threading.RLock()
_jobs: dict[str, AnalysisJob] = {}
_queue: deque[str] = deque()
_wake = threading.Event()
_stop = threading.Event()
_worker: threading.Thread | None = None


def _ensure_dir() -> None:
    JOBS_DIR.mkdir(parents=True, exist_ok=True)


def _safe_ext(name: str | None) -> str:
    ext = Path(name or "").suffix.lower() or ".bin"
    if len(ext) > 8 or any(c in ext for c in r'/\ '):
        return ".bin"
    return ext


def probe_media(path: Path) -> dict:
    """Đọc metadata nhanh (không chạy model)."""
    ext = path.suffix.lower()
    if ext in analysis.IMAGE_EXT:
        im = cv2.imread(str(path))
        if im is None:
            raise ValueError("Không đọc được ảnh")
        h, w = im.shape[:2]
        return {"mediaType": "image", "width": int(w), "height": int(h), "fps": 0, "duration": 0}
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("Không đọc được video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    if w <= 0 or h <= 0:
        raise ValueError("Không đọc được video")
    duration = round((total / fps) if fps else 0.0, 2)
    return {"mediaType": "video", "width": w, "height": h, "fps": round(float(fps), 2), "duration": duration}


def public_create(job: AnalysisJob) -> dict:
    return {
        "jobId": job.job_id,
        "fileName": job.file_name,
        "mediaType": job.media_type,
        "mediaUrl": job.media_url,
        "width": job.width,
        "height": job.height,
        "fps": job.fps,
        "duration": job.duration,
        "model": job.model,
    }


def public_status(job: AnalysisJob, since: float | None = None) -> dict:
    if since is None:
        frames = list(job.frames)
        alerts = list(job.alerts)
    else:
        frames = [f for f in job.frames if f["t"] > since]
        alerts = [a for a in job.alerts if a["t"] > since]
    return {
        "status": job.status,
        "progress": job.progress,
        "analysedSec": job.analysed_sec,
        "frames": frames,
        "alerts": alerts,
        "message": job.message,
    }


def get_job(job_id: str) -> AnalysisJob | None:
    expire_jobs()
    with _lock:
        return _jobs.get(job_id)


def media_file(job_id: str, filename: str) -> Path | None:
    job = get_job(job_id)
    if not job:
        return None
    path = (job.path.parent / filename).resolve()
    try:
        path.relative_to(JOBS_DIR.resolve())
    except ValueError:
        return None
    return path if path.is_file() else None


def create_job(*, src: Path, file_name: str, hints: list | None = None, hint: str | None = None) -> AnalysisJob:
    """Lưu file, đọc metadata, xếp hàng — trả ngay, không chờ phân tích."""
    expire_jobs()
    _ensure_dir()
    job_id = f"aj-{uuid.uuid4().hex[:12]}"
    dest_dir = JOBS_DIR / job_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    ext = _safe_ext(file_name or src.name)
    dest = dest_dir / f"source{ext}"
    if src.resolve() != dest.resolve():
        shutil.copy2(src, dest)
    try:
        meta = probe_media(dest)
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise
    job = AnalysisJob(
        job_id=job_id,
        file_name=file_name or dest.name,
        media_type=meta["mediaType"],
        media_url=f"/media/jobs/{job_id}/{dest.name}",
        path=dest,
        width=meta["width"],
        height=meta["height"],
        fps=meta["fps"],
        duration=meta["duration"],
        model=analysis._model_names(),
        hints=hints,
        hint=hint,
    )
    with _lock:
        _jobs[job_id] = job
        _queue.append(job_id)
    _wake.set()
    ensure_worker()
    return job


def create_from_upload(upload_path: Path, file_name: str) -> AnalysisJob:
    hint = None
    if upload_path.suffix.lower() in analysis.IMAGE_EXT:
        stem = Path(file_name).stem
        from .streams import dataset
        hint = stem if stem in dataset().index else None
    return create_job(src=upload_path, file_name=file_name, hint=hint)


def create_from_sample(sample: str) -> AnalysisJob:
    if sample == "sample-image":
        p, stem = analysis.sample_image()
        return create_job(src=p, file_name=p.name, hint=stem)
    if sample == "sample-video":
        p, stems = analysis.sample_video()
        return create_job(src=p, file_name=p.name, hints=stems)
    raise ValueError("Mẫu không hợp lệ")


def delete_job(job_id: str) -> bool:
    """Huỷ (nếu đang chạy/chờ) và xoá file + kết quả. True nếu job tồn tại."""
    with _lock:
        job = _jobs.pop(job_id, None)
        try:
            _queue.remove(job_id)
        except ValueError:
            pass
    if not job:
        return False
    job.cancel.set()
    _remove_files(job)
    return True


def _remove_files(job: AnalysisJob) -> None:
    folder = job.path.parent if job.path else (JOBS_DIR / job.job_id)
    try:
        if folder.exists() and folder.resolve().is_relative_to(JOBS_DIR.resolve()):
            shutil.rmtree(folder, ignore_errors=True)
    except Exception:
        try:
            if job.path.exists():
                job.path.unlink()
        except Exception:
            pass


def expire_jobs() -> None:
    now = time.time()
    with _lock:
        old = [j for j in _jobs.values() if (now - j.created_at) >= JOB_TTL_SEC]
    for j in old:
        delete_job(j.job_id)


def ensure_worker() -> None:
    global _worker
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _stop.clear()
        _worker = threading.Thread(target=_worker_loop, name="analysis-jobs", daemon=True)
        _worker.start()


def start() -> None:
    """Gọi lúc startup: xoá file job còn sót từ process trước, chạy worker."""
    _ensure_dir()
    # Restart: không còn job trong bộ nhớ — dọn file cũ.
    try:
        for p in list(JOBS_DIR.iterdir()):
            if p.is_dir():
                shutil.rmtree(p, ignore_errors=True)
            else:
                p.unlink(missing_ok=True)
    except Exception:
        pass
    ensure_worker()


def stop() -> None:
    _stop.set()
    _wake.set()
    th = _worker
    if th is not None and th.is_alive() and threading.current_thread() is not th:
        th.join(timeout=2)


def reset() -> None:
    """Dùng trong test: huỷ mọi job, xoá file, giữ worker."""
    with _lock:
        ids = list(_jobs)
    for jid in ids:
        delete_job(jid)
    with _lock:
        _jobs.clear()
        _queue.clear()
    _ensure_dir()


def _next_job() -> AnalysisJob | None:
    with _lock:
        while _queue:
            jid = _queue.popleft()
            job = _jobs.get(jid)
            if job and not job.cancel.is_set() and job.status == "queued":
                return job
        return None


def _worker_loop() -> None:
    while not _stop.is_set():
        expire_jobs()
        job = _next_job()
        if job is None:
            _wake.wait(timeout=1.0)
            _wake.clear()
            continue
        try:
            _run_job(job)
        except Exception as e:
            if get_job(job.job_id) is job and not job.cancel.is_set():
                job.status = "error"
                job.message = str(e) or "Lỗi phân tích"
                job.finished_at = time.time()


def _alive(job: AnalysisJob) -> bool:
    if job.cancel.is_set() or _stop.is_set():
        return False
    with _lock:
        return _jobs.get(job.job_id) is job


def _run_job(job: AnalysisJob) -> None:
    if not _alive(job):
        return
    job.status = "running"
    job.progress = 0.0
    try:
        if job.media_type == "image":
            _run_image(job)
        else:
            _run_video(job)
        if not _alive(job):
            return
        job.progress = 1.0
        job.status = "done"
        job.total_frames = len(job.frames)
        job.total_alerts = len(job.alerts)
        job.finished_at = time.time()
    except Exception as e:
        if not _alive(job):
            return
        job.status = "error"
        job.message = str(e) or "Lỗi phân tích"
        job.finished_at = time.time()


def _span(job: AnalysisJob) -> float:
    if job.media_type == "image":
        return 0.0
    return max(min(job.duration or 0.0, config.ANALYSIS_MAX_SEC), 1e-6)


def _run_image(job: AnalysisJob) -> None:
    frame = cv2.imread(str(job.path))
    if frame is None:
        raise ValueError("Không đọc được ảnh")
    if not _alive(job):
        return
    pipe = FramePipeline()
    objects, poses = analyse_frame(pipe, frame, job.hint, None, raw=run_detect(frame, job.hint))
    time.sleep(0)
    if not _alive(job):
        return
    fr = {"ts": 0, "width": job.width, "height": job.height, "coord": "px", "objects": objects, "poses": poses,
          "roleEnabled": pipe.role_enabled}
    cands = RuleEngine().process(fr, rules_settings(), room="", ignore_persist=True)
    rec = analysis_frame(0, objects, poses, pipe)
    alerts = [analysis._alert(c, 0) for c in cands]
    job.frames.append(rec)
    job.alerts.extend(alerts)
    job.analysed_sec = 0.0
    job.progress = 1.0
    job.total_frames = 1
    job.total_alerts = len(job.alerts)


def _run_video(job: AnalysisJob) -> None:
    cap = cv2.VideoCapture(str(job.path))
    if not cap.isOpened():
        raise ValueError("Không đọc được video")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or job.fps or 25
        step = max(1, round(fps / config.ANALYSIS_FPS))
        pipe, eng = FramePipeline(), RuleEngine()
        sched = RoleScheduler(fps=config.ANALYSIS_FPS)
        zoom_sched = PhoneZoomScheduler(fps=config.ANALYSIS_FPS)
        settings = rules_settings()
        w, h = job.width, job.height
        idx = 0
        span = _span(job)
        while _alive(job):
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            t = idx / fps
            if t > config.ANALYSIS_MAX_SEC:
                break
            if idx % step == 0:
                hint = job.hints[idx] if job.hints and idx < len(job.hints) else None
                objects, poses = analyse_frame(pipe, frame, hint, sched, raw=run_detect(frame, hint),
                                               zoom_sched=zoom_sched)
                # Nhường detect_lock / CPU cho camera trực tiếp
                time.sleep(0)
                if not _alive(job):
                    break
                rec = analysis_frame(round(t, 3), objects, poses, pipe)
                fr = {"ts": int(t * 1000), "width": w, "height": h, "coord": "px",
                      "objects": objects, "poses": poses, "roleEnabled": pipe.role_enabled}
                new_alerts = [analysis._alert(c, t) for c in eng.process(fr, settings, room="")]
                job.frames.append(rec)
                job.alerts.extend(new_alerts)
                job.analysed_sec = round(t, 3)
                job.progress = min(0.999, (t / span) if span else 1.0)
                job.total_frames = len(job.frames)
                job.total_alerts = len(job.alerts)
            idx += 1
    finally:
        cap.release()
