import { useEffect, useRef, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { AVATARS, MAPS, isValidRoomCode, MAX_PLAYERS } from '@shared/protocol.ts';
import { useActiveMap } from '../scene/mapContext';
import { useAmbient } from '../audio/ambient';
import { useGame, type Quality } from '../state/store';
import { input } from '../player/input';
import { POSE_MENU } from '../player/poses';
import { useRoom } from '../net/roomStore';
import { connect, disconnect, setLightsHostOnly } from '../net/net';
import { useVoice } from '../voice/voiceStore';
import { micLevel, setInputDevice, setMicOn, toggleMic } from '../voice/voice';
import { useScreen, type ShareQuality } from '../screen/screenStore';
import { startShare, stopShare } from '../screen/screenShare';

const QUALITY_LABEL: Record<Quality, string> = { low: 'Past', medium: "O'rta", high: 'Yuqori' };

/** Pointer lock so'raydi; brauzer rad etsa, "bosib turib qarash" rejimiga o'tadi. */
function lockPointer() {
  const canvas = document.querySelector('canvas');
  const fallback = () => {
    if (document.pointerLockElement) return;
    input.dragLook = true;
    useGame.getState().setPhase('playing');
  };
  try {
    const r = canvas?.requestPointerLock() as unknown as Promise<void> | undefined;
    if (r?.then) r.then(() => (input.dragLook = false), fallback);
    else setTimeout(fallback, 300);
  } catch {
    fallback();
  }
}

input.onEscape = () => useGame.getState().setPhase('paused');

function QualityPicker() {
  const quality = useGame((s) => s.quality);
  const setQuality = useGame((s) => s.setQuality);
  return (
    <div className="quality">
      <span>Grafika</span>
      <div className="segmented">
        {(['low', 'medium', 'high'] as Quality[]).map((q) => (
          <button key={q} className={q === quality ? 'active' : ''} onClick={() => setQuality(q)}>
            {QUALITY_LABEL[q]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Controls() {
  return (
    <ul className="controls">
      <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> yurish · <kbd>Shift</kbd> tez</li>
      <li><kbd>E</kbd> o'rindiqqa o'tirish / turish, chiroq tugmasi</li>
      <li><kbd>F</kbd> qo'l fonari · <kbd>M</kbd> mikrofon · <kbd>V</kbd> to'liq ekran</li>
      <li><kbd>C</kbd> bosib turing — yaqinlashtirish (zoom)</li>
      <li><kbd>Q</kbd> bosib turing — harakatlar (yoki <kbd>1</kbd>–<kbd>9</kbd>)</li>
      <li><kbd>Esc</kbd> menyu</li>
    </ul>
  );
}

function Loading() {
  const { progress } = useProgress();
  const ready = useGame((s) => s.sceneReady);
  const map = useActiveMap();
  if (ready) return null;
  const compiling = progress >= 100;
  return (
    <div className="loading">
      <div className="loading-title">{MAPS.find((m) => m.id === map)?.label} tayyorlanmoqda</div>
      <div className="bar">
        <div className={compiling ? 'indeterminate' : ''} style={{ width: compiling ? '35%' : `${progress}%` }} />
      </div>
      <div className="loading-pct">{compiling ? 'Grafika tayyorlanmoqda…' : `${Math.round(progress)}%`}</div>
    </div>
  );
}

function AvatarPicker() {
  const avatar = useGame((s) => s.avatar);
  const setAvatar = useGame((s) => s.setAvatar);
  return (
    <div className="avatars">
      {AVATARS.map((a) => (
        <button key={a.id} className={`avatar ${a.id === avatar ? 'active' : ''}`} onClick={() => setAvatar(a.id)} title={a.label}>
          <img src={`/avatars/${a.id}/thumb.jpg`} alt={a.label} draggable={false} />
        </button>
      ))}
    </div>
  );
}

function MapPicker() {
  const map = useGame((s) => s.map);
  const setMap = useGame((s) => s.setMap);
  return (
    <div className="maps">
      {MAPS.map((m) => (
        <button key={m.id} className={`map-card ${m.id === map ? 'active' : ''}`} onClick={() => setMap(m.id)}>
          <span className={`map-thumb map-${m.id}`} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

function Lobby() {
  const nickname = useGame((s) => s.nickname);
  const setNickname = useGame((s) => s.setNickname);
  const status = useRoom((s) => s.status);
  const error = useRoom((s) => s.error);
  const [code, setCode] = useState(() => new URL(location.href).searchParams.get('room')?.toUpperCase() ?? '');
  const busy = status === 'connecting';
  const validCode = isValidRoomCode(code);

  const go = (mode: 'create' | 'join' | 'offline') => {
    if (busy) return;
    const { nickname, avatar, map } = useGame.getState();
    // Pointer lock foydalanuvchi bosishi ichida so'ralishi shart - ulanishni kutmasdan
    lockPointer();
    if (mode === 'offline') {
      disconnect();
      useRoom.getState().set({ status: 'offline', error: null, room: null, selfId: null, players: {} });
      return;
    }
    connect(mode === 'create' ? { create: map } : { room: code }, nickname, avatar).catch(() => {
      document.exitPointerLock?.();
      useGame.getState().setPhase('menu');
    });
  };

  return (
    <div className="screen-overlay">
      <div className="panel wide">
        <div className="brand">
          <div className="brand-mark">▶</div>
          <div>
            <h1>Kino Zal</h1>
            <p>Do'stlar bilan birga tomosha qiling</p>
          </div>
        </div>
        <label className="field">
          <span>Nickname</span>
          <input
            value={nickname}
            maxLength={20}
            placeholder="Ismingiz"
            onChange={(e) => setNickname(e.target.value)}
          />
        </label>
        <div className="field">
          <span>Personaj</span>
          <AvatarPicker />
        </div>
        <div className="field">
          <span>Xarita (yangi xona uchun)</span>
          <MapPicker />
        </div>
        <div className="join-row">
          <input
            className="code"
            value={code}
            maxLength={6}
            placeholder="XONA KODI"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && validCode && go('join')}
          />
          <button className="primary" disabled={!validCode || busy} onClick={() => go('join')}>
            Qo'shilish
          </button>
        </div>
        <button className={validCode ? 'secondary' : 'primary'} disabled={busy} onClick={() => go('create')}>
          {busy ? 'Ulanmoqda…' : 'Yangi xona yaratish'}
        </button>
        {error && <div className="error">{error}</div>}
        <button className="link" onClick={() => go('offline')}>
          Serversiz, yolg'iz kirish
        </button>
        <QualityPicker />
        <Controls />
      </div>
    </div>
  );
}

function RoomPanel() {
  const room = useRoom((s) => s.room);
  const selfId = useRoom((s) => s.selfId);
  const players = useRoom((s) => s.players);
  const [copied, setCopied] = useState(false);
  if (!room) return null;
  const isHost = room.hostId === selfId;
  const link = `${location.origin}/?room=${room.id}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard ruxsati yo'q */
    }
  };
  const list = Object.values(players);
  return (
    <div className="room-panel">
      <div className="room-code">
        <div>
          <span>Xona kodi</span>
          <strong>{room.id}</strong>
        </div>
        <button className="secondary small" onClick={copy}>
          {copied ? 'Nusxalandi ✓' : 'Havolani nusxalash'}
        </button>
      </div>
      <div className="players">
        <span>
          {MAPS.find((m) => m.id === room.mapId)?.label} · {list.length} / {MAX_PLAYERS}
        </span>
        {list.map((p) => (
          <div key={p.id} className="player-row">
            <img src={`/avatars/${p.avatar}/thumb.jpg`} alt="" />
            <span className="name">
              {p.nickname}
              {p.id === selfId && <em> (siz)</em>}
            </span>
            {p.id === room.hostId && <span className="badge">egasi</span>}
            {p.seat && <span className="seat">{p.seat}</span>}
          </div>
        ))}
      </div>
      {isHost && (
        <label className="toggle">
          <input type="checkbox" checked={room.lightsHostOnly} onChange={(e) => setLightsHostOnly(e.target.checked)} />
          <span>Zal chirog'ini faqat men boshqaraman</span>
        </label>
      )}
    </div>
  );
}

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
      {off && <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
    </svg>
  );
}

/** Mikrofon holati va ovoz darajasi (pastki chap burchak). */
function MicHud() {
  const voiceOn = useRoom((s) => s.voice && s.status === 'connected');
  const micOn = useVoice((s) => s.micOn);
  const micError = useVoice((s) => s.micError);
  const status = useVoice((s) => s.status);
  const speaking = useVoice((s) => s.selfSpeaking);
  const meter = useRef<HTMLElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      if (meter.current) meter.current.style.transform = `scaleX(${micLevel().toFixed(3)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!voiceOn) return null;
  const note = micError
    ? `${micError} · M — qayta urinish`
    : status === 'connecting'
      ? 'Ovozga ulanmoqda…'
      : status === 'reconnecting'
        ? 'Ovoz qayta ulanmoqda…'
        : status === 'error'
          ? "Ovoz serveriga ulanib bo'lmadi"
          : !micOn
            ? "Mikrofon o'chiq"
            : null;
  const cls = micError ? 'error' : !micOn ? 'off' : speaking ? 'speaking' : '';
  return (
    <div className={`mic-hud ${cls}`}>
      <MicIcon off={!micOn || !!micError} />
      {micOn && !micError && (
        <span className="mic-meter">
          <i ref={meter} />
        </span>
      )}
      {note && <span className="mic-note">{note}</span>}
      <kbd>M</kbd>
    </div>
  );
}

function VolumeSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <input
      type="range"
      min={0}
      max={150}
      step={5}
      value={Math.round(value * 100)}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
    />
  );
}

/** Pauza menyusidagi ovoz sozlamalari. */
function VoicePanel() {
  const voiceOn = useRoom((s) => s.voice && s.status === 'connected');
  const selfId = useRoom((s) => s.selfId);
  const players = useRoom((s) => s.players);
  const v = useVoice();
  if (!voiceOn) return null;
  const others = Object.values(players).filter((p) => p.id !== selfId);
  const live = v.micOn && !v.micError;
  return (
    <div className="room-panel voice-panel">
      <div className="voice-row">
        <span className="voice-title">Ovoz</span>
        <button className={`secondary small ${live ? '' : 'danger'}`} onClick={() => void setMicOn(!v.micOn)}>
          <MicIcon off={!live} /> {live ? 'Mikrofon yoqiq' : "Mikrofon o'chiq"}
        </button>
      </div>
      {v.micError && <div className="error">{v.micError}</div>}
      {v.inputs.length > 1 && (
        <label className="voice-row">
          <span>Mikrofon</span>
          <select value={v.inputId} onChange={(e) => void setInputDevice(e.target.value)}>
            {v.inputs.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="voice-row">
        <span>Umumiy balandlik</span>
        <VolumeSlider value={v.master} onChange={v.setMaster} label="Umumiy ovoz balandligi" />
        <span className="voice-pct">{Math.round(v.master * 100)}%</span>
      </label>
      {others.length > 0 && (
        <div className="players">
          <span>Har bir kishi</span>
          {others.map((p) => {
            const vol = v.volumes[p.nickname] ?? 1;
            const peer = v.peers[p.id];
            return (
              <div key={p.id} className="player-row">
                <img src={`/avatars/${p.avatar}/thumb.jpg`} alt="" />
                <span className={`name ${peer?.speaking ? 'speaking' : ''}`}>{p.nickname}</span>
                {!peer && <span className="seat">ovozsiz</span>}
                <VolumeSlider value={vol} onChange={(x) => v.setVolume(p.nickname, x)} label={`${p.nickname} ovozi`} />
                <button
                  className={`icon-btn ${vol === 0 ? 'danger' : ''}`}
                  title={vol === 0 ? 'Ovozini yoqish' : "Ovozini o'chirish"}
                  onClick={() => v.setVolume(p.nickname, vol === 0 ? 1 : 0)}
                >
                  {vol === 0 ? '🔇' : '🔊'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Atrof ovozlari (gulxan, tabiat) - faqat o'rmon xaritasida. */
function AmbientPanel() {
  const map = useActiveMap();
  const volume = useAmbient((s) => s.volume);
  const setVolume = useAmbient((s) => s.setVolume);
  if (map !== 'forest') return null;
  return (
    <div className="room-panel voice-panel">
      <label className="voice-row">
        <span>Atrof ovozlari</span>
        <VolumeSlider value={volume} onChange={setVolume} label="Atrof ovozlari (gulxan, tabiat)" />
        <span className="voice-pct">{Math.round(volume * 100)}%</span>
      </label>
    </div>
  );
}

/** Pauza menyusidagi ekran ulashish bo'limi. */
function ScreenPanel() {
  const room = useRoom((s) => s.room);
  const selfId = useRoom((s) => s.selfId);
  const voice = useRoom((s) => s.voice && s.status === 'connected');
  const players = useRoom((s) => s.players);
  const share = useScreen((s) => s.share);
  const quality = useScreen((s) => s.quality);
  const setQuality = useScreen((s) => s.setQuality);
  const movieVolume = useScreen((s) => s.movieVolume);
  const setMovieVolume = useScreen((s) => s.setMovieVolume);
  const video = useScreen((s) => s.video);
  if (!room) return null;
  const presenter = room.presenterId === selfId;
  const sharer = room.sharingId && room.sharingId !== selfId ? players[room.sharingId]?.nickname : null;
  return (
    <div className="room-panel voice-panel">
      <div className="voice-row">
        <span className="voice-title">Ekran</span>
        {video && (
          <button className="secondary small" onClick={() => toggleFullscreen()}>
            To'liq ekran <kbd>V</kbd>
          </button>
        )}
      </div>
      {!voice ? (
        <div className="voice-row">Ekran ulashish uchun ovoz serveri kerak</div>
      ) : presenter ? (
        share === 'idle' ? (
          <>
            <div className="voice-row">
              <span>Sifat</span>
              <div className="segmented">
                {(['1080p', '720p'] as ShareQuality[]).map((q) => (
                  <button key={q} className={q === quality ? 'active' : ''} onClick={() => setQuality(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <button className="primary" onClick={() => void startShare()}>
              Ekranni ulashish
            </button>
            <div className="voice-hint">
              Kino uchun brauzer tabini yoki butun ekranni tanlang va "ovozni ham ulashish"ni belgilang.
              {quality === '1080p' ? ' 1080p ~1.4 GB/soat har bir tomoshabinga.' : ' 720p ~0.7 GB/soat har bir tomoshabinga.'}
            </div>
          </>
        ) : (
          <div className="voice-row">
            <span className="live-dot">{share === 'live' ? 'Ekraningiz efirda' : 'Ulanmoqda…'}</span>
            <button className="secondary small danger" onClick={() => void stopShare()}>
              To'xtatish
            </button>
          </div>
        )
      ) : (
        <div className="voice-row">
          {sharer ? `${sharer} ekranini ulashmoqda` : 'Ekranni xona egasi ulashadi'}
        </div>
      )}
      {sharer && (
        <label className="voice-row">
          <span>Kino ovozi</span>
          <VolumeSlider value={movieVolume} onChange={setMovieVolume} label="Kino ovozi" />
          <span className="voice-pct">{Math.round(movieVolume * 100)}%</span>
        </label>
      )}
    </div>
  );
}

/** V: zal ekranidagi videoni butun monitorda 2D ko'rish (yana V - zalga qaytish). */
function toggleFullscreen(on = !useScreen.getState().fullscreen, resume = true) {
  const { video, set } = useScreen.getState();
  if (on && !video) {
    useRoom.getState().toast('Hozir ekran ulashilmayapti');
    return;
  }
  set({ fullscreen: on });
  if (on) {
    document.exitPointerLock?.();
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    // Pointer lock faqat foydalanuvchi tugma bosganda so'raladi
    if (resume) lockPointer();
  }
}

function FullscreenVideo() {
  const video = useScreen((s) => s.video);
  const micOn = useVoice((s) => s.micOn);
  const voiceOn = useRoom((s) => s.voice && s.status === 'connected');
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !video) return;
    el.srcObject = new MediaStream([video]);
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [video]);

  // Video tugasa yoki brauzer to'liq ekrandan chiqsa (Esc) - zalga qaytish
  useEffect(() => {
    if (!video) toggleFullscreen(false, false);
  }, [video]);

  return (
    <div className="fs-video">
      <video ref={ref} muted playsInline autoPlay />
      <div className="fs-hint">
        <kbd>V</kbd> zalga qaytish
        {voiceOn && (
          <>
            {' · '}
            <kbd>M</kbd> {micOn ? 'mikrofon yoqiq' : "mikrofon o'chiq"}
          </>
        )}
      </div>
    </div>
  );
}

function PoseWheel() {
  const open = useGame((s) => s.wheelOpen);
  const sel = useGame((s) => s.wheelSel);
  if (!open) return null;
  const n = POSE_MENU.length;
  return (
    <div className="wheel">
      {POSE_MENU.map((p, i) => {
        const a = (i / n) * Math.PI * 2;
        return (
          <div
            key={p.pose}
            className={`wheel-item ${i === sel ? 'active' : ''}`}
            style={{ transform: `translate(${Math.sin(a) * 150}px, ${-Math.cos(a) * 150}px)` }}
          >
            <span className="icon">{p.icon}</span>
            <span className="label">{p.label}</span>
            <kbd>{p.key}</kbd>
          </div>
        );
      })}
      <div className="wheel-center">{sel >= 0 ? POSE_MENU[sel].label : 'Harakat tanlang'}</div>
    </div>
  );
}

function Toasts() {
  const toasts = useRoom((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Hud() {
  const prompt = useGame((s) => s.prompt);
  const seat = useGame((s) => s.seat);
  const pose = useGame((s) => s.pose);
  const flashlight = useGame((s) => s.flashlight);
  const room = useRoom((s) => s.room);
  const count = useRoom((s) => Object.keys(s.players).length);
  const share = useScreen((s) => s.share);
  const hasVideo = useScreen((s) => !!s.video);
  const hint = seat
    ? `${seat}-o'rindiq · E — turish`
    : pose
      ? `${POSE_MENU.find((p) => p.pose === pose)?.label} · yurish yoki 0 — to'xtatish`
      : null;
  return (
    <div className="hud">
      <div className={`crosshair ${prompt ? 'target' : ''}`} />
      {prompt && (
        <div className="prompt">
          <kbd>E</kbd> {prompt}
        </div>
      )}
      {room && (
        <div className="hud-room">
          <strong>{room.id}</strong> · {count} kishi
        </div>
      )}
      {share === 'live' && <div className="hud-live">Ekraningiz efirda</div>}
      <div className="hud-bottom">
        {hint && <div className="hint">{hint}</div>}
        {flashlight && <div className="hint">🔦 Fonar yoniq · F</div>}
        {hasVideo && !seat && !pose && (
          <div className="hint">
            <kbd>V</kbd> to'liq ekran
          </div>
        )}
      </div>
      <MicHud />
      <PoseWheel />
    </div>
  );
}

export function Overlay() {
  const phase = useGame((s) => s.phase);
  const setPhase = useGame((s) => s.setPhase);
  const status = useRoom((s) => s.status);
  const fullscreen = useScreen((s) => s.fullscreen);

  // V (to'liq ekran) va to'liq ekranda M - o'yin rejimidan tashqarida ham ishlaydi
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
      const inRoom = useGame.getState().phase !== 'menu' && ['connected', 'offline'].includes(useRoom.getState().status);
      if (!inRoom) return;
      if (e.code === 'KeyV') toggleFullscreen();
      else if (e.code === 'KeyM' && useScreen.getState().fullscreen) void toggleMic();
    };
    const fsChange = () => {
      if (!document.fullscreenElement && useScreen.getState().fullscreen) useScreen.getState().set({ fullscreen: false });
    };
    window.addEventListener('keydown', down);
    document.addEventListener('fullscreenchange', fsChange);
    return () => {
      window.removeEventListener('keydown', down);
      document.removeEventListener('fullscreenchange', fsChange);
    };
  }, []);

  useEffect(() => {
    const onChange = () => {
      const locked = !!document.pointerLockElement;
      const { phase } = useGame.getState();
      if (locked) {
        input.dragLook = false;
        setPhase('playing');
      } else if (phase === 'playing' && !input.dragLook) setPhase('paused');
    };
    document.addEventListener('pointerlockchange', onChange);
    return () => document.removeEventListener('pointerlockchange', onChange);
  }, [setPhase]);

  // Lobbidan faqat ulangandan (yoki oflayn) keyin o'yinga o'tiladi
  const inLobby = phase === 'menu' || (status !== 'connected' && status !== 'offline');

  return (
    <>
      <Loading />
      {!inLobby && fullscreen && <FullscreenVideo />}
      {!inLobby && !fullscreen && phase === 'playing' && <Hud />}
      {inLobby && <Lobby />}
      {!inLobby && !fullscreen && phase === 'paused' && (
        <div className="screen-overlay dim">
          <div className="panel wide">
            <h2>Pauza</h2>
            <button className="primary" onClick={lockPointer}>
              Davom etish
            </button>
            <RoomPanel />
            <ScreenPanel />
            <VoicePanel />
            <AmbientPanel />
            <QualityPicker />
            <Controls />
            <button
              className="link"
              onClick={() => {
                disconnect();
                location.href = location.pathname;
              }}
            >
              Xonadan chiqish
            </button>
          </div>
        </div>
      )}
      <Toasts />
    </>
  );
}
