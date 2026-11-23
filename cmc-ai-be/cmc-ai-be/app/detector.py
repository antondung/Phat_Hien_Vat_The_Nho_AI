"""Lớp detector cắm-rút được.

- MockDatasetDetector: đọc nhãn gốc của dataset (labels/ + labels_pose/) để chạy thử toàn hệ thống
  khi chưa có model. Chỉ cho kết quả với ảnh/frame lấy từ dataset (biết tên ảnh qua `hint`).
- YoloDetector: dùng Ultralytics với 2 file trọng số (nhận diện 4 lớp + pose).

Cả hai trả về toạ độ pixel:
  {"objects": [{"cls","conf","bbox":[x1,y1,x2,y2]}], "poses": [{"conf","bbox","keypoints":[[x,y,s],...]}]}
"""
import json
import time
from pathlib import Path

import yaml

from . import config


def _map_cls(name: str) -> str | None:
    key = " ".join(str(name).lower().replace("_", " ").replace("-", " ").split())
    return config.CLASS_MAP.get(key)


class MockDatasetDetector:
    kind = "mock"

    def __init__(self, dataset_dir: Path):
        self.dir = dataset_dir
        self.index: dict[str, dict] = {}
        self.names = ["student", "phone", "paper", "calculator"]
        self.kpt = 11
        y = dataset_dir / "data.yaml"
        if y.exists():
            self.names = yaml.safe_load(y.read_text())["names"]
        yp = dataset_dir / "data_pose.yaml"
        if yp.exists():
            self.kpt = yaml.safe_load(yp.read_text())["kpt_shape"][0]
        for split in ("train", "valid", "test"):
            for img in sorted((dataset_dir / split / "images").glob("*.jpg")):
                self.index[img.stem] = {"split": split, "image": img,
                                        "det": dataset_dir / split / "labels" / f"{img.stem}.txt",
                                        "pose": dataset_dir / split / "labels_pose" / f"{img.stem}.txt"}

    def videos(self) -> dict[str, list[str]]:
        """Nhóm ảnh theo video gốc (tiền tố tên file), sắp theo số frame."""
        out: dict[str, list[str]] = {}
        for stem in self.index:
            vid = stem.rsplit("_", 1)[0]
            out.setdefault(vid, []).append(stem)
        for v in out.values():
            v.sort()
        return out

    def detect(self, frame, hint: str | None = None, run_pose: bool = True) -> dict:
        h, w = frame.shape[:2]
        rec = self.index.get(hint or "")
        objects, poses = [], []
        if not rec:
            return {"objects": objects, "poses": poses}
        if rec["det"].exists():
            for line in rec["det"].read_text().split("\n"):
                p = line.split()
                if len(p) < 5:
                    continue
                cls = _map_cls(self.names[int(p[0])])
                if not cls:
                    continue
                cx, cy, bw, bh = (float(v) for v in p[1:5])
                objects.append({"cls": cls, "conf": 1.0,
                                "bbox": [(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h]})
        if rec["pose"].exists():
            for line in rec["pose"].read_text().split("\n"):
                p = line.split()
                if len(p) < 5:
                    continue
                cx, cy, bw, bh = (float(v) for v in p[1:5])
                kps = []
                vals = [float(v) for v in p[5:]]
                for i in range(0, len(vals) - 2, 3):
                    x, y, v = vals[i:i + 3]
                    kps.append([x * w, y * h, 1.0 if v >= 2 else (0.5 if v >= 1 else 0.0)])
                poses.append({"conf": 1.0, "keypoints": kps,
                              "bbox": [(cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h]})
        return {"objects": objects, "poses": poses}

    def phone_class_ids(self) -> list[int]:
        return [i for i, n in enumerate(self.names) if _map_cls(n) == "phone"]

    def detect_phones_in_crops(self, crops, conf=None, imgsz=None) -> list[list[dict]]:
        # Mock không suy luận lại trên crop (nhãn gốc chỉ gắn với ảnh đầy đủ).
        return [[] for _ in (crops or [])]

    def info(self) -> list[dict]:
        classes = [_map_cls(n) or n for n in self.names]
        now = int(time.time() * 1000)
        return [
            {"name": "Mock (nhãn gốc dataset)", "task": "Phát hiện vật thể", "version": "dataset",
             "inputSize": "1920×1080", "classes": classes, "fps": config.DATASET_STREAM_FPS, "params": "—",
             "metrics": [], "updatedAt": now},
            {"name": "Mock pose (nhãn gốc dataset)", "task": "Ước lượng tư thế", "version": "dataset",
             "inputSize": "1920×1080", "classes": [f"{self.kpt} điểm khớp"], "fps": config.DATASET_STREAM_FPS,
             "params": "—", "metrics": [], "updatedAt": now},
        ]



def _resolve_weight(path: str, fallbacks: list[str]) -> tuple[str, bool, str]:
    """Trả (đường dẫn để load, có dùng fallback?, thông báo cảnh báo)."""
    cands = []
    p = Path(path)
    if not p.is_absolute():
        cands.append(config.BASE_DIR / p)
    cands.append(p)
    for c in cands:
        if c.exists():
            return str(c.resolve()), False, ""
    for fb in fallbacks:
        fp = Path(fb)
        if not fp.is_absolute():
            fp = config.BASE_DIR / fp
        if fp.exists():
            msg = (f"KHÔNG TÌM THẤY file trọng số đã cấu hình: {path}. "
                   f"Đang dùng fallback: {fp}")
            return str(fp.resolve()), True, msg
    msg = (f"KHÔNG TÌM THẤY file trọng số đã cấu hình: {path} và không có fallback local. "
           f"Ultralytics sẽ thử tải '{Path(path).name}'.")
    return Path(path).name, True, msg


class YoloDetector:
    kind = "yolo"

    def __init__(self, det_path: str, pose_path: str):
        from ultralytics import YOLO  # import muộn: chỉ cần khi dùng model thật

        det_fb = ["weights/yolo26s.pt", "weights/yolo11s.pt", "weights/yolov8s.pt"]
        pose_fb = ["weights/yolo26s-pose.pt", "weights/yolo11s-pose.pt", "weights/yolov8s-pose.pt"]
        self.det_path, det_fb_used, det_warn = _resolve_weight(det_path, det_fb)
        self.pose_path, pose_fb_used, pose_warn = _resolve_weight(pose_path, pose_fb) if pose_path else ("", False, "")
        self.fallback = bool(det_fb_used or pose_fb_used)
        self.fallback_notes = [w for w in (det_warn, pose_warn) if w]
        for w in self.fallback_notes:
            print("WARNING: " + w, flush=True)

        self.det = YOLO(self.det_path)
        self.pose = None
        if self.pose_path:
            try:
                self.pose = YOLO(self.pose_path)
            except Exception as e:
                print(f"WARNING: Không load được pose '{self.pose_path}': {e}", flush=True)
                self.fallback = True
        self.kw = {"conf": config.DET_CONF, "iou": config.DET_IOU, "imgsz": config.IMG_SIZE, "verbose": False}
        if config.DEVICE:
            self.kw["device"] = config.DEVICE
        # Lớp gốc của model (COCO: 'cell phone' = 67) — dùng để log và /api/system/model
        self.classes_raw = [self.det.names[k] for k in sorted(self.det.names)]
        self.classes_mapped = sorted({_map_cls(n) for n in self.classes_raw if _map_cls(n)})
        self._log_startup()

    def _log_startup(self):
        has_phone = any(_map_cls(n) == "phone" or "phone" in str(n).lower() for n in self.classes_raw)
        device = self.kw.get("device") or "auto"
        print("=" * 64, flush=True)
        print("[model] DETECTOR=yolo", flush=True)
        print(f"[model] DET  : {self.det_path}", flush=True)
        print(f"[model] POSE : {self.pose_path or '—'}", flush=True)
        print(f"[model] classes ({len(self.classes_raw)}): {', '.join(self.classes_raw)}", flush=True)
        print(f"[model] mapped : {', '.join(self.classes_mapped) or '—'}", flush=True)
        if has_phone:
            print("[model] 'cell phone' / phone: CÓ trong model — sẽ map sang cls=phone.", flush=True)
        else:
            print("WARNING: Model detect KHÔNG có lớp 'cell phone'/'phone'. "
                  "Điện thoại trên camera sẽ không được nhận!", flush=True)
        print(f"[model] device={device}  imgsz={config.IMG_SIZE}  conf={config.DET_CONF}  "
              f"iou={config.DET_IOU}  detectFps={config.DETECT_FPS}", flush=True)
        if self.fallback:
            print("WARNING: Đang chạy với trọng số fallback (file .pt cấu hình thiếu hoặc không load được).", flush=True)
        print("=" * 64, flush=True)

    def detect(self, frame, hint: str | None = None, run_pose: bool = True) -> dict:
        """frame: numpy BGR uint8 (đúng format OpenCV / Ultralytics, KHÔNG chuyển RGB trước).

        Toạ độ box YOLO trả về theo kích thước khung đầu vào (ví dụ 1280×720), không phải imgsz.
        """
        objects, poses = [], []
        # Bản sao C-contiguous để YOLO không đổi khung gốc đang dùng cho MJPEG
        if frame is not None and not frame.flags["C_CONTIGUOUS"]:
            frame = frame.copy()
        phone_thr = float(getattr(config, "PHONE_CONF", config.CLASS_CONF.get("phone", 0.25)))
        kw = dict(self.kw)
        kw["conf"] = min(float(kw.get("conf", config.DET_CONF)), phone_thr)
        r = self.det.predict(frame, **kw)[0]
        names = r.names

        def _keep(cls, c):
            if not cls:
                return False
            if cls == "phone":
                return c >= phone_thr
            return c >= config.CLASS_CONF.get(cls, 0)

        if r.obb is not None and len(r.obb):  # model OBB (hộp xoay)
            for xyxy, pts, c, k in zip(r.obb.xyxy.tolist(), r.obb.xyxyxyxy.tolist(), r.obb.conf.tolist(),
                                       r.obb.cls.tolist()):
                cls = _map_cls(names[int(k)])
                if _keep(cls, c):
                    objects.append({"cls": cls, "conf": float(c), "bbox": xyxy, "points": pts})
        elif r.boxes is not None:
            for xyxy, c, k in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
                cls = _map_cls(names[int(k)])
                if _keep(cls, c):
                    objects.append({"cls": cls, "conf": float(c), "bbox": xyxy})
        if self.pose is not None and run_pose:
            rp = self.pose.predict(frame, **self.kw)[0]
            if rp.keypoints is not None and rp.boxes is not None:
                kd = rp.keypoints.data.tolist()  # [n, k, 3]
                for xyxy, c, kps in zip(rp.boxes.xyxy.tolist(), rp.boxes.conf.tolist(), kd):
                    poses.append({"conf": float(c), "bbox": xyxy, "keypoints": [[a, b, s] for a, b, s in kps]})
        return {"objects": objects, "poses": poses}

    def phone_class_ids(self) -> list[int]:
        names = self.det.names
        if isinstance(names, (list, tuple)):
            names = dict(enumerate(names))
        return [int(k) for k, n in names.items() if _map_cls(n) == "phone"]

    def detect_phones_in_crops(self, crops, conf=None, imgsz=None) -> list[list[dict]]:
        """Nhận diện chỉ lớp điện thoại trên các ảnh crop (toạ độ theo từng crop)."""
        if not crops:
            return []
        ids = self.phone_class_ids()
        if not ids:
            return [[] for _ in crops]
        thr = config.PHONE_ZOOM_CONF if conf is None else conf
        kw = dict(self.kw)
        kw.update({"conf": thr, "imgsz": config.PHONE_ZOOM_IMG_SIZE if imgsz is None else imgsz,
                   "classes": ids, "verbose": False})
        frames = []
        for im in crops:
            if im is not None and hasattr(im, "flags") and not im.flags["C_CONTIGUOUS"]:
                im = im.copy()
            frames.append(im)
        results = self.det.predict(frames, **kw)
        out = []
        for r in results:
            phones = []
            names = r.names
            if r.boxes is not None:
                for xyxy, c, k in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
                    cls = _map_cls(names[int(k)])
                    if cls == "phone" and c >= thr:
                        phones.append({"cls": "phone", "conf": float(c), "bbox": [float(v) for v in xyxy]})
            out.append(phones)
        return out

    def info(self) -> list[dict]:
        metrics = {}
        if config.METRICS_JSON and Path(config.METRICS_JSON).exists():
            metrics = json.loads(Path(config.METRICS_JSON).read_text())
        now = int(time.time() * 1000)

        def one(m, name, task, key):
            n = sum(p.numel() for p in m.model.parameters()) if hasattr(m, "model") else 0
            mm = metrics.get(key, {})
            classes = (sorted({_map_cls(v) for v in m.names.values() if _map_cls(v)})
                       if key == "det" else ["person"])
            return {"name": name, "task": task, "version": Path(getattr(m, "ckpt_path", "") or name).name,
                    "inputSize": f"{config.IMG_SIZE}", "classes": classes,
                    "fps": mm.get("fps", 0), "params": f"{n / 1e6:.1f}M" if n else "—",
                    "metrics": mm.get("metrics", []), "perClass": mm.get("perClass"), "updatedAt": now}

        tag = "" if metrics else " (model gốc COCO, tạm dùng cho demo)"
        out = [one(self.det, Path(self.det_path).stem + tag, "Phát hiện vật thể", "det")]
        if self.pose is not None:
            out.append(one(self.pose, Path(self.pose_path).stem + tag, "Ước lượng tư thế", "pose"))
        return out

    def model_status(self) -> dict:
        device = self.kw.get("device") or config.DEVICE or "auto"
        return {
            "detModel": Path(self.det_path).name if self.det_path else "",
            "poseModel": Path(self.pose_path).name if self.pose_path else "",
            "classes": list(self.classes_raw),
            "device": device,
            "imgSize": config.IMG_SIZE,
            "conf": config.DET_CONF,
            "iou": config.DET_IOU,
            "detectFps": config.DETECT_FPS,
            "fallback": bool(self.fallback),
        }


def _mock_model_status(det: MockDatasetDetector) -> dict:
    return {
        "detModel": "mock",
        "poseModel": "mock",
        "classes": list(det.names),
        "device": "cpu",
        "imgSize": config.IMG_SIZE,
        "conf": config.DET_CONF,
        "iou": getattr(config, "DET_IOU", 0.45),
        "detectFps": config.DETECT_FPS,
        "fallback": False,
    }


_detector = None


def get_detector():
    global _detector
    if _detector is None:
        if config.DETECTOR == "yolo":
            _detector = YoloDetector(config.DET_MODEL, config.POSE_MODEL)
        else:
            _detector = MockDatasetDetector(config.DATASET_DIR)
            print(f"[model] DETECTOR=mock  dataset={config.DATASET_DIR}  classes={_detector.names}", flush=True)
    return _detector


def system_model_info() -> dict:
    d = get_detector()
    info = d.model_status() if hasattr(d, "model_status") else _mock_model_status(d)
    try:
        from .roles import get_role_detector
        info.update(get_role_detector().status())
    except Exception as e:  # không bao giờ làm hỏng endpoint
        info.update({"roleEnabled": False, "roleModel": "", "roleClasses": {}, "roleError": str(e)})
    try:
        from .phone_zoom import phone_zoom_status
        info.update(phone_zoom_status())
    except Exception as e:
        info.update({"phoneZoom": False, "phoneZoomInferMs": 0, "phoneZoomCrops": 0, "phoneZoomError": str(e)})
    return info
