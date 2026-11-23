# Hợp đồng API bổ sung (BE 10/11/2026 tối) — dành cho FE

Bản BE này **không còn seed camera/cảnh báo mẫu** khi chạy với DB mới. Tài khoản đăng nhập giữ nguyên:
`admin@cmc.edu.vn` / `admin123`, `giamthi@cmc.edu.vn` / `giamthi123`.
Nếu máy anh Dũng còn dữ liệu cũ: `run.bat --reset-data` (hoặc `python run.py --reset-data`).

## 1. Lưới 3×3 vs Camera đơn — dùng endpoint nào

Chrome chỉ giữ khoảng **6 kết nối HTTP/1.1** tới một máy chủ. 9 luồng MJPEG trên lưới 3×3 sẽ chiếm hết slot, làm giật cả trang (API + WS bị kẹt), nặng hơn khi bật lọc “chỉ cam cảnh báo” (ô bị tạo/huỷ liên tục).

| Màn hình | Nên dùng | Không nên |
|---|---|---|
| **Giám sát → Hệ thống camera (lưới 2×2 / 3×3)** | `GET /api/cameras/{id}/snapshot.jpg?w=480&token=...&t={Date.now()}` (kéo 2–5 lần/giây), **hoặc** một WebSocket `/ws/grid` | `stream.mjpg` (mỗi ô một kết nối dài) |
| **Giám sát → Camera đơn** | `GET /api/cameras/{id}/stream.mjpg?token=...&fps=15` (tuỳ chọn `&w=1280`) | `/ws/grid` |

Ảnh snapshot / khung lưới là **video gốc**, chưa vẽ lớp phủ. FE vẫn vẽ overlay từ gói `detections` qua `/ws`.

### 1.1. Snapshot (đã có, thêm query)

`GET /api/cameras/{id}/snapshot.jpg?token=&w=480&q=70`

- `w`: thu nhỏ theo chiều rộng, 80–1280 (mặc định: giữ bản BE đã mã hoá, tối đa 1280). Cache theo từng camera + khung + `w`.
- `q`: chất lượng JPEG 40–95, mặc định 70.
- 404 `{message:"Chưa có khung hình"}` nếu camera chưa chạy hoặc chưa có frame.
- Header: `Cache-Control: no-store`. FE nên thêm `&t={Date.now()}` để tránh cache trình duyệt (như hiện tại).

### 1.2. MJPEG (đã có, thêm query)

`GET /api/cameras/{id}/stream.mjpg?token=&fps=15&w=`

- `fps` 0.5–30, mặc định 15.
- `w` giống snapshot. Generator **dừng khi `<img>` bị gỡ / tab đóng**.

### 1.3. WebSocket lưới (mới)

`WS /ws/grid?token=<JWT>&cams=cam-aa,cam-bb&w=480&fps=5`

- Token thường (không dùng token QR `push:`). Sai token: accept rồi đóng **4401**.
- Query `cams`, `w` (mặc định 480), `fps` (mặc định 5, tối đa 15) là tuỳ chọn.
- Client có thể gửi: `{"type":"subscribe","cameraIds":["cam-aa","cam-bb"],"w":480,"fps":5}`
- Server:
  - ngay sau khi mở: `{"type":"ready","w":480,"fps":5,"cameraIds":[...]}`
  - mỗi khung: `{"type":"frame","cameraId":"cam-aa","ts":<ms>,"w":480,"jpeg":"<base64 JPEG>"}`
- Một kết nối cho cả lưới. Khi client đóng, BE huỷ task, không để rò.

## 2. Webcam — `GET /api/sources/webcams`

Vẫn cần đăng nhập. Mặc định trả **mảng** (tương thích FE). Mỗi phần tử:

```json
{
  "index": 0,
  "backend": "dshow",
  "name": "DroidCam Video",
  "url": "webcam://dshow/0",
  "urlByName": "webcam://dshow/name/DroidCam%20Video",
  "width": 1280,
  "height": 720,
  "inUse": false,
  "hasPicture": true
}
```

