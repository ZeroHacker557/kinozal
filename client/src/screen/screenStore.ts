import { create } from 'zustand';

export type ShareQuality = '1080p' | '720p';
/** idle - ulashilmayapti, starting - ekran tanlanmoqda/yuborilmoqda, live - efirda */
export type ShareState = 'idle' | 'starting' | 'live';

interface ScreenState {
  /** Zal ekranida ko'rsatiladigan video (boshqaning ulashgani yoki o'zimizniki) */
  video: MediaStreamTrack | null;
  /** O'zimizning ulashish holatimiz */
  share: ShareState;
  /** Ulashish sifati (xona egasi tanlaydi) */
  quality: ShareQuality;
  /** Kino ovozi balandligi (0..1.5) */
  movieVolume: number;
  /** 2D to'liq ekran rejimi (V) */
  fullscreen: boolean;

  set: (p: Partial<ScreenState>) => void;
  setQuality: (q: ShareQuality) => void;
  setMovieVolume: (v: number) => void;
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

export const useScreen = create<ScreenState>((set) => ({
  video: null,
  share: 'idle',
  quality: load<ShareQuality>('screen.quality', '1080p') === '720p' ? '720p' : '1080p',
  movieVolume: load('screen.volume', 1),
  fullscreen: false,

  set: (p) => set(p),
  setQuality: (quality) => {
    save('screen.quality', quality);
    set({ quality });
  },
  setMovieVolume: (movieVolume) => {
    save('screen.volume', movieVolume);
    set({ movieVolume });
  },
}));
