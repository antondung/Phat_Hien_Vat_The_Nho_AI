"""Phân biệt giám thị (invigilator) và thí sinh (student) bằng một model vai trò tuỳ chọn.

Model tham chiếu: YOLO26m của bài TSII (CMC University), 2 lớp {0:'student', 1:'teacher'}, imgsz 640.
Chỉ cần thả file .pt vào weights/ và đặt ROLE_MODEL=weights/<file>.pt trong .env.

- Tên lớp đọc từ model.names, không phân biệt hoa thường / dấu cách / gạch dưới; ánh xạ qua ROLE_CLASSES.
- Thiếu file hoặc load lỗi: in WARNING, chạy tiếp không có vai trò (role:'unknown' mọi nơi), không crash.
- Ghép box vai trò với box người (DET_MODEL / pose) theo IoU >= ROLE_IOU_MATCH hoặc chứa tâm;
  nếu không có box người tương ứng thì dùng chính box vai trò làm người.
- Làm mượt theo trackId: đa số phiếu trong ROLE_SMOOTH_N lần chạy gần nhất.
- Thí sinh: nhãn 'Thí sinh #'+trackId; chưa rõ: '#'+trackId (cùng số trong cảnh báo); giám thị: 'Giám thị', không có số.
"""
from __future__ import annotations

import math
import time
import unicodedata
from collections import Counter, deque
from pathlib import Path

from . import config

INVIGILATOR = "invigilator"
STUDENT = "student"
UNKNOWN = "unknown"
INVIGILATOR_LABEL = "Giám thị"
STUDENT_LABEL = "Thí sinh"


def person_box_label(role: str, tid: int) -> str:
    """Nhãn trên khung người. Cảnh báo vẫn dùng '#'+trackId, không dùng hàm này."""
    if role == INVIGILATOR:
        return INVIGILATOR_LABEL
    if role == STUDENT:
        return f"{STUDENT_LABEL} #{tid}"
    return f"#{tid}"


def _norm(name) -> str:
    s = unicodedata.normalize("NFC", str(name)).lower().replace("_", " ").replace("-", " ")
    return " ".join(s.split())


def parse_role_classes(raw: str | None) -> dict[str, str]:
    """'invigilator:teacher|giám thị;student:student|thí sinh' → {'teacher':'invigilator', ...}."""
    out: dict[str, str] = {}
    for part in (raw or "").replace("\n", ";").split(";"):
        if ":" not in part:
            continue
        role, names = part.split(":", 1)
        role = _norm(role)
        if role in ("giám thị", "teacher"):
            role = INVIGILATOR
        if role not in (INVIGILATOR, STUDENT):
            continue
        for n in names.split("|"):
            if _norm(n):
                out[_norm(n)] = role
    return out


def role_for_name(name, mapping: dict[str, str] | None = None) -> str | None:
    mapping = parse_role_classes(config.ROLE_CLASSES_RAW) if mapping is None else mapping
    return mapping.get(_norm(name))


def map_model_names(names, mapping: dict[str, str] | None = None) -> dict[int, str]:
    """model.names (dict hoặc list) → {class_id: role}; bỏ lớp không ánh xạ được."""
    if isinstance(names, (list, tuple)):
        names = dict(enumerate(names))
    out: dict[int, str] = {}
    for k, n in (names or {}).items():
        r = role_for_name(n, mapping)
        if r:
            out[int(k)] = r
    return out


class YoloRoleModel:
    """Bọc Ultralytics YOLO cho model vai trò. detect(frame) → [{'role','conf','bbox'}] theo px của khung."""

    def __init__(self, path: str):
        from ultralytics import YOLO
        self.model = YOLO(path)
        self.names = dict(self.model.names) if not isinstance(self.model.names, list) else dict(enumerate(self.model.names))
        self.kw = {"conf": config.ROLE_CONF, "iou": config.DET_IOU, "imgsz": config.ROLE_IMG_SIZE, "verbose": False}
        if config.DEVICE:
            self.kw["device"] = config.DEVICE

    def predict(self, frame):
        r = self.model.predict(frame, **self.kw)[0]
        out = []
        if r.boxes is None:
            return out
        for xyxy, c, k in zip(r.boxes.xyxy.tolist(), r.boxes.conf.tolist(), r.boxes.cls.tolist()):
            out.append((int(k), float(c), [float(v) for v in xyxy]))
        return out


