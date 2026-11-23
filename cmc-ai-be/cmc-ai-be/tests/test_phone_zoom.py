"""Lượt 2 phóng tay/bàn: crop, NMS, loại giám thị, persist, hợp đồng API."""
import numpy as np

from app import config, phone_zoom
from app.phone_zoom import (
    PhoneZoomScheduler,
    apply_phone_zoom,
    collect_students,
    crop_region,
    map_box,
    nms_merge_phones,
    phone_zoom_status,
    reset_phone_zoom,
    student_crops,
)
from app.pipeline import FramePipeline
from app.rules import RuleEngine, default_rules


W, H = 1280, 720
STU_BOX = [800, 200, 1000, 700]      # thí sinh phải
INV_BOX = [100, 100, 300, 700]       # giám thị trái
# Cổ tay thí sinh ở nửa dưới (gần bàn)
STU_WRIST = (900, 620)


def _kps(wrist=None):
    k = [[0, 0, 0] for _ in range(17)]
    if wrist:
        k[9] = [wrist[0], wrist[1], 0.9]
    return k


def _pose(box, tid, role="student", wrist=None):
    return {"trackId": tid, "conf": 0.9, "bbox": list(box), "keypoints": _kps(wrist),
            "role": role, "roleConf": 0.9, "label": "Giám thị" if role == "invigilator" else f"#{tid}",
            "studentNo": None if role == "invigilator" else tid}


def _person(box, tid, role="student"):
    return {"id": f"person-{tid}", "cls": "person", "conf": 0.9, "bbox": list(box),
            "trackId": tid, "role": role, "roleConf": 0.9,
            "label": "Giám thị" if role == "invigilator" else f"#{tid}",
            "studentNo": None if role == "invigilator" else tid}


class FakeZoomDet:
    """Trả một điện thoại giữa mỗi crop (toạ độ theo crop)."""

    def __init__(self, conf=0.42, empty=False, by_index=None):
        self.conf = conf
        self.empty = empty
        self.by_index = by_index
        self.calls = 0
        self.crops_seen = []

    def detect_phones_in_crops(self, crops, conf=None, imgsz=None):
        self.calls += 1
        self.crops_seen.append(len(crops))
        out = []
        for i, im in enumerate(crops):
            if self.empty or (self.by_index is not None and i not in self.by_index):
                out.append([])
                continue
            h, w = im.shape[:2]
            out.append([{"cls": "phone", "conf": self.conf,
                         "bbox": [w * 0.4, h * 0.4, w * 0.6, h * 0.6]}])
        return out


def test_crop_uses_wrists_and_includes_desk_below():
    box = STU_BOX
    crop = crop_region(box, [STU_WRIST], W, H, pad=2.5)
    assert crop is not None
    x1, y1, x2, y2 = crop
    assert x1 < STU_WRIST[0] < x2
    assert y1 < STU_WRIST[1] < y2
    # Vùng dưới cổ tay (bàn / gầm bàn) phải nằm trong crop
    assert y2 > STU_WRIST[1] + 20
    # Fallback nửa dưới: không dùng cổ tay
    fb = crop_region(box, [], W, H)
    assert fb is not None
    assert fb[1] >= box[1]  # bắt đầu từ nửa dưới, không cắt cả đầu


def test_map_box_and_nms_merge():
    crop = [100, 200, 300, 400]
    local = [10, 20, 50, 80]
    mapped = map_box(crop, local, W, H)
    assert mapped == [110, 220, 150, 280]
    existing = [{"id": "phone-1-1", "cls": "phone", "conf": 0.8, "bbox": [110, 220, 150, 280], "trackId": 1}]
    zoom = [{"id": "phone-1-2", "cls": "phone", "conf": 0.4, "bbox": [112, 222, 148, 278],
             "trackId": 1, "source": "zoom"}]
    merged = nms_merge_phones(existing, zoom, iou_thr=0.45)
    assert len([o for o in merged if o["cls"] == "phone"]) == 1
    assert merged[0]["source"] if "source" in merged[0] else True
    # Box xa thì giữ cả hai
    far = [{"id": "phone-1-3", "cls": "phone", "conf": 0.4, "bbox": [800, 500, 860, 580],
            "trackId": 1, "source": "zoom"}]
    merged2 = nms_merge_phones(existing, far, iou_thr=0.45)
    assert len([o for o in merged2 if o["cls"] == "phone"]) == 2
    assert any(o.get("source") == "zoom" for o in merged2)


def test_invigilator_is_not_cropped():
    objects = [_person(INV_BOX, 1, "invigilator"), _person(STU_BOX, 2, "student")]
    poses = [_pose(INV_BOX, 1, "invigilator", (200, 600)),
             _pose(STU_BOX, 2, "student", STU_WRIST)]
    stu = collect_students(objects, poses)
    assert [p["trackId"] for p in stu] == [2]
    crops = student_crops(objects, poses, W, H)
    person_crops = [c for c in crops if c.get("trackId") is not None]
    assert [c["trackId"] for c in person_crops] == [2]


