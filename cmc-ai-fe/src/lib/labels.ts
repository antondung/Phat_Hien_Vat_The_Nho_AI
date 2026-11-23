import type { AlertLevel, AlertStatus, AlertType, CameraPosition, ObjClass, Role, RuleAlertType, SourceType } from '../types';

/** Lưu ý quy ước: chỉ dùng ngôn từ trung tính. Mọi nội dung cảnh báo bắt đầu bằng "Nghi vấn: …"; mức chỉ có Cao / Trung bình / Thông tin. */

export const LEVEL_LABEL: Record<AlertLevel, string> = {
  cao: 'Cao',
  trung_binh: 'Trung bình',
  thong_tin: 'Thông tin',
};

export const LEVEL_COLOR: Record<AlertLevel, string> = {
  // Đồng bộ với token --lv-*-solid trong styles/index.css
  cao: '#EF4444',
  trung_binh: '#F59E0B',
  thong_tin: '#0EA5E9',
};

export const LEVEL_ORDER: Record<AlertLevel, number> = { cao: 0, trung_binh: 1, thong_tin: 2 };

export const TYPE_LABEL: Record<AlertType, string> = {
  phone_near_hand: 'Điện thoại gần tay',
  phone_in_work_area: 'Điện thoại trong vùng làm bài',
  paper_present: 'Có giấy / tài liệu',
  calculator_present: 'Có máy tính cầm tay',
  no_invigilator: 'Không thấy giám thị trong phòng',
  phone_on_desk: 'Điện thoại trên bàn của thí sinh',
};

/** Các loại có trong bảng Quy tắc (no_invigilator, phone_on_desk do BE tự bắn, không cấu hình ở đây) */
export const RULE_TYPES: RuleAlertType[] = ['phone_near_hand', 'phone_in_work_area', 'paper_present', 'calculator_present'];

export const TYPE_SHORT: Record<AlertType, string> = {
  phone_near_hand: 'ĐT gần tay',
  phone_in_work_area: 'ĐT vùng làm bài',
  paper_present: 'Giấy',
  calculator_present: 'Máy tính',
  no_invigilator: 'Không có GT',
  phone_on_desk: 'ĐT trên bàn',
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  moi: 'Chưa xử lý',
  xac_nhan: 'Đã xác nhận',
  bo_qua: 'Đã bỏ qua',
};

export const CLASS_LABEL: Record<ObjClass, string> = {
  person: 'Người',
  phone: 'Điện thoại',
  paper: 'Giấy',
  calculator: 'Máy tính',
};

export const CLASS_COLOR: Record<ObjClass, string> = {
  // Bảng màu lớp tránh đỏ/cam/xanh-sky (dành riêng cho mức cảnh báo) và không dùng tím.
  // Máy tính = nâu ấm trung tính, tách rõ khỏi cả 3 mức và các lớp khác (sáng & tối).
  person: '#22C55E',
  phone: '#F472B6',
  paper: '#2DD4BF',
  calculator: '#8B5E3C',
};

/** Màu chữ trên nhãn lớp (đạt tương phản trên nền màu lớp) */
export const CLASS_ON: Record<ObjClass, string> = {
  person: '#0B1220',
  phone: '#0B1220',
  paper: '#0B1220',
  calculator: '#FFFFFF',
};

export const ROLE_LABEL: Record<Role, string> = { admin: 'Quản trị viên', giam_thi: 'Giám thị' };
export const SOURCE_LABEL: Record<SourceType, string> = { rtsp: 'RTSP', webcam: 'Webcam', file: 'Tệp video', phone: 'Điện thoại', http: 'Luồng HTTP' };
export const sourceLabel = (t: string) => SOURCE_LABEL[t as SourceType] ?? t;
export const POSITION_LABEL: Record<CameraPosition, string> = { truoc: 'Phía trước', sau: 'Phía sau' };

/** Ánh xạ tên lớp từ model/nhãn về 4 lớp chuẩn ("cell phone" -> "phone") */
export function normalizeClass(raw: string): ObjClass | null {
  const s = raw.trim().toLowerCase();
  if (s === 'cell phone' || s === 'cellphone' || s === 'mobile phone' || s === 'phone') return 'phone';
  if (s === 'person' || s === 'paper' || s === 'calculator') return s;
  return null;
}

export function alertMessage(type: AlertType, trackId: number | null): string {
  switch (type) {
    case 'no_invigilator':
      return 'Nghi vấn: không thấy giám thị trong phòng';
    case 'phone_on_desk':
      return `Nghi vấn: điện thoại trên bàn của thí sinh #${trackId}`;
    case 'phone_near_hand':
      return `Nghi vấn: điện thoại gần tay thí sinh #${trackId}`;
    case 'phone_in_work_area':
      return `Nghi vấn: điện thoại trong vùng làm bài của #${trackId}`;
    case 'paper_present':
      return `Nghi vấn: có giấy/tài liệu tại chỗ #${trackId}`;
    case 'calculator_present':
      return `Nghi vấn: có máy tính cầm tay tại chỗ #${trackId}`;
  }
}

/** Nhãn loại cảnh báo, chịu được loại mới từ BE (vd "không thấy giám thị trong phòng"): lấy từ message bỏ tiền tố "Nghi vấn:". */
export function typeLabel(type: string, message?: string): string {
  const known = (TYPE_LABEL as Record<string, string>)[type];
  if (known) return known;
  const m = (message ?? '').replace(/^\s*Nghi vấn\s*:\s*/i, '').trim();
  if (m) return m.charAt(0).toUpperCase() + m.slice(1);
  return type ? type.replace(/_/g, ' ') : 'Khác';
}

export function typeShort(type: string): string {
  return (TYPE_SHORT as Record<string, string>)[type] ?? typeLabel(type);
}

/** Cảnh báo cấp phòng (vd không thấy giám thị) không gắn với thí sinh nào. */
export function hasTrack(trackId: unknown): trackId is number {
  return typeof trackId === 'number' && Number.isFinite(trackId) && trackId >= 0;
}

/** "#N" hoặc "—" khi cảnh báo không gắn với thí sinh */
export function trackText(trackId: unknown): string {
  return hasTrack(trackId) ? `#${trackId}` : '—';
}
