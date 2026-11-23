"""Lượt 2: phóng tay/bàn để tìm điện thoại nhỏ, bị che một phần hoặc dưới gầm bàn.

Chạy sau DET+pose+vai trò, chỉ trên thí sinh (role != invigilator). Cắt vùng quanh cổ tay
(hoặc nửa dưới hộp người), gom batch, chạy lại detector chỉ lớp điện thoại ở imgsz vừa,
conf thấp hơn, rồi NMS-trộn với kết quả khung đầy đủ. Box mới gắn source:'zoom'.
"""
from __future__ import annotations

import math
import time

from . import config
from .tracker import iou

WRIST_IDX = (9, 10)
WRIST_MIN_SCORE = 0.3
MIN_CROP = 32  # sàn tuyệt đối; cạnh làm việc lấy từ PHONE_ZOOM_MIN_CROP (mặc định 160)
MIN_PHONE_PX = 6


def _min_crop() -> int:
    return max(MIN_CROP, int(getattr(config, "PHONE_ZOOM_MIN_CROP", 160)))


def _clamp_box(b, w, h):
    x1, y1, x2, y2 = b
    x1, x2 = max(0, min(w - 1, x1)), max(1, min(w, x2))
    y1, y2 = max(0, min(h - 1, y1)), max(1, min(h, y2))
    if x2 - x1 < 2 or y2 - y1 < 2:
        return None
    return [x1, y1, x2, y2]


def _expand_to_min(box, frame_w, frame_h, min_side=None):
    """Nới crop nhỏ (người xa) lên ít nhất min_side, ưu tiên nới xuống phía bàn."""
    min_side = _min_crop() if min_side is None else min_side
    x1, y1, x2, y2 = (float(v) for v in box)
    w, h = x2 - x1, y2 - y1
    if w < min_side:
        cx = (x1 + x2) / 2.0
        x1, x2 = cx - min_side / 2.0, cx + min_side / 2.0
    if h < min_side:
        # giữ mép trên nếu được, nới xuống (bàn / gầm bàn)
        y2 = max(y2, y1 + min_side)
        if y2 - y1 < min_side:
            cy = (y1 + y2) / 2.0
            y1, y2 = cy - min_side / 2.0, cy + min_side / 2.0
    box = _clamp_box([x1, y1, x2, y2], frame_w, frame_h)
    return [int(round(v)) for v in box] if box else None


def crop_region(bbox, wrists, frame_w, frame_h, pad: float | None = None):
    """Vùng cắt quanh cổ tay (gồm bàn phía dưới) hoặc nửa dưới hộp người. Toạ độ px nguyên."""
    pad = config.PHONE_ZOOM_PAD if pad is None else pad
    min_side = _min_crop()
    x1, y1, x2, y2 = (float(v) for v in bbox)
    pw, ph = max(x2 - x1, 1.0), max(y2 - y1, 1.0)
    if wrists:
        xs, ys = [w[0] for w in wrists], [w[1] for w in wrists]
        if len(wrists) >= 2:
            span = math.hypot(xs[0] - xs[1], ys[0] - ys[1])
        else:
            span = ph * 0.35
        span = max(span, ph * 0.2, float(min_side) / max(pad, 1.0))
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        half = span * pad / 2.0
        # Nhiều hơn phía dưới / phía trước (bàn, gầm bàn)
        box = [cx - half, cy - half * 0.8, cx + half, cy + half * 1.45]
    else:
        box = [x1 - pw * 0.25, y1 + ph * 0.35, x2 + pw * 0.25, y2 + ph * 0.35]
    box = _clamp_box(box, frame_w, frame_h)
    if not box:
        return None
    return _expand_to_min(box, frame_w, frame_h, min_side)


def _wrists_of(pose: dict) -> list[tuple[float, float]]:
    out = []
    kps = pose.get("keypoints") or []
    for i in WRIST_IDX:
        if i < len(kps):
            k = kps[i]
            if len(k) >= 3 and k[2] >= WRIST_MIN_SCORE:
                out.append((float(k[0]), float(k[1])))
    return out


def collect_students(objects: list[dict], poses: list[dict]) -> list[dict]:
    """Thí sinh / chưa rõ vai trò (bỏ giám thị), kèm cổ tay nếu có pose."""
    people: dict = {}
    for p in poses:
        tid = p.get("trackId")
        if tid is None or p.get("role") == "invigilator":
            continue
        people[tid] = {"trackId": tid, "bbox": list(p["bbox"]), "wrists": _wrists_of(p),
                       "role": p.get("role", "unknown")}
    for o in objects:
        if o.get("cls") != "person" or o.get("trackId") is None:
            continue
        tid = o["trackId"]
        if o.get("role") == "invigilator":
            people.pop(tid, None)
            continue
        if tid not in people:
            people[tid] = {"trackId": tid, "bbox": list(o["bbox"]), "wrists": [],
                           "role": o.get("role", "unknown")}
    return list(people.values())


