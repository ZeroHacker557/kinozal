import { audioContext } from './context';
import { ambientBus, rng } from './ambient';

/**
 * Tungi o'rmon ovozlari (hammasi sintez qilinadi):
 *  - shamol va barglar shitirlashi (fazoviy emas, keng stereo fon, shabada bilan kuchayib-pasayadi);
 *  - chigirtkalar (bir nechta, o'yinchi atrofidagi o'tlarda, fazoviy);
 *  - boyqush (daraxtlar orasidan, vaqti-vaqti bilan);
 *  - bo'ri uvlashi (uzoqdan, aks-sado bilan, kamdan-kam);
 *  - soy shildirashi (eng yaqin soy nuqtasidan).
 */

type V3 = { x: number; y: number; z: number };

function buffer(ctx: AudioContext, seconds: number, fill: (d: Float32Array, sr: number) => void, channels = 1) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(channels, n, ctx.sampleRate);
  for (let c = 0; c < channels; c++) fill(b.getChannelData(c), ctx.sampleRate);
  return b;
}

function normalize(d: Float32Array, peak: number) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const k = peak / (m || 1);
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

/** Bir qutbli past chastota filtri (namunalar ustida) */
function lowpass(d: Float32Array, sr: number, hz: number) {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / sr);
  let y = 0;
  for (let i = 0; i < d.length; i++) d[i] = y += a * (d[i] - y);
}

/** Shamol: pushti shovqin + sekin shabadalar; ikki kanal har xil (keng). cutoff - yuqori chegara (Hz) */
function windBuffer(ctx: AudioContext, cutoff = 900) {
  return buffer(
    ctx,
    24,
    (d, sr) => {
      const r = rng(Math.floor(Math.random() * 1e6));
      // Pushti shovqin (Paul Kellet)
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = b0 + b1 + b2 + b3 + b4 + b5 + w * 0.5362;
      }
      lowpass(d, sr, cutoff);
      // Shabadalar: sekin, tasodifiy egri (uchlari ulanadi)
      const pts = 7;
      const amp = Array.from({ length: pts }, () => 0.25 + r() * 0.75);
      amp.push(amp[0]);
      for (let i = 0; i < d.length; i++) {
        const t = (i / d.length) * pts;
        const k = Math.floor(t), f = t - k;
        const u = f * f * (3 - 2 * f);
        d[i] *= amp[k] * (1 - u) + amp[k + 1] * u;
      }
      // Uchlarni silliq ulash
      const fade = Math.floor(sr * 0.5);
      for (let i = 0; i < fade; i++) {
        const g = i / fade;
        d[i] = d[i] * g + d[d.length - fade + i] * (1 - g);
      }
      normalize(d, 0.8);
    },
    2,
  );
}

/** Chigirtka: 4-5 kHz qisqa zarbalar seriyasi, ma'lum davr bilan */
function cricketBuffer(ctx: AudioContext, seed: number) {
  return buffer(ctx, 6, (d, sr) => {
    const r = rng(seed);
    const f = 4200 + r() * 900;
    const period = 0.55 + r() * 0.5;
    const pulses = 3 + Math.floor(r() * 3);
    const pulseLen = 0.012 + r() * 0.006;
    const gap = 0.018 + r() * 0.01;
    for (let t0 = r() * 0.3; t0 < 6 - 0.3; t0 += period * (0.9 + r() * 0.2)) {
      for (let p = 0; p < pulses; p++) {
        const s = Math.floor((t0 + p * (pulseLen + gap)) * sr);
        const len = Math.floor(pulseLen * sr);
        for (let i = 0; i < len && s + i < d.length; i++) {
          const env = Math.sin((Math.PI * i) / len);
          d[s + i] += Math.sin((2 * Math.PI * f * i) / sr) * env * (0.7 + 0.3 * Math.sin((2 * Math.PI * f * 2.01 * i) / sr));
        }
      }
    }
    normalize(d, 0.6);
  });
}

/** Boyqush: "hu... hu-huuu" (pastga siljiydigan ohang, nafas shovqini bilan) */
function owlBuffer(ctx: AudioContext, seed: number) {
  return buffer(ctx, 2.4, (d, sr) => {
    const r = rng(seed);
    const base = 330 + r() * 70;
    const notes: [number, number, number][] = [[0.0, 0.32, 1.0], [0.62, 0.16, 0.8], [0.84, 0.5, 1.0]];
    for (const [start, len, amp] of notes) {
      const s = Math.floor(start * sr), n = Math.floor(len * sr);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const fr = base * (1.04 - 0.08 * t) * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * (i / sr)));
        ph += (2 * Math.PI * fr) / sr;
        const env = Math.min(1, t * 12) * Math.pow(1 - t, 0.6);
        const breath = (r() * 2 - 1) * 0.08;
        d[s + i] += (Math.sin(ph) + 0.18 * Math.sin(2 * ph) + breath) * env * amp;
      }
    }
    lowpass(d, sr, 1600);
    normalize(d, 0.7);
  });
}