| Trường | Bắt buộc | Ý nghĩa |
|---|---|---|
| `index` | có | Chỉ số trên backend đó. `-1` nếu chỉ biết tên (hiếm). |
| `name` | có | Tên thân thiện (DirectShow / Media Foundation VIDCAP / V4L2). **Không** gồm thiết bị audio (`Microphone`, `DroidCam Audio`). |
| `url` | có | Nên gửi nguyên giá trị này khi tạo camera / Kiểm tra. |
| `backend` | có | `"dshow"` \| `"msmf"` \| `"v4l2"` \| `"auto"`. |
| `urlByName` | có nếu có tên | `webcam://dshow/name/…` hoặc `webcam://msmf/name/…` (tham chiếu). `url` chính luôn là `webcam://dshow/N` hoặc `webcam://msmf/N` khi đã biết chỉ số. Lúc mở, BE đổi tên → chỉ số (DirectShow: thứ tự pygrabber, lấp ô trống từ ffmpeg; MSMF: thứ tự VIDCAP). OpenCV `CAP_DSHOW`/`CAP_MSMF` **chỉ nhận chỉ số nguyên** — không truyền chuỗi tên. |
| `width` / `height` | khi đọc được khung | |
| `inUse` | có | Camera CMC AI đang chiếm thiết bị (không mở lại khi liệt kê). |
| `hasPicture` | có | **Chỉ mang tính gợi ý.** `false` = sau khi hâm nóng (~2 s, bỏ ~10 khung rồi đọc 15–30 khung; camera ảo thử 1280×720 và 640×480 + MJPG/YUY2) vẫn chỉ thấy màu đặc, hoặc không đọc được khung. **Không được chặn chọn/Lưu** vì `hasPicture: false`. `POST /api/cameras` vẫn nhận. |
| `altUrl` / `altBackend` | tuỳ chọn | Backend còn lại khi gộp trùng tên. |

Thứ tự: **`DroidCam Video` trên DirectShow lên đầu** (nếu có), rồi `DroidCam Video` MSMF, rồi DroidCam khác. Cùng tên chỉ còn **một** mục, ưu tiên backend thật sự ra được hình.

BE dò từng thiết bị tuần tự, **đóng/release trước khi mở cái tiếp theo**. Không bịa mục `Webcam 4/5` cho chỉ số mở thất bại. Không gán tên WMI vào chỉ số MSMF (thứ tự khác OpenCV).

Chỉ số DirectShow = thứ tự `pygrabber FilterGraph().get_input_devices()` (trùng OpenCV `CAP_DSHOW`). Nếu pygrabber lỗi, dùng thứ tự video của `ffmpeg -list_devices`. Nếu pygrabber chạy được nhưng để trống một ô (thường ô 0 — camera ảo như *DroidCam Video* không nằm trong list pygrabber) trong khi ASUS/OBS đã là `dshow/1`, `dshow/2`, BE lấp ô trống bằng tên cùng chỉ số từ ffmpeg, rồi đặt `url` = `webcam://dshow/N`. Không còn liệt kê thiết bị đã biết chỉ số dưới dạng `webcam://dshow/name/…` làm url chính.

Nếu **mọi** thiết bị không mở được hoặc đều không có hình, `GET /api/sources/webcams?debug=1` trả `hint`:

`Kiểm tra Windows: Settings → Privacy & security → Camera → bật "Let desktop apps access your camera", và đóng các app đang dùng camera.`

### 2.1. `GET /api/sources/webcams?debug=1`

Trả object (không còn là mảng):

```json
{
  "devices": [
    {
      "index": 0, "backend": "dshow", "name": "DroidCam Video",
      "url": "webcam://dshow/0",
      "urlByName": "webcam://dshow/name/DroidCam%20Video",
      "hasPicture": true, "inUse": false, "width": 1280, "height": 720,
      "open": true, "framesRead": 22, "mean": 87.4, "std": 41.1,
      "shape": [720, 1280, 3], "dtype": "uint8", "time": 1730, "error": null
    }
  ],
  "hint": null
}
```

Trên máy Windows, anh Dũng có thể chạy `python -m app.webcams` (cùng báo cáo) rồi dán kết quả nếu vẫn lỗi.

### 2.2. `sourceUrl` cho `sourceType: "webcam"`

| URL | Nghĩa |
|---|---|
| `webcam://N` hoặc `"0"` hoặc `/dev/videoN` | Cũ, vẫn chạy. Windows: thử DirectShow rồi MSMF tại chỉ số N. |
| `webcam://dshow/N` | DirectShow, chỉ số N. |
| `webcam://msmf/N` | Media Foundation, chỉ số N (VIDCAP, cùng thứ tự OpenCV). |
| `webcam://dshow/name/DroidCam%20Video` | Đổi tên → chỉ số DirectShow (pygrabber, rồi ffmpeg `-list_devices` video). Không resolve được: thử các chỉ số 0..9 chưa gắn tên. Mở bằng `CAP_DSHOW(int)` — **không** truyền chuỗi tên. **Nếu DSHOW thất bại**, mở cùng thiết bị qua MSMF theo chỉ số VIDCAP (không dùng chung số DSHOW). |
| `webcam://msmf/name/DroidCam%20Video` | **Không** mở MSMF theo tên. BE enum lại VIDCAP rồi mở đúng chỉ số. |

