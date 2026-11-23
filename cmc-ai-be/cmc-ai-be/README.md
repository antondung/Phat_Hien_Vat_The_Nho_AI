# CMC AI – Back-end

Back-end cho hệ thống giám sát hành vi nghi vấn của thí sinh trong phòng thi. Viết bằng FastAPI, bám đúng `API_CONTRACT.md` của FE.

Hợp đồng API mới (webcam DroidCam bản mới, snapshot lưới, WS lưới, DB trống khi khởi động) nằm trong [`API_CHANGES.md`](API_CHANGES.md).

## Chạy nhanh
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # sửa DATASET_DIR cho đúng chỗ giải nén dataset
./run.sh                    # http://localhost:8000 , tài liệu API: /docs
pytest -q                   # chạy test
```
Cần cài `ffmpeg` để xuất clip cảnh báo (.mp4). Trên Windows chỉ cần nhấp `run.bat` (đã có `imageio-ffmpeg`).

Tài khoản đăng nhập (luôn được tạo khi DB trống; **không** kèm camera/cảnh báo mẫu):
- `admin@cmc.edu.vn` / `admin123` (quản trị)
- `giamthi@cmc.edu.vn` / `giamthi123` (giám thị)

### DB trống và xoá dữ liệu demo
Lần chạy đầu (file SQLite chưa có) chỉ seed tài khoản và cấu hình quy tắc mặc định. Không có camera, phòng, cảnh báo, phiên hay thống kê.
Nếu máy còn dữ liệu mẫu cũ, xoá rồi khởi động lại:

```bash
python run.py --reset-data
# Windows: run.bat --reset-data
```

Lệnh này xoá camera, cảnh báo, lịch sử, settings và file trong `data/media/alerts`, `data/media/uploads`; **giữ bảng users**. Sau đó BE khởi động bình thường.
Ngoài ra, mỗi lần start khi `SEED_DEMO` không phải 1, BE **tự gỡ** camera `dataset://` còn sót (và cảnh báo/media của chúng), ghi marker `data_version=3`. Camera webcam/HTTP/phone không bị xoá. Không cần chạy `--reset-data` chỉ để hết CAM 01–08 mẫu.
Muốn có lại 8 camera giả từ dataset: đặt `SEED_DEMO=1` trong `.env` rồi chạy `--reset-data` (hoặc xoá file DB). `SAMPLE_CAMERAS` mặc định `off` — nguồn `dataset://` còn sót cũng không tự chạy.

## Cắm model (anh Dũng tự đấu)
Mặc định `DETECTOR=mock`: chưa cần model. Back-end đọc nhãn gốc của dataset, coi như "model hoàn hảo", nên cả pipeline (camera, tracking, luật, cảnh báo, clip) chạy được ngay để FE ghép.

Để chạy model thật:
1. `pip install ultralytics`
2. Copy `best.pt` (detect 4 lớp: student, phone, paper, calculator) vào `weights/det_best.pt`, và model pose (11 điểm) vào `weights/pose_best.pt`.
3. Trong `.env`, đặt `DETECTOR=yolo`, sau đó chỉnh `DET_CONF`, `IMG_SIZE`, `DEVICE` (ví dụ `0` cho GPU) nếu cần.
4. Muốn trang Model hiện mAP/precision/recall thì trỏ `METRICS_JSON` tới file JSON chứa các chỉ số đó.

Có thể đổi model mà không động vào phần còn lại:
- Mọi thứ đi qua `app/detector.py` (`get_detector()`).
- Detector chỉ cần trả về box (xyxy theo px, tên lớp, độ tin cậy) và pose.
- Pipeline tự map `student` thành `person`, đệm keypoint từ 11 lên 17 cho FE, và gán trackId.

## Camera
- `sourceType`: `rtsp` | `http` | `webcam` | `file` | `phone`.
- `webcam` `sourceUrl`: `webcam://N` (cũ), `webcam://dshow/N`, `webcam://msmf/N`, hoặc theo tên `webcam://dshow/name/DroidCam%20Video` / `webcam://msmf/name/…`. OpenCV `CAP_DSHOW`/`CAP_MSMF` chỉ nhận chỉ số nguyên (không truyền `video=`). Thứ tự mở Windows: cv2 DSHOW → cv2 MSMF (kể cả khi enum MF lỗi, vẫn dò 0..5) → pygrabber sample grabber → ffmpeg dshow. Chỉ cài **một** gói OpenCV (`opencv-python>=4.9`); cài chồng làm hỏng DirectShow.
- `dataset://<tên_video>` là camera giả từ dataset; chỉ được seed khi `SEED_DEMO=1`.
- **Camera đơn:** MJPEG `GET /api/cameras/{id}/stream.mjpg?token=...&fps=15` (thêm `&w=1280` nếu cần thu nhỏ). Dùng trong `<img src>`.
- **Lưới 3×3:** không mở 9 luồng MJPEG (Chrome chỉ ~6 kết nối HTTP/1.1/host → giật cả trang). Dùng `GET /api/cameras/{id}/snapshot.jpg?w=480&token=...` (kéo 2–5 lần/giây) hoặc một WebSocket `/ws/grid?token=...&cams=id1,id2&w=480&fps=5`. Chi tiết trong `API_CHANGES.md`.
- Ảnh snapshot/MJPEG là video gốc, chưa vẽ lớp phủ (FE vẽ từ gói `detections`).

