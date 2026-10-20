/**
 * Test bot: xonaga qo'shilib, buyruq faylidagi holatni serverga yuborib turadi.
 *   node server/test/bot.ts <XONA> <buyruq.json> [avatar] [nickname]
 * buyruq.json: { "p": [x,y,z], "ry": 0, "hy": 0, "hp": 0, "g": 0, "fl": false,
 *                "pose": null | "wave" | ..., "seat": null | "E7", "walkCircle": false }
 */
import { readFileSync, existsSync } from 'node:fs';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ClientMessage, type Pose } from '../../shared/src/protocol.ts';

const [room, cmdFile, avatar = 'Male_Adult_04', nickname = 'Bot Jasur'] = process.argv.slice(2);
const ws = new WebSocket(process.env.WS_URL ?? 'ws://localhost:2567/ws');
const send = (m: ClientMessage) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m));

let lastPose: Pose | null | undefined;
let lastSeat: string | null | undefined;
let t = 0;

ws.on('open', () => send({ t: 'join', room, nickname, avatar: avatar as never, v: PROTOCOL_VERSION }));
ws.on('message', (raw) => {
  const m = JSON.parse(String(raw));
  if (m.t === 'welcome') console.log('qo\'shildi', m.selfId);
  if (m.t === 'error') console.log('xato', m.message);
});

setInterval(() => {
  t += 1 / 15;
  if (!existsSync(cmdFile)) return;
  let c;
  try {
    c = JSON.parse(readFileSync(cmdFile, 'utf8').replace(/^﻿/, ''));
  } catch {
    return;
  }
  let p = c.p ?? [0, 0, 0];
  let ry = c.ry ?? 0;
  let g = c.g ?? 0;
  if (c.walkCircle) {
    const r = 1.8, w = 0.75;
    p = [p[0] + Math.cos(t * w) * r, p[1], p[2] + Math.sin(t * w) * r];
    ry = Math.atan2(Math.sin(t * w), -Math.cos(t * w)); // aylana bo'ylab harakat yo'nalishi
    g = c.g ?? 1;
  }
  send({ t: 'state', s: { p, ry, hy: c.hy ?? ry, hp: c.hp ?? 0, g, fl: !!c.fl } });
  if (c.seat !== lastSeat) {
    lastSeat = c.seat ?? null;
    send(lastSeat ? { t: 'sit', seat: lastSeat } : { t: 'stand' });
  }
  if (c.pose !== lastPose || c.repose) {
    lastPose = c.pose ?? null;
    send({ t: 'pose', pose: lastPose });
  }
}, 1000 / 15);
