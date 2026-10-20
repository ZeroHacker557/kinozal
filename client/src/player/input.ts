/** Klaviatura va sichqoncha holati. */
export const input = {
  /** O'yin rejimida (menyu ochiq emas) */
  active: false,
  /** Pointer lock ishlamagan brauzerlar uchun: sichqonchani bosib turib qarash */
  dragLook: false,
  keys: new Set<string>(),
  /** Oxirgi kadrdan beri yig'ilgan sichqoncha siljishi */
  mouseDX: 0,
  mouseDY: 0,
  /** Bir martalik bosilishlar (E, F, raqamlar) */
  pressed: new Set<string>(),
  /** Bir martalik qo'yib yuborishlar (Q) */
  released: new Set<string>(),
  /** Zaxira rejimda Esc bosilganda chaqiriladi */
  onEscape: null as null | (() => void),
};

let installed = false;

export function installInput(canvas: HTMLElement) {
  if (installed) return () => {};
  installed = true;

  const down = (e: KeyboardEvent) => {
    if (!input.active) return;
    if (e.code === 'Escape' && input.dragLook) input.onEscape?.();
    if (!input.keys.has(e.code)) input.pressed.add(e.code);
    input.keys.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
  };
  const up = (e: KeyboardEvent) => {
    if (input.keys.delete(e.code)) input.released.add(e.code);
  };
  const move = (e: MouseEvent) => {
    if (!input.active) return;
    const locked = document.pointerLockElement === canvas;
    if (!locked && !(input.dragLook && e.buttons & 1)) return;
    // Ba'zi brauzerlarda pointer lock boshida katta sakrash bo'ladi
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
    input.mouseDX += e.movementX;
    input.mouseDY += e.movementY;
  };
  const blur = () => input.keys.clear();

  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  window.addEventListener('mousemove', move);
  window.addEventListener('blur', blur);
  return () => {
    installed = false;
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    window.removeEventListener('mousemove', move);
    window.removeEventListener('blur', blur);
  };
}

export function consumePress(code: string) {
  return input.pressed.delete(code);
}

export function consumeRelease(code: string) {
  return input.released.delete(code);
}