## Realtime
`ws://localhost:8000/ws?token=...`
- Server gửi `{type, data}`, với `type` là `detections`, `alert`, `alert_update` hoặc `camera_status`.
- Client có thể gửi `{"type":"subscribe","cameraIds":["cam-01"]}` để chỉ nhận một số camera.
- Token sai thì kết nối bị đóng với mã 4401.

## Ghi chú hợp đồng
- Toạ độ box và keypoint trong `detections` tính theo px của khung hình.
- `snapshotUrl` và `clipUrl` của cảnh báo là đường dẫn `/media/...`, tính từ gốc server, không nằm dưới `/api`.
- `POST /api/analysis` nhận `file` hoặc `sample=sample-image|sample-video`. Kết quả có thêm `mediaUrl`.
- `POST /api/cameras/test-connection` nhận `{sourceType, sourceUrl}`.
- Lỗi trả về dạng `{"message": "..."}`.
- Mọi nội dung cảnh báo bắt đầu bằng "Nghi vấn: …", với 3 mức Cao / Trung bình / Thông tin. Không kết luận gian lận, không nhận diện danh tính (chỉ dùng trackId `#n`).
- Đọc khung và phân tích chạy ở 2 luồng riêng cho mỗi camera: video giữ đúng tốc độ nguồn, model lấy khung mới nhất theo `DETECT_FPS`.

## Cấu trúc
`app/` gồm:
- `main.py`: các route
- `db.py`: SQLite
- `auth.py`: JWT
- `detector.py`: detector, chỗ cắm model
- `pipeline.py`: chạy model và tracking
- `tracker.py`
- `rules.py`: luật cảnh báo
- `streams.py`: camera, MJPEG, clip
- `analysis.py`: phân tích ảnh/video tải lên
- `realtime.py`: WebSocket
- `seed.py`: tài khoản + quy tắc (camera mẫu chỉ khi `SEED_DEMO=1`)
- `webcams.py`: liệt kê/mở webcam Windows (DirectShow + Media Foundation) và Linux

## Quy ước keypoint (pose)
- `keypoints` luôn có đúng 17 phần tử `[x, y, v]`, theo thứ tự COCO: 0 mũi, 1 mắt trái, 2 mắt phải, 3 tai trái, 4 tai phải, 5 vai trái, 6 vai phải, 7 khuỷu trái, 8 khuỷu phải, 9 cổ tay trái, 10 cổ tay phải, 11 hông trái, 12 hông phải, 13 gối trái, 14 gối phải, 15 cổ chân trái, 16 cổ chân phải.
- `x`, `y` là px của khung hình. `v` là độ tin cậy từ 0 đến 1.
- Nếu `v = 0` (hoặc `x = y = 0`) thì điểm đó bị che hoặc không có. FE không vẽ điểm đó và không vẽ cạnh nối tới nó.
- Dataset hiện chỉ có 11 điểm (0–10), nên BE luôn trả các điểm 11–16 là `[0, 0, 0]`. Sau này model trả 11 hay 17 điểm thì BE vẫn chuẩn hoá về 17, hợp đồng không đổi.

## Cập nhật 09/11
- Thống kê theo giờ Việt Nam (`TZ` mặc định `Asia/Ho_Chi_Minh`).
- WebSocket nhận kết nối trước rồi mới đóng với mã 4401 nếu token sai, nên trình duyệt nhận đúng mã 4401.
- Webcam nhận `0`, `webcam://0` hoặc `/dev/video0`.
- Sửa người dùng sang email trùng thì trả 409.
- `clipUrl` của cảnh báo mới là `null`. Khi ghép clip xong (khoảng 3–5 giây), BE đẩy `alert_update` kèm `clipUrl`, và file chỉ xuất hiện khi đã ghi xong.
- Tracker ghép theo IoU và khoảng cách tâm, nhớ vị trí chỗ ngồi khoảng 25 phút khi mất dấu, nên mỗi camera chỉ có số trackId xấp xỉ số chỗ ngồi.
- Mặc định mỗi phòng cho phép giấy (giấy làm bài là bình thường), không cho phép máy tính cầm tay. Cảnh báo mức "Thông tin" chỉ báo 1 lần cho mỗi thí sinh trong 10 phút.
- `personBbox`/`objectBbox` trong alert vẫn chuẩn hoá về 0–1 (để vẽ lên snapshot đã thu nhỏ). Toạ độ trong `detections` là px.