**DroidCam bản mới** (Client kiểu OBS): chọn **`DroidCam Video`** (ưu tiên `webcam://dshow/…` nếu backend này có hình). **`DroidCam Source 1`** thường là khung xanh.

### 2.3. `POST /api/cameras/test-connection`

`hasPicture` chỉ gợi ý; **BE không chặn Lưu**. Với `sourceType: "webcam"`, `message` phân biệt ba trường hợp (cụm từ cố định, FE có thể dò):

- **không tìm thấy thiết bị** — `reason: "not_found"`, `ok: false`. URL/tên không có trong enum DirectShow/MSMF VIDCAP, và không mở được.
- **thiết bị đang bị app khác dùng** — `reason: "in_use"`, `ok: false`. Thiết bị có trong danh sách nhưng **mở thất bại** hoặc **đọc không được khung**. Có thể kèm gợi ý quyền Camera Windows.
- **không có hình** — `reason: "uniform"`, `ok: true`, `hasPicture: false`. Mở và đọc được nhưng khung màu đặc (sau hâm nóng ~2 s). Vẫn cho phép Lưu. Với DroidCam/OBS: *DroidCam Client phải đang kết nối và đang hiện hình video.*

`message` còn kèm backend và chỉ số đã thử / đã mở, ví dụ `(đã thử dshow/0, msmf/1; đã mở msmf/1)`.

Nguồn file/HTTP màu đặc: vẫn `{ok:false, reason:"uniform"}` như trước.

BE **đóng nguồn ngay** sau khi kiểm tra. FE nhớ đóng tab đang xem `http://IP:4747/video` trước khi bấm Kiểm tra / Lưu.

DroidCam qua Wi-Fi: `sourceType` `"rtsp"` hoặc `"http"`, `sourceUrl` `http://<IP>:4747/video`.

### 2.4. Mở khung khi OpenCV DirectShow hỏng

Trên một số máy Windows (đặc biệt khi cài chồng `opencv-python` + `opencv-python-headless` + `opencv-contrib-python`, hoặc chạy Python hệ thống), OpenCV báo `VIDEOIO(DSHOW): backend is generally available but can't be used to capture by index/name` và `raised unknown C++ exception`. BE không còn phụ thuộc mỗi OpenCV:

1. `cv2` `CAP_DSHOW` theo **chỉ số nguyên** (không bao giờ truyền chuỗi `video=`).
2. `cv2` `CAP_MSMF` theo chỉ số VIDCAP của cùng tên. **Dù enum Media Foundation lỗi**, vẫn dò MSMF chỉ số 0..5 (đóng trước khi mở cái sau). DroidCam là nguồn MF.
3. **pygrabber** FilterGraph: `add_video_input_device` + `add_sample_grabber` + `prepare_preview_graph`/`run` + `grab_frame`, luồng riêng đưa khung BGR (cùng giao diện `isOpened`/`read`/`release` như `VideoCapture`).
4. **ffmpeg** trên PATH hoặc `imageio-ffmpeg`: `ffmpeg -f dshow -i video="<tên>" -f image2pipe -vcodec mjpeg -` (cú pháp dshow của ffmpeg, không phải OpenCV).

Một bước chỉ được chấp nhận khi đọc được ít nhất một khung. Nếu DirectShow mở được nhưng sau vài khung hâm nóng thì đứt, BE dùng những khung đó để đánh giá (không báo nhầm «không đọc được khung») rồi thử backend tiếp theo khi không ra hình.

Enum MF (ctypes) dùng đúng `MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME` = `{60d0e559-52f8-4fa2-bbce-acdb34a8ec01}` (mfidl.h). Lỗi đọc tên của **một** thiết bị (kể cả `MF_E_ATTRIBUTENOTFOUND`) không hủy cả enum.

`python -m app.webcams` và `GET /api/sources/webcams?debug=1` in thêm: `cv2.__version__`, phiên bản Python, các gói `opencv*` (`importlib.metadata`), và `cv2.videoio_registry` backends. Nếu cài chồng nhiều gói OpenCV, `hint` (và log khi start BE / `run.bat`) chứa cảnh báo và lệnh gỡ. `requirements.txt` ghim `opencv-python>=4.9` — chỉ một gói. `run.bat --system` chạy bằng Python hệ thống; `check_env` vẫn chạy khi gọi `python run.py`.

## 3. Không còn dữ liệu mẫu khi khởi động

