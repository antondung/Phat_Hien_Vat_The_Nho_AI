import { useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';

const DEFAULT_ROW = 76;
const OVERSCAN = 4;
const VIRTUALIZE_AT = 99;

/** Ảo hoá danh sách cảnh báo khi ≥ 99 mục; dưới ngưỡng thì render hết (đã memo danh sách ở ngoài). */
export function AlertVirtualList<T extends { id: string }>({
  items,
  renderRow,
  estimateRow = DEFAULT_ROW,
  className = '',
}: {
  items: T[];
  renderRow(item: T, index: number): ReactNode;
  estimateRow?: number;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [h, setH] = useState(240);

  const onScroll = (e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop);

  // đo chiều cao lần đầu / khi resize
  const refCb = (el: HTMLDivElement | null) => {
    (scroller as { current: HTMLDivElement | null }).current = el;
    if (el) setH(el.clientHeight || 240);
  };

  const virtual = items.length >= VIRTUALIZE_AT;
  const range = useMemo(() => {
    if (!virtual) return { start: 0, end: items.length };
    const start = Math.max(0, Math.floor(scrollTop / estimateRow) - OVERSCAN);
    const end = Math.min(items.length, Math.ceil((scrollTop + h) / estimateRow) + OVERSCAN);
    return { start, end };
  }, [virtual, scrollTop, h, estimateRow, items.length]);

  if (!virtual) {
    return (
      <div className={`alert-list ${className}`.trim()} ref={refCb} onScroll={onScroll}>
        {items.map((it, i) => renderRow(it, i))}
      </div>
    );
  }

  const top = range.start * estimateRow;
  const bottom = (items.length - range.end) * estimateRow;
  return (
    <div className={`alert-list alert-list-virtual ${className}`.trim()} ref={refCb} onScroll={onScroll}>
      {top > 0 && <div style={{ height: top, flex: 'none' }} aria-hidden />}
      {items.slice(range.start, range.end).map((it, i) => renderRow(it, range.start + i))}
      {bottom > 0 && <div style={{ height: bottom, flex: 'none' }} aria-hidden />}
    </div>
  );
}
