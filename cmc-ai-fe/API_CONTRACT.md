# API_CONTRACT — CMC AI (khớp backend `cmc-ai-be`, kiểm chứng lại ngày 09/11/2026 sau bản sửa BE lúc ~10:55 UTC+7)

> Tài liệu mô tả **đúng những gì backend FastAPI hiện trả về** (đã kiểm tra bằng curl, WebSocket và smoke test đầu-cuối),
> kèm các điểm còn cần lưu ý (đánh dấu ⚠️). Kiểu dữ liệu phía FE: `src/types/index.ts`. Bộ chuyển đổi: `src/services/http/`.

## 0. Kết nối
| | Giá trị | Ghi chú |
|---|---|---|
| REST | `/api` | Qua proxy của Vite → `http://localhost:8000/api`. Đổi bằng `VITE_API_BASE_URL`. |
| WebSocket | `/ws?token=<JWT>` | Qua proxy → `ws://localhost:8000/ws`. Đổi bằng `VITE_WS_URL`. |
| Tệp media | `/media/...` | Ảnh chụp, clip, tệp đã phân tích. **Tính từ gốc server, không nằm dưới `/api`.** |
| Xác thực | `Authorization: Bearer <JWT>` | Riêng luồng MJPEG / ảnh tĩnh (dùng trong `<img>`) truyền `?token=<JWT>`. JWT hết hạn sau 12 giờ. |
| Lỗi | `{"message": "..."}` | Mã 400/401/403/404/409. ⚠️ Lỗi 500 trả text thuần, FE hiện “Máy chủ gặp lỗi (500)”. |

Tài khoản mẫu: `admin@cmc.edu.vn / admin123` (admin) · `giamthi@cmc.edu.vn / giamthi123` (giám thị).

## 1. REST
| Method | Path | Quyền | Body / Query → Kết quả |
|---|---|---|---|
| POST | `/auth/login` | — | `{email, password}` → `{token, user}`. Sai: 401 “Email hoặc mật khẩu không đúng”; bị khoá: 403. |
| GET | `/auth/me` | đăng nhập | → `{token, user}` (401 nếu token hỏng/hết hạn/user bị xoá). |
| GET | `/cameras` | đăng nhập | → `Camera[]` sắp theo id. |
| POST | `/cameras` | admin | `{name, room, position, sourceType, sourceUrl, enabled}` → `Camera` (id `cam-xxxxxx`). |
| PATCH | `/cameras/{id}` | admin | một phần các trường trên → `Camera`. Đổi nguồn thì luồng tự khởi động lại. |
| DELETE | `/cameras/{id}` | admin | → 204. |
| POST | `/cameras/test-connection` | đăng nhập | `{sourceType, sourceUrl}` → `{ok, message, latencyMs?, resolution?, fps?}` (lỗi kết nối vẫn trả 200 với `ok:false`). |
| GET | `/cameras/status` | đăng nhập | → `CameraStatus[]` `{cameraId, online, fps, latencyMs, updatedAt}`. |
| GET | `/cameras/{id}/stream.mjpg?token=&fps=15` | đăng nhập | Video gốc MJPEG (`multipart/x-mixed-replace`), khung đã thu về rộng tối đa **1280 px**. 404 nếu camera không chạy. |
| GET | `/cameras/{id}/snapshot.jpg?token=` | đăng nhập | Ảnh JPEG mới nhất (1280 px). 404 nếu chưa có khung hình. |
| GET | `/alerts?cameraId&room&type&level&status&from&to&q&page&pageSize` | đăng nhập | → `{items, total, page, pageSize}`; mới nhất trước; `from`/`to` là epoch ms (bao gồm hai đầu); `pageSize` ≤ 200. |
| GET | `/alerts/recent?limit=5` | đăng nhập | → `Alert[]` (≤ 100). |
| GET | `/alerts/{id}` | đăng nhập | → `Alert` (404 nếu không có). |
| PATCH | `/alerts/{id}` | đăng nhập | `{status: "moi"|"xac_nhan"|"bo_qua", note?}` → `Alert` có `handledBy` (tên người xử lý), `handledAt`. Phát `alert_update` qua WS. |
| GET / PUT | `/rules` | GET: đăng nhập · PUT: admin | `RulesSettings` `{rules[4], rooms[], dedupeCooldownSeconds}`. |
| POST | `/rules/reset` | admin | → luật mặc định; mỗi phòng có camera = `{allowPaper: true, allowCalculator: false}` (dùng chung hàm mặc định với seed). |
| GET / POST | `/users` | admin | POST `{name, email, password, role, active}` → `User` (409 nếu trùng email). |
| PATCH / DELETE | `/users/{id}` | admin | PATCH không gửi `password` = giữ mật khẩu cũ. PATCH đổi sang email đã có → **409** `"Email đã tồn tại"`. Không xoá được chính mình (400). |
| GET | `/stats/dashboard` | đăng nhập | `DashboardStats`, tính theo giờ Việt Nam. Xem mục 6. |
| GET | `/models` | đăng nhập | `ModelInfo[]` (detector + pose). Model gốc COCO (demo): `metrics: []`, `perClass: null`, `fps: 0` → FE ghi “Chưa có chỉ số đánh giá” / “Chưa có số đo”, không bịa số. |
| POST | `/analysis` | đăng nhập | multipart: `file` **hoặc** `sample=sample-image|sample-video` → `AnalysisResult` + **`mediaUrl`**. |
| GET | `/health` | — | `{ok, detector, cameras}`. |

