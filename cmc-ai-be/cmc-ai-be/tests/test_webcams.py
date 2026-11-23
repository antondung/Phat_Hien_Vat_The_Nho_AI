"""URL webcam, khung màu đặc, enum (mock Windows), thu nhỏ JPEG — không cần máy Windows."""
import cv2
import numpy as np
import pytest

from app.webcams import (
    DROIDCAM_UNIFORM_MSG,
    GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
    GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP,
    GUID_MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
    GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP,
    IN_USE_MSG,
    NO_FRAME_MSG,
    NOT_FOUND_MSG,
    NO_PICTURE_MSG,
    PRIVACY_HINT,
    UNIFORM_MSG,
    WebcamSpec,
    dedupe_by_name,
    check_env,
    format_debug_report,
    format_env_report,
    frames_have_picture,
    opencv_conflict_warning,
    is_audio_device_name,
    is_uniform_frame,
    list_webcam_devices,
    normalize_frame,
    open_webcam,
    parse_ffmpeg_dshow_devices,
    parse_webcam_url,
    probe_capture,
    resize_jpeg,
    sort_webcam_entries,
    uniform_message,
)


def _photo(w=160, h=120, channels=3):
    img = np.zeros((h, w, 3), np.uint8)
    cv2.circle(img, (50, 40), 25, (20, 90, 200), -1)
    cv2.rectangle(img, (10, 70), (140, 110), (200, 40, 15), -1)
    if channels == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    return img


def _solid(color, w=160, h=120, channels=3):
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = color
    if channels == 4:
        return cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    return img


def test_parse_legacy_and_backends():
    s = parse_webcam_url("webcam://0")
    assert s.backend is None and s.index == 0 and s.name is None
    s = parse_webcam_url("0")
    assert s.index == 0
    s = parse_webcam_url("/dev/video2")
    assert s.index == 2
    s = parse_webcam_url("webcam://dshow/1")
    assert s.backend == "dshow" and s.index == 1
    s = parse_webcam_url("webcam://msmf/0")
    assert s.backend == "msmf" and s.index == 0


def test_parse_dshow_name_urlencoded():
    s = parse_webcam_url("webcam://dshow/name/DroidCam%20Video")
    assert s.backend == "dshow" and s.name == "DroidCam Video" and s.index is None
    s = parse_webcam_url("webcam://dshow/name/DroidCam Video")
    assert s.name == "DroidCam Video"
    s = parse_webcam_url("webcam://msmf/name/DroidCam%20Video")
    assert s.backend == "msmf" and s.name == "DroidCam Video"
    assert "DroidCam" in UNIFORM_MSG and "khung màu đặc" in UNIFORM_MSG
    assert NO_PICTURE_MSG in UNIFORM_MSG


def test_uniform_green_and_black():
    green = _solid((0, 255, 0))
    black = _solid((0, 0, 0))
    photo = _photo()
    assert is_uniform_frame(green)
    assert is_uniform_frame(black)
    assert not is_uniform_frame(photo)
    assert not frames_have_picture([green, green, black])
    assert frames_have_picture([green, photo])


def test_bgra_and_normalize():
    photo_bgra = _photo(channels=4)
    green_bgra = _solid((0, 255, 0), channels=4)
    assert photo_bgra.shape[2] == 4
    bgr = normalize_frame(photo_bgra)
    assert bgr is not None and bgr.shape[2] == 3
    assert not is_uniform_frame(photo_bgra)
    assert is_uniform_frame(green_bgra)
    assert frames_have_picture([photo_bgra])


def test_resize_jpeg_width():
    img = np.zeros((720, 1280, 3), np.uint8)
    img[:] = (40, 80, 160)
    cv2.rectangle(img, (100, 80), (500, 400), (0, 200, 255), -1)
    jpg = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 90])[1].tobytes()
    small = resize_jpeg(jpg, 480, 70)
    arr = cv2.imdecode(np.frombuffer(small, np.uint8), cv2.IMREAD_COLOR)
    assert arr.shape[1] == 480
    assert arr.shape[0] == int(720 * 480 / 1280)
    assert len(small) < len(jpg)


def test_sort_droidcam_video_dshow_first():
    items = [
        {"name": "Integrated Camera", "backend": "dshow", "index": 0, "hasPicture": True},
        {"name": "DroidCam Source 1", "backend": "dshow", "index": 1, "hasPicture": False},
        {"name": "DroidCam Video", "backend": "msmf", "index": 2, "hasPicture": True},
        {"name": "DroidCam Video", "backend": "dshow", "index": 0, "hasPicture": True},
    ]
    out = sort_webcam_entries(items)
    assert out[0]["name"] == "DroidCam Video" and out[0]["backend"] == "dshow"


