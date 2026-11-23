import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileImage, FileVideo, ImagePlus, PlayCircle, RotateCcw, ScanSearch, UploadCloud, X, Cpu } from 'lucide-react';
import { api } from '../services';
import type { AnalysisInput, ModelInfo, ObjClass } from '../types';
import { Card, EmptyState } from '../components/ui/Controls';
import { LevelBadge } from '../components/ui/Badges';
import { LayerToggles } from '../components/video/LayerToggles';
import { MediaStage, type StageHandle, type StageSource } from './detection/MediaStage';
import { AlertVirtualList } from '../components/alerts/AlertVirtualList';
import { useLocalState } from '../hooks/useLocalState';
import { useAnalysisJob } from '../hooks/useAnalysisJob';
import type { OverlayLayers } from '../lib/overlay';
import { CLASS_COLOR, CLASS_LABEL } from '../lib/labels';
import { alertPersonLabel, roleCounts, inferPersonRole } from '../lib/roles';
import { RoleCountChip } from '../components/video/RoleCountChip';
import { fmtPct, fmtVideoTime } from '../lib/format';
import { SAMPLE_IMAGE_URL } from '../scene/sceneModel';
import { API_MODE } from '../services';
import { useToast } from '../context/ToastContext';
import { mediaUrl as toMediaUrl } from '../services/http/config';

type Picked = { input: AnalysisInput; source: StageSource; name: string; kind: 'image' | 'video'; size?: number };
const SAMPLE_VIDEO_DURATION = 40;
const MAX_MB = 200;

async function probe(file: File): Promise<Picked> {
  const url = URL.createObjectURL(file);
  if (file.type.startsWith('image/')) {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {});
    return { input: { kind: 'file', file, width: img.naturalWidth, height: img.naturalHeight, duration: 0 }, source: { type: 'image', url }, name: file.name, kind: 'image', size: file.size };
  }
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.src = url;
  await new Promise<void>((res) => {
    v.onloadedmetadata = () => res();
    v.onerror = () => res();
    setTimeout(res, 4000);
  });
  const duration = isFinite(v.duration) && v.duration > 0 ? Math.min(v.duration, 300) : 20;
  return { input: { kind: 'file', file, width: v.videoWidth || 1280, height: v.videoHeight || 720, duration }, source: { type: 'video', url }, name: file.name, kind: 'video', size: file.size };
}

function revokeSource(s: StageSource | undefined) {
  if (s && s.type !== 'synthetic' && s.url.startsWith('blob:')) URL.revokeObjectURL(s.url);
}

