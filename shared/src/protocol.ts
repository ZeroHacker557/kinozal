/**
 * Client <-> server protokoli (JSON, WebSocket). Server ham, client ham shu turlardan foydalanadi.
 * Faqat "o'chiriladigan" TypeScript sintaksisi (enum yo'q) - Node 24 uni to'g'ridan-to'g'ri ishga tushiradi.
 */

export const PROTOCOL_VERSION = 4;
export const MAX_PLAYERS = 20;
/** Holat yuborish chastotasi (Hz) */
export const STATE_RATE = 15;

/** Xaritalar: xona yaratilganda egasi tanlaydi, keyin o'zgarmaydi */
export const MAPS = [
  { id: 'hall', label: 'Kino zal', layout: '/models/layout.json' },
  { id: 'forest', label: "Qorong'u o'rmon", layout: '/maps/forest/layout.json' },
] as const;
export type MapId = (typeof MAPS)[number]['id'];

export function isMapId(v: unknown): v is MapId {
  return MAPS.some((m) => m.id === v);
}

export const AVATARS = [
  { id: 'Female_Adult_01', gender: 'f', label: 'Malika', kind: 'human' },
  { id: 'Female_Adult_04', gender: 'f', label: 'Dilnoza', kind: 'human' },
  { id: 'Female_Adult_13', gender: 'f', label: 'Sevara', kind: 'human' },
  { id: 'Female_Adult_17', gender: 'f', label: 'Nigora', kind: 'human' },
  { id: 'Male_Adult_02', gender: 'm', label: 'Aziz', kind: 'human' },
  { id: 'Male_Adult_04', gender: 'm', label: 'Jasur', kind: 'human' },
  { id: 'Male_Adult_06', gender: 'm', label: 'Bekzod', kind: 'human' },
  { id: 'Male_Adult_08', gender: 'm', label: 'Sardor', kind: 'human' },
  // O'rmon xaritasi ritsarlari (bitta model, metall va mato rangi bilan farqlanadi)
  { id: 'Knight_Silver', gender: 'm', label: 'Kumush ritsar', kind: 'knight' },
  { id: 'Knight_Black', gender: 'm', label: 'Qora ritsar', kind: 'knight' },
  { id: 'Knight_Gold', gender: 'm', label: 'Oltin ritsar', kind: 'knight' },
  { id: 'Knight_Rust', gender: 'm', label: 'Zang ritsar', kind: 'knight' },
] as const;
export type AvatarId = (typeof AVATARS)[number]['id'];

export function isKnight(id: AvatarId) {
  return id.startsWith('Knight_');
}

/**
 * Xaritada ko'rinadigan avatar: o'rmonda hamma ritsar (oddiy personaj tanlagan bo'lsa, unga mos
 * ritsar varianti), zalda tanlangani.
 */
export function avatarForMap(id: AvatarId, map: MapId): AvatarId {
  if (map !== 'forest' || isKnight(id)) return id;
  const knights = AVATARS.filter((a) => a.kind === 'knight');
  const i = AVATARS.findIndex((a) => a.id === id);
  return knights[Math.max(0, i) % knights.length].id;
}

/**
 * Harakatlar (poza). Bir martalik: wave, cheer, laugh, shrug. Doimiy (harakatlanguncha): qolganlari.
 */
export const POSES = ['wave', 'clap', 'cheer', 'laugh', 'talk', 'dance', 'dance2', 'crouch', 'lie'] as const;

/** Bir martalik harakatlar (tugagach avvalgi holatga qaytadi) */
export const ONE_SHOT_POSES: readonly Pose[] = ['wave', 'cheer', 'laugh'];
export type Pose = (typeof POSES)[number];

/** Harakat holati: 0 - turish, 1 - yurish, 2 - yugurish */
export type Gait = 0 | 1 | 2;

/** Har bir player'ning tez o'zgaradigan holati (15 Hz). */
export interface PlayerState {
  /** Oyoq ostidagi nuqta (three.js koordinatalari) */
  p: [number, number, number];
  /** Tana burilishi (yaw, radian) */
  ry: number;
  /** Bosh qarash yo'nalishi: yaw (dunyo) va pitch */
  hy: number;
  hp: number;
  /** Harakat holati */
  g: Gait;
  /** Fonar yoqilganmi */
  fl: boolean;
}

export interface PlayerInfo {
  id: string;
  nickname: string;
  avatar: AvatarId;
  /** O'tirgan o'rindiq (masalan "E7") */
  seat: string | null;
  pose: Pose | null;
  /** Pozani boshlash vaqti (server ms) - bir martalik harakatlar sinxronligi uchun */
  poseAt: number;
  joinedAt: number;
  state: PlayerState;
}

export interface RoomInfo {
  id: string;
  mapId: MapId;
  hostId: string;
  lightsOn: boolean;
  /** true - chiroq tugmasini faqat xona egasi bosa oladi */
  lightsHostOnly: boolean;
  /** Ekranni ulashishga ruxsati bor player (hozircha doim xona egasi) */
  presenterId: string;
  /** Hozir ekran ulashayotgan player (yo'q bo'lsa null) */
  sharingId: string | null;
}

// ---------------------------------------------------------------- client -> server
export type ClientMessage =
  | { t: 'create'; nickname: string; avatar: AvatarId; map: MapId; v: number }
  | { t: 'join'; room: string; nickname: string; avatar: AvatarId; v: number }
  | { t: 'state'; s: PlayerState }
  | { t: 'sit'; seat: string }
  | { t: 'stand' }
  | { t: 'pose'; pose: Pose | null }
  | { t: 'lights'; on: boolean }
  | { t: 'settings'; lightsHostOnly: boolean }
  /** Ekran ulashish boshlandi/tugadi (faqat presenter) */
  | { t: 'share'; on: boolean }
  /** Ovoz serveri (LiveKit) uchun yangi token so'rash */
  | { t: 'voiceToken' }
  | { t: 'ping'; at: number };

// ---------------------------------------------------------------- server -> client
export type ServerMessage =
  /** voice - serverda ovoz (LiveKit) sozlanganmi */
  | { t: 'welcome'; selfId: string; room: RoomInfo; players: PlayerInfo[]; serverTime: number; voice: boolean }
  | { t: 'joined'; player: PlayerInfo }
  | { t: 'left'; id: string }
  /** Barcha playerlar holati (snapshot) */
  | { t: 'states'; at: number; s: [id: string, state: PlayerState][] }
  | { t: 'seat'; id: string; seat: string | null }
  | { t: 'pose'; id: string; pose: Pose | null; at: number }
  | { t: 'lights'; on: boolean; by: string }
  | { t: 'room'; room: RoomInfo }
  | { t: 'pong'; at: number; serverTime: number }
  /** LiveKit manzili va token (identity = player id) */
  | { t: 'voiceToken'; url: string; token: string }
  | { t: 'error'; code: 'room_not_found' | 'room_full' | 'bad_version' | 'seat_taken' | 'not_allowed' | 'bad_request' | 'voice_unavailable'; message: string };

/** Xona kodi: 6 ta katta harf/raqam (chalkashtiruvchi belgilarsiz) */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function isValidRoomCode(code: string) {
  return /^[A-Z0-9]{6}$/.test(code);
}

export function cleanNickname(raw: string) {
  const s = raw.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 20);
  return s || 'Mehmon';
}
