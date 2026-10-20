import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGame } from '../state/store';
import { useHall } from './Hall';
import { applyProbeLighting, createProbeUniforms } from './lighting';
import { interactables } from '../interaction/interactables';
import { playSwitchClick } from '../audio/sfx';
import { useRoom } from '../net/roomStore';
import { requestLights } from '../net/net';

/** Rokker tugmaning burilish burchagi: yuqorisi bosilgan = yoqilgan */
const TILT = 0.16;

/**
 * Devordagi haqiqiy ko'rinishdagi chiroq tugmasi. Player yaqinlashib qarasa
 * "E — Chiroqni o'chirish/yoqish" chiqadi; bosilganda rokker buriladi, chirk ovozi chiqadi
 * va zal chiroqlari silliq o'chadi/yonadi.
 */
export function LightSwitch() {
  const { rocker, switchPlate, layout, probes } = useHall();
  const info = layout.interactables.find((i) => i.type === 'light_switch')!;
  const hitBox = useRef<THREE.Mesh>(null);

  // Rokker va panel juda kichik - lightmap o'rniga probe orqali yoritiladi
  useMemo(() => {
    const probe = createProbeUniforms();
    const s = probes.sample(info.position[0] + 0.6, info.position[2]);
    probe.uPH.value.copy(s.house);
    probe.uPB.value.copy(s.base);
    probe.uPS.value.copy(s.screen);
    const looks: Record<string, THREE.MeshStandardMaterialParameters> = {
      SwitchPlate: { color: new THREE.Color(0.6, 0.59, 0.56), roughness: 0.35 },
      MetalDark: { color: new THREE.Color(0.02, 0.02, 0.022), roughness: 0.6 },
    };
    for (const root of [rocker, switchPlate]) {
      root?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.userData.matName ??= (mesh.material as THREE.Material).name;
        const name: string = mesh.userData.matName;
        if (name.startsWith('EMIT_')) {
          // Rokkerdagi kichik indikator - to'q sariq; panel yozuvi - xira iliq
          const m = new THREE.MeshStandardMaterial({
            color: 0x000000,
            emissive: root === rocker ? new THREE.Color(1.0, 0.55, 0.2) : new THREE.Color(1.0, 0.85, 0.65),
            emissiveIntensity: root === rocker ? 2 : 0.6,
          });
          mesh.material = m;
        } else {
          const m = new THREE.MeshStandardMaterial(looks[name] ?? looks.SwitchPlate);
          m.name = name;
          applyProbeLighting(m, probe);
          mesh.material = m;
        }
      });
    }
  }, [rocker, switchPlate, probes, info]);

  useEffect(() => {
    if (!hitBox.current) return;
    return interactables.add({
      id: info.id,
      target: hitBox.current,
      maxDistance: 2.2,
      label: () => {
        const { room, selfId } = useRoom.getState();
        if (room?.lightsHostOnly && room.hostId !== selfId) return 'Chiroqni faqat xona egasi boshqaradi';
        return useGame.getState().lightsOn ? "Chiroqni o'chirish" : 'Chiroqni yoqish';
      },
      use: () => {
        const { room, selfId } = useRoom.getState();
        if (room?.lightsHostOnly && room.hostId !== selfId) return;
        const on = !useGame.getState().lightsOn;
        requestLights(on);
        playSwitchClick(on);
      },
    });
  }, [info]);

  useFrame((_, dt) => {
    const target = useGame.getState().lightsOn ? TILT : -TILT;
    // Tez, ammo silliq "chirk" harakati
    rocker.rotation.z = THREE.MathUtils.damp(rocker.rotation.z, target, 40, dt);
  });

  return (
    <mesh ref={hitBox} position={info.position} visible={false}>
      <boxGeometry args={[0.12, 0.32, 0.26]} />
      <meshBasicMaterial />
    </mesh>
  );
}
