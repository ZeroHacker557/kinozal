/**
 * Ovozli suhbat (LiveKit): mikrofon, xonaga ulanish va fazoviy ovoz.
 *
 * - Xonada boshqa odam bo'lsagina LiveKit'ga ulanadi (yolg'iz qolinsa biroz kutib uziladi) - bepul daqiqalar tejaladi.
 * - Har bir odamning ovozi Web Audio orqali uning avatari boshidan chiqadi (PannerNode, HRTF);
 *   eshituvchi - kamera. "Yumshoq" model: yo'nalish aniq, masofa ovozni faqat biroz pasaytiradi.
 * - Identity = o'yin serveridagi player id, shuning uchun avatarlar bilan to'g'ridan-to'g'ri bog'lanadi.
 */
import {
  Room, RoomEvent, Track, createLocalAudioTrack, LocalAudioTrack, setLogLevel, LogLevel,
  type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication, type TrackPublication, type Participant,
  type AudioCaptureOptions,
} from 'livekit-client';
import type * as THREE from 'three';
import { audioContext } from '../audio/context';
import { useRoom } from '../net/roomStore';
import { requestVoiceToken } from '../net/net';
import { useVoice } from './voiceStore';

// LiveKit info darajasida har necha soniyada statistika yozadi - faqat ogohlantirishlar kerak
setLogLevel(LogLevel.warn);

/** Fazoviy ovoz: refDistance gacha to'liq baland, keyin sekin pasayadi (20 m da ~25%). */
const SPATIAL = { refDistance: 2.5, rolloff: 0.4, maxDistance: 60 };
const CAPTURE: AudioCaptureOptions = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
/** Yolg'iz qolganda ovoz serveridan uzilishdan oldin kutish */
const ALONE_GRACE_MS = 20_000;
/** Gapirish chegarasi (RMS) va "gapiryapti" holatini ushlab turish */
const SPEAK_RMS = 0.012;
const SPEAK_HOLD_MS = 350;

interface Peer {
  stream: MediaStream;
  /** Chrome'da WebRTC oqimi faqat media elementga ulangandagina Web Audio'ga "oqadi" */
  el: HTMLAudioElement;
  src: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  gain: GainNode;
  panner: PannerNode;
  buf: Float32Array<ArrayBuffer>;
  speakingUntil: number;
}

let room: Room | null = null;
let connecting = false;
/** Ovoz serveriga ulanib turish kerakmi (boshqalar bor) */
let wantRoom = false;
let aloneTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 2000;

let mic: LocalAudioTrack | null = null;
let micStarting: Promise<void> | null = null;
let micAnalyser: AnalyserNode | null = null;
let micSrc: MediaStreamAudioSourceNode | null = null;
let micBuf: Float32Array<ArrayBuffer> | null = null;
let selfSpeakingUntil = 0;
/** Sinov uchun: mikrofon o'rniga sintez ohang (Hz) */
let testTone: number | null = null;
let toneStop: (() => void) | null = null;

let master: GainNode | null = null;
const peers = new Map<string, Peer>();

/** Mikrofondan boshqa treklar (ekran ulashish) uchun ilgaklar - screen/screenShare.ts o'rnatadi */
export interface RoomHooks {
  connected(r: Room): void;
  disconnected(): void;
  subscribed(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant): void;
  unsubscribed(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant): void;
}
let hooks: RoomHooks | null = null;
export function setRoomHooks(h: RoomHooks) {
  hooks = h;
}

/** Yolg'iz bo'lsa ham xonaga ulanib turish sababi (masalan, ekran ulashilmoqda) */
let demand = false;

/** Hozirgi LiveKit xonasi (ulangan bo'lsa) */
export function currentRoom() {
  return room;
}

/** Yolg'iz bo'lsa ham ovoz serveriga ulanib turish (true) yoki odatiy rejim (false). */
export function requireRoom(on: boolean) {
  demand = on;
  sync();
}

