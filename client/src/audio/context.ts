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
