/** Ilovaning yagona AudioContext'i (effektlar va ovozli suhbat uchun). */
let ctx: AudioContext | null = null;

/** Kontekstni olish (kerak bo'lsa yaratish). Foydalanuvchi bosishidan keyin chaqirilsa darhol ovoz chiqaradi. */
export function audioContext(): AudioContext | null {
  try {
    ctx ??= new AudioContext({ latencyHint: 'interactive' });
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Brauzerlar AudioContext'ni foydalanuvchi harakatigacha "uxlatib" qo'yadi
for (const ev of ['pointerdown', 'keydown'] as const) {
  window.addEventListener(ev, () => ctx?.state === 'suspended' && void ctx.resume(), { capture: true });
}

type V3 = { x: number; y: number; z: number };

/** Eshituvchi = kamera (barcha fazoviy ovozlar uchun: suhbat, gulxan...). Har kadr chaqiriladi. */
export function updateListener(pos: V3, forward: V3, up: V3) {
  if (!ctx || ctx.state !== 'running') return;
  const l = ctx.listener;
  const t = ctx.currentTime;
  if (l.positionX) {
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.03);
    set(l.positionX, pos.x);
    set(l.positionY, pos.y);
    set(l.positionZ, pos.z);
    set(l.forwardX, forward.x);
    set(l.forwardY, forward.y);
    set(l.forwardZ, forward.z);
    set(l.upX, up.x);
    set(l.upY, up.y);
    set(l.upZ, up.z);
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}
