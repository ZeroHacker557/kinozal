import { create } from 'zustand';
import { audioContext } from './context';

/**
 * Atrof ovozlari (gulxan, keyinchalik tabiat). Hammasi sintez qilinadi - fayl yuklanmaydi.
 * Har bir manba fazoviy (HRTF): yo'nalishi eshitiladi, uzoqlashganda pasayadi.
 */

interface AmbientState {
  /** Atrof ovozlari balandligi (0..1.5) */
  volume: number;
  setVolume: (v: number) => void;
}

function loadVolume() {
  try {
    const v = Number(localStorage.getItem('ambient.volume'));
    return Number.isFinite(v) && localStorage.getItem('ambient.volume') !== null ? v : 1;
  } catch {
    return 1;
  }
}

export const useAmbient = create<AmbientState>((set) => ({
  volume: loadVolume(),
  setVolume: (volume) => {
    try {
      localStorage.setItem('ambient.volume', String(volume));
    } catch {
      /* e'tiborsiz */
    }
    set({ volume });
  },
}));

let bus: GainNode | null = null;

function ambientBus(ctx: AudioContext) {
  if (!bus) {
    bus = ctx.createGain();
    bus.gain.value = useAmbient.getState().volume;
    bus.connect(ctx.destination);
    useAmbient.subscribe((s) => bus && bus.gain.setTargetAtTime(s.volume, ctx.currentTime, 0.05));
  }
  return bus;
}

/** Takrorlanadigan tasodifiy sonlar (har safar bir xil "gulxan") */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Qisqa rezonansli "chirs": shovqin zarbasi + so'nuvchi rezonator (yog'och tolasi) */
function addCrackle(d: Float32Array, at: number, sr: number, amp: number, freq: number, decay: number, r: () => number) {
  const w = (2 * Math.PI * freq) / sr;
  const R = Math.exp(-1 / (decay * sr));
  const c1 = 2 * R * Math.cos(w), c2 = -R * R;
  const len = Math.min(Math.ceil(decay * sr * 7), 4000);
  const kick = Math.max(2, Math.floor(sr * 0.0004));
  let y1 = 0, y2 = 0;
  for (let i = 0; i < len; i++) {
    const x = i < kick ? (r() * 2 - 1) * (1 - i / kick) : 0;
    const y = x + c1 * y1 + c2 * y2;
    y2 = y1;
    y1 = y;
    d[(at + i) % d.length] += y * amp * (1 - R) * 4;
  }
}

/** 12 soniyalik uzluksiz (boshi-oxiri ulangan) gulxan ovozi */
export function synthFireLoop(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 12);
  const fade = Math.floor(sr * 0.6);
  const total = n + fade;
  const r = rng(1337);
  const bed = new Float32Array(total);
  // Past gurillash (jigarrang shovqin, past chastota) + yuqori shivirlash; sekin "nafas" bilan
  let brown = 0, lp = 0, hpLp = 0;
  const aLp = 1 - Math.exp((-2 * Math.PI * 320) / sr);
  const aHp = 1 - Math.exp((-2 * Math.PI * 2500) / sr);
  let mod = 0.5, modT = 0.5;
  for (let i = 0; i < total; i++) {
    if (i % 2048 === 0) modT = 0.35 + r() * 0.65;
    mod += (modT - mod) * 0.00012;
    const white = r() * 2 - 1;
    brown = (brown + 0.02 * white) / 1.02;
    lp += aLp * (brown - lp);
    hpLp += aHp * (white - hpLp);
    const hiss = white - hpLp;
    bed[i] = lp * 2.2 * (0.55 + 0.45 * mod) + hiss * 0.012 * mod;
  }
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  // Uchlarni silliq ulash: oxirgi `fade` namuna boshiga aralashtiriladi; fon past darajaga keltiriladi
  let sq = 0;
  for (let i = 0; i < n; i++) {
    d[i] = i < fade ? bed[i] * (i / fade) + bed[n + i] * (1 - i / fade) : bed[i];
    sq += d[i] * d[i];
  }
  const bedK = 0.055 / (Math.sqrt(sq / n) || 1);
  for (let i = 0; i < n; i++) d[i] *= bedK;
  // Chirsillashlar (alohida me'yorlanadi): ko'pi mayda, ba'zilari yirik (Pareto taqsimoti)
  const c = new Float32Array(n);
  const rate = 22;
  for (let t = 0; t < n; ) {
    t += Math.floor((-Math.log(1 - r()) / rate) * sr);
    const amp = Math.min(0.55, 0.035 / Math.pow(r() + 0.02, 0.75));
    addCrackle(c, t, sr, amp, 1400 + r() * 5200, 0.0006 + r() * 0.0022, r);
    if (r() < 0.12) addCrackle(c, t + Math.floor(sr * (0.004 + r() * 0.02)), sr, amp * 0.6, 2000 + r() * 4000, 0.001, r);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(c[i]));
  const k = 0.82 / (peak || 1);
  for (let i = 0; i < n; i++) d[i] = Math.max(-0.98, Math.min(0.98, d[i] + c[i] * k));
  return buf;
}