- DB mới: chỉ có 2 tài khoản + cấu hình quy tắc mặc định (`rooms: []`). Không camera, không cảnh báo, thống kê toàn 0.
- Muốn 8 camera dataset: đặt `SEED_DEMO=1` rồi chạy với DB trống (hoặc sau `--reset-data`).
- `SAMPLE_CAMERAS=off` (mặc định): không khởi động nguồn `dataset://` còn sót trong DB.


## 4. Dọn dữ liệu mẫu khi khởi động (`data_version=3`)

Khi `SEED_DEMO` không phải `1`:

- **Mỗi lần start:** xoá camera `dataset://` còn sót (idempotent). Camera người dùng (`webcam://`, `http(s)://`, `rtsp://`, `phone` / push, file thường) và tài khoản **không** bị xoá.
- **Một lần** khi nâng marker lên `data_version=3`: xoá **toàn bộ** cảnh báo (kể cả của camera người dùng — cảnh báo demo cũ có thể trỏ cam đã xoá), clip/ảnh trong `data/media/alerts`, file upload phân tích trong `data/media/uploads`, bản sao samples, và phòng không còn camera. Dashboard tính từ bảng alerts nên về 0. Không có bảng sessions/notifications riêng trong BE.

Log: `[cmc-ai] data_version=3 (trước đó 2): dọn toàn bộ dữ liệu vận hành — …`. Lần start sau không xoá cảnh báo mới.


`python run.py --reset-data` vẫn xoá toàn bộ dữ liệu vận hành (kể cả camera người dùng), giữ users.

## 5. `GET /api/system/model` (cần đăng nhập)

Trả thông tin model đang chạy (để FE hiện / kiểm tra 'cell phone'):

```json
{
  "detModel": "yolo26s.pt",
  "poseModel": "yolo26s-pose.pt",
  "classes": ["person", "bicycle", "...", "cell phone", "..."],
  "device": "cpu",
  "imgSize": 640,
  "conf": 0.25,
  "iou": 0.45,
  "detectFps": 8,
  "fallback": false
}
```

- `classes` là tên lớp **gốc** của file detect (COCO có `"cell phone"`).
- `fallback: true` khi file `.pt` trong `.env` không có, BE đã chuyển sang file khác hoặc để Ultralytics tự tải — BE in WARNING lúc khởi động.
- Lúc start, BE log đầy đủ đường dẫn det/pose, danh sách lớp, device, imgsz, conf, iou.

## 6. `detectFps` trong `camera_status`

Mỗi phần tử `GET /api/cameras/status` và gói WS `camera_status` thêm:

- `fps` — tốc độ **đọc video** (như cũ)
- `detectFps` — tốc độ **phân tích thực tế** (số gói `detections`/giây). 0 khi camera offline.

FE nên dùng `detectFps` (hoặc đếm gói `detections`) để hiện "Phân tích ~N khung/giây", không dùng `fps` video và không dùng `CAP_PROP_FPS` (webcam thường trả **-1**).

Gói `detections` luôn có `frameTs`, `width`, `height` theo khung gốc (ví dụ 1280×720), toạ độ box cùng hệ. Khi camera mất hình, che ống kính (khung màu đặc) hoặc rớt nguồn, BE gửi `objects: []`, `poses: []` để lớp phủ biến mất.

## 7. Gói `detections` (WebSocket `/ws`)

Mỗi gói có:

| Trường | Ý nghĩa |
|---|---|
| `cameraId` | id camera |
| `frameTs` | mốc ms lúc BE đọc/nhận khung |
| `frameW`, `frameH` | kích thước khung nguồn (px) |
| `width`, `height` | giống `frameW`/`frameH` (tương thích cũ) |
| `coord` | luôn `"px"` |
| `objects[].bbox`, `poses[].bbox`, `poses[].keypoints` | **pixel trên khung `frameW` × `frameH`**, không phải kích thước ảnh MJPEG đã thu nhỏ hay `imgsz` của YOLO |

`ts` = `frameTs`. `serverTs` là lúc phân tích xong.

## 8. Chẩn đoán camera

`GET /api/cameras/{id}/diag` (cần đăng nhập) và mỗi phần tử `camera_status` / `GET /api/cameras/status`:

```json
{
  "cameraId": "cam-aa", "online": true,
  "framesRead": 120, "analysedFrames": 40,
  "detectFps": 2.5, "lastDetectTs": 1794325467240,
  "lastObjects": 3, "inferMs": 140,
  "lastError": null,
  "detector": "running",
  "fps": 15.0, "latencyMs": 140, "updatedAt": 1794325467240
}
```

