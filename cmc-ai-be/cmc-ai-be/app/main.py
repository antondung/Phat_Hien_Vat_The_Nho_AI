"""CMC AI — Back-end hệ thống giám sát phòng thi. Chạy: uvicorn app.main:app --port 8000"""
import asyncio
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, analysis_jobs, auth, config, db
from .detector import get_detector, system_model_info
from .realtime import hub
from .rules import default_room, default_rules, persist_default_room
from .seed import seed
from .streams import CameraWorker, list_webcams, manager, push_frames, test_connection

ALERT_TYPES = ["phone_near_hand", "phone_in_work_area", "paper_present", "calculator_present"]
# Loại cảnh báo hệ thống (không nằm trong bảng quy tắc PUT /rules)
SYSTEM_ALERT_TYPES = ["no_invigilator"]

# Số luồng MJPEG / WS lưới đang mở — generator phải dừng khi client ngắt kết nối
_active_mjpeg: set[object] = set()
_active_grid_ws: set[object] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    hub.loop = asyncio.get_running_loop()
    try:
        from .webcams import check_env
        check_env()
    except Exception as e:
        print(f"[cmc-ai] check_env: {type(e).__name__}: {e}", flush=True)
    seed()
    get_detector()
    try:
        from .roles import get_role_detector
        get_role_detector()  # thiếu file / lỗi load: chỉ WARNING, chạy tiếp không có vai trò
    except Exception as e:
        print(f"WARNING: [roles] {type(e).__name__}: {e}", flush=True)
    analysis_jobs.start()
    if config.AUTOSTART_CAMERAS:
        manager.sync()
    manager.start_status_loop()
    yield
    analysis_jobs.stop()
    manager.stop_all()


