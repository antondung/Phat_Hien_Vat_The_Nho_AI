import { useEffect, useRef, useState } from 'react';

/**
 * Giữ id vừa bị loại khỏi danh sách thêm `holdMs` (tránh ô camera thay đổi/gắn lại mỗi nhịp cảnh báo).
 * Id mới vẫn vào ngay. Thứ tự: giữ thứ tự cũ, append id mới ở cuối.
 */
export function useHeldIds(desired: string[], holdMs = 2800): string[] {
  const [held, setHeld] = useState<string[]>(desired);
  const leaving = useRef(new Map<string, number>());
  const desiredRef = useRef(desired);
  desiredRef.current = desired;
  const key = desired.join('|');

  useEffect(() => {
    const apply = () => {
      const wantList = desiredRef.current;
      const want = new Set(wantList);
      const now = Date.now();
      setHeld((prev) => {
        const next: string[] = [];
        const seen = new Set<string>();
        for (const id of prev) {
          if (want.has(id)) {
            next.push(id);
            seen.add(id);
            leaving.current.delete(id);
            continue;
          }
          if (holdMs <= 0) continue;
          const since = leaving.current.get(id) ?? now;
          leaving.current.set(id, since);
          if (now - since < holdMs) {
            next.push(id);
            seen.add(id);
          } else leaving.current.delete(id);
        }
        for (const id of wantList) {
          if (!seen.has(id)) {
            next.push(id);
            seen.add(id);
          }
        }
        if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
        return next;
      });
    };

    apply();
    if (holdMs <= 0) return;
    const t = window.setInterval(apply, 400);
    return () => clearInterval(t);
  }, [key, holdMs]);

  return held;
}
