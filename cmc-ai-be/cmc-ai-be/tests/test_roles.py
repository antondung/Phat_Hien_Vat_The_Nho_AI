"""Giám thị / thí sinh: model vai trò giả (không cần file .pt)."""
import numpy as np

from app import config, roles
from app.pipeline import FramePipeline
from app.roles import RoleDetector, RoleScheduler, load_role_detector, map_model_names, parse_role_classes
from app.rules import RuleEngine, alert_message, candidate_pairs, default_rules

W, H = 1280, 720
INV_BOX = [100, 100, 300, 700]     # giám thị bên trái
STU_BOX = [800, 200, 1000, 700]    # thí sinh bên phải
STU2_BOX = [450, 200, 650, 700]


class FakeRoleModel:
    """names như YOLO26m TSII; predict trả lần lượt từng danh sách trong `seq` (lặp lại phần tử cuối)."""

    def __init__(self, seq, names=None):
        self.names = names or {0: "student", 1: "teacher"}
        self.seq = list(seq)
        self.calls = 0

    def predict(self, frame):
        i = min(self.calls, len(self.seq) - 1)
        self.calls += 1
        return self.seq[i]


def _kps_with_wrist(box, wrist):
    k = [[0, 0, 0]] * 17
    k = [list(x) for x in k]
    k[9] = [wrist[0], wrist[1], 0.9]
    return k


def _pose(box, wrist=None):
    return {"conf": 0.9, "bbox": list(box),
            "keypoints": _kps_with_wrist(box, wrist) if wrist else [[0, 0, 0]] * 17}


def _phone_at(x, y):
    return {"cls": "phone", "conf": 0.9, "bbox": [x - 20, y - 30, x + 20, y + 30]}


def _install(seq, names=None):
    d = RoleDetector(FakeRoleModel(seq, names), "weights/role_best.pt")
    roles.set_role_detector(d)
    return d


def _frame(ts, objects, poses, enabled=True):
    return {"ts": ts, "width": W, "height": H, "coord": "px", "objects": objects, "poses": poses,
            "roleEnabled": enabled}


def test_model_names_mapping_case_insensitive_and_vietnamese():
    m = parse_role_classes(config.ROLE_CLASSES_RAW)
    assert map_model_names({0: "student", 1: "teacher"}, m) == {0: "student", 1: "invigilator"}
    assert map_model_names({0: "Thí Sinh", 1: "GIÁM THỊ"}, m) == {0: "student", 1: "invigilator"}
    assert map_model_names(["Sinh_Viên", "Invigilator"], m) == {0: "student", 1: "invigilator"}
    # Ghi đè ROLE_CLASSES
    m2 = parse_role_classes("invigilator:proctor;student:examinee")
    assert map_model_names({0: "examinee", 1: "proctor", 2: "teacher"}, m2) == {0: "student", 1: "invigilator"}
    # Không lớp nào khớp → tắt, không crash
    d = RoleDetector(FakeRoleModel([[]], {0: "cat", 1: "dog"}), "x.pt")
    assert d.enabled is False and d.error