### Camera
```json
{ "id": "cam-01", "name": "CAM 01", "room": "P.202", "position": "truoc",
  "sourceType": "file", "sourceUrl": "dataset://VPC2_202_1008", "enabled": true, "createdAt": 1794194420641 }
```
`sourceType`: `rtsp` (`rtsp://...` hoặc `http(s)://.../video`) · `http` (luồng HTTP, BE cũng nhận) · `webcam` (`sourceUrl` = thiết bị **trên máy chủ**: `"0"`, `"webcam://0"` hoặc `"/dev/video0"` đều được) · `file` (đường dẫn video trên máy chủ, phát lặp).
`dataset://<tên video>` = camera giả phát lại ảnh của một video trong dataset (2 khung/giây); 8 camera seed sẵn đều dùng loại này.
Form FE gửi thẳng `webcam://0` (BE tự bỏ tiền tố). Không mở được thiết bị → `test-connection` trả `{ok:false, message}`, BE không bị treo.

## 2. WebSocket `/ws?token=<JWT>`
Gói tin server → client: `{"type": ..., "data": ...}`
| type | data | Khi nào |
|---|---|---|
| `camera_status` | `CameraStatus[]` | ngay khi kết nối, sau đó mỗi 2 giây |
| `detections` | `DetectionFrame` | mỗi khung đã chạy model (camera dataset: 2 khung/giây/camera) |
| `alert` | `Alert` | cảnh báo mới |
| `alert_update` | `Alert` (đủ trường) | clip đã ghép xong (`clipUrl` có giá trị) **hoặc** đổi trạng thái (xác nhận / bỏ qua / mở lại) |

Client → server (tuỳ chọn): `{"type":"subscribe","cameraIds":["cam-01"]}` chỉ nhận `detections` của các camera đó
(`null` = tất cả). Cảnh báo và trạng thái camera luôn được gửi đủ. FE hiện nhận tất cả (lưới cần mọi camera).

**Token không hợp lệ:** backend `accept` rồi đóng với mã **`4401`** (“Token không hợp lệ”) → FE đăng xuất ngay về trang đăng nhập.
Dự phòng: nếu kết nối đóng khi chưa mở được (rớt mạng, proxy lỗi) → FE gọi `GET /auth/me`; 401 → đăng xuất, còn lại → nối lại với
backoff 1s, 2s, 4s… tối đa 15s.

## 3. Khung phát hiện — `detections`
- `coord` luôn là `"px"`; `bbox = [x1, y1, x2, y2]` theo **pixel của khung gốc** `width × height` (dataset: 1920×1080).
  Video MJPEG/ảnh tĩnh chỉ rộng 1280 px → FE luôn quy đổi theo `width/height` trong gói tin, không theo kích thước ảnh.
- `cls` ∈ `person | phone | paper | calculator` (dataset gắn `student` → BE đổi thành `person`; `cell phone` → `phone`).
- `id`: `person-<trackId>`, vật thể `<cls>-<trackId gần nhất>-<n>`; `trackId` của vật thể = thí sinh gần nhất.
- **Tần suất:** 1 gói / lần model chạy xong (YOLO trên CPU: đo được ~1,1–1,3 gói/giây/camera). FE đo tốc độ này từ chính các gói
  (cửa sổ trượt ~5 giây) và hiện “Phân tích ~N khung/giây”; lớp phủ luôn giữ gói mới nhất, quá 3 giây không có gói mới thì vẽ mờ 40%.
  `CameraStatus.fps` (tốc độ đọc nguồn) không còn hiển thị trên ô camera.
