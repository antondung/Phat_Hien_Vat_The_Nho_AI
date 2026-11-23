import { useEffect, useMemo, useState } from 'react';
import { Hand, Smartphone, FileText, Calculator, RotateCcw, Save, Info } from 'lucide-react';
import { api } from '../../services';
import type { AlertLevel, RuleAlertType, RuleConfig, RulesSettings } from '../../types';
import { Card, Toggle } from '../../components/ui/Controls';
import { LEVEL_LABEL, TYPE_LABEL } from '../../lib/labels';
import { useToast } from '../../context/ToastContext';
import { useLive } from '../../context/LiveContext';
import { ConfirmModal } from '../../components/ui/Modal';

const ICON: Record<RuleAlertType, React.ReactNode> = {
  phone_near_hand: <Hand size={20} />,
  phone_in_work_area: <Smartphone size={20} />,
  paper_present: <FileText size={20} />,
  calculator_present: <Calculator size={20} />,
};
const DESC: Record<RuleAlertType, string> = {
  phone_near_hand: 'Điện thoại nằm gần cổ tay (keypoint 9/10) của thí sinh.',
  phone_in_work_area: 'Điện thoại xuất hiện trong vùng làm bài (khung người mở rộng).',
  paper_present: 'Có giấy/tài liệu trên bàn. Tự tắt ở phòng cho phép giấy nháp.',
  calculator_present: 'Có máy tính cầm tay. Tự tắt ở phòng cho phép máy tính.',
};

