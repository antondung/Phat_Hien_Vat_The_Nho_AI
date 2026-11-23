import { useState } from 'react';
import { CheckCircle2, Loader2, Pencil, Plus, Trash2, XCircle, PlugZap, Webcam, FileVideo, Radio, Smartphone, Globe } from 'lucide-react';
import { api, API_MODE } from '../../services';
import type { ConnectionTestResult, NewCamera } from '../../services/api';
import type { Camera, SourceType } from '../../types';
import { useLive } from '../../context/LiveContext';
import { useToast } from '../../context/ToastContext';
import { Card, Field, Toggle, Segmented, EmptyState } from '../../components/ui/Controls';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { OnlineDot } from '../../components/ui/Badges';
import { POSITION_LABEL, sourceLabel } from '../../lib/labels';
import { AddPhoneCameraModal } from './AddPhoneCameraModal';
import { AddCameraCta } from '../../components/ui/AddCameraCta';

const EMPTY: NewCamera = { name: '', room: '', position: 'truoc', sourceType: 'rtsp', sourceUrl: 'rtsp://', enabled: true };
const SRC_ICON: Record<SourceType, React.ReactNode> = { rtsp: <Radio size={14} />, webcam: <Webcam size={14} />, file: <FileVideo size={14} />, phone: <Smartphone size={14} />, http: <Globe size={14} /> };
const REAL = API_MODE === 'real';
const PLACEHOLDER: Record<SourceType, string> = { rtsp: 'rtsp://192.168.1.20:554/stream1', webcam: 'webcam://dshow/0 hoặc webcam://DroidCam Video', file: REAL ? '/duong-dan/phong-503.mp4 hoặc dataset://VPC2_202_1008' : 'videos/phong-503.mp4', phone: '', http: 'http://localhost:8080/video' };

