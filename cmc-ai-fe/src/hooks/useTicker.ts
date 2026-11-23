import { useEffect, useRef } from 'react';

/** Vòng lặp requestAnimationFrame dùng chung cho mọi canvas, giới hạn FPS */
type Fn = (now: number) => void;
const subs = new Set<Fn>();
let raf = 0;
let last = 0;
const FRAME_MS = 1000 / 24;

function loop(now: number) {
  raf = requestAnimationFrame(loop);
  if (now - last < FRAME_MS) return;
  last = now;
  subs.forEach((f) => f(now));
}

export function useTicker(fn: Fn, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const f: Fn = (n) => ref.current(n);
    subs.add(f);
    if (!raf) raf = requestAnimationFrame(loop);
    return () => {
      subs.delete(f);
      if (!subs.size && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
  }, [active]);
}