## Bản demo với model thật (09/11 tối)
- File `.env` đang để `DETECTOR=yolo`, dùng tạm model gốc `weights/yolo26s.pt` và `weights/yolo26s-pose.pt` (bản COCO). Model này nhận ra người, điện thoại và 17 điểm khung xương, nhưng chưa nhận ra giấy hay máy tính.
- Máy không có GPU nên `.env` đặt `IMG_SIZE=640`, `DETECT_FPS=1` để 8 camera vẫn chạy đều (mỗi camera chạy model khoảng 1 khung/giây).
- Khi có `best.pt` của anh Dũng: chép 2 file vào `weights/`, sửa `DET_MODEL`/`POSE_MODEL`, rồi bật `METRICS_JSON=weights/metrics_dung.json` để trang Model hiện đúng chỉ số train. Có GPU thì đặt `DEVICE=0`, `IMG_SIZE=960`, `DETECT_FPS=5`.
- `CLASS_CONF` đặt ngưỡng riêng cho từng lớp. Mặc định `paper` và `calculator` là 0.5 để bớt báo nhầm.

## Camera điện thoại (demo thời gian thực, cập nhật 10/11)
- Tạo camera với `sourceType: "phone"` và `sourceUrl` để trống (hoặc `"push"`).
- Điện thoại đẩy hình qua WebSocket `ws(s)://<BE>/ws/cameras/{cameraId}/push?token=<JWT>`, mỗi message nhị phân là 1 khung JPEG (nên dùng ~5 khung/giây, rộng 640–960px). Cứ 10 khung BE trả `{"type":"ack","received":n}`.
- Dự phòng khi không mở được WebSocket: `POST /api/cameras/{cameraId}/frame` với body `image/jpeg` (trả 204).
- Camera online khi có khung trong 5 giây gần nhất, quá 5 giây thì chuyển offline. Video MJPEG, detections, cảnh báo và clip chạy y như camera thường.
- `POST /api/cameras/test-connection` với `{sourceType:"phone", cameraId}` cho biết có đang nhận hình không.
- Trình duyệt điện thoại chỉ cho mở camera trên HTTPS (hoặc localhost). Có thể đặt `SSL_CERTFILE` và `SSL_KEYFILE` trong `.env` để `run.sh` chạy BE bằng HTTPS, hoặc để FE (Vite HTTPS) proxy sang BE.
- Tab Quét QR: `POST /api/cameras/phone` (admin, body tuỳ chọn `{name, room}`) tạo camera "ĐT · CAM NN" và trả `{camera, pushToken, pushPath, expiresInSec}`. `pushToken` chỉ dùng được để đẩy hình vào đúng camera đó (gọi API khác sẽ bị 401), hạn `PHONE_TOKEN_HOURS` (mặc định 4 giờ).
- Tab IP Webcam / DroidCam qua Wi-Fi hoặc `adb forward`: tạo camera `sourceType: "rtsp"` với `sourceUrl` là `http://IP:8080/video` hoặc `http://IP:4747/video`. BE đọc MJPEG qua HTTP, chỉ giữ khung mới nhất.
- Tab cắm dây USB: `GET /api/sources/webcams` (mảng) kèm `backend`, `url`, `urlByName`, `hasPicture` (**chỉ gợi ý, không chặn Lưu**). `?debug=1` trả `{devices, hint}` (mean/std/shape/dtype/time/error). CLI: `python -m app.webcams`. **DroidCam Video** trên DirectShow được xếp lên đầu; trùng tên thì gộp, ưu tiên backend có hình. Không liệt kê micro/audio, không bịa Webcam 4/5. Nếu mọi thiết bị đen/không mở được, `hint` hướng dẫn bật quyền Camera của Windows. Xem `API_CHANGES.md`.
- Sự kiện `detections` có thêm `frameTs` (lúc BE nhận khung) và `serverTs` (lúc phân tích xong), đơn vị ms.
- Demo 1 camera: `.env` đặt `SAMPLE_CAMERAS=off` để không chạy 8 camera mẫu, cùng `DETECT_FPS=8`. Đo trên CPU: khoảng 4,5 lần phân tích/giây, trễ phân tích 0,1–0,3 giây.