export default function DetectionPage() {
  const toast = useToast();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [drag, setDrag] = useState(false);
  const [layers, setLayers] = useLocalState<OverlayLayers>('det.layers.v2', { box: true, pose: true, label: true, conf: false });
  const [err, setErr] = useState('');
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const stream = useAnalysisJob();
  const lastToast = useRef<string>('');

  useEffect(() => {
    if (API_MODE !== 'real') return;
    api.models
      .list()
      .then((l) => setModels(Array.isArray(l) ? l : []))
      .catch(() => setModels([]));
  }, []);
  const detM = models?.find((m) => !/tư thế|pose/i.test(m.task + m.name));
  const poseM = models?.find((m) => /tư thế|pose/i.test(m.task + m.name));
  const [activeAlert, setActiveAlert] = useState<string | null>(null);
  const stage = useRef<StageHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (stream.status === 'done' && stream.job && lastToast.current !== stream.job.jobId) {
      lastToast.current = stream.job.jobId;
      toast(`Phân tích xong: ${stream.alerts.length} cảnh báo`, stream.alerts.length ? 'info' : 'success');
    }
  }, [stream.status, stream.job, stream.alerts.length, toast]);

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    if (!/^(image|video)\//.test(f.type)) return setErr('Chỉ hỗ trợ tệp ảnh (JPG, PNG) hoặc video (MP4, WEBM).');
    if (f.size > MAX_MB * 1024 * 1024) return setErr(`Tệp quá lớn (tối đa ${MAX_MB} MB).`);
    const p = await probe(f);
    setPicked((prev) => {
      if (prev && prev !== p) revokeSource(prev.source);
      return p;
    });
    setActiveAlert(null);
    lastToast.current = '';
    await stream.start(p.input);
  };

  const runPicked = async (p: Picked) => {
    setPicked((prev) => {
      if (prev && prev.source !== p.source) revokeSource(prev.source);
      return p;
    });
    setErr('');
    setActiveAlert(null);
    lastToast.current = '';
    await stream.start(p.input);
  };

  const sampleImage = () =>
    void runPicked({ input: { kind: 'sample-image' }, source: { type: 'image', url: SAMPLE_IMAGE_URL }, name: 'anh-mau-P503.1.jpg', kind: 'image' });
  const sampleVideo = () =>
    void runPicked({ input: { kind: 'sample-video', duration: SAMPLE_VIDEO_DURATION }, source: { type: 'synthetic' }, name: 'video-mau-phong-thi.webm', kind: 'video' });

  const reset = () => {
    void stream.reset();
    setPicked((prev) => {
      revokeSource(prev?.source);
      return null;
    });
    setActiveAlert(null);
    setErr('');
    lastToast.current = '';
  };

  const busy = stream.status === 'starting' || stream.status === 'queued' || stream.status === 'running';
  const displayErr = err || (stream.status === 'error' ? stream.message : '');

  const width = stream.job?.width || (picked?.input.kind === 'file' ? picked.input.width : 1280) || 1280;
  const height = stream.job?.height || (picked?.input.kind === 'file' ? picked.input.height : 720) || 720;
  const duration = stream.job?.duration || (picked?.input.kind === 'file' ? picked.input.duration : picked?.input.kind === 'sample-video' ? picked.input.duration : 0) || 0;
  const mediaType = stream.job?.mediaType || picked?.kind || 'video';
  const coord = stream.job?.coord ?? 'px';

  // Ưu tiên blob URL local để phát ngay; mediaUrl của BE (Range, không cần JWT) dùng khi không có blob (mẫu thật).
  const source: StageSource | null = useMemo(() => {
    if (!picked) return null;
    if (picked.source.type === 'synthetic' || picked.source.type === 'image' || picked.source.type === 'video') {
      if (picked.source.type !== 'synthetic' && picked.source.url.startsWith('blob:')) return picked.source;
    }
    const remote = stream.job?.mediaUrl;
    if (remote) {
      const url = toMediaUrl(remote) ?? remote;
      return { type: mediaType, url };
    }
    return picked.source;
  }, [picked, stream.job?.mediaUrl, mediaType]);

  const counts = useMemo(() => {
    if (!stream.frames.length) return null;
    const m: Record<ObjClass, { n: number; conf: number }> = { person: { n: 0, conf: 0 }, phone: { n: 0, conf: 0 }, paper: { n: 0, conf: 0 }, calculator: { n: 0, conf: 0 } };
    const seen = new Set<string>();
    stream.frames.forEach((f) =>
      f.objects.forEach((o) => {
        const k = o.cls + ':' + o.id;
        if (seen.has(k)) return;
        seen.add(k);
        m[o.cls].n++;
        m[o.cls].conf += o.conf;
      }),
    );
    return m;
  }, [stream.frames]);

  const download = () => {
    if (!picked) return;
    const lastFrame = stream.frames.length ? stream.frames[stream.frames.length - 1] : undefined;
    const payload = {
      id: stream.job?.jobId,
      fileName: stream.job?.fileName || picked.name,
      mediaType,
      width,
      height,
      coord,
      duration,
      fps: stream.job?.fps ?? 0,
      model: stream.job?.model,
      roleEnabled: lastFrame?.roleEnabled ?? false,
      roleCounts: roleCounts(lastFrame),
      frames: stream.frames,
      alerts: stream.alerts,
      progress: stream.progress,
      analysedSec: stream.analysedSec,
      status: stream.status,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ket-qua-${(stream.job?.fileName || picked.name).replace(/\.[^.]+$/, '')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="page detection">
      <div className="det-grid">
        <Card title="Tải lên & phân tích" icon={<UploadCloud size={18} />} className="det-upload">
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void choose(e.dataTransfer.files[0]);
            }}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInput.current?.click()}
          >
            <div className="dz-icon">
              <ImagePlus size={30} />
            </div>
            <strong>Kéo thả ảnh hoặc video vào đây</strong>
            <span className="muted small">hoặc bấm để chọn tệp · JPG, PNG, MP4, WEBM · tối đa {MAX_MB} MB</span>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0] ?? undefined;
                e.target.value = '';
                void choose(f);
              }}
            />
          </div>
          {displayErr && <div className="form-error">{displayErr}</div>}
          {picked && (
            <div className="picked">
              {picked.kind === 'image' ? <FileImage size={20} /> : <FileVideo size={20} />}
              <div className="grow">
                <strong>{picked.name}</strong>
                <span className="muted small">
                  {picked.kind === 'image' ? 'Ảnh' : 'Video'}
                  {picked.size ? ` · ${(picked.size / 1024 / 1024).toFixed(1)} MB` : ' · mẫu có sẵn'}
                  {picked.input.kind === 'file' && picked.input.width ? ` · ${picked.input.width}×${picked.input.height}` : ''}
                </span>
              </div>
              <button className="icon-btn" onClick={reset} aria-label="Bỏ chọn">
                <X size={16} />
              </button>
            </div>
          )}
          <div className="row gap-8 wrap">
            {busy ? (
              <button className="btn btn-ghost" onClick={() => void stream.cancel()}>
                Huỷ phân tích
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!picked} onClick={() => picked && void runPicked(picked)}>
                <ScanSearch size={17} /> {stream.status === 'done' || stream.status === 'cancelled' || stream.frames.length ? 'Phân tích lại' : 'Phân tích'}
              </button>
            )}
            {picked && (
              <button className="btn btn-ghost" onClick={reset}>
                <RotateCcw size={16} /> Làm mới
              </button>
            )}
          </div>
          <div className="divider">
            <span>hoặc thử nhanh</span>
          </div>
          <div className="samples">
            <button className="sample" onClick={sampleImage}>
              <img src={SAMPLE_IMAGE_URL} alt="" />
              <span>
                <FileImage size={16} /> Thử với ảnh mẫu
              </span>
              <small>{API_MODE === 'real' ? 'Ảnh test của dataset · có điện thoại' : 'Phòng P.503.1 · khung hình thật'}</small>
            </button>
            <button className="sample" onClick={sampleVideo}>
              <div className="sample-video">
                <PlayCircle size={34} />
              </div>
              <span>
                <FileVideo size={16} /> Thử với video mẫu
              </span>
              <small>{API_MODE === 'real' ? 'Lần đầu có thể hơi chậm' : `${SAMPLE_VIDEO_DURATION}s · có tình huống điện thoại`}</small>
            </button>
          </div>
          <div className="pipeline">
            <div>
              <Cpu size={15} />{' '}
              {API_MODE !== 'real' ? 'YOLO 4 lớp' : detM ? `${detM.version || 'Phát hiện'} · ${detM.classes.length} lớp` : 'Phát hiện vật thể'}
            </div>
            <span>→</span>
            <div>{API_MODE !== 'real' ? 'YOLO Pose 17 điểm' : poseM ? poseM.version || 'Ước lượng tư thế' : 'Ước lượng tư thế'}</div>
            <span>→</span>
            <div>Quy tắc</div>
          </div>
        </Card>

        <Card
          title="Kết quả"
          icon={<ScanSearch size={18} />}
          className="det-result"
          actions={
            picked && (
              <>
                <LayerToggles value={layers} onChange={setLayers} />
                <button className="btn btn-sm btn-primary" onClick={download} disabled={!stream.frames.length && stream.status !== 'done'}>
                  <Download size={15} /> Tải JSON
                </button>
              </>
            )
          }
        >
          {!picked && <EmptyState icon={<ScanSearch size={36} />} title="Chưa có kết quả" text="Chọn tệp hoặc dùng mẫu có sẵn — video sẽ phát ngay, kết quả nhận diện hiện dần khi model chạy." />}
          {picked && source && (
            <>
              <MediaStage
                ref={stage}
                source={source}
                mediaType={mediaType}
                width={width}
                height={height}
                duration={duration}
                coord={coord}
                frames={stream.frames}
                alerts={stream.alerts}
                analysedSec={stream.analysedSec}
                progress={stream.progress}
                status={stream.status}
                layers={layers}
              />
              <div className="det-summary">
                {(() => {
                  const f = stream.frames[stream.frames.length - 1];
                  return f ? <RoleCountChip counts={roleCounts(f)} roleEnabled={f.roleEnabled} /> : null;
                })()}
                {counts &&
                  (Object.keys(counts) as ObjClass[]).map((k) => (
                    <div key={k} className="cls-stat">
                      <i style={{ background: CLASS_COLOR[k] }} />
                      <span>{CLASS_LABEL[k]}</span>
                      <strong>{counts[k].n}</strong>
                      {counts[k].n > 0 && <small className="conf-chip">{fmtPct(counts[k].conf / counts[k].n, 0)}</small>}
                    </div>
                  ))}
                {stream.job?.model && (stream.job.model.detector || stream.job.model.pose) && (
                  <div className="cls-stat model">
                    <span className="muted small">
                      {[stream.job.model.detector, stream.job.model.pose].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>

        <Card title={`Cảnh báo${stream.alerts.length ? ` (${stream.alerts.length})` : ''}`} className="det-alerts">
          {!picked && <p className="muted small">Danh sách cảnh báo kèm mốc thời gian sẽ hiện dần ở đây. Với video, bấm vào cảnh báo để tua tới thời điểm đó.</p>}
          {picked && stream.alerts.length === 0 && stream.status === 'done' && <EmptyState title="Không có nghi vấn" text="Không phát hiện tình huống nào cần chú ý theo quy tắc hiện tại." />}
          {picked && stream.alerts.length === 0 && busy && <p className="muted small">Cảnh báo sẽ được thêm dần khi model phân tích tới đoạn có tình huống.</p>}
          <AlertVirtualList
            className="det-alert-list"
            items={stream.alerts}
            estimateRow={72}
            renderRow={(a) => (
              <button
                key={a.id}
                className={`det-alert ${activeAlert === a.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveAlert(a.id);
                  stage.current?.seek(Math.max(0, a.t - 1));
                }}
                disabled={mediaType === 'image'}
              >
                <span className="time-chip mono">{mediaType === 'video' ? fmtVideoTime(a.t) : 'Ảnh'}</span>
                <span className="grow">
                  <LevelBadge level={a.level} />
                  <span className="det-alert-msg">{a.message}</span>
                  {alertPersonLabel(a) && (
                    <span className={`det-alert-who${inferPersonRole(a) === 'invigilator' ? ' is-inv' : ''}`}>{alertPersonLabel(a)}</span>
                  )}
                </span>
                <span className="conf-chip">{fmtPct(a.confidence, 0)}</span>
              </button>
            )}
          />
        </Card>
      </div>
    </div>
  );
}