function Slider({ label, value, min, max, step, fmt, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; step: number; fmt(v: number): string; onChange(v: number): void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`slider ${disabled ? 'disabled' : ''}`}>
      <span className="slider-head">
        <span>{label}</span>
        <strong>{fmt(value)}</strong>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} style={{ ['--p' as string]: `${((value - min) / (max - min)) * 100}%` }} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function RulesTab() {
  const toast = useToast();
  const { cameras } = useLive();
  const [saved, setSaved] = useState<RulesSettings | null>(null);
  const [s, setS] = useState<RulesSettings | null>(null);
  const [askReset, setAskReset] = useState(false);
  useEffect(() => {
    api.rules.get().then((r) => {
      setSaved(r);
      setS(structuredClone(r));
    });
  }, []);
  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved]);
  const rooms = useMemo(() => {
    if (!s) return [];
    const names = new Set([...s.rooms.map((r) => r.room), ...cameras.map((c) => c.room)]);
    return [...names].sort().map((room) => s.rooms.find((r) => r.room === room) ?? { room, allowPaper: false, allowCalculator: false });
  }, [s, cameras]);
  if (!s) return <div className="muted">Đang tải…</div>;

  const upd = (t: RuleAlertType, p: Partial<RuleConfig>) => setS({ ...s, rules: s.rules.map((r) => (r.type === t ? { ...r, ...p } : r)) });
  const updRoom = (room: string, p: { allowPaper?: boolean; allowCalculator?: boolean }) => {
    const base = rooms.find((r) => r.room === room)!;
    setS({ ...s, rooms: [...s.rooms.filter((r) => r.room !== room), { ...base, ...p }] });
  };
  const save = async () => {
    try {
      const r = await api.rules.update(s);
      setSaved(r);
      setS(structuredClone(r));
      toast('Đã lưu cấu hình quy tắc – áp dụng ngay cho camera đang chạy');
    } catch (err) {
      toast((err as Error).message || 'Không lưu được cấu hình', 'error');
    }
  };

  return (
    <div className="settings-stack">
      <div className="note">
        <Info size={16} /> Cảnh báo chỉ được bắn khi tình huống <strong>kéo dài đủ số giây</strong> đã đặt, và không lặp lại cho cùng thí sinh/vật thể trong thời gian chống trùng. Hệ thống chỉ đưa ra <strong>nghi vấn</strong> để giám thị kiểm tra.
        Ngoài bảng dưới, hệ thống tự bắn hai loại không chỉnh được ở đây: <strong>Không thấy giám thị trong phòng</strong> (khi vắng giám thị đủ lâu) và <strong>Điện thoại trên bàn của thí sinh</strong> (mức Thông tin, khi thấy điện thoại trên bàn nhưng không gần tay).
      </div>
      <div className="rule-grid">
        {s.rules.map((r) => (
          <Card key={r.type} className={`rule-card ${r.enabled ? '' : 'off'}`}>
            <div className="rule-head">
              <span className={`rule-icon lv-${r.level}`}>{ICON[r.type]}</span>
              <div className="grow">
                <strong>{TYPE_LABEL[r.type]}</strong>
                <p className="muted small">{DESC[r.type]}</p>
              </div>
              <Toggle checked={r.enabled} onChange={(v) => upd(r.type, { enabled: v })} label={r.enabled ? 'Bật' : 'Tắt'} />
            </div>
            <div className="rule-body">
              <label className="field">
                <span className="field-label">Mức cảnh báo</span>
                <div className="level-pick">
                  {(['cao', 'trung_binh', 'thong_tin'] as AlertLevel[]).map((l) => (
                    <button key={l} disabled={!r.enabled} className={`lv-opt lv-${l} ${r.level === l ? 'on' : ''}`} onClick={() => upd(r.type, { level: l })}>
                      <i />
                      {LEVEL_LABEL[l]}
                    </button>
                  ))}
                </div>
              </label>
              <Slider label="Ngưỡng độ tin cậy" value={r.minConfidence} min={0.1} max={0.95} step={0.05} fmt={(v) => `${Math.round(v * 100)}%`} onChange={(v) => upd(r.type, { minConfidence: v })} disabled={!r.enabled} />
              {r.type === 'phone_near_hand' && (
                <Slider label="Ngưỡng gần tay" value={r.nearHandThreshold} min={0.05} max={0.4} step={0.01} fmt={(v) => `${Math.round(v * 100)}% chiều cao người`} onChange={(v) => upd(r.type, { nearHandThreshold: v })} disabled={!r.enabled} hint="Khoảng cách tâm điện thoại → cổ tay, chia cho chiều cao khung người" />
              )}
              <Slider label="Thời gian duy trì" value={r.persistSeconds} min={0} max={20} step={0.5} fmt={(v) => `${v} giây`} onChange={(v) => upd(r.type, { persistSeconds: v })} disabled={!r.enabled} />
            </div>
          </Card>
        ))}
      </div>

      <Card title="Tuỳ chọn theo phòng thi" actions={<span className="muted small">Phòng cho phép sẽ tự tắt cảnh báo Thông tin tương ứng</span>}>
        <p className="muted small rooms-default">
          Mặc định: <strong>cho phép giấy nháp</strong>, <strong>không cho phép máy tính cầm tay</strong>. Cảnh báo mức Thông tin chỉ báo
          1 lần cho mỗi thí sinh trong 10 phút. Phòng mới (thêm camera sau) hiện “Chưa cấu hình” – bật/tắt rồi lưu để áp dụng.
        </p>
        <div className="table-wrap">
          <table className="table compact">
            <thead>
              <tr>
                <th>Phòng</th>
                <th>Số camera</th>
                <th>Cho phép giấy nháp</th>
                <th>Cho phép máy tính cầm tay</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.room}>
                  <td className="strong">
                    {r.room} {!s.rooms.some((x) => x.room === r.room) && <span className="chip chip-gray">Chưa cấu hình</span>}
                  </td>
                  <td>{cameras.filter((c) => c.room === r.room).length}</td>
                  <td>
                    <Toggle size="sm" checked={r.allowPaper} onChange={(v) => updRoom(r.room, { allowPaper: v })} label={r.allowPaper ? 'Cho phép' : 'Không'} />
                  </td>
                  <td>
                    <Toggle size="sm" checked={r.allowCalculator} onChange={(v) => updRoom(r.room, { allowCalculator: v })} label={r.allowCalculator ? 'Cho phép' : 'Không'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row gap-12 mt-16">
          <Slider label="Thời gian chống trùng (dedupe)" value={s.dedupeCooldownSeconds} min={5} max={120} step={5} fmt={(v) => `${v} giây`} onChange={(v) => setS({ ...s, dedupeCooldownSeconds: v })} />
        </div>
      </Card>

      <div className={`savebar ${dirty ? 'show' : ''}`}>
        <span>{dirty ? 'Có thay đổi chưa lưu' : 'Đã lưu'}</span>
        <button className="btn btn-ghost" onClick={() => setAskReset(true)}>
          <RotateCcw size={16} /> Khôi phục mặc định
        </button>
        <button className="btn btn-ghost" disabled={!dirty} onClick={() => setS(structuredClone(saved!))}>
          Huỷ thay đổi
        </button>
        <button className="btn btn-primary" disabled={!dirty} onClick={save}>
          <Save size={16} /> Lưu cấu hình
        </button>
      </div>
      <ConfirmModal
        open={askReset}
        title="Khôi phục mặc định"
        message="Toàn bộ quy tắc và tuỳ chọn phòng sẽ trở về giá trị mặc định."
        confirmText="Khôi phục"
        onCancel={() => setAskReset(false)}
        onConfirm={async () => {
          setAskReset(false);
          try {
            const r = await api.rules.reset();
            setSaved(r);
            setS(structuredClone(r));
            toast('Đã khôi phục quy tắc mặc định');
          } catch (err) {
            toast((err as Error).message || 'Không khôi phục được', 'error');
          }
        }}
      />
    </div>
  );
}
