import type { Pose } from '@shared/protocol.ts';

/** Harakatlar g'ildiragi (Q) va raqam tugmalari uchun ro'yxat. Tartib - soat strelkasi bo'yicha. */
export const POSE_MENU: { pose: Pose; label: string; icon: string; key: string }[] = [
  { pose: 'wave', label: "Qo'l silkitish", icon: '👋', key: '1' },
  { pose: 'clap', label: 'Qarsak', icon: '👏', key: '2' },
  { pose: 'cheer', label: 'Xursandchilik', icon: '🙌', key: '3' },
  { pose: 'laugh', label: 'Kulish', icon: '😂', key: '4' },
  { pose: 'talk', label: 'Gapirish', icon: '💬', key: '5' },
  { pose: 'dance', label: 'Raqs', icon: '💃', key: '6' },
  { pose: 'dance2', label: 'Raqs 2', icon: '🕺', key: '7' },
  { pose: 'crouch', label: "Cho'kkalash", icon: '🧎', key: '8' },
  { pose: 'lie', label: 'Yotish', icon: '🛌', key: '9' },
];

/** G'ildirakda sichqoncha yo'nalishidan tanlangan bo'lak (-1 - markaz, hech narsa) */
export function wheelIndex(x: number, y: number): number {
  if (Math.hypot(x, y) < 40) return -1;
  // 0 - tepada, soat strelkasi bo'yicha
  const a = Math.atan2(x, -y);
  const n = POSE_MENU.length;
  return ((Math.round((a / (Math.PI * 2)) * n) % n) + n) % n;
}
