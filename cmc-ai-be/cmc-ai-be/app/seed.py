"""Khởi tạo tài khoản / quy tắc, và dọn camera mẫu dataset:// khi không bật SEED_DEMO."""
import time
from pathlib import Path

from . import auth, config, db
from .rules import default_room, default_rules, migrate_phone_rule_defaults


DATA_VERSION_KEY = "data_version"


def is_sample_camera(c: dict) -> bool:
    """Camera giả phát lại dataset (không phải camera người dùng tạo)."""
    url = str(c.get("sourceUrl") or "").strip().lower()
    return url.startswith("dataset://")


def _purge_media_for_alerts(alerts: list[dict]) -> int:
    n = 0
    media = config.MEDIA_DIR
    for a in alerts:
        aid = a.get("id") or ""
        candidates = []
        for key in ("snapshotUrl", "clipUrl"):
            u = a.get(key) or ""
            if u.startswith("/media/"):
                candidates.append(media / u[len("/media/"):])
        if aid:
            candidates.append(media / "alerts" / f"{aid}.jpg")
            candidates.append(media / "alerts" / f"{aid}.mp4")
        seen = set()
        for pth in candidates:
            try:
                pth = Path(pth)
                if pth in seen or not pth.exists() or not pth.is_file():
                    continue
                seen.add(pth)
                pth.unlink()
                n += 1
            except OSError:
                pass
    return n


def _clear_media_subdir(sub: str) -> int:
    """Xoá mọi file/thư mục con trong data/media/<sub> (alerts, uploads, samples sao chép)."""
    import shutil
    d = config.MEDIA_DIR / sub
    n = 0
    if not d.exists():
        return 0
    for pth in list(d.iterdir()):
        try:
            if pth.is_file() or pth.is_symlink():
                pth.unlink()
                n += 1
            elif pth.is_dir():
                shutil.rmtree(pth, ignore_errors=True)
                n += 1
        except OSError:
            pass
    return n


def _stored_data_version() -> int:
    mark = db.setting_get(DATA_VERSION_KEY)
    if isinstance(mark, dict) and mark.get("version") is not None:
        try:
            return int(mark["version"])
        except (TypeError, ValueError):
            return 0
    if isinstance(mark, (int, float)):
        return int(mark)
    return 0


def purge_sample_data() -> dict:
    """Khi SEED_DEMO không bật:

    - Luôn gỡ camera `dataset://` (idempotent), không đụng camera người dùng hay users.
    - Nếu marker data_version < 3 (một lần): xoá TOÀN BỘ cảnh báo (kể cả của camera người dùng),
      clip/ảnh cảnh báo, upload phân tích, samples sao chép, và phòng không còn camera.
      Thống kê dashboard tính từ alerts nên cũng về 0. Không có bảng sessions/notifications riêng.
    """
    now = int(time.time() * 1000)
    prev = _stored_data_version()
    result = {"version": config.DATA_VERSION, "purgedAt": now, "previousVersion": prev,
              "cameras": [], "alerts": 0, "media": 0, "fullWipe": False, "skipped": False}
    if config.SEED_DEMO:
        result["skipped"] = True
        result["reason"] = "SEED_DEMO=1"
        print("[cmc-ai] SEED_DEMO=1 — giữ camera mẫu dataset:// (không purge).", flush=True)
        return result

    samples = [c for c in db.cameras_all() if is_sample_camera(c)]
    ids = [c["id"] for c in samples]
    for c in samples:
        db.camera_delete(c["id"])
    result["cameras"] = ids

    do_full = prev < config.DATA_VERSION  # v3: một lần xoá hết dữ liệu vận hành còn sót
    if do_full:
        alerts = db.alerts_delete_all()
        result["alerts"] = len(alerts)
        result["media"] = (
            _purge_media_for_alerts(alerts)
            + _clear_media_subdir("alerts")
            + _clear_media_subdir("uploads")
            + _clear_media_subdir("samples")
        )
        result["fullWipe"] = True
        print(
            f"[cmc-ai] data_version={config.DATA_VERSION} (trước đó {prev}): dọn toàn bộ dữ liệu vận hành — "
            f"gỡ {len(ids)} camera mẫu ({', '.join(ids) or '—'}), xoá {result['alerts']} cảnh báo "
            f"và {result['media']} file media (alerts/uploads/samples). "
            f"Giữ tài khoản và camera người dùng; cảnh báo cũ của camera người dùng cũng được gỡ một lần.",
            flush=True,
        )
    else:
        # Đã ở v3+: chỉ gỡ camera dataset:// nếu còn sót, không xoá cảnh báo mới
        if ids:
            leftover = db.alerts_delete_by_camera_ids(ids)
            result["alerts"] = len(leftover)
            result["media"] = _purge_media_for_alerts(leftover)
            print(
                f"[cmc-ai] data_version={config.DATA_VERSION}: gỡ thêm {len(ids)} camera mẫu "
                f"({', '.join(ids)}) và {result['alerts']} cảnh báo của chúng.",
                flush=True,
            )
        else:
            print(f"[cmc-ai] data_version={config.DATA_VERSION}: không còn camera mẫu dataset:// để gỡ.", flush=True)

    # Phòng không còn camera thì bỏ khỏi rules; giữ các rule mặc định
    s = db.setting_get("rules")
    if s:
        used = {c.get("room") for c in db.cameras_all() if c.get("room")}
        s["rooms"] = [r for r in (s.get("rooms") or []) if r.get("room") in used]
        db.setting_set("rules", s)

    db.setting_set(DATA_VERSION_KEY, result)
    return result