def test_audio_device_names_and_mf_guids():
    assert is_audio_device_name("Microphone (DroidCam Audio)")
    assert is_audio_device_name("DroidCam Audio")
    assert not is_audio_device_name("DroidCam Video")
    assert not is_audio_device_name("ASUS HD webcam")
    assert not is_audio_device_name("Webcam tích hợp")
    # GUID chính thức (MSDN) — VIDCAP, không nhầm AUDCAP
    assert GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE == "c60ac5fe-672c-47c7-90a8-8a9ed049c4ae"
    assert GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP == "8ac3587a-4ae7-42d8-99e0-0d4daefc0b3f"
    assert GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP == "9ea10230-8be4-48e4-93d3-387db36dcc1c"
    assert GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP != GUID_MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_AUDCAP
    # mfidl.h — GUID cũ 60d0dd49-… gây MF_E_ATTRIBUTENOTFOUND và hủy cả enum
    assert GUID_MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME == "60d0e559-52f8-4fa2-bbce-acdb34a8ec01"


def test_ffmpeg_dshow_parser_skips_audio():
    text = """
[dshow @ 000] DirectShow video devices (some may be both video and audio devices)
  "DroidCam Video"
  "ASUS HD webcam"
[dshow @ 000] DirectShow audio devices
  "Microphone (DroidCam Audio)"
  "DroidCam Audio"
"""
    names = parse_ffmpeg_dshow_devices(text)
    assert names == ["DroidCam Video", "ASUS HD webcam"]


class FakeCap:
    opened: list = []
    history: list = []
    max_open = 0
    # (source, api) -> list of frames or "fail-open"
    catalog: dict = {}
    missing = []  # hành vi khi không có trong catalog

    def __init__(self, source=None, api=None):
        self.source = source
        self.api = api
        self.released = False
        self.props = {}
        key = (source, api)
        if key in self.catalog:
            spec = self.catalog[key]
        elif source in self.catalog:
            spec = self.catalog[source]
        else:
            spec = self.missing
        if spec == "fail-open" or source is None:
            self._open = False
            self._frames = []
        else:
            self._open = True
            self._frames = list(spec)
            FakeCap.opened.append(self)
            FakeCap.max_open = max(FakeCap.max_open, len(FakeCap.opened))
        self._i = 0
        FakeCap.history.append(("open", source, api, self._open, len(FakeCap.opened)))

    def isOpened(self):
        return self._open and not self.released

    def release(self):
        self.released = True
        if self in FakeCap.opened:
            FakeCap.opened.remove(self)
        FakeCap.history.append(("release", self.source, self.api, len(FakeCap.opened)))

    def read(self):
        if not self.isOpened():
            return False, None
        if self._i >= len(self._frames):
            if self._frames:
                f = self._frames[-1]
                return (False, None) if f is None else (True, f.copy())
            return False, None
        f = self._frames[self._i]
        self._i += 1
        if f is None:
            return False, None
        return True, f.copy()

    def set(self, prop, val):
        self.props[prop] = val
        return True

    def get(self, prop):
        return self.props.get(prop, 0)

    @classmethod
    def reset(cls, catalog, missing=None):
        cls.opened = []
        cls.history = []
        cls.max_open = 0
        cls.catalog = catalog
        cls.missing = [] if missing is None else missing


def _dshow_opens(history=None):
    history = history if history is not None else FakeCap.history
    return [h for h in history if h[0] == "open" and h[2] == cv2.CAP_DSHOW]


def assert_never_video_equals_cap_dshow(history=None):
    bad = [
        h for h in _dshow_opens(history)
        if isinstance(h[1], str) and str(h[1]).startswith("video=")
    ]
    assert not bad, f"CAP_DSHOW must not be opened with a video= string, got {bad}"


@pytest.fixture
def win(monkeypatch):
    import app.webcams as webcams
    monkeypatch.setattr(webcams, "IS_WIN", True)
    # Tránh gọi ffmpeg/pygrabber thật trên Linux khi test mở theo tên.
    monkeypatch.setattr(webcams, "_dshow_names_ffmpeg", lambda: [])
    monkeypatch.setattr(webcams, "_open_pygrabber_capture", lambda *a, **k: None)
    monkeypatch.setattr(webcams, "_open_ffmpeg_capture", lambda *a, **k: None)
    monkeypatch.setattr(webcams, "opencv_conflict_warning", lambda pkgs=None: None)
    return webcams