/** Xonaga ulanishni kutish (ulanmagan bo'lsa requireRoom bilan birga chaqiriladi). */
export function whenRoomReady(timeoutMs = 15_000): Promise<Room> {
  if (room) return Promise.resolve(room);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      unsub();
      reject(new Error("Ovoz serveriga ulanib bo'lmadi"));
    }, timeoutMs);
    const unsub = useVoice.subscribe((s) => {
      if (s.status === 'connected' && room) {
        clearTimeout(t);
        unsub();
        resolve(room);
      }
    });
  });
}

const store = () => useVoice.getState();

function masterNode(ctx: AudioContext) {
  if (!master) {
    master = ctx.createGain();
    master.gain.value = store().master;
    master.connect(ctx.destination);
  }
  return master;
}

function rms(a: AnalyserNode, buf: Float32Array<ArrayBuffer>) {
  a.getFloatTimeDomainData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / buf.length);
}

function volumeFor(id: string) {
  const nick = useRoom.getState().players[id]?.nickname;
  return nick ? (store().volumes[nick] ?? 1) : 1;
}

// ------------------------------------------------------------------ mikrofon

function micErrorText(e: unknown) {
  const name = (e as { name?: string })?.name;
  if (!window.isSecureContext) return 'Mikrofon faqat https yoki localhost orqali ishlaydi';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Mikrofonga ruxsat berilmadi';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Mikrofon topilmadi';
  if (name === 'NotReadableError') return 'Mikrofon boshqa dasturda band';
  return "Mikrofonni ochib bo'lmadi";
}

async function createToneTrack(freq: number) {
  const ctx = audioContext()!;
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.value = 0.25;
  const dest = ctx.createMediaStreamDestination();
  osc.connect(g).connect(dest);
  osc.start();
  toneStop = () => {
    osc.stop();
    osc.disconnect();
  };
  return new LocalAudioTrack(dest.stream.getAudioTracks()[0], undefined, true);
}

async function refreshInputs() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const inputs = list
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || `Mikrofon ${i + 1}` }));
    store().set({ inputs });
  } catch {
    /* qurilmalar ro'yxati yo'q */
  }
}

function ensureMic(): Promise<void> {
  if (mic) return Promise.resolve();
  micStarting ??= (async () => {
    try {
      const track =
        testTone !== null
          ? await createToneTrack(testTone)
          : await createLocalAudioTrack({ ...CAPTURE, deviceId: store().inputId || undefined });
      if (!isActive()) {
        track.stop();
        toneStop?.();
        toneStop = null;
        return;
      }
      mic = track;
      if (!store().micOn) await track.mute();
      store().set({ micError: null });
      const ctx = audioContext();
      if (ctx) {
        micSrc = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
        micAnalyser = ctx.createAnalyser();
        micAnalyser.fftSize = 512;
        micBuf = new Float32Array(micAnalyser.fftSize);
        micSrc.connect(micAnalyser);
      }
      void refreshInputs();
      if (room?.state === 'connected') await publishMic();
    } catch (e) {
      console.warn('[voice] mikrofon:', e);
      store().set({ micError: micErrorText(e), micOn: false });
    } finally {
      micStarting = null;
    }
  })();
  return micStarting;
}

async function publishMic() {
  // Trek tugagan bo'lsa (qurilma uzildi va h.k.) - mikrofonni qaytadan ochish
  if (mic && mic.mediaStreamTrack.readyState === 'ended') {
    stopMic();
    await ensureMic();
  }
  if (!room || !mic) return;
  if (room.localParticipant.getTrackPublication(Track.Source.Microphone)) return;
  try {
    await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone, dtx: true, red: true });
  } catch (e) {
    console.warn('[voice] publish:', e);
  }
}

function stopMic() {
  micSrc?.disconnect();
  micSrc = micAnalyser = null;
  micBuf = null;
  if (mic) {
    if (room) void room.localParticipant.unpublishTrack(mic, true).catch(() => {});
    mic.stop();
    mic = null;
  }
  toneStop?.();
  toneStop = null;
  store().set({ selfSpeaking: false });
}

