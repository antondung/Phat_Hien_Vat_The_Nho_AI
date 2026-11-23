"""Chạy BE trên mọi hệ điều hành (Windows / macOS / Linux): đọc .env rồi khởi động uvicorn.

    python run.py
    python run.py --reset-data   # xoá camera, cảnh báo, lịch sử, media; giữ tài khoản
"""
import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)


def load_env():
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.split(" #", 1)[0].strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)


def main():
    load_env()
    parser = argparse.ArgumentParser(description="CMC AI backend")
    parser.add_argument("--reset-data", action="store_true",
                        help="Xoa camera, canh bao, lich su va media; giu tai khoan dang nhap")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8000")))
    args = parser.parse_args()
    if args.reset_data:
        sys.path.insert(0, str(ROOT))
        from app.db import wipe_operational_data
        from app.seed import seed
        wipe_operational_data()
        seed()
        print("Đã xoá dữ liệu vận hành (camera, cảnh báo, lịch sử, media). Đã giữ tài khoản đăng nhập.", flush=True)
    import uvicorn  # noqa: E402
    kw = {}
    if os.environ.get("SSL_CERTFILE") and os.environ.get("SSL_KEYFILE"):
        kw = {"ssl_certfile": os.environ["SSL_CERTFILE"], "ssl_keyfile": os.environ["SSL_KEYFILE"]}
    sys.path.insert(0, str(ROOT))
    try:
        from app.webcams import check_env
        check_env()
    except Exception as e:
        print(f"[cmc-ai] check_env: {type(e).__name__}: {e}", flush=True)
    uvicorn.run("app.main:app", host=args.host, port=args.port, **kw)


if __name__ == "__main__":
    main()