`detector`: `"running"` | `"not_started"` | `"error"` | `"no_frames"`. Áp dụng cả camera phone/push. Mỗi ~5 giây BE in `cam <id>: read N frames, analysed M, objects K, infer X ms, err …`. Lỗi detect được log (kèm traceback), ghi `lastError`, không nuốt im và không làm chết luồng camera.

## 9. Máy Windows yếu (tuỳ chọn)

Mặc định vẫn `yolo26s` + `IMG_SIZE=640` + `DET_CONF=0.25` (nhận điện thoại ổn). Trong `.env` có khối comment: `yolo26n` / `yolo26n-pose`, `IMG_SIZE=480`, `POSE_EVERY_N=2`, `DETECT_FPS=4`. Pose cách một khung chỉ chạy khi đặt `POSE_EVERY_N=2`; khung xen kẽ dùng pose gần nhất.

## 10. Audit GET trên DB đã dọn (`SEED_DEMO=0`, `data_version=3`)

Các GET FE dùng, sau khi dọn, **không còn hàng mẫu trong DB**:

- Rỗng / 0: `/api/cameras`, `/api/cameras/status`, `/api/alerts`, `/api/alerts/recent`, hầu hết số trên `/api/stats/dashboard` (`alertsToday`, `perHour`, `perType`, `spark.alerts`…).
- Không rỗng (đúng thiết kế, không phải dữ liệu demo sót): `/api/users` (2 tài khoản mặc định), `/api/auth/me`, `/api/rules` (cấu hình quy tắc mặc định, `rooms: []` trừ khi còn camera người dùng).
- Không phải số liệu bịa từ DB:
  - `/api/system/model`: đường dẫn / lớp / device / imgsz / conf thật của model đang chạy.
  - `/api/models`: nếu chưa có `METRICS_JSON` thì `metrics: []`, `fps: 0` (YOLO) hoặc fps mock khi `DETECTOR=mock`; tên có hậu tố `" (model gốc COCO, tạm dùng cho demo)"` — nhãn, không phải metric giả.
  - `spark.cameras` là 7 lần số camera đang `online` (không có lịch sử 7 ngày).
  - `/api/sources/webcams`: liệt kê webcam máy, không đọc DB.
  - `/api/health`: `{ok, detector, cameras}` — `cameras` là số worker đang chạy.
- Không có bảng sessions / notifications / history riêng; “lịch sử” và thống kê lấy từ bảng `alerts` (đã xoá ở v3).
- `POST /api/analysis` với `sample=sample-image|sample-video` vẫn chạy trên file mẫu đóng gói trong bộ cài (không phải GET, không phải dữ liệu sót trong DB).

## 11. Phân tích streaming (màn Phân tích)

`POST /api/analysis` cũ **vẫn chạy đồng bộ như trước**. Màn Phân tích mới dùng job nền dưới đây. Cùng detector, `detect_lock` (chia sẻ với camera trực tiếp), quy tắc và cách viết cảnh báo: tin nhắn bắt đầu bằng **"Nghi vấn: …"**, mức **Cao / Trung bình / Thông tin**, thí sinh `#N`, không dùng chữ "gian lận". Toạ độ `objects`/`poses` là **pixel trên khung `width` × `height`** của file (cùng hệ với kết quả `/api/analysis`).

Chỉ **một** job chạy tại một thời điểm; job gửi sau có `status: "queued"`. Job mới **không** tự huỷ job cũ — FE gọi `DELETE` khi cần. Phân tích theo thời gian từ `t=0`, lấy mẫu `ANALYSIS_FPS` (mặc định 5) và cắt ở `ANALYSIS_MAX_SEC` (mặc định 300). Ảnh đi cùng luồng job: một khung `t=0` rồi `done`.

Job chỉ lưu trong bộ nhớ (mất khi restart). Job quá ~1 giờ bị xoá kèm file. `jobId` không còn trong bộ nhớ → **404**.

### 11.1. `POST /api/analysis/jobs` (cần đăng nhập, như `/api/analysis`)

Multipart: trường `file`, **hoặc** form `sample=sample-image|sample-video` (cùng nguồn mẫu với `/api/analysis`). BE lưu file rồi **trả ngay**, không chờ phân tích:

```json
{
  "jobId": "aj-a1b2c3d4e5f6",
  "fileName": "phong-thi.mp4",
  "mediaType": "video",
  "mediaUrl": "/media/jobs/aj-a1b2c3d4e5f6/source.mp4",
  "width": 1280,
  "height": 720,
  "fps": 25.0,
  "duration": 42.5,
  "model": {"detector": "…", "pose": "…"}
}
```

Ảnh: `mediaType:"image"`, `fps:0`, `duration:0`. `mediaUrl` phát được bằng thẻ `<video>`: hỗ trợ **HTTP Range**, **không cần JWT** — cùng cách với các URL `/media/...` hiện có (cảnh báo, mẫu).

