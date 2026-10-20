/** Kichik sintezlangan ovoz effektlari (fayl kerak emas). */
import { audioContext as audio } from './context';

function noiseBurst(a: AudioContext, at: number, dur: number, freq: number, gain: number, q = 4) {
  const len = Math.ceil(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = a.createBufferSource();
  src.buffer = buf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination);
  src.start(at);
}

/** Gilamdagi yumshoq qadam ovozi (har safar biroz farqli). */
export function playFootstep(running: boolean) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.002;
  const v = running ? 0.11 : 0.07;
  noiseBurst(a, t, 0.07, 180 + Math.random() * 90, v * (0.8 + Math.random() * 0.4), 0.9);
  noiseBurst(a, t + 0.015, 0.05, 900 + Math.random() * 400, v * 0.25, 1.2);
}

/** Qo'l fonari tugmasi (kichik, plastik "tiq"). */
export function playFlashlightClick(on: boolean) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.002;
  noiseBurst(a, t, 0.012, on ? 4200 : 3600, 0.35, 4);
  noiseBurst(a, t + 0.008, 0.02, 2200, 0.15, 2);
}

/** Devordagi chiroq tugmasining "chirk" ovozi. */
export function playSwitchClick(on: boolean) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + 0.005;
  noiseBurst(a, t, 0.018, on ? 3200 : 2600, 0.9, 3);
  noiseBurst(a, t + 0.012, 0.03, on ? 1400 : 1100, 0.5, 2);
  // Rele/dimmer'ning yengil "tiq" ovozi (uzoqroqdan)
  noiseBurst(a, t + 0.09, 0.02, 700, 0.08, 1.5);
}
