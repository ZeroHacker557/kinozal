/**
 * Kino Zal realtime serveri: xonalar, playerlar holati, o'rindiqlar bandligi, zal chiroqlari.
 * Ishga tushirish (Node 24 TypeScript'ni o'zi bajaradi):  node server/src/index.ts
 */
import './env.ts';
import http from 'node:http';
import { readFileSync, createReadStream, statSync, type Stats } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION, MAX_PLAYERS, STATE_RATE, AVATARS, POSES, ROOM_CODE_ALPHABET, MAPS,
  cleanNickname, isValidRoomCode, isMapId,
  type ClientMessage, type ServerMessage, type PlayerInfo, type PlayerState, type RoomInfo, type AvatarId, type Pose, type MapId,
} from '../../shared/src/protocol.ts';
import { setSharePermission, voiceEnabled, voiceToken, voiceUrl } from './voice.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT ?? 2567);
const DIST = join(ROOT, 'client', 'dist');

type Vec3 = [number, number, number];
interface MapLayout {
  seats: Set<string>;
  spawn: { position: Vec3; lookAt: Vec3; radius?: number };
}

// Har bir xaritaning o'rindiqlari va kirish joyi (Blender eksport qilgan layout.json'dan)
const LAYOUTS = Object.fromEntries(
  MAPS.map((m) => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'client', 'public', ...m.layout.split('/')), 'utf8'));
    return [m.id, { seats: new Set<string>(raw.seats.map((s: { id: string }) => s.id)), spawn: raw.spawn }];
  }),
) as Record<MapId, MapLayout>;
const AVATAR_IDS = new Set<string>(AVATARS.map((a) => a.id));

interface Client {
  ws: WebSocket;
  info: PlayerInfo;
  room: Room;
  alive: boolean;
  dirty: boolean;
}

interface Room {
  info: RoomInfo;
  /** LiveKit xonasi nomi (kod qayta ishlatilsa ham eski ovoz xonasi bilan aralashmasin) */
  voiceRoom: string;
  clients: Map<string, Client>;
  /** o'rindiq -> player id */
  seats: Map<string, string>;
  lastActive: number;
}

const rooms = new Map<string, Room>();