/** Bo'ri uvlashi: sekin ko'tarilib-tushadigan ohang, garmonikalar, vibrato */
function wolfBuffer(ctx: AudioContext, seed: number) {
  return buffer(ctx, 4.6, (d, sr) => {
    const r = rng(seed);
    const f0 = 380 + r() * 80, f1 = f0 * (1.45 + r() * 0.2), f2 = f0 * (1.15 + r() * 0.1);
    let ph = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      const fr = t < 0.3 ? f0 + (f1 - f0) * Math.sin((t / 0.3) * Math.PI * 0.5) : f1 + (f2 - f1) * ((t - 0.3) / 0.7) ** 1.5;
      const vib = 1 + 0.012 * Math.sin(2 * Math.PI * 5 * (i / sr)) * Math.min(1, t * 3);
      ph += (2 * Math.PI * fr * vib) / sr;
      const env = Math.min(1, t * 6) * Math.pow(1 - t, 0.8);
      d[i] = (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.12 * Math.sin(3 * ph) + (r() * 2 - 1) * 0.04) * env;
    }
    lowpass(d, sr, 2200);
    normalize(d, 0.7);
  });
}

/** Soy: bir nechta rezonansli "shildir" + mayin shovqin */
function streamBuffer(ctx: AudioContext) {
  return buffer(ctx, 9, (d, sr) => {
    const r = rng(77);
    for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * 0.25;
    lowpass(d, sr, 2400);
    // Pufakchalar: qisqa, ohangi ko'tariladigan sinuslar
    for (let k = 0; k < 9 * 28; k++) {
      const s = Math.floor(r() * (d.length - sr * 0.05));
      const f = 400 + r() * 1400;
      const len = Math.floor(sr * (0.01 + r() * 0.03));
      const amp = 0.15 + r() * 0.5;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[s + i] += Math.sin(2 * Math.PI * f * (1 + t * 0.6) * (i / sr)) * Math.sin(Math.PI * t) * amp;
      }
    }
    const fade = Math.floor(sr * 0.4);
    for (let i = 0; i < fade; i++) d[i] = d[i] * (i / fade) + d[d.length - fade + i] * (1 - i / fade);
    normalize(d, 0.6);
  });
}

/** Sun'iy aks-sado (bo'ri uvlashi uchun): susayuvchi shovqin impulsi */
function reverbImpulse(ctx: AudioContext) {
  return buffer(
    ctx,
    3.2,
    (d, sr) => {
      const r = rng(5 + d.length);
      for (let i = 0; i < d.length; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / d.length, 3.2);
      lowpass(d, sr, 3000);
    },
    2,
  );
}

function panner(ctx: AudioContext, ref: number, rolloff: number) {
  const p = ctx.createPanner();
  p.panningModel = 'HRTF';
  p.distanceModel = 'inverse';
  p.refDistance = ref;
  p.rolloffFactor = rolloff;
  p.maxDistance = 400;
  return p;
}

function place(p: PannerNode, x: number, y: number, z: number) {
  const t = p.context.currentTime;
  if (p.positionX) {
    p.positionX.setTargetAtTime(x, t, 0.05);
    p.positionY.setTargetAtTime(y, t, 0.05);
    p.positionZ.setTargetAtTime(z, t, 0.05);
  } else p.setPosition(x, y, z);
}

export interface NatureSounds {
  /** Har kadr: tinglovchi joyi; streamPoint - eng yaqin soy nuqtasi (yo'q bo'lsa null) */
  update(listener: V3, streamPoint: V3 | null, nearCamp: boolean): void;
  stop(): void;
}