/** Mikrofonni yoqish/o'chirish (M). Ruxsat berilmagan bo'lsa qayta so'raydi. */
export async function setMicOn(on: boolean) {
  store().set(on ? { micOn: true, micError: null } : { micOn: false });
  if (on && !mic && isActive()) await ensureMic();
  if (!mic) return;
  if (on) await mic.unmute();
  else await mic.mute();
}

export function toggleMic() {
  return setMicOn(!store().micOn);
}

export async function setInputDevice(id: string) {
  store().setInputId(id);
  if (mic && testTone === null) {
    try {
      await mic.setDeviceId(id || 'default');
    } catch (e) {
      console.warn('[voice] qurilma:', e);
    }
  }
}

// ------------------------------------------------------------------ boshqalarning ovozi

function addPeer(id: string, track: RemoteTrack) {
  removePeer(id);
  const ctx = audioContext();
  if (!ctx) return;
  const stream = new MediaStream([track.mediaStreamTrack]);
  const el = new Audio();
  el.muted = true;
  el.srcObject = stream;
  void el.play().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const gain = ctx.createGain();
  gain.gain.value = volumeFor(id);
  const panner = ctx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = SPATIAL.refDistance;
  panner.rolloffFactor = SPATIAL.rolloff;
  panner.maxDistance = SPATIAL.maxDistance;
  src.connect(analyser);
  src.connect(gain).connect(panner).connect(masterNode(ctx));
  peers.set(id, { stream, el, src, analyser, gain, panner, buf: new Float32Array(analyser.fftSize), speakingUntil: 0 });
}

function removePeer(id: string) {
  const p = peers.get(id);
  if (!p) return;
  p.src.disconnect();
  p.gain.disconnect();
  p.panner.disconnect();
  p.el.pause();
  p.el.srcObject = null;
  peers.delete(id);
}

function hasAudio(p: Participant) {
  const pub = p.getTrackPublication(Track.Source.Microphone);
  return !!pub && !pub.isMuted;
}

// ------------------------------------------------------------------ xonaga ulanish

function isActive() {
  const s = useRoom.getState();
  return s.status === 'connected' && s.voice;
}

function scheduleRetry() {
  if (retryTimer || !wantRoom) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (wantRoom && !room) void connectRoom();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 30_000);
}

/** Ovoz serveri manzili: "localhost" boshqa qurilmadan ochilganda sahifa manziliga almashtiriladi. */
function resolveUrl(url: string) {
  try {
    const u = new URL(url);
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && location.hostname !== 'localhost') {
      u.hostname = location.hostname;
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function connectRoom() {
  if (room || connecting) return;
  connecting = true;
  store().set({ status: 'connecting' });
  const r = new Room({
    audioCaptureDefaults: CAPTURE,
    adaptiveStream: false,
    dynacast: false,
    disconnectOnPageLeave: true,
    // Mikrofon trekini biz boshqaramiz: uzilishda LiveKit uni to'xtatib qo'ymasin (qayta ulanishda o'sha trek yuboriladi)
    stopLocalTrackOnUnpublish: false,
  });
  try {
    const { url, token } = await requestVoiceToken();
    bindRoom(r);
    await r.connect(resolveUrl(url), token, { autoSubscribe: true });
    if (!wantRoom || !isActive()) {
      r.removeAllListeners();
      await r.disconnect();
      store().set({ status: 'off' });
      return;
    }
    room = r;
    retryDelay = 2000;
    store().set({ status: 'connected' });
    for (const p of r.remoteParticipants.values()) store().setPeer(p.identity, { muted: !hasAudio(p), speaking: false });
    hooks?.connected(r);
    await ensureMic();
    await publishMic();
  } catch (e) {
    console.warn('[voice] ulanish:', e);
    r.removeAllListeners();
    void r.disconnect();
    if (isActive()) {
      store().set({ status: 'error' });
      scheduleRetry();
    } else store().set({ status: 'off' });
  } finally {
    connecting = false;
  }
}

function bindRoom(r: Room) {
  const remote = (p: Participant) => p !== r.localParticipant;
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (pub.source !== Track.Source.Microphone) return hooks?.subscribed(track, pub, p);
    addPeer(p.identity, track);
    store().setPeer(p.identity, { muted: pub.isMuted });
  });
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (pub.source !== Track.Source.Microphone) return hooks?.unsubscribed(track, pub, p);
    removePeer(p.identity);
    store().setPeer(p.identity, { muted: true, speaking: false });
  });
  r.on(RoomEvent.TrackMuted, (_pub: TrackPublication, p: Participant) => {
    if (remote(p)) store().setPeer(p.identity, { muted: !hasAudio(p), speaking: false });
  });
  r.on(RoomEvent.TrackUnmuted, (_pub: TrackPublication, p: Participant) => {
    if (remote(p)) store().setPeer(p.identity, { muted: !hasAudio(p) });
  });
  r.on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (pub.source === Track.Source.Microphone) store().setPeer(p.identity, { muted: !hasAudio(p) });
  });
  r.on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (pub.source === Track.Source.Microphone) store().setPeer(p.identity, { muted: true, speaking: false });
  });
  r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => store().setPeer(p.identity, { muted: !hasAudio(p) }));
  r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
    removePeer(p.identity);
    store().setPeer(p.identity, null);
  });
  r.on(RoomEvent.Reconnecting, () => store().set({ status: 'reconnecting' }));
  r.on(RoomEvent.Reconnected, () => store().set({ status: 'connected' }));
  r.on(RoomEvent.Disconnected, () => {
    if (room !== r) return;
    room = null;
    r.removeAllListeners();
    clearPeers();
    hooks?.disconnected();
    store().set({ status: wantRoom && isActive() ? 'error' : 'off' });
    // Kutilmagan uzilish (server o'chdi, tarmoq) - qayta urinish
    if (wantRoom && isActive()) scheduleRetry();
  });
}

