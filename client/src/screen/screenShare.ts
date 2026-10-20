/**
 * Ekran ulashish (LiveKit "screen_share" + "screen_share_audio").
 *
 * - Ulashuvchi: brauzer oynasidan ekran/oyna/tab tanlanadi, kino uchun sozlangan holda yuboriladi
 *   (silliq kadrlar, simulcast, stereo ovoz aks-sado tozalashsiz).
 * - Tomoshabin: presenter'ning videosi zal ekraniga (Screen.tsx), ovozi to'g'ridan-to'g'ri stereo chiqadi.
 * - Xona LiveKit ulanishi voice.ts'da; bu modul uning hodisalariga ilgaklar orqali ulanadi.
 */
import {
  Track, VideoPreset, AudioPresets, VideoQuality, createLocalScreenTracks, LocalAudioTrack, LocalVideoTrack,
  type LocalTrack, type Room, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant,
} from 'livekit-client';
import { audioContext } from '../audio/context';
import { useRoom } from '../net/roomStore';
import { send } from '../net/net';
import { useGame } from '../state/store';
import { currentRoom, requireRoom, setRoomHooks, whenRoomReady } from '../voice/voice';
import { useScreen, type ShareQuality } from './screenStore';

const ENCODING: Record<ShareQuality, { w: number; h: number; bitrate: number; layers: VideoPreset[] }> = {
  // Simulcast: sekin internetdagi tomoshabin avtomatik pastki qatlamni oladi
  '1080p': { w: 1920, h: 1080, bitrate: 3_000_000, layers: [new VideoPreset(1280, 720, 1_200_000, 30), new VideoPreset(640, 360, 400_000, 24)] },
  '720p': { w: 1280, h: 720, bitrate: 1_500_000, layers: [new VideoPreset(640, 360, 400_000, 24)] },
};

const store = () => useScreen.getState();

/** O'zimiz ulashayotgan treklar (qayta ulanishda yana yuboriladi) */
let local: { video: LocalVideoTrack; audio: LocalAudioTrack | null; stopTest?: () => void } | null = null;

/** Tomoshabin tomonidagi kino ovozi */
let movie: { el: HTMLAudioElement; src: MediaStreamAudioSourceNode; gain: GainNode } | null = null;
/** Hozir ekranda ko'rsatilayotgan presenter treki (sid) */
let remoteVideoSid: string | null = null;
let remoteVideoPub: RemoteTrackPublication | null = null;

const isPresenter = (identity: string) => useRoom.getState().room?.presenterId === identity;

// ------------------------------------------------------------------ ulashuvchi

async function publishLocal(r: Room) {
  if (!local) return;
  const q = ENCODING[store().quality];
  const lp = r.localParticipant;
  if (!lp.getTrackPublication(Track.Source.ScreenShare)) {
    await lp.publishTrack(local.video, {
      source: Track.Source.ScreenShare,
      simulcast: true,
      screenShareEncoding: { maxBitrate: q.bitrate, maxFramerate: 30 },
      screenShareSimulcastLayers: q.layers,
      // Kino: sifat pasaysa ham kadrlar silliq qolsin
      degradationPreference: 'maintain-framerate',
    });
  }
  if (local.audio && !lp.getTrackPublication(Track.Source.ScreenShareAudio)) {
    await lp.publishTrack(local.audio, {
      source: Track.Source.ScreenShareAudio,
      audioPreset: AudioPresets.musicHighQualityStereo,
      forceStereo: true,
      dtx: false,
      red: false,
    });
  }
}

async function goLive(video: LocalVideoTrack, audio: LocalAudioTrack | null, stopTest?: () => void) {
  local = { video, audio, stopTest };
  video.mediaStreamTrack.contentHint = 'motion';
  // Brauzerning "Ulashishni to'xtatish" tugmasi
  video.mediaStreamTrack.addEventListener('ended', () => void stopShare());
  store().set({ video: video.mediaStreamTrack });
  requireRoom(true);
  try {
    const r = await whenRoomReady();
    await publishLocal(r);
    if (!local) return; // kutish paytida to'xtatildi
    send({ t: 'share', on: true });
    store().set({ share: 'live' });
    tipHeadphones();
  } catch (e) {
    console.warn('[screen] ulashish:', e);
    useRoom.getState().toast(e instanceof Error ? e.message : "Ekranni ulashib bo'lmadi");
    await stopShare();
  }
}

/**
 * Ekranni ulashishni boshlash. Foydalanuvchi bosishi ichida chaqirilishi shart
 * (brauzer ekran tanlash oynasini faqat shunda ochadi).
 */
