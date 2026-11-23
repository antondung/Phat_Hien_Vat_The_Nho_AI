# CMC AI – Bàn giao thiết kế (Redesign v3)

**Sản phẩm:** CMC AI – Giám sát phòng thi (tên cũ: ExamGuard AI)
**Phạm vi:** chỉ bản web desktop, rộng 1366–1920px. Không làm bản mobile.
**Mã nguồn:** `/workspace/exam-monitor-fe-redesign`. Bản gốc `/workspace/exam-monitor-fe` không bị sửa.
**Ảnh sau redesign (1440×900):** `/workspace/redesign-shots/`. Ảnh trước: `/workspace/pwtest/eg/`.

---

## 1. Nguyên tắc

1. **Đơn giản, đẹp và dễ dùng.** Dùng ít màu, nhiều khoảng trắng và chữ to (thân bài 15px, nhỏ nhất 13px).
2. **Phẳng hoàn toàn.** Không gradient, glow, glassmorphism, blur nền, hay bóng trang trí. Chỉ modal và dropdown có bóng để tách lớp.
3. **Mỗi màn hình có một hành động chính rõ ràng.** Nút chính dùng màu mực đặc; các nút còn lại là nút viền.
4. **Màu sắc có nghĩa.** Đỏ, cam và xanh sky chỉ dùng cho mức cảnh báo. Màu luôn đi kèm chữ hoặc biểu tượng.
5. **Dễ tiếp cận.** Chữ đạt tương phản WCAG AA. Mọi phần tử tương tác có `:focus-visible` (viền 2px, cách 2px). Mọi nút biểu tượng đều có nhãn chữ.
6. **Ngôn từ có trách nhiệm.** Dùng "Nghi vấn" và "Cần chú ý", không dùng "Gian lận". Thí sinh chỉ hiển thị bằng ID (#3).
7. **Chỉ sáng tạo qua bảng màu và kiểu chữ:** giấy ấm, mực đen và font Be Vietnam Pro. Không thêm hiệu ứng phức tạp.

## 2. Thương hiệu

- **Logo:** logo chính thức của Trường Đại học CMC, không vẽ lại và không chỉnh sửa. Logo có sẵn dòng tagline tiếng Anh "Aspire to Inspire the Digital World".
  - Bản xanh (nền sáng): https://cmcu.edu.vn/wp-content/uploads/2024/03/logo-CMC-Uni-xanh-ngang.png, lưu tại `src/assets/brand/cmc-university-logo-blue.png` (715×127).
  - Bản trắng (nền tối): https://cmcu.edu.vn/wp-content/uploads/2022/09/logo-CMC-Uni-trang-ngang.png, lưu tại `src/assets/brand/cmc-university-logo-white.png` (715×127).
  - Favicon: https://cmcu.edu.vn/wp-content/uploads/2022/12/cropped-favicon-3-192x192.jpg, lưu tại `public/cmc-favicon-192.jpg`.
  - Các file lấy từ trang chủ chính thức cmcu.edu.vn (cmc-u.edu.vn chuyển hướng 301 về đây).
- **Wordmark "CMC AI":** chữ phẳng, Be Vietnam Pro 700, 18px, màu mực, đặt dưới logo và ngăn bằng một đường kẻ 1px. Dòng phụ là "Giám sát phòng thi".
- **Vị trí:** sidebar (đổi giữa logo xanh và trắng theo nền), màn Đăng nhập (logo trắng trên nền mực), `<title>` "CMC AI – Giám sát phòng thi".
- Màu xanh của logo không dùng làm màu UI, để không trùng với mức "Thông tin" (xanh sky).

## 3. Các vấn đề chính của bản cũ

1. **Màu tím/indigo khắp nơi**, kèm gradient và glow ở nút, avatar, thanh tiến trình, hero đăng nhập và ô camera. Giao diện mang "AI look", và màu tím còn tranh chỗ với màu cảnh báo.
2. **Camera đơn bị tràn khung:** video chính đen hoặc bị đẩy, danh sách cảnh báo nằm dưới màn hình.
3. **Nút biểu tượng không có nhãn** (âm thanh, chuông, giao diện). Người dùng phải đoán chức năng.
4. **Còn nhãn tiếng Anh:** Dashboard, Camera offline, realtime, Precision/Recall, keypoints.
5. **Không có hành động chính rõ ràng:** Bảng điều khiển có thẻ quảng cáo thay cho thao tác.
6. **Trạng thái và mức dùng màu gần nhau**, khó phân biệt "Chưa xử lý" với các mức.
7. **Trang trí thừa:** emoji, icon lấp lánh, nháy đỏ (alarm glow), nền blur sau modal.
8. **Lưới camera:** banner "đã kết nối lại" che thanh công cụ, và chữ trong ô mất tín hiệu đè lên thanh vị trí.
9. **Phân tích:** danh sách cảnh báo nằm dưới màn hình, xa ảnh kết quả.
10. **Chữ nhỏ (12px)** ở bảng, trục biểu đồ và nhãn phụ; font không tự host nên dấu tiếng Việt không ổn định.

## 4. Token thiết kế

Toàn bộ token nằm ở đầu `src/styles/index.css`. Lớp ghi đè cuối file có tên "REDESIGN v3 – phẳng, tối giản".

### 4.1 Màu giao diện sáng

| Token | Giá trị | Dùng cho | Tương phản |
|---|---|---|---|
| `--bg` | `#F7F7F4` | Nền trang (giấy ấm) | – |
| `--card` | `#FFFFFF` | Thẻ, bảng | – |
| `--text` / `--primary` | `#1F2328` | Chữ chính, nút chính, mục nav đang chọn | 15.8:1 |
| `--text-2` | `#3D434B` | Chữ phụ đậm | 10.4:1 |
| `--muted` | `#59616B` | Chú thích, tiêu đề cột | 6.3:1 |
| `--border` | `#DEDED8` | Viền 1px | – |
| `--hover` | `#F0F0EC` | Hover, nền phụ | – |
| `--on-primary` | `#FFFFFF` | Chữ trên nút chính | – |

### 4.2 Màu khu giám sát (luôn tối, xám trung tính, không ánh xanh hay tím)

| Token | Giá trị |
|---|---|
| `--live-bg` | `#0F1113` |
| `--live-panel` | `#171A1D` |
| `--live-panel-2` | `#1F2327` |
| `--live-border` | `#2F353B` |
| `--live-text` | `#ECEEF0` |
| `--live-muted` | `#A3AAB2` (7.4:1) |

- Ở nền tối, nút chính đảo màu: nền `#ECEEF0`, chữ `#0F1113`.
- Giao diện tối toàn app (`[data-theme='dark']`) dùng cùng bộ xám này.

### 4.3 Mức cảnh báo (luôn kèm chữ và biểu tượng)

| Mức | Nền đặc | Chữ trên nền nhạt | Nền nhạt | Biểu tượng |
|---|---|---|---|---|
| **Cao** | `#D92D20` | `#B42318` | `#FEF3F2` | vòng tròn "!" |
| **Trung bình** | `#F79009` (chữ tối `#1F1300`) | `#B54708` | `#FFFAEB` | tam giác "!" |
| **Thông tin** | `#0B84C6` | `#026AA2` | `#F0F9FF` | chữ "i" |

### 4.4 Trạng thái xử lý (không trùng màu với mức)

| Trạng thái | Kiểu |
|---|---|
| Chưa xử lý | Viền mực 1px, chữ đậm, nền trắng |
| Đã xác nhận | Xanh lá: chữ `#146C43`, nền `#EDF7F1` |
| Đã bỏ qua | Xám: chữ `#59616B`, nền `#F0F0EC` |

### 4.5 Kiểu chữ

- **Font:** **Be Vietnam Pro** (400/500/600/700), tự host bằng `@fontsource/be-vietnam-pro`, có subset tiếng Việt. Font dự phòng: `'Segoe UI', system-ui, Roboto, Arial`. Đã kiểm tra dấu (ả, ữ, ộ, ỷ…) hiển thị đúng trong ảnh chụp.
- **Font mono:** dùng cho giờ, FPS và URL (`ui-monospace…`).
- **Thang cỡ chữ:** 13 / 14 / **15 (thân bài)** / 16 / 18 / 24 / 30px.
- Tiêu đề dùng weight 700 và letter-spacing −0.015em. Số liệu lớn là 30px, weight 700.

### 4.6 Khoảng cách, bo góc, bóng, focus

- **Khoảng cách:** lưới 4px (4, 8, 12, 16, 20, 24, 32).
- **Bo góc:** thẻ 10px, nút và input 8px, chip 6px, pill 999px.
- **Bóng:** không có. Riêng modal và dropdown dùng `0 8px 24px rgba(16,18,20,.14)`.
- **Focus:** `outline: 2px solid` mực và `offset 2px`. Trên nền tối, viền focus màu trắng.
- **Kích thước điều khiển:** nút cao 40px (nhỏ 34px, lớn 48px); topbar cao 64px; sidebar rộng 248px.

## 5. Component

- **Nút:** chính (nền mực đặc), phụ (viền 1px, nền trắng), quiet (nền trong suốt) và nguy hiểm. Không bóng, không hiệu ứng nhấn lún.
- **Nút ở topbar:** luôn có biểu tượng kèm chữ: "Âm báo: bật", "Cảnh báo" (kèm số đếm), "Giao diện tối/sáng". Chip kết nối ghi "Trực tiếp", "Đang kết nối…" hoặc "Mất kết nối".
- **Sidebar:** mục đang chọn có nền mực và chữ trắng. Mục con đang chọn có vạch trái 3px. Tiêu đề nhóm viết hoa, 13px.
- **Pill mức và trạng thái:** gồm biểu tượng, chữ và màu; cỡ 13px, đậm 600.
- **Thẻ số liệu:** nền nhạt phẳng, chỉ 3 sắc độ (trung tính, đỏ nhạt, xanh nhạt), số 30px, có sparkline dạng đường (không tô gradient).
- **Dòng cảnh báo:** có thumbnail, pill mức, giờ (mono), camera · phòng và câu "Nghi vấn: …". Ba nút có nhãn là Xem, Xác nhận (nút chính) và Bỏ qua. Mọi thao tác được ghi vào Lịch sử. Cảnh báo trùng được gộp.
- **Ô camera:** khi báo động, ô có **viền đỏ 3px cố định** (không nhấp nháy, không glow) và nhãn "Cao · N chưa xử lý". Thanh trên và dưới ô dùng nền mờ đặc, không gradient.
- **Thanh trượt:** dùng `input[range]` gốc với `accent-color` màu mực, phẳng, hỗ trợ bàn phím sẵn.
- **Modal:** nền tối mờ phẳng, không blur.
- **Banner mất kết nối:** đặt trên đầu nội dung, có tự kết nối lại và bộ đếm lần thử. Banner "Đã kết nối lại" nổi ở cạnh dưới, không che thanh công cụ.
- **Overlay phát hiện:**
  - Bốn lớp: Người, Điện thoại, Giấy, Máy tính. Màu lớp tránh đỏ, cam và sky.
  - Hỗ trợ khung bbox và OBB.
  - Khung xương 17 điểm: bên trái xanh, bên phải lime, thân vàng.
  - Đối tượng bị gắn cờ dùng màu theo mức.

## 6. Thay đổi theo màn hình

| Màn hình | Thay đổi | Hành động chính |
|---|---|---|
| **Đăng nhập** | Nửa trái nền mực phẳng có logo CMC trắng, chữ "CMC AI", ảnh minh hoạ thật và 3 điểm nổi bật. Form nằm trên nền giấy, có 2 thẻ tài khoản demo. | Đăng nhập |
| **Bảng điều khiển** | 4 thẻ số liệu phẳng. Hàng giữa gồm Cảnh báo gần đây (rộng nhất), Trạng thái camera và **Thao tác nhanh** (thay thẻ quảng cáo). Biểu đồ không gradient, chữ trục 13px. | Mở lưới camera |
| **Phân tích** | Cột trái để tải lên và chọn mẫu; cột phải là kết quả, ngay dưới là danh sách cảnh báo. Thay icon lấp lánh bằng icon ảnh/video. Chip đếm theo lớp. | Phân tích |
| **Camera đơn** | Khung được khoá theo chiều cao màn hình. Video chính chiếm khoảng 70%, cột phải (khoảng 30%) có video gốc và danh sách chuyển camera. Cảnh báo nằm bên dưới, có lọc theo camera và mức. Nhãn lớp phủ hiển thị dạng chữ. | Xác nhận |
| **Hệ thống camera** | Lưới 2×2 và 3×3, có lọc phòng, ưu tiên ô có cảnh báo, và luồng cảnh báo tổng hợp bên phải. Ô mất tín hiệu ghi rõ nguyên nhân. | Xác nhận (trong luồng) |
| **Lịch sử** | Bảng dày mà thoáng, chữ 14px. Bộ lọc nằm một hàng. Cột trạng thái ghi người xử lý. | Xuất CSV |
| **Mô hình** | Chỉ số tiếng Việt (Độ chính xác, Độ phủ). Biểu đồ cột dùng thang xám–mực thay cho xanh/tím. Bảng chỉ số theo lớp. | – (trang thông tin) |
| **Cài đặt › Quy tắc** | Mỗi quy tắc là một thẻ. Mức chọn bằng nút có chấm màu và chữ; dùng thanh trượt gốc. Thanh lưu dính đáy. | Lưu cấu hình |
| **Cài đặt › Camera** | Bảng có "Kiểm tra kết nối". Modal thêm camera báo lỗi URL rõ ràng. | Thêm camera |
| **Cài đặt › Người dùng** | Bảng vai trò Quản trị viên / Giám thị. | Thêm người dùng |
| **Không có quyền (403)** | Thông điệp ngắn và một nút quay lại. | Về trang chính |

## 7. Tham chiếu (chỉ mượn nguyên tắc, không mượn thương hiệu)

- **Linear:** màu chính đơn sắc (mực) thay cho màu thương hiệu sặc sỡ; thang chữ chặt; mục nav đang chọn dùng khối đặc.
- **Vercel dashboard:** bề mặt phẳng, viền 1px sắc, bảng màu xám trung tính, không bóng.
- **Stripe dashboard:** bảng dày mà thoáng (Lịch sử, Camera); pill trạng thái nhỏ, rõ, có biểu tượng.
- **Notion:** nền giấy ấm `#F7F7F4`, nhiều khoảng trắng, chữ thân bài to, dễ đọc.
- **Figma:** thanh công cụ có nhãn chữ cạnh biểu tượng (topbar, nút lớp phủ Khung / Khung xương / Nhãn / Độ tin cậy).
- **Verkada / Samsara:** console camera nền tối trung tính, màu chỉ dành cho sự cố; viền báo động cố định thay cho nhấp nháy; luồng cảnh báo gộp đặt cạnh lưới camera.

## 8. File đã thay đổi

- **Gốc dự án:**
  - `index.html`: title và favicon.
  - `package.json`: thêm `@fontsource/be-vietnam-pro`.
  - `public/cmc-favicon-192.jpg`.
- **Assets:** `src/assets/brand/*` (logo chính thức).
- **Style:** `src/styles/index.css` (token v3 và lớp ghi đè "REDESIGN v3"; đã bỏ toàn bộ gradient).
- **Khởi động:** `src/main.tsx` (nạp font).
- **Component UI và layout:**
  - `src/components/ui/Logo.tsx` (logo thật và wordmark), `Badges.tsx`.
  - `src/components/layout/AppLayout.tsx`, `Topbar.tsx`, `nav.ts`, `ConnectionBanner.tsx`.
- **Component cảnh báo, biểu đồ, video:**
  - `src/components/alerts/AlertRow.tsx`, `AlertDetailModal.tsx`.
  - `src/components/charts/Sparkline.tsx`.
  - `src/components/video/CameraFeed.tsx`.
- **Context và thư viện:**
  - `src/context/LiveContext.tsx`, `ThemeContext.tsx`.
  - `src/lib/labels.ts`, `overlay.ts`.
- **Trang:**
  - `src/pages/LoginPage.tsx`, `DashboardPage.tsx`, `DetectionPage.tsx`.
  - `LiveSinglePage.tsx`, `LiveGridPage.tsx`, `HistoryPage.tsx`, `ModelsPage.tsx`.
  - `settings/CamerasTab.tsx`.
- **Dữ liệu mô phỏng:** `src/services/mock/mockApi.ts` (nhãn mô hình tiếng Việt).

## 9. Ghi chú cho dev

- Build sạch: `npm run build` (gồm tsc --noEmit và vite build).
- Chỉ dùng token, không hard-code màu mới. Nếu cần thêm màu, hãy thêm token và ghi chú tỉ lệ tương phản.
- Không thêm gradient. Khi cần tách lớp, dùng viền 1px trước, bóng chỉ dành cho modal và dropdown.
- Nhãn kỹ thuật RTSP, FPS, mAP, AP50 và YOLO được giữ nguyên vì là thuật ngữ chuyên ngành.
- Email tài khoản demo vẫn là `@examguard.vn` vì đó là dữ liệu mock của backend.
