import time
import uuid

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app import db, main
from app.main import app
from app.seed import seed
from app.streams import CameraWorker, manager


def _client():
    c = TestClient(app)
    c.__enter__()
    t = c.post("/api/auth/login", json={"email": "admin@cmc.edu.vn", "password": "admin123"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {t}"
    c.token = t
    return c


def _color_jpg(w=640, h=360, color=(80, 40, 200), mark=True) -> bytes:
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = color
    if mark:
        cv2.rectangle(img, (20, 20), (w // 2, h // 2), (20, 220, 40), -1)
        cv2.putText(img, "CAM", (30, h - 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
    return cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()


def _dummy_worker(cid="cam-test", w=640, h=360):
    worker = CameraWorker({"id": cid, "name": "Test", "room": "R1",
                           "sourceType": "file", "sourceUrl": "x", "enabled": True})
    worker.latest_jpeg = _color_jpg(w, h)
    worker.frame_id = 1
    worker.frame_size = (w, h)
    worker.online = True
    manager.workers[cid] = worker
    return worker


def test_empty_start_and_dashboard():
    c = _client()
    assert c.get("/api/cameras").json() == []
    alerts = c.get("/api/alerts").json()
    assert alerts["total"] == 0 and alerts["items"] == []
    s = c.get("/api/stats/dashboard").json()
    assert s["camerasTotal"] == 0 and s["camerasRunning"] == 0
    assert s["alertsToday"] == 0 and s["confirmedToday"] == 0 and s["dismissedToday"] == 0
    assert s["spark"]["alerts"] == [0] * 7
    assert all(x["total"] == 0 and x["cao"] == 0 for x in s["perHour"])
    assert all(x["count"] == 0 for x in s["perType"])
    assert len(s["perHour"]) == 12
    rules = c.get("/api/rules").json()
    assert rules["rooms"] == [] and "rules" in rules
    users = c.get("/api/users").json()
    assert {u["email"] for u in users} == {"admin@cmc.edu.vn", "giamthi@cmc.edu.vn"}
    assert c.get("/api/auth/me").json()["user"]["role"] == "admin"


def test_reset_data_keeps_users():
    c = _client()
    cam = c.post("/api/cameras", json={"name": "CAM X", "room": "P.1", "sourceType": "rtsp",
                                       "sourceUrl": "http://127.0.0.1:9/video"}).json()
    assert cam["id"]
    db.alert_save({
        "id": f"al-test-{uuid.uuid4().hex[:6]}", "cameraId": cam["id"], "cameraName": "CAM X",
        "room": "P.1", "type": "phone_near_hand", "level": "cao", "status": "moi",
        "trackId": 3, "confidence": 0.9, "ts": int(time.time() * 1000),
        "message": "Nghi vấn: điện thoại gần tay thí sinh #3",
    })
    assert c.get("/api/cameras").json()
    assert c.get("/api/alerts").json()["total"] >= 1
    db.wipe_operational_data()
    seed()
    assert c.get("/api/cameras").json() == []
    assert c.get("/api/alerts").json()["total"] == 0
    # tài khoản vẫn đăng nhập được
    assert c.get("/api/auth/me").status_code == 200
    assert len(c.get("/api/users").json()) == 2
    assert c.get("/api/rules").json()["rooms"] == []


def test_test_connection_uniform_green_video(tmp_path):
    path = tmp_path / "green.avi"
    wr = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), 5, (320, 240))
    frame = np.zeros((240, 320, 3), np.uint8)
    frame[:] = (0, 255, 0)
    for _ in range(12):
        wr.write(frame)
    wr.release()
    from app.streams import test_connection as check_connection
    r = check_connection("file", str(path))
    assert r["ok"] is False
    assert r.get("hasPicture") is False
    assert "khung màu đặc" in r["message"]
    # video có hình thật thì ok
    path2 = tmp_path / "photo.avi"
    wr = cv2.VideoWriter(str(path2), cv2.VideoWriter_fourcc(*"MJPG"), 5, (320, 240))
    photo = np.zeros((240, 320, 3), np.uint8)
    cv2.circle(photo, (80, 80), 40, (10, 80, 200), -1)
    cv2.rectangle(photo, (150, 120), (300, 220), (200, 30, 20), -1)
    for _ in range(8):
        wr.write(photo)
    wr.release()
    r2 = check_connection("file", str(path2))
    assert r2["ok"] is True and r2.get("hasPicture") is True


def test_snapshot_resize_and_mjpeg_disconnect():
    c = _client()
    w = _dummy_worker("cam-snap")
    try:
        r = c.get("/api/cameras/cam-snap/snapshot.jpg")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/jpeg")
        full = cv2.imdecode(np.frombuffer(r.content, np.uint8), cv2.IMREAD_COLOR)
        assert full.shape[1] == 640
        r2 = c.get("/api/cameras/cam-snap/snapshot.jpg?w=480")
        assert r2.status_code == 200
        small = cv2.imdecode(np.frombuffer(r2.content, np.uint8), cv2.IMREAD_COLOR)
        assert small.shape[1] == 480
        assert len(r2.content) <= len(r.content)
        # MJPEG mở rồi đóng — không để rò luồng
        before = len(main._active_mjpeg)
        with c.stream("GET", "/api/cameras/cam-snap/stream.mjpg?w=320&fps=8") as resp:
            assert resp.status_code == 200
            data = b""
            for chunk in resp.iter_bytes():
                data += chunk
                if b"\xff\xd8" in data and len(data) > 800:
                    break
            assert b"--frame" in data or b"\xff\xd8" in data
        # cho event loop dọn generator
        deadline = time.time() + 2
        while time.time() < deadline and len(main._active_mjpeg) > before:
            time.sleep(0.05)
        assert len(main._active_mjpeg) == before
    finally:
        manager.workers.pop("cam-snap", None)
        # Thread CameraWorker chưa start() — không cần stop


def test_ws_grid_frames_and_disconnect():
    c = _client()
    _dummy_worker("cam-grid")
    try:
        with c.websocket_connect(f"/ws/grid?token={c.token}&cams=cam-grid&w=320&fps=5") as ws:
            ready = ws.receive_json()
            assert ready["type"] == "ready"
            assert ready["cameraIds"] == ["cam-grid"]
            ws.send_json({"type": "subscribe", "cameraIds": ["cam-grid"], "w": 320, "fps": 5})
            # frame có thể đã được gửi trước subscribe
            msg = None
            for _ in range(8):
                msg = ws.receive_json()
                if msg.get("type") == "frame":
                    break
            assert msg and msg["type"] == "frame"
            assert msg["cameraId"] == "cam-grid"
            import base64
            raw = base64.b64decode(msg["jpeg"])
            assert raw[:2] == b"\xff\xd8"
            arr = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
            assert arr is not None and arr.shape[1] == 320
        deadline = time.time() + 2
        while time.time() < deadline and main._active_grid_ws:
            time.sleep(0.05)
        assert not main._active_grid_ws
    finally:
        manager.workers.pop("cam-grid", None)


def test_bad_login():
    c = TestClient(app)
    assert c.post("/api/auth/login", json={"email": "x@y.z", "password": "no"}).status_code == 401