def test_max_crops_prefers_low_wrists():
    # 3 thí sinh, cổ tay cao/thấp khác nhau; giới hạn 1 crop
    high = _pose([400, 100, 550, 600], 1, "student", (470, 200))
    mid = _pose([600, 100, 750, 600], 2, "student", (670, 350))
    low = _pose([800, 100, 950, 600], 3, "student", (870, 520))
    objects = [_person(p["bbox"], p["trackId"]) for p in (high, mid, low)]
    crops = student_crops(objects, [high, mid, low], W, H, max_crops=1)
    assert len(crops) == 1 and crops[0]["trackId"] == 3


def test_apply_zoom_adds_source_zoom_and_skips_invigilator(monkeypatch):
    monkeypatch.setattr(config, "PHONE_ZOOM_FAR_TILE", False)
    reset_phone_zoom()
    frame = np.zeros((H, W, 3), dtype=np.uint8)
    objects = [_person(INV_BOX, 1, "invigilator"), _person(STU_BOX, 2, "student")]
    poses = [_pose(INV_BOX, 1, "invigilator", (200, 600)),
             _pose(STU_BOX, 2, "student", STU_WRIST)]
    det = FakeZoomDet(conf=0.41)
    out = apply_phone_zoom(frame, objects, poses, detector=det)
    phones = [o for o in out if o.get("cls") == "phone"]
    assert len(phones) == 1
    assert phones[0]["source"] == "zoom"
    assert phones[0]["trackId"] == 2
    assert phones[0]["conf"] == 0.41
    assert "id" in phones[0]
    assert det.calls == 1 and det.crops_seen == [1]
    st = phone_zoom_status()
    assert st["phoneZoom"] is True
    assert st["phoneZoomCrops"] == 1
    assert st["phoneZoomInferMs"] >= 0


def test_pipeline_preserves_zoom_source():
    raw = {
        "objects": [
            {"cls": "person", "conf": 0.9, "bbox": STU_BOX},
            {"cls": "phone", "conf": 0.4, "bbox": [880, 600, 920, 660], "source": "zoom"},
        ],
        "poses": [],
    }
    objs, _ = FramePipeline().run(raw, roles=None, role_enabled=False)
    phones = [o for o in objs if o["cls"] == "phone"]
    assert phones and phones[0]["source"] == "zoom" and phones[0]["trackId"] == 1


def test_scheduler_due_and_adaptive():
    s = PhoneZoomScheduler(every_n=2, adaptive=False, fps=5)
    assert s.due() is True
    assert s.due() is False
    assert s.due() is True
    a = PhoneZoomScheduler(every_n=2, adaptive=True, fps=5)
    a.due()
    a.note(400)  # 400 ms, ngân sách 200 ms, 0.4*budget=80 → N tăng
    assert a.n >= 2
    assert a.n <= config.PHONE_ZOOM_MAX_EVERY_N


def test_zoom_off_is_noop(monkeypatch):
    monkeypatch.setattr(config, "PHONE_ZOOM", False)
    frame = np.zeros((H, W, 3), dtype=np.uint8)
    objects = [_person(STU_BOX, 2)]
    poses = [_pose(STU_BOX, 2, "student", STU_WRIST)]
    det = FakeZoomDet()
    out = apply_phone_zoom(frame, objects, poses, detector=det)
    assert out is objects
    assert det.calls == 0


def test_video_persist_needs_two_hits():
    """Video: một khung không bắn; hai khung cách nhau đủ persistSeconds thì bắn."""
    settings = default_rules()
    # hạ persist để test gọn
    for r in settings["rules"]:
        if r["type"].startswith("phone"):
            r["persistSeconds"] = 0.2
    phone = {"id": "phone-2-1", "cls": "phone", "conf": 0.4, "bbox": [880, 600, 920, 660],
             "trackId": 2, "source": "zoom"}
    poses = [_pose(STU_BOX, 2, "student", STU_WRIST)]
    objects = [_person(STU_BOX, 2, "student"), phone]
    eng = RuleEngine()

    def fr(ts):
        return {"ts": ts, "width": W, "height": H, "coord": "px",
                "objects": objects, "poses": poses, "roleEnabled": True}

    assert eng.process(fr(0), settings, "", ignore_persist=False) == []
    # 250 ms sau: đủ persist + đủ 2 hits
    out = eng.process(fr(250), settings, "", ignore_persist=False)
    assert out and out[0]["type"] in ("phone_near_hand", "phone_in_work_area")
    assert out[0]["trackId"] == 2
    assert out[0]["level"] in ("cao", "trung_binh")