def _install_fake(monkeypatch, webcams, catalog, missing=None):
    FakeCap.reset(catalog, missing=missing)
    monkeypatch.setattr(webcams.cv2, "VideoCapture", FakeCap)
    monkeypatch.setattr(cv2, "VideoCapture", FakeCap)


def test_mf_enum_filters_audio_and_keeps_vidcap_order(win, monkeypatch):
    mixed = [
        "Microphone (DroidCam Audio)",
        "ASUS HD webcam",
        "DroidCam Audio",
        "DroidCam Video",
    ]
    monkeypatch.setattr(win, "_mf_names_ctypes", lambda: list(mixed))
    names = win.mf_device_names()
    # Thứ tự video giữ nguyên (cùng hệ chỉ số OpenCV MSMF / VIDCAP)
    assert names == ["ASUS HD webcam", "DroidCam Video"]


def test_msmf_name_url_opens_by_index_not_by_name(win, monkeypatch):
    monkeypatch.setattr(win, "mf_device_names", lambda: ["ASUS HD webcam", "DroidCam Video"])
    monkeypatch.setattr(win, "dshow_device_names", lambda: {})
    catalog = {
        (1, cv2.CAP_MSMF): [_photo()],
        ("video=DroidCam Video", cv2.CAP_MSMF): "fail-open",
        ("DroidCam Video", cv2.CAP_MSMF): "fail-open",
        ("video=DroidCam Video", cv2.CAP_DSHOW): "fail-open",
    }
    _install_fake(monkeypatch, win, catalog)
    cap = open_webcam("webcam://msmf/name/DroidCam%20Video")
    assert cap.isOpened()
    assert cap.source == 1 and cap.api == cv2.CAP_MSMF
    opens = [h for h in FakeCap.history if h[0] == "open" and h[3]]
    assert all(h[1] != "video=DroidCam Video" for h in opens)
    assert_never_video_equals_cap_dshow()


def test_dshow_name_url_resolves_to_index_not_video_equals(win, monkeypatch):
    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "DroidCam Video"})
    monkeypatch.setattr(win, "mf_device_names", lambda: [])
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): [_photo()],  # không được dùng
        (0, cv2.CAP_DSHOW): [_photo()],
    }
    _install_fake(monkeypatch, win, catalog)
    cap = open_webcam("webcam://dshow/name/DroidCam%20Video")
    assert cap.isOpened()
    assert cap.source == 0 and cap.api == cv2.CAP_DSHOW
    assert_never_video_equals_cap_dshow()
    opens = [h for h in FakeCap.history if h[0] == "open" and h[3]]
    assert opens and opens[0][1] == 0 and opens[0][2] == cv2.CAP_DSHOW


def test_dshow_name_unresolved_tries_unclaimed_indices(win, monkeypatch):
    """Tên không có trong pygrabber/ffmpeg → thử các chỉ số 0..9 chưa gắn tên, bỏ 1 và 2."""
    monkeypatch.setattr(win, "dshow_device_names", lambda: {
        1: "ASUS HD webcam",
        2: "OBS Virtual Camera",
    })
    monkeypatch.setattr(win, "mf_device_names", lambda: [])
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): [_photo()],  # không được dùng
        (1, cv2.CAP_DSHOW): "fail-open",
        (2, cv2.CAP_DSHOW): "fail-open",
        (0, cv2.CAP_DSHOW): [_photo()],
    }
    _install_fake(monkeypatch, win, catalog, missing="fail-open")
    cap = open_webcam("webcam://dshow/name/DroidCam%20Video")
    assert cap.isOpened()
    assert cap.source == 0 and cap.api == cv2.CAP_DSHOW
    assert_never_video_equals_cap_dshow()
    tried = [h[1] for h in _dshow_opens()]
    assert 0 in tried
    assert 1 not in tried and 2 not in tried


def test_msmf_name_unresolved_tries_unclaimed_indices(win, monkeypatch):
    monkeypatch.setattr(win, "dshow_device_names", lambda: {})
    monkeypatch.setattr(win, "mf_device_names", lambda: ["ASUS HD webcam"])  # chỉ số 0 đã có tên
    catalog = {
        (0, cv2.CAP_MSMF): "fail-open",
        (1, cv2.CAP_MSMF): [_photo()],
    }
    _install_fake(monkeypatch, win, catalog, missing="fail-open")
    cap = open_webcam("webcam://msmf/name/DroidCam%20Video")
    assert cap.isOpened()
    assert cap.source == 1 and cap.api == cv2.CAP_MSMF
    assert_never_video_equals_cap_dshow()
    tried = [h[1] for h in FakeCap.history if h[0] == "open" and h[2] == cv2.CAP_MSMF]
    assert 0 not in tried
    assert 1 in tried