def _priority(p: dict, frame_h: float) -> float:
    """Ưu tiên người xa/nhỏ (hay bị DET bỏ) và người có cổ tay thấp (gần bàn)."""
    h = max(frame_h, 1.0)
    ph = max(p["bbox"][3] - p["bbox"][1], 1.0)
    cy = (p["bbox"][1] + p["bbox"][3]) / 2.0
    far = 1.0 - (cy / h)          # y nhỏ = phía xa camera
    small = max(0.0, 1.0 - ph / (0.22 * h))
    desk = (max(w[1] for w in p["wrists"]) / h) if p["wrists"] else (p["bbox"][3] / h) * 0.5
    return 1.4 * far + 1.2 * small + 0.7 * desk


def _is_far_or_small(p: dict, frame_h: float) -> bool:
    cy = (p["bbox"][1] + p["bbox"][3]) / 2.0
    ph = p["bbox"][3] - p["bbox"][1]
    return cy < 0.55 * frame_h or ph < 0.15 * frame_h


def far_room_tiles(existing: list[dict], frame_w, frame_h, max_tiles: int) -> list[dict]:
    """Lát ô nửa xa (nửa trên khung lớp học) khi DET có thể bỏ thí sinh nhỏ. Bỏ ô đã phủ bởi crop người."""
    if max_tiles <= 0 or not getattr(config, "PHONE_ZOOM_FAR_TILE", True):
        return []
    tile = max(_min_crop(), int(getattr(config, "PHONE_ZOOM_TILE_SIZE", 256)))
    far_y2 = int(frame_h * 0.58)
    if far_y2 < tile:
        far_y2 = min(frame_h, tile)
    stride = max(int(tile * 0.72), tile // 2)
    # IoU với crop đã có: nếu ô bị phủ nhiều thì bỏ
    out = []
    y = 0
    while y < far_y2 and len(out) < max_tiles:
        x = 0
        y2 = min(y + tile, frame_h)
        while x < frame_w and len(out) < max_tiles:
            x2 = min(x + tile, frame_w)
            box = _expand_to_min([x, y, x2, y2], frame_w, frame_h)
            if box:
                covered = False
                for c in existing:
                    if iou(box, c["box"]) >= 0.45:
                        covered = True
                        break
                if not covered:
                    out.append({"trackId": None, "box": box, "tile": True})
            x += stride
        y += stride
    return out


def student_crops(objects, poses, frame_w, frame_h, max_crops: int | None = None) -> list[dict]:
    """Danh sách {trackId, box} đã cắt: người xa/nhỏ trước, rồi người khác, rồi ô lát nửa xa."""
    max_crops = config.PHONE_ZOOM_MAX_CROPS if max_crops is None else max_crops
    students = collect_students(objects, poses)
    far, near = [], []
    for p in students:
        (far if _is_far_or_small(p, frame_h) else near).append(p)
    far.sort(key=lambda p: _priority(p, frame_h), reverse=True)
    near.sort(key=lambda p: _priority(p, frame_h), reverse=True)
    reserve = min(4, max(0, max_crops // 3)) if getattr(config, "PHONE_ZOOM_FAR_TILE", True) else 0
    out = []
    for p in far + near:
        if len(out) >= max_crops - (reserve if p in near and far else 0):
            # vẫn lấy người xa; chỉ chừa chỗ khi đang thêm người gần
            if p in near and len(out) >= max_crops - reserve:
                continue
        if len(out) >= max_crops:
            break
        box = crop_region(p["bbox"], p["wrists"], frame_w, frame_h)
        if not box:
            continue
        out.append({"trackId": p["trackId"], "box": box})
    if len(out) < max_crops:
        out.extend(far_room_tiles(out, frame_w, frame_h, max_crops - len(out)))
    return out[:max_crops]


def map_box(crop_box, local_bbox, frame_w, frame_h):
    """Đưa box trong crop về toạ độ khung đầy đủ."""
    ox, oy = crop_box[0], crop_box[1]
    b = [local_bbox[0] + ox, local_bbox[1] + oy, local_bbox[2] + ox, local_bbox[3] + oy]
    return _clamp_box(b, frame_w, frame_h)


def nms_merge_phones(existing: list[dict], newcomers: list[dict], iou_thr: float | None = None) -> list[dict]:
    """Giữ box cũ; chỉ thêm box zoom không trùng (IoU). newcomer đã gắn source:'zoom'."""
    iou_thr = config.DET_IOU if iou_thr is None else iou_thr
    phones = [o for o in existing if o.get("cls") == "phone"]
    kept = list(existing)
    for n in sorted(newcomers, key=lambda o: -float(o.get("conf") or 0)):
        nb = n.get("bbox")
        if not nb:
            continue
        if any(iou(nb, e["bbox"]) >= iou_thr for e in phones):
            continue
        kept.append(n)
        phones.append(n)
    return kept


def _next_phone_id(objects: list[dict], tid, n0: int = 1) -> tuple[str, int]:
    used = {o.get("id") for o in objects if o.get("id")}
    n = n0
    while True:
        i = f"phone-{tid if tid is not None else 0}-{n}"
        if i not in used:
            return i, n
        n += 1


class PhoneZoomScheduler:
    """Giống RoleScheduler: mỗi N khung, tự giãn khi CPU chậm."""

    def __init__(self, every_n: int | None = None, adaptive: bool | None = None, fps: float | None = None):
        self.base = max(1, every_n or config.PHONE_ZOOM_EVERY_N)
        self.adaptive = config.PHONE_ZOOM_ADAPTIVE if adaptive is None else adaptive
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
        self.n = min(max(self.base, need), max(config.PHONE_ZOOM_MAX_EVERY_N, self.base))


class PhoneZoomState:
    def __init__(self):
        self.last_ms = 0.0
        self.last_crops = 0


_state = PhoneZoomState()


def get_phone_zoom() -> PhoneZoomState:
    return _state


def reset_phone_zoom() -> None:
    _state.last_ms = 0.0
    _state.last_crops = 0


def phone_zoom_status() -> dict:
    return {
        "phoneZoom": bool(config.PHONE_ZOOM),
        "phoneZoomConf": config.PHONE_ZOOM_CONF,
        "phoneZoomImgSize": config.PHONE_ZOOM_IMG_SIZE,
        "phoneZoomEveryN": config.PHONE_ZOOM_EVERY_N,
        "phoneZoomMaxCrops": config.PHONE_ZOOM_MAX_CROPS,
        "phoneZoomInferMs": round(_state.last_ms, 1),
        "phoneZoomCrops": _state.last_crops,
        "phoneConf": config.PHONE_CONF,
    }


def apply_phone_zoom(frame, objects: list[dict], poses: list[dict],
                     sched: PhoneZoomScheduler | None = None, lock=None, detector=None) -> list[dict]:
    """Thêm điện thoại tìm được bằng lượt zoom vào `objects`. Không đổi list gốc nếu không có gì mới."""
    if not config.PHONE_ZOOM or frame is None:
        return objects
    if sched is not None and not sched.due():
        return objects
    try:
        h, w = frame.shape[:2]
    except Exception:
        return objects
    crops = student_crops(objects, poses, w, h)
    _state.last_crops = len(crops)
    if not crops:
        _state.last_ms = 0.0
        if sched is not None:
            sched.note(0.0)
        return objects

    if detector is None:
        from .detector import get_detector
        detector = get_detector()
    infer = getattr(detector, "detect_phones_in_crops", None)
    if infer is None:
        _state.last_ms = 0.0
        if sched is not None:
            sched.note(0.0)
        return objects

    images, meta = [], []
    for c in crops:
        x1, y1, x2, y2 = c["box"]
        patch = frame[y1:y2, x1:x2]
        if patch is None or patch.size == 0:
            continue
        images.append(patch)
        meta.append(c)
    if not images:
        _state.last_ms = 0.0
        if sched is not None:
            sched.note(0.0)
        return objects

    t0 = time.time()
    try:
        if lock is not None:
            with lock:
                found = infer(images, conf=config.PHONE_ZOOM_CONF, imgsz=config.PHONE_ZOOM_IMG_SIZE)
        else:
            found = infer(images, conf=config.PHONE_ZOOM_CONF, imgsz=config.PHONE_ZOOM_IMG_SIZE)
    except Exception as e:
        print(f"WARNING: [phone-zoom] lỗi suy luận: {type(e).__name__}: {e}", flush=True)
        _state.last_ms = (time.time() - t0) * 1000
        if sched is not None:
            sched.note(_state.last_ms)
        return objects
    _state.last_ms = (time.time() - t0) * 1000
    if sched is not None:
        sched.note(_state.last_ms)

    newcomers = []
    for crop, phones in zip(meta, found or []):
        for p in phones or []:
            fb = map_box(crop["box"], p["bbox"], w, h)
            if not fb:
                continue
            if fb[2] - fb[0] < MIN_PHONE_PX or fb[3] - fb[1] < MIN_PHONE_PX:
                continue
            # Điện thoại phòng thi nhỏ; hộp zoom quá lớn gần như chắc là nhiễu.
            max_side = max(160.0, 0.12 * max(w, h))
            if (fb[2] - fb[0]) > max_side or (fb[3] - fb[1]) > max_side:
                continue
            tid = crop["trackId"]
            newcomers.append({
                "cls": "phone",
                "conf": float(p["conf"]),
                "bbox": [round(v, 1) for v in fb],
                "trackId": tid,
                "source": "zoom",
            })
    if not newcomers:
        return objects

    # Gán id không trùng, làm tròn conf như pipeline
    attached = []
    acc = list(objects)
    for n in newcomers:
        oid, _ = _next_phone_id(acc, n.get("trackId"))
        item = {**n, "id": oid, "conf": round(float(n["conf"]), 3)}
        attached.append(item)
        acc.append(item)
    return nms_merge_phones(objects, attached)
