/**
 * Vai trò người trong khung (model giám thị / thí sinh của BE).
 * Hợp đồng BE (API_CHANGES §12): mỗi person (objects) và mỗi phần tử poses có `role`, `roleConf`,
 * `label` ("#N" hoặc "Thí sinh #N" / "Giám thị"), `studentNo` (= trackId, null với giám thị), `source:'role'` (chỉ có box vai trò).
 * Gói detections có `roleEnabled` + `roleCounts: {invigilator, student, unknown}` (`counts` là tên dự phòng).
 * GET /api/system/model có roleEnabled, roleModel, roleClasses, roleImgSize, roleEveryN, roleInferMs, roleError…
 * Thiếu trường nào cũng không sao: coi như 'unknown' và giao diện giữ nguyên như cũ.
 */
import type { Detection, PersonRole, PoseDet, RoleCounts } from '../types';
import type { SystemModelPayload } from '../services/api';

/** Xám trung tính cho giám thị — không dùng đỏ / cam / xanh trời (dành cho 3 mức cảnh báo). */
export const INVIGILATOR_COLOR = '#9CA3AF';
export const INVIGILATOR_ON = '#111418';
export const INVIGILATOR_LABEL = 'Giám thị';
export const STUDENT_LABEL = 'Thí sinh';

/** Bỏ dấu tiếng Việt để nhận cả "Thi sinh" / "Giam thi" và không đếm trùng tiền tố. */
export function foldVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

export function normRole(v: unknown): PersonRole {
  if (typeof v !== 'string') return 'unknown';
  const s = foldVi(v.trim()).replace(/[\s-]+/g, '_');
  if (s === 'invigilator' || s === 'teacher' || s === 'giam_thi' || s === 'proctor' || s === 'giamthi') return 'invigilator';
  if (s === 'student' || s === 'thi_sinh' || s === 'thisinh' || s === 'candidate') return 'student';
  return 'unknown';
}

/** Đọc vai trò đã viết sẵn trong nhãn BE ("Giám thị", "Thí sinh #3") — cả bản có dấu và không dấu. */
export function roleFromLabel(label: unknown): PersonRole {
  if (typeof label !== 'string' || !label.trim()) return 'unknown';
  const f = foldVi(label);
  if (/(?:^|\b)giam\s*thi(?:\b|$)/.test(f) || /\binvigilator\b/.test(f)) return 'invigilator';
  if (/(?:^|\b)thi\s*sinh(?:\b|$)/.test(f) || /\bstudent\b/.test(f)) return 'student';
  return 'unknown';
}

export function inferPersonRole(d: { role?: unknown; label?: string }, fallbacks?: { role?: unknown; label?: string }[]): PersonRole {
  const direct = normRole(d.role);
  if (direct !== 'unknown') return direct;
  const fromLabel = roleFromLabel(d.label);
  if (fromLabel !== 'unknown') return fromLabel;
  for (const f of fallbacks ?? []) {
    const r = inferPersonRole(f);
    if (r !== 'unknown') return r;
  }
  return 'unknown';
}

export const isInvigilator = (d: Pick<Detection, 'role' | 'label'> | Pick<PoseDet, 'role' | 'label'> | undefined) =>
  !!d && inferPersonRole(d) === 'invigilator';

