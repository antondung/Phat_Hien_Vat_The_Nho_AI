/* ===== Kiểu dữ liệu dùng chung giữa FE và (sau này) backend ===== */

export type Role = 'admin' | 'giam_thi';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  /** Chỉ dùng cho mock. Backend thật không bao giờ trả về mật khẩu. */
  password?: string;
  createdAt: number;
}

export interface Session {
  token: string;
  user: User;
}

/* ---------- Camera ---------- */
export type SourceType = 'rtsp' | 'webcam' | 'file' | 'phone' | 'http';
export type CameraPosition = 'truoc' | 'sau';

export interface Camera {
  id: string;
  name: string;
  room: string;
  position: CameraPosition;
  sourceType: SourceType;
  sourceUrl: string;
  enabled: boolean;
  createdAt: number;
}

export type DetectorState = 'running' | 'not_started' | 'error' | 'no_frames';

export interface CameraStatus {
  cameraId: string;
  online: boolean;
  fps: number;
  latencyMs: number;
  updatedAt: number;
  /** Tốc độ phân tích thực tế (gói detections/giây). Không dùng fps đọc video. */
  detectFps?: number;
  framesRead?: number;
  analysedFrames?: number;
  lastDetectTs?: number;
  lastObjects?: number;
  inferMs?: number;
  lastError?: string | null;
  detector?: DetectorState | string;
  roleEnabled?: boolean;
  roleInferMs?: number;
  roleEveryN?: number;
  roleCounts?: Partial<RoleCounts>;
  /** BE 15:10: đang bật lượt phóng vùng tay/bàn để tìm điện thoại nhỏ */
  phoneZoom?: boolean;
  phoneZoomInferMs?: number;
  phoneZoomCrops?: number;
  phoneZoomEveryN?: number;
}

/* ---------- Phát hiện (YOLO + Pose) ---------- */
/** person, phone, paper, calculator. Nhãn "cell phone" được ánh xạ về "phone". */
export type ObjClass = 'person' | 'phone' | 'paper' | 'calculator';

/** 'norm' = toạ độ chuẩn hoá 0..1 ; 'px' = pixel theo frame width/height */
export type CoordSpace = 'norm' | 'px';

/** [x1, y1, x2, y2] – góc trên trái và góc dưới phải, trục thẳng (axis-aligned) */
export type BBox = [number, number, number, number];
/** Danh sách đỉnh [x, y] – dùng cho hộp xoay (4 đỉnh) hoặc polygon */
export type Points = [number, number][];
/** [x, y, score] – 17 điểm theo thứ tự COCO */
export type Keypoint = [number, number, number];

export interface Detection {
  /** id ổn định theo track, vd "phone-12" */
  id: string;
  cls: ObjClass;
  conf: number;
  bbox: BBox;
  /** Tuỳ chọn: hộp xoay / polygon. Nếu có, ưu tiên vẽ theo points. */
  points?: Points;
  /** track id của thí sinh (person) mà vật thể thuộc về / gần nhất */
  trackId?: number;
  /** (chỉ person) vai trò từ model giám thị/thí sinh; thiếu = 'unknown' */
  role?: PersonRole;
  roleConf?: number;
  /** (chỉ person) nhãn BE gửi sẵn: "Giám thị" hoặc "#N" (chỉ thí sinh) */
  label?: string;
  /** = trackId với thí sinh / chưa rõ; null với giám thị */
  studentNo?: number | null;
  /** 'role' = người chỉ có từ box model vai trò (DET không thấy, không có khung xương).
   *  'zoom' = điện thoại tìm thấy nhờ phóng to vùng tay/bàn (không có trên khung đầy đủ). */
  source?: string;
}

/** Vai trò người trong khung: giám thị / thí sinh / chưa rõ (không có model vai trò) */
export type PersonRole = 'invigilator' | 'student' | 'unknown';
export interface RoleCounts {
  invigilator: number;
  student: number;
  unknown: number;
}