app = FastAPI(title="CMC AI API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

@app.exception_handler(HTTPException)
async def http_err(_: Request, e: HTTPException):
    return JSONResponse({"message": e.detail}, status_code=e.status_code)


API = "/api"


def body_of(d: dict, keys: list[str]) -> dict:
    return {k: d[k] for k in keys if k in d}


# ---------------- Auth ----------------
@app.post(API + "/auth/login")
async def login(req: Request):
    b = await req.json()
    row = db.user_by_email(b.get("email", ""))
    if not row or not auth.check_pw(b.get("password", ""), row["pw_hash"]):
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")
    u = db.user_public(row)
    if not u.get("active"):
        raise HTTPException(403, "Tài khoản đã bị khoá")
    return {"token": auth.make_token(u["id"]), "user": u}


@app.get(API + "/auth/me")
def me(req: Request, u: dict = Depends(auth.current_user)):
    h = req.headers.get("authorization", "")
    return {"token": h[7:] if h.lower().startswith("bearer ") else "", "user": u}


# ---------------- Cameras ----------------
CAM_KEYS = ["name", "room", "position", "sourceType", "sourceUrl", "enabled"]


@app.get(API + "/cameras")
def cameras(_: dict = Depends(auth.current_user)):
    return sorted(db.cameras_all(), key=lambda c: c["id"])


@app.post(API + "/cameras")
async def camera_create(req: Request, _: dict = Depends(auth.require_admin)):
    b = await req.json()
    c = {"id": f"cam-{uuid.uuid4().hex[:6]}", "createdAt": int(time.time() * 1000), "enabled": True,
         **body_of(b, CAM_KEYS)}
    for k in ("name", "room", "sourceType", "sourceUrl"):
        if not c.get(k) and not (k == "sourceUrl" and c.get("sourceType") in ("webcam", "phone")):
            raise HTTPException(400, f"Thiếu trường {k}")
    c.setdefault("position", "truoc")
    db.camera_save(c)
    persist_default_room(c.get("room"))
    manager.sync()
    return c


@app.patch(API + "/cameras/{cid}")
async def camera_update(cid: str, req: Request, _: dict = Depends(auth.require_admin)):
    c = db.camera_get(cid)
    if not c:
        raise HTTPException(404, "Không tìm thấy camera")
    old_room = c.get("room")
    c.update(body_of(await req.json(), CAM_KEYS))
    db.camera_save(c)
    _rename_room_in_rules(old_room, c.get("room"))
    persist_default_room(c.get("room"))
    manager.sync()
    return c


def _rename_room_in_rules(old: str | None, new: str | None):
    """Đổi phòng của camera: mang cấu hình phòng (giấy/máy tính) sang tên mới để không bị mất."""
    if not old or not new or old == new:
        return
    s = db.setting_get("rules")
    if not s:
        return
    rooms = s.get("rooms", [])
    still_used = any(x.get("room") == old for x in db.cameras_all())
    src = next((r for r in rooms if r.get("room") == old), None)
    if src and not any(r.get("room") == new for r in rooms):
        rooms.append({**src, "room": new})
    if not still_used:
        rooms = [r for r in rooms if r.get("room") != old]
    s["rooms"] = rooms
    db.setting_set("rules", s)


@app.delete(API + "/cameras/{cid}", status_code=204)
def camera_delete(cid: str, _: dict = Depends(auth.require_admin)):
    db.camera_delete(cid)
    manager.sync()


@app.post(API + "/cameras/test-connection")
async def camera_test(req: Request, _: dict = Depends(auth.current_user)):
    b = await req.json()
    url = b.get("sourceUrl", b.get("url", ""))
    return await asyncio.to_thread(test_connection, b.get("sourceType", "rtsp"), url, b.get("cameraId"))


MAX_PUSH_BYTES = 3 * 1024 * 1024


@app.get(API + "/sources/webcams")
async def sources_webcams(debug: int = 0, _: dict = Depends(auth.current_user)):
    """debug=1: {devices, hint} kèm mean/std/shape/dtype/time/error. Mặc định vẫn là mảng (tương thích FE)."""
    return await asyncio.to_thread(list_webcams, 6, bool(debug))


@app.post(API + "/cameras/phone")
async def camera_phone_create(req: Request, u: dict = Depends(auth.require_admin)):
    """Tạo camera điện thoại cho tab Quét QR: trả camera + token ngắn hạn chỉ dùng để đẩy hình."""
    try:
        b = await req.json()
    except Exception:
        b = {}
    n = sum(1 for c in db.cameras_all() if c.get("sourceType") == "phone") + 1
    c = {"id": f"cam-{uuid.uuid4().hex[:6]}", "createdAt": int(time.time() * 1000), "enabled": True,
         "name": b.get("name") or f"ĐT · CAM {n:02d}", "room": b.get("room") or "Demo",
         "position": b.get("position") or "truoc", "sourceType": "phone", "sourceUrl": ""}
    db.camera_save(c)
    persist_default_room(c.get("room"))
    manager.sync()
    tok = auth.make_token(u["id"], hours=config.PHONE_TOKEN_HOURS, scope=f"push:{c['id']}")
    return {"camera": c, "pushToken": tok, "pushPath": f"/ws/cameras/{c['id']}/push?token={tok}",
            "expiresInSec": int(config.PHONE_TOKEN_HOURS * 3600)}


@app.post(API + "/cameras/{cid}/frame", status_code=204)
async def camera_push_frame(cid: str, req: Request):
    """Điện thoại gửi 1 khung JPEG (body = image/jpeg). Dùng khi không mở được WebSocket."""
    h = req.headers.get("authorization", "")
    if not auth.user_from_token(h[7:] if h.lower().startswith("bearer ") else req.query_params.get("token"), f"push:{cid}"):
        raise HTTPException(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn")
    if not db.camera_get(cid):
        raise HTTPException(404, "Không tìm thấy camera")
    body = await req.body()
    if not body or len(body) > MAX_PUSH_BYTES:
        raise HTTPException(400, "Khung hình rỗng hoặc quá lớn")
    push_frames.put(cid, body)


@app.get(API + "/cameras/status")
def camera_status(_: dict = Depends(auth.current_user)):
    return manager.statuses()


async def _mjpeg(request: Request, cid: str, fps: float, width: int | None = None):
    """Sinh MJPEG; dừng ngay khi client ngắt (tránh giữ kết nối/luồng)."""
    key = object()
    _active_mjpeg.add(key)
    boundary = b"--frame"
    last = None
    try:
        while True:
            if await request.is_disconnected():
                break
            w = manager.workers.get(cid)
            jpg = w.jpeg_at(width) if w else None
            if jpg is not None and jpg is not last:
                last = jpg
                yield (boundary + b"\r\nContent-Type: image/jpeg\r\nContent-Length: " +
                       str(len(jpg)).encode() + b"\r\n\r\n" + jpg + b"\r\n")
            await asyncio.sleep(1 / max(fps, 0.5))
    except asyncio.CancelledError:
        raise
    finally:
        _active_mjpeg.discard(key)


def _clamp_w(w: int | None) -> int | None:
    if w is None:
        return None
    try:
        n = int(w)
    except (TypeError, ValueError):
        return None
    return None if n <= 0 else min(max(n, 80), 1280)


@app.get(API + "/cameras/{cid}/stream.mjpg")
async def camera_stream(request: Request, cid: str, fps: float = 15, w: int | None = None,
                        _: dict = Depends(auth.current_user)):
    """Luồng video gốc (MJPEG) cho Camera đơn (`<img src>`).

    Query: `fps` (1–30, mặc định 15), `w` (thu nhỏ theo chiều rộng, 80–1280).
    Lưới 3×3 không nên dùng endpoint này (Chrome chỉ giữ ~6 kết nối HTTP/1.1/host);
    hãy dùng snapshot.jpg?w=480 hoặc WebSocket /ws/grid.
    """
    if cid not in manager.workers:
        raise HTTPException(404, "Camera chưa chạy")
    return StreamingResponse(_mjpeg(request, cid, min(max(fps, 0.5), 30), _clamp_w(w)),
                             media_type="multipart/x-mixed-replace; boundary=frame")


@app.get(API + "/cameras/{cid}/snapshot.jpg")
def camera_snapshot(cid: str, w: int | None = None, q: int = 70, _: dict = Depends(auth.current_user)):
    """Ảnh JPEG mới nhất (khung gốc, chưa vẽ lớp phủ — FE tự vẽ từ detections).

    Query: `w` thu nhỏ theo chiều rộng (vd 480 cho lưới 3×3, cache theo khung),
    `q` chất lượng JPEG 40–95 (mặc định 70). 404 nếu chưa có khung.
    """
    worker = manager.workers.get(cid)
    if not worker or worker.latest_jpeg is None:
        raise HTTPException(404, "Chưa có khung hình")
    quality = min(max(int(q or 70), 40), 95)
    jpg = worker.jpeg_at(_clamp_w(w), quality)
    if not jpg:
        raise HTTPException(404, "Chưa có khung hình")
    return Response(content=jpg, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store, no-cache, must-revalidate"})



@app.get(API + "/cameras/{cid}/diag")
def camera_diag(cid: str, _: dict = Depends(auth.current_user)):
    """Chẩn đoán phân tích của một camera (kể cả phone/push): số khung đọc/phân tích, detectFps, lỗi gần nhất."""
    if not db.camera_get(cid):
        raise HTTPException(404, "Không tìm thấy camera")
    w = manager.workers.get(cid)
    return w.diag() if w else CameraWorker.idle_diag(cid)


# ---------------- Alerts ----------------
def _alert_where(p: dict) -> tuple[str, list]:
    conds, args = [], []
    for col, key in (("camera_id", "cameraId"), ("room", "room"), ("type", "type"), ("level", "level"),
                     ("status", "status")):
        if p.get(key):
            conds.append(f"{col}=?")
            args.append(p[key])
    if p.get("from"):
        conds.append("ts>=?")
        args.append(int(p["from"]))
    if p.get("to"):
        conds.append("ts<=?")
        args.append(int(p["to"]))
    if p.get("q"):
        conds.append("data LIKE ?")
        args.append(f"%{p['q']}%")
    return " AND ".join(conds), args


@app.get(API + "/alerts")
def alerts(req: Request, _: dict = Depends(auth.current_user)):
    p = dict(req.query_params)
    page, size = max(1, int(p.get("page", 1))), min(200, max(1, int(p.get("pageSize", 20))))
    where, args = _alert_where(p)
    return {"items": db.alerts_query(where, args, limit=size, offset=(page - 1) * size),
            "total": db.alerts_count(where, args), "page": page, "pageSize": size}


@app.get(API + "/alerts/recent")
def alerts_recent(limit: int = 5, _: dict = Depends(auth.current_user)):
    return db.alerts_query("", [], limit=min(max(limit, 1), 100))


@app.get(API + "/alerts/{aid}")
def alert_get(aid: str, _: dict = Depends(auth.current_user)):
    a = db.alert_get(aid)
    if not a:
        raise HTTPException(404, "Không tìm thấy cảnh báo")
    return a


@app.patch(API + "/alerts/{aid}")
async def alert_update(aid: str, req: Request, u: dict = Depends(auth.current_user)):
    a = db.alert_get(aid)
    if not a:
        raise HTTPException(404, "Không tìm thấy cảnh báo")
    b = await req.json()
    if b.get("status") not in ("moi", "xac_nhan", "bo_qua"):
        raise HTTPException(400, "Trạng thái không hợp lệ")
    a["status"] = b["status"]
    if "note" in b:
        a["note"] = b["note"]
    if a["status"] == "moi":  # đưa về "mới" thì xoá thông tin người xử lý
        a.pop("handledBy", None)
        a.pop("handledAt", None)
    else:
        a["handledBy"], a["handledAt"] = u["name"], int(time.time() * 1000)
    db.alert_save(a)
    hub.publish("alert_update", a)
    return a


# ---------------- Rules ----------------
@app.get(API + "/rules")
def rules_get(_: dict = Depends(auth.current_user)):
    return db.setting_get("rules") or default_rules()


@app.put(API + "/rules")
async def rules_put(req: Request, _: dict = Depends(auth.require_admin)):
    b = await req.json()
    if not isinstance(b.get("rules"), list) or {r.get("type") for r in b["rules"]} - set(ALERT_TYPES):
        raise HTTPException(400, "Cấu hình quy tắc không hợp lệ")
    b.setdefault("rooms", [])
    b.setdefault("dedupeCooldownSeconds", 20)
    db.setting_set("rules", b)
    return b


@app.post(API + "/rules/reset")
def rules_reset(_: dict = Depends(auth.require_admin)):
    s = default_rules()
    s["rooms"] = [default_room(r) for r in sorted({c["room"] for c in db.cameras_all()})]
    db.setting_set("rules", s)
    return s


# ---------------- Users ----------------
USER_KEYS = ["name", "email", "role", "active"]


@app.get(API + "/users")
def users(_: dict = Depends(auth.require_admin)):
    return db.users_all()


@app.post(API + "/users")
async def user_create(req: Request, _: dict = Depends(auth.require_admin)):
    b = await req.json()
    if not b.get("email") or not b.get("password") or not b.get("name"):
        raise HTTPException(400, "Cần nhập tên, email và mật khẩu")
    if db.user_by_email(b["email"]):
        raise HTTPException(409, "Email đã tồn tại")
    u = {"id": f"u-{uuid.uuid4().hex[:6]}", "role": "giam_thi", "active": True, **body_of(b, USER_KEYS),
         "createdAt": int(time.time() * 1000)}
    db.user_save(u, auth.hash_pw(b["password"]))
    return u


@app.patch(API + "/users/{uid}")
async def user_update(uid: str, req: Request, _: dict = Depends(auth.require_admin)):
    row = db.user_by_id(uid)
    if not row:
        raise HTTPException(404, "Không tìm thấy người dùng")
    u = db.user_public(row)
    b = await req.json()
    if b.get("email"):
        other = db.user_by_email(b["email"])
        if other and other["id"] != uid:
            raise HTTPException(409, "Email đã tồn tại")
    u.update(body_of(b, USER_KEYS))
    db.user_save(u, auth.hash_pw(b["password"]) if b.get("password") else None)
    return u


@app.delete(API + "/users/{uid}", status_code=204)
def user_delete(uid: str, me_: dict = Depends(auth.require_admin)):
    if uid == me_["id"]:
        raise HTTPException(400, "Không thể tự xoá tài khoản đang đăng nhập")
    db.user_delete(uid)


# ---------------- Stats ----------------
def _day_bounds(d: datetime) -> tuple[int, int]:
    s = d.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(s.timestamp() * 1000), int((s + timedelta(days=1)).timestamp() * 1000)


def _pct(cur: float, prev: float) -> float:
    return round((cur - prev) / prev * 100, 1) if prev else (100.0 if cur else 0.0)


@app.get(API + "/stats/dashboard")
def stats(_: dict = Depends(auth.current_user)):
    now = datetime.now()
    days = []
    for i in range(6, -1, -1):
        s, e = _day_bounds(now - timedelta(days=i))
        days.append({
            "alerts": db.alerts_count("ts>=? AND ts<?", [s, e]),
            "confirmed": db.alerts_count("ts>=? AND ts<? AND status='xac_nhan'", [s, e]),
            "dismissed": db.alerts_count("ts>=? AND ts<? AND status='bo_qua'", [s, e]),
        })
    st = manager.statuses()
    running = sum(1 for x in st if x["online"])
    today, yday = days[-1], days[-2]
    s, e = _day_bounds(now)
    todays = db.alerts_query("ts>=? AND ts<?", [s, e], order="ts ASC")
    per_hour = []
    for h in range(7, 19):
        hs = [a for a in todays if datetime.fromtimestamp(a["ts"] / 1000).hour == h]
        per_hour.append({"hour": f"{h:02d}h", "total": len(hs), "cao": sum(a["level"] == "cao" for a in hs)})
    return {
        "camerasRunning": running, "camerasTotal": len(st),
        "alertsToday": today["alerts"], "confirmedToday": today["confirmed"], "dismissedToday": today["dismissed"],
        "trend": {"alerts": _pct(today["alerts"], yday["alerts"]),
                  "confirmed": _pct(today["confirmed"], yday["confirmed"]),
                  "dismissed": _pct(today["dismissed"], yday["dismissed"]), "cameras": 0},
        "spark": {"alerts": [d["alerts"] for d in days], "confirmed": [d["confirmed"] for d in days],
                  "dismissed": [d["dismissed"] for d in days], "cameras": [running] * 7},
        "perHour": per_hour,
        "perType": [{"type": t, "count": sum(a["type"] == t for a in todays)} for t in ALERT_TYPES],
    }


# ---------------- Models ----------------
@app.get(API + "/models")
def models(_: dict = Depends(auth.current_user)):
    return get_detector().info()


# ---------------- Analysis ----------------
@app.post(API + "/analysis")
def analyze(file: UploadFile | None = File(None), sample: str | None = Form(None),
            _: dict = Depends(auth.current_user)):
    try:
        if sample == "sample-image":
            p, stem = analysis.sample_image()
            dst = config.MEDIA_DIR / "samples" / p.name
            if not dst.exists():
                shutil.copy(p, dst)
            return analysis.analyze_image(p, p.name, stem, f"/media/samples/{p.name}")
        if sample == "sample-video":
            p, stems = analysis.sample_video()
            return analysis.analyze_video(p, p.name, stems, f"/media/samples/{p.name}")
        if file is None:
            raise HTTPException(400, "Chưa chọn tệp")
        ext = Path(file.filename or "").suffix.lower() or ".bin"
        dst = config.MEDIA_DIR / "uploads" / f"{uuid.uuid4().hex[:10]}{ext}"
        with dst.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        return analysis.analyze_upload(dst, file.filename or dst.name, f"/media/uploads/{dst.name}")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post(API + "/analysis/jobs")
def analysis_job_create(file: UploadFile | None = File(None), sample: str | None = Form(None),
                        _: dict = Depends(auth.current_user)):
    """Tạo job phân tích, trả metadata ngay, chạy nền (một job tại một thời điểm, còn lại queued)."""
    tmp: Path | None = None
    try:
        if sample in ("sample-image", "sample-video"):
            job = analysis_jobs.create_from_sample(sample)
            return analysis_jobs.public_create(job)
        if file is None:
            raise HTTPException(400, "Chưa chọn tệp")
        ext = Path(file.filename or "").suffix.lower() or ".bin"
        tmp = config.MEDIA_DIR / "uploads" / f"{uuid.uuid4().hex[:10]}{ext}"
        tmp.parent.mkdir(parents=True, exist_ok=True)
        with tmp.open("wb") as f:
            shutil.copyfileobj(file.file, f)
        job = analysis_jobs.create_from_upload(tmp, file.filename or tmp.name)
        return analysis_jobs.public_create(job)
    except ValueError as e:
        raise HTTPException(400, str(e))
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


@app.get(API + "/analysis/jobs/{job_id}")
def analysis_job_get(job_id: str, since: float | None = None, _: dict = Depends(auth.current_user)):
    """since (giây): chỉ trả frames/alerts có t > since. Bỏ trống để lấy tất cả (kể cả t=0)."""
    job = analysis_jobs.get_job(job_id)
    if not job:
        raise HTTPException(404, "Không tìm thấy job phân tích")
    return analysis_jobs.public_status(job, since)


@app.delete(API + "/analysis/jobs/{job_id}", status_code=204)
def analysis_job_delete(job_id: str, _: dict = Depends(auth.current_user)):
    if not analysis_jobs.delete_job(job_id):
        raise HTTPException(404, "Không tìm thấy job phân tích")


@app.get(API + "/health")
def health():
    return {"ok": True, "detector": config.DETECTOR, "cameras": len(manager.workers)}


@app.get(API + "/system/model")
def system_model(_: dict = Depends(auth.current_user)):
    """Thông tin model đang chạy: file .pt, danh sách lớp (xác nhận 'cell phone'), device, imgsz, conf/iou."""
    return system_model_info()


# ---------------- WebSocket ----------------
@app.websocket("/ws/cameras/{cid}/push")
async def ws_camera_push(ws: WebSocket, cid: str, token: str | None = None):
    """Điện thoại đẩy hình theo thời gian thực: mỗi message nhị phân là 1 khung JPEG.
    BE trả {"type":"ack","received":n} mỗi 10 khung để điện thoại biết đang thông."""
    await ws.accept()
    if not auth.user_from_token(token, f"push:{cid}"):
        await ws.close(code=4401, reason="Token không hợp lệ")
        return
    if not db.camera_get(cid):
        await ws.close(code=4404, reason="Không tìm thấy camera")
        return
    n = 0
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            data = msg.get("bytes")
            if not data or len(data) > MAX_PUSH_BYTES:
                continue
            push_frames.put(cid, data)
            n += 1
            if n % 10 == 0:
                await ws.send_json({"type": "ack", "received": n})
    except (WebSocketDisconnect, Exception):
        pass


@app.websocket("/ws/grid")
async def ws_grid(ws: WebSocket, token: str | None = None, cams: str | None = None,
                  w: int = 480, fps: float = 5):
    """Luồng lưới: một WebSocket đẩy JPEG nhỏ của nhiều camera (~5 fps), tránh hết slot HTTP/1.1.

    Xác thực: ?token=<JWT> (token thường, không dùng token QR).
    Query tuỳ chọn: cams=cam-aa,cam-bb  w=480  fps=5
    Client có thể gửi: {"type":"subscribe","cameraIds":["cam-aa"],"w":480,"fps":5}
    Server đẩy: {"type":"frame","cameraId":"...","ts":...,"w":480,"h":270,"jpeg":"<base64>"}
    Dùng cho Giám sát → Hệ thống camera (lưới 3×3). Camera đơn vẫn dùng stream.mjpg.
    """
    await ws.accept()
    if not auth.user_from_token(token):
        await ws.close(code=4401, reason="Token không hợp lệ")
        return
    ids = [c.strip() for c in (cams or "").split(",") if c.strip()]
    width = _clamp_w(w) or 480
    rate = max(0.5, min(float(fps or 5), 15))
    key = object()
    _active_grid_ws.add(key)
    last: dict[str, object] = {}

    async def recv_loop():
        nonlocal ids, width, rate
        while True:
            msg = await ws.receive_json()
            if msg.get("type") == "subscribe":
                if msg.get("cameraIds") is not None:
                    ids = [str(x) for x in msg["cameraIds"]]
                if msg.get("w") is not None:
                    width = _clamp_w(msg.get("w")) or width
                if msg.get("fps") is not None:
                    try:
                        rate = max(0.5, min(float(msg["fps"]), 15))
                    except (TypeError, ValueError):
                        pass

    async def send_loop():
        import base64
        from .streams import now_ms
        await ws.send_json({"type": "ready", "w": width, "fps": rate, "cameraIds": ids})
        while True:
            for cid in list(ids):
                worker = manager.workers.get(cid)
                jpg = worker.jpeg_at(width) if worker else None
                if not jpg or last.get(cid) is jpg:
                    continue
                last[cid] = jpg
                # Lấy kích thước từ JPEG SOI? không cần chính xác — FE dùng naturalWidth.
                await ws.send_json({
                    "type": "frame", "cameraId": cid, "ts": now_ms(),
                    "w": width, "jpeg": base64.b64encode(jpg).decode("ascii"),
                })
            await asyncio.sleep(1.0 / max(rate, 0.5))

    recv_t = asyncio.create_task(recv_loop())
    send_t = asyncio.create_task(send_loop())
    try:
        done, pending = await asyncio.wait({recv_t, send_t}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in pending:
            try:
                await task
            except (asyncio.CancelledError, WebSocketDisconnect, Exception):
                pass
        for task in done:
            exc = task.exception() if not task.cancelled() else None
            if exc and not isinstance(exc, (WebSocketDisconnect, asyncio.CancelledError)):
                pass
    except (WebSocketDisconnect, Exception):
        recv_t.cancel()
        send_t.cancel()
    finally:
        for task in (recv_t, send_t):
            if not task.done():
                task.cancel()
                try:
                    await task
                except (asyncio.CancelledError, Exception):
                    pass
        _active_grid_ws.discard(key)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, token: str | None = None):
    await ws.accept()
    if not auth.user_from_token(token):
        await ws.close(code=4401, reason="Token không hợp lệ")
        return
    await hub.add(ws)
    await ws.send_json({"type": "camera_status", "data": manager.statuses()})
    try:
        while True:
            msg = await ws.receive_json()
            # Tuỳ chọn: {"type":"subscribe","cameraIds":["cam-01"]} để chỉ nhận detections của các camera đó
            if msg.get("type") == "subscribe":
                hub.subscribe(ws, msg.get("cameraIds"))
    except (WebSocketDisconnect, Exception):
        hub.remove(ws)


@app.websocket("/ws/analysis/{job_id}")
async def ws_analysis(ws: WebSocket, job_id: str, token: str | None = None):
    """Tiến độ phân tích. ?token=<JWT> như các WS khác. Kết nối lại: phát lại toàn bộ kết quả đã có,
    rồi gửi lô mỗi ~0.5 s. Nhiều client cùng lúc được phép."""
    await ws.accept()
    if not auth.user_from_token(token):
        await ws.close(code=4401, reason="Token không hợp lệ")
        return
    job = analysis_jobs.get_job(job_id)
    if not job:
        await ws.close(code=4404, reason="Không tìm thấy job")
        return
    sent_frames = 0
    sent_alerts = 0

    async def emit_progress(j):
        nonlocal sent_frames, sent_alerts
        batch_f = j.frames[sent_frames:]
        batch_a = j.alerts[sent_alerts:]
        sent_frames = len(j.frames)
        sent_alerts = len(j.alerts)
        await ws.send_json({
            "type": "progress",
            "progress": j.progress,
            "analysedSec": j.analysed_sec,
            "frames": batch_f,
            "alerts": batch_a,
        })

    try:
        # Phát lại toàn bộ kết quả đã có
        await emit_progress(job)
        if job.status == "done":
            await ws.send_json({"type": "done", "progress": 1, "duration": job.duration,
                                "totalFrames": job.total_frames, "totalAlerts": job.total_alerts})
            return
        if job.status == "error":
            await ws.send_json({"type": "error", "message": job.message or "Lỗi phân tích"})
            return
        while True:
            await asyncio.sleep(analysis_jobs.WS_BATCH_SEC)
            job = analysis_jobs.get_job(job_id)
            if not job:
                await ws.send_json({"type": "error", "message": "Đã huỷ phân tích."})
                return
            if sent_frames < len(job.frames) or sent_alerts < len(job.alerts) or job.status in ("done", "error"):
                await emit_progress(job)
            if job.status == "done":
                await ws.send_json({"type": "done", "progress": 1, "duration": job.duration,
                                    "totalFrames": job.total_frames, "totalAlerts": job.total_alerts})
                return
            if job.status == "error":
                await ws.send_json({"type": "error", "message": job.message or "Lỗi phân tích"})
                return
    except (WebSocketDisconnect, Exception):
        return


@app.get("/media/jobs/{job_id}/{filename}")
def analysis_job_media(job_id: str, filename: str):
    """File nguồn của job — cùng cách auth với /media khác (không cần JWT), hỗ trợ HTTP Range cho thẻ <video>."""
    path = analysis_jobs.media_file(job_id, filename)
    if not path:
        raise HTTPException(404, "Không tìm thấy tệp")
    import mimetypes
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, content_disposition_type="inline", filename=filename)


app.mount("/media", StaticFiles(directory=config.MEDIA_DIR), name="media")
