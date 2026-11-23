"""Cấu hình qua biến môi trường (xem .env.example)."""
import os
import time
from pathlib import Path

# Mọi thống kê theo ngày/giờ tính theo giờ Việt Nam (đổi bằng biến TZ nếu cần)
if not os.environ.get("TZ"):
    # "ICT-7" = UTC+7, dùng được cả khi máy không có tzdata
    os.environ["TZ"] = "Asia/Ho_Chi_Minh" if Path("/usr/share/zoneinfo/Asia/Ho_Chi_Minh").exists() else "ICT-7"
if hasattr(time, "tzset"):
    time.tzset()

BASE_DIR = Path(__file__).resolve().parent.parent


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


DATA_DIR = Path(_env("DATA_DIR", str(BASE_DIR / "data")))
MEDIA_DIR = DATA_DIR / "media"
DB_PATH = DATA_DIR / "cmc_ai.sqlite3"

JWT_SECRET = _env("JWT_SECRET", "doi-secret-nay-khi-trien-khai-cmc-ai-2026")
JWT_HOURS = int(_env("JWT_HOURS", "12"))

# mock = đọc nhãn có sẵn của dataset (chạy demo khi chưa có model)
# yolo = dùng Ultralytics với file trọng số thật
DETECTOR = _env("DETECTOR", "mock")
DET_MODEL = _env("DET_MODEL", "weights/det_best.pt")
POSE_MODEL = _env("POSE_MODEL", "weights/pose_best.pt")
DET_CONF = float(_env("DET_CONF", "0.25"))
DET_IOU = float(_env("DET_IOU", "0.45"))
IMG_SIZE = int(_env("IMG_SIZE", "960"))
DEVICE = _env("DEVICE", "")  # "" = tự chọn, "cpu", "0"...
METRICS_JSON = _env("METRICS_JSON", "")  # tuỳ chọn: số liệu đánh giá model cho màn Mô hình

DATASET_DIR = Path(_env("DATASET_DIR", "/workspace/dataset/ds"))

# Dataset gắn nhãn "student"; FE dùng "person". COCO dùng "cell phone".
# Ngưỡng tin cậy riêng từng lớp (sau khi map), ví dụ "paper:0.5,calculator:0.5"
CLASS_CONF = {k.strip(): float(v) for k, v in
              (x.split(":") for x in _env("CLASS_CONF", "phone:0.25,paper:0.5,calculator:0.5").split(",") if ":" in x)}
# Ngưỡng riêng lớp điện thoại trên khung đầy đủ (thấp hơn DET_CONF nếu DET_CONF bị nâng).
PHONE_CONF = float(_env("PHONE_CONF", str(CLASS_CONF.get("phone", 0.25))))
# COCO dùng "cell phone" (lớp 67). Thêm vài alias để không lọc mất điện thoại.
CLASS_MAP = {
    "student": "person", "person": "person",
    "cell phone": "phone", "cellphone": "phone", "cell_phone": "phone",
    "mobile phone": "phone", "smartphone": "phone", "phone": "phone",
    "paper": "paper", "calculator": "calculator",
}

# Dataset pose có 11 điểm (mũi, mắt, tai, vai, khuỷu, cổ tay). FE vẽ khung xương 17 điểm COCO,
# nên mặc định đệm thêm [0,0,0] cho đủ 17 (điểm 9/10 vẫn là cổ tay).
POSE_PAD_TO = int(_env("POSE_PAD_TO", "17"))

# ---- Phân biệt giám thị / thí sinh (model vai trò, ví dụ YOLO26m TSII: student/teacher) ----
# Để trống = tắt (mọi người role:'unknown'). Ví dụ: ROLE_MODEL=weights/role_best.pt
ROLE_MODEL = _env("ROLE_MODEL", "").strip()
# Ánh xạ tên lớp (model.names, không phân biệt hoa thường) → vai trò.
# Cú pháp: "invigilator:teacher|giám thị|invigilator;student:student|thí sinh|sinh viên"
ROLE_CLASSES_RAW = _env("ROLE_CLASSES",
                        "invigilator:teacher|giám thị|giam thi|invigilator|giáo viên;"
                        "student:student|thí sinh|thi sinh|sinh viên|sinh vien|candidate")
