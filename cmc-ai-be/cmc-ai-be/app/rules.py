"""Bộ quy tắc cảnh báo (port từ FE ruleEngine.ts để hai bên cho kết quả giống nhau).

- Cao        : điện thoại gần cổ tay (keypoint 9/10) của thí sinh
- Trung bình : điện thoại nằm trong vùng làm bài trước mặt thí sinh
- Thông tin  : có giấy / máy tính cầm tay (tự tắt nếu phòng cho phép)
Tình huống phải kéo dài >= persistSeconds mới bắn và được chống trùng theo khoá loại|thí sinh
trong dedupeCooldownSeconds. Hệ thống chỉ đưa ra NGHI VẤN, không kết luận vi phạm.

Vai trò (khi có ROLE_MODEL): người có role 'invigilator' (giám thị) bị loại khỏi MỌI quy tắc dành cho
thí sinh; vật thể gần giám thị nhất không sinh cảnh báo. Mọi quy tắc "cặp người gần nhau" (nếu thêm sau)
phải dùng candidate_pairs() để bỏ cặp có giám thị. Thông tin: không thấy giám thị trong phòng sau
ROOM_NO_INVIGILATOR_SEC giây (0 = tắt).
"""
import math

from . import config

INFO_COOLDOWN_MS = 10 * 60 * 1000
GAP_TOLERANCE_MS = 1200


def default_room(room: str) -> dict:
    """Mặc định: giấy làm bài là bình thường, máy tính cầm tay không được phép (báo mức Thông tin)."""
    return {"room": room, "allowPaper": True, "allowCalculator": False}


def persist_default_room(room: str) -> None:
    """Ghi cấu hình phòng mặc định vào settings nếu phòng chưa có (camera mới / đổi phòng)."""
    if not room:
        return
    from . import db
    s = db.setting_get("rules") or default_rules()
    rooms = list(s.get("rooms") or [])
    if any(r.get("room") == room for r in rooms):
        return
    rooms.append(default_room(room))
    s["rooms"] = rooms
    if "rules" not in s:
        s = {**default_rules(), **s, "rooms": rooms}
    db.setting_set("rules", s)


# Ngưỡng cũ (bản seed trước 10/11 tối) — chỉ nâng cấp khi admin chưa chỉnh tay.
_OLD_PHONE_DEFAULTS = {
    "phone_near_hand": {"minConfidence": 0.5, "nearHandThreshold": 0.15, "persistSeconds": 2},
    "phone_in_work_area": {"minConfidence": 0.45, "nearHandThreshold": 0.15, "persistSeconds": 4},
}
_NEW_PHONE_DEFAULTS = {
    "phone_near_hand": {"minConfidence": 0.25, "nearHandThreshold": 0.28, "persistSeconds": 1.5},
    "phone_in_work_area": {"minConfidence": 0.25, "nearHandThreshold": 0.28, "persistSeconds": 2},
}


def migrate_phone_rule_defaults(settings: dict) -> bool:
    """Hạ ngưỡng điện thoại nếu vẫn còn đúng bộ mặc định cũ. Trả True nếu có sửa."""
    changed = False
    for r in settings.get("rules") or []:
        neu = _NEW_PHONE_DEFAULTS.get(r.get("type"))
        old = _OLD_PHONE_DEFAULTS.get(r.get("type"))
        if not neu or not old:
            continue
        for k, ov in old.items():
            if r.get(k) == ov:
                r[k] = neu[k]
                changed = True
    return changed


def room_options(settings: dict, room: str) -> dict:
    """Phòng chưa có trong settings vẫn dùng mặc định (cho phép giấy, không cho máy tính)."""
    for r in settings.get("rooms") or []:
        if r.get("room") == room:
            return r
    return default_room(room or "")


def default_rules() -> dict:
    return {
        "rules": [
            {"type": "phone_near_hand", "enabled": True, "level": "cao", "minConfidence": 0.25,
             "nearHandThreshold": 0.28, "persistSeconds": 1.5},
            {"type": "phone_in_work_area", "enabled": True, "level": "trung_binh", "minConfidence": 0.25,
             "nearHandThreshold": 0.28, "persistSeconds": 2},
            {"type": "paper_present", "enabled": True, "level": "thong_tin", "minConfidence": 0.4,
             "nearHandThreshold": 0.15, "persistSeconds": 8},
            {"type": "calculator_present", "enabled": True, "level": "thong_tin", "minConfidence": 0.4,
             "nearHandThreshold": 0.15, "persistSeconds": 8},
        ],
        "rooms": [],
        "dedupeCooldownSeconds": 20,
    }


NO_INVIGILATOR = "no_invigilator"


def alert_message(t: str, track_id) -> str:
    if t == NO_INVIGILATOR:
        return "Nghi vấn: không thấy giám thị trong phòng"
    return {
        "phone_near_hand": f"Nghi vấn: điện thoại gần tay thí sinh #{track_id}",
        "phone_in_work_area": f"Nghi vấn: điện thoại trong vùng làm bài của #{track_id}",
        "phone_on_desk": f"Nghi vấn: điện thoại trên bàn của thí sinh #{track_id}",
        "paper_present": f"Nghi vấn: có giấy/tài liệu tại chỗ #{track_id}",
        "calculator_present": f"Nghi vấn: có máy tính cầm tay tại chỗ #{track_id}",
    }[t]


