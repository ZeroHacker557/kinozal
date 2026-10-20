/** Blender'dan eksport qilingan zal joylashuvi (public/models/layout.json). Koordinatalar three.js'da. */
export type Vec3 = [number, number, number];

export interface SeatInfo {
  id: string;
  row: string;
  number: number;
  position: Vec3;
}

export interface InteractableInfo {
  id: string;
  type: 'light_switch';
  position: Vec3;
  normal: Vec3;
}

export interface HallLayout {
  seats: SeatInfo[];
  armrests: Vec3[];
  interactables: InteractableInfo[];
  screen: { center: Vec3; width: number; height: number };
  projector: Vec3;
  spawn: { position: Vec3; lookAt: Vec3 };
  rowLetters: string;
  seatsPerRow: number;
}

let cache: Promise<HallLayout> | null = null;

export function loadLayout(): Promise<HallLayout> {
  cache ??= fetch('/models/layout.json').then((r) => {
    if (!r.ok) throw new Error(`layout.json: ${r.status}`);
    return r.json();
  });
  return cache;
}
