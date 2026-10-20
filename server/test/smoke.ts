/** Server tutun testi: node server/test/smoke.ts (server ishlab turishi kerak) */
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerMessage, type ClientMessage } from '../../shared/src/protocol.ts';

const URL = process.env.WS_URL ?? 'ws://localhost:2567/ws';

function client(name: string) {
  const ws = new WebSocket(URL);
  const inbox: ServerMessage[] = [];
  const waiters: { pred: (m: ServerMessage) => boolean; res: (m: ServerMessage) => void }[] = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as ServerMessage;
    inbox.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); }
  });
  const open = new Promise((r) => ws.once('open', r));
  return {
    name, ws, inbox, open,
    send: (m: ClientMessage) => ws.send(JSON.stringify(m)),
    wait: <T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) =>
      new Promise<Extract<ServerMessage, { t: T }>>((res, rej) => {
        const hit = inbox.find((m) => m.t === t && pred(m as never));
        if (hit) return res(hit as never);
        waiters.push({ pred: (m) => m.t === t && pred(m as never), res: res as never });
        setTimeout(() => rej(new Error(`${name}: ${t} kutildi`)), 3000);
      }),
  };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error('XATO: ' + msg);
  console.log('  ✓ ' + msg);
}

const a = client('A');
const b = client('B');
await Promise.all([a.open, b.open]);

a.send({ t: 'create', nickname: 'Ali', avatar: 'Male_Adult_02', v: PROTOCOL_VERSION });
const wa = await a.wait('welcome');
assert(wa.room.hostId === wa.selfId, 'yaratuvchi xona egasi');

b.send({ t: 'join', room: wa.room.id.toLowerCase(), nickname: 'Vali<script>', avatar: 'Female_Adult_04', v: PROTOCOL_VERSION });
const wb = await b.wait('welcome');
assert(wb.players.length === 2, 'B ikki playerni ko\'radi');
const joined = await a.wait('joined');
assert(joined.player.nickname === 'Valiscript', 'nickname tozalandi');

b.send({ t: 'state', s: { p: [1, 0, 2], ry: 0.5, hy: 0.5, hp: 0.1, g: 1, fl: true } });
const st = await a.wait('states', (m) => m.s.some(([id]) => id === wb.selfId));
assert(st.s.find(([id]) => id === wb.selfId)![1].fl === true, 'holat tarqatildi');

a.send({ t: 'sit', seat: 'E7' });
await b.wait('seat', (m) => m.seat === 'E7');
b.send({ t: 'sit', seat: 'E7' });
const err = await b.wait('error');
assert(err.code === 'seat_taken', 'band o\'rindiqqa o\'tirib bo\'lmaydi');

a.send({ t: 'settings', lightsHostOnly: true });
await b.wait('room', (m) => m.room.lightsHostOnly);
b.send({ t: 'lights', on: false });
const err2 = await b.wait('error', (m) => m.code === 'not_allowed');
assert(err2, 'chiroq faqat egaga ruxsat');
a.send({ t: 'lights', on: false });
const l = await b.wait('lights');
assert(l.on === false, 'chiroq o\'chirildi va tarqatildi');

if (wa.voice) {
  b.send({ t: 'voiceToken' });
  const vt = await b.wait('voiceToken');
  const claims = JSON.parse(Buffer.from(vt.token.split('.')[1], 'base64url').toString());
  assert(vt.url && claims.sub === wb.selfId && claims.video.roomJoin, 'ovoz tokeni (identity = player id)');
  assert(claims.video.room.startsWith(`kino-${wa.room.id}-`), 'ovoz xonasi o\'yin xonasiga bog\'langan');
  assert(claims.exp > Date.now() / 1000, 'token muddati kelajakda');
  assert(!claims.video.canPublishSources.includes('screen_share'), 'oddiy mehmon ekran ulasha olmaydi (token)');
  a.send({ t: 'voiceToken' });
  const va = await a.wait('voiceToken');
  const ca = JSON.parse(Buffer.from(va.token.split('.')[1], 'base64url').toString());
  assert(ca.video.canPublishSources.includes('screen_share'), 'xona egasi ekran ulasha oladi (token)');
} else console.log('  - ovoz sozlanmagan, token testi o\'tkazib yuborildi');

assert(wa.room.presenterId === wa.selfId && wa.room.sharingId === null, 'presenter - xona egasi');
b.send({ t: 'share', on: true });
const err3 = await b.wait('error', (m) => m.code === 'not_allowed');
assert(err3, 'mehmon ekran ulasha olmaydi');
a.send({ t: 'share', on: true });
const sh = await b.wait('room', (m) => m.room.sharingId === wa.selfId);
assert(sh, 'ulashish boshlandi va tarqatildi');

a.send({ t: 'pose', pose: 'wave' });
const p = await b.wait('pose');
assert(p.pose === 'wave', 'poza tarqatildi');

a.ws.close();
const room = await b.wait('room', (m) => m.room.hostId === wb.selfId);
assert(room, 'ega chiqib ketganda B yangi ega');
assert(room.room.presenterId === wb.selfId && room.room.sharingId === null, 'ulashuvchi chiqdi: ulashish tugadi, B presenter');
const seatFree = await b.wait('seat', (m) => m.seat === null);
assert(seatFree, 'chiqib ketganda o\'rindiq bo\'shadi');

b.ws.close();
console.log('HAMMASI O\'TDI');
process.exit(0);