### 11.2. `WS /ws/analysis/{jobId}?token=<JWT>`

Xác thực như `/ws` và `/ws/grid` (token thường; sai token: accept rồi đóng **4401**; không có job: **4404**). Nhiều client cùng lúc được. Khi vừa nối, BE **phát lại toàn bộ** kết quả đã có, rồi khoảng **0.5–1 s** một lô mới:

```json
{ "type": "progress", "progress": 0.42, "analysedSec": 12.4,
  "frames": [ { "t": 12.4, "objects": [], "poses": [] } ],
  "alerts": [ { "id": "aa-…", "t": 12.4, "type": "phone_near_hand", "level": "cao",
               "trackId": 1, "objectId": null, "confidence": 0.8,
               "message": "Nghi vấn: điện thoại gần tay thí sinh #1" } ] }
```

`progress` từ 0 đến 1. `frames`/`alerts` trong mỗi lô là phần **mới** (lô đầu khi vừa nối = toàn bộ đã có). Kết thúc:

```json
{ "type": "done", "progress": 1, "duration": 42.5, "totalFrames": 80, "totalAlerts": 3 }
```

hoặc `{ "type": "error", "message": "…" }` (kể cả khi FE `DELETE` lúc job đang chạy).

### 11.3. `GET /api/analysis/jobs/{jobId}?since=<t giây>`

```json
{ "status": "queued|running|done|error", "progress": 0.42, "analysedSec": 12.4,
  "frames": [], "alerts": [], "message": null }
```

`since` tuỳ chọn: chỉ trả `frames`/`alerts` có **`t > since`**. **Bỏ `since`** để lấy tất cả, kể cả khung `t=0`.

### 11.4. `DELETE /api/analysis/jobs/{jobId}`

Huỷ ngay (luồng dừng giữa các khung), xoá file và kết quả. HTTP **204**. Job không tồn tại: **404**.

## 12. Giám thị / thí sinh (model vai trò)

Model tham chiếu: **YOLO26m** của bài TSII (CMC University), 2 lớp `{0:'student', 1:'teacher'}`, train ở 640. BE đọc tên lớp từ `model.names` (không phân biệt hoa thường, nhận cả tên tiếng Việt) và ánh xạ qua `ROLE_CLASSES`:
`teacher | giám thị | invigilator → invigilator`, `student | thí sinh | sinh viên → student`.

Bật: chép file vào `weights/role_best.pt`, đặt `ROLE_MODEL=weights/role_best.pt` trong `.env` (bản zip đã đặt sẵn), khởi động lại BE. **Thiếu file hoặc load lỗi:** chỉ log `WARNING: [roles] …`, BE chạy tiếp, mọi người `role:"unknown"`.

Biến `.env`: `ROLE_MODEL` (trống = tắt), `ROLE_CLASSES`, `ROLE_CONF=0.35`, `ROLE_IMG_SIZE=480`, `ROLE_EVERY_N=3`, `ROLE_ADAPTIVE=1` (CPU chậm thì tự giãn N, tối đa `ROLE_MAX_EVERY_N=10`), `ROLE_ONLY_CONF=0.7`, `ROLE_ONLY_MAX_AREA=0.25`, `ROLE_ONLY_MAX_ASPECT=3.5`, `ROLE_ONLY_PERSIST_HITS=2`, `ROLE_SMOOTH_N=5`, `ROOM_NO_INVIGILATOR_SEC=120` (0 = tắt).

Cách chạy: model vai trò chạy dưới cùng `detect_lock` với DET/pose, mỗi `ROLE_EVERY_N` khung phân tích. Box vai trò ghép với box người (DET/pose) theo IoU ≥ 0.3 hoặc chứa tâm. Nếu DET không có người tương ứng, box vai trò được dùng làm người (`source:"role"`), chỉ khi conf ≥ `ROLE_ONLY_CONF` (0.7), box không phủ quá 25% khung, không phải dải ôm mép với tỉ lệ cao/mảnh, và xuất hiện đủ 2 lần chạy (IoU). Người đứng cao hơn rõ so với trung vị chỗ ngồi mà conf `student` < 0.6 được hạ thành `unknown` (không ép thành giám thị). Vai trò được làm mượt theo `trackId` bằng đa số phiếu trong 5 lần chạy gần nhất (hoà thì lấy phiếu mới nhất). Khung không chạy model vai trò giữ vai trò đã làm mượt.

### 12.1. Trường mới trong `detections` (WS `/ws`), `/api/analysis`, `/api/analysis/jobs*`

