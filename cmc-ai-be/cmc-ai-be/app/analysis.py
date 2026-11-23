"""Phân tích ảnh / video upload (màn "Phân tích")."""
import json
import time
import uuid
from pathlib import Path

import cv2

from . import config
from .detector import get_detector
from .pipeline import FramePipeline, analysis_frame
from .phone_zoom import PhoneZoomScheduler
from .roles import RoleScheduler
from .rules import RuleEngine, alert_message
from .streams import analyse_frame, dataset, rules_settings, run_detect

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SAMPLES = config.MEDIA_DIR / "samples"


def _model_names() -> dict:
    info = get_detector().info()
    return {"detector": info[0]["name"], "pose": info[1]["name"] if len(info) > 1 else "—"}


def sample_image() -> tuple[Path, str]:
    """Ảnh mẫu: ảnh test đầu tiên có điện thoại."""
    ds = dataset()
    for stem, rec in sorted(ds.index.items()):
        if rec["split"] == "test" and rec["det"].exists() and any(
                l.startswith("1 ") for l in rec["det"].read_text().split("\n")):
            return rec["image"], stem
    stem = next(iter(ds.index))
    return ds.index[stem]["image"], stem


def sample_video() -> tuple[Path, list[str]]:
    """Video mẫu ghép từ các frame dataset của 1 video (kèm danh sách tên frame để mock tra nhãn)."""
    out, meta = SAMPLES / "sample_video.mp4", SAMPLES / "sample_video.json"
    if out.exists() and meta.exists():
        return out, json.loads(meta.read_text())
    vids = dataset().videos()
    vid = max(vids, key=lambda v: sum(
        ("\n1 " in "\n" + dataset().index[s]["det"].read_text()) for s in vids[v]))
    stems = vids[vid][:40]
    first = cv2.imread(str(dataset().index[stems[0]]["image"]))
    h, w = first.shape[:2]
    tmp = SAMPLES / "sample_video_raw.mp4"
    vw = cv2.VideoWriter(str(tmp), cv2.VideoWriter_fourcc(*"mp4v"), 2, (w, h))
    for s in stems:
        vw.write(cv2.imread(str(dataset().index[s]["image"])))
    vw.release()
    import subprocess
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart", str(out)], check=False)
    tmp.unlink(missing_ok=True)
    meta.write_text(json.dumps(stems))
    return out, stems


def _alert(c: dict, t: float) -> dict:
    return {"id": f"aa-{uuid.uuid4().hex[:8]}", "t": round(t, 2), "type": c["type"], "level": c["level"],
            "trackId": c["trackId"], "objectId": c.get("objectId"), "confidence": c["confidence"],
            "message": alert_message(c["type"], c["trackId"])}


def analyze_image(path: Path, file_name: str, hint: str | None, media_url: str) -> dict:
    frame = cv2.imread(str(path))
    if frame is None:
        raise ValueError("Không đọc được ảnh")
    h, w = frame.shape[:2]
    pipe = FramePipeline()
    objects, poses = analyse_frame(pipe, frame, hint, None, raw=run_detect(frame, hint))
    fr = {"ts": 0, "width": w, "height": h, "coord": "px", "objects": objects, "poses": poses,
          "roleEnabled": pipe.role_enabled}
    cands = RuleEngine().process(fr, rules_settings(), room="", ignore_persist=True)
    return _result(file_name, "image", w, h, 0, 0, [analysis_frame(0, objects, poses, pipe)],
                   [_alert(c, 0) for c in cands], media_url)


def analyze_video(path: Path, file_name: str, hints: list[str] | None, media_url: str, progress=None) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("Không đọc được video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = max(1, round(fps / config.ANALYSIS_FPS))
    pipe, eng, frames, alerts = FramePipeline(), RuleEngine(), [], []
    sched = RoleScheduler(fps=config.ANALYSIS_FPS)
    zoom_sched = PhoneZoomScheduler(fps=config.ANALYSIS_FPS)
    settings = rules_settings()
    idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        t = idx / fps
        if t > config.ANALYSIS_MAX_SEC:
            break
        if idx % step == 0:
            hint = hints[idx] if hints and idx < len(hints) else None
            objects, poses = analyse_frame(pipe, frame, hint, sched, raw=run_detect(frame, hint),
                                           zoom_sched=zoom_sched)
            frames.append(analysis_frame(round(t, 3), objects, poses, pipe))
            fr = {"ts": int(t * 1000), "width": w, "height": h, "coord": "px", "objects": objects, "poses": poses,
                  "roleEnabled": pipe.role_enabled}
            alerts += [_alert(c, t) for c in eng.process(fr, settings, room="")]
            if progress and total:
                progress(idx / total)
        idx += 1
    cap.release()
    duration = (total or idx) / fps
    return _result(file_name, "video", w, h, round(duration, 2), round(fps, 2), frames, alerts, media_url)


def _result(file_name, media_type, w, h, duration, fps, frames, alerts, media_url) -> dict:
    return {"id": f"an-{uuid.uuid4().hex[:8]}", "fileName": file_name, "mediaType": media_type, "width": w,
            "height": h, "coord": "px", "duration": duration, "fps": fps, "model": _model_names(),
            "frames": frames, "alerts": alerts, "createdAt": int(time.time() * 1000), "mediaUrl": media_url}


def analyze_upload(path: Path, file_name: str, media_url: str) -> dict:
    if path.suffix.lower() in IMAGE_EXT:
        stem = Path(file_name).stem
        hint = stem if stem in dataset().index else None
        return analyze_image(path, file_name, hint, media_url)
    return analyze_video(path, file_name, None, media_url)