class RoleDetector:
    """model: đối tượng có .names và .predict(frame) → [(cls_id, conf, [x1,y1,x2,y2])]."""

    def __init__(self, model=None, path: str = "", error: str | None = None):
        self.model = model
        self.path = path
        self.error = error
        self.mapping = parse_role_classes(config.ROLE_CLASSES_RAW)
        self.class_roles = map_model_names(getattr(model, "names", {}) or {}, self.mapping) if model else {}
        self.names = dict(getattr(model, "names", {}) or {}) if model else {}
        if model is not None and not self.class_roles:
            self.error = (f"Không lớp nào trong model.names={self.names} khớp ROLE_CLASSES — "
                          "tắt phân biệt giám thị/thí sinh.")
            print("WARNING: [roles] " + self.error, flush=True)
        self.last_ms = 0.0

    @property
    def enabled(self) -> bool:
        return self.model is not None and bool(self.class_roles)

    def detect(self, frame) -> list[dict]:
        if not self.enabled:
            return []
        t0 = time.time()
        out = []
        try:
            fh, fw = frame.shape[:2]
            area = float(fw * fh) or 1.0
        except Exception:
            area = 0.0
        for k, c, b in self.model.predict(frame):
            role = self.class_roles.get(int(k))
            if role and c >= config.ROLE_CONF:
                frac = ((b[2] - b[0]) * (b[3] - b[1]) / area) if area else 0.0
                out.append({"role": role, "conf": float(c), "bbox": b, "areaFrac": round(frac, 4)})
        self.last_ms = (time.time() - t0) * 1000
        return out

    def status(self) -> dict:
        return {
            "roleEnabled": self.enabled,
            "roleModel": Path(self.path).name if self.path else "",
            "roleClasses": {str(self.names.get(k, k)): r for k, r in sorted(self.class_roles.items())},
            "roleModelNames": [str(self.names[k]) for k in sorted(self.names)],
            "roleImgSize": config.ROLE_IMG_SIZE,
            "roleConf": config.ROLE_CONF,
            "roleEveryN": config.ROLE_EVERY_N,
            "roleAdaptive": config.ROLE_ADAPTIVE,
            "roleInferMs": round(self.last_ms, 1),
            "roleError": self.error,
        }


def _resolve(path: str) -> Path | None:
    p = Path(path)
    for c in ([config.BASE_DIR / p] if not p.is_absolute() else []) + [p]:
        if c.exists():
            return c.resolve()
    return None


def load_role_detector(path: str | None = None) -> RoleDetector:
    path = config.ROLE_MODEL if path is None else path
    if not path:
        return RoleDetector(None, "", None)
    fp = _resolve(path)
    if fp is None:
        msg = (f"KHÔNG TÌM THẤY model vai trò ROLE_MODEL={path} — chạy tiếp không phân biệt "
               "giám thị/thí sinh (role:'unknown').")
        print("WARNING: [roles] " + msg, flush=True)
        return RoleDetector(None, path, msg)
    try:
        m = YoloRoleModel(str(fp))
    except Exception as e:
        msg = f"Không load được model vai trò {fp}: {type(e).__name__}: {e} — chạy tiếp không có vai trò."
        print("WARNING: [roles] " + msg, flush=True)
        return RoleDetector(None, str(fp), msg)
    d = RoleDetector(m, str(fp))
    if d.enabled:
        print(f"[roles] ROLE_MODEL: {fp}  names={d.names}  → {d.status()['roleClasses']}  "
              f"imgsz={config.ROLE_IMG_SIZE} conf={config.ROLE_CONF} everyN={config.ROLE_EVERY_N}"
              f"{' (adaptive)' if config.ROLE_ADAPTIVE else ''}", flush=True)
    return d


_role_detector: RoleDetector | None = None


def get_role_detector() -> RoleDetector:
    global _role_detector
    if _role_detector is None:
        _role_detector = load_role_detector()
    return _role_detector


def set_role_detector(d: RoleDetector | None) -> None:
    """Cho test: cắm model giả. None = nạp lại theo config lần gọi sau."""
    global _role_detector
    _role_detector = d


def roles_enabled() -> bool:
    return get_role_detector().enabled


class RoleScheduler:
    """Quyết định khung nào chạy model vai trò. Thích ứng: nếu thời gian suy luận vai trò
    chiếm quá ~40% ngân sách 1/DETECT_FPS thì giãn N (tối đa ROLE_MAX_EVERY_N)."""

    def __init__(self, every_n: int | None = None, adaptive: bool | None = None, fps: float | None = None):
        self.base = max(1, every_n or config.ROLE_EVERY_N)
        self.adaptive = config.ROLE_ADAPTIVE if adaptive is None else adaptive
        self.fps = fps or config.DETECT_FPS
        self.n = self.base
        self.i = 0
        self.ema_ms = 0.0

    def due(self) -> bool:
        d = self.i % self.n == 0
        self.i += 1
        return d

    def note(self, ms: float) -> None:
        self.ema_ms = ms if self.ema_ms == 0 else 0.7 * self.ema_ms + 0.3 * ms
        if not self.adaptive:
            return
        budget = 1000.0 / max(self.fps, 0.1)
        need = math.ceil(self.ema_ms / (0.4 * budget)) if self.ema_ms > 0 else 1
        self.n = min(max(self.base, need), max(config.ROLE_MAX_EVERY_N, self.base))


