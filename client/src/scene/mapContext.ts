import { createContext, useContext } from 'react';
import type { MapId } from '@shared/protocol.ts';
import { useGame } from '../state/store';
import { useRoom } from '../net/roomStore';
import type { SeatInfo, Vec3 } from './layout';
import type { LightSample } from './probes';

/**
 * Har bir xarita (zal, o'rmon...) taqdim etadigan umumiy ma'lumot. Player, avatarlar va
 * o'tirish tizimi shu orqali ishlaydi - qaysi xaritada ekanini bilishi shart emas.
 */
export interface MapData {
  id: MapId;
  seats: SeatInfo[];
  spawn: { position: Vec3; lookAt: Vec3 };
  /** Dinamik obyekt (avatar) uchun yorug'lik: base + house * uHouse + screen * uScreenColor */
  lookupLight: (x: number, z: number, out: LightSample) => LightSample;
}

export const MapContext = createContext<MapData | null>(null);

export function useMap(): MapData {
  const m = useContext(MapContext);
  if (!m) throw new Error('useMap: xarita komponenti ichida ishlatilishi kerak');
  return m;
}

/** Hozir chiziladigan xarita: xonada bo'lsa xonaniki, aks holda menyuda tanlangani. */
export function useActiveMap(): MapId {
  const roomMap = useRoom((s) => (s.status === 'connected' ? s.room?.mapId : undefined));
  const picked = useGame((s) => s.map);
  return roomMap ?? picked;
}

/** O'rindiq yo'nalishi (yaw 0 - -Z ga qaragan, zal o'rindiqlari kabi) */
export function seatYaw(seat: SeatInfo) {
  return seat.yaw ?? 0;
}
