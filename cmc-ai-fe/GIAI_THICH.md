# Giải thích mã nguồn — CMC AI (Front-end)

Đề tài: **Hệ thống giám sát hành vi gian lận của thí sinh trong phòng thi bằng AI**.
Đây là bản **front-end** (React 18 + Vite 5 + TypeScript strict). Mặc định nối **backend thật** CMC AI (`npm run dev`). Chỉ dùng dữ liệu giả lập khi chạy `npm run dev:mock` (lúc đó có huy hiệu “Dữ liệu mẫu” trên thanh trên).
Hệ thống chỉ đưa ra cảnh báo **“Nghi vấn” / “Cần chú ý”** để giám thị kiểm tra — không kết luận thay con người.
Giao diện theo bản thiết kế **CMC AI** (xem `DESIGN_HANDOFF.md`): chỉ dành cho **máy tính, tối ưu 1366–1920 px** (co giãn được khoảng 1024 px: thanh công cụ xuống dòng, không cắt mất bộ chọn camera), không hỗ trợ điện thoại. Có giao diện sáng và tối (lưu lựa chọn); màn giám sát không còn khoá giao diện tối.

## 1. Chạy dự án
```bash
npm install
npm run dev        # http://localhost:5173 — chế độ REAL, proxy /api /ws /media tới backend :8000
npm run dev:mock   # dữ liệu mẫu trên trình duyệt, không cần backend (huy hiệu “Dữ liệu mẫu”)
npm run dev:real   # alias của npm run dev
npm run build      # TypeScript + bản build real ra dist/
npm run preview    # xem bản build (cũng chế độ real)
npm run dev:phone  # HTTPS + mã QR cho iPhone, cùng Wi-Fi (mục 10)
npm run test:overlay  # kiểm tra ánh xạ bbox/khung xương
```
Các lệnh `dev:real` / `build:real` / `preview:real` / `dev:phone` không gán biến kiểu POSIX (`FOO=bar lệnh`) nên chạy được trên PowerShell, cmd và bash. Cấu hình nằm trong `.env.real` và cờ `--mode real`. PowerShell:
```powershell
cd exam-monitor-fe
npm install
npm run dev:real
# hoặc bản build:
npm run build:real; npm run preview:real
```
Tài khoản demo (chế độ mock; chế độ real dùng tài khoản của backend — xem mục 9):
| Vai trò | Email | Mật khẩu |
|---|---|---|
| Quản trị viên (Admin) | admin@examguard.vn | admin123 |
| Giám thị | giamthi@examguard.vn | giamthi123 |

Giám thị chỉ thấy: Phân tích, Giám sát, Lịch sử. Admin thấy thêm: Dashboard, Mô hình, Cài đặt.

## 2. Cấu trúc thư mục
```
src/
  types/        Kiểu dữ liệu chung: Camera, Detection (bbox/points), PoseDet (17 điểm), Alert, Rules, User...
  services/     Lớp API — điểm DUY NHẤT để đổi mock ↔ backend thật
    api.ts        Interface Api + RealtimeClient
    index.ts      Chọn mockApi hoặc httpApi theo VITE_API_MODE
    mock/         db (localStorage), seed, simulator (sinh detections), ruleEngine (luật cảnh báo),
                  mockRealtime (giả WebSocket, có mất kết nối/tự nối lại), mockAnalysis (job phân tích luồng)
    http/         config (đường dẫn /api /ws /media, token), httpApi (REST + bù chỗ lệch của backend),
                  wsRealtime (WebSocket thật, tự nối lại, phát hiện phiên hỏng)
  scene/        Mô hình "phòng thi" tất định: vị trí thí sinh, vật thể theo thời gian; vẽ khung hình giả
  lib/          overlay (vẽ bbox/OBB/polygon/khung xương lên canvas), geometry, labels (nhãn tiếng Việt,
                ánh xạ "cell phone"→phone), beep (WebAudio), format (ngày giờ)
  context/      AuthContext (đăng nhập, vai trò), LiveContext (cảnh báo + trạng thái camera realtime),
                ThemeContext (sáng/tối), ToastContext (thông báo)
  assets/brand/ Logo chính thức CMC University (bản xanh cho nền sáng, bản trắng cho nền tối)
  hooks/        useTicker (nhịp 24fps dùng chung), useLocalState, useNow, useElementSize, useAnalysisJob (job phân tích luồng)
  components/
    layout/       AppLayout, Sidebar (menu), Topbar (tìm kiếm, chuông, đổi giao diện), Guards (chặn route theo vai trò),
                  ConnectionBanner (banner mất kết nối)
    video/        CameraFeed (canvas video + lớp phủ AI), LayerToggles (bật/tắt khung, khung xương, nhãn, độ tin cậy), webcam
    alerts/       AlertRow, AlertThumb, AlertDetailModal (ảnh chụp + clip mô phỏng + Xác nhận/Bỏ qua), AlertReplay
    ui/           Nút, Toggle, Segmented, Slider, Modal, ConfirmModal, Badge mức độ/trạng thái, Logo
    charts/       Sparkline
  pages/        LoginPage, DashboardPage, DetectionPage (+ detection/MediaStage), LiveSinglePage, LiveGridPage,
                HistoryPage, ModelsPage, SettingsPage (+ settings/RulesTab, CamerasTab, UsersTab)
  styles/       index.css — token màu phẳng sáng/tối, khoảng cách, cỡ chữ (xem mục 8)
public/         ảnh khung hình thật dùng làm ảnh mẫu / nền camera
```