- **Video gốc độc lập với phân tích** (BE 21:55 ngày 09/11): mỗi camera có luồng đọc khung riêng, luồng phân tích lấy khung mới nhất
  theo `DETECT_FPS`. Đo 10 giây: MJPEG 2,1 ảnh/giây, `snapshot.jpg` 2,0–2,1 ảnh/giây (camera dataset 2 khung/giây), `detections`
  0,9–1,0 gói/giây/camera. Lưới FE lấy `snapshot.jpg` mỗi 0,5 giây cho khớp 2 khung/giây.
- `points` (tuỳ chọn) chỉ có khi model OBB; nếu có FE vẽ theo `points`.
```json
{
  "type": "detections",
  "data": {
    "cameraId": "cam-01", "frameId": 502, "ts": 1794194671352, "width": 1920, "height": 1080, "coord": "px",
    "objects": [
      { "id": "person-206", "cls": "person", "conf": 1.0, "bbox": [961.7, 730, 1387.2, 1070.8], "trackId": 206 },
      { "id": "phone-206-1", "cls": "phone", "conf": 1.0, "bbox": [1100, 900, 1150, 960], "trackId": 206 }
    ],
    "poses": [
      { "trackId": 206, "conf": 1.0, "bbox": [961.7, 730, 1387.2, 1070.8],
        "keypoints": [[1066,833,1],[1072,820,1],[0,0,0],[1103,850,1],[1188,840,1],[1057,994,1],[1283,982,1],
                      [0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]] }
    ]
  }
}
```

## 4. Khung xương (pose) — 17 điểm COCO `[x, y, v]`
| Chỉ số | Điểm | Chỉ số | Điểm |
|---|---|---|---|
| 0 | mũi | 9 | **cổ tay trái** |
| 1 / 2 | mắt trái / phải | 10 | **cổ tay phải** |
| 3 / 4 | tai trái / phải | 11 / 12 | hông trái / phải |
| 5 / 6 | vai trái / phải | 13 / 14 | gối trái / phải |
| 7 / 8 | khuỷu trái / phải | 15 / 16 | cổ chân trái / phải |

- `x, y`: pixel của khung gốc. `v`: độ tin cậy 0..1 (mock: 1 = thấy rõ, 0,5 = bị che nhưng có nhãn, 0 = không có).
- **Quy tắc vẽ:** `v = 0` (hoặc `x = y = 0`) = không có điểm → **không vẽ điểm đó và không vẽ cạnh nào nối tới nó**.
  FE còn bỏ qua điểm có `v < 0,3`.
- Mảng **luôn đủ 17 phần tử**. Dataset hiện chỉ gắn 11 điểm (0–10) nên 11–16 luôn là `[0,0,0]` → FE chỉ vẽ **phần thân trên**
  (đầu, vai, khuỷu, cổ tay). Khi có model 17 điểm thật, FE tự vẽ đủ mà không cần sửa.
- Cạnh nối (COCO): 0-1, 0-2, 1-3, 2-4, 5-6, 5-7, 7-9, 6-8, 8-10, 5-11, 6-12, 11-12, 11-13, 13-15, 12-14, 14-16.
- Luật “gần tay” dùng cổ tay 9/10 với `v ≥ 0,3`.

## 5. Cảnh báo — `alert` / `alert_update`
- `level`: `cao` (ĐT gần tay) · `trung_binh` (ĐT trong vùng làm bài) · `thong_tin` (giấy / máy tính).
- `message` (BE tạo, FE hiện nguyên văn) **luôn bắt đầu bằng “Nghi vấn: …”**: `cao` “Nghi vấn: điện thoại gần tay thí sinh #N” ·
  `trung_binh` “Nghi vấn: điện thoại trong vùng làm bài của #N” · `thong_tin` “Nghi vấn: có giấy/tài liệu | máy tính cầm tay tại chỗ #N”.
  Chỉ 3 mức: Cao / Trung bình / Thông tin.
