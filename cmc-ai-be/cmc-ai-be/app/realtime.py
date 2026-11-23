"""Quản lý kết nối WebSocket. Gói tin dạng {"type": ..., "data": ...}."""
import asyncio
import json

from fastapi import WebSocket


class Hub:
    def __init__(self):
        self.clients: dict[WebSocket, set[str] | None] = {}  # None = nhận detections của mọi camera
        self.loop: asyncio.AbstractEventLoop | None = None

    async def add(self, ws: WebSocket):
        self.clients[ws] = None

    def remove(self, ws: WebSocket):
        self.clients.pop(ws, None)

    def subscribe(self, ws: WebSocket, camera_ids):
        if ws in self.clients:
            self.clients[ws] = set(camera_ids) if camera_ids is not None else None

    async def _send(self, msg: dict, camera_id: str | None):
        text = json.dumps(msg, ensure_ascii=False)
        for ws, subs in list(self.clients.items()):
            if camera_id is not None and subs is not None and camera_id not in subs:
                continue
            try:
                await ws.send_text(text)
            except Exception:
                self.remove(ws)

    def publish(self, type_: str, data, camera_id: str | None = None):
        """Gọi được từ thread nền (luồng camera)."""
        if self.loop is None or not self.clients:
            return
        asyncio.run_coroutine_threadsafe(self._send({"type": type_, "data": data}, camera_id), self.loop)


hub = Hub()
