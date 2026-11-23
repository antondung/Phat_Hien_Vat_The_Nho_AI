/** Lưu trữ localStorage có namespace + phiên bản (đổi VERSION để reset dữ liệu mẫu) */
const PREFIX = 'examguard.v1.';

export function load<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  const v = fallback();
  save(key, v);
  return v;
}

export function save<T>(key: string, value: T) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) {
    console.warn('[storage] không lưu được', key, e);
  }
}

export function remove(key: string) {
  localStorage.removeItem(PREFIX + key);
}

export function resetAll() {
  Object.keys(localStorage)
    .filter((k) => k.startsWith(PREFIX))
    .forEach((k) => localStorage.removeItem(k));
}

export const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
