import type { Intersection, Object3D } from 'three';

/** Player qarab turib E bosganda ishlatiladigan obyekt (tugma, o'rindiqlar...). */
export interface Interactable {
  id: string;
  /** Nur (raycast) tekshiriladigan obyekt(lar) */
  target: Object3D | Object3D[];
  /** Maksimal masofa (metr) */
  maxDistance: number;
  /** Ekranda ko'rsatiladigan matn; null - bu nuqtada ishlatib bo'lmaydi */
  label: (hit: Intersection) => string | null;
  use: (hit: Intersection) => void;
}

const registry = new Map<string, Interactable>();

export const interactables = {
  add(i: Interactable) {
    registry.set(i.id, i);
    return () => {
      if (registry.get(i.id) === i) registry.delete(i.id);
    };
  },
  all() {
    return registry.values();
  },
};
