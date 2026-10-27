import {
  PROTOCOL_VERSION, STATE_RATE,
  type AvatarId, type MapId, type ClientMessage, type PlayerInfo, type PlayerState, type Pose, type ServerMessage,
} from '@shared/protocol.ts';
import { useRoom, type PlayerMeta } from './roomStore';
import { pushSnapshot, dropPlayer } from './interp';
import { useGame } from '../state/store';

/** Mahalliy soat bilan server soati orasidagi farq (serverTime = Date.now() + offset) */
let clockOffset = 0;
let ws: WebSocket | null = null;
let lastStateSent = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
/** Javob kutayotgan ovoz tokeni so'rovlari */
const voiceWaiters: { resolve: (v: { url: string; token: string }) => void; reject: (e: Error) => void }[] = [];

export function serverNow() {
  return Date.now() + clockOffset;
}

function wsUrl() {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function toMeta(p: PlayerInfo): PlayerMeta {
  return { id: p.id, nickname: p.nickname, avatar: p.avatar, seat: p.seat, pose: p.pose, poseAt: p.poseAt - clockOffset };
}

function nameOf(id: string) {
  return useRoom.getState().players[id]?.nickname ?? 'Kimdir';
}

function onMessage(msg: ServerMessage) {
  const room = useRoom.getState();
  switch (msg.t) {
    case 'welcome': {
      clockOffset = msg.serverTime - Date.now();
      const players: Record<string, PlayerMeta> = {};
      for (const p of msg.players) {
        players[p.id] = toMeta(p);
        if (p.id !== msg.selfId) pushSnapshot(p.id, msg.serverTime, p.state);
      }
      room.set({ status: 'connected', error: null, room: msg.room, selfId: msg.selfId, players, voice: msg.voice });
      useGame.getState().setLightsOn(msg.room.lightsOn);
      const url = new URL(location.href);
      url.searchParams.set('room', msg.room.id);
      history.replaceState(null, '', url);
      break;
    }
    case 'joined':
      room.upsertPlayer(toMeta(msg.player));
      pushSnapshot(msg.player.id, serverNow(), msg.player.state);
      room.toast(`${msg.player.nickname} zalga kirdi`);
      break;
    case 'left':
      room.toast(`${nameOf(msg.id)} chiqib ketdi`);
      room.removePlayer(msg.id);
      dropPlayer(msg.id);
      break;
    case 'states':
      for (const [id, s] of msg.s) if (id !== room.selfId) pushSnapshot(id, msg.at, s);
      break;
    case 'seat':
      room.patchPlayer(msg.id, { seat: msg.seat, pose: null });
      if (msg.id === room.selfId) useGame.getState().setSeat(msg.seat);
      break;
    case 'pose':
      room.patchPlayer(msg.id, { pose: msg.pose, poseAt: msg.at - clockOffset });
      break;
    case 'lights':
      useGame.getState().setLightsOn(msg.on);
      if (msg.by !== room.selfId) room.toast(`${nameOf(msg.by)} chiroqni ${msg.on ? 'yoqdi' : "o'chirdi"}`);
      break;
    case 'room': {
      const prevHost = room.room?.hostId;
      room.set({ room: msg.room });
      if (prevHost && prevHost !== msg.room.hostId) {
        room.toast(msg.room.hostId === room.selfId ? 'Endi siz xona egasisiz' : `${nameOf(msg.room.hostId)} endi xona egasi`);
      }
      const prevSharing = room.room?.sharingId ?? null;
      if (msg.room.sharingId !== prevSharing) {
        if (msg.room.sharingId && msg.room.sharingId !== room.selfId) {
          room.toast(`${nameOf(msg.room.sharingId)} ekranini ulashdi · V — to'liq ekran`);
        } else if (!msg.room.sharingId && prevSharing !== room.selfId) room.toast('Ekran ulashish tugadi');
      }
      break;
    }
    case 'pong': {
      const rtt = Date.now() - msg.at;
      clockOffset = msg.serverTime + rtt / 2 - Date.now();
      break;
    }
    case 'voiceToken':
      for (const w of voiceWaiters.splice(0)) w.resolve({ url: msg.url, token: msg.token });
      break;
    case 'error':
      if (msg.code === 'voice_unavailable') {
        for (const w of voiceWaiters.splice(0)) w.reject(new Error(msg.message));
        break;
      }
      if (room.status === 'connecting') room.set({ status: 'error', error: msg.message });
      else room.toast(msg.message);
      if (msg.code === 'seat_taken') useGame.getState().setSeat(null);
      break;
  }
}

/** Serverga ulanish: yangi xona yaratish yoki kod bo'yicha qo'shilish. */
export function connect(opts: { create: MapId } | { room: string }, nickname: string, avatar: AvatarId): Promise<void> {
  disconnect();
  useRoom.getState().set({ status: 'connecting', error: null, players: {}, room: null, selfId: null });
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(wsUrl());
    ws = sock;
    const fail = (message: string) => {
      useRoom.getState().set({ status: 'error', error: message });
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      sock.close();
      fail('Serverga ulanib bo\'lmadi');
    }, 6000);
    sock.onopen = () => {
      const hello: ClientMessage =
        'create' in opts
          ? { t: 'create', nickname, avatar, map: opts.create, v: PROTOCOL_VERSION }
          : { t: 'join', room: opts.room, nickname, avatar, v: PROTOCOL_VERSION };
      sock.send(JSON.stringify(hello));
    };
    sock.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMessage;
      onMessage(msg);
      if (msg.t === 'welcome') {
        clearTimeout(timer);
        pingTimer = setInterval(() => send({ t: 'ping', at: Date.now() }), 5000);
        resolve();
      }
      if (msg.t === 'error' && useRoom.getState().status === 'error') {
        clearTimeout(timer);
        reject(new Error(msg.message));
      }
    };
    sock.onerror = () => {
      clearTimeout(timer);
      if (useRoom.getState().status === 'connecting') fail('Serverga ulanib bo\'lmadi');
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      if (pingTimer) clearInterval(pingTimer);
      if (useRoom.getState().status === 'connected') {
        useRoom.getState().set({ status: 'error', error: 'Server bilan aloqa uzildi' });
        useRoom.getState().toast("Server bilan aloqa uzildi");
      }
    };
  });
}