## Chạy trên Windows (máy của anh Dũng)
1. Cài Python 3.10–3.12 từ python.org, nhớ tick "Add python.exe to PATH".
2. Giải nén BE, nhấp đúp `run.bat`. Lần đầu nó tự tạo `.venv`, cài thư viện (kèm `ultralytics`, `pygrabber` để đọc tên và lấy khung DirectShow khi OpenCV hỏng, `imageio-ffmpeg` để ghép clip / đọc dshow, nên không cần cài ffmpeg riêng) và tải model gốc. Những lần sau chỉ việc nhấp đúp lại.
   Muốn chạy tay trong PowerShell: `py -3 -m venv .venv`, `.venv\Scripts\python -m pip install -r requirements.txt ultralytics pygrabber`, rồi `.venv\Scripts\python run.py`.
   Dùng Python hệ thống (không `.venv`): `run.bat --system`, hoặc `python run.py` / `python -m app.webcams`. Khi start, BE in phiên bản Python, `cv2`, các gói `opencv*` và backend videoio; nếu cài chồng nhiều gói OpenCV sẽ có cảnh báo (DirectShow sẽ hỏng).
3. `run.py` tự đọc `.env`, chạy được trên mọi hệ điều hành. `run.sh` chỉ dành cho Linux/macOS.
4. Webcam trên Windows: BE liệt kê cả DirectShow và Media Foundation (DroidCam bản mới tạo webcam ảo **DroidCam Video**, thường là thiết bị MF mà DirectShow không thấy). FE nên dùng `url` hoặc `urlByName` từ `GET /api/sources/webcams`, không gắn cứng `webcam://0`. `webcam://0` vẫn chạy (thử DSHOW rồi MSMF). **DroidCam Source 1** là thiết bị của bản Classic — thường chỉ ra khung xanh, không dùng.
5. Tường lửa: lần đầu chạy, Windows hỏi thì bấm "Allow access". Nếu điện thoại kết nối qua Wi-Fi mà không vào được, mở PowerShell bằng quyền Admin và chạy:
   `netsh advfirewall firewall add rule name="CMC AI" dir=in action=allow protocol=TCP localport=8000,5173`
   Cắm dây USB (DroidCam) thì không cần bước này.
6. Đường dẫn trong `.env` để dạng tương đối (`weights/...`). Nếu dùng đường dẫn tuyệt đối thì ghi kiểu `C:/Users/.../best.pt`.
7. iPhone cắm dây vào Windows: cài app Apple Devices (hoặc iTunes) để Windows nhận máy, rồi cài DroidCam trên iPhone và DroidCam Client trên Windows.

## DroidCam bản mới (iPhone + Windows)
- Để Client DroidCam (giao diện kiểu OBS, có Sources / Start Virtual Camera) **mở**, iPhone đang hiện hình.
- Trong CMC AI chọn thiết bị **DroidCam Video** (`webcam://msmf/...` hoặc `webcam://dshow/name/DroidCam%20Video`). Không chọn **DroidCam Source 1**.
- Nếu danh sách không có "DroidCam Video", bật Virtual Camera trong menu DroidCam Client rồi bấm Làm mới.
- Cách Wi-Fi (bỏ qua webcam ảo, thường ổn định hơn): tắt DroidCam Client, iPhone và laptop cùng Wi-Fi, tạo camera HTTP `http://<IP trên app>:4747/video`. Đóng mọi tab đang xem địa chỉ đó trước khi bấm Kiểm tra (DroidCam chỉ cho 1 client). BE tự kết nối lại khi mất luồng, và `test-connection` đóng nguồn ngay sau khi đọc vài khung.

## Model đang chạy
- Lúc khởi động BE in ra file `.pt` detect/pose, danh sách lớp (có `'cell phone'` hay không), device, imgsz, conf, iou. Nếu thiếu file đã cấu hình thì in **WARNING** và `fallback`.
- `GET /api/system/model` (cần đăng nhập) trả `{detModel, poseModel, classes, device, imgSize, conf, iou, detectFps, fallback}`.
- Khung webcam gửi vào YOLO ở định dạng BGR (OpenCV); box trả về theo kích thước khung gốc (không phải 640). `camera_status` có thêm `detectFps`.

## Chẩn đoán và dọn dữ liệu (bản 10/11 tối)