def test_missing_role_file_is_graceful(capsys):
    d = load_role_detector("weights/khong-co-file-nay.pt")
    assert d.enabled is False
    assert "KHÔNG TÌM THẤY" in (d.error or "")
    assert "WARNING" in capsys.readouterr().out
    roles.set_role_detector(d)
    from fastapi.testclient import TestClient
    from app.main import app
    c = TestClient(app)
    tok = c.post("/api/auth/login", json={"email": "admin@cmc.edu.vn", "password": "admin123"}).json()["token"]
    r = c.get("/api/system/model", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    b = r.json()
    assert b["roleEnabled"] is False and "roleModel" in b and "roleClasses" in b
    # Pipeline vẫn chạy, role 'unknown', nhãn #trackId như cũ
    objs, poses = FramePipeline().run({"objects": [{"cls": "person", "conf": 0.9, "bbox": STU_BOX}],
                                       "poses": []}, roles=None, role_enabled=False)
    assert objs[0]["role"] == "unknown" and objs[0]["label"] == "#1"


def test_system_model_reports_role_fields():
    _install([[]])
    from app.detector import system_model_info
    info = system_model_info()
    assert info["roleEnabled"] is True
    assert info["roleModel"] == "role_best.pt"
    assert info["roleClasses"] == {"student": "student", "teacher": "invigilator"}


def test_student_label_is_trackid_invigilator_has_no_number():
    pipe = FramePipeline()
    raw = {"objects": [{"cls": "person", "conf": 0.9, "bbox": b} for b in (INV_BOX, STU2_BOX, STU_BOX)],
           "poses": []}
    rb = [{"role": "invigilator", "conf": 0.9, "bbox": INV_BOX},
          {"role": "student", "conf": 0.8, "bbox": STU2_BOX},
          {"role": "student", "conf": 0.8, "bbox": STU_BOX}]
    objs, _ = pipe.run(raw, roles=rb, role_enabled=True)
    persons = {tuple(o["bbox"]): o for o in objs if o["cls"] == "person"}
    inv = persons[tuple(float(v) for v in INV_BOX)]
    assert inv["role"] == "invigilator" and inv["label"] == "Giám thị" and inv["studentNo"] is None
    labels = sorted(o["label"] for o in objs if o["role"] == "student")
    # Nhãn thí sinh = 'Thí sinh #'+trackId (cùng số trong cảnh báo); giám thị trackId 1 nhãn 'Giám thị'
    assert labels == ["Thí sinh #2", "Thí sinh #3"]
    assert all(o["studentNo"] == o["trackId"] and o["label"] == f"Thí sinh #{o['trackId']}"
               for o in objs if o["role"] == "student")
    assert all(o["roleConf"] > 0 for o in objs if o["cls"] == "person")
    assert pipe.last_counts == {"invigilator": 1, "student": 2, "unknown": 0}


def test_role_smoothing_majority_vote():
    pipe = FramePipeline()
    raw = {"objects": [{"cls": "person", "conf": 0.9, "bbox": STU_BOX}], "poses": []}
    seq = ["student", "student", "invigilator", "student", "invigilator"]
    got = []
    for r in seq:
        objs, _ = pipe.run(raw, roles=[{"role": r, "conf": 0.7, "bbox": STU_BOX}], role_enabled=True)
        got.append(objs[0]["role"])
    # Một khung nhiễu 'invigilator' không làm đổi vai trò
    assert got == ["student"] * 5
    # Khung không chạy model vai trò: giữ vai trò đã làm mượt
    objs, _ = pipe.run(raw, roles=None, role_enabled=True)
    assert objs[0]["role"] == "student" and objs[0]["label"] == f"Thí sinh #{objs[0]['trackId']}"


def test_role_box_used_as_person_when_det_has_none():
    pipe = FramePipeline()
    rb = [{"role": "invigilator", "conf": 0.8, "bbox": INV_BOX, "areaFrac": 0.13}]
    raw = {"objects": [], "poses": []}
    # Lần đầu chưa đủ persist
    objs, _ = pipe.run(raw, roles=rb, role_enabled=True, frame_wh=(W, H))
    assert objs == []
    objs, _ = pipe.run(raw, roles=rb, role_enabled=True, frame_wh=(W, H))
    assert len(objs) == 1 and objs[0]["cls"] == "person" and objs[0]["source"] == "role"
    assert objs[0]["role"] == "invigilator"
    pipe.clear_roles()
    objs, _ = pipe.run(raw, roles=None, role_enabled=True, frame_wh=(W, H))
    assert objs == []
    # Khung đen / ôm mép / conf thấp / phủ lớn: không thành người ma (kể cả chạy 2 lần)
    pipe2 = FramePipeline()
    bad = [
        {"role": "student", "conf": 0.45, "bbox": [0, 0, 537, 702], "areaFrac": 0.41},
        {"role": "student", "conf": 0.9, "bbox": [0, 0, 900, 700], "areaFrac": 0.68},
        {"role": "student", "conf": 0.4, "bbox": [10, 10, 60, 90], "areaFrac": 0.004},
        {"role": "student", "conf": 0.85, "bbox": [0, 20, 80, 700], "areaFrac": 0.074},  # ôm mép trái, rất cao
    ]
    for _ in range(3):
        objs, _ = pipe2.run({"objects": [], "poses": []}, roles=bad, role_enabled=True, frame_wh=(W, H))
        assert objs == []


def test_invigilator_excluded_from_phone_alert():
    eng = RuleEngine()
    pipe = FramePipeline()
    settings = default_rules()
    # Điện thoại trong tay giám thị → không cảnh báo
    raw = {"objects": [_phone_at(200, 450)],
           "poses": [_pose(INV_BOX, wrist=(200, 450)), _pose(STU_BOX, wrist=(900, 500))]}
    rb = [{"role": "invigilator", "conf": 0.9, "bbox": INV_BOX}, {"role": "student", "conf": 0.9, "bbox": STU_BOX}]
    objs, poses = pipe.run(raw, roles=rb, role_enabled=True)
    assert eng.process(_frame(0, objs, poses), settings, "", ignore_persist=True) == []
    # Điện thoại trong tay thí sinh (trackId 2) → cảnh báo #2, cùng số với nhãn trên khung
    raw2 = {"objects": [_phone_at(900, 500)], "poses": raw["poses"]}
    objs, poses = pipe.run(raw2, roles=rb, role_enabled=True)
    out = RuleEngine().process(_frame(0, objs, poses), settings, "", ignore_persist=True)
    assert [a["type"] for a in out] == ["phone_near_hand"]
    assert out[0]["trackId"] == 2
    stu_pose = [q for q in poses if q["role"] == "student"][0]
    assert stu_pose["label"] == "Thí sinh #2"
    msg = alert_message(out[0]["type"], out[0]["trackId"])
    assert msg == "Nghi vấn: điện thoại gần tay thí sinh #2"
    assert "gian lận" not in msg


def test_candidate_pairs_skip_invigilator():
    ps = [{"trackId": 1, "role": "invigilator"}, {"trackId": 2, "role": "student"},
          {"trackId": 3, "role": "student"}, {"trackId": 4, "role": "unknown"}]
    pairs = {(a["trackId"], b["trackId"]) for a, b in candidate_pairs(ps)}
    assert pairs == {(2, 3), (2, 4), (3, 4)}


def test_no_invigilator_info_alert(monkeypatch):
    monkeypatch.setattr(config, "ROOM_NO_INVIGILATOR_SEC", 120)
    eng = RuleEngine()
    s = default_rules()
    stu = [{"id": "person-1", "cls": "person", "conf": 0.9, "bbox": STU_BOX, "trackId": 1,
            "role": "student", "studentNo": 1}]
    assert eng.process(_frame(0, stu, []), s, "") == []
    assert eng.process(_frame(119_000, stu, []), s, "") == []
    out = eng.process(_frame(121_000, stu, []), s, "")
    assert len(out) == 1 and out[0]["type"] == "no_invigilator" and out[0]["level"] == "thong_tin"
    assert out[0]["trackId"] is None
    assert alert_message("no_invigilator", None) == "Nghi vấn: không thấy giám thị trong phòng"
    assert eng.process(_frame(125_000, stu, []), s, "") == []   # không spam
    # Có giám thị → đặt lại; tắt bằng 0; không bật khi không có model vai trò
    inv = stu + [{"id": "person-2", "cls": "person", "conf": 0.9, "bbox": INV_BOX, "trackId": 2,
                  "role": "invigilator", "studentNo": None}]
    e2 = RuleEngine()
    for ts in range(0, 300_000, 10_000):
        assert e2.process(_frame(ts, inv, []), s, "") == []
    e3 = RuleEngine()
    assert all(e3.process(_frame(ts, stu, [], enabled=False), s, "") == [] for ts in range(0, 300_000, 10_000))
    monkeypatch.setattr(config, "ROOM_NO_INVIGILATOR_SEC", 0)
    e4 = RuleEngine()
    assert all(e4.process(_frame(ts, stu, []), s, "") == [] for ts in range(0, 300_000, 10_000))


def test_old_analysis_path_uses_roles(tmp_path, monkeypatch):
    import cv2
    from app import analysis
    img = np.full((H, W, 3), 80, np.uint8)
    p = tmp_path / "room.jpg"
    cv2.imwrite(str(p), img)

    def fake_detect(frame, hint=None, run_pose=True):
        return {"objects": [_phone_at(200, 450)],
                "poses": [_pose(INV_BOX, wrist=(200, 450)), _pose(STU_BOX, wrist=(900, 500))]}

    monkeypatch.setattr("app.analysis.run_detect", fake_detect)
    _install([[(1, 0.9, INV_BOX), (0, 0.9, STU_BOX)]])
    res = analysis.analyze_image(p, "room.jpg", None, "/media/x.jpg")
    assert res["alerts"] == []          # điện thoại của giám thị
    poses = res["frames"][0]["poses"]
    stu = [q for q in poses if q["role"] == "student"][0]
    assert {q["label"] for q in poses} == {"Giám thị", f"Thí sinh #{stu['trackId']}"}


def test_role_scheduler_every_n_and_adaptive():
    s = RoleScheduler(every_n=3, adaptive=False, fps=8)
    assert [s.due() for _ in range(6)] == [True, False, False, True, False, False]
    a = RoleScheduler(every_n=3, adaptive=True, fps=8)   # ngân sách 125 ms → 40% = 50 ms
    a.note(400)                                           # YOLO26m trên CPU chậm
    assert a.n == min(8, config.ROLE_MAX_EVERY_N)
    a2 = RoleScheduler(every_n=3, adaptive=True, fps=8)
    a2.note(20)
    assert a2.n == 3                                      # không giảm dưới ROLE_EVERY_N


def test_no_invigilator_alert_saved_with_null_trackid(monkeypatch, tmp_path):
    """Camera: alert no_invigilator lưu & phát với trackId null (không 0/-1)."""
    import numpy as np
    from app import db
    from app.streams import CameraWorker
    w = CameraWorker({"id": "cam-x", "name": "Cam X", "room": "P1", "sourceType": "file", "sourceUrl": "x.mp4"})
    c = {"type": "no_invigilator", "level": "thong_tin", "trackId": None, "objectId": None, "confidence": 1.0,
         "personBbox": None, "objectBbox": None, "startedAt": 0}
    w._fire(c, 1000, np.zeros((72, 128, 3), np.uint8))
    rows = db.alerts_query("type = ?", ["no_invigilator"])
    assert len(rows) == 1
    a = rows[0]
    assert a["trackId"] is None
    assert a["message"] == "Nghi vấn: không thấy giám thị trong phòng"
    assert a["level"] == "thong_tin"
    assert "gian lận" not in a["message"]


def _kps_hips(box, hip_y, score=0.9):
    k = [[0, 0, 0] for _ in range(17)]
    cx = (box[0] + box[2]) / 2
    k[11] = [cx - 10, hip_y, score]
    k[12] = [cx + 10, hip_y, score]
    return k


def test_standing_low_conf_student_becomes_unknown():
    """Hông cao hơn đường ngồi + conf student < 0.6 → unknown. Không ép giám thị.
    Chỉ cao hơn vì gần camera (không có pose hông) thì vẫn student — tránh nhầm hàng đầu."""
    pipe = FramePipeline()
    seated = [200, 400, 320, 620]
    seated2 = [400, 410, 520, 630]
    standing = [800, 80, 980, 700]
    # Hông người đứng cao hơn (y nhỏ hơn) hông hai người ngồi
    poses = [
        {"conf": 0.9, "bbox": seated, "keypoints": _kps_hips(seated, 560)},
        {"conf": 0.9, "bbox": seated2, "keypoints": _kps_hips(seated2, 570)},
        {"conf": 0.9, "bbox": standing, "keypoints": _kps_hips(standing, 280)},
    ]
    raw = {"objects": [{"cls": "person", "conf": 0.9, "bbox": b} for b in (seated, seated2, standing)],
           "poses": poses}
    roles_low = [
        {"role": "student", "conf": 0.9, "bbox": seated},
        {"role": "student", "conf": 0.9, "bbox": seated2},
        {"role": "student", "conf": 0.5, "bbox": standing},
    ]
    objs, _ = pipe.run(raw, roles=roles_low, role_enabled=True, frame_wh=(W, H))
    tall = [o for o in objs if o["bbox"][1] <= 100][0]
    short = [o for o in objs if o["bbox"][1] >= 390]
    assert all(o["role"] == "student" for o in short)
    assert tall["role"] == "unknown" and tall["label"] == f"#{tall['trackId']}"
    # conf cao: vẫn student
    pipe2 = FramePipeline()
    roles_hi = [dict(r) for r in roles_low]
    roles_hi[2] = {"role": "student", "conf": 0.85, "bbox": standing}
    objs2, _ = pipe2.run(raw, roles=roles_hi, role_enabled=True, frame_wh=(W, H))
    tall2 = [o for o in objs2 if o["bbox"][1] <= 100][0]
    assert tall2["role"] == "student"
    # Hàng đầu chỉ cao hơn (không có keypoint hông): không hạ thành unknown
    pipe3 = FramePipeline()
    raw3 = {"objects": [{"cls": "person", "conf": 0.9, "bbox": b} for b in (seated, seated2, standing)],
            "poses": []}
    objs3, _ = pipe3.run(raw3, roles=roles_low, role_enabled=True, frame_wh=(W, H))
    tall3 = [o for o in objs3 if o["bbox"][1] <= 100][0]
    assert tall3["role"] == "student"