export function disconnect() {
  if (pingTimer) clearInterval(pingTimer);
  for (const w of voiceWaiters.splice(0)) w.reject(new Error('disconnected'));
  if (ws) {
    const s = ws;
    ws = null;
    s.close();
  }
}

export function isOnline() {
  return useRoom.getState().status === 'connected' && ws?.readyState === WebSocket.OPEN;
}

export function send(msg: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Player holatini cheklangan chastotada yuborish (har kadr chaqirilsa ham bo'ladi). */
export function sendState(s: PlayerState) {
  const now = performance.now();
  if (now - lastStateSent < 1000 / STATE_RATE) return;
  lastStateSent = now;
  send({ t: 'state', s });
}

/** Ovoz serveri uchun yangi token (har ulanishda yangisi olinadi). */
export function requestVoiceToken(): Promise<{ url: string; token: string }> {
  if (!isOnline()) return Promise.reject(new Error('offline'));
  return new Promise((resolve, reject) => {
    const w = { resolve, reject };
    voiceWaiters.push(w);
    send({ t: 'voiceToken' });
    setTimeout(() => {
      const i = voiceWaiters.indexOf(w);
      if (i >= 0) {
        voiceWaiters.splice(i, 1);
        reject(new Error('timeout'));
      }
    }, 5000);
  });
}

// --------------------------------------------------------------- harakatlar (online/offline)

export function requestLights(on: boolean) {
  if (isOnline()) send({ t: 'lights', on });
  else useGame.getState().setLightsOn(on);
}

export function requestSit(seat: string) {
  useGame.getState().setSeat(seat); // optimistik; server rad etsa qaytariladi
  if (isOnline()) send({ t: 'sit', seat });
}

export function requestStand() {
  useGame.getState().setSeat(null);
  if (isOnline()) send({ t: 'stand' });
}

export function requestPose(pose: Pose | null) {
  useGame.getState().setPose(pose);
  if (isOnline()) send({ t: 'pose', pose });
}

export function setLightsHostOnly(v: boolean) {
  send({ t: 'settings', lightsHostOnly: v });
}
