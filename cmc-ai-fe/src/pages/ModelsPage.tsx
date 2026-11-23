import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { BrainCircuit, Cpu, Gauge, Layers, Info, Users, ScanSearch } from "lucide-react";
import { api, API_MODE } from "../services";
import type { ModelInfo } from "../types";
import { Card } from "../components/ui/Controls";
import { fmtDateTime } from "../lib/format";
import { CLASS_LABEL, normalizeClass } from "../lib/labels";
import { usePhoneZoom, useRoleModel } from "../components/video/RoleCountChip";
import { roleClassLabel } from "../lib/roles";

const REAL = API_MODE === "real";
const dash = (v: unknown) =>
  v === undefined || v === null || v === "" ? "—" : String(v);

const clsName = (c: string) => {
  const n = normalizeClass(c);
  return n ? CLASS_LABEL[n] : c;
};

export default function ModelsPage() {
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const role = useRoleModel();
  const zoom = usePhoneZoom();
  useEffect(() => {
    api.models
      .list()
      .then((l) => setModels(Array.isArray(l) ? l : []))
      .catch(() => setModels([]));
  }, []);
  if (!models) return <div className="muted">Đang tải…</div>;
  return (
    <div className="page">
      <div className="note">
        {REAL ? (
          <>
            <Info size={16} /> Thông tin model lấy trực tiếp từ backend (
            <span className="mono">GET /api/models</span>). Chỉ hiện chỉ số đánh
            giá khi backend có gửi kèm.
          </>
        ) : (
          <>
            <Info size={16} /> Các chỉ số dưới đây là{" "}
            <strong>số liệu mô phỏng</strong> để minh hoạ giao diện. Ở chế độ
            backend thật, trang đọc từ{" "}
            <span className="mono">GET /api/models</span>.
          </>
        )}
      </div>
      {role && !role.enabled && <RoleModelCard role={role} />}
      {zoom?.present && !zoom.enabled && <PhoneZoomCard zoom={zoom} />}
      {models.length === 0 && (
        <div className="muted">Backend chưa trả về thông tin model.</div>
      )}
      <div className="model-grid">
        {models.map((m) => (
          <Card key={m.name} className="model-card">
            <div className="model-head">
              <span className="model-icon">
                {m.task.includes("tư thế") ||
                m.name.toLowerCase().includes("pose") ? (
                  <Layers size={22} />
                ) : (
                  <BrainCircuit size={22} />
                )}
              </span>
              <div className="grow">
                <strong>{m.name}</strong>
                <div className="muted small">{m.task}</div>
              </div>
              <span className="chip chip-green">Đang dùng</span>
            </div>
            {!m.metrics?.length ? (
              <div className="muted small model-no-metrics">
                Chưa có chỉ số đánh giá
              </div>
            ) : (
              <div className="metric-chips">
                {m.metrics.map((x) => (
                  <div key={x.label} className="metric">
                    <span>{x.label}</span>
                    <strong>
                      {x.value <= 1
                        ? `${(x.value * 100).toFixed(1)}%`
                        : x.value}
                    </strong>
                  </div>
                ))}
              </div>
            )}
            <dl className="kv kv-2">
              <dt>Phiên bản</dt>
              <dd>{dash(m.version)}</dd>
              <dt>Kích thước đầu vào</dt>
              <dd className="mono">{dash(m.inputSize)}</dd>
              <dt>
                <Gauge size={13} /> Tốc độ
              </dt>
              <dd>
                {m.fps
                  ? `${String(m.fps).replace(".", ",")} khung/giây`
                  : "Chưa có số đo"}
              </dd>
              <dt>
                <Cpu size={13} /> Tham số
              </dt>
              <dd>{dash(m.params)}</dd>
              <dt>Lớp</dt>
              <dd>
                <div className="row gap-4 wrap">
                  {(m.classes ?? []).map((c) => (
                    <span key={c} className="chip chip-blue">
                      {clsName(c)}
                    </span>
                  ))}
                </div>
              </dd>
              <dt>Cập nhật</dt>
              <dd>{m.updatedAt ? fmtDateTime(m.updatedAt) : "—"}</dd>
            </dl>
          </Card>
        ))}
        {role?.enabled && <RoleModelCard role={role} />}
        {zoom?.present && zoom.enabled && <PhoneZoomCard zoom={zoom} />}
      </div>
      {models
        .filter((m) => m.perClass?.length)
        .map((m) => {
          const data = m.perClass!.map((p) => ({
            name: clsName(p.cls),
            AP50: +(p.ap50 * 100).toFixed(1),
            Precision: +(p.precision * 100).toFixed(1),
            Recall: +(p.recall * 100).toFixed(1),
          }));
          return (
            <div className="dash-row" key={m.name + "-pc"}>
              <Card
                title={`Chỉ số theo lớp – ${m.name}`}
                className="span-2"
                actions={
                  REAL ? undefined : (
                    <span className="chip chip-gray">mô phỏng</span>
                  )
                }
              >
                <div style={{ height: 280 }}>
                  <ResponsiveContainer>
                    <BarChart
                      data={data}
                      margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--grid)"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        tick={{ fill: "var(--muted)", fontSize: 13 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[0, 100]}
                        unit="%"
                        tick={{ fill: "var(--muted)", fontSize: 13 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--card)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--text)",
                        }}
                        cursor={{ fill: "var(--hover)" }}
                        formatter={(v: number) => `${v}%`}
                      />
                      <Legend wrapperStyle={{ fontSize: 13 }} />
                      <Bar
                        dataKey="AP50"
                        name="AP50"
                        fill="#1F2328"
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="Precision"
                        name="Độ chính xác"
                        fill="#6B737C"
                        radius={[3, 3, 0, 0]}
                      />
                      <Bar
                        dataKey="Recall"
                        name="Độ phủ"
                        fill="#B8BEC5"
                        radius={[3, 3, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Bảng chỉ số" pad={false}>
                <div className="table-wrap">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Lớp</th>
                        <th className="right">AP50</th>
                        <th className="right" title="Độ chính xác (Precision)">
                          Độ chính xác
                        </th>
                        <th className="right" title="Độ phủ (Recall)">
                          Độ phủ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((d) => (
                        <tr key={d.name}>
                          <td className="strong">{d.name}</td>
                          <td className="right">{d.AP50}%</td>
                          <td className="right">{d.Precision}%</td>
                          <td className="right">{d.Recall}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          );
        })}
    </div>
  );
}

/** Model phân biệt giám thị / thí sinh (GET /api/system/model: roleEnabled, roleModel, roleClasses, roleImgSize, roleEveryN, roleInferMs, roleError). */
function RoleModelCard({ role }: { role: ReturnType<typeof useRoleModel> & object }) {
  if (!role.enabled) {
    return (
      <div className="muted small role-model-note">
        <Users size={15} /> Model phân biệt giám thị / thí sinh: chưa cài. Khung người vẫn hiện như cũ.
        {role.error && <span className="role-model-err" title={role.error}>Lý do: {role.error}</span>}
      </div>
    );
  }
  const file = role.model ? role.model.split(/[/\\]/).pop() || role.model : undefined;
  const ms = role.inferMs != null && role.inferMs > 0 ? `${Math.round(role.inferMs)} ms / lần` : undefined;
  const everyN =
    role.everyN != null ? `Mỗi ${role.everyN} khung phân tích${role.adaptive ? " (tự giãn khi máy chậm)" : ""}` : undefined;
  return (
    <Card className="model-card role-model-card">
      <div className="model-head">
        <span className="model-icon">
          <Users size={22} />
        </span>
        <div className="grow">
          <strong>Model giám thị / thí sinh</strong>
          <div className="muted small">Phân vai trò người trong khung · cảnh báo chỉ áp cho thí sinh</div>
        </div>
        <span className="chip chip-green">Đang dùng</span>
      </div>
      <dl className="kv kv-2">
        <dt>Tệp model</dt>
        <dd className="mono" title={role.model}>
          {dash(file)}
        </dd>
        <dt>Lớp</dt>
        <dd>
          <div className="row gap-4 wrap">
            {role.classes.length
              ? role.classes.map((c) => (
                  <span key={c} className="chip chip-gray" title={role.mapping[c] ? `${c} → ${role.mapping[c]}` : c}>
                    {c} → {roleClassLabel(c, role.mapping[c])}
                  </span>
                ))
              : "—"}
          </div>
        </dd>
        <dt>Kích thước đầu vào</dt>
        <dd className="mono">{role.imgSize ? `${role.imgSize}×${role.imgSize}` : "—"}</dd>
        <dt>
          <Gauge size={13} /> Tần suất
        </dt>
        <dd>{dash(everyN)}</dd>
        <dt>
          <Cpu size={13} /> Suy luận
        </dt>
        <dd>{ms ?? "Chưa có số đo"}</dd>
        {role.conf != null && (
          <>
            <dt>Ngưỡng</dt>
            <dd>{String(role.conf).replace(".", ",")}</dd>
          </>
        )}
        {role.error && (
          <>
            <dt>Lỗi</dt>
            <dd className="role-model-err">{role.error}</dd>
          </>
        )}
      </dl>
    </Card>
  );
}

/** Lượt soi kỹ vùng tay/bàn (GET /api/system/model: phoneZoom, phoneZoomConf, phoneZoomImgSize, phoneZoomEveryN, phoneZoomMaxCrops, phoneZoomInferMs, phoneZoomCrops, phoneConf). */
function PhoneZoomCard({ zoom }: { zoom: NonNullable<ReturnType<typeof usePhoneZoom>> }) {
  if (!zoom.enabled) {
    return (
      <div className="muted small role-model-note">
        <ScanSearch size={15} /> Soi kỹ vùng tay: đang tắt. Điện thoại chỉ được tìm trên khung đầy đủ.
      </div>
    );
  }
  const ms = zoom.inferMs != null && zoom.inferMs > 0 ? `${Math.round(zoom.inferMs)} ms / lần` : undefined;
  const everyN = zoom.everyN != null ? `Mỗi ${zoom.everyN} khung phân tích` : undefined;
  const fmt = (v: number | undefined) => (v == null ? "—" : String(v).replace(".", ","));
  return (
    <Card className="model-card role-model-card phone-zoom-card">
      <div className="model-head">
        <span className="model-icon">
          <ScanSearch size={22} />
        </span>
        <div className="grow">
          <strong>Soi kỹ vùng tay</strong>
          <div className="muted small">Phóng to vùng tay / bàn của thí sinh để tìm điện thoại nhỏ hoặc bị che</div>
        </div>
        <span className="chip chip-green">Đang dùng</span>
      </div>
      <dl className="kv kv-2">
        <dt>Ngưỡng khung đầy đủ</dt>
        <dd>{fmt(zoom.phoneConf)}</dd>
        <dt>Ngưỡng lượt soi kỹ</dt>
        <dd>{fmt(zoom.conf)}</dd>
        <dt>Kích thước đầu vào</dt>
        <dd className="mono">{zoom.imgSize ? `${zoom.imgSize}×${zoom.imgSize}` : "—"}</dd>
        <dt>
          <Gauge size={13} /> Tần suất
        </dt>
        <dd>{dash(everyN)}</dd>
        <dt>Tối đa vùng cắt</dt>
        <dd>{zoom.maxCrops != null ? zoom.maxCrops : "—"}</dd>
        <dt>
          <Cpu size={13} /> Suy luận
        </dt>
        <dd>{ms ?? "Chưa có số đo"}</dd>
        {zoom.crops != null && (
          <>
            <dt>Vùng cắt lần gần nhất</dt>
            <dd>{zoom.crops}</dd>
          </>
        )}
      </dl>
    </Card>
  );
}

