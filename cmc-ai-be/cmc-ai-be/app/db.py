"""Lưu trữ SQLite đơn giản. Mỗi bản ghi lưu dạng JSON, kèm vài cột để lọc nhanh."""
import json
import shutil
import sqlite3
import threading
from typing import Any, Iterable

from .config import DB_PATH

_lock = threading.RLock()
_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
_conn.row_factory = sqlite3.Row

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, pw_hash TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS cameras (id TEXT PRIMARY KEY, data TEXT);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY, camera_id TEXT, room TEXT, type TEXT, level TEXT, status TEXT, ts INTEGER, data TEXT);
CREATE INDEX IF NOT EXISTS ix_alerts_ts ON alerts(ts);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT);
"""
with _lock:
    _conn.executescript(SCHEMA)
    _conn.commit()


def q(sql: str, args: Iterable[Any] = ()) -> list[sqlite3.Row]:
    with _lock:
        return _conn.execute(sql, tuple(args)).fetchall()


def x(sql: str, args: Iterable[Any] = ()) -> None:
    with _lock:
        _conn.execute(sql, tuple(args))
        _conn.commit()


# ---------- users ----------
def user_public(row: sqlite3.Row) -> dict:
    return json.loads(row["data"])


def users_all() -> list[dict]:
    return [user_public(r) for r in q("SELECT * FROM users ORDER BY json_extract(data,'$.createdAt')")]


def user_by_id(uid: str):
    r = q("SELECT * FROM users WHERE id=?", [uid])
    return r[0] if r else None


def user_by_email(email: str):
    r = q("SELECT * FROM users WHERE lower(email)=lower(?)", [email])
    return r[0] if r else None


def user_save(u: dict, pw_hash: str | None = None) -> None:
    old = user_by_id(u["id"])
    h = pw_hash if pw_hash is not None else (old["pw_hash"] if old else "")
    x("INSERT OR REPLACE INTO users(id,email,pw_hash,data) VALUES(?,?,?,?)",
      [u["id"], u["email"], h, json.dumps(u, ensure_ascii=False)])


def user_delete(uid: str) -> None:
    x("DELETE FROM users WHERE id=?", [uid])


# ---------- cameras ----------
def cameras_all() -> list[dict]:
    return [json.loads(r["data"]) for r in q("SELECT * FROM cameras")]


def camera_get(cid: str):
    r = q("SELECT * FROM cameras WHERE id=?", [cid])
    return json.loads(r[0]["data"]) if r else None


def camera_save(c: dict) -> None:
    x("INSERT OR REPLACE INTO cameras(id,data) VALUES(?,?)", [c["id"], json.dumps(c, ensure_ascii=False)])


def camera_delete(cid: str) -> None:
    x("DELETE FROM cameras WHERE id=?", [cid])


# ---------- alerts ----------
def alert_save(a: dict) -> None:
    x("INSERT OR REPLACE INTO alerts(id,camera_id,room,type,level,status,ts,data) VALUES(?,?,?,?,?,?,?,?)",
      [a["id"], a["cameraId"], a["room"], a["type"], a["level"], a["status"], a["ts"],
       json.dumps(a, ensure_ascii=False)])


def alert_get(aid: str):
    r = q("SELECT data FROM alerts WHERE id=?", [aid])
    return json.loads(r[0]["data"]) if r else None


def alerts_query(where: str, args: list, order: str = "ts DESC", limit: int | None = None, offset: int = 0):
    sql = f"SELECT data FROM alerts {('WHERE ' + where) if where else ''} ORDER BY {order}"
    if limit is not None:
        sql += f" LIMIT {int(limit)} OFFSET {int(offset)}"
    return [json.loads(r["data"]) for r in q(sql, args)]


def alerts_count(where: str, args: list) -> int:
    return q(f"SELECT COUNT(*) c FROM alerts {('WHERE ' + where) if where else ''}", args)[0]["c"]


# ---------- settings ----------
def setting_get(key: str, default=None):
    r = q("SELECT data FROM settings WHERE key=?", [key])
    return json.loads(r[0]["data"]) if r else default


def setting_set(key: str, value) -> None:
    x("INSERT OR REPLACE INTO settings(key,data) VALUES(?,?)", [key, json.dumps(value, ensure_ascii=False)])


def wipe_operational_data() -> None:
    """Xoá camera, cảnh báo và settings; giữ bảng users. Xoá luôn media/alerts và media/uploads."""
    with _lock:
        _conn.execute("DELETE FROM cameras")
        _conn.execute("DELETE FROM alerts")
        _conn.execute("DELETE FROM settings")
        _conn.commit()
    from .config import MEDIA_DIR
    for sub in ("alerts", "uploads"):
        d = MEDIA_DIR / sub
        if not d.exists():
            continue
        for pth in d.iterdir():
            try:
                if pth.is_file() or pth.is_symlink():
                    pth.unlink()
                elif pth.is_dir():
                    shutil.rmtree(pth, ignore_errors=True)
            except OSError:
                pass


def alerts_delete_by_camera_ids(cids: list[str]) -> list[dict]:
    """Xoá cảnh báo của các camera; trả về bản ghi đã xoá (để gỡ file media)."""
    if not cids:
        return []
    marks = ",".join("?" * len(cids))
    items = [json.loads(r["data"]) for r in q(f"SELECT data FROM alerts WHERE camera_id IN ({marks})", cids)]
    x(f"DELETE FROM alerts WHERE camera_id IN ({marks})", cids)
    return items


def alerts_delete_all() -> list[dict]:
    """Xoá toàn bộ cảnh báo, trả về bản ghi (để gỡ media)."""
    items = [json.loads(r["data"]) for r in q("SELECT data FROM alerts")]
    x("DELETE FROM alerts")
    return items