ROLE_EVERY_N = max(1, int(_env("ROLE_EVERY_N", "3")))   # chạy model vai trò mỗi N khung phân tích
ROLE_ADAPTIVE = _env("ROLE_ADAPTIVE", "1").lower() in ("1", "on", "true", "yes")  # tự tăng N khi CPU chậm
ROLE_MAX_EVERY_N = max(1, int(_env("ROLE_MAX_EVERY_N", "10")))
ROLE_CONF = float(_env("ROLE_CONF", "0.35"))
ROLE_IMG_SIZE = int(_env("ROLE_IMG_SIZE", "480"))
ROLE_IOU_MATCH = float(_env("ROLE_IOU_MATCH", "0.3"))
ROLE_SMOOTH_N = max(1, int(_env("ROLE_SMOOTH_N", "5")))
# Box vai trò KHÔNG khớp người DET chỉ được dùng làm người khi đủ chắc, không phủ quá lớn,
# không phải dải ôm mép khung, và xuất hiện đủ số lần (persist).
ROLE_ONLY_CONF = float(_env("ROLE_ONLY_CONF", "0.7"))
ROLE_ONLY_MAX_AREA = float(_env("ROLE_ONLY_MAX_AREA", "0.25"))
ROLE_ONLY_MAX_ASPECT = float(_env("ROLE_ONLY_MAX_ASPECT", "3.5"))  # h/w; box ôm mép + quá cao thì loại
ROLE_ONLY_EDGE_MIN_HEIGHT = float(_env("ROLE_ONLY_EDGE_MIN_HEIGHT", "0.65"))  # ôm mép đứng và cao >= 65% khung
ROLE_ONLY_PERSIST_HITS = max(1, int(_env("ROLE_ONLY_PERSIST_HITS", "2")))
ROLE_ONLY_PERSIST_IOU = float(_env("ROLE_ONLY_PERSIST_IOU", "0.3"))
# Người đứng (cao hơn trung vị chỗ ngồi) mà conf 'student' < ngưỡng → 'unknown' (không ép thành giám thị).
ROLE_STANDING_RATIO = float(_env("ROLE_STANDING_RATIO", "1.35"))
ROLE_STANDING_STUDENT_CONF = float(_env("ROLE_STANDING_STUDENT_CONF", "0.6"))
# Thông tin: 'không thấy giám thị trong phòng' sau N giây (0 = tắt). Chỉ khi model vai trò đang chạy.
ROOM_NO_INVIGILATOR_SEC = float(_env("ROOM_NO_INVIGILATOR_SEC", "120"))
# ---- Lượt 2 phóng tay/bàn để tìm điện thoại nhỏ / bị che / dưới gầm bàn ----
# PHONE_ZOOM=0 để tắt. Máy yếu: PHONE_ZOOM_EVERY_N=4 hoặc PHONE_ZOOM=0.
PHONE_ZOOM = _env("PHONE_ZOOM", "1").lower() in ("1", "on", "true", "yes")
PHONE_ZOOM_EVERY_N = max(1, int(_env("PHONE_ZOOM_EVERY_N", "2")))
PHONE_ZOOM_ADAPTIVE = _env("PHONE_ZOOM_ADAPTIVE", "1").lower() in ("1", "on", "true", "yes")
PHONE_ZOOM_MAX_EVERY_N = max(1, int(_env("PHONE_ZOOM_MAX_EVERY_N", "8")))
PHONE_ZOOM_MAX_CROPS = max(1, int(_env("PHONE_ZOOM_MAX_CROPS", "12")))
PHONE_ZOOM_IMG_SIZE = int(_env("PHONE_ZOOM_IMG_SIZE", "416"))
PHONE_ZOOM_CONF = float(_env("PHONE_ZOOM_CONF", "0.20"))
PHONE_ZOOM_PAD = float(_env("PHONE_ZOOM_PAD", "2.5"))  # hệ số span cổ tay / vùng cắt
PHONE_ZOOM_MIN_CROP = int(_env("PHONE_ZOOM_MIN_CROP", "160"))  # cạnh nhỏ nhất; crop nhỏ hơn sẽ được nới rồi phóng lên imgsz
PHONE_ZOOM_FAR_TILE = _env("PHONE_ZOOM_FAR_TILE", "1").lower() in ("1", "on", "true", "yes")
PHONE_ZOOM_TILE_SIZE = int(_env("PHONE_ZOOM_TILE_SIZE", "256"))  # ô lát nửa xa (phía trên khung) khi DET bỏ sót người nhỏ
# Video/camera: điều kiện điện thoại phải thấy đủ PHONE_PERSIST_HITS khung (và persistSeconds).
PHONE_PERSIST_HITS = max(1, int(_env("PHONE_PERSIST_HITS", "2")))
# Ảnh đơn (bỏ persist thời gian): điện thoại source=zoom chỉ cảnh báo khi conf >= ngưỡng này.
PHONE_IMAGE_CONF = float(_env("PHONE_IMAGE_CONF", "0.35"))

DETECT_FPS = float(_env("DETECT_FPS", "5"))       # số frame/giây chạy model cho camera trực tiếp
POSE_EVERY_N = max(1, int(_env("POSE_EVERY_N", "1")))  # 2 = chạy pose cách một khung (máy yếu)
ANALYSIS_FPS = float(_env("ANALYSIS_FPS", "5"))   # số frame/giây lấy mẫu khi phân tích video upload
ANALYSIS_MAX_SEC = float(_env("ANALYSIS_MAX_SEC", "300"))
CLIP_PRE_SEC = float(_env("CLIP_PRE_SEC", "4"))
CLIP_POST_SEC = float(_env("CLIP_POST_SEC", "3"))
# off (mặc định): không khởi động camera dataset:// còn sót trong DB
SAMPLE_CAMERAS = _env("SAMPLE_CAMERAS", "off").lower() not in ("0", "off", "false", "no")
# 1: lần chạy đầu (DB trống) mới seed 8 camera mẫu từ dataset. Mặc định tắt — DB mới không có dữ liệu demo.
SEED_DEMO = _env("SEED_DEMO", "0").lower() in ("1", "on", "true", "yes")
# Marker DB: mỗi lần tăng khi có bước dọn dữ liệu mẫu (purge camera dataset://).
# Tăng số này khi đổi logic dọn dữ liệu lúc start (v3 = xoá hết cảnh báo/media mẫu một lần).
DATA_VERSION = 3
PHONE_TOKEN_HOURS = float(_env("PHONE_TOKEN_HOURS", "4"))  # hạn token trong mã QR
DATASET_STREAM_FPS = float(_env("DATASET_STREAM_FPS", "2"))  # tốc độ phát camera giả từ dataset
AUTOSTART_CAMERAS = _env("AUTOSTART_CAMERAS", "1") == "1"

CORS_ORIGINS = [o.strip() for o in _env("CORS_ORIGINS", "*").split(",")]

for d in (DATA_DIR, MEDIA_DIR, MEDIA_DIR / "alerts", MEDIA_DIR / "uploads", MEDIA_DIR / "samples", MEDIA_DIR / "jobs"):
    d.mkdir(parents=True, exist_ok=True)
