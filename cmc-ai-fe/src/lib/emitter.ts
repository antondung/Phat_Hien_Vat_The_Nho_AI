/** Event emitter nhỏ, có kiểu – dùng cho kênh realtime */
export class Emitter<E extends object> {
  private map = new Map<keyof E, Set<(p: never) => void>>();

  on<K extends keyof E>(type: K, cb: (payload: E[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(cb as (p: never) => void);
    return () => set!.delete(cb as (p: never) => void);
  }

  emit<K extends keyof E>(type: K, payload: E[K]) {
    this.map.get(type)?.forEach((cb) => {
      try {
        (cb as (p: E[K]) => void)(payload);
      } catch (e) {
        console.warn('[emitter] listener error', e);
      }
    });
  }

  clear() {
    this.map.clear();
  }
}