def test_listing_fills_vacant_pygrabber_slot_from_ffmpeg(win, monkeypatch):
    """Lỗi thực tế: DroidCam ra url theo tên, ASUS dshow/1, OBS dshow/2 — ô 0 trống ở pygrabber."""
    monkeypatch.setattr(win, "_dshow_names_pygrabber",
                        lambda: ["", "ASUS HD webcam", "OBS Virtual Camera"])
    monkeypatch.setattr(win, "_dshow_names_ffmpeg",
                        lambda: ["DroidCam Video", "ASUS HD webcam", "OBS Virtual Camera"])
    # Bỏ stub dshow_device_names — dùng merge thật. mf rỗng để chỉ còn dshow.
    monkeypatch.setattr(win, "mf_device_names", lambda: [])
    monkeypatch.setattr(win, "_pnp_camera_names", lambda: [])
    photo = _photo()
    catalog = {
        (0, cv2.CAP_DSHOW): [photo],
        (1, cv2.CAP_DSHOW): [photo],
        (2, cv2.CAP_DSHOW): [photo],
    }
    _install_fake(monkeypatch, win, catalog, missing="fail-open")
    names = win.dshow_device_names()
    assert names[0] == "DroidCam Video"
    assert names[1] == "ASUS HD webcam"
    assert names[2] == "OBS Virtual Camera"
    devices, _hint = list_webcam_devices(debug=True, max_index=6)
    by_name = {d["name"]: d for d in devices}
    assert by_name["DroidCam Video"]["url"] == "webcam://dshow/0"
    assert by_name["ASUS HD webcam"]["url"] == "webcam://dshow/1"
    assert by_name["OBS Virtual Camera"]["url"] == "webcam://dshow/2"
    assert all("/name/" not in d["url"] for d in devices)
    assert_never_video_equals_cap_dshow()


def test_uniform_message_mentions_droidcam_client():
    assert "DroidCam Client phải đang kết nối" in uniform_message("DroidCam Video")
    assert "DroidCam Client phải đang kết nối" in DROIDCAM_UNIFORM_MSG
    assert NO_PICTURE_MSG in uniform_message("DroidCam Video")


def test_warmup_black_then_picture(win, monkeypatch):
    monkeypatch.setattr(win, "PROBE_WARMUP_SEC", 0.0)
    monkeypatch.setattr(win, "PROBE_DISCARD", 10)
    monkeypatch.setattr(win, "PROBE_WANT", 5)
    monkeypatch.setattr(win, "PROBE_TIMEOUT_SEC", 1.0)
    frames = [_solid((0, 0, 0)) for _ in range(10)] + [_photo() for _ in range(5)]
    FakeCap.reset({(0, cv2.CAP_MSMF): frames})
    cap = FakeCap(0, cv2.CAP_MSMF)
    info = probe_capture(cap, already_prepared=True)
    assert info["ok"] is True
    assert info["has_picture"] is True
    assert info["frames_read"] >= 11


def test_read_failure_is_not_solid_colour(win, monkeypatch):
    monkeypatch.setattr(win, "PROBE_WANT", 3)
    FakeCap.reset({(0, cv2.CAP_MSMF): [None, None, None]})
    cap = FakeCap(0, cv2.CAP_MSMF)
    # isOpened True nhưng read luôn fail
    cap._frames = []  # read → False
    info = probe_capture(cap, already_prepared=True)
    assert info["ok"] is False
    assert info["has_picture"] is False
    assert info["error"]
    assert "không đọc được khung" in (info["error"] or "") or "read()" in (info["error"] or "")
    assert NO_FRAME_MSG