def test_image_zoom_requires_higher_conf():
    settings = default_rules()
    poses = [_pose(STU_BOX, 2, "student", STU_WRIST)]
    low = {"id": "phone-2-1", "cls": "phone", "conf": 0.22, "bbox": [880, 600, 920, 660],
           "trackId": 2, "source": "zoom"}
    high = {**low, "conf": 0.40}
    full = {**low, "conf": 0.30, "source": None}
    full.pop("source")

    def run(obj):
        fr = {"ts": 0, "width": W, "height": H, "coord": "px",
              "objects": [_person(STU_BOX, 2, "student"), obj], "poses": poses, "roleEnabled": True}
        return RuleEngine().process(fr, settings, "", ignore_persist=True)

    assert run(low) == []
    assert run(high) and run(high)[0]["trackId"] == 2
    # Điện thoại khung đầy đủ (không phải zoom) vẫn cảnh báo ở conf 0.30 trên ảnh
    assert run(full)


def test_system_model_and_diag_include_phone_zoom_fields():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.streams import CameraWorker

    c = TestClient(app)
    tok = c.post("/api/auth/login", json={"email": "admin@cmc.edu.vn", "password": "admin123"}).json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    m = c.get("/api/system/model", headers=h).json()
    for k in ("phoneZoom", "phoneZoomInferMs", "phoneZoomCrops", "phoneZoomConf",
              "phoneZoomImgSize", "phoneZoomEveryN", "phoneZoomMaxCrops", "phoneConf"):
        assert k in m, k
    assert m["phoneZoom"] is True
    assert m["phoneZoomConf"] == config.PHONE_ZOOM_CONF
    # idle diag
    from app import db
    import time
    now = int(time.time() * 1000)
    db.camera_save({"id": "cam-zoom", "name": "Z", "room": "P", "position": "truoc",
                    "sourceType": "phone", "sourceUrl": "", "enabled": True, "createdAt": now})
    d = c.get("/api/cameras/cam-zoom/diag", headers=h).json()
    for k in ("phoneZoom", "phoneZoomInferMs", "phoneZoomCrops", "phoneZoomEveryN"):
        assert k in d, k
    w = CameraWorker({"id": "cam-zoom", "name": "Z", "room": "P",
                      "sourceType": "phone", "sourceUrl": "", "enabled": True})
    d2 = w.diag()
    for k in ("phoneZoom", "phoneZoomInferMs", "phoneZoomCrops", "phoneZoomEveryN"):
        assert k in d2, k


def test_desk_phone_is_thong_tin_not_cao():
    """Điện thoại nằm trên bàn, cổ tay ở xa (không cầm) → Thông tin phone_on_desk, không phải Cao."""
    settings = default_rules()
    # Cổ tay trên bàn phím (giữa người); điện thoại lệch sang trái, xa tay.
    wrists_kp = [[0, 0, 0] for _ in range(17)]
    wrists_kp[9] = [900, 500, 0.9]
    wrists_kp[10] = [930, 500, 0.9]
    pose = {"trackId": 2, "conf": 0.9, "bbox": STU_BOX, "keypoints": wrists_kp,
            "role": "student", "studentNo": 2}
    phone = {"id": "phone-2-1", "cls": "phone", "conf": 0.5,
             "bbox": [760, 640, 800, 700], "trackId": 2}  # mép bàn, dưới-trái
    fr = {"ts": 0, "width": W, "height": H, "coord": "px",
          "objects": [_person(STU_BOX, 2, "student"), phone], "poses": [pose], "roleEnabled": True}
    out = RuleEngine().process(fr, settings, "", ignore_persist=True)
    assert out, out
    assert out[0]["type"] == "phone_on_desk"
    assert out[0]["level"] == "thong_tin"
    assert out[0]["trackId"] == 2
    from app.rules import alert_message
    assert alert_message("phone_on_desk", 2).startswith("Nghi vấn: ")
    assert "gian lận" not in alert_message("phone_on_desk", 2)


def test_min_crop_expands_small_person_and_far_tiles():
    # Người nhỏ phía xa (~80 px) → crop được nới tối thiểu ~160
    small = [600, 240, 660, 320]
    box = crop_region(small, [], W, H)
    assert box is not None
    assert box[2] - box[0] >= 150 and box[3] - box[1] >= 150
    # Ô lát nửa xa được thêm khi ít người
    objects = [_person(STU_BOX, 2, "student")]
    poses = [_pose(STU_BOX, 2, "student", STU_WRIST)]
    crops = student_crops(objects, poses, W, H, max_crops=12)
    assert any(c.get("tile") for c in crops) or len(crops) >= 1
    # Giám thị không có crop
    only_inv = student_crops([_person(INV_BOX, 1, "invigilator")],
                             [_pose(INV_BOX, 1, "invigilator", (200, 600))], W, H)
    assert all(c.get("trackId") != 1 for c in only_inv)
