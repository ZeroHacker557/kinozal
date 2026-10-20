import { create } from 'zustand';
import type { AvatarId, Pose, RoomInfo } from '@shared/protocol.ts';

/** Boshqa player haqida kam o'zgaradigan ma'lumot (UI va avatarlar uchun reaktiv). */
export interface PlayerMeta {
  id: string;
  nickname: string;
  avatar: AvatarId;
  seat: string | null;
  pose: Pose | null;
  /** Pozani boshlash vaqti (mahalliy ms) */
  poseAt: number;
}

export type NetStatus = 'idle' | 'connecting' | 'connected' | 'offline' | 'error';

export interface Toast {
  id: number;
  text: string;
}

interface RoomState {
  status: NetStatus;
  error: string | null;
  room: RoomInfo | null;
  selfId: string | null;
  players: Record<string, PlayerMeta>;
  /** Serverda ovoz (LiveKit) sozlanganmi */
  voice: boolean;
  toasts: Toast[];
  set: (p: Partial<RoomState>) => void;
  upsertPlayer: (p: PlayerMeta) => void;
  patchPlayer: (id: string, p: Partial<PlayerMeta>) => void;
  removePlayer: (id: string) => void;
  toast: (text: string) => void;
}

let toastId = 1;

export const useRoom = create<RoomState>((set) => ({
  status: 'idle',
  error: null,
  room: null,
  selfId: null,
  players: {},
  voice: false,
  toasts: [],
  set: (p) => set(p),
  upsertPlayer: (p) => set((s) => ({ players: { ...s.players, [p.id]: p } })),
  patchPlayer: (id, p) =>
    set((s) => (s.players[id] ? { players: { ...s.players, [id]: { ...s.players[id], ...p } } } : s)),
  removePlayer: (id) =>
    set((s) => {
      const players = { ...s.players };
      delete players[id];
      return { players };
    }),
  toast: (text) => {
    const t = { id: toastId++, text };
    set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), 4000);
  },
}));

/** O'rindiq kim tomonidan band qilinganini topish */
export function seatOwner(seat: string): PlayerMeta | null {
  const { players } = useRoom.getState();
  for (const p of Object.values(players)) if (p.seat === seat) return p;
  return null;
}