/** Lấy "#N" từ nhãn hoặc trackId — không giữ tiền tố vai trò (tránh "Thí sinh Thí sinh #3"). */
export function personHash(d: { label?: string; studentNo?: number | null; trackId?: number }): string {
  const m = typeof d.label === 'string' ? d.label.match(/#\s*(\d+|\?)/) : null;
  if (m) return `#${m[1]}`;
  const no = d.studentNo ?? d.trackId;
  return no != null ? `#${no}` : '#?';
}

/**
 * Nhãn khung người, luôn có chữ vai trò:
 *  - giám thị: "Giám thị"
 *  - thí sinh / thiếu role / chưa rõ: "Thí sinh #N"
 * Nhận cả nhãn cũ "#N" và nhãn mới "Thí sinh #N" / "Giám thị" từ BE, không ghép trùng tiền tố.
 */
export function personLabel(d: { role?: unknown; label?: string; studentNo?: number | null; trackId?: number }): string {
  if (inferPersonRole(d) === 'invigilator') return INVIGILATOR_LABEL;
  return `${STUDENT_LABEL} ${personHash(d)}`;
}

/** Nhãn người trong danh sách cảnh báo / kết quả; null nếu cảnh báo cấp phòng (không gắn người). */
export function alertPersonLabel(a: { role?: unknown; label?: string; studentNo?: number | null; trackId?: number | null }): string | null {
  if (a.trackId == null && a.studentNo == null && inferPersonRole(a) === 'unknown') return null;
  return personLabel({ role: a.role, label: a.label, studentNo: a.studentNo, trackId: a.trackId ?? undefined });
}

/** Bổ sung role từ nhãn hoặc pose cùng trackId khi object person thiếu / unknown. */
export function withInferredRoles<T extends Detection>(objects: T[], poses?: PoseDet[]): T[] {
  const byTrack = new Map<number, PersonRole>();
  for (const p of poses ?? []) {
    const r = inferPersonRole(p);
    if (p.trackId != null && r !== 'unknown') byTrack.set(p.trackId, r);
  }
  let changed = false;
  const out = objects.map((o) => {
    if (o.cls !== 'person') return o;
    const inferred = inferPersonRole(o, o.trackId != null && byTrack.has(o.trackId) ? [{ role: byTrack.get(o.trackId) }] : undefined);
    if (inferred === 'unknown' || inferred === normRole(o.role)) return o;
    changed = true;
    return { ...o, role: inferred };
  });
  return changed ? out : objects;
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined);

/** Đếm người theo vai trò: dùng `counts` của BE nếu có, không thì đếm từ person trong objects. */
type CountSrc = { objects?: Detection[]; roleCounts?: Partial<RoleCounts> | null; counts?: Partial<RoleCounts> | null };
const hasCounts = (c: Partial<RoleCounts> | null | undefined): c is Partial<RoleCounts> =>
  !!c && typeof c === 'object' && (n(c.invigilator) != null || n(c.student) != null);

export function roleCounts(f: CountSrc | undefined | null): RoleCounts {
  const c = hasCounts(f?.roleCounts) ? f?.roleCounts : f?.counts;
  if (hasCounts(c)) {
    return { invigilator: n(c.invigilator) ?? 0, student: n(c.student) ?? 0, unknown: n(c.unknown) ?? 0 };
  }
  const out: RoleCounts = { invigilator: 0, student: 0, unknown: 0 };
  for (const o of f?.objects ?? []) if (o.cls === 'person') out[normRole(o.role)]++;
  return out;
}

/** Chỉ hiện ô đếm khi BE bật model vai trò, hoặc khung đã có ít nhất một người được phân vai. */
export function showRoleCounts(c: RoleCounts, roleEnabled?: boolean | null): boolean {
  return roleEnabled === true || c.invigilator + c.student > 0;
}

export interface RoleModelInfo {
  enabled: boolean;
  model?: string;
  /** tên lớp của model (vd teacher, student) */
  classes: string[];
  /** lớp model → vai trò (vd teacher → invigilator) nếu BE gửi dạng object */
  mapping: Record<string, string>;
  imgSize?: number;
  conf?: number;
  everyN?: number;
  adaptive?: boolean;
  inferMs?: number;
  error?: string;
}

export function readRoleModel(raw: SystemModelPayload | null | undefined): RoleModelInfo {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const model = str(r.roleModel);
  let classes: string[] = [];
  let mapping: Record<string, string> = {};
  const rc = r.roleClasses;
  if (Array.isArray(rc)) {
    classes = rc.map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' && 'name' in x ? String((x as { name: unknown }).name) : '')).filter(Boolean);
  } else if (rc && typeof rc === 'object') {
    mapping = Object.fromEntries(Object.entries(rc as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
    classes = Object.keys(mapping);
  }
  // roleModelNames: {0:'student',1:'teacher'} hoặc mảng — dùng khi roleClasses trống
  if (!classes.length) {
    const names = r.roleModelNames;
    if (Array.isArray(names)) classes = names.map(String);
    else if (names && typeof names === 'object') classes = Object.values(names as Record<string, unknown>).map(String);
  }
  return {
    enabled: r.roleEnabled === true,
    model,
    classes,
    mapping,
    imgSize: num(r.roleImgSize),
    conf: num(r.roleConf),
    everyN: num(r.roleEveryN),
    adaptive: typeof r.roleAdaptive === 'boolean' ? r.roleAdaptive : undefined,
    inferMs: num(r.roleInferMs),
    error: str(r.roleError),
  };
}

/** Tên lớp vai trò → tiếng Việt */
export function roleClassLabel(c: string, mapped?: string): string {
  const r = normRole(mapped ?? c);
  return r === 'invigilator' ? 'Giám thị' : r === 'student' ? 'Thí sinh' : c;
}