- `PATCH /alerts/{id}` luôn ghi `handledBy/handledAt` (kể cả khi trả về `moi`); FE chỉ hiện người xử lý khi trạng thái khác `moi`.
- `status`: `moi | xac_nhan | bo_qua`. Thí sinh chỉ định danh bằng `trackId` (`#n`), không có tên. Hệ thống chỉ đưa ra **nghi vấn**.
- `personBbox`, `objectBbox`: **chuẩn hoá 0..1** (khác với `detections` là pixel) — BE giữ nguyên quy ước này.
- `snapshotUrl` (JPEG 1280 px, không vẽ khung) có ngay. `clipUrl` (MP4 H.264, −4s → +3s, không vẽ khung):
  gói `alert` mới luôn có **`clipUrl: null`** (đang ghép). Khi ghép xong (~3–5 giây, đo được 3,3–5,4 giây) BE ghi tệp xong rồi mới đẩy
  `alert_update` mang `clipUrl` → FE hiện ảnh chụp + “Đang tạo clip…”, **không gọi tệp .mp4** cho tới khi nhận `alert_update`,
  rồi tự chuyển sang phát clip. Sau 60 giây vẫn chưa có thì ghi “Chưa có clip… – đang hiện ảnh chụp”.
  `GET /alerts` trả `clipUrl` hiện tại (null nếu chưa ghép xong).
```json
{
  "type": "alert",
  "data": {
    "id": "al-20261109-124b10", "cameraId": "cam-07", "cameraName": "CAM 07", "room": "P.603",
    "type": "phone_in_work_area", "level": "trung_binh", "status": "moi",
    "trackId": 88, "objectId": "phone-88-2", "confidence": 1.0,
    "ts": 1794194638403, "startedAt": 1794194634401,
    "message": "Cần chú ý: điện thoại trong vùng làm bài của #88",
    "personBbox": [0.593, 0.642, 0.798, 0.996], "objectBbox": [0.565, 0.800, 0.617, 0.888],
    "snapshotUrl": "/media/alerts/al-20261109-124b10.jpg", "clipUrl": null
  }
}
```
Luật (BE `rules.py`, giống `ruleEngine.ts` của mock): bắn khi tình huống kéo dài ≥ `persistSeconds`; không lặp cùng `type|trackId`
trong `dedupeCooldownSeconds`; “gần tay” = khoảng cách tâm điện thoại → cổ tay / chiều cao khung người ≤ `nearHandThreshold`;
phòng cho phép giấy/máy tính thì không cảnh báo loại đó; phòng **không có trong `rooms`** = không cho phép.
Mặc định phòng (seed): `allowPaper: true`, `allowCalculator: false`. Cảnh báo mức `thong_tin` chỉ bắn **1 lần / thí sinh (`type|trackId`)
/ 10 phút** (dài hơn `dedupeCooldownSeconds`).
Tracker BE: ghép theo vị trí chỗ ngồi (IoU + khoảng cách tâm, camera cố định) và nhớ mã của chỗ đã mất dấu ~25 phút
(3000 khung ở 2 khung/giây) → thí sinh rời khung rồi quay lại vẫn giữ `trackId` cũ. Đo trên BE: 202 `trackId` trong 40 giây, 241 sau 5 phút
(8 camera, ~16 người/khung) → số ID gần như đứng yên; chống trùng theo `trackId` giờ có tác dụng.
Lưu ý: khởi động lại BE thì đánh số lại từ đầu.

## 6. Thống kê — `/stats/dashboard`
Trả `{camerasRunning, camerasTotal, alertsToday, confirmedToday, dismissedToday, trend, spark, perHour[07h..18h], perType}`.
Backend tính “hôm nay”, 7 ngày và theo giờ bằng **giờ Việt Nam (Asia/Ho_Chi_Minh)** → FE dùng thẳng, không tự tính lại.
(Kiểm chứng: `alertsToday` và `perHour` khớp với tính lại từ `/alerts` theo giờ VN.)

## 7. Phân tích — `POST /analysis`
```json
{ "id": "an-1a2b3c4d", "fileName": "VPC2_202_1308_00248.jpg", "mediaType": "image", "width": 1920, "height": 1080,
  "coord": "px", "duration": 0, "fps": 0, "model": { "detector": "Mock (nhãn gốc dataset)", "pose": "Mock pose (nhãn gốc dataset)" },
  "frames": [ { "t": 0, "objects": [ ... ], "poses": [ ... ] } ],
  "alerts": [ { "id": "aa-...", "t": 0, "type": "phone_near_hand", "level": "cao", "trackId": 4, "objectId": "phone-4-1",
               "confidence": 1.0, "message": "Nghi vấn: điện thoại gần tay thí sinh #4" } ],
  "createdAt": 1794195000000, "mediaUrl": "/media/uploads/3f9a1c2b7d.jpg" }
```
- FE hiển thị `mediaUrl` (đúng tệp mà toạ độ tham chiếu) dưới lớp phủ.
- Video: `frames[].t` cách nhau theo `ANALYSIS_FPS` (mặc định 5 khung/giây, video mẫu 2 khung/giây) → FE chọn khung có `t` gần nhất.
- ⚠️ Detector mock chỉ có kết quả khi tên tệp ảnh trùng tên ảnh trong dataset (vd `VPC2_202_1308_00248.jpg`); ảnh/video khác trả 0 phát hiện.

