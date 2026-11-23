#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
[ -x .venv/bin/uvicorn ] && PATH="$PWD/.venv/bin:$PATH"
[ -x /workspace/.venv-be/bin/uvicorn ] && PATH="/workspace/.venv-be/bin:$PATH"
SSL=()
# HTTPS (tuỳ chọn, để trình duyệt điện thoại cho mở camera): đặt SSL_CERTFILE và SSL_KEYFILE trong .env
[ -n "$SSL_CERTFILE" ] && [ -n "$SSL_KEYFILE" ] && SSL=(--ssl-certfile "$SSL_CERTFILE" --ssl-keyfile "$SSL_KEYFILE")
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" "${SSL[@]}" "$@"