export interface PoseDet {
  trackId: number;
  conf: number;
  bbox: BBox;
  keypoints: Keypoint[]; // length 17
  role?: PersonRole;
  roleConf?: number;
  label?: string;
  studentNo?: number | null;
  source?: string;
}

export interface DetectionFrame {
  cameraId: string;
  frameId: number;
  ts: number; // epoch ms
  /** thời điểm khung được đọc/nhận (ms). FE hiện “Trễ … giây” = now - frameTs. */
  frameTs?: number;
  /** thời điểm máy chủ xong phân tích khung này (ms) */
  serverTs?: number;
  width: number;
  height: number;
  /** Kích thước khung nguồn (px); giống width/height, tên mới của BE. */
  frameW?: number;
  frameH?: number;
  coord: CoordSpace;
  objects: Detection[];
  poses: PoseDet[];
  /** Số người theo vai trò trong khung (BE: `roleCounts`); thiếu = FE tự đếm từ objects */
  roleCounts?: Partial<RoleCounts>;
  /** tên cũ / dự phòng của roleCounts */
  counts?: Partial<RoleCounts>;
  roleEnabled?: boolean;
  /** Chỉ gương ngang khi BE gửi true — FE không tự đảo. */
  mirror?: boolean;
  /** (chỉ ở FE) thời điểm trình duyệt nhận gói tin – để biết lớp phủ còn "tươi" không, không phụ thuộc đồng hồ máy chủ */
  receivedAt?: number;
}

/* ---------- Cảnh báo ---------- */
/** Loại cảnh báo có trong bảng quy tắc (PUT /api/rules) */
export type RuleAlertType = 'phone_near_hand' | 'phone_in_work_area' | 'paper_present' | 'calculator_present';
/** Mọi loại cảnh báo BE có thể gửi.
 *  `no_invigilator` (cấp phòng, trackId null) và `phone_on_desk` (Thông tin, trackId = #N)
 *  do BE tự bắn, không cấu hình được trong bảng Quy tắc. */
export type AlertType = RuleAlertType | 'no_invigilator' | 'phone_on_desk';
export type AlertLevel = 'cao' | 'trung_binh' | 'thong_tin';
export type AlertStatus = 'moi' | 'xac_nhan' | 'bo_qua';

export interface Alert {
  id: string;
  cameraId: string;
  cameraName: string;
  room: string;
  type: AlertType;
  level: AlertLevel;
  status: AlertStatus;
  /** null với cảnh báo cấp phòng (no_invigilator) */
  trackId: number | null;
  studentNo?: number | null;
  role?: PersonRole;
  label?: string;
  objectId?: string;
  confidence: number;
  /** thời điểm cảnh báo được bắn (sau khi tình huống kéo dài đủ lâu) */
  ts: number;
  /** thời điểm tình huống bắt đầu */
  startedAt: number;
  message: string;
  /** bbox (norm) của thí sinh và vật thể tại thời điểm cảnh báo */
  personBbox?: BBox;
  objectBbox?: BBox;
  snapshotUrl?: string;
  /**
   * Clip ngắn quanh cảnh báo.
   *  - string    : đã có clip (backend: "/media/alerts/<id>.mp4"; mock: "mock:replay" = phát lại mô phỏng)
   *  - null      : clip đang được ghép — sẽ có trong sự kiện `alert_update` sau vài giây
   *  - undefined : không có clip riêng (dữ liệu mock cũ) -> FE phát lại mô phỏng
   */
  clipUrl?: string | null;
  handledBy?: string;
  handledAt?: number;
  note?: string;
}

