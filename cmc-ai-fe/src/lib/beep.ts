/** Tiếng bíp cảnh báo bằng WebAudio (không cần tệp âm thanh) */
let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Gọi trong một thao tác người dùng để trình duyệt cho phép phát âm thanh */
export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') void c.resume();
}

export function beep(level: 'cao' | 'trung_binh' = 'cao') {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const tones = level === 'cao' ? [880, 660, 880] : [520];
  tones.forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = f;
    const t0 = now + i * 0.16;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.13);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + 0.14);
  });
}
