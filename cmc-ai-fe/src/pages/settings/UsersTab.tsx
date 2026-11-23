import { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2, Search } from 'lucide-react';
import { api } from '../../services';
import type { NewUser } from '../../services/api';
import type { Role, User } from '../../types';
import { Card, Field, Segmented, Toggle } from '../../components/ui/Controls';
import { Modal, ConfirmModal } from '../../components/ui/Modal';
import { Avatar } from '../../components/layout/Sidebar';
import { ROLE_LABEL } from '../../lib/labels';
import { fmtDate } from '../../lib/format';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';

const EMPTY: NewUser = { name: '', email: '', role: 'giam_thi', active: true, password: '' };

export function UsersTab() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<{ id?: string; v: NewUser } | null>(null);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [del, setDel] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const load = () => api.users.list().then(setUsers);
  useEffect(() => {
    void load();
  }, []);

  const f = edit?.v;
  const setF = (p: Partial<NewUser>) => edit && setEdit({ ...edit, v: { ...edit.v, ...p } });
  const list = users.filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    if (!edit) return;
    const v = { ...edit.v, name: edit.v.name.trim(), email: edit.v.email.trim().toLowerCase() };
    const e: Record<string, string> = {};
    if (!v.name) e.name = 'Nhập họ tên';
    if (!/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Email không hợp lệ';
    else if (users.some((u) => u.email === v.email && u.id !== edit.id)) e.email = 'Email đã được dùng';
    if (!edit.id && (v.password ?? '').length < 6) e.password = 'Mật khẩu tối thiểu 6 ký tự';
    if (edit.id && v.password && v.password.length < 6) e.password = 'Mật khẩu tối thiểu 6 ký tự';
    if (edit.id === me?.id && (v.role !== 'admin' || !v.active)) e.role = 'Không thể hạ quyền hoặc khoá chính tài khoản đang đăng nhập';
    setErrs(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      const patch = { ...v };
      if (edit.id && !patch.password) delete patch.password;
      if (edit.id) await api.users.update(edit.id, patch);
      else await api.users.create(patch);
      await load();
      toast(edit.id ? 'Đã cập nhật người dùng' : 'Đã thêm người dùng');
      setEdit(null);
    } catch (err) {
      toast((err as Error).message || 'Không lưu được', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={`Người dùng (${users.length})`}
      pad={false}
      actions={
        <>
          <div className="input-icon search-sm">
            <Search size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, email…" aria-label="Tìm người dùng" />
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => {
              setErrs({});
              setEdit({ v: { ...EMPTY } });
            }}
          >
            <Plus size={16} /> Thêm người dùng
          </button>
        </>
      }
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Người dùng</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Ngày tạo</th>
              <th className="right">Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="row gap-12">
                    <Avatar name={u.name} size={34} />
                    <div>
                      <div className="strong">
                        {u.name} {u.id === me?.id && <span className="chip chip-blue">Bạn</span>}
                      </div>
                      <div className="muted small">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`chip ${u.role === 'admin' ? 'chip-slate' : 'chip-blue'}`}>{ROLE_LABEL[u.role]}</span>
                </td>
                <td>
                  <span className={`chip ${u.active ? 'chip-green' : 'chip-gray'}`}>{u.active ? 'Đang hoạt động' : 'Đã khoá'}</span>
                </td>
                <td className="muted">{fmtDate(u.createdAt)}</td>
                <td className="right nowrap">
                  <button
                    className="icon-btn"
                    aria-label="Sửa"
                    title="Sửa"
                    onClick={() => {
                      setErrs({});
                      setEdit({ id: u.id, v: { name: u.name, email: u.email, role: u.role, active: u.active, password: '' } });
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button className="icon-btn bad" aria-label="Xoá" title={u.id === me?.id ? 'Không thể xoá chính mình' : 'Xoá'} disabled={u.id === me?.id} onClick={() => setDel(u)}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={!!edit}
        title={edit?.id ? 'Sửa người dùng' : 'Thêm người dùng'}
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
            <Field label="Họ tên" error={errs.name}>
              <input className="input" value={f.name} onChange={(e) => setF({ name: e.target.value })} autoFocus />
            </Field>
            <Field label="Email" error={errs.email}>
              <input className="input" type="email" value={f.email} onChange={(e) => setF({ email: e.target.value })} />
            </Field>
            <Field label={edit?.id ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu'} error={errs.password}>
              <input className="input" type="password" value={f.password ?? ''} onChange={(e) => setF({ password: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field label="Vai trò" error={errs.role}>
              <Segmented<Role>
                value={f.role}
                onChange={(v) => setF({ role: v })}
                options={[
                  { value: 'giam_thi', label: 'Giám thị' },
                  { value: 'admin', label: 'Quản trị viên' },
                ]}
              />
            </Field>
            <div className="span-all">
              <Toggle checked={f.active} onChange={(v) => setF({ active: v })} label={f.active ? 'Đang hoạt động' : 'Đã khoá – không thể đăng nhập'} />
            </div>
          </div>
        )}
      </Modal>
      <ConfirmModal
        open={!!del}
        title="Xoá người dùng"
        message={
          <>
            Xoá tài khoản <strong>{del?.email}</strong>? Thao tác này không thể hoàn tác.
          </>
        }
        confirmText="Xoá"
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          const d = del!;
          setDel(null);
          try {
            await api.users.remove(d.id);
            await load();
            toast('Đã xoá người dùng');
          } catch (err) {
            toast((err as Error).message || 'Không xoá được', 'error');
          }
        }}
      />
    </Card>
  );
}