export interface AlertFilter {
  cameraId?: string;
  room?: string;
  type?: AlertType;
  level?: AlertLevel;
  status?: AlertStatus;
  from?: number;
  to?: number;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/* ---------- Quy tắc ---------- */
export interface RuleConfig {
  type: RuleAlertType;
  enabled: boolean;
  level: AlertLevel;
  minConfidence: number; // 0..1
  /** khoảng cách tối đa giữa tâm điện thoại và cổ tay, tính theo tỉ lệ chiều cao người */
  nearHandThreshold: number;
  persistSeconds: number;
}

export interface RoomOption {
  room: string;
  allowPaper: boolean;
  allowCalculator: boolean;
}

export interface RulesSettings {
  rules: RuleConfig[];
  rooms: RoomOption[];
  dedupeCooldownSeconds: number;
}

/* ---------- Thống kê ---------- */
export interface DashboardStats {
  camerasRunning: number;
  camerasTotal: number;
  alertsToday: number;
  confirmedToday: number;
  dismissedToday: number;
  trend: { alerts: number; confirmed: number; dismissed: number; cameras: number };
  spark: { alerts: number[]; confirmed: number[]; dismissed: number[]; cameras: number[] };
  perHour: { hour: string; total: number; cao: number }[];
  perType: { type: AlertType; count: number }[];
}

/* ---------- Phân tích ảnh/video ---------- */
export interface AnalysisFrame {
  t: number; // giây trong video (0 cho ảnh)
  objects: Detection[];
  poses: PoseDet[];
  roleCounts?: Partial<RoleCounts>;
  counts?: Partial<RoleCounts>;
  roleEnabled?: boolean;
}

export interface AnalysisAlert {
  id: string;
  t: number; // giây
  type: AlertType;
  level: AlertLevel;
  trackId: number | null;
  studentNo?: number | null;
  role?: PersonRole;
  label?: string;
  objectId?: string;
  confidence: number;
  message: string;
}

export interface AnalysisResult {
  id: string;
  fileName: string;
  mediaType: 'image' | 'video';
  width: number;
  height: number;
  coord: CoordSpace;
  duration: number;
  fps: number;
  model: { detector: string; pose: string };
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
  createdAt: number;
  /** (backend thật) ảnh/video đã phân tích, dạng /media/... – FE hiển thị cái này dưới lớp phủ */
  mediaUrl?: string;
}

export type AnalysisInput =
  | { kind: 'file'; file: File; width: number; height: number; duration: number }
  | { kind: 'sample-image' }
  | { kind: 'sample-video'; duration: number };

/** Job phân tích luồng (POST /api/analysis/jobs). `model` có thể là chuỗi hoặc {detector, pose}. */
export type AnalysisJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface AnalysisJob {
  jobId: string;
  fileName: string;
  mediaType: 'image' | 'video';
  mediaUrl?: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  model: { detector: string; pose: string };
  coord?: CoordSpace;
}

export interface AnalysisProgressEvent {
  type: 'progress';
  progress: number; // 0..1
  analysedSec: number;
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
}

export interface AnalysisDoneEvent {
  type: 'done';
  progress: 1;
  duration: number;
  totalFrames: number;
  totalAlerts: number;
}

export interface AnalysisErrorEvent {
  type: 'error';
  message: string;
}

export type AnalysisJobEvent = AnalysisProgressEvent | AnalysisDoneEvent | AnalysisErrorEvent;

/** GET /api/analysis/jobs/{jobId}?since=<giây> */
export interface AnalysisJobState {
  status: AnalysisJobStatus;
  progress: number;
  analysedSec: number;
  frames: AnalysisFrame[];
  alerts: AnalysisAlert[];
  message?: string;
  duration?: number;
  totalFrames?: number;
  totalAlerts?: number;
}

export interface ModelInfo {
  name: string;
  task: string;
  version: string;
  inputSize: string;
  classes: string[];
  fps: number;
  params: string;
  metrics: { label: string; value: number }[];
  perClass?: { cls: string; ap50: number; precision: number; recall: number }[];
  updatedAt: number;
}

/* ---------- Realtime ---------- */
export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface RealtimeEvents {
  detections: DetectionFrame;
  alert: Alert;
  alert_update: Alert;
  camera_status: CameraStatus[];
  connection: { state: ConnectionState; attempt: number; nextRetryMs?: number };
}
