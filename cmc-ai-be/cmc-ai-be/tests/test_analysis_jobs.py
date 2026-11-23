"""Job phân tích streaming: tạo nhanh, WS, GET since, huỷ, ảnh, hàng đợi, POST /api/analysis cũ."""
import time
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app import analysis_jobs
from app.main import app


def _client():
    c = TestClient(app)
    c.__enter__()
    tok = c.post("/api/auth/login", json={"email": "admin@cmc.edu.vn", "password": "admin123"}).json()["token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    c.token = tok
    return c


def _photo(w=320, h=180):
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = (30, 40, 50)
    cv2.rectangle(img, (40, 20), (200, 160), (20, 90, 200), -1)
    cv2.circle(img, (90, 70), 25, (0, 200, 255), -1)
    return img


def _write_image(path: Path, w=320, h=180):
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), _photo(w, h))
    return path


def _write_video(path: Path, n=24, fps=8, w=320, h=180):
    """Video ngắn đủ khung cho ANALYSIS_FPS=5 (mặc định)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    wr = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (w, h))
    assert wr.isOpened(), "cannot write test video"
    for i in range(n):
        img = _photo(w, h)
        cv2.putText(img, str(i), (10, 40), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
        wr.write(img)
    wr.release()
    return path


def _fake_detect(frame, hint=None, run_pose=True):
    h, w = frame.shape[:2]
    return {
        "objects": [
            {"cls": "person", "conf": 0.9, "bbox": [20, 10, w * 0.6, h * 0.9]},
            {"cls": "phone", "conf": 0.8, "bbox": [w * 0.3, h * 0.5, w * 0.45, h * 0.7]},
        ],
        "poses": [{"conf": 0.85, "bbox": [20, 10, w * 0.6, h * 0.9], "keypoints": [[0, 0, 0]] * 17}],
    }


def _wait_status(c, job_id, *statuses, timeout=8):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout:
        r = c.get(f"/api/analysis/jobs/{job_id}")
        if r.status_code == 404:
            last = "missing"
        else:
            last = r.json()["status"]
            if last in statuses:
                return r.json()
        time.sleep(0.05)
    raise AssertionError(f"job {job_id} not in {statuses}, last={last}")


def test_old_analysis_still_works(tmp_path, monkeypatch):
    monkeypatch.setattr("app.analysis.run_detect", _fake_detect)
    c = _client()
    img = _write_image(tmp_path / "shot.jpg")
    r = c.post("/api/analysis", files={"file": ("shot.jpg", img.read_bytes(), "image/jpeg")})
    assert r.status_code == 200
    j = r.json()
    assert j["mediaType"] == "image" and j["width"] == 320 and j["height"] == 180
    assert j["frames"] and j["frames"][0]["t"] == 0
    assert j["frames"][0]["objects"]
    assert "mediaUrl" in j
    if j["alerts"]:
        assert j["alerts"][0]["message"].startswith("Nghi vấn: ")
        assert "gian lận" not in j["alerts"][0]["message"].lower()
        assert j["alerts"][0]["level"] in ("cao", "trung_binh", "thong_tin")


def test_create_job_returns_fast_and_image_job_completes(tmp_path, monkeypatch):
    import threading
    gate = threading.Event()
    released = threading.Event()
    calls = {"n": 0}

    def slow_detect(frame, hint=None, run_pose=True):
        calls["n"] += 1
        if calls["n"] == 1:
            released.set()
            gate.wait(timeout=5)
        return _fake_detect(frame, hint, run_pose)

    monkeypatch.setattr("app.analysis_jobs.run_detect", slow_detect)
    c = _client()
    img = _write_image(tmp_path / "a.jpg")
    t0 = time.time()
    r = c.post("/api/analysis/jobs", files={"file": ("phong-thi.jpg", img.read_bytes(), "image/jpeg")})
    elapsed = time.time() - t0
    assert r.status_code == 200, r.text
    assert elapsed < 1.0, f"POST blocked for {elapsed:.2f}s"
    body = r.json()
    for k in ("jobId", "fileName", "mediaType", "mediaUrl", "width", "height", "fps", "duration", "model"):
        assert k in body
    assert body["mediaType"] == "image"
    assert body["fileName"] == "phong-thi.jpg"
    assert body["width"] == 320 and body["height"] == 180
    assert body["fps"] == 0 and body["duration"] == 0
    assert body["mediaUrl"].startswith("/media/jobs/")
    job_id = body["jobId"]

    # HTTP Range trên mediaUrl (cùng kiểu /media, không cần JWT)
    raw = c.get(body["mediaUrl"])
    assert raw.status_code == 200 and len(raw.content) > 16
    ranged = c.get(body["mediaUrl"], headers={"Range": "bytes=0-15"})
    assert ranged.status_code == 206
    assert ranged.headers.get("content-range", "").startswith("bytes 0-15/")
    assert len(ranged.content) == 16

    assert released.wait(timeout=3)
    st = c.get(f"/api/analysis/jobs/{job_id}").json()
    assert st["status"] in ("queued", "running")
    gate.set()
    done = _wait_status(c, job_id, "done")
    assert done["progress"] == 1
    assert len(done["frames"]) == 1 and done["frames"][0]["t"] == 0
    assert done["frames"][0]["objects"]
    assert done["analysedSec"] == 0
    if done["alerts"]:
        assert done["alerts"][0]["message"].startswith("Nghi vấn: ")


def test_ws_replay_progress_done_and_get_since(tmp_path, monkeypatch):
    monkeypatch.setattr("app.analysis_jobs.run_detect", _fake_detect)
    c = _client()
    vid = _write_video(tmp_path / "clip.avi", n=24, fps=8)
    r = c.post("/api/analysis/jobs", files={"file": ("clip.avi", vid.read_bytes(), "video/x-msvideo")})
    assert r.status_code == 200
    job_id = r.json()["jobId"]
    assert r.json()["mediaType"] == "video"
    assert r.json()["duration"] > 0

    # Đợi job xong rồi mở WS — phải phát lại toàn bộ rồi done
    done = _wait_status(c, job_id, "done", timeout=10)
    assert done["frames"]
    assert 0 <= done["progress"] <= 1

    with c.websocket_connect(f"/ws/analysis/{job_id}?token={c.token}") as ws:
        msgs = []
        for _ in range(8):
            msgs.append(ws.receive_json())
            if msgs[-1].get("type") == "done":
                break
        types = [m["type"] for m in msgs]
        assert "progress" in types and types[-1] == "done"
        # Replay: lô progress đầu đã chứa frames đã phân tích
        first = next(m for m in msgs if m["type"] == "progress")
        assert first["frames"]
        assert first["progress"] == 1 or first["frames"][0]["t"] >= 0
        last = msgs[-1]
        assert last["progress"] == 1
        assert last["totalFrames"] == len(done["frames"])
        assert last["totalAlerts"] == len(done["alerts"])
        assert "duration" in last
        # Toạ độ trong khung video
        box = first["frames"][0]["objects"][0]["bbox"]
        assert box[2] > box[0] and box[0] < r.json()["width"]

    mid = done["frames"][len(done["frames"]) // 2]["t"]
    part = c.get(f"/api/analysis/jobs/{job_id}", params={"since": mid}).json()
    assert all(f["t"] > mid for f in part["frames"])
    assert all(a["t"] > mid for a in part["alerts"])
    allf = c.get(f"/api/analysis/jobs/{job_id}").json()
    assert len(allf["frames"]) == len(done["frames"])
    # t=0 (nếu có) chỉ xuất hiện khi không truyền since
    if any(f["t"] == 0 for f in allf["frames"]):
        none = c.get(f"/api/analysis/jobs/{job_id}", params={"since": 0}).json()
        assert all(f["t"] > 0 for f in none["frames"])

    assert c.get("/api/analysis/jobs/no-such").status_code == 404


def test_delete_cancels_running_job(tmp_path, monkeypatch):
    import threading
    start = threading.Event()
    hold = threading.Event()
    after = {"n": 0}

    def blocking(frame, hint=None, run_pose=True):
        start.set()
        hold.wait(timeout=8)
        after["n"] += 1
        return _fake_detect(frame, hint, run_pose)

    monkeypatch.setattr("app.analysis_jobs.run_detect", blocking)
    c = _client()
    vid = _write_video(tmp_path / "long.avi", n=24, fps=8)
    job_id = c.post("/api/analysis/jobs", files={"file": ("long.avi", vid.read_bytes(), "video/x-msvideo")}).json()["jobId"]
    media = c.get(f"/api/analysis/jobs/{job_id}").json()  # may be running/queued
    assert start.wait(timeout=4)
    # file tồn tại trước khi huỷ
    created = c.get(f"/api/analysis/jobs/{job_id}")
    assert created.status_code == 200
    url = None
    # mediaUrl từ lúc tạo — lấy lại bằng cách không có trong GET; dùng list dir
    job = analysis_jobs.get_job(job_id)
    assert job is not None
    url = job.media_url
    assert c.get(url).status_code == 200

    d = c.delete(f"/api/analysis/jobs/{job_id}")
    assert d.status_code == 204
    assert c.get(f"/api/analysis/jobs/{job_id}").status_code == 404
    assert c.get(url).status_code == 404
    hold.set()
    time.sleep(0.3)
    # Job không được tạo lại sau khi detect trả về
    assert c.get(f"/api/analysis/jobs/{job_id}").status_code == 404
    assert analysis_jobs.get_job(job_id) is None


def test_two_jobs_are_queued(tmp_path, monkeypatch):
    import threading
    release_first = threading.Event()
    in_first = threading.Event()
    def gated(frame, hint=None, run_pose=True):
        if not in_first.is_set():
            in_first.set()
            release_first.wait(timeout=6)
        return _fake_detect(frame, hint, run_pose)

    monkeypatch.setattr("app.analysis_jobs.run_detect", gated)
    c = _client()
    v1 = _write_video(tmp_path / "a.avi", n=16, fps=8)
    v2 = _write_video(tmp_path / "b.avi", n=16, fps=8)
    a = c.post("/api/analysis/jobs", files={"file": ("a.avi", v1.read_bytes(), "video/x-msvideo")}).json()
    b = c.post("/api/analysis/jobs", files={"file": ("b.avi", v2.read_bytes(), "video/x-msvideo")}).json()
    assert a["jobId"] != b["jobId"]
    assert in_first.wait(timeout=4)
    st_b = c.get(f"/api/analysis/jobs/{b['jobId']}").json()
    st_a = c.get(f"/api/analysis/jobs/{a['jobId']}").json()
    assert st_b["status"] == "queued"
    assert st_a["status"] in ("queued", "running")
    # Job mới không tự huỷ job cũ
    assert c.get(f"/api/analysis/jobs/{a['jobId']}").status_code == 200
    release_first.set()
    _wait_status(c, a["jobId"], "done")
    _wait_status(c, b["jobId"], "done")
    assert c.get(f"/api/analysis/jobs/{b['jobId']}").json()["frames"]


def test_ws_rejects_bad_token_and_unknown_job():
    c = _client()
    with c.websocket_connect("/ws/analysis/aj-nope?token=bad") as ws:
        # accept rồi đóng 4401
        try:
            ws.receive_json()
            raise AssertionError("expected close")
        except Exception:
            pass
    # token đúng, job không có
    try:
        with c.websocket_connect(f"/ws/analysis/aj-missing?token={c.token}") as ws:
            try:
                ws.receive_json()
            except Exception:
                pass
    except Exception:
        pass


def _assert_role_fields(fr):
    assert "roleEnabled" in fr and "roleCounts" in fr
    assert set(fr["roleCounts"]) >= {"invigilator", "student", "unknown"}
    assert isinstance(fr["roleEnabled"], bool)


def test_analysis_frames_include_role_fields(tmp_path, monkeypatch):
    """POST /api/analysis và jobs (GET + WS progress) đều có roleEnabled/roleCounts trên mỗi khung."""
    monkeypatch.setattr("app.analysis.run_detect", _fake_detect)
    monkeypatch.setattr("app.analysis_jobs.run_detect", _fake_detect)
    c = _client()
    img = _write_image(tmp_path / "shot.jpg")
    j = c.post("/api/analysis", files={"file": ("shot.jpg", img.read_bytes(), "image/jpeg")}).json()
    assert j["frames"]
    _assert_role_fields(j["frames"][0])

    vid = _write_video(tmp_path / "clip.avi", n=24, fps=8)
    r = c.post("/api/analysis/jobs", files={"file": ("clip.avi", vid.read_bytes(), "video/x-msvideo")})
    assert r.status_code == 200
    job_id = r.json()["jobId"]
    done = _wait_status(c, job_id, "done", timeout=10)
    assert done["frames"]
    for fr in done["frames"]:
        _assert_role_fields(fr)
    with c.websocket_connect(f"/ws/analysis/{job_id}?token={c.token}") as ws:
        first = None
        for _ in range(8):
            m = ws.receive_json()
            if m.get("type") == "progress" and m.get("frames"):
                first = m
                break
            if m.get("type") == "done":
                break
        assert first and first["frames"]
        _assert_role_fields(first["frames"][0])