def ensure_rooms_in_rules() -> None:
    """Mọi phòng đang có camera đều có cấu hình quy tắc mặc định (giấy được phép, máy tính không)."""
    s = db.setting_get("rules") or default_rules()
    rooms = list(s.get("rooms") or [])
    have = {r.get("room") for r in rooms}
    changed = False
    for c in db.cameras_all():
        room = c.get("room")
        if room and room not in have:
            rooms.append(default_room(room))
            have.add(room)
            changed = True
    if changed or "rooms" not in s:
        s["rooms"] = rooms
        db.setting_set("rules", s)
        if changed:
            print("[cmc-ai] Đã bổ sung cấu hình quy tắc mặc định cho phòng mới.", flush=True)


def seed():
    now = int(time.time() * 1000)
    if not db.users_all():
        for uid, name, email, role, pw in [
            ("u-admin", "Quản trị viên", "admin@cmc.edu.vn", "admin", "admin123"),
            ("u-gt1", "Giám thị 1", "giamthi@cmc.edu.vn", "giam_thi", "giamthi123"),
        ]:
            db.user_save({"id": uid, "name": name, "email": email, "role": role, "active": True, "createdAt": now},
                         auth.hash_pw(pw))
    # Dọn camera mẫu TRƯỚC khi (có thể) seed lại, và trước manager.sync().
    if config.SEED_DEMO and not db.cameras_all():
        from .streams import dataset
        vids = sorted(dataset().videos()) if dataset().index else []
        for i, vid in enumerate(vids, 1):
            parts = vid.split("_")
            room = "P." + (parts[1].lstrip("P") if len(parts) > 1 else str(i))
            db.camera_save({"id": f"cam-{i:02d}", "name": f"CAM {i:02d}", "room": room,
                            "position": "truoc" if i % 2 else "sau", "sourceType": "file",
                            "sourceUrl": f"dataset://{vid}", "enabled": True, "createdAt": now + i})
    else:
        purge_sample_data()

    if db.setting_get("rules") is None:
        s = default_rules()
        if config.SEED_DEMO:
            rooms = sorted({c["room"] for c in db.cameras_all() if c.get("room")})
            s["rooms"] = [default_room(r) for r in rooms]
        db.setting_set("rules", s)
    else:
        s = db.setting_get("rules")
        if migrate_phone_rule_defaults(s):
            db.setting_set("rules", s)
            print("[cmc-ai] Đã cập nhật ngưỡng quy tắc điện thoại (minConfidence/nearHand) theo mặc định mới.", flush=True)
    ensure_rooms_in_rules()