## 3. Các màn hình
1. **Đăng nhập** — 2 tài khoản demo, báo lỗi sai mật khẩu.
2. **Dashboard** — thẻ thống kê, biểu đồ theo giờ và theo loại (Recharts), 5 cảnh báo mới nhất, trạng thái camera.
3. **Phân tích (Upload)** — kéo thả ảnh/video, **phát ngay** (blob URL hoặc `mediaUrl`), lớp phủ và cảnh báo
   hiện dần theo job streaming, thanh tiến độ thật, đánh dấu đoạn đã phân tích trên thanh tua, nút Huỷ phân tích,
   bấm cảnh báo để tua tới thời điểm, tải kết quả JSON. Chi tiết mục 13.
4. **Giám sát**
   - *Camera đơn*: thanh công cụ (trạng thái/độ trễ, lớp phủ, **Kết nối điện thoại**, Lưới). Hàng video chia **70% Video phân tích** (có lớp phủ) và **30% Video gốc** (cùng chiều cao còn lại, mỗi bên 16:9). Ngay dưới là **hàng chọn camera** (chip cuộn ngang + tìm kiếm + danh sách thả, luôn thấy, kể cả 1366×600). Mỗi video có nút **toàn màn hình** (hoặc double-click; Esc để thoát). Thanh kéo giữa hàng chọn camera và **Cảnh báo trực tiếp** (lưu chiều cao). Bảng cảnh báo có **Xem / Xác nhận / Bỏ qua**; viền đỏ, tiếng bíp khi mức Cao; modal ảnh chụp + clip ngắn; banner mất kết nối, tự nối lại. Giao diện vừa khung Chrome ở zoom 100% (không cần thu nhỏ).
   - *Hệ thống camera*: lưới 2×2 / 3×3 (ô luôn 16:9), lọc phòng, “chỉ cam có cảnh báo” (không giật: giữ ô ổn định vài giây, không gắn lại luồng, tối đa 4 luồng MJPEG — ô còn lại ảnh tĩnh ~2–3 fps). Viền đỏ khi cảnh báo Cao, đưa cam cảnh báo lên đầu, bấm ô để mở Camera đơn, nút toàn màn hình trên từng ô, bảng cảnh báo tổng hợp.
5. **Lịch sử** — bộ lọc (camera, phòng, mức, loại, trạng thái, thời gian), bảng phân trang, modal chi tiết, xác nhận/bỏ qua.
   Thao tác ở màn giám sát được lưu và hiện ngay trong Lịch sử.
6. **Mô hình** — thông tin YOLO 4 lớp và YOLO Pose, chỉ số theo lớp (số liệu mô phỏng).
7. **Cài đặt** — *Cấu hình quy tắc* (bật/tắt, mức độ, ngưỡng tin cậy, ngưỡng gần tay, thời gian duy trì, chống trùng,
   tuỳ chọn từng phòng cho phép giấy nháp / máy tính); *Quản lý camera* (`/cai-dat/camera`, chỉ Admin: CRUD, “Kiểm tra kết nối”, nút **Thêm camera điện thoại**);
   *Quản lý người dùng* (CRUD, không tự khoá/xoá chính mình).

## 4. Mức cảnh báo và luật
| Mức | Màu + nhãn | Tình huống |
|---|---|---|
| Cao | đỏ #D92D20 (tối: #F04438) — “Cao” | điện thoại gần tay (khoảng cách tới cổ tay kp 9/10 so với chiều cao người) |
| Trung bình | cam #F79009 — “Trung bình” | điện thoại trong vùng làm bài |
| Thông tin | xanh da trời #0B84C6 (tối: #2E9FD8) — “Thông tin” | có giấy / máy tính; tự tắt nếu phòng cho phép |

