"""Môi trường test: DB tạm, không seed demo, không khởi động camera, không tải model YOLO."""
import os
import tempfile

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="cmc-ai-test-")
os.environ["AUTOSTART_CAMERAS"] = "0"
os.environ["DETECTOR"] = "mock"
os.environ["SEED_DEMO"] = "0"
os.environ["SAMPLE_CAMERAS"] = "off"
# Mặc định test không nạp model vai trò thật (test riêng cắm model giả)
os.environ["ROLE_MODEL"] = ""
# Không đọc .env của máy dev (DETECTOR=yolo) khi import app
os.environ.pop("JWT_SECRET", None)

import pytest


@pytest.fixture(autouse=True)
def _fresh_db():
    from app import analysis_jobs, db
    from app.seed import seed
    from app.streams import manager
    db.wipe_operational_data()
    seed()
    manager.workers.clear()
    from app import roles
    roles.set_role_detector(roles.RoleDetector(None, "", None))
    analysis_jobs.reset()
    yield
    analysis_jobs.reset()
    roles.set_role_detector(roles.RoleDetector(None, "", None))
    manager.workers.clear()


@pytest.fixture(autouse=True)
def _fast_webcam_probe(monkeypatch):
    """Rút thời gian hâm nóng webcam trong unit test (máy thật vẫn 1.5–2 s)."""
    import app.webcams as webcams
    monkeypatch.setattr(webcams, "PROBE_WARMUP_SEC", 0.0)
    monkeypatch.setattr(webcams, "PROBE_DISCARD", 0)
    monkeypatch.setattr(webcams, "PROBE_WANT", 2)
    monkeypatch.setattr(webcams, "PROBE_TIMEOUT_SEC", 0.4)
    monkeypatch.setattr(webcams, "PROBE_FAIL_SLEEP", 0.0)