function TestResult({ r }: { r: ConnectionTestResult }) {
  return (
    <div className={`test-result ${r.ok ? 'ok' : 'fail'}`}>
      {r.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      <div>
        <strong>{r.ok ? 'Kết nối thành công' : 'Kết nối thất bại'}</strong>
        <span>{r.message}</span>
        {r.ok && (
          <span className="small muted">
            {[r.resolution, r.fps ? `${Math.round(r.fps)} FPS` : '', r.latencyMs ? `độ trễ ${r.latencyMs} ms` : ''].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  );
}

export function CamerasTab() {
  const { cameras, statuses, reloadCameras } = useLive();
  const toast = useToast();
  const [edit, setEdit] = useState<{ id?: string; v: NewCamera } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [test, setTest] = useState<Record<string, ConnectionTestResult>>({});
  const [del, setDel] = useState<Camera | null>(null);
  const [saving, setSaving] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const rooms = [...new Set(cameras.map((c) => c.room))].sort();

  const runTest = async (key: string, v: { sourceType: SourceType; sourceUrl: string }) => {
    setTesting(key);
    try {
      const r = await api.cameras.testConnection(v);
      setTest((t) => ({ ...t, [key]: r }));
      if (key !== 'form') toast(r.ok ? 'Kết nối thành công' : r.message, r.ok ? 'success' : 'error');
    } finally {
      setTesting(null);
    }
  };

  const validate = (v: NewCamera) => {
    const e: Record<string, string> = {};
    if (!v.name.trim()) e.name = 'Nhập tên camera';
    if (!v.room.trim()) e.room = 'Nhập phòng thi';
    if (v.sourceType === 'rtsp' && !/^rtsps?:\/\/[^\s/]+/.test(v.sourceUrl) && !/^https?:\/\/[^\s/]+/.test(v.sourceUrl)) e.sourceUrl = 'URL RTSP/HTTP không hợp lệ';
    if (v.sourceType === 'http' && !/^https?:\/\/[^\s/]+/.test(v.sourceUrl)) e.sourceUrl = 'URL HTTP không hợp lệ';
    if (v.sourceType === 'file' && !v.sourceUrl.trim()) e.sourceUrl = 'Nhập đường dẫn tệp';
    if (v.sourceType === 'webcam' && !v.sourceUrl.trim()) e.sourceUrl = 'Nhập nguồn webcam (dùng đúng URL máy chủ trả về)';
    if (cameras.some((c) => c.name.toLowerCase() === v.name.trim().toLowerCase() && c.id !== edit?.id)) e.name = 'Tên camera đã tồn tại';
    return e;
  };

  const save = async () => {
    if (!edit) return;
    const v = { ...edit.v, name: edit.v.name.trim(), room: edit.v.room.trim(), sourceUrl: edit.v.sourceUrl.trim() };
    const e = validate(v);
    setErrs(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      if (edit.id) await api.cameras.update(edit.id, v);
      else await api.cameras.create(v);
      await reloadCameras();
      toast(edit.id ? 'Đã cập nhật camera' : 'Đã thêm camera');
      setEdit(null);
    } catch (err) {
      toast((err as Error).message || 'Không lưu được', 'error');
    } finally {
      setSaving(false);
    }
  };

  const open = (c?: Camera) => {
    setErrs({});
    setTest((t) => ({ ...t, form: undefined as unknown as ConnectionTestResult }));
    setEdit(c ? { id: c.id, v: { name: c.name, room: c.room, position: c.position, sourceType: c.sourceType, sourceUrl: c.sourceUrl, enabled: c.enabled } } : { v: { ...EMPTY } });
  };
  const f = edit?.v;
  const setF = (p: Partial<NewCamera>) => edit && setEdit({ ...edit, v: { ...edit.v, ...p } });

  return (
    <Card
      title={`Danh sách camera (${cameras.length})`}
      pad={false}
      actions={
        <div className="row gap-8">
          <button className="btn btn-ghost btn-sm" onClick={() => setPhoneOpen(true)}>
            <Smartphone size={16} /> Thêm camera điện thoại
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => open()}>
            <Plus size={16} /> Thêm camera
          </button>
        </div>
      }
    >
      {cameras.length === 0 && (
        <EmptyState title="Chưa có camera" text="Chưa có dữ liệu. Thêm camera hoặc kết nối điện thoại để bắt đầu — chế độ thật không dùng dữ liệu mẫu.">
          <AddCameraCta compact />
        </EmptyState>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Camera</th>
              <th>Phòng</th>
              <th>Vị trí</th>
              <th>Nguồn</th>
              <th>Trạng thái</th>
              <th className="right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {cameras.map((c) => {
              const s = statuses[c.id];
              const on = c.enabled && (s?.online ?? false);
              const tr = test[c.id];
              return (
                <tr key={c.id}>
                  <td>
                    <div className="strong">{c.name}</div>
                    <div className="muted tiny mono">{c.id}</div>
                  </td>
                  <td>
                    <span className="chip chip-blue">{c.room}</span>
                  </td>
                  <td>{POSITION_LABEL[c.position]}</td>
                  <td>
                    <div className="row gap-4">
                      {SRC_ICON[c.sourceType]} {sourceLabel(c.sourceType)}
                    </div>
                    <div className="muted tiny mono ellipsis" title={c.sourceUrl}>
                      {c.sourceUrl}
                    </div>
                  </td>
                  <td>
                    {c.enabled ? <OnlineDot online={on} label={on ? 'Trực tuyến' : 'Ngoại tuyến'} /> : <span className="chip chip-gray">Đã tắt</span>}
                    {tr && <div className={`tiny ${tr.ok ? 'text-ok' : 'text-bad'}`}>{tr.ok ? 'Kiểm tra: OK' : 'Kiểm tra: lỗi'}</div>}
                  </td>
                  <td className="right nowrap">
                    <button className="btn btn-ghost btn-sm" disabled={testing === c.id} onClick={() => runTest(c.id, c)}>
                      {testing === c.id ? <Loader2 size={14} className="spin" /> : <PlugZap size={14} />} Kiểm tra kết nối
                    </button>
                    <button className="icon-btn" onClick={() => open(c)} aria-label="Sửa" title="Sửa">
                      <Pencil size={16} />
                    </button>
                    <button className="icon-btn bad" onClick={() => setDel(c)} aria-label="Xoá" title="Xoá">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!edit}
        title={edit?.id ? 'Sửa camera' : 'Thêm camera'}
        onClose={() => setEdit(null)}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>
              Huỷ
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving && <Loader2 size={16} className="spin" />} Lưu
            </button>
          </>
        }
      >
        {f && (
          <div className="form-grid">
            <Field label="Tên camera" error={errs.name}>
              <input className="input" value={f.name} onChange={(e) => setF({ name: e.target.value })} placeholder="VD: CAM 10" autoFocus />
            </Field>
            <Field label="Phòng thi" error={errs.room}>
              <input className="input" list="room-list" value={f.room} onChange={(e) => setF({ room: e.target.value })} placeholder="VD: P.503.1" />
              <datalist id="room-list">
                {rooms.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </Field>
            <Field label="Vị trí đặt">
              <Segmented
                value={f.position}
                onChange={(v) => setF({ position: v })}
                options={[
                  { value: 'truoc', label: 'Phía trước' },
                  { value: 'sau', label: 'Phía sau' },
                ]}
              />
            </Field>
            <Field label="Loại nguồn">
              {f.sourceType === 'phone' || f.sourceType === 'http' ? (
                <p className="muted">{sourceLabel(f.sourceType)}</p>
              ) : (
              <Segmented
                value={f.sourceType}
                onChange={(v) => setF({ sourceType: v, sourceUrl: v === 'rtsp' ? 'rtsp://' : v === 'webcam' ? 'webcam://0' : '' })}
                options={[
                  { value: 'rtsp', label: 'RTSP' },
                  { value: 'webcam', label: 'Webcam' },
                  { value: 'file', label: 'Tệp video' },
                ]}
              />
              )}
            </Field>
            {f.sourceType !== 'webcam' && f.sourceType !== 'phone' && f.sourceType !== 'http' && (
              <Field label={f.sourceType === 'rtsp' ? 'URL RTSP' : 'Đường dẫn tệp'} error={errs.sourceUrl} hint={f.sourceType === 'rtsp' ? (REAL ? 'Máy chủ sẽ mở luồng RTSP này để chạy mô hình' : 'Mô phỏng: địa chỉ 10.0.0.x được coi là không kết nối được') : REAL ? 'Đường dẫn trên máy chủ (mp4, avi, mov, mkv…) hoặc dataset://<tên video> để phát lại dataset' : 'mp4, avi, mov, mkv, webm'}>
                <input className="input mono" value={f.sourceUrl} onChange={(e) => setF({ sourceUrl: e.target.value })} placeholder={PLACEHOLDER[f.sourceType]} />
              </Field>
            )}
            {f.sourceType === 'webcam' && (
              <Field label="Thiết bị webcam" hint={REAL ? 'Số thiết bị trên máy chạy backend, ví dụ webcam://0. Với điện thoại, nên dùng nút “Thêm camera điện thoại”.' : 'Dùng webcam của máy đang mở trình duyệt.'}>
                <input className="input mono" value={f.sourceUrl} onChange={(e) => setF({ sourceUrl: e.target.value })} placeholder="webcam://0" />
              </Field>
            )}
            {f.sourceType === 'phone' && <p className="muted small span-all">Camera điện thoại (đẩy hình). Để lấy mã QR mới hãy dùng “Thêm camera điện thoại” — backend hiện tạo camera mới kèm token.</p>}
            {f.sourceType === 'http' && (
              <Field label="Địa chỉ luồng HTTP" error={errs.sourceUrl}>
                <input className="input mono" value={f.sourceUrl} onChange={(e) => setF({ sourceUrl: e.target.value })} placeholder={PLACEHOLDER.http} />
              </Field>
            )}
            <div className="span-all row gap-12 wrap">
              <button className="btn btn-ghost" disabled={testing === 'form'} onClick={() => runTest('form', f)}>
                {testing === 'form' ? <Loader2 size={16} className="spin" /> : <PlugZap size={16} />} Kiểm tra kết nối
              </button>
              <Toggle checked={f.enabled} onChange={(v) => setF({ enabled: v })} label="Bật camera" />
            </div>
            {test.form && (
              <div className="span-all">
                <TestResult r={test.form} />
              </div>
            )}
          </div>
        )}
      </Modal>
      <AddPhoneCameraModal open={phoneOpen} onClose={() => setPhoneOpen(false)} />
      <ConfirmModal
        open={!!del}
        title="Xoá camera"
        message={
          <>
            Xoá <strong>{del?.name}</strong> ({del?.room})? Lịch sử cảnh báo của camera vẫn được giữ lại.
          </>
        }
        confirmText="Xoá"
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          const d = del!;
          setDel(null);
          try {
            await api.cameras.remove(d.id);
            await reloadCameras();
            toast(`Đã xoá ${d.name}`);
          } catch (err) {
            toast((err as Error).message || 'Không xoá được', 'error');
          }
        }}
      />
    </Card>
  );
}