function newRoomCode() {
  for (;;) {
    const bytes = randomBytes(6);
    let code = '';
    for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
    if (!rooms.has(code)) return code;
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage, except?: string) {
  const data = JSON.stringify(msg);
  for (const [id, c] of room.clients) {
    if (id !== except && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

function spawnState(map: MapId): PlayerState {
  const { position: [x, y, z], lookAt: [lx, , lz], radius = 0.6 } = LAYOUTS[map].spawn;
  // Kirish joyi atrofida biroz tarqatib joylashtirish
  const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
  const yaw = Math.atan2(-(lx - x), -(lz - z));
  return { p: [x + Math.cos(a) * r, y, z + Math.sin(a) * r], ry: yaw, hy: yaw, hp: 0, g: 0, fl: false };
}

function sanitizeState(s: unknown): PlayerState | null {
  const v = s as PlayerState;
  if (!v || !Array.isArray(v.p) || v.p.length !== 3) return null;
  const nums = [...v.p, v.ry, v.hy, v.hp];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1000)) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return {
    p: [r(v.p[0]), r(v.p[1]), r(v.p[2])],
    ry: r(v.ry), hy: r(v.hy), hp: r(Math.max(-1.6, Math.min(1.6, v.hp))),
    g: v.g === 1 || v.g === 2 ? v.g : 0,
    fl: !!v.fl,
  };
}

function leaveSeat(room: Room, c: Client) {
  if (!c.info.seat) return;
  if (room.seats.get(c.info.seat) === c.info.id) room.seats.delete(c.info.seat);
  c.info.seat = null;
  broadcast(room, { t: 'seat', id: c.info.id, seat: null });
}

function removeClient(c: Client) {
  const room = c.room;
  if (!room.clients.has(c.info.id)) return;
  leaveSeat(room, c);
  room.clients.delete(c.info.id);
  broadcast(room, { t: 'left', id: c.info.id });
  if (room.clients.size === 0) {
    rooms.delete(room.info.id);
    log(`xona yopildi ${room.info.id}`);
    return;
  }
  let changed = false;
  if (room.info.sharingId === c.info.id) {
    room.info.sharingId = null;
    changed = true;
  }
  if (room.info.hostId === c.info.id) {
    // Eng uzoq vaqt turgan player yangi xona egasi (va ekran ulashuvchi) bo'ladi
    const next = [...room.clients.values()].sort((a, b) => a.info.joinedAt - b.info.joinedAt)[0];
    room.info.hostId = next.info.id;
    room.info.presenterId = next.info.id;
    void setSharePermission(room.voiceRoom, next.info.id, true);
    changed = true;
  }
  if (changed) broadcast(room, { t: 'room', room: room.info });
}

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function handleHello(ws: WebSocket, msg: ClientMessage): Client | null {
  if (msg.t !== 'create' && msg.t !== 'join') {
    send(ws, { t: 'error', code: 'bad_request', message: 'Avval xonaga kiring' });
    return null;
  }
  if (msg.v !== PROTOCOL_VERSION) {
    send(ws, { t: 'error', code: 'bad_version', message: "Sahifani yangilang (versiya mos emas)" });
    return null;
  }
  const avatar: AvatarId = AVATAR_IDS.has(msg.avatar) ? msg.avatar : AVATARS[0].id;
  let room: Room | undefined;
  if (msg.t === 'create') {
    const id = newRoomCode();
    room = {
      info: { id, mapId: isMapId(msg.map) ? msg.map : 'hall', hostId: '', lightsOn: true, lightsHostOnly: false, presenterId: '', sharingId: null },
      voiceRoom: `kino-${id}-${randomBytes(3).toString('hex')}`,
      clients: new Map(), seats: new Map(), lastActive: Date.now(),
    };
    rooms.set(id, room);
    log(`xona yaratildi ${id} (${room.info.mapId})`);
  } else {
    const code = String(msg.room).toUpperCase();
    room = isValidRoomCode(code) ? rooms.get(code) : undefined;
    if (!room) {
      send(ws, { t: 'error', code: 'room_not_found', message: 'Bunday xona topilmadi' });
      return null;
    }
    if (room.clients.size >= MAX_PLAYERS) {
      send(ws, { t: 'error', code: 'room_full', message: `Xona to'la (${MAX_PLAYERS} kishi)` });
      return null;
    }
  }
  const info: PlayerInfo = {
    id: randomUUID().slice(0, 8),
    nickname: cleanNickname(String(msg.nickname ?? '')),
    avatar,
    seat: null,
    pose: null,
    poseAt: 0,
    joinedAt: Date.now(),
    state: spawnState(room.info.mapId),
  };
  const client: Client = { ws, info, room, alive: true, dirty: true };
  if (!room.info.hostId) room.info.hostId = room.info.presenterId = info.id;
  room.clients.set(info.id, client);
  send(ws, {
    t: 'welcome', selfId: info.id, room: room.info, serverTime: Date.now(), voice: voiceEnabled,
    players: [...room.clients.values()].map((c) => c.info),
  });
  broadcast(room, { t: 'joined', player: info }, info.id);
  log(`${info.nickname} (${info.id}) -> ${room.info.id} [${room.clients.size}]`);
  return client;
}

function handle(c: Client, msg: ClientMessage) {
  const room = c.room;
  room.lastActive = Date.now();
  switch (msg.t) {
    case 'state': {
      const s = sanitizeState(msg.s);
      if (s) {
        c.info.state = s;
        c.dirty = true;
      }
      break;
    }
    case 'sit': {
      const seat = String(msg.seat);
      if (!LAYOUTS[room.info.mapId].seats.has(seat)) return send(c.ws, { t: 'error', code: 'bad_request', message: "Noto'g'ri o'rindiq" });
      const owner = room.seats.get(seat);
      if (owner && owner !== c.info.id) return send(c.ws, { t: 'error', code: 'seat_taken', message: 'Bu joy band' });
      leaveSeat(room, c);
      room.seats.set(seat, c.info.id);
      c.info.seat = seat;
      c.info.pose = null;
      broadcast(room, { t: 'seat', id: c.info.id, seat });
      break;
    }
    case 'stand':
      leaveSeat(room, c);
      break;
    case 'pose': {
      const pose = msg.pose && (POSES as readonly string[]).includes(msg.pose) ? (msg.pose as Pose) : null;
      c.info.pose = pose;
      c.info.poseAt = Date.now();
      broadcast(room, { t: 'pose', id: c.info.id, pose, at: c.info.poseAt });
      break;
    }
    case 'lights': {
      if (room.info.lightsHostOnly && room.info.hostId !== c.info.id) {
        return send(c.ws, { t: 'error', code: 'not_allowed', message: 'Chiroqni faqat xona egasi boshqaradi' });
      }
      room.info.lightsOn = !!msg.on;
      broadcast(room, { t: 'lights', on: room.info.lightsOn, by: c.info.id });
      break;
    }
    case 'settings': {
      if (room.info.hostId !== c.info.id) return send(c.ws, { t: 'error', code: 'not_allowed', message: 'Faqat xona egasi' });
      room.info.lightsHostOnly = !!msg.lightsHostOnly;
      broadcast(room, { t: 'room', room: room.info });
      break;
    }
    case 'share': {
      if (room.info.presenterId !== c.info.id) {
        return send(c.ws, { t: 'error', code: 'not_allowed', message: 'Ekranni faqat xona egasi ulasha oladi' });
      }
      const next = msg.on ? c.info.id : room.info.sharingId === c.info.id ? null : room.info.sharingId;
      if (next !== room.info.sharingId) {
        room.info.sharingId = next;
        broadcast(room, { t: 'room', room: room.info });
      }
      break;
    }
    case 'voiceToken':
      if (!voiceEnabled) return send(c.ws, { t: 'error', code: 'voice_unavailable', message: "Ovoz serveri sozlanmagan" });
      send(c.ws, {
        t: 'voiceToken', url: voiceUrl,
        token: voiceToken(room.voiceRoom, c.info.id, c.info.nickname, room.info.presenterId === c.info.id),
      });
      break;
    case 'ping':
      send(c.ws, { t: 'pong', at: msg.at, serverTime: Date.now() });
      break;
  }
}

// ------------------------------------------------------------------ HTTP (+ production'da client)
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.png': 'image/png', '.exr': 'image/x-exr', '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain',
};

function fileStat(file: string): Stats | null {
  try {
    const st = statSync(file);
    return st.isFile() ? st : null;
  } catch {
    return null;
  }
}

/**
 * Build qilingan client'ni berish: build vaqtida tayyorlangan .br/.gz nusxalar (tools/precompress.mjs),
 * kesh sarlavhalari va ETag (qayta kirishda 65 MB qayta yuklanmaydi).
 */
function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }
  let st = fileStat(file);
  if (!st) {
    // Kengaytmali yo'q fayl - 404; qolgan yo'llar (masalan /?room=..) - ilova sahifasi
    if (extname(file)) {
      res.writeHead(404).end();
      return;
    }
    file = join(DIST, 'index.html');
    st = fileStat(file);
    if (!st) {
      res.writeHead(404).end('Client build topilmadi (dev rejimda vite ishlatiladi)');
      return;
    }
  }
  const isHtml = extname(file) === '.html';
  const headers: http.OutgoingHttpHeaders = {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    // Vite nomiga hash qo'shadi (/assets/) - abadiy kesh; sahifa har safar tekshiriladi; qolganlari 1 kun
    'cache-control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=86400',
  };
  let body = file;
  let size = st.size;
  const accept = String(req.headers['accept-encoding'] ?? '');
  for (const [enc, ext] of [['br', '.br'], ['gzip', '.gz']] as const) {
    if (!accept.includes(enc)) continue;
    const cst = fileStat(file + ext);
    if (cst) {
      headers['content-encoding'] = enc;
      headers.vary = 'accept-encoding';
      body = file + ext;
      size = cst.size;
      break;
    }
  }
  const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}${headers['content-encoding'] ? '-' + headers['content-encoding'] : ''}"`;
  headers.etag = etag;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  headers['content-length'] = size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else createReadStream(body).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((s, r) => s + r.clients.size, 0) }));
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res, url.pathname);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  let client: Client | null = null;
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!client) {
      client = handleHello(ws, msg);
      if (!client) ws.close(4000);
      return;
    }
    handle(client, msg);
  });
  ws.on('pong', () => client && (client.alive = true));
  ws.on('close', () => client && removeClient(client));
  ws.on('error', () => ws.terminate());
});

// Holatlarni barcha playerlarga tarqatish (faqat o'zgarganlarini)
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const changed = [...room.clients.values()].filter((c) => c.dirty);
    if (!changed.length) continue;
    for (const c of changed) c.dirty = false;
    broadcast(room, { t: 'states', at: now, s: changed.map((c) => [c.info.id, c.info.state]) });
  }
}, 1000 / STATE_RATE);

// O'lik ulanishlarni tozalash
setInterval(() => {
  for (const room of rooms.values()) {
    for (const c of room.clients.values()) {
      if (!c.alive) {
        c.ws.terminate();
        removeClient(c);
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }
}, 10000);

server.listen(PORT, () => {
  log(`server: http://localhost:${PORT}  (ws: /ws)`);
  log(voiceEnabled ? `ovoz: ${voiceUrl}` : "ovoz o'chiq (.env da LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET yo'q)");
});