function clearPeers() {
  for (const id of [...peers.keys()]) removePeer(id);
  store().set({ peers: {} });
}

function disconnectRoom() {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const r = room;
  room = null;
  clearPeers();
  if (r) hooks?.disconnected();
  if (r) {
    // Ataylab uzilish: uzilish paytidagi TrackUnsubscribed va boshqa hodisalar peer'larni qayta qo'shmasin
    r.removeAllListeners();
    if (mic) void r.localParticipant.unpublishTrack(mic, false).catch(() => {});
    void r.disconnect();
  }
  store().set({ status: 'off' });
}

/** O'yin xonasi holatiga qarab ovozni boshqarish (xonaga kirish/chiqish, boshqalar soni). */
function sync() {
  const s = useRoom.getState();
  if (!isActive()) {
    wantRoom = false;
    demand = false;
    if (aloneTimer) clearTimeout(aloneTimer);
    aloneTimer = null;
    if (room || retryTimer) disconnectRoom();
    if (mic || micStarting) stopMic();
    // Keyingi kirishda mikrofon yana yoqiq holda boshlanadi
    if (!store().micOn || store().micError) store().set({ micOn: true, micError: null });
    return;
  }
  // Ruxsat berilmagan bo'lsa qayta-qayta so'ramaymiz - foydalanuvchi M bosganda so'raladi
  if (!store().micError) void ensureMic();
  const others = Object.keys(s.players).some((id) => id !== s.selfId);
  if (others || demand) {
    if (aloneTimer) clearTimeout(aloneTimer);
    aloneTimer = null;
    wantRoom = true;
    if (!room && !connecting && !retryTimer) void connectRoom();
  } else if (wantRoom && !aloneTimer) {
    aloneTimer = setTimeout(() => {
      aloneTimer = null;
      wantRoom = false;
      disconnectRoom();
    }, ALONE_GRACE_MS);
  }
}

let installed = false;