def test_list_filters_audio_skips_failed_indexes_dedupes_and_hints(win, monkeypatch):
    monkeypatch.setattr(win, "dshow_device_names", lambda: {
        0: "DroidCam Video",
        1: "Webcam tích hợp",
    })
    monkeypatch.setattr(win, "mf_device_names", lambda: [
        # sau filter audio ở mf_device_names — giả sử đã lọc, nhưng list cũng không được bịa index
        "ASUS HD webcam",
        "DroidCam Video",
    ])
    monkeypatch.setattr(win, "_mf_names_ctypes", lambda: [
        "Microphone (DroidCam Audio)",
        "ASUS HD webcam",
        "DroidCam Audio",
        "DroidCam Video",
    ])
    monkeypatch.setattr(win, "_pnp_camera_names", lambda: [
        "Microphone (DroidCam Audio)",  # nếu lỡ gọi, không được gán vào msmf/0
        "ASUS HD webcam",
    ])

    photo = _photo()
    black = _solid((0, 0, 0))
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): [photo],
        (0, cv2.CAP_DSHOW): [photo],
        ("video=Webcam tích hợp", cv2.CAP_DSHOW): [photo],
        (1, cv2.CAP_DSHOW): [photo],
        (0, cv2.CAP_MSMF): [photo],  # ASUS
        (1, cv2.CAP_MSMF): [black],  # DroidCam Video trên MSMF: màu đặc — ưu tiên dshow
        (2, cv2.CAP_MSMF): "fail-open",
        (4, cv2.CAP_MSMF): "fail-open",
        (5, cv2.CAP_MSMF): "fail-open",
        (4, cv2.CAP_DSHOW): "fail-open",
        (5, cv2.CAP_DSHOW): "fail-open",
    }
    _install_fake(monkeypatch, win, catalog)

    devices, hint = list_webcam_devices(debug=True, max_index=6)
    names = [d["name"] for d in devices]
    assert "Microphone (DroidCam Audio)" not in names
    assert "DroidCam Audio" not in names
    assert "Webcam 4" not in names and "Webcam 5" not in names
    assert "MSMF 4" not in names and "MSMF 5" not in names
    # Gộp DroidCam Video — backend có hình (dshow)
    droid = [d for d in devices if d["name"] == "DroidCam Video"]
    assert len(droid) == 1
    assert droid[0]["backend"] == "dshow"
    assert droid[0]["hasPicture"] is True
    assert devices[0]["name"] == "DroidCam Video" and devices[0]["backend"] == "dshow"
    assert FakeCap.max_open <= 1  # đóng cái trước rồi mới mở cái sau
    assert_never_video_equals_cap_dshow()
    # Có ít nhất một thiết bị có hình → không cần hint quyền camera
    assert hint is None
    # debug fields
    assert "framesRead" in droid[0] and "mean" in droid[0] and "std" in droid[0]
    assert "shape" in droid[0] and "dtype" in droid[0] and "time" in droid[0]


def test_hint_when_all_black_or_unopenable(win, monkeypatch):
    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "ASUS HD webcam"})
    monkeypatch.setattr(win, "mf_device_names", lambda: ["DroidCam Video"])
    black = _solid((0, 0, 0))
    catalog = {
        ("video=ASUS HD webcam", cv2.CAP_DSHOW): [black],
        (0, cv2.CAP_DSHOW): [black],
        (0, cv2.CAP_MSMF): [black],
        ("video=DroidCam Video", cv2.CAP_DSHOW): "fail-open",
    }
    _install_fake(monkeypatch, win, catalog)
    devices, hint = list_webcam_devices(debug=False)
    assert devices  # vẫn liệt kê, hasPicture chỉ gợi ý
    assert all(d.get("hasPicture") is False for d in devices)
    assert hint == PRIVACY_HINT
    assert_never_video_equals_cap_dshow()
    # API mặc định không kèm trường debug
    assert "framesRead" not in devices[0]


def test_dedupe_prefers_backend_with_picture():
    items = [
        {"name": "DroidCam Video", "backend": "dshow", "index": 0, "hasPicture": False, "url": "webcam://dshow/0"},
        {"name": "DroidCam Video", "backend": "msmf", "index": 1, "hasPicture": True, "url": "webcam://msmf/1"},
    ]
    out = dedupe_by_name(items)
    assert len(out) == 1
    assert out[0]["backend"] == "msmf" and out[0]["hasPicture"] is True
    assert out[0].get("altBackend") == "dshow"