export function startNatureSounds(): NatureSounds {
  const ctx = audioContext();
  if (!ctx) return { update() {}, stop() {} };
  const bus = ambientBus(ctx);
  const nodes: AudioNode[] = [];
  const sources: AudioBufferSourceNode[] = [];
  const timers: number[] = [];
  const loop = (b: AudioBuffer, dest: AudioNode) => {
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.connect(dest);
    s.start(ctx.currentTime + 0.05, Math.random() * b.duration);
    sources.push(s);
    return s;
  };

  // Shamol (fazoviy emas)
  const windGain = ctx.createGain();
  windGain.gain.value = 0;
  windGain.gain.setTargetAtTime(0.16, ctx.currentTime, 2);
  windGain.connect(bus);
  loop(windBuffer(ctx), windGain);
  // Barglar shitirlashi: shamolning yuqori chastotali qismi, tez o'zgaruvchan
  const leaves = ctx.createBiquadFilter();
  leaves.type = 'bandpass';
  leaves.frequency.value = 3200;
  leaves.Q.value = 0.6;
  const leavesGain = ctx.createGain();
  leavesGain.gain.value = 0.05;
  leaves.connect(leavesGain).connect(bus);
  loop(windBuffer(ctx, 12000), leaves);
  nodes.push(windGain, leaves, leavesGain);

  // Chigirtkalar: 4 ta, tinglovchi atrofida; vaqti-vaqti bilan joyini o'zgartiradi
  const crickets = [11, 23, 37, 51].map((seed) => {
    const p = panner(ctx, 2, 1.4);
    const g = ctx.createGain();
    g.gain.value = 0.22;
    p.connect(g).connect(bus);
    loop(cricketBuffer(ctx, seed), p);
    nodes.push(p, g);
    return { p, g, ox: (Math.random() - 0.5) * 30, oz: (Math.random() - 0.5) * 30, until: 0 };
  });

  // Soy
  const streamP = panner(ctx, 3, 1.3);
  const streamG = ctx.createGain();
  streamG.gain.value = 0.5;
  streamP.connect(streamG).connect(bus);
  loop(streamBuffer(ctx), streamP);
  nodes.push(streamP, streamG);

  // Bir martalik ovozlar (boyqush, bo'ri) - tinglovchiga nisbatan tasodifiy yo'nalishda
  const owl = [3, 9, 14].map((s) => owlBuffer(ctx, s));
  const wolf = [21, 42].map((s) => wolfBuffer(ctx, s));
  const reverb = ctx.createConvolver();
  reverb.buffer = reverbImpulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(bus);
  nodes.push(reverb, wet);
  let last: V3 = { x: 0, y: 0, z: 0 };
  const oneShot = (buf: AudioBuffer, dist: number, height: number, gain: number, echo: boolean, rate = 1) => {
    if (ctx.state !== 'running') return;
    const a = Math.random() * Math.PI * 2;
    const p = panner(ctx, 6, 1);
    place(p, last.x + Math.cos(a) * dist, last.y + height, last.z + Math.sin(a) * dist);
    const g = ctx.createGain();
    g.gain.value = gain;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    s.connect(p).connect(g).connect(bus);
    if (echo) g.connect(reverb);
    s.start();
    s.onended = () => {
      s.disconnect();
      p.disconnect();
      g.disconnect();
    };
  };
  const schedule = (fn: () => void, min: number, max: number) => {
    const tick = () => {
      fn();
      timers.push(window.setTimeout(tick, (min + Math.random() * (max - min)) * 1000));
    };
    timers.push(window.setTimeout(tick, (min * 0.4 + Math.random() * (max - min) * 0.5) * 1000));
  };
  schedule(() => {
    const b = owl[Math.floor(Math.random() * owl.length)];
    oneShot(b, 25 + Math.random() * 35, 10, 0.5, false, 0.95 + Math.random() * 0.1);
    // Ba'zan javob beruvchi ikkinchi boyqush
    if (Math.random() < 0.35) timers.push(window.setTimeout(() => oneShot(owl[0], 60 + Math.random() * 40, 12, 0.35, false, 0.9), 2600 + Math.random() * 2000));
  }, 22, 65);
  schedule(() => oneShot(wolf[Math.floor(Math.random() * wolf.length)], 160 + Math.random() * 80, 20, 0.55, true, 0.95 + Math.random() * 0.1), 70, 170);

  return {
    update(listener, streamPoint, nearCamp) {
      last = listener;
      const now = performance.now();
      for (const c of crickets) {
        if (now > c.until) {
          c.ox = (Math.random() - 0.5) * 36;
          c.oz = (Math.random() - 0.5) * 36;
          c.until = now + 20000 + Math.random() * 30000;
        }
        place(c.p, listener.x + c.ox, listener.y - 1.4, listener.z + c.oz);
        // Gulxan yonida chigirtkalar jimroq (olov va odamlardan cho'chiydi)
        c.g.gain.setTargetAtTime(nearCamp ? 0.08 : 0.22, ctx.currentTime, 1.5);
      }
      if (streamPoint) {
        place(streamP, streamPoint.x, streamPoint.y, streamPoint.z);
        streamG.gain.setTargetAtTime(0.5, ctx.currentTime, 0.5);
      } else streamG.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
    },
    stop() {
      for (const t of timers) window.clearTimeout(t);
      const t = ctx.currentTime;
      windGain.gain.setTargetAtTime(0, t, 0.3);
      window.setTimeout(() => {
        for (const s of sources) {
          try {
            s.stop();
          } catch {
            /* allaqachon to'xtagan */
          }
          s.disconnect();
        }
        for (const n of nodes) n.disconnect();
      }, 1200);
    },
  };
}