/** Bir marta chaqiriladi (ilova boshlanganda). */
export function installVoice() {
  if (installed) return;
  installed = true;
  useRoom.subscribe(sync);
  useVoice.subscribe((s, prev) => {
    if (s.master !== prev.master && master) master.gain.value = s.master;
    if (s.volumes !== prev.volumes) for (const [id, p] of peers) p.gain.gain.value = volumeFor(id);
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => void refreshInputs());
}

// ------------------------------------------------------------------ har kadr

type Vec = THREE.Vector3;

function setParam(p: AudioParam, v: number, t: number) {
  p.setTargetAtTime(v, t, 0.03);
}

/**
 * Ovoz manbalarini (avatar boshi) yangilash, kim gapirayotganini aniqlash.
 * head(id) - avatar boshi joylashuvi (ko'rinmasa undefined).
 */
export function voiceFrame(head: (id: string) => Vec | undefined) {
  const ctx = master?.context as AudioContext | undefined;
  const now = performance.now();
  if (ctx && peers.size) {
    const t = ctx.currentTime;
    // Eshituvchi (listener) audio/context.ts updateListener'da yangilanadi
    for (const [id, p] of peers) {
      const h = head(id);
      if (h) {
        setParam(p.panner.positionX, h.x, t);
        setParam(p.panner.positionY, h.y, t);
        setParam(p.panner.positionZ, h.z, t);
      }
    }
  }
  const s = store();
  for (const [id, p] of peers) {
    if (rms(p.analyser, p.buf) > SPEAK_RMS) p.speakingUntil = now + SPEAK_HOLD_MS;
    const speaking = now < p.speakingUntil && !s.peers[id]?.muted;
    if (s.peers[id] && s.peers[id].speaking !== speaking) s.setPeer(id, { speaking });
  }
  if (micAnalyser && micBuf && s.micOn) {
    if (rms(micAnalyser, micBuf) > SPEAK_RMS) selfSpeakingUntil = now + SPEAK_HOLD_MS;
  }
  const selfSpeaking = s.micOn && now < selfSpeakingUntil;
  if (selfSpeaking !== s.selfSpeaking) s.set({ selfSpeaking });
}

/** Mikrofon darajasi 0..1 (HUD indikatori uchun) */
export function micLevel() {
  if (!micAnalyser || !micBuf || !store().micOn) return 0;
  return Math.min(1, rms(micAnalyser, micBuf) * 8);
}

// ------------------------------------------------------------------ sinov

/** Sinov uchun: mikrofon o'rniga ohang yuborish (null - haqiqiy mikrofonga qaytish). */
export async function setTestTone(freq: number | null) {
  testTone = freq;
  stopMic();
  if (isActive()) await ensureMic();
}

let stereo: { l: AnalyserNode; r: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;

/** Sinov uchun: umumiy chiqishning chap/o'ng kanal darajasi (fazoviylikni tekshirish). */
export function voiceStereo() {
  if (!master) return null;
  if (!stereo) {
    const ctx = master.context;
    const split = ctx.createChannelSplitter(2);
    const l = ctx.createAnalyser(), r = ctx.createAnalyser();
    l.fftSize = r.fftSize = 2048;
    master.connect(split);
    split.connect(l, 0);
    split.connect(r, 1);
    stereo = { l, r, buf: new Float32Array(2048) };
  }
  return { l: +rms(stereo.l, stereo.buf).toFixed(4), r: +rms(stereo.r, stereo.buf).toFixed(4) };
}

export function voiceDebug() {
  return {
    status: store().status,
    room: room?.name ?? null,
    mic: mic ? { muted: mic.isMuted, state: mic.mediaStreamTrack.readyState, published: !!room?.localParticipant.getTrackPublication(Track.Source.Microphone) } : null,
    peers: [...peers].map(([id, p]) => ({
      id,
      level: +rms(p.analyser, p.buf).toFixed(4),
      gain: p.gain.gain.value,
      pos: [p.panner.positionX.value, p.panner.positionY.value, p.panner.positionZ.value].map((v) => +v.toFixed(2)),
    })),
    ctx: master?.context.state ?? null,
    remote: [...(room?.remoteParticipants.values() ?? [])].map((p) => ({
      id: p.identity,
      pubs: [...p.trackPublications.values()].map((t) => ({ source: t.source, muted: t.isMuted, subscribed: t.isSubscribed })),
    })),
  };
}
