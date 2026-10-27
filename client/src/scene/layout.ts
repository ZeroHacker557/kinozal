/** Blender'dan eksport qilingan xarita joylashuvi (layout.json). Koordinatalar three.js'da. */
export type Vec3 = [number, number, number];

export interface SeatInfo {
  id: string;
  row: string;
  number: number;
  /** O'rindiq ostidagi pol nuqtasi */
  position: Vec3;
  /** Qaragan yo'nalish (yaw, radian; 0 - -Z). Zal o'rindiqlarida yo'q - hammasi ekranga qaragan */
  yaw?: number;
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

const cache = new Map<string, Promise<unknown>>();

export function loadJson<T>(url: string): Promise<T> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    });
    cache.set(url, p);
  }
  return p as Promise<T>;
}

export function loadLayout(): Promise<HallLayout> {
  return loadJson<HallLayout>('/models/layout.json');
}