def is_candidate(p: dict) -> bool:
    """Thí sinh (hoặc chưa rõ vai trò). Giám thị không bao giờ là đối tượng cảnh báo thí sinh."""
    return p.get("role") != "invigilator"


def candidate_pairs(persons: list[dict]) -> list[tuple[dict, dict]]:
    """Các cặp người cho quy tắc 'gần nhau / trao đổi' — bỏ mọi cặp có giám thị."""
    c = [p for p in persons if is_candidate(p)]
    return [(c[i], c[j]) for i in range(len(c)) for j in range(i + 1, len(c))]


def _center(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


class RuleEngine:
    def __init__(self):
        self.tracks: dict[str, dict] = {}
        self.last_fired: dict[str, int] = {}
        self.no_inv_since: int | None = None
        self.no_inv_last: int | None = None

    def reset(self):
        self.tracks.clear()
        self.last_fired.clear()
        self.no_inv_since = None
        self.no_inv_last = None

    def _no_invigilator(self, f: dict, persons: list[dict]) -> list[dict]:
        sec = float(getattr(config, "ROOM_NO_INVIGILATOR_SEC", 0) or 0)
        if not f.get("roleEnabled") or sec <= 0:
            return []
        ts = f["ts"]
        if any(p.get("role") == "invigilator" for p in persons):
            self.no_inv_since = None
            return []
        if self.no_inv_since is None:
            self.no_inv_since = ts
            return []
        if ts - self.no_inv_since < sec * 1000:
            return []
        if self.no_inv_last is not None and ts - self.no_inv_last < max(INFO_COOLDOWN_MS, sec * 1000):
            return []
        self.no_inv_last = ts
        return [{"key": NO_INVIGILATOR, "type": NO_INVIGILATOR, "level": "thong_tin", "trackId": None,
                 "studentNo": None, "objectId": None, "confidence": 1.0, "personBbox": None,
                 "objectBbox": None, "startedAt": self.no_inv_since}]

    def process(self, f: dict, settings: dict, room: str, ignore_persist: bool = False) -> list[dict]:
        W, H = f["width"], f["height"]
        px = f["coord"] == "px"
        to_n = (lambda b: [b[0] / W, b[1] / H, b[2] / W, b[3] / H]) if px else (lambda b: list(b))
        aspect = W / H
        room_opt = room_options(settings, room)
        rules = {r["type"]: r for r in settings["rules"]}

        persons = []
        for p in f["poses"]:
            wrists = []
            for i in (9, 10):
                if i < len(p["keypoints"]):
                    k = p["keypoints"][i]
                    if k[2] >= 0.3:
                        wrists.append((k[0] / W, k[1] / H) if px else (k[0], k[1]))
            persons.append({"trackId": p["trackId"], "bbox": to_n(p["bbox"]), "wrists": wrists,
                            "role": p.get("role", "unknown"), "studentNo": p.get("studentNo", p["trackId"])})
        # Người chỉ có box (DET hoặc box vai trò), không có pose: vẫn tính để giám thị không bị bỏ sót
        pose_ids = {p["trackId"] for p in persons}
        for o in f["objects"]:
            if o.get("cls") == "person" and o.get("trackId") is not None and o["trackId"] not in pose_ids:
                pose_ids.add(o["trackId"])
                persons.append({"trackId": o["trackId"], "bbox": to_n(o["bbox"]), "wrists": [],
                                "role": o.get("role", "unknown"), "studentNo": o.get("studentNo", o["trackId"])})

        def nearest(c, hint=None):
            if hint is not None:
                for p in persons:
                    if p["trackId"] == hint:
                        return p
            best, bd = None, math.inf
            for p in persons:
                cx, cy = _center(p["bbox"])
                d = math.hypot((cx - c[0]) * aspect, cy - c[1])
                if d < bd:
                    best, bd = p, d
            return best

        conds: dict[str, dict] = {}

        def add(c):
            prev = conds.get(c["key"])
            if not prev or prev["confidence"] < c["confidence"]:
                conds[c["key"]] = c

        for o in f["objects"]:
            b = to_n(o["bbox"])
            c = _center(b)
            cls = o["cls"]
            if cls == "phone":
                # Ảnh đơn: điện thoại chỉ thấy ở lượt zoom (conf thấp) cần ngưỡng cao hơn để hạn chế báo sai.
                if (ignore_persist and o.get("source") == "zoom"
                        and o["conf"] < float(getattr(config, "PHONE_IMAGE_CONF", 0.35))):
                    continue
                p = nearest(c, o.get("trackId"))
                if not p or not is_candidate(p):
                    continue
                ph = max(p["bbox"][3] - p["bbox"][1], 1e-6)
                pw = p["bbox"][2] - p["bbox"][0]
                r_near = rules.get("phone_near_hand")
                d_hand = min([math.hypot((w[0] - c[0]) * aspect, w[1] - c[1]) for w in p["wrists"]] or [math.inf])
                near = False
                if r_near and r_near["enabled"] and o["conf"] >= r_near["minConfidence"]:
                    thr = r_near["nearHandThreshold"]
                    if p["wrists"] and d_hand / ph <= thr:
                        near = True
                    elif not p["wrists"]:
                        # Chỉ khi không thấy cổ tay (camera cận, 1 người): điện thoại trên thân, không phải mép bàn dưới.
                        pad_x, pad_y = pw * 0.25, ph * 0.15
                        inside = (p["bbox"][0] - pad_x <= c[0] <= p["bbox"][2] + pad_x
                                  and p["bbox"][1] - pad_y <= c[1] <= p["bbox"][3] - ph * 0.15)
                        mid_torso = (p["bbox"][1] + ph * 0.2) <= c[1] <= (p["bbox"][1] + ph * 0.75)
                        if inside and mid_torso:
                            near = True
                if near:
                    add({"key": f"phone_near_hand|{p['trackId']}", "type": "phone_near_hand", "level": r_near["level"],
                         "trackId": p["trackId"], "studentNo": p["studentNo"], "objectId": o["id"], "confidence": o["conf"],
                         "personBbox": p["bbox"], "objectBbox": b})
                    continue
                r_work = rules.get("phone_in_work_area")
                work = [p["bbox"][0] - pw * 0.6, p["bbox"][1] + ph * 0.25, p["bbox"][2] + pw * 0.6, p["bbox"][3] + ph * 0.4]
                in_work = work[0] <= c[0] <= work[2] and work[1] <= c[1] <= work[3]
                if r_work and r_work["enabled"] and o["conf"] >= r_work["minConfidence"] and in_work:
                    # Điện thoại nằm trên bàn, không gần tay đã thấy: chỉ Thông tin (không bắn Cao/Trung bình).
                    if p["wrists"]:
                        add({"key": f"phone_on_desk|{p['trackId']}", "type": "phone_on_desk",
                             "level": "thong_tin", "trackId": p["trackId"], "studentNo": p["studentNo"],
                             "objectId": o["id"], "confidence": o["conf"], "personBbox": p["bbox"], "objectBbox": b})
                    else:
                        add({"key": f"phone_in_work_area|{p['trackId']}", "type": "phone_in_work_area",
                             "level": r_work["level"], "trackId": p["trackId"], "studentNo": p["studentNo"],
                             "objectId": o["id"], "confidence": o["conf"], "personBbox": p["bbox"], "objectBbox": b})
            elif cls in ("paper", "calculator"):
                t = "paper_present" if cls == "paper" else "calculator_present"
                allowed = room_opt and (room_opt["allowPaper"] if cls == "paper" else room_opt["allowCalculator"])
                r = rules.get(t)
                if allowed or not r or not r["enabled"] or o["conf"] < r["minConfidence"]:
                    continue
                p = nearest(c, o.get("trackId"))
                if not p or not is_candidate(p):
                    continue
                # Mỗi thí sinh một khoá (không theo id vật thể) để bảng cảnh báo không bị spam
                add({"key": f"{t}|{p['trackId']}", "type": t, "level": r["level"], "trackId": p["trackId"],
                     "studentNo": p["studentNo"], "objectId": o["id"], "confidence": o["conf"], "personBbox": p["bbox"], "objectBbox": b})

        out = []
        ts = f["ts"]
        cooldown = settings.get("dedupeCooldownSeconds", 20) * 1000
        for key, c in conds.items():
            t = self.tracks.get(key)
            if not t:
                t = {"since": ts, "lastSeen": ts, "fired": False, "conf": c["confidence"], "hits": 0}
                self.tracks[key] = t
            t["lastSeen"] = ts
            t["conf"] = max(t["conf"] * 0.9, c["confidence"])
            t["hits"] = t.get("hits", 0) + 1
            persist = rules.get(c["type"], {}).get("persistSeconds", 3) * 1000
            need_hits = 1
            if (not ignore_persist) and str(c["type"]).startswith("phone"):
                need_hits = max(1, int(getattr(config, "PHONE_PERSIST_HITS", 2)))
            hits_ok = ignore_persist or t["hits"] >= need_hits
            if not t["fired"] and hits_ok and (ignore_persist or ts - t["since"] >= persist):
                t["fired"] = True
                last = self.last_fired.get(key)
                # Mức "Thông tin" chỉ báo 1 lần cho mỗi thí sinh trong INFO_COOLDOWN (mặc định 10 phút)
                cd = max(cooldown, INFO_COOLDOWN_MS) if c["level"] == "thong_tin" else cooldown
                if last is None or ts - last >= cd:
                    self.last_fired[key] = ts
                    out.append({**c, "confidence": round(t["conf"], 3), "startedAt": t["since"]})
        for key in [k for k, t in self.tracks.items() if ts - t["lastSeen"] > GAP_TOLERANCE_MS]:
            del self.tracks[key]
        if not ignore_persist:
            out += self._no_invigilator(f, persons)
        return out