export async function startShare() {
  if (local || store().share !== 'idle') return;
  const s = useRoom.getState();
  if (!s.room || s.room.presenterId !== s.selfId) return;
  const q = ENCODING[store().quality];
  store().set({ share: 'starting' });
  let tracks: LocalTrack[];
  try {
    tracks = await createLocalScreenTracks({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 },
      resolution: { width: q.w, height: q.h, frameRate: 30 },
      contentHint: 'motion',
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
  } catch (e) {
    store().set({ share: 'idle' });
    const name = (e as { name?: string })?.name;
    // Foydalanuvchi oynani yopdi - xabar shart emas
    if (name !== 'NotAllowedError' && name !== 'AbortError') useRoom.getState().toast("Ekranni ulashib bo'lmadi");
    return;
  }
  const video = tracks.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
  const audio = (tracks.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined) ?? null;
  if (!video) {
    tracks.forEach((t) => t.stop());
    store().set({ share: 'idle' });
    return;
  }
  if (!audio) useRoom.getState().toast("Ovozsiz ulashilmoqda (ovoz uchun tab yoki butun ekranni tanlab, \"ovozni ulashish\"ni belgilang)");
  await goLive(video, audio);
}

/** Ulashishni to'xtatish (tugma, brauzer paneli yoki xonadan chiqish). */
export async function stopShare() {
  const l = local;
  local = null;
  if (l) {
    const r = currentRoom();
    if (r) {
      await r.localParticipant.unpublishTrack(l.video, true).catch(() => {});
      if (l.audio) await r.localParticipant.unpublishTrack(l.audio, true).catch(() => {});
    }
    l.video.stop();
    l.audio?.stop();
    l.stopTest?.();
    if (useRoom.getState().room?.sharingId === useRoom.getState().selfId) send({ t: 'share', on: false });
  }
  if (store().share !== 'idle' || l) store().set({ share: 'idle', video: remoteVideoTrack() });
  requireRoom(false);
}

let tipShown = false;
function tipHeadphones() {
  if (tipShown) return;
  tipShown = true;
  useRoom.getState().toast("Maslahat: quloqchin ishlating - mikrofon kino ovozini qayta yubormaydi");
}

// ------------------------------------------------------------------ tomoshabin

function remoteVideoTrack() {
  return remoteVideoPub?.track?.mediaStreamTrack ?? null;
}

function applyVideoQuality() {
  // Kuchsiz kompyuter (past grafika) - o'rta qatlam yetarli
  remoteVideoPub?.setVideoQuality(useGame.getState().quality === 'low' ? VideoQuality.MEDIUM : VideoQuality.HIGH);
}

function playMovieAudio(track: RemoteTrack) {
  stopMovieAudio();
  const ctx = audioContext();
  if (!ctx) return;
  const stream = new MediaStream([track.mediaStreamTrack]);
  // Chrome'da WebRTC oqimi faqat media elementga ulanganda Web Audio'ga oqadi
  const el = new Audio();
  el.muted = true;
  el.srcObject = stream;
  void el.play().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const gain = ctx.createGain();
  gain.gain.value = store().movieVolume;
  // Toza stereo: fazoviy emas, to'g'ridan-to'g'ri chiqishga
  src.connect(gain).connect(ctx.destination);
  movie = { el, src, gain };
}

function stopMovieAudio() {
  if (!movie) return;
  movie.src.disconnect();
  movie.gain.disconnect();
  movie.el.pause();
  movie.el.srcObject = null;
  movie = null;
}

function clearRemote() {
  remoteVideoSid = null;
  remoteVideoPub = null;
  stopMovieAudio();
  if (!local) store().set({ video: null });
}

setRoomHooks({
  connected(r) {
    if (local) void publishLocal(r).catch((e) => console.warn('[screen] qayta yuborish:', e));
  },
  disconnected() {
    clearRemote();
  },
  subscribed(track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
    // Faqat ruxsati bor odamning ekrani ko'rsatiladi
    if (!isPresenter(p.identity)) return;
    if (pub.source === Track.Source.ScreenShare) {
      remoteVideoSid = pub.trackSid;
      remoteVideoPub = pub;
      applyVideoQuality();
      if (!local) store().set({ video: track.mediaStreamTrack });
    } else if (pub.source === Track.Source.ScreenShareAudio) {
      playMovieAudio(track);
    }
  },
  unsubscribed(_track: RemoteTrack, pub: RemoteTrackPublication) {
    if (pub.source === Track.Source.ScreenShare && pub.trackSid === remoteVideoSid) {
      remoteVideoSid = null;
      remoteVideoPub = null;
      if (!local) store().set({ video: null, fullscreen: false });
    } else if (pub.source === Track.Source.ScreenShareAudio) {
      stopMovieAudio();
    }
  },
});

useScreen.subscribe((s, prev) => {
  if (movie && s.movieVolume !== prev.movieVolume) movie.gain.gain.value = s.movieVolume;
});
useGame.subscribe((s, prev) => {
  if (s.quality !== prev.quality) applyVideoQuality();
});
// Xonadan chiqilganda yoki egasi o'zgarganda (ruxsat yo'qoldi) ulashish to'xtaydi
useRoom.subscribe((s, prev) => {
  if (local && (s.status !== 'connected' || (s.room && s.room.presenterId !== s.selfId))) void stopShare();
  if (s.status !== 'connected' && prev.status === 'connected') clearRemote();
});

// ------------------------------------------------------------------ sinov

/** Sinov uchun: haqiqiy ekran o'rniga harakatlanuvchi rangli tasvir va stereo ohang (chap 330 Hz, o'ng 550 Hz). */
export async function startTestShare() {
  const s = useRoom.getState();
  if (local || !s.room || s.room.presenterId !== s.selfId) return false;
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d')!;
  let frame = 0;
  const timer = setInterval(() => {
    frame++;
    const hue = (frame * 2) % 360;
    g.fillStyle = `hsl(${hue}, 70%, 45%)`;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = `hsl(${(hue + 180) % 360}, 80%, 60%)`;
    const x = (Math.sin(frame / 20) * 0.4 + 0.5) * c.width;
    g.beginPath();
    g.arc(x, c.height / 2, 120, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '600 64px sans-serif';
    g.fillText(`SINOV ${frame}`, 60, 110);
  }, 1000 / 30);
  const ctx = audioContext()!;
  const merger = ctx.createChannelMerger(2);
  const oscs = [330, 550].map((f, ch) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const gn = ctx.createGain();
    gn.gain.value = 0.2;
    o.connect(gn).connect(merger, 0, ch);
    o.start();
    return o;
  });
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  merger.connect(dest);
  const stopTest = () => {
    clearInterval(timer);
    oscs.forEach((o) => o.stop());
    merger.disconnect();
  };
  store().set({ share: 'starting' });
  const video = new LocalVideoTrack(c.captureStream(30).getVideoTracks()[0], undefined, true);
  const audio = new LocalAudioTrack(dest.stream.getAudioTracks()[0], undefined, true);
  await goLive(video, audio, stopTest);
  return true;
}

let movieMeter: { node: GainNode; l: AnalyserNode; r: AnalyserNode; buf: Float32Array<ArrayBuffer> } | null = null;

/** Sinov uchun: kino ovozining chap/o'ng kanal darajasi (stereo saqlanganini tekshirish). */
function movieStereo() {
  if (!movie) return null;
  if (movieMeter?.node !== movie.gain) {
    const ctx = movie.gain.context;
    const split = ctx.createChannelSplitter(2);
    const l = ctx.createAnalyser(), r = ctx.createAnalyser();
    l.fftSize = r.fftSize = 2048;
    movie.gain.connect(split);
    split.connect(l, 0);
    split.connect(r, 1);
    movieMeter = { node: movie.gain, l, r, buf: new Float32Array(2048) };
  }
  const m = movieMeter;
  // Kanal bo'yicha asosiy chastotani taxminan aniqlash: nol kesishmalar soni
  const measure = (a: AnalyserNode) => {
    a.getFloatTimeDomainData(m.buf);
    let sum = 0, zc = 0;
    for (let i = 0; i < m.buf.length; i++) {
      sum += m.buf[i] * m.buf[i];
      if (i && m.buf[i - 1] < 0 && m.buf[i] >= 0) zc++;
    }
    return { rms: +Math.sqrt(sum / m.buf.length).toFixed(4), hz: Math.round((zc * ctx.sampleRate) / m.buf.length) };
  };
  const ctx = movie.gain.context;
  return { l: measure(m.l), r: measure(m.r) };
}

export function screenDebug() {
  const r = currentRoom();
  return {
    movieStereo: movieStereo(),
    share: store().share,
    video: store().video ? { state: store().video!.readyState, ...store().video!.getSettings() } : null,
    remoteSid: remoteVideoSid,
    movieAudio: !!movie,
    published: r ? r.localParticipant.getTrackPublications().map((p) => p.source) : [],
  };
}