/** O'tin yorilishi: o'tkir zarba, past "tuk" va ketidan bir nechta mayda chirs */
function synthSplit(ctx: AudioContext, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * 0.35);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const r = rng(seed);
  addCrackle(d, 0, sr, 0.9, 900 + r() * 900, 0.006 + r() * 0.006, r);
  addCrackle(d, 2, sr, 0.6, 3000 + r() * 2500, 0.002, r);
  const tails = 2 + Math.floor(r() * 4);
  for (let k = 0; k < tails; k++) addCrackle(d, Math.floor(sr * (0.02 + r() * 0.25)), sr, 0.15 + r() * 0.3, 1500 + r() * 4500, 0.001 + r() * 0.002, r);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(d[i]));
  for (let i = 0; i < n; i++) d[i] *= 0.95 / (peak || 1);
  return buf;
}

let fireLoop: AudioBuffer | null = null;
let splits: AudioBuffer[] = [];

/**
 * Gulxan ovozini boshlash (x, y, z - olov markazi). To'xtatish funksiyasini qaytaradi.
 * AudioContext hali "uxlab" yotgan bo'lsa, foydalanuvchi birinchi bosganda o'zi eshitila boshlaydi.
 */
export function startFireSound(x: number, y: number, z: number): () => void {
  const ctx = audioContext();
  if (!ctx) return () => {};
  fireLoop ??= synthFireLoop(ctx);
  if (!splits.length) splits = [11, 23, 37, 41].map((s) => synthSplit(ctx, s));

  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.6;
  panner.rolloffFactor = 1.3;
  panner.maxDistance = 90;
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else panner.setPosition(x, y, z);
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setTargetAtTime(1.0, ctx.currentTime, 0.8); // sekin paydo bo'ladi
  panner.connect(out).connect(ambientBus(ctx));

  const loop = ctx.createBufferSource();
  loop.buffer = fireLoop;
  loop.loop = true;
  loop.connect(panner);
  loop.start(ctx.currentTime + 0.05, Math.random() * fireLoop.duration);

  // Vaqti-vaqti bilan o'tin yorilishi (takrorlanish sezilmasligi uchun tasodifiy)
  let timer = 0;
  const schedule = () => {
    timer = window.setTimeout(() => {
      if (ctx.state === 'running') {
        const s = ctx.createBufferSource();
        s.buffer = splits[Math.floor(Math.random() * splits.length)];
        s.playbackRate.value = 0.85 + Math.random() * 0.35;
        const g = ctx.createGain();
        g.gain.value = 0.35 + Math.random() * 0.45;
        s.connect(g).connect(panner);
        s.start();
      }
      schedule();
    }, 2500 + Math.random() * 7000);
  };
  schedule();

  return () => {
    window.clearTimeout(timer);
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    window.setTimeout(() => {
      loop.stop();
      loop.disconnect();
      out.disconnect();
    }, 1200);
  };
}
