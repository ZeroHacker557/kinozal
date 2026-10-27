import { create } from 'zustand';
import { input } from '../player/input';
import { AVATARS, MAPS, type AvatarId, type MapId, type Pose } from '@shared/protocol.ts';

export type Quality = 'low' | 'medium' | 'high';
export type Phase = 'menu' | 'playing' | 'paused';

function load<T extends string>(key: string, valid: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    if (v && valid.includes(v)) return v;
  } catch {
    /* localStorage yopiq bo'lishi mumkin */
  }
  return fallback;
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* e'tiborsiz */
  }
}

const AVATAR_IDS = AVATARS.map((a) => a.id);

interface GameState {
  phase: Phase;
  setPhase: (p: Phase) => void;

  quality: Quality;
  setQuality: (q: Quality) => void;

  nickname: string;
  setNickname: (n: string) => void;
  avatar: AvatarId;
  setAvatar: (a: AvatarId) => void;
  /** Menyuda tanlangan xarita (yangi xona yaratish va yolg'iz kirish uchun) */
  map: MapId;
  setMap: (m: MapId) => void;

  /** Zal chiroqlari yoqilganmi (devordagi tugma). Online rejimda server boshqaradi. */
  lightsOn: boolean;
  setLightsOn: (on: boolean) => void;

  /** O'zimiz o'tirgan o'rindiq */
  seat: string | null;
  setSeat: (s: string | null) => void;
  /** Hozirgi harakat (poza) */
  pose: Pose | null;
  setPose: (p: Pose | null) => void;
  /** Qo'l fonari */
  flashlight: boolean;
  setFlashlight: (on: boolean) => void;
  /** Harakatlar g'ildiragi ochiqmi (Q bosib turilganda) */
  wheelOpen: boolean;
  setWheelOpen: (o: boolean) => void;
  /** G'ildirakda tanlangan bo'lak (-1 - hech narsa) */
  wheelSel: number;
  setWheelSel: (i: number) => void;

  /** Barcha shaderlar kompilyatsiya qilinib, sahna silliq chizishga tayyor */
  sceneReady: boolean;
  setSceneReady: (r: boolean) => void;

  /** Ko'z oldidagi interaktiv obyekt uchun ko'rsatma ("E — Chiroqni o'chirish") */
  prompt: string | null;
  setPrompt: (p: string | null) => void;
}

export const useGame = create<GameState>((set) => ({
  phase: 'menu',
  setPhase: (phase) => {
    input.active = phase === 'playing';
    if (!input.active) input.keys.clear();
    set({ phase });
  },

  quality: load('quality', ['low', 'medium', 'high'] as const, 'medium'),
  setQuality: (quality) => {
    save('quality', quality);
    set({ quality });
  },

  nickname: (() => {
    try {
      return localStorage.getItem('nickname') ?? '';
    } catch {
      return '';
    }
  })(),
  setNickname: (nickname) => {
    save('nickname', nickname);
    set({ nickname });
  },
  avatar: load('avatar', AVATAR_IDS, AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)]),
  setAvatar: (avatar) => {
    save('avatar', avatar);
    set({ avatar });
  },

  map: load('map', MAPS.map((m) => m.id), 'hall'),
  setMap: (map) => {
    save('map', map);
    set({ map, seat: null, pose: null });
  },

  lightsOn: true,
  setLightsOn: (lightsOn) => set({ lightsOn }),

  seat: null,
  setSeat: (seat) => set({ seat, pose: null }),
  pose: null,
  setPose: (pose) => set({ pose }),
  flashlight: false,
  setFlashlight: (flashlight) => set({ flashlight }),
  wheelOpen: false,
  setWheelOpen: (wheelOpen) => set({ wheelOpen, wheelSel: -1 }),
  wheelSel: -1,
  setWheelSel: (wheelSel) => set((s) => (s.wheelSel === wheelSel ? s : { wheelSel })),

  sceneReady: false,
  setSceneReady: (sceneReady) => set({ sceneReady }),

  prompt: null,
  setPrompt: (prompt) => set((s) => (s.prompt === prompt ? s : { prompt })),
}));