Mỗi object `cls:"person"` **và** mỗi phần tử `poses[]` có thêm:

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `role` | `"invigilator"` \| `"student"` \| `"unknown"` | `unknown` khi chưa ghép được hoặc model vai trò tắt. |
| `roleConf` | number 0..1 | Trung bình conf của các phiếu thắng (0 khi `unknown`). |
| `label` | string | **Thí sinh: `"Thí sinh #" + trackId`**. Unknown: `"#" + trackId`. Giám thị: `"Giám thị"`. |
| `studentNo` | number \| null | `= trackId` với thí sinh/unknown; `null` với giám thị. |
| `source` | `"role"` (tuỳ chọn) | Chỉ có khi người này lấy từ box vai trò (DET không thấy). |

**Chốt với FE:** số `#N` trên khung **chính là `trackId`**, cùng số trong `alert.trackId` và `alert.message`. Không có đánh số riêng theo vai trò; giám thị không mang số trên nhãn (vẫn có `trackId` để vẽ/khớp). FE (`roles.ts` `personLabel`) kiểm tra `/thí sinh/i` trên `label` nên không nhân đôi chữ "Thí sinh". Cảnh báo (`alert.message`) **không đổi**: vẫn `"… thí sinh #N"` / `"#N"`, không lấy `label`.

Gói `detections` có thêm `roleEnabled: boolean` và `roleCounts: {invigilator, student, unknown}` (đếm người khung này). `GET /api/cameras/{id}/diag` và `camera_status` có thêm `roleEnabled`, `roleInferMs`, `roleEveryN` (N hiện tại sau thích ứng), `roleCounts`.

Ví dụ:

```json
{"id":"person-4","cls":"person","conf":0.912,"bbox":[144.9,281.4,344.2,534.0],"trackId":4,
 "role":"invigilator","roleConf":0.847,"label":"Giám thị","studentNo":null}
{"id":"person-7","cls":"person","conf":0.88,"bbox":[820,210,990,690],"trackId":7,
 "role":"student","roleConf":0.91,"label":"Thí sinh #7","studentNo":7}
```

### 12.2. Quy tắc cảnh báo

- Giám thị bị loại khỏi **mọi** quy tắc dành cho thí sinh (`phone_near_hand`, `phone_in_work_area`, `paper_present`, `calculator_present`). Vật thể mà người gần nhất là giám thị thì không sinh cảnh báo. Các quy tắc "cặp người gần nhau" (nếu thêm sau) dùng `candidate_pairs()`, đã bỏ mọi cặp có giám thị. Hiện BE chưa có quy tắc quay đầu / nói chuyện / gần nhau.
- Người chưa rõ vai trò (`unknown`) vẫn được coi là thí sinh (không bỏ sót cảnh báo).
- Áp dụng giống nhau cho camera trực tiếp, `POST /api/analysis` cũ và `/api/analysis/jobs`.

**Cảnh báo mới (chốt với FE):**

| Trường | Giá trị |
|---|---|
| `type` | `"no_invigilator"` |
| `level` | `"thong_tin"` (Thông tin) |
| `message` | `"Nghi vấn: không thấy giám thị trong phòng"` |
| `trackId` | **`null`** (không bao giờ 0 hay -1) |
| `personBbox` / `objectBbox` / `objectId` | `null` |

Bắn khi model vai trò đang bật và không thấy giám thị nào liên tục `ROOM_NO_INVIGILATOR_SEC` giây (mặc định 120), theo từng camera (hoặc theo thời gian video với phân tích). Lặp lại tối đa mỗi 10 phút nếu vẫn vắng; thấy giám thị thì đếm lại. Ảnh đơn (`/api/analysis` với ảnh) không bắn. Loại này không nằm trong bảng quy tắc `PUT /api/rules` và chưa có trong `perType` của dashboard (giữ hợp đồng cũ). FE cần nhãn hiển thị cho `no_invigilator` trong danh sách cảnh báo.

### 12.3. `GET /api/system/model`

Thêm: `roleEnabled`, `roleModel` (tên file), `roleClasses` (`{"student":"student","teacher":"invigilator"}`), `roleModelNames`, `roleImgSize`, `roleConf`, `roleEveryN`, `roleAdaptive`, `roleInferMs`, `roleError` (lý do khi tắt, ví dụ không tìm thấy file).

## 13. Lượt 2 phóng tay/bàn (điện thoại nhỏ / bị che / dưới gầm bàn)

