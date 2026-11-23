import { useMemo, useRef } from 'react';
import { MAX_GRID_STREAMS } from '../services/media';

/**
 * Giữ ổn định tối đa `max` camera dùng luồng MJPEG.
 * Không đổi slot khi thứ tự lưới xáo — chỉ thu hồi khi camera rời ô nhìn thấy, rồi fill chỗ trống.
 */
export function useStreamSlots(visibleIds: string[], max = MAX_GRID_STREAMS): Set<string> {
  const held = useRef<string[]>([]);
  const key = visibleIds.join('|');
  return useMemo(() => {
    const vis = new Set(visibleIds);
    let cur = held.current.filter((id) => vis.has(id));
    for (const id of visibleIds) {
      if (cur.length >= max) break;
      if (!cur.includes(id)) cur.push(id);
    }
    if (cur.length > max) cur = cur.slice(0, max);
    held.current = cur;
    return new Set(cur);
    // key stands in for visibleIds membership + order of candidates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, max]);
}
