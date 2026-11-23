/**
 * (chỉ chế độ mock) Gắn vai trò giám thị / thí sinh vào kết quả giả lập, theo đúng hợp đồng BE:
 * person + pose có role/roleConf, person có label ("Giám thị" | "#N"), khung có counts.
 * Chế độ thật không dùng file này.
 */
import type { Detection, PoseDet, RoleCounts } from '../../types';
import type { CameraScene } from '../../scene/sceneModel';

/** Chọn 1 người làm giám thị: không có điện thoại / giấy / máy tính trong kịch bản, ưu tiên người to nhất (gần camera). */
export function mockInvigilatorId(scene: CameraScene): number | undefined {
  const busy = new Set<number>([...scene.phones.map((p) => p.trackId), ...scene.statics.map((s) => s.trackId)]);
  const free = scene.actors.filter((a) => !busy.has(a.trackId));
  if (!free.length || scene.actors.length < 2) return undefined;
  return free.reduce((b, a) => (a.h > b.h ? a : b)).trackId;
}

export function withMockRoles<T extends { objects: Detection[]; poses: PoseDet[] }>(f: T, invId: number | undefined): T & { roleCounts: RoleCounts; roleEnabled: boolean } {
  const counts: RoleCounts = { invigilator: 0, student: 0, unknown: 0 };
  const conf = (id: number | undefined) => 0.86 + (((id ?? 0) * 37) % 11) / 100;
  const objects = f.objects.map((o) => {
    if (o.cls !== 'person') return o;
    const inv = o.trackId != null && o.trackId === invId;
    counts[inv ? 'invigilator' : 'student']++;
    return { ...o, role: inv ? 'invigilator' : 'student', roleConf: conf(o.trackId), label: inv ? 'Giám thị' : `#${o.trackId}`, studentNo: inv ? null : (o.trackId ?? null) } as Detection;
  });
  const poses = f.poses.map((p) => {
    const inv = p.trackId === invId;
    return { ...p, role: inv ? 'invigilator' : 'student', roleConf: conf(p.trackId), label: inv ? 'Giám thị' : `#${p.trackId}`, studentNo: inv ? null : p.trackId } as PoseDet;
  });
  return { ...f, objects, poses, roleCounts: counts, roleEnabled: true };
}