Model phát hiện điện thoại vẫn là `DET_MODEL` (COCO `yolo26s`, lớp `cell phone` = 67, map thành `cls:"phone"`). `best.pt` vai trò **không** có lớp điện thoại. Model COCO gốc hay bỏ sót điện thoại nhỏ, bị tay che hoặc nằm dưới bàn khi chạy trên cả khung.

Sau DET + pose + vai trò, BE cắt vùng quanh cổ tay thí sinh (hoặc nửa dưới hộp người nếu không thấy cổ tay), gồm cả vùng bàn phía dưới, gom tối đa `PHONE_ZOOM_MAX_CROPS` crop, chạy lại detector **chỉ lớp điện thoại** ở `PHONE_ZOOM_IMG_SIZE` (mặc định 416) với `PHONE_ZOOM_CONF` (mặc định 0.20). Box được đưa về toạ độ khung đầy đủ và NMS-trộn với kết quả khung đầy đủ (`DET_IOU`). Giám thị không bị cắt crop và vẫn bị loại khỏi quy tắc cảnh báo thí sinh.

Biến `.env`: `PHONE_ZOOM=1` (0 = tắt), `PHONE_CONF=0.25` (ngưỡng lớp điện thoại trên khung đầy đủ; predict dùng `min(DET_CONF, PHONE_CONF)`), `PHONE_ZOOM_CONF=0.20`, `PHONE_ZOOM_IMG_SIZE=416`, `PHONE_ZOOM_EVERY_N=2`, `PHONE_ZOOM_ADAPTIVE=1` (tự giãn N, tối đa `PHONE_ZOOM_MAX_EVERY_N=8`), `PHONE_ZOOM_MAX_CROPS=12`, `PHONE_ZOOM_PAD=2.5`, `PHONE_PERSIST_HITS=2`, `PHONE_IMAGE_CONF=0.35`. Máy yếu: `PHONE_ZOOM_EVERY_N=4` hoặc `PHONE_ZOOM=0`.

Đường đi dùng chung cho camera trực tiếp, `POST /api/analysis` và `/api/analysis/jobs`. Ảnh đơn (`sched` zoom = luôn chạy khi bật).

### 13.1. Trường thêm trên object `cls:"phone"` (WS `/ws`, `/api/analysis`, jobs)

| Trường | Kiểu | Ý nghĩa |
|---|---|---|
| `source` | `"zoom"` (tuỳ chọn) | Chỉ có khi điện thoại được tìm thấy ở lượt phóng tay/bàn, không có trên khung đầy đủ. Các trường khác (`cls`, `conf`, `bbox`, `trackId`, `id`) giữ nguyên hợp đồng cũ. |

Hợp đồng cảnh báo **không đổi**: `type` vẫn `phone_near_hand` / `phone_in_work_area`, `level` Cao / Trung bình, `message` bắt đầu bằng `"Nghi vấn: …"`, `trackId` = số `#N` trên khung. Không có loại cảnh báo mới.

Video/camera: điều kiện điện thoại phải xuất hiện đủ `PHONE_PERSIST_HITS` (mặc định 2) khung phân tích **và** đủ `persistSeconds` mới bắn. Ảnh đơn bỏ qua persist thời gian; điện thoại `source:"zoom"` chỉ cảnh báo khi `conf >= PHONE_IMAGE_CONF` (0.35).

### 13.2. `GET /api/system/model`, `GET /api/cameras/{id}/diag`, `camera_status`

Thêm: `phoneZoom` (boolean, đang bật), `phoneZoomInferMs`, `phoneZoomCrops` (số crop lần chạy gần nhất), `phoneZoomEveryN` (N hiện tại sau thích ứng, có trên diag/status), `phoneZoomConf`, `phoneZoomImgSize`, `phoneZoomMaxCrops`, `phoneConf` (có trên `/api/system/model`).

Điện thoại nằm trên bàn, thấy cổ tay nhưng **không gần tay**: không bắn Cao/Trung bình. Cảnh báo mới mức Thông tin:

| Trường | Giá trị |
|---|---|
| `type` | `"phone_on_desk"` |
| `level` | `"thong_tin"` |
| `message` | `"Nghi vấn: điện thoại trên bàn của thí sinh #N"` |
| `trackId` | `trackId` của thí sinh (cùng `#N` trên khung) |

Crop zoom có cạnh nhỏ nhất `PHONE_ZOOM_MIN_CROP=160` (nới rồi để model phóng lên `PHONE_ZOOM_IMG_SIZE`). Người nhỏ/xa được ưu tiên. Nếu DET bỏ sót thí sinh ở nửa xa (nửa trên khung), BE lát thêm ô `PHONE_ZOOM_TILE_SIZE` (mặc định 256, tắt bằng `PHONE_ZOOM_FAR_TILE=0`).
