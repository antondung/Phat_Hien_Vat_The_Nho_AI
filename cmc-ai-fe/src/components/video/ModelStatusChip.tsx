import { useEffect, useMemo, useState } from 'react';
import type { CameraStatus, DetectionFrame, ModelInfo } from '../../types';
import { api, API_MODE } from '../../services';
import { ApiError } from '../../services/http/httpApi';
import type { SystemHealthPayload, SystemModelPayload } from '../../services/api';
import { useLive } from '../../context/LiveContext';
import { useNow } from '../../hooks/useNow';
import { buildModelStatus, pickCameraPayload } from '../../lib/modelStatus';

async function safeDiag(cameraId: string): Promise<CameraStatus | null> {
  try {
    return await api.cameras.diag(cameraId);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 405)) return null;
    console.warn('cameras.diag', e);
    return null;
  }
}

export function ModelStatusChip({ cameraId, online, camStatus }: { cameraId: string; online?: boolean; camStatus?: CameraStatus }) {
  const { frames, detTimes, detSince, frameTick } = useLive();
  const now = useNow(1000);
  const [diag, setDiag] = useState<CameraStatus | null>(null);
  const [sysModel, setSysModel] = useState<SystemModelPayload | null>(null);
  const [missing, setMissing] = useState(false);
  const [health, setHealth] = useState<SystemHealthPayload | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [d, m, h, list] = await Promise.all([
          safeDiag(cameraId),
          api.system.model().catch((e) => {
            console.warn('system.model', e);
            return null;
          }),
          api.system.health().catch(() => null),
          api.models.list().catch(() => null),
        ]);
        if (!alive) return;
        setDiag(d);
        setSysModel(pickCameraPayload(m, cameraId));
        setMissing(d == null && m == null);
        setHealth(h);
        setModels(list);
      } catch {
        if (alive) setMissing(true);
      }
    };
    void load();
    const t = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [cameraId]);

  const frame: DetectionFrame | undefined = frames.current.get(cameraId);
  const view = useMemo(
    () =>
      buildModelStatus({
        cameraOnline: online,
        camStatus,
        diag,
        systemModel: sysModel,
        payloadMissing: missing,
        health,
        models,
        frame,
        detTimes: detTimes.current.get(cameraId),
        detSince: detSince.current,
        now,
      }),
    // frameTick buộc tính lại khi có detections (đã giới hạn ~10 Hz)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [online, camStatus, diag, sysModel, missing, health, models, cameraId, now, frameTick],
  );

  return (
    <span className={`model-status kind-${view.kind}`} title={view.tooltip} role="status">
      <i aria-hidden />
      <span className="model-status-text">{view.label}</span>
    </span>
  );
}

export function MockModeBadge() {
  if (API_MODE !== 'mock') return null;
  return (
    <span className="mock-badge" title="Đang chạy dữ liệu mẫu trên trình duyệt, không nối backend thật">
      Dữ liệu mẫu
    </span>
  );
}
