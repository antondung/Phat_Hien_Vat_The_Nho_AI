"""Hậu xử lý: gán trackId, gắn vai trò (giám thị/thí sinh), gắn vật thể vào người gần nhất, chuẩn hoá theo hợp đồng FE."""
import math

from collections import deque
import statistics

from . import config
from .roles import INVIGILATOR, UNKNOWN, RoleState, match_roles, person_box_label, role_only_ok
from .tracker import IoUTracker, iou


def _r(v, n=1):
    return round(float(v), n)


def analysis_frame(t, objects, poses, pipe) -> dict:
    """Khung gửi FE (jobs / POST /api/analysis): luôn có roleEnabled + roleCounts như WS detections."""
    return {"t": t, "objects": objects, "poses": poses,
            "roleEnabled": bool(getattr(pipe, "role_enabled", False)),
            "roleCounts": dict(getattr(pipe, "last_counts", None) or
                               {"invigilator": 0, "student": 0, "unknown": 0})}


class FramePipeline:
    def __init__(self):
        self.tracker = IoUTracker(iou_thr=0.05, dist_thr=1.0, max_missed=3000)
        self.roles = RoleState()
        self.role_only: list[dict] = []   # box vai trò đã qua lọc + persist, lần chạy gần nhất
        self.role_only_hist: deque = deque(maxlen=4)  # các lần fresh trước đó (sau lọc hình học)
        self.role_enabled = False
        self.last_counts = {"invigilator": 0, "student": 0, "unknown": 0}
        self.frame_wh: tuple | None = None

    def clear_roles(self):
        """Gọi khi khung màu đặc / mất hình: bỏ box vai trò cũ để không vẽ người ma."""
        self.role_only = []
        self.role_only_hist.clear()

    def _role_fields(self, tid: int) -> dict:
        if not self.role_enabled:
            # Không có model vai trò: giữ hành vi cũ (#trackId), role 'unknown'
            return {"role": UNKNOWN, "roleConf": 0.0, "label": person_box_label(UNKNOWN, tid), "studentNo": tid}
        role, conf = self.roles.role_of(tid)
        if role == INVIGILATOR:
            return {"role": role, "roleConf": conf, "label": person_box_label(role, tid), "studentNo": None}
        # Hợp đồng FE: thí sinh 'Thí sinh #N' (roles.ts không nhân đôi vì đã có 'thí sinh');
        # unknown vẫn '#N'. studentNo / cảnh báo vẫn dùng trackId / '#N'.
        return {"role": role, "roleConf": conf, "label": person_box_label(role, tid), "studentNo": tid}

    def _persist_role_only(self, cands: list[dict]) -> list[dict]:
        """Chỉ phát box vai trò-only khi khớp IoU với chính nó ở ít nhất N lần chạy (kể cả lần này)."""
        need = max(1, int(getattr(config, "ROLE_ONLY_PERSIST_HITS", 2)))
        thr = float(getattr(config, "ROLE_ONLY_PERSIST_IOU", 0.3))
        kept = []
        for rb in cands:
            hits = 1
            for prev in self.role_only_hist:
                if any(iou(rb["bbox"], p["bbox"]) >= thr for p in prev):
                    hits += 1
            if hits >= need:
                kept.append(rb)
        self.role_only_hist.append(list(cands))
        return kept

    def _downgrade_standing_students(self, info: dict, ids: list, boxes: list, poses_raw: list) -> None:
        """Người đứng (cao hơn rõ so với chỗ ngồi) mà conf student thấp → unknown. Không ép thành giám thị."""
        if len(boxes) < 2:
            return
        by_tid = {}
        for tid, b in zip(ids, boxes):
            by_tid[tid] = b
        # Không dùng chiều cao hộp so với trung vị: học sinh hàng trước ngồi vẫn cao hơn nhiều vì phối cảnh.
        # Chỉ hạ vai trò khi có pose hông (COCO 11/12) và hông cao hơn rõ đường ngồi trung vị.
        conf_thr = float(getattr(config, "ROLE_STANDING_STUDENT_CONF", 0.6))
        hip_ys, pose_hip = [], {}
        for j, p in enumerate(poses_raw):
            if j >= len(ids):
                break
            tid = ids[j]
            kps = p.get("keypoints") or []
            hips = []
            for i in (11, 12):
                if i < len(kps) and len(kps[i]) >= 3 and kps[i][2] >= 0.3:
                    hips.append(float(kps[i][1]))
            if hips:
                pose_hip[tid] = sum(hips) / len(hips)
                hip_ys.append(pose_hip[tid])
        seated_line = statistics.median(hip_ys) if len(hip_ys) >= 2 else None
        if seated_line is None:
            return
        ys = [b[1] for b in by_tid.values()] + [b[3] for b in by_tid.values()]
        margin = 0.06 * (max(ys) - min(ys) or 1.0)
        for tid, b in by_tid.items():
            f = info.get(tid)
            if not f or f["role"] != "student" or f["roleConf"] >= conf_thr:
                continue
            if tid in pose_hip and pose_hip[tid] < seated_line - margin:
                info[tid] = {**f, "role": UNKNOWN, "label": person_box_label(UNKNOWN, tid)}

    def run(self, raw: dict, roles: list[dict] | None = None, role_enabled: bool | None = None,
            frame_wh: tuple | None = None) -> tuple[list[dict], list[dict]]:
        """roles: box vai trò của khung này (đã chạy model) hoặc None (khung không chạy model vai trò).
        role_enabled: model vai trò đang bật (mặc định: có truyền roles / đã từng bật).
        frame_wh: (width, height) px của khung, dùng lọc box vai trò-only ôm mép."""
        if roles is None:
            roles = raw.get("roles")
        if role_enabled is not None:
            self.role_enabled = bool(role_enabled)
        elif roles is not None:
            self.role_enabled = True
        if frame_wh:
            self.frame_wh = frame_wh
        fresh = roles is not None

        poses_raw = raw["poses"]
        persons_det = [o for o in raw["objects"] if o["cls"] == "person"]
        others = [o for o in raw["objects"] if o["cls"] != "person"]

        # Danh sách người = khung pose + khung person (det) không trùng khung pose nào
        boxes = [p["bbox"] for p in poses_raw]
        det_to_box = []
        for d in persons_det:
            best_j, best = -1, 0.0
            for j, p in enumerate(poses_raw):
                s = iou(d["bbox"], p["bbox"])
                if s > best:
                    best_j, best = j, s
            if best >= 0.3:
                det_to_box.append(best_j)
            else:
                det_to_box.append(len(boxes))
                boxes.append(d["bbox"])

        assign = {}
        if self.role_enabled:
            if fresh:
                assign, left = match_roles(boxes, roles or [])
                cands = [rb for rb in left if role_only_ok(rb, self.frame_wh)]
                self.role_only = self._persist_role_only(cands)
            # Không có box người DET tương ứng → dùng chính box vai trò làm người
            role_only = list(self.role_only) if self.role_enabled else []
        else:
            role_only = []
        role_only_start = len(boxes)
        for rb in role_only:
            boxes.append(rb["bbox"])

        ids = self.tracker.update(boxes)

        if self.role_enabled and fresh:
            for j, rb in assign.items():
                self.roles.vote(ids[j], rb["role"], rb["conf"])
            for k, rb in enumerate(role_only):
                self.roles.vote(ids[role_only_start + k], rb["role"], rb["conf"])

        info = {tid: self._role_fields(tid) for tid in set(ids)}
        if self.role_enabled:
            self._downgrade_standing_students(info, ids, boxes, poses_raw)
        counts = {"invigilator": 0, "student": 0, "unknown": 0}
        for tid in set(ids):
            counts[info[tid]["role"]] = counts.get(info[tid]["role"], 0) + 1
        self.last_counts = counts

        objects, poses = [], []
        for j, p in enumerate(poses_raw):
            kps = [[_r(k[0]), _r(k[1]), _r(k[2], 2)] for k in p["keypoints"]]
            while len(kps) < config.POSE_PAD_TO:
                kps.append([0, 0, 0])
            poses.append({"trackId": ids[j], "conf": _r(p["conf"], 3), "bbox": [_r(v) for v in p["bbox"]],
                          "keypoints": kps, **info[ids[j]]})
        for d, j in zip(persons_det, det_to_box):
            objects.append({"id": f"person-{ids[j]}", "cls": "person", "conf": _r(d["conf"], 3),
                            "bbox": [_r(v) for v in d["bbox"]], "trackId": ids[j], **info[ids[j]]})
        seen_person = {o["trackId"] for o in objects}
        for k, rb in enumerate(role_only):
            tid = ids[role_only_start + k]
            if tid in seen_person:
                continue
            seen_person.add(tid)
            objects.append({"id": f"person-{tid}", "cls": "person", "conf": _r(rb["conf"], 3),
                            "bbox": [_r(v) for v in rb["bbox"]], "trackId": tid, "source": "role", **info[tid]})

        person_boxes = list(zip(ids, boxes))
        counter: dict[str, int] = {}
        for o in others:
            cx, cy = (o["bbox"][0] + o["bbox"][2]) / 2, (o["bbox"][1] + o["bbox"][3]) / 2
            tid, bd = None, math.inf
            for t, b in person_boxes:
                pcx, pcy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
                d = math.hypot(pcx - cx, pcy - cy)
                if d < bd:
                    tid, bd = t, d
            key = f"{o['cls']}-{tid if tid is not None else 0}"
            counter[key] = counter.get(key, 0) + 1
            item = {"id": f"{key}-{counter[key]}", "cls": o["cls"], "conf": _r(o["conf"], 3),
                    "bbox": [_r(v) for v in o["bbox"]]}
            if tid is not None:
                item["trackId"] = tid
            if o.get("points"):
                item["points"] = [[_r(a), _r(b)] for a, b in o["points"]]
            if o.get("source"):
                item["source"] = o["source"]
            objects.append(item)
        return objects, poses