def test_debug_endpoint_shape(win, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.streams import list_webcams as lw

    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "DroidCam Video"})
    monkeypatch.setattr(win, "mf_device_names", lambda: [])
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): [_photo()],
        (0, cv2.CAP_DSHOW): [_photo()],
    }
    _install_fake(monkeypatch, win, catalog)

    # list_webcams(debug=True) envelope
    import app.streams as streams
    monkeypatch.setattr(streams, "list_webcam_devices",
                        lambda **k: ([{"index": 0, "backend": "dshow", "name": "DroidCam Video",
                                       "url": "webcam://dshow/0", "hasPicture": True,
                                       "open": True, "framesRead": 12, "mean": 40.0, "std": 20.0,
                                       "shape": [120, 160, 3], "dtype": "uint8", "time": 50, "error": None}],
                                      None))
    out = lw(debug=True)
    assert isinstance(out, dict) and "devices" in out
    assert out["devices"][0]["framesRead"] == 12
    assert out["hint"] is None

    # HTTP
    c = TestClient(app)
    tok = c.post("/api/auth/login", json={"email": "admin@cmc.edu.vn", "password": "admin123"}).json()["token"]
    r = c.get("/api/sources/webcams?debug=1", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 200
    body = r.json()
    assert "devices" in body
    assert "hint" in body
    # mặc định vẫn là list
    r2 = c.get("/api/sources/webcams", headers={"Authorization": f"Bearer {tok}"})
    assert r2.status_code == 200
    assert isinstance(r2.json(), list)


def test_cli_report_contains_fields():
    from app.webcams import format_debug_report
    text = format_debug_report(
        [{"backend": "dshow", "index": 0, "name": "DroidCam Video", "url": "webcam://dshow/0",
          "urlByName": "webcam://dshow/name/DroidCam%20Video", "open": True, "framesRead": 20,
          "hasPicture": True, "inUse": False, "mean": 80.1, "std": 12.3,
          "shape": [720, 1280, 3], "dtype": "uint8", "time": 1800, "error": None}],
        None,
    )
    for s in ("DroidCam Video", "framesRead", "mean", "std", "shape", "dtype", "time", "dshow"):
        assert s in text
    env = format_env_report()
    text2 = format_debug_report(
        [{"backend": "dshow", "index": 0, "name": "DroidCam Video", "url": "webcam://dshow/0",
          "open": True, "framesRead": 1, "hasPicture": True}],
        None,
        env_text=env,
    )
    assert "cv2.__version__" in text2
    assert "Python " in text2
    assert "opencv packages" in text2
    assert "videoio backends" in text2



def test_dshow_open_fails_falls_back_to_msmf_vidcap_index(win, monkeypatch):
    """DSHOW index 0 thất bại → MSMF theo tên, chỉ số VIDCAP 1 (không phải 0)."""
    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "DroidCam Video"})
    monkeypatch.setattr(win, "mf_device_names", lambda: ["ASUS HD webcam", "DroidCam Video"])
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): "fail-open",
        (0, cv2.CAP_DSHOW): "fail-open",
        (0, cv2.CAP_MSMF): [_solid((0, 255, 0))],  # sai chỉ số — không được dùng
        (1, cv2.CAP_MSMF): [_photo()],
    }
    _install_fake(monkeypatch, win, catalog)
    cap = open_webcam("webcam://dshow/name/DroidCam%20Video")
    assert cap.isOpened()
    assert cap.source == 1 and cap.api == cv2.CAP_MSMF

    FakeCap.reset(catalog)
    cap2 = open_webcam("webcam://dshow/0")
    assert cap2.isOpened()
    assert cap2.source == 1 and cap2.api == cv2.CAP_MSMF
    assert_never_video_equals_cap_dshow()


def test_test_connection_distinguishes_three_webcam_errors(win, monkeypatch):
    from app.streams import test_connection as check_connection

    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "DroidCam Video"})
    monkeypatch.setattr(win, "mf_device_names", lambda: ["DroidCam Video"])

    # 1) không tìm thấy thiết bị
    _install_fake(monkeypatch, win, {}, missing="fail-open")
    r = check_connection("webcam", "webcam://dshow/name/Camera%20La")
    assert r["ok"] is False and r["reason"] == "not_found"
    assert NOT_FOUND_MSG in r["message"]
    assert IN_USE_MSG not in r["message"]
    assert "đã thử" in r["message"]
    assert_never_video_equals_cap_dshow()

    # 2) có trong danh sách nhưng không mở / không đọc được → đang bị app khác dùng
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): "fail-open",
        (0, cv2.CAP_DSHOW): "fail-open",
        (0, cv2.CAP_MSMF): "fail-open",
    }
    _install_fake(monkeypatch, win, catalog)
    r = check_connection("webcam", "webcam://dshow/name/DroidCam%20Video")
    assert r["ok"] is False and r["reason"] == "in_use"
    assert IN_USE_MSG in r["message"]
    assert "đã thử dshow/0" in r["message"]
    assert_never_video_equals_cap_dshow()

    # Mở được nhưng read fail
    cap_ok = {( "video=DroidCam Video", cv2.CAP_DSHOW): [], (0, cv2.CAP_DSHOW): []}
    # empty frame list + opened → prepare/probe không đọc được khung
    _install_fake(monkeypatch, win, cap_ok)
    r = check_connection("webcam", "webcam://dshow/name/DroidCam%20Video")
    assert r["ok"] is False and r["reason"] == "in_use"
    assert IN_USE_MSG in r["message"]

    # 3) không có hình (màu đặc) — ok true, hasPicture false
    catalog = {
        ("video=DroidCam Video", cv2.CAP_DSHOW): [_solid((0, 255, 0))],
        (0, cv2.CAP_DSHOW): [_solid((0, 255, 0))],
    }
    _install_fake(monkeypatch, win, catalog)
    r = check_connection("webcam", "webcam://dshow/name/DroidCam%20Video")
    assert r["reason"] == "uniform"
    assert r.get("hasPicture") is False
    assert NO_PICTURE_MSG in r["message"]
    assert "DroidCam Client phải đang kết nối" in r["message"]
    assert "đã thử dshow/0" in r["message"]
    assert r["ok"] is True  # không chặn Lưu
    assert_never_video_equals_cap_dshow()


