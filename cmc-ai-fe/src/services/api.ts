/**
 * HỢP ĐỒNG GIỮA UI VÀ BACKEND.
 * UI chỉ phụ thuộc vào 2 interface dưới đây. Có 2 bản cài đặt:
 *  - services/mock/*  : giả lập hoàn toàn trên trình duyệt (mặc định)
 *  - services/http/*  : gọi REST + WebSocket của backend thật (xem API_CONTRACT.md)
 */
import type {
  Alert, AlertFilter, AlertStatus, AnalysisDoneEvent, AnalysisErrorEvent, AnalysisInput, AnalysisJob,
  AnalysisJobState, AnalysisProgressEvent, AnalysisResult, Camera, CameraStatus, ConnectionState,
  DashboardStats, ModelInfo, Paged, RealtimeEvents, RulesSettings, Session, SourceType, User,
} from '../types';

export type NewCamera = Omit<Camera, 'id' | 'createdAt'>;
export type NewUser = Omit<User, 'id' | 'createdAt'>;

export interface ConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
  resolution?: string;
  fps?: number;
  hasPicture?: boolean;
  /** Ảnh kiểm tra (data URL / base64 / URL) nếu backend gửi — dùng phát hiện khung xanh */
  snapshot?: string;
  snapshotUrl?: string;
  preview?: string;
}

/** Webcam mà máy chạy backend đang thấy (GET /api/sources/webcams) */
export interface WebcamInfo {
  index: number;
  name: string;
  url?: string;
  /** "dshow" | "msmf" | "v4l2" | "auto" */
  backend?: string;
  /** Mở theo tên thiết bị (ổn định hơn chỉ số). Ưu tiên với DroidCam Video. */
  urlByName?: string;
  width?: number;
  height?: number;
  inUse?: boolean;
  /** false = mở được nhưng chỉ ra khung màu đặc (xanh/đen) — không nên chọn. */
  hasPicture?: boolean;
}

/** Kết quả POST /api/cameras/phone — dùng cho tab Quét mã QR */
export interface PhoneCameraCreated {
  camera: Camera;
  pushToken: string;
  pushPath: string;
  expiresInSec: number;
}

export type ProgressFn = (percent: number, stage: string) => void;

export type AnalysisJobHandler = {
  onProgress: (e: AnalysisProgressEvent) => void;
  onDone: (e: AnalysisDoneEvent) => void;
  onError: (e: AnalysisErrorEvent) => void;
};


export interface ApiClient {
  auth: {
    login(email: string, password: string): Promise<Session>;
    logout(): Promise<void>;
    me(): Promise<Session | null>;
  };
  cameras: {
    list(): Promise<Camera[]>;
    create(c: NewCamera): Promise<Camera>;
    update(id: string, patch: Partial<NewCamera>): Promise<Camera>;
    remove(id: string): Promise<void>;
    testConnection(src: { sourceType: SourceType; sourceUrl: string; cameraId?: string }): Promise<ConnectionTestResult>;
    status(): Promise<CameraStatus[]>;
    /** Danh sách webcam trên máy chạy BE. Thiếu API → trả [] để FE dùng bộ chọn 0..3. */
    listWebcams(): Promise<WebcamInfo[]>;
    /** Tạo camera điện thoại (đẩy hình) và token ngắn hạn để nhúng vào mã QR. */
    createPhone(body?: { name?: string; room?: string; position?: Camera['position'] }): Promise<PhoneCameraCreated>;
    /** Chẩn đoán model trên một camera (GET /api/cameras/{id}/diag). */
    diag(id: string): Promise<CameraStatus>;
  };
  alerts: {
    list(filter: AlertFilter): Promise<Paged<Alert>>;
    recent(limit: number): Promise<Alert[]>;
    get(id: string): Promise<Alert | null>;
    updateStatus(id: string, status: AlertStatus, note?: string): Promise<Alert>;
  };
  rules: {
    get(): Promise<RulesSettings>;
    update(s: RulesSettings): Promise<RulesSettings>;
    reset(): Promise<RulesSettings>;
  };
  users: {
    list(): Promise<User[]>;
    create(u: NewUser): Promise<User>;
    update(id: string, patch: Partial<NewUser>): Promise<User>;
    remove(id: string): Promise<void>;
  };
  stats: {
    dashboard(): Promise<DashboardStats>;
  };
  analysis: {
    /** API cũ: chờ phân tích xong mới trả. Giữ làm đường dự phòng / tương thích. */
    analyze(input: AnalysisInput, onProgress: ProgressFn, signal?: AbortSignal): Promise<AnalysisResult>;
    /** Tạo job, trả về ngay để phát media trong lúc phân tích. */
    startJob(input: AnalysisInput, signal?: AbortSignal): Promise<AnalysisJob>;
    getJob(jobId: string, since?: number): Promise<AnalysisJobState>;
    cancelJob(jobId: string): Promise<void>;
    /** WS /ws/analysis/{jobId}; lỗi/rớt thì phía trong tự chuyển sang poll GET. Trả hàm huỷ đăng ký (không huỷ job). */
    subscribeJob(jobId: string, handler: AnalysisJobHandler): () => void;
  };
  models: {
    list(): Promise<ModelInfo[]>;
  };
  /** Thống kê model runtime từ BE. null = endpoint chưa có (404). */
  system: {
    model(cameraId?: string): Promise<SystemModelPayload | null>;
    health(): Promise<SystemHealthPayload | null>;
  };
}

/** GET /api/system/model. Trường chính thức + alias cũ (tuỳ chọn). */
export type SystemModelPayload = {
  detModel?: string;
  poseModel?: string;
  classes?: string[] | unknown;
  device?: string;
  imgSize?: number;
  conf?: number;
  iou?: number;
  detectFps?: number;
  fallback?: boolean | string;
} & Record<string, unknown>;
export type SystemHealthPayload = { ok?: boolean; detector?: string; cameras?: number; device?: string; error?: string; message?: string };

/** Kênh realtime kiểu WebSocket: detections, alert, alert_update, camera_status, connection */
export interface RealtimeClient {
  connect(token?: string): void;
  disconnect(): void;
  readonly state: ConnectionState;
  on<K extends keyof RealtimeEvents>(type: K, cb: (payload: RealtimeEvents[K]) => void): () => void;
  /** Chỉ có ở bản mock – để demo banner mất kết nối */
  simulateDrop?(): void;
}