## 8. Camera điện thoại và độ trễ (kiểm chứng trên BE chạy ngày 10/11/2026)

**Không có** `/api/demo-mode` và không có “Chế độ demo” trên FE. Buổi demo dùng 1 camera: tắt 8 camera mẫu bằng nút bật/tắt sẵn có, hoặc đặt `SAMPLE_CAMERAS=off` trên backend để không khởi động các nguồn `dataset://`.

### Độ trễ
Mỗi gói `detections` có thêm:
- `frameTs` (ms): lúc khung được đọc/nhận
- `serverTs` (ms): lúc máy chủ xong phân tích
- `ts` = `frameTs` (giữ tương thích)

FE hiện **“Trễ … giây”** trên Camera đơn = thời điểm trình duyệt − `frameTs` (phẩy thập phân tiếng Việt, ví dụ “Trễ 0,8 giây”).

### Webcam trên máy chạy BE — đã có
`GET /api/sources/webcams` (cần đăng nhập) →
```json
[{ "index": 0, "name": "DroidCam Source 1", "url": "webcam://0", "width": 1280, "height": 720, "inUse": false }]
```
Thiết bị đang được một camera dùng thì có `inUse: true` và có thể không có `width`/`height`. FE dùng danh sách này ở tab “Cắm dây USB”; nếu API thiếu (404) thì hiện bộ chọn `webcam://0`…`webcam://3` và gọi `POST /api/cameras/test-connection`.

### Luồng HTTP/RTSP — đã có
`POST /api/cameras` với `sourceType: "rtsp"` hoặc `"http"` và `sourceUrl` là `rtsp://…` hoặc `http(s)://…/video` (IP Webcam, DroidCam MJPEG). Backend mở bằng OpenCV/FFmpeg. Tab “Nhập địa chỉ” có nút điền `http://localhost:8080/video` (sau `adb forward tcp:8080 tcp:8080` trên **cùng máy chạy BE**).

### Đẩy hình từ điện thoại (tab Quét mã QR) — đã có
- `POST /api/cameras/phone` (admin) body tuỳ chọn `{name, room, position}` →
  `{ camera, pushToken, pushPath: "/ws/cameras/{id}/push?token=…", expiresInSec }`
  (`sourceType: "phone"`, `sourceUrl` rỗng/`"push"`). Token chỉ có scope `push:{id}`, mặc định 4 giờ (`PHONE_TOKEN_HOURS`).
- Điện thoại mở `https://<host-FE>/dt?c={id}&t={pushToken}`, gửi JPEG:
  - WebSocket `ws(s)://<host>/ws/cameras/{id}/push?token=…` (mỗi message = 1 khung JPEG, ~5 khung/giây, rộng 640–960). Cứ 10 khung BE trả `{type:"ack", received:n}`.
  - Dự phòng: `POST /api/cameras/{id}/frame?token=…` body `image/jpeg` → 204.
- Camera online khi có khung trong 5 giây gần nhất.

### Đề xuất bổ sung (chưa có trên BE, FE đang làm việc không cần)
1. `POST /api/cameras/preview` `{sourceType, sourceUrl}` → JPEG một khung, để tab USB/địa chỉ xem trước **trên máy chạy BE** (hiện FE chỉ xem trước được khi webcam cũng hiện trên máy mở trình duyệt, hoặc hiện kết quả “Kiểm tra”).
2. `POST /api/cameras/{id}/phone-token` (admin) → cấp lại `pushToken` cho camera điện thoại đã có, để không phải tạo camera mới khi mã QR hết hạn.
3. `list_webcams` trên Windows nên trả tên thân thiện từ DirectShow (hiện code đọc `/sys/class/video4linux`, trên Windows `name` có thể chỉ là “Webcam 0”).
