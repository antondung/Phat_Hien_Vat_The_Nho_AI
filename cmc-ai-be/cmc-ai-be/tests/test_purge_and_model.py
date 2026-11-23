"""Purge camera mẫu, /api/system/model, class map, quy tắc phòng mới."""
import time

from fastapi.testclient import TestClient

from app import config, db
from app.detector import _map_cls
from app.main import app
from app.rules import RuleEngine, default_rules, persist_default_room, room_options
from app.seed import is_sample_camera, purge_sample_data, seed


def _client():
    c = TestClient(app)
    c.__enter__()
    tok = c.post("/api/auth/login", json={"email": "admin@cmc.edu.vn", "password": "admin123"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    return c


def test_class_map_cell_phone():
    assert _map_cls("cell phone") == "phone"
    assert _map_cls("Cell Phone") == "phone"
    assert _map_cls("cell_phone") == "phone"
    assert _map_cls("cellphone") == "phone"
    assert _map_cls("person") == "person"
    assert _map_cls("student") == "person"
    assert _map_cls("toaster") is None


def test_purge_v3_wipes_all_alerts_once_keeps_user_cameras():
    """Migration v3: xoá hết cảnh báo/media một lần; camera người dùng và users giữ; lần sau giữ cảnh báo mới."""
    from app.rules import default_room, default_rules
    now = int(time.time() * 1000)
    # Giả lập DB cũ (data_version=2) còn camera mẫu + cảnh báo demo cả trên camera người dùng
    db.setting_set("data_version", {"version": 2, "purgedAt": now, "cameras": ["cam-01"], "alerts": 1})
    db.camera_save({"id": "cam-01", "name": "CAM 01", "room": "P.202", "position": "truoc",
                    "sourceType": "file", "sourceUrl": "dataset://VPC2_202_1008", "enabled": True, "createdAt": now})
    db.camera_save({"id": "cam-user", "name": "ĐT · CAM 01", "room": "Demo", "position": "truoc",
                    "sourceType": "webcam", "sourceUrl": "webcam://msmf/0", "enabled": True, "createdAt": now})
    db.alert_save({"id": "al-sample-1", "cameraId": "cam-01", "cameraName": "CAM 01", "room": "P.202",
                   "type": "phone_near_hand", "level": "cao", "status": "moi", "trackId": 1,
                   "confidence": 0.9, "ts": now, "message": "Nghi vấn: điện thoại gần tay thí sinh #1"})
    db.alert_save({"id": "al-user-1", "cameraId": "cam-user", "cameraName": "ĐT · CAM 01", "room": "Demo",
                   "type": "phone_near_hand", "level": "cao", "status": "moi", "trackId": 1,
                   "confidence": 0.9, "ts": now, "message": "Nghi vấn: điện thoại gần tay thí sinh #1"})
    s = db.setting_get("rules") or default_rules()
    s["rooms"] = [default_room("P.202"), default_room("Demo"), default_room("Phòng rác")]
    db.setting_set("rules", s)
    up = config.MEDIA_DIR / "uploads" / "leftover.bin"
    up.parent.mkdir(parents=True, exist_ok=True)
    up.write_bytes(b"old-upload")
    snap = config.MEDIA_DIR / "alerts" / "al-sample-1.jpg"
    snap.parent.mkdir(parents=True, exist_ok=True)
    snap.write_bytes(b"old-snap")
    assert is_sample_camera(db.camera_get("cam-01"))
    assert not is_sample_camera(db.camera_get("cam-user"))
    assert not config.SEED_DEMO
    assert config.DATA_VERSION == 3

    out = purge_sample_data()
    assert out["fullWipe"] is True
    assert "cam-01" in out["cameras"]
    assert out["alerts"] >= 2
    assert db.camera_get("cam-01") is None
    user_cam = db.camera_get("cam-user")
    assert user_cam and user_cam["sourceUrl"] == "webcam://msmf/0"
    assert db.alert_get("al-sample-1") is None
    assert db.alert_get("al-user-1") is None  # v3: cảnh báo cũ của cam người dùng cũng gỡ một lần
    assert not up.exists() and not snap.exists()
    rooms = [r["room"] for r in (db.setting_get("rules") or {}).get("rooms") or []]
    assert "Phòng rác" not in rooms and "P.202" not in rooms
    assert "Demo" in rooms
    assert any(u["email"] == "admin@cmc.edu.vn" for u in db.users_all())
    mark = db.setting_get("data_version")
    assert mark and mark.get("version") == 3

    # Lần start sau: cảnh báo mới không bị xoá
    db.alert_save({"id": "al-new-1", "cameraId": "cam-user", "cameraName": "ĐT · CAM 01", "room": "Demo",
                   "type": "phone_near_hand", "level": "cao", "status": "moi", "trackId": 1,
                   "confidence": 0.9, "ts": now, "message": "Nghi vấn: điện thoại gần tay thí sinh #1"})
    out2 = purge_sample_data()
    assert out2["fullWipe"] is False
    assert out2["cameras"] == []
    assert db.alert_get("al-new-1") is not None

    # Camera dataset:// sót sau v3 vẫn bị gỡ, nhưng cảnh báo của cam người dùng giữ
    db.camera_save({"id": "cam-02", "name": "CAM 02", "room": "P.203", "position": "truoc",
                    "sourceType": "file", "sourceUrl": "dataset://VPC2_203_1008", "enabled": True, "createdAt": now})
    db.alert_save({"id": "al-sample-2", "cameraId": "cam-02", "cameraName": "CAM 02", "room": "P.203",
                   "type": "phone_in_work_area", "level": "trung_binh", "status": "moi", "trackId": 2,
                   "confidence": 0.8, "ts": now, "message": "Nghi vấn: điện thoại trong khu vực làm bài thí sinh #2"})
    out3 = purge_sample_data()
    assert "cam-02" in out3["cameras"]
    assert out3["fullWipe"] is False
    assert db.camera_get("cam-02") is None
    assert db.alert_get("al-sample-2") is None
    assert db.alert_get("al-new-1") is not None


def test_system_model_endpoint():
    c = _client()
    r = c.get("/api/system/model")
    assert r.status_code == 200
    j = r.json()
    for k in ("detModel", "poseModel", "classes", "device", "imgSize", "conf", "iou", "detectFps", "fallback"):
        assert k in j
    assert isinstance(j["classes"], list) and j["classes"]
    # test dùng DETECTOR=mock
    assert j["detModel"] == "mock"
    assert j["fallback"] is False
    # chưa đăng nhập
    c2 = TestClient(app)
    assert c2.get("/api/system/model").status_code == 401


def test_new_room_gets_default_rules():
    persist_default_room("Demo")
    s = db.setting_get("rules")
    opt = room_options(s, "Demo")
    assert opt["allowPaper"] is True and opt["allowCalculator"] is False
    # phòng lạ chưa ghi vẫn dùng mặc định khi xét luật
    opt2 = room_options(s, "Phòng chưa có")
    assert opt2["allowPaper"] is True
    eng = RuleEngine()
    # 1 người đối diện, điện thoại trong nửa dưới hộp người, chưa chắc có cổ tay
    fr = {
        "ts": 10_000, "width": 1280, "height": 720, "coord": "px",
        "objects": [
            {"id": "person-1", "cls": "person", "conf": 0.8, "bbox": [200, 80, 1000, 700], "trackId": 1},
            {"id": "phone-1-1", "cls": "phone", "conf": 0.35, "bbox": [520, 420, 700, 620], "trackId": 1},
        ],
        "poses": [{"trackId": 1, "conf": 0.8, "bbox": [200, 80, 1000, 700],
                   "keypoints": [[0, 0, 0]] * 17}],
    }
    out = eng.process(fr, s or default_rules(), "Demo", ignore_persist=True)
    assert out, f"expected a phone alert, got {out}"
    assert out[0]["type"] in ("phone_near_hand", "phone_in_work_area")
    assert out[0]["message"] if "message" in out[0] else True
    # message is added later in _fire; type/level is enough here
    assert out[0]["trackId"] == 1
    assert out[0]["level"] in ("cao", "trung_binh")


def test_camera_diag_and_ws_payload_fields():
    from app.streams import CameraWorker, manager
    c = _client()
    # camera chưa có worker
    now = int(time.time() * 1000)
    db.camera_save({"id": "cam-diag", "name": "Diag", "room": "Demo", "position": "truoc",
                    "sourceType": "phone", "sourceUrl": "", "enabled": True, "createdAt": now})
    r = c.get("/api/cameras/cam-diag/diag")
    assert r.status_code == 200
    j = r.json()
    for k in ("framesRead", "analysedFrames", "detectFps", "lastDetectTs", "lastObjects",
              "inferMs", "lastError", "detector"):
        assert k in j
    assert j["detector"] == "not_started"
    assert j["framesRead"] == 0 and j["lastError"] is None
    assert c.get("/api/cameras/no-such/diag").status_code == 404

    w = CameraWorker({"id": "cam-diag", "name": "Diag", "room": "Demo",
                      "sourceType": "phone", "sourceUrl": "", "enabled": True})
    w.frames_read = 20
    w.analysed_frames = 8
    w.detect_fps = 2.5
    w.last_detect_ts = now
    w.last_objects = 3
    w.latency_ms = 140
    w.last_error = None
    w._started_loop = True
    w.online = True
    manager.workers["cam-diag"] = w
    try:
        d = c.get("/api/cameras/cam-diag/diag").json()
        assert d["framesRead"] == 20 and d["analysedFrames"] == 8
        assert d["detectFps"] == 2.5 and d["lastObjects"] == 3
        assert d["inferMs"] == 140 and d["detector"] == "running"
        st = c.get("/api/cameras/status").json()
        row = next(x for x in st if x["cameraId"] == "cam-diag")
        assert row["framesRead"] == 20 and row["detector"] == "running"
        fr = w._emit_detections(
            [{"id": "person-1", "cls": "person", "conf": 0.9, "bbox": [10, 20, 110, 220]}],
            [], now, 1, 1280, 720,
        )
        assert fr["cameraId"] == "cam-diag"
        assert fr["frameTs"] == now
        assert fr["frameW"] == 1280 and fr["frameH"] == 720
        assert fr["width"] == 1280 and fr["height"] == 720
        assert fr["coord"] == "px"
    finally:
        manager.workers.pop("cam-diag", None)


def test_get_endpoints_after_purge_have_no_leftover_demo_rows():
    """Audit GET mà FE dùng trên DB đã dọn (SEED_DEMO=0, không camera người dùng)."""
    c = _client()
    assert c.get("/api/cameras").json() == []
    assert c.get("/api/cameras/status").json() == []
    alerts = c.get("/api/alerts").json()
    assert alerts["total"] == 0 and alerts["items"] == []
    assert c.get("/api/alerts/recent").json() == []
    assert c.get("/api/alerts/al-missing").status_code == 404
    assert c.get("/api/cameras/no-cam/diag").status_code == 404
    assert c.get("/api/cameras/no-cam/snapshot.jpg").status_code == 404

    me = c.get("/api/auth/me").json()
    assert me["user"]["email"] == "admin@cmc.edu.vn"
    users = c.get("/api/users").json()
    assert {u["email"] for u in users} == {"admin@cmc.edu.vn", "giamthi@cmc.edu.vn"}

    rules = c.get("/api/rules").json()
    assert rules["rooms"] == [] and isinstance(rules.get("rules"), list) and rules["rules"]

    dash = c.get("/api/stats/dashboard").json()
    assert dash["camerasTotal"] == 0 and dash["camerasRunning"] == 0
    assert dash["alertsToday"] == 0 and dash["confirmedToday"] == 0 and dash["dismissedToday"] == 0
    assert dash["spark"]["alerts"] == [0] * 7
    # spark.cameras lặp giá trị running hiện tại (không phải chuỗi lịch sử thật)
    assert dash["spark"]["cameras"] == [0] * 7
    assert all(x["total"] == 0 for x in dash["perHour"])
    assert all(x["count"] == 0 for x in dash["perType"])

    health = c.get("/api/health").json()
    assert health["ok"] is True and health["cameras"] == 0

    models = c.get("/api/models").json()
    assert isinstance(models, list) and models
    # DETECTOR=mock: tên/fps là mô tả mock, metrics rỗng — không phải số liệu bịa từ DB
    for m in models:
        assert m.get("metrics") == []
        assert "Mock" in m["name"]

    sm = c.get("/api/system/model").json()
    assert sm["detModel"] == "mock"
    assert sm["fallback"] is False

    cams = c.get("/api/sources/webcams").json()
    assert isinstance(cams, list)  # máy chủ có thể không có webcam; không phải dữ liệu demo trong DB