class _FakeReader:
    def __init__(self, frames, source=0, api="pygrabber"):
        self.source = source
        self.api = api
        self._frames = list(frames)
        self._i = 0
        self.released = False
        self._open = True

    def isOpened(self):
        return self._open and not self.released

    def read(self):
        if not self.isOpened() or not self._frames:
            return False, None
        if self._i >= len(self._frames):
            return True, self._frames[-1].copy()
        f = self._frames[self._i]
        self._i += 1
        return True, f.copy()

    def release(self):
        self.released = True

    def set(self, *a):
        return True

    def get(self, *a):
        return 0


def test_list_probes_msmf_0_to_5_when_mf_enum_empty(win, monkeypatch):
    """Enum VIDCAP lỗi / 0 thiết bị — vẫn dò MSMF 0..5, không bịa index mở thất bại."""
    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "DroidCam Video"})
    monkeypatch.setattr(win, "mf_device_names", lambda: [])
    monkeypatch.setattr(win, "_pnp_camera_names", lambda: [])
    photo = _photo()
    catalog = {
        (0, cv2.CAP_DSHOW): "fail-open",
        (1, cv2.CAP_MSMF): [photo],  # chỉ số 1 ra hình
        (0, cv2.CAP_MSMF): "fail-open",
        (2, cv2.CAP_MSMF): "fail-open",
        (3, cv2.CAP_MSMF): "fail-open",
        (4, cv2.CAP_MSMF): "fail-open",
        (5, cv2.CAP_MSMF): "fail-open",
    }
    _install_fake(monkeypatch, win, catalog, missing="fail-open")
    devices, _hint = list_webcam_devices(debug=True, max_index=6)
    msmf = [d for d in devices if d.get("backend") == "msmf"]
    assert len(msmf) == 1
    assert msmf[0]["index"] == 1
    assert msmf[0]["url"] == "webcam://msmf/1"
    assert msmf[0]["hasPicture"] is True
    tried = [(h[1], h[2]) for h in FakeCap.history if h[0] == "open"]
    for i in range(6):
        assert (i, cv2.CAP_MSMF) in tried
    assert_never_video_equals_cap_dshow()


