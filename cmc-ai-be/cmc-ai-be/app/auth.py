"""Đăng nhập JWT + phân quyền admin / giam_thi."""
import hashlib
import hmac
import os
import time

import jwt
from fastapi import Depends, HTTPException, Request

from . import db
from .config import JWT_HOURS, JWT_SECRET


def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, 200_000)
    return salt.hex() + "$" + h.hex()


def check_pw(pw: str, stored: str) -> bool:
    try:
        salt_hex, h_hex = stored.split("$", 1)
    except ValueError:
        return False
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt_hex), 200_000)
    return hmac.compare_digest(h.hex(), h_hex)


def make_token(uid: str, hours: float | None = None, scope: str | None = None) -> str:
    now = int(time.time())
    p = {"sub": uid, "iat": now, "exp": now + int((hours or JWT_HOURS) * 3600)}
    if scope:
        p["scope"] = scope  # token giới hạn (vd "push:cam-xxx" cho mã QR), không dùng được cho API khác
    return jwt.encode(p, JWT_SECRET, algorithm="HS256")


def user_from_token(token: str | None, scope: str | None = None) -> dict | None:
    """scope=None: chỉ nhận token thường. scope="push:<cid>": nhận token thường hoặc token QR đúng camera."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("scope") and payload["scope"] != scope:
        return None
    row = db.user_by_id(payload.get("sub", ""))
    if not row:
        return None
    u = db.user_public(row)
    return u if u.get("active") else None


def current_user(request: Request) -> dict:
    h = request.headers.get("authorization", "")
    token = h[7:] if h.lower().startswith("bearer ") else request.query_params.get("token")
    u = user_from_token(token)
    if not u:
        raise HTTPException(401, "Phiên đăng nhập không hợp lệ hoặc đã hết hạn")
    return u


def require_admin(u: dict = Depends(current_user)) -> dict:
    if u["role"] != "admin":
        raise HTTPException(403, "Chỉ Admin được thực hiện thao tác này")
    return u