Chỉ bắn khi tình huống **kéo dài đủ lâu** (persist) và **không lặp** trong thời gian chống trùng (dedupe).
Màu luôn đi kèm chữ. Thí sinh chỉ hiển thị bằng mã track/chỗ ngồi (#3), không có tên.

Trên khung hình (canvas) dùng bản sáng hơn: Cao #EF4444, Trung bình #F59E0B, Thông tin #0EA5E9.

## 5. Luồng dữ liệu
`simulator` sinh DetectionFrame mỗi nhịp → `ruleEngine` kiểm tra luật → tạo Alert → `db` lưu (localStorage) và phát qua `bus`
→ `mockRealtime` đẩy sự kiện `detections` / `alert` / `alert_update` / `camera_status` → `LiveContext` cập nhật → các trang hiển thị.
Xác nhận/Bỏ qua gọi `api.alerts.updateStatus` → phát `alert_update` → mọi màn hình (kể cả Lịch sử) đồng bộ.

## 6. Chuyển sang backend thật
Chi tiết cách chạy chung với backend: **mục 9**. Tóm tắt: `npm run dev:real` (đọc `.env.real`: `VITE_API_MODE=real`, `/api`, `/ws`).
Các trang chỉ gọi `api` / `realtime` từ `src/services`, nên không cần sửa giao diện. Mọi chỗ lệch giữa backend và UI được xử lý
trong `src/services/http/` (`config.ts`, `httpApi.ts`, `wsRealtime.ts`). Định dạng dữ liệu: `API_CONTRACT.md` (đã khớp backend thật).

## 7. Giới hạn hiện tại
- **Chế độ mock:** detection và cảnh báo là giả lập; dữ liệu lưu trong localStorage (xoá dữ liệu trang để về mặc định);
  lớp phủ trên webcam là mô phỏng chung; số liệu trang Mô hình là mô phỏng (chỉ ở chế độ mock).
- **Chế độ real với `DETECTOR=yolo`** (model gốc COCO yolo26s + yolo26s-pose): chỉ có người + điện thoại (COCO không có giấy/máy tính),
  ~1 lần phân tích/giây/camera trên CPU; video gốc vẫn 2 ảnh/giây (BE đọc khung riêng).
- **Chế độ real (backend `DETECTOR=mock`):** kết quả lấy từ nhãn gốc của dataset, nên chỉ ảnh/khung hình có trong dataset mới có
  phát hiện (tải lên ảnh `VPC2_..._xxxxx.jpg` của dataset thì có; ảnh/video khác trả 0 phát hiện). Trang Mô hình chưa có chỉ số mAP.
- Ảnh mẫu ở trang Phân tích (chế độ mock) là khung hình thật đã có sẵn chú thích in trên ảnh.
- Tiếng bíp cần người dùng tương tác với trang trước (chính sách trình duyệt).

## 8. Thiết kế CMC AI
- **Thương hiệu:** tên “CMC AI”, logo CMC University (`src/assets/brand`), favicon `public/cmc-favicon-192.jpg`.
- **Font:** Be Vietnam Pro (gói `@fontsource/be-vietnam-pro`, nhúng sẵn, không cần mạng), hỗ trợ đầy đủ dấu tiếng Việt.
- **Phong cách phẳng:** chỉ dùng màu đặc — không gradient, không glow, không blur/backdrop-filter, không text-shadow.
  Chỉ modal và menu thả xuống có bóng (`--shadow-lg`). Nền giấy `#F7F7F4`, chữ `#1F2328`; màn giám sát dùng nền xám trung tính tối (`#0F1113`).
  Cảnh phòng thi mô phỏng cũng vẽ màu đặc (đã bỏ vignette/gradient). Không dùng màu tím ở bất kỳ đâu (các tông phụ đổi thành “slate”).
  Nút **Giao diện sáng / tối** trên thanh trên hoạt động ở mọi trang, kể cả Giám sát (lựa chọn lưu `localStorage`). Token `--live-*` theo theme.
- **Màu lớp đối tượng** (khung trên video — luôn kèm nhãn chữ; khác hẳn ba màu mức cảnh báo đỏ/cam/xanh da trời):

| Lớp | Màu | Chữ trên nhãn |
|---|---|---|
| Người | xanh lá #22C55E | #0B1220 |
| Điện thoại | hồng #F472B6 | #0B1220 |
| Giấy | xanh ngọc #2DD4BF | #0B1220 |
| Máy tính | **nâu ấm #8B5E3C** | #FFFFFF (tương phản ≈ 5,6:1) |

  Máy tính dùng nâu trung tính để không nhầm với Thông tin (xanh) hay Giấy (xanh ngọc). Trên nền tối (độ tương phản ≈ 3,4:1 với #0F1113)
  khung máy tính có thêm viền trắng mảnh để nổi rõ. Khi một đối tượng bị gắn cảnh báo, khung và nhãn chuyển sang màu của mức cảnh báo.
  Khung xương: tay trái #38BDF8, tay phải #A3E635, thân #FACC15; điểm cổ tay vàng #FDE047, các điểm khác trắng.
- **Nhãn ô camera ở lưới 3×3:** tên camera không bao giờ bị che — ô dùng chữ nhỏ hơn (12–13 px), viên thuốc đếm rút gọn
  (“Cao · 8” hoặc “5 mới”), vị trí rút gọn (Trước/Sau), tên dài sẽ có dấu “…” và hiện đầy đủ khi rê chuột (tooltip “CAM 05 · P.504”).
  Đã kiểm tra tự động ở 1366, 1440 và 1920 px. Lưới 2×2 giữ nhãn đầy đủ.
- **Bảng cảnh báo hẹp:** ba nút Xem / Xác nhận / Bỏ qua chia đều chiều rộng thẻ, không bị cắt ở 1366 px.

## 9. Chạy FE cùng backend thật (CMC AI BE)
**Kiến trúc:** trình duyệt → Vite (5173 khi dev, 4173 khi preview) → proxy `/api`, `/ws`, `/media` → FastAPI `http://localhost:8000`.
Trang chỉ gọi đường dẫn tương đối nên không vướng CORS, và token không lộ ra domain khác.

1. **Backend** (thư mục `cmc-ai-be`, không cần sửa code):
   ```bash
   cd cmc-ai-be
   python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
   cp .env.example .env          # sửa DATASET_DIR trỏ tới thư mục dataset (có data.yaml, train/valid/test)
   ./run.sh                      # http://localhost:8000 · tài liệu API: http://localhost:8000/docs
   curl localhost:8000/api/health   # {"ok":true,"detector":"mock","cameras":0}  (mặc định trống; cameras=8 chỉ khi SEED_DEMO=1)
   # Windows: giải nén BE, nhấp đúp run.bat (hoặc python run.py). Lần đầu tự tạo .venv, cài thư viện và tải model.
   # Nếu máy còn dữ liệu cũ (CAM 01, cảnh báo mẫu): chạy **một lần** `run.bat --reset-data` (hoặc `python run.py --reset-data`) rồi khởi động lại. DB mới mặc định trống (SEED_DEMO=0).
   # Tường lửa nếu điện thoại không vào được Wi-Fi: xem README backend (lệnh netsh mở cổng 8000, 5173). USB DroidCam không cần bước này.
   ```
   Cần `ffmpeg` để ghép clip cảnh báo.
2. **Front-end:**
   ```bash
   cd exam-monitor-fe
   npm install
   npm run dev:real              # http://localhost:5173 (chế độ real, proxy tới :8000)
   # hoặc bản build:
   npm run build:real && npm run preview:real   # http://localhost:4173
   # PowerShell (Windows):
   #   npm run dev:real
   #   npm run build:real; npm run preview:real
   ```
   Backend chạy ở máy/cổng khác: đặt `BACKEND_URL=http://<host>:<port>` trong `.env.real` (đích của proxy).
   Muốn gọi thẳng backend không qua proxy: `VITE_API_BASE_URL=http://host:8000/api`, `VITE_WS_URL=ws://host:8000/ws`
   (backend phải mở CORS cho origin của FE; `/media/...` tự ghép với gốc server).
3. **Đăng nhập** bằng tài khoản mẫu của backend (trang đăng nhập tự hiện đúng tài khoản theo chế độ):
   `admin@cmc.edu.vn / admin123` · `giamthi@cmc.edu.vn / giamthi123`.
4. **Quay lại mock:** `npm run dev:mock` (không cần backend). `npm run dev` / `npm run build` / `npm run preview` đều là chế độ real.

**Hiển thị video ở chế độ real**
- *Camera đơn:* video gốc là luồng MJPEG `/api/cameras/{id}/stream.mjpg?token=…` trong `<img>`, lớp phủ vẽ trên canvas trong suốt
  từ gói `detections`. Toạ độ `bbox` và keypoints là **pixel trên khung `frameW`×`frameH`** (BE gửi kèm `cameraId`, `frameTs`). FE scale theo cỡ khung đó + khoảng letter/pillarbox của `object-fit: contain`, tự phân biệt `coord: px` và chuẩn hoá 0..1; **không** mặc định 1920×1080 và **không** gương ngang trừ khi BE gửi `mirror`. Khung không có đối tượng (`objects: []`, `poses: []`) thì xoá lớp phủ ngay.
- *Lưới camera:* dùng ảnh tĩnh `/snapshot.jpg` làm mới ~0,6 giây/lần (camera dataset chỉ phát 2 khung/giây) thay vì 8 luồng MJPEG,
  vì trình duyệt chỉ mở tối đa 6 kết nối HTTP/1.1 tới một máy chủ — mở 8 luồng sẽ chặn hết các lệnh API khác.
- *Tốc độ phân tích:* video gốc chạy theo tốc độ của nó, lớp phủ (canvas) chỉ đổi khi có kết quả `detections` mới. Góc Camera đơn và mỗi
  ô lưới hiện “Phân tích ~N khung/giây”, đo từ các gói `detections` của từng camera trong ~5 giây gần nhất (`lib/analysisRate.ts`,
  `useAnalysisRate`); chưa có gói nào → “Chưa có kết quả phân tích”. Quá 3 giây không có kết quả mới → lớp phủ mờ 40% kèm ghi chú
  “Kết quả phân tích cũ hơn 3 giây…”, có kết quả mới thì rõ lại. Mock cũng chỉ phân tích ~1 khung/giây/camera (`MOCK_ANALYSIS_MS`).
  Lưới 3×3: tên phòng nằm cạnh tên camera ở dòng trên để dòng dưới đủ chỗ cho tốc độ phân tích (vừa ở 1366/1440/1920).
- *Nhãn lớp phủ:* mặc định gọn: thí sinh chỉ “#N”, vật thể chỉ tên; “Độ tin cậy” tắt mặc định (bật lại bằng nút “Độ tin cậy”).
  Thí sinh đang có cảnh báo chưa xử lý (≤ 60 giây): khung viền + nhãn đầy đủ “#N · Mức · độ tin cậy” theo màu mức (Cao đỏ,
  Trung bình cam, Thông tin xanh); vật thể liên quan chỉ viền màu mức. Lưới nhiều ô chỉ hiện nhãn của thí sinh bị gắn cờ.
- *Lưới camera lấp đầy màn hình:* chiều cao còn lại chia đều cho các hàng (video giữ 16:9, căn giữa ô, nhãn ô nằm ở dải tối trên/dưới);
  không cuộn trang ở 1366×768, 1440×900, 1920×1080.
- *Camera điện thoại (buổi demo 1 camera):* xem **mục 10**. Không có “Chế độ demo”. Tắt camera mẫu trong Cài đặt (hoặc `SAMPLE_CAMERAS=off`). Vào hộp thoại từ **Cài đặt → Quản lý camera** (`/cai-dat/camera`, Admin) → **Thêm camera điện thoại**, hoặc từ **Giám sát → Camera đơn** bằng nút **Kết nối điện thoại** trên thanh công cụ video (cũng có trên thanh công cụ lưới). Chỉ Admin. Hộp thoại có 3 tab: USB (mặc định), QR, địa chỉ luồng.
- *Độ trễ:* Camera đơn hiện “Trễ … giây” từ `frameTs` trên gói `detections`.
- *Thông báo kết nối:* “Đã kết nối lại” tự ẩn sau 3 giây; “Mất kết nối / Đang kết nối lại” giữ nguyên tới khi nối lại được.
- *Trang Mô hình:* chỉ hiện dữ liệu `GET /api/models`; không có chỉ số → “Chưa có chỉ số đánh giá”, không có tốc độ → “Chưa có số đo”.
- *Khung xương:* chỉ vẽ điểm có `v > 0` (và ≥ 0,3); dataset có 11 điểm nên chỉ thấy phần thân trên.
- *Clip cảnh báo:* cảnh báo mới có `clipUrl = null`; FE hiện ảnh chụp kèm “Đang tạo clip quanh thời điểm cảnh báo…”.
  Khoảng 3–5 giây sau, backend đẩy WebSocket `alert_update` có `clipUrl` → `LiveContext` cập nhật cảnh báo → cửa sổ chi tiết tự
  chuyển sang phát clip (không gọi tệp .mp4 trước đó nên không có lỗi 404). Mock làm y hệt: `simulator.ts` gửi `alert_update`
  với `clipUrl = "mock:replay"` sau 3,5 giây.
- *Phiên hết hạn:* REST trả 401, hoặc WebSocket bị đóng với mã 4401 → tự đăng xuất về trang đăng nhập. Nếu WebSocket rớt khi chưa
  mở được, FE gọi `/auth/me` để kiểm tra (401 → đăng xuất, còn lại → nối lại).
- *Bảng điều khiển:* số liệu “hôm nay” / theo giờ do backend tính theo giờ Việt Nam, FE hiển thị nguyên.
- *Camera webcam:* form gửi `webcam://0` (backend cũng nhận `0`, `/dev/video0`). Máy chủ không có webcam → “Kết nối thất bại”.
- *Người dùng:* đổi sang email đã có → backend trả 409, FE báo “Email đã tồn tại”.
- *Quy tắc theo phòng:* mặc định cho phép giấy nháp, không cho phép máy tính cầm tay; mức Thông tin chỉ báo 1 lần / thí sinh / 10 phút.
  Phòng mới chưa có trong cấu hình hiện “Chưa cấu hình” (backend coi là không cho phép). Nút “Khôi phục mặc định” gọi
  `/rules/reset` → về đúng mặc định trên cho mọi phòng có camera.

**Kiểm thử đầu-cuối:** `node /workspace/pwtest/cmc-real/smoke-real.js` (cần BE ở :8000 và `npm run preview:real` ở :4173).
Test xác nhận 1 cảnh báo mới rồi mở lại và trả về đúng trạng thái + ghi chú gốc qua API (chỉ còn `handledBy/handledAt`, API không xoá được). Thêm (ở trạng thái tắt)/sửa/xoá
1 camera và thêm/sửa/xoá 1 người dùng tạm, sửa rồi khôi phục quy tắc — không để lại dữ liệu trên backend.

## 10. Demo bằng camera điện thoại (Windows + iPhone)

Buổi demo chỉ dùng **1 camera**. Tắt 8 camera mẫu trong Cài đặt (hoặc `SAMPLE_CAMERAS=off` trên backend). Nên thử **cả USB và QR** một lần trước giờ demo. Điện thoại khi cắm dây phải cắm vào **cùng máy chạy backend**.
Trên Windows, chạy backend bằng cách nhấp đúp `run.bat` trong thư mục BE (chi tiết và lệnh `netsh` ở README của backend).

**Tab 1 — Cắm dây USB (mặc định, khuyến nghị):**

1. iPhone: cài [DroidCam](https://www.dev47apps.com/). Máy Windows: cài **DroidCam Client** (bản mới kiểu OBS cũng được) và **Apple Devices** (hoặc iTunes).
2. Cắm cáp USB, mở DroidCam trên iPhone; trong Client chọn kết nối USB (nguồn trong Client có thể hiện tên điện thoại, ví dụ “anton [USB]”). **Để cửa sổ DroidCam Client chạy** — webcam ảo trên Windows thường tên **DroidCam Video** (hoặc tên có chữ DroidCam).
3. Trong CMC AI, Admin mở hộp thoại bằng một trong hai đường:
   - **Cài đặt → Quản lý camera** (`/cai-dat/camera`) → nút **Thêm camera điện thoại**, hoặc
   - **Giám sát → Camera đơn** → nút **Kết nối điện thoại** ở đầu cột phải, phía trên *Video gốc* (hoặc thanh công cụ **Hệ thống camera**).
   Chọn tab *Cắm dây USB*, chọn webcam **DroidCam Video** (danh sách từ `GET /api/sources/webcams`, khớp tên có chữ DroidCam). Nếu danh sách trống: mở DroidCam Client, để chạy, rồi bấm **Làm mới**. Vẫn có `webcam://0`…`3` để thử bằng nút *Kiểm tra* nếu máy chủ chưa liệt kê được thiết bị. Nút *Kiểm tra* đọc luồng trên máy chạy backend (độ phân giải, FPS). Ở chế độ real, FE **không** tự mở xem trước bằng getUserMedia trên trình duyệt — DroidCam (kể cả “DroidCam Source 1”) sẽ ra khung xanh nếu trình duyệt tranh thiết bị với backend. Có nút tùy chọn **Xem trước trên trình duyệt**; trước khi Lưu nên dừng xem trước. Sau khi Lưu, xem luồng thật ở Camera đơn.
4. Xem trước nếu máy FE và BE là một, rồi **Lưu**. Nếu mở từ Giám sát, CMC AI tự chuyển sang **Camera đơn** của camera mới — sẽ có video, lớp phủ và “Trễ … giây”.

**Tab 2 — Quét mã QR (dự phòng, không cần cài app):**

Cùng mạng Wi-Fi; dùng Safari trên iPhone; chấp nhận chứng chỉ HTTPS một lần; cho phép camera.

Trong **PowerShell** (máy Windows đang chạy backend):

```powershell
cd exam-monitor-fe
npm install
npm run dev:phone
# In ra: https://192.168.x.x:5173  (chứng chỉ tự ký)
```

Ghi đè địa chỉ LAN nếu script chọn nhầm card (bỏ qua Docker / vEthernet / VMware / WSL / VPN…; ưu tiên Ethernet/Wi-Fi):

```powershell
$env:LAN_IP="192.168.1.20"; npm run dev:phone
# hoặc
npm run dev:phone -- --host 192.168.1.20
# cmd.exe:  set LAN_IP=192.168.1.20 && npm run dev:phone
```

Mở trang quản trị trên máy tính (Admin): **Cài đặt → Quản lý camera** (`/cai-dat/camera`) → **Thêm camera điện thoại**, hoặc **Giám sát → Camera đơn** → **Kết nối điện thoại** (thanh công cụ video). Chọn tab *Quét mã QR* → **Tạo mã QR**. iPhone mở Safari, quét mã (hoặc bấm **Sao chép liên kết** rồi dán `https://<LAN>:5173/dt?c=…&t=…` trên điện thoại), chấp nhận chứng chỉ, bấm **Bắt đầu phát**. Nếu mở từ Giám sát, Camera đơn tự chuyển sang camera vừa tạo.

**Tab 3 — Nhập địa chỉ camera:** điền URL MJPEG/RTSP (ví dụ IP Webcam). Nút điền sẵn `http://localhost:8080/video` (sau `adb forward`). Front-end gửi `sourceType: "rtsp"` (backend đọc cả `http://…/video` ở nhánh này). Trên máy Windows có thể dùng Iriun/DroidCam HTTP nếu đã forward cổng.

Linux / macOS cũng dùng `npm run dev:phone` (không cần POSIX `FOO=bar`).

Trang `/dt` chỉ là trang đẩy hình từ điện thoại; giao diện quản trị vẫn dành cho máy tính (1366–1920 px).

## 11. Cập nhật 10/11/2026 (góp ý anh Dũng)

1. **Camera đơn vừa khung Chrome ở zoom 100%:** không cần thu nhỏ cửa sổ. Đã kiểm tra viewport sau khi trừ khung Chrome (~130 px): 1366×638, 1440×770, 1536×730 (laptop Windows scale 125%, deviceScaleFactor 1.25), 1600×770, 1920×950, thêm 1366×768 / 1366×600 / 1920×1080. Vỏ ứng dụng đúng `100dvh`, không cuộn document (vùng trong tự cuộn). Sidebar **giữ chữ** (kể cả submenu Camera đơn / Hệ thống camera) từ bề ngang ≥ 1200 px, rộng khoảng 200 px; chỉ thu còn icon + tooltip + nút mở rộng khi < 1200 px. Topbar gọn khi màn thấp. Không tràn ngang, không cắt nút.
2. **Cảnh báo trực tiếp kéo được chiều cao:** thanh kéo giữa vùng video và bảng cảnh báo, lưu `examguard.ui.live.alertH`, có min/max, dùng được phím mũi tên / Home / End.
3. **Toàn màn hình:** nút + double-click (Fullscreen API) trên Camera đơn và từng ô lưới; lớp phủ/canvas scale theo kích thước mới; Esc thoát.
4. **Lưới 3×3 không giật khi bật “chỉ cam có cảnh báo”:**
   - Nguyên nhân FE: lọc/sắp xếp lại mỗi nhịp cảnh báo + kéo chiều cao hàng theo phần còn lại của viewport (`fill`) khiến ResizeObserver và danh sách ô nhảy, gắn lại `<img>` MJPEG/snapshot.
   - Nguyên nhân trình duyệt: Chrome chỉ ~6 kết nối HTTP/1.1 tới một máy chủ — 9 luồng MJPEG làm cả trang giật.
   - Cách xử lý: giữ ô vừa rời bộ lọc thêm ~2,8 giây, sắp xếp ổn định, ô luôn 16:9 (bỏ fill). Lưới dùng một WS `/ws/grid`; lỗi thì poll snapshot ~2,5 fps — không mở MJPEG trên lưới (`src/services/media.ts`, `gridWs.ts`).
5. **Giao diện sáng** chạy được trên mọi trang (kể cả giám sát): token CSS, overlay canvas, biểu đồ, modal, toast. Lựa chọn được lưu.
6. **Dễ dùng hơn:** bộ chọn camera rõ ràng, nhóm lớp phủ, trạng thái trống có nút Thêm camera / Kết nối điện thoại, không gradient.
7. **DroidCam bản mới:** danh sách webcam xếp **DroidCam Video** lên đầu và chọn sẵn; “DroidCam Source N” gắn “(bản cũ – có thể ra màn hình xanh)”. FE không tự cắt/parse `webcam://…` (nhận `webcam://dshow/N`, `webcam://msmf/N`, mở theo tên). Nút Kiểm tra hiện nguyên văn lỗi BE; nếu `hasPicture === false` hoặc khung một màu thì hiện thêm gợi ý chọn DroidCam Video / URL `http://IP:4747/video` / tab QR.
8. **Chế độ real chạy trống:** không rơi về mock. Khi chưa có camera/cảnh báo, mọi màn (Bảng điều khiển, Phân tích, Camera đơn, Hệ thống camera, Lịch sử, Cài đặt) hiện trạng thái trống. BE mặc định không seed camera (`SEED_DEMO=0`, `SAMPLE_CAMERAS=off`). **Máy còn dữ liệu cũ:** chạy một lần `run.bat --reset-data` (hoặc `python run.py --reset-data`). Chi tiết `/workspace/be-requests-droidcam-empty.md`. Chế độ mock vẫn giữ dữ liệu demo.
9. **Lưới 3×3 — video gốc:** FE mở **một** WebSocket `/ws/grid?token=&cams=…&w=480&fps=5`, gửi `{type:"subscribe",cameraIds,w,fps}`; nhận `{type:"ready"}` rồi `{type:"frame",cameraId,ts,w,jpeg}`. Nếu WS lỗi, mỗi ô poll `GET /api/cameras/{id}/snapshot.jpg?w=480&token=&t=` ~2,5 fps. Camera đơn dùng `GET /api/cameras/{id}/stream.mjpg?token=&fps=15`. Không mở 9 luồng MJPEG.
10. **Webcam:** phần tử `GET /api/sources/webcams` có thêm `backend`, `urlByName`, `hasPicture`. FE gửi `url` hoặc `urlByName` (ưu tiên urlByName với DroidCam Video). Mục `hasPicture: false` bị tắt, kèm ghi chú. `test-connection` hiện nguyên văn `message` khi `ok: false` (kể cả `hasPicture: false`).

11. **Hàng video 70/30 và hàng chọn camera:** Video phân tích chiếm 70% bề ngang, Video gốc 30%, cùng chiều cao phần còn lại phía trên thanh cảnh báo (dùng `min()`/`flex`, không cố định px, mỗi bên giữ 16:9 bằng object-fit contain). Dưới ~1024 px xếp dọc 70/30 theo chiều cao. Nút **Kết nối điện thoại** nằm trên thanh công cụ video. Video gốc giữ nút toàn màn hình và double-click. Mỗi video một luồng MJPEG (`/stream.mjpg`). Ngay dưới hai video là hàng chọn camera (chip/thumbnail tĩnh cuộn ngang, ô tìm kiếm và danh sách thả) — luôn hiện, kể cả 1366×600; đã bỏ ô chọn camera trùng trên thanh công cụ.
12. **Thẻ cảnh báo mới trên giao diện sáng:** bản redesign cũ gắn `.alert-row.is-new` nền cố định `#23272b` (màu panel tối), nên chữ “Nghi vấn: …” và nút Xem / Bỏ qua (màu chữ tối theo theme sáng) bị chìm. Đã chuyển mọi trạng thái thẻ (mới, hover, selected, focus, đã xử lý, theo mức) cùng toast, modal, banner mất kết nối sang token `--alert-new-bg` / `--lv-*-bg` / `--card` / `--text`. Cảnh báo mới nhuộm nền nhạt theo mức (Cao / Trung bình / Thông tin) ở cả hai theme, chữ và nút đạt tương phản AA.

## 12. Cập nhật tối 10/11/2026 (vừa khung, overlay, model, hiệu năng)

1. **Vừa màn không cần thu zoom.** Shell `html`/`body`/`#root`/` .app` = `100dvh`, `overflow: hidden`. Trang giám sát, hệ thống camera, bảng điều khiển, phân tích, lịch sử, cài đặt không cuộn document. Thanh công cụ Camera đơn một hàng: “Độ tin cậy” và “Mô phỏng mất kết nối” chuyển vào menu ⋯. Hàng camera + ít nhất 2 dòng cảnh báo luôn thấy trong phần còn lại. Đã kiểm tra Playwright: `document.scrollingElement.scrollHeight ≤ innerHeight` và `scrollWidth ≤ innerWidth`, nhãn sidebar hiện đủ khi ≥ 1200 px, trên các viewport 1229×603, 1280×577, 1280×649, 1366×625, 1366×657, 1536×730, 1920×937 ở dpr 1 / 1.25 / 1.5 (252/252, gồm thêm Phân tích và Lịch sử).

2. **`npm run dev` mặc định là real.** Trước đây `npm run dev` chạy mock nên trang hiện CAM 01–08 và 99+ cảnh báo mẫu dù BE trống. Giờ mock chỉ khi `npm run dev:mock`. Real không bao giờ bơm dữ liệu mẫu.

3. **Lớp phủ khớp người trong hình.** Lỗi cũ: scale theo `img.naturalWidth` hoặc mặc định 1920×1080, trong khi BE gửi bbox pixel trên khung thật (ví dụ 1280×720) và video `object-fit: contain` có letterbox — khung lệch / nhỏ hơn người. Đã sửa trong `src/lib/overlayMap.ts`.

4. **Trạng thái model** trên Camera đơn lấy từ `GET /api/cameras/{id}/diag` + `camera_status` (WS và `GET /api/cameras/status`): `framesRead`, `analysedFrames`, `detectFps`, `lastDetectTs`, `lastObjects`, `inferMs`, `lastError`, `detector` (`running` | `not_started` | `error` | `no_frames`). Tooltip từ `GET /api/system/model`: `detModel`, `poseModel`, `classes`, `device`, `imgSize`, `conf`, `iou`, `detectFps`, `fallback`. Các trạng thái: “Model chưa chạy” (+ lỗi), “Đang chạy · tên · N khung/giây · 0 đối tượng”, “Đang chạy · N đối tượng”, “Mất hình từ camera”. Thiếu hết endpoint thì “Chưa có thông tin từ BE”, không đoán.

5. **Bảng điều khiển / Mô hình.** `spark.cameras` của BE là số ảo (7× số camera online) — thẻ “Camera đang chạy” **không** vẽ sparkline. `GET /api/models` trả `metrics: []` và `fps: 0` thì hiện “Chưa có chỉ số đánh giá” / “Chưa có số đo”, không bịa số.

6. **Hiệu năng (so với bản trước khi tối ưu).** Canvas lớp phủ chỉ vẽ lại khi có detections mới / đổi cỡ / hết hạn giữ (không chạy rAF 60 lần/giây). Tab ẩn hoặc video ra khỏi viewport thì dừng MJPEG/snapshot. Danh sách cảnh báo memo + ảo hoá từ 99 mục. React re-render theo WS được giới hạn ~10 Hz. Trang Phân tích và Mô hình vốn đã lazy-load. Định lượng: trước đây overlay ~48 lần vẽ/giây (rAF); sau này chỉ vẽ khi có gói phân tích (~1–8 lần/giây khi model chạy, 0 khi chỉ xem video gốc).

## 13. Phân tích luồng (11/11/2026)

Trước đây trang Phân tích gọi `POST /api/analysis`, chờ BE phân tích hết rồi mới hiện video và lớp phủ. Nay đổi sang **tải xong là phát ngay**, kết quả nhận diện về dần.

### Luồng phía FE
1. Chọn tệp (hoặc ảnh/video mẫu) → FE tạo **blob URL** của file local và phát ngay trên canvas (không chờ máy chủ). Ảnh/video mẫu không có blob thì dùng `mediaUrl` BE trả về (`/media/jobs/{jobId}/source.ext`, hỗ trợ HTTP Range, không cần JWT).
2. Đồng thời `POST /api/analysis/jobs` (multipart `file` hoặc `sample=sample-image|sample-video`) → BE trả ngay `{jobId, fileName, mediaType, mediaUrl, width, height, fps, duration, model}` rồi phân tích nền.
3. FE nối `WS /ws/analysis/{jobId}?token=<JWT>` (cùng cách xác thực các WS khác). Lúc mới nối, BE gửi lại kết quả đã có; sau đó khoảng 0,5–1 giây một lô `{type:'progress', progress:0..1, analysedSec, frames, alerts}`. Xong: `{type:'done', progress:1, duration, totalFrames, totalAlerts}`. Lỗi: `{type:'error', message}`.
4. Token sai → WS đóng **4401** (đăng xuất). **Không còn job** (hết hạn ~1 giờ / restart BE) → đóng **4404**, hiện *“Phiên phân tích đã hết hạn, hãy tải lại file.”*
5. WS lỗi hoặc rớt: poll `GET /api/analysis/jobs/{jobId}` mỗi 1 giây. **Không truyền `since`** ở lần đầu (để có cả khung `t=0`); các lần sau `?since=<analysedSec>` (chỉ lấy `t > since`).
6. Đổi tệp, đóng trang hoặc bấm **Huỷ phân tích** → `DELETE` (204). WS có thể gửi `{type:'error', message:'Đã huỷ phân tích.'}` — khi chính FE là bên huỷ thì **bỏ qua** thông báo này, không hiện thành lỗi.
7. Nếu `POST /jobs` trả **404** (BE bản cũ), FE fallback `POST /api/analysis` chạy nền: video vẫn phát ngay, lớp phủ hiện khi API cũ trả về.
8. Cùng lúc BE chỉ chạy **một** job; job gửi sau có `status: "queued"` — FE hiện *“Đang chờ lượt phân tích”*. Lần đầu `sample-video` trên BE thật có thể chậm lúc POST.

### Lớp phủ, tiến độ, cảnh báo
- Toạ độ là **pixel** theo `width` × `height` của file, vẽ đè theo vùng `object-fit: contain` (`lib/overlayMap.ts`, `containRect`). Chọn khung có `t` gần nhất **≤** thời điểm đang phát; lệch quá **0,4 giây** thì không vẽ (tránh khung cũ đứng yên).
- Thanh tiến độ thật theo `progress` / `analysedSec`, chữ *“Đang phân tích 00:42 / 02:10”*. Trên thanh tua, đoạn đã phân tích được tô. Nếu đầu phát vượt `analysedSec` thì hiện nhãn *“Chưa phân tích tới đoạn này”*, **không dừng video**. Tua và bấm cảnh báo vẫn như cũ.
- Cảnh báo thêm dần theo thời gian thực (danh sách ảo hoá, cập nhật state tối đa ~10 Hz). Xong: *“Đã phân tích xong · N cảnh báo”*. Lỗi: hiện nguyên văn `message` của BE.
- Ảnh đi cùng luồng job (một khung `t=0` rồi `done`). Chế độ **mock** (`npm run dev:mock`) giả lập job và đẩy lô dần. Chế độ **real không bịa dữ liệu**.

### API (adapter `services/http/analysisJobs.ts` và `services/mock/mockAnalysis.ts`)
`api.analysis.startJob` / `getJob` / `cancelJob` / `subscribeJob`. `analyze()` cũ vẫn có, dùng nội bộ khi fallback.
