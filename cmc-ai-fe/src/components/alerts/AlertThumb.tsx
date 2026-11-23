import { useEffect, useRef } from 'react';
import type { Alert } from '../../types';
import { useLive } from '../../context/LiveContext';
import { cameraOf, cropFor, drawAlertFrame } from './sceneRender';
import { getSampleImage } from '../../scene/renderScene';

/** Ảnh thu nhỏ của cảnh báo (cắt quanh thí sinh) */
export function AlertThumb({ alert, width = 96, zoom = true }: { alert: Alert; width?: number; zoom?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { cameras } = useLive();
  const h = Math.round((width * 3) / 4);
  useEffect(() => {
    if (alert.snapshotUrl) return;
    const draw = () => {
      const cv = ref.current;
      if (!cv) return;
      const ctx = cv.getContext('2d')!;
      drawAlertFrame(ctx, alert, cameraOf(alert, cameras), alert.ts, cv.width, cv.height, cropFor(alert, zoom), true, false);
    };
    draw();
    const img = getSampleImage();
    if (!img.complete) img.addEventListener('load', draw, { once: true });
    return () => img.removeEventListener('load', draw);
  }, [alert, cameras, zoom]);
  if (alert.snapshotUrl) return <img className="thumb" src={alert.snapshotUrl} width={width} height={h} alt="Ảnh chụp cảnh báo" />;
  return <canvas ref={ref} className="thumb" width={width * 2} height={h * 2} style={{ width, height: h }} aria-label="Ảnh chụp cảnh báo" />;
}
