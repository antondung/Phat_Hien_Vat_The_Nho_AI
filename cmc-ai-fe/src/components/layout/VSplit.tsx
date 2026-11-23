import { useCallback, useEffect, useRef } from 'react';

/** Thanh kéo dọc: đổi chiều cao panel phía dưới. Hỗ trợ chuột/touch và phím mũi tên. */
export function VSplit({
  value,
  onChange,
  min = 120,
  max = 480,
  step = 16,
  label = 'Kéo để đổi chiều cao bảng cảnh báo',
}: {
  value: number;
  onChange(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  const start = useRef<{ y: number; h: number } | null>(null);
  const clamp = useCallback((n: number) => Math.round(Math.min(max, Math.max(min, n))), [min, max]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!start.current) return;
      onChange(clamp(start.current.h - (e.clientY - start.current.y)));
    };
    const up = () => {
      start.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [clamp, onChange]);

  return (
    <div
      className="vsplit"
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = { y: e.clientY, h: value };
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          onChange(clamp(value + step));
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(clamp(value - step));
        } else if (e.key === 'Home') {
          e.preventDefault();
          onChange(min);
        } else if (e.key === 'End') {
          e.preventDefault();
          onChange(max);
        }
      }}
    >
      <i />
    </div>
  );
}
