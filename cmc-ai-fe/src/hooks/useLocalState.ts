import { useEffect, useState } from 'react';

/** useState có lưu localStorage (cho tuỳ chọn giao diện) */
export function useLocalState<T>(key: string, init: T) {
  const k = 'examguard.ui.' + key;
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(k);
      return raw ? (JSON.parse(raw) as T) : init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    localStorage.setItem(k, JSON.stringify(v));
  }, [k, v]);
  return [v, setV] as const;
}