- Lần chạy đầu với `SEED_DEMO=0` sau bản này (`data_version=3`) xoá hết cảnh báo/media/upload còn sót, kể cả cảnh báo cũ của camera người dùng; lần sau không xoá cảnh báo mới. Camera điện thoại/webcam đã thêm được giữ. Tài khoản giữ nguyên.
- `GET /api/cameras/{id}/diag` và `camera_status` có `framesRead`, `analysedFrames`, `detectFps`, `lastDetectTs`, `lastObjects`, `inferMs`, `lastError`, `detector`.
- Gói `detections` có `cameraId`, `frameTs`, `frameW`, `frameH`; toạ độ là pixel của khung nguồn `frameW×frameH`.
- Máy Windows yếu: xem comment trong `.env` (yolo26n, imgsz 480, `POSE_EVERY_N=2`). Mặc định không đổi.


## Phân tích streaming (màn Phân tích)

- `POST /api/analysis` cũ vẫn đồng bộ, trả hết frames/alerts một lần.
- Màn mới: `POST /api/analysis/jobs` (file hoặc `sample=sample-video|sample-image`) trả ngay `{jobId, mediaUrl, width, height, fps, duration, …}`. Phân tích chạy nền, **một job tại một thời điểm** (các job sau `queued`). FE huỷ bằng `DELETE /api/analysis/jobs/{jobId}` — job mới không tự huỷ job cũ.
- Tiến độ: `WS /ws/analysis/{jobId}?token=…` (phát lại kết quả đã có, rồi lô ~0.5–1 s, cuối cùng `done`/`error`) hoặc `GET /api/analysis/jobs/{jobId}?since=`.
- `mediaUrl` (`/media/jobs/…`) phát bằng `<video>`, hỗ trợ HTTP Range, không cần JWT (như các file `/media` khác).
- Cùng model, quy tắc và cách viết "Nghi vấn: …" với `/api/analysis`. Chi tiết hợp đồng: `API_CHANGES.md` mục 11.

## Giám thị / thí sinh (bản 12/11)
- Model vai trò: YOLO26m của bài TSII, 2 lớp `student` / `teacher`. File `.pt` **không** nằm trong zip.
- Cách bật: chép file `best.pt` của anh vào `weights/role_best.pt`. Trong `.env` đã có sẵn `ROLE_MODEL=weights/role_best.pt` (tên khác thì sửa dòng này), rồi khởi động lại BE (`run.bat`). Log khởi động có dòng `[roles] ROLE_MODEL: … names={0: 'student', 1: 'teacher'}`.
- Thiếu file hoặc lỗi load: BE chỉ in `WARNING: [roles] …` và chạy tiếp, mọi người `role: unknown`. Muốn tắt hẳn: `ROLE_MODEL=` (để trống).
- Trên khung: thí sinh ghi `#<trackId>` (cùng số trong cảnh báo), giám thị ghi `Giám thị`. Giám thị không bao giờ bị cảnh báo thí sinh.
- Cảnh báo Thông tin mới: `Nghi vấn: không thấy giám thị trong phòng` khi 120 giây không thấy giám thị (`ROOM_NO_INVIGILATOR_SEC`, 0 = tắt).
- Máy yếu: `ROLE_IMG_SIZE=416`, `ROLE_EVERY_N=5` (mặc định 480 và 3, `ROLE_ADAPTIVE=1` tự giãn khi CPU chậm). Chi tiết trong `API_CHANGES.md` mục 12.

## Điện thoại nhỏ / bị che (lượt 2 phóng tay/bàn, bản 12/11)
- Sau khi nhận diện khung đầy đủ, BE cắt vùng quanh tay/bàn của thí sinh và chạy lại model chỉ lớp điện thoại (imgsz 416, conf 0.20) rồi trộn kết quả. Box tìm được ở lượt này có `source:"zoom"`.
- Mặc định bật (`PHONE_ZOOM=1`). Tắt: `PHONE_ZOOM=0`. Máy yếu: `PHONE_ZOOM_EVERY_N=4` hoặc tắt hẳn.
- Cảnh báo vẫn cần điện thoại gần tay mới ra mức Cao. Điện thoại nằm trên bàn, không gần tay: mức Thông tin, `type: phone_on_desk` (`Nghi vấn: điện thoại trên bàn của thí sinh #N`). Video phải thấy đủ 2 khung phân tích (cộng `persistSeconds`). Ảnh đơn: zoom chỉ cảnh báo khi conf ≥ 0.35 (`PHONE_IMAGE_CONF`).
- Crop zoom tối thiểu 160 px (người xa được nới rồi phóng lên 416). Nếu DET bỏ sót người ở nửa xa, BE lát thêm ô 256 px.
- Giám thị không bị cắt crop và không bị cảnh báo thí sinh. Chi tiết trong `API_CHANGES.md` mục 13.