def test_open_falls_back_to_pygrabber_then_ffmpeg(win, monkeypatch):
    monkeypatch.setattr(win, "dshow_device_names", lambda: {0: "DroidCam Video"})
    monkeypatch.setattr(win, "mf_device_names", lambda: [])
    catalog = {
        (0, cv2.CAP_DSHOW): "fail-open",
        (0, cv2.CAP_MSMF): "fail-open",
        (1, cv2.CAP_MSMF): "fail-open",
        (2, cv2.CAP_MSMF): "fail-open",
        (3, cv2.CAP_MSMF): "fail-open",
        (4, cv2.CAP_MSMF): "fail-open",
        (5, cv2.CAP_MSMF): "fail-open",
    }
    _install_fake(monkeypatch, win, catalog, missing="fail-open")

    pg_calls = []
    ff_calls = []

    def pg(index, name=None):
        pg_calls.append((index, name))
        return _FakeReader([_photo()], source=index, api="pygrabber")

    def ff(name, index=None):
        ff_calls.append((name, index))
        return None

    monkeypatch.setattr(win, "_open_pygrabber_capture", pg)
    monkeypatch.setattr(win, "_open_ffmpeg_capture", ff)
    cap = open_webcam("webcam://dshow/name/DroidCam%20Video")
    assert cap.isOpened()
    assert cap.api == "pygrabber" and cap.source == 0
    assert pg_calls and ff_calls == []
    assert_never_video_equals_cap_dshow()

    # pygrabber cũng hỏng → ffmpeg
    FakeCap.reset(catalog, missing="fail-open")
    pg_calls.clear()
    ff_calls.clear()

    def pg_fail(index, name=None):
        pg_calls.append((index, name))
        return None

    def ff_ok(name, index=None):
        ff_calls.append((name, index))
        return _FakeReader([_photo()], source=name, api="ffmpeg")

    monkeypatch.setattr(win, "_open_pygrabber_capture", pg_fail)
    monkeypatch.setattr(win, "_open_ffmpeg_capture", ff_ok)
    cap2 = open_webcam("webcam://dshow/0")
    assert cap2.isOpened()
    assert cap2.api == "ffmpeg"
    assert ff_calls and ff_calls[0][0] == "DroidCam Video"
    assert_never_video_equals_cap_dshow()
    # ffmpeg được gọi với tên, không phải cv2.VideoCapture("video=...", CAP_DSHOW)
    assert all(
        not (isinstance(h[1], str) and str(h[1]).startswith("video=") and h[2] == cv2.CAP_DSHOW)
        for h in FakeCap.history if h[0] == "open"
    )


def test_opencv_conflict_warning_and_hint(monkeypatch):
    import app.webcams as webcams
    pkgs = {"opencv-python": "4.10.0", "opencv-python-headless": "4.9.0"}
    warn = opencv_conflict_warning(pkgs)
    assert warn and "opencv-python==4.10.0" in warn
    assert "opencv-python-headless==4.9.0" in warn
    assert "can't be used to capture" in warn
    assert opencv_conflict_warning({"opencv-python": "4.10.0"}) is None

    # hook hint
    monkeypatch.setattr(webcams, "IS_WIN", True)
    monkeypatch.setattr(webcams, "opencv_conflict_warning", lambda pkgs=None: warn)
    monkeypatch.setattr(webcams, "dshow_device_names", lambda: {})
    monkeypatch.setattr(webcams, "mf_device_names", lambda: [])
    monkeypatch.setattr(webcams, "_pnp_camera_names", lambda: [])
    monkeypatch.setattr(webcams, "_open_pygrabber_capture", lambda *a, **k: None)
    monkeypatch.setattr(webcams, "_open_ffmpeg_capture", lambda *a, **k: None)
    FakeCap.reset({}, missing="fail-open")
    monkeypatch.setattr(webcams.cv2, "VideoCapture", FakeCap)
    devices, hint = list_webcam_devices(debug=True)
    assert hint and "opencv-python==4.10.0" in hint


def test_check_env_returns_versions(monkeypatch):
    import app.webcams as webcams
    monkeypatch.setattr(webcams, "installed_opencv_packages",
                        lambda: {"opencv-python": "4.10.0"})
    info = check_env(force=True, silent=True)
    assert info["cv2"]
    assert info["python"]
    assert info["packages"]["opencv-python"] == "4.10.0"
    assert "warning" in info


def test_probe_uses_warmup_frames_if_later_reads_fail(win, monkeypatch):
    monkeypatch.setattr(win, "PROBE_WARMUP_SEC", 0.0)
    monkeypatch.setattr(win, "PROBE_DISCARD", 3)
    monkeypatch.setattr(win, "PROBE_WANT", 5)
    monkeypatch.setattr(win, "PROBE_TIMEOUT_SEC", 1.0)
    # 3 khung thật rồi đứt — không được báo 'không đọc được khung'
    frames = [_photo(), _photo(), _photo()]
    FakeCap.reset({(0, cv2.CAP_DSHOW): frames})
    cap = FakeCap(0, cv2.CAP_DSHOW)
    # after 3 unique frames, FakeCap repeats last; force fail after 3 by emptying
    info = probe_capture(cap, already_prepared=True)
    # default FakeCap repeats last frame, so this would succeed anyway.
    # Use a cap that fails after 3:
    class StopAfter(FakeCap):
        def read(self):
            if self._i >= 3:
                return False, None
            return super().read()
    StopAfter.reset({(0, cv2.CAP_DSHOW): [_photo(), _photo(), _photo()]})
    cap2 = StopAfter(0, cv2.CAP_DSHOW)
    info = probe_capture(cap2, already_prepared=True)
    assert info["ok"] is True
    assert info["has_picture"] is True
    assert info["frames_read"] >= 3
    assert not info.get("error")
