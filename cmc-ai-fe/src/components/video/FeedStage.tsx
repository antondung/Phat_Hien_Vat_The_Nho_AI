import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';

/** Bọc video: nút + double-click toàn màn hình (Fullscreen API). Esc thoát mặc định của trình duyệt. */
export function FeedStage({
  children,
  className = '',
  label,
  onSingleClick,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
  /** Click đơn (lưới: mở camera đơn). Bị huỷ nếu double-click để vào toàn màn hình. */
  onSingleClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const clickTimer = useRef<number>();

  useEffect(() => {
    const onCh = () => setFull(document.fullscreenElement === ref.current);
    document.addEventListener('fullscreenchange', onCh);
    return () => {
      document.removeEventListener('fullscreenchange', onCh);
      if (clickTimer.current) window.clearTimeout(clickTimer.current);
    };
  }, []);

  const toggle = async (e?: MouseEvent) => {
    e?.stopPropagation();
    e?.preventDefault();
    if (clickTimer.current) {
      window.clearTimeout(clickTimer.current);
      clickTimer.current = undefined;
    }
    const el = ref.current;
    if (!el) return;
    try {
      if (document.fullscreenElement === el) await document.exitFullscreen();
      else if (document.fullscreenElement) {
        await document.exitFullscreen();
        await el.requestFullscreen();
      } else await el.requestFullscreen();
    } catch {
      /* trình duyệt từ chối / không hỗ trợ */
    }
  };

  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (!onSingleClick) return;
    if ((e.target as HTMLElement).closest('.feed-full-btn')) return;
    if (clickTimer.current) window.clearTimeout(clickTimer.current);
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = undefined;
      onSingleClick();
    }, 250);
  };

  return (
    <div
      ref={ref}
      className={`feed-stage ${full ? 'is-full' : ''} ${className}`}
      onDoubleClick={(e) => void toggle(e)}
      onClick={onClick}
    >
      {children}
      <button
        type="button"
        className="feed-full-btn"
        onClick={(e) => void toggle(e)}
        title={full ? 'Thoát toàn màn hình (Esc)' : 'Xem toàn màn hình'}
        aria-label={full ? 'Thoát toàn màn hình' : `Xem toàn màn hình${label ? ` ${label}` : ''}`}
      >
        {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
    </div>
  );
}