def _iou(a, b) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _contains(box, pt) -> bool:
    return box[0] <= pt[0] <= box[2] and box[1] <= pt[1] <= box[3]


def _c(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def match_roles(person_boxes: list, role_boxes: list[dict], iou_thr: float | None = None):
    """Trả (gán: {person_idx: role_box}, role_box chưa ghép). Ghép tham lam theo IoU, rồi chứa tâm."""
    iou_thr = config.ROLE_IOU_MATCH if iou_thr is None else iou_thr
    cands = []
    for i, pb in enumerate(person_boxes):
        for j, rb in enumerate(role_boxes):
            u = _iou(pb, rb["bbox"])
            cont = _contains(rb["bbox"], _c(pb)) or _contains(pb, _c(rb["bbox"]))
            if u >= iou_thr or cont:
                cands.append((u + (0.01 if cont else 0), i, j))
    cands.sort(reverse=True)
    assign, used_p, used_r = {}, set(), set()
    for _, i, j in cands:
        if i in used_p or j in used_r:
            continue
        used_p.add(i)
        used_r.add(j)
        assign[i] = role_boxes[j]
    left = [rb for j, rb in enumerate(role_boxes) if j not in used_r]
    return assign, left


def role_only_edge_reject(bbox, frame_w: float, frame_h: float) -> bool:
    """Loại dải ôm mép khung, quá cao/mảnh (hay gặp hộp giả ôm cạnh trái)."""
    if not frame_w or not frame_h:
        return False
    x1, y1, x2, y2 = (float(v) for v in bbox)
    bw, bh = max(x2 - x1, 1e-6), max(y2 - y1, 1e-6)
    margin = max(4.0, 0.008 * frame_w, 0.008 * frame_h)
    touch_v = x1 <= margin or x2 >= frame_w - margin
    touch_any = touch_v or y1 <= margin or y2 >= frame_h - margin
    aspect = bh / bw
    max_aspect = float(getattr(config, "ROLE_ONLY_MAX_ASPECT", 3.5))
    min_hfrac = float(getattr(config, "ROLE_ONLY_EDGE_MIN_HEIGHT", 0.65))
    if touch_v and (aspect >= max_aspect or bh / frame_h >= min_hfrac):
        return True
    if touch_any and aspect >= max_aspect + 1.0:
        return True
    return False


def role_only_ok(rb: dict, frame_wh: tuple | None = None) -> bool:
    """Box vai trò đứng một mình (không có người DET) có đủ tin cậy để coi là một người không."""
    if rb["conf"] < config.ROLE_ONLY_CONF:
        return False
    if rb.get("areaFrac", 0.0) > config.ROLE_ONLY_MAX_AREA:
        return False
    b = rb.get("bbox")
    if not b:
        return False
    if frame_wh and role_only_edge_reject(b, frame_wh[0], frame_wh[1]):
        return False
    return True


class RoleState:
    """Lịch sử phiếu vai trò theo trackId (nhãn thí sinh = 'Thí sinh #'+trackId, giám thị = 'Giám thị')."""

    def __init__(self, smooth_n: int | None = None):
        self.smooth_n = smooth_n or config.ROLE_SMOOTH_N
        self.votes: dict[int, deque] = {}

    def vote(self, tid: int, role: str, conf: float) -> None:
        dq = self.votes.setdefault(tid, deque(maxlen=self.smooth_n))
        dq.append((role, conf))

    def role_of(self, tid: int) -> tuple[str, float]:
        dq = self.votes.get(tid)
        if not dq:
            return UNKNOWN, 0.0
        cnt = Counter(r for r, _ in dq)
        best = max(cnt.values())
        tied = {r for r, n in cnt.items() if n == best}
        # Hoà phiếu: lấy phiếu gần nhất trong nhóm hoà
        role = next(r for r, _ in reversed(dq) if r in tied)
        confs = [c for r, c in dq if r == role]
        return role, round(sum(confs) / len(confs), 3)

    def forget(self, alive: set[int]) -> None:
        for tid in [t for t in self.votes if t not in alive]:
            del self.votes[tid]
