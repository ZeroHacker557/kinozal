/**
 * Ovoz (LiveKit) uchun kirish tokenlari. Token - HS256 JWT, LiveKit'ning API key/secret bilan imzolanadi.
 * Sozlama .env faylidan yoki muhit o'zgaruvchilaridan: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.
 * Ular bo'lmasa ovoz o'chiq - qolgan hammasi ishlayveradi.
 */
import { createHmac } from 'node:crypto';

const URL = process.env.LIVEKIT_URL ?? '';
const KEY = process.env.LIVEKIT_API_KEY ?? '';
const SECRET = process.env.LIVEKIT_API_SECRET ?? '';
/** Token amal qilish muddati. Ulangan client'ga LiveKit o'zi yangilab turadi; qayta ulanishda yangisi so'raladi. */
const TTL_S = 6 * 3600;

export const voiceEnabled = !!(URL && KEY && SECRET);
export const voiceUrl = URL;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function sign(claims: object) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iss: KEY, ...claims }));
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Yuborish mumkin bo'lgan manbalar: hamma - mikrofon; presenter - ekran tasviri va ovozi ham. */
function sources(canShare: boolean) {
  return canShare ? ['microphone', 'screen_share', 'screen_share_audio'] : ['microphone'];
}

/** Xonaga kirish tokeni: mikrofon (presenter bo'lsa ekran ham) yuborish va boshqalarni eshitish/ko'rish. */
export function voiceToken(voiceRoom: string, identity: string, name: string, canShare: boolean) {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    sub: identity,
    jti: identity,
    name,
    nbf: now - 10,
    exp: now + TTL_S,
    video: {
      room: voiceRoom,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
      canPublishSources: sources(canShare),
    },
  });
}

/** LiveKit'ning TrackSource enum qiymatlari (Twirp JSON) */
const SOURCE_ENUM: Record<string, number> = { camera: 1, microphone: 2, screen_share: 3, screen_share_audio: 4 };

/**
 * Ulangan ishtirokchining huquqlarini qayta ulanishsiz o'zgartirish (masalan, xona egasi almashganda).
 * Ishtirokchi hali ovoz serveriga ulanmagan bo'lsa LiveKit "not_found" qaytaradi - keyingi tokeni baribir to'g'ri bo'ladi.
 */
export async function setSharePermission(voiceRoom: string, identity: string, canShare: boolean) {
  if (!voiceEnabled) return;
  const now = Math.floor(Date.now() / 1000);
  const admin = sign({ sub: 'kino-server', nbf: now - 10, exp: now + 60, video: { room: voiceRoom, roomAdmin: true } });
  const base = URL.replace(/^ws/, 'http').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/twirp/livekit.RoomService/UpdateParticipant`, {
      method: 'POST',
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        room: voiceRoom,
        identity,
        permission: {
          canSubscribe: true,
          canPublish: true,
          canPublishData: false,
          canPublishSources: sources(canShare).map((s) => SOURCE_ENUM[s]),
        },
      }),
    });
    if (!res.ok && res.status !== 404) console.warn(`[voice] huquqni yangilab bo'lmadi: ${res.status} ${await res.text()}`);
  } catch (e) {
    console.warn('[voice] LiveKit API:', e);
  }
}
