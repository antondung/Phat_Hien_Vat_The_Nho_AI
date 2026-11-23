"""Tracker IoU đơn giản để gán trackId ổn định cho thí sinh giữa các frame (camera cố định)."""


def iou(a, b) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _center_dist(a, b) -> float:
    """Khoảng cách tâm chia cho đường chéo trung bình của 2 khung (0 = trùng tâm)."""
    ca, cb = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2), ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
    da = ((a[2] - a[0]) ** 2 + (a[3] - a[1]) ** 2) ** 0.5
    db = ((b[2] - b[0]) ** 2 + (b[3] - b[1]) ** 2) ** 0.5
    d = ((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2) ** 0.5
    return d / max((da + db) / 2, 1e-6)


class IoUTracker:
    """Ghép theo IoU + khoảng cách tâm (camera cố định, thí sinh ngồi yên chỗ) để trackId ổn định.
    Track mất dấu được giữ lại `max_missed` frame trước khi xoá, để thí sinh bị che tạm thời vẫn giữ mã cũ."""

    def __init__(self, iou_thr: float = 0.1, dist_thr: float = 0.45, max_missed: int = 75):
        self.iou_thr, self.dist_thr, self.max_missed = iou_thr, dist_thr, max_missed
        self.tracks: dict[int, dict] = {}
        self.next_id = 1

    def reset(self):
        self.tracks.clear()
        self.next_id = 1

    def update(self, boxes: list[list[float]]) -> list[int]:
        pairs = []
        for tid, t in self.tracks.items():
            for j, b in enumerate(boxes):
                u, d = iou(t["bbox"], b), _center_dist(t["bbox"], b)
                if u >= self.iou_thr or d <= self.dist_thr:
                    pairs.append((u + (1 - min(d, 1)), -t["missed"], tid, j))
        pairs.sort(reverse=True)
        ids = [0] * len(boxes)
        used_t, used_b = set(), set()
        for _, _, tid, j in pairs:
            if tid in used_t or j in used_b:
                continue
            used_t.add(tid)
            used_b.add(j)
            ids[j] = tid
        for j, b in enumerate(boxes):
            if j not in used_b:
                ids[j] = self.next_id
                self.next_id += 1
                self.tracks[ids[j]] = {"bbox": b, "missed": 0}
        for tid in list(self.tracks):
            if tid in used_t:
                self.tracks[tid]["missed"] = 0
            elif tid not in ids:
                self.tracks[tid]["missed"] += 1
                if self.tracks[tid]["missed"] > self.max_missed:
                    del self.tracks[tid]
        for j, b in enumerate(boxes):
            self.tracks[ids[j]]["bbox"] = b
        return ids
