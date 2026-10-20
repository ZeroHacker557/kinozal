import { create } from 'zustand';

/**
 * off - ovoz serveriga ulanmagan (yolg'iz yoki ovoz sozlanmagan), connecting/reconnecting - ulanmoqda,
 * connected - suhbatda, error - ulanib bo'lmadi (qayta urinib turiladi).
 */
export type VoiceStatus = 'off' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** Boshqa playerning ovoz holati (kalit - player id). Yozuv yo'q bo'lsa - u ovozga ulanmagan. */
export interface PeerVoice {
  /** Mikrofoni o'chiq (yoki umuman yo'q) */
  muted: boolean;
  speaking: boolean;
}

interface VoiceState {
  status: VoiceStatus;
  /** Foydalanuvchi mikrofonni yoqib qo'yganmi (kirishda yoqiq, M bilan almashtiriladi) */
  micOn: boolean;
  /** Mikrofon olinmadi (ruxsat yo'q, qurilma yo'q) */
  micError: string | null;
  selfSpeaking: boolean;
  peers: Record<string, PeerVoice>;
  /** Umumiy ovoz balandligi (0..1.5) */
  master: number;
  /** Har bir kishining ovoz balandligi (kalit - nickname, sessiyadan sessiyaga saqlanadi); 0 - o'chirilgan */
  volumes: Record<string, number>;
  inputs: { id: string; label: string }[];
  /** Tanlangan mikrofon ('' - standart) */
  inputId: string;

  set: (p: Partial<VoiceState>) => void;
  setPeer: (id: string, p: Partial<PeerVoice> | null) => void;
  setMaster: (v: number) => void;
  setVolume: (nickname: string, v: number) => void;
  setInputId: (id: string) => void;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage yopiq bo'lishi mumkin */
  }
}

export const useVoice = create<VoiceState>((set) => ({
  status: 'off',
  micOn: true,
  micError: null,
  selfSpeaking: false,
  peers: {},
  master: load('voice.master', 1),
  volumes: load('voice.volumes', {} as Record<string, number>),
  inputs: [],
  inputId: load('voice.input', ''),

  set: (p) => set(p),
  setPeer: (id, p) =>
    set((s) => {
      if (p === null) {
        if (!(id in s.peers)) return s;
        const peers = { ...s.peers };
        delete peers[id];
        return { peers };
      }
      const prev = s.peers[id] ?? { muted: true, speaking: false };
      const next = { ...prev, ...p };
      if (s.peers[id] && prev.muted === next.muted && prev.speaking === next.speaking) return s;
      return { peers: { ...s.peers, [id]: next } };
    }),
  setMaster: (master) => {
    save('voice.master', master);
    set({ master });
  },
  setVolume: (nickname, v) =>
    set((s) => {
      const volumes = { ...s.volumes, [nickname]: v };
      if (v === 1) delete volumes[nickname];
      save('voice.volumes', volumes);
      return { volumes };
    }),
  setInputId: (inputId) => {
    save('voice.input', inputId);
    set({ inputId });
  },
}));
