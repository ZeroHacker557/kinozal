import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useRoom } from '../net/roomStore';
import { sample, type Interpolated } from '../net/interp';
import { serverNow } from '../net/net';
import { useMap, seatYaw } from '../scene/mapContext';
import type { LightSample } from '../scene/probes';
import { AvatarRig, type AvatarDrive } from './AvatarRig';
import { remoteView } from './remoteView';
import { useVoice } from '../voice/voiceStore';
import { avatarForMap } from '@shared/protocol.ts';

/** Xonadagi boshqa playerlar: realistik avatarlar, silliq harakat (interpolatsiya). */
export function RemotePlayers() {
  const scene = useThree((s) => s.scene);
  const mapData = useMap();
  const mapId = mapData.id;
  const players = useRoom((s) => s.players);
  const selfId = useRoom((s) => s.selfId);
  const rigs = useRef(new Map<string, AvatarRig>());
  const seatById = useMemo(
    () => new Map(mapData.seats.map((s) => [s.id, { pos: new THREE.Vector3(...s.position), yaw: seatYaw(s) }])),
    [mapData],
  );

  // Player qo'shilganda/chiqqanda avatar yaratish/o'chirish
  useEffect(() => {
    const map = rigs.current;
    for (const [id, rig] of map) {
      const p = players[id];
      if (!p || id === selfId || avatarForMap(p.avatar, mapId) !== rig.avatarId) {
        rig.dispose();
        map.delete(id);
        remoteView.delete(id);
      }
    }
    for (const p of Object.values(players)) {
      if (p.id === selfId || map.has(p.id)) continue;
      // O'rmonda hamma ritsar: oddiy personaj tanlaganlarga mos ritsar varianti
      const rig = new AvatarRig(avatarForMap(p.avatar, mapId), p.nickname);
      scene.add(rig.root);
      map.set(p.id, rig);
    }
  }, [players, selfId, scene, mapId]);

  useEffect(
    () => () => {
      for (const rig of rigs.current.values()) rig.dispose();
      rigs.current.clear();
      remoteView.clear();
    },
    [],
  );

  const tmp = useMemo(() => {
    const interp: Interpolated = { p: [0, 0, 0], ry: 0, hy: 0, hp: 0, g: 0, fl: false, speed: 0 };
    const drive: AvatarDrive = {
      pos: new THREE.Vector3(), bodyYaw: 0, headYaw: 0, headPitch: 0, gait: 0, speed: 0, seated: false, seatYaw: 0, pose: null, poseAt: 0,
    };
    const light: LightSample = { house: new THREE.Color(), base: new THREE.Color(), screen: new THREE.Color() };
    return { interp, drive, light };
  }, []);

  useFrame(({ camera }, dt) => {
    const now = serverNow();
    const metas = useRoom.getState().players;
    const voices = useVoice.getState().peers;
    for (const [id, rig] of rigs.current) {
      const meta = metas[id];
      const v = voices[id];
      rig.setVoice(!v ? 'none' : v.muted ? 'muted' : v.speaking ? 'speaking' : 'idle');
      if (!meta || !sample(id, now, tmp.interp)) {
        rig.root.visible = false;
        continue;
      }
      rig.root.visible = true;
      const i = tmp.interp;
      const d = tmp.drive;
      const seat = meta.seat ? seatById.get(meta.seat) : undefined;
      d.seated = !!seat;
      d.seatYaw = seat?.yaw ?? 0;
      if (seat) d.pos.copy(seat.pos);
      else d.pos.set(i.p[0], i.p[1], i.p[2]);
      d.bodyYaw = i.ry;
      d.headYaw = i.hy;
      d.headPitch = i.hp;
      d.gait = i.g;
      d.speed = i.speed;
      d.pose = meta.pose;
      d.poseAt = meta.poseAt;
      rig.setLight(mapData.lookupLight(d.pos.x, d.pos.z, tmp.light));
      rig.update(Math.min(dt, 0.1), d, camera.position);

      let view = remoteView.get(id);
      if (!view) remoteView.set(id, (view = { head: new THREE.Vector3(), hand: new THREE.Vector3(), lookDir: new THREE.Vector3(), flashlight: false }));
      view.head.copy(rig.headPos);
      view.hand.copy(rig.handPos);
      const cp = Math.cos(i.hp);
      view.lookDir.set(-Math.sin(i.hy) * cp, Math.sin(i.hp), -Math.cos(i.hy) * cp);
      view.flashlight = i.fl;
    }
  });

  return null;
}
