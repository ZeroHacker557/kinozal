import type { PlayerState } from '@shared/protocol.ts';

/** Boshqa playerlar harakatini silliq ko'rsatish uchun holatlar buferi (snapshot interpolation). */
interface Snapshot {
  t: number;
  s: PlayerState;
}

/** Interpolatsiya kechikishi: tarmoq tebranishini yashiradi (15 Hz -> ~2 snapshot) */
const DELAY = 140;
const buffers = new Map<string, Snapshot[]>();

export function pushSnapshot(id: string, t: number, s: PlayerState) {
  let b = buffers.get(id);
  if (!b) buffers.set(id, (b = []));
  if (b.length && t <= b[b.length - 1].t) return;
  b.push({ t, s });
  if (b.length > 30) b.splice(0, b.length - 30);
}

export function dropPlayer(id: string) {
  buffers.delete(id);
}

function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface Interpolated {
  p: [number, number, number];
  ry: number;
  hy: number;
  hp: number;
  g: number;
  fl: boolean;
  /** Gorizontal tezlik (m/s) - yurish animatsiyasi tezligi uchun */
  speed: number;
}

/** serverNow - server vaqtiga moslangan hozirgi vaqt */
export function sample(id: string, serverNow: number, out: Interpolated): boolean {
  const b = buffers.get(id);
  if (!b || !b.length) return false;
  const rt = serverNow - DELAY;
  let i = b.length - 1;
  while (i > 0 && b[i - 1].t > rt) i--;
  const next = b[i];
  const prev = i > 0 ? b[i - 1] : next;
  // Oxirgi snapshotdan keyin - qisqa ekstrapolyatsiyasiz to'xtab turadi
  const span = next.t - prev.t;
  const k = span > 0 ? Math.min(Math.max((rt - prev.t) / span, 0), 1) : 1;
  const a = prev.s, c = next.s;
  out.p[0] = a.p[0] + (c.p[0] - a.p[0]) * k;
  out.p[1] = a.p[1] + (c.p[1] - a.p[1]) * k;
  out.p[2] = a.p[2] + (c.p[2] - a.p[2]) * k;
  out.ry = lerpAngle(a.ry, c.ry, k);
  out.hy = lerpAngle(a.hy, c.hy, k);
  out.hp = a.hp + (c.hp - a.hp) * k;
  out.g = k < 0.5 ? a.g : c.g;
  out.fl = c.fl;
  out.speed = span > 0 ? Math.hypot(c.p[0] - a.p[0], c.p[2] - a.p[2]) / (span / 1000) : 0;
  return true;
}
