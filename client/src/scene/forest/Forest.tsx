import { use, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { loadJson, type SeatInfo, type Vec3 } from '../layout';
import { MapContext, type MapData } from '../mapContext';
import { hallUniforms } from '../lighting';
import { loadTerrain } from './terrainData';
import { Terrain, TerrainColliders } from './Terrain';
import { Water } from './Water';
import { Bridge } from './Bridge';
import { Camp, ScreenGlow } from './Camp';

/**
 * "Qorong'u o'rmon" xaritasi: 512x512 m relyef (Blender: forest_terrain.py), soy va ko'prik,
 * gulxan maydoni (forest_camp.py: o'choq, to'nkalar, mato kino ekrani, lager buyumlari).
 */

export interface LogInfo {
  id: string;
  position: Vec3;
  yaw: number;
  length: number;
}

export interface ForestLayout {
  seats: SeatInfo[];
  logs: LogInfo[];
  fire: Vec3;
  screen: { center: Vec3; width: number; height: number };
  spawn: { position: Vec3; lookAt: Vec3; radius?: number };
  bounds: { min: [number, number]; max: [number, number] };
}

const NIGHT = '#070a12';

/** Vaqtinchalik alanga va miltillovchi gulxan nuri (4-bosqichda haqiqiy olov effekti bilan almashadi) */
function Campfire({ position }: { position: Vec3 }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Bir necha sinusdan yig'ilgan "tirik" miltillash
    const f = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1 + 1.3) + 0.04 * Math.sin(t * 23.7 + 0.4);
    hallUniforms.uHouse.value = f;
    hallUniforms.uScreenColor.value.setRGB(0, 0, 0);
    if (light.current) light.current.intensity = 14 * f;
    if (flame.current) flame.current.scale.set(1, 0.85 + 0.25 * f, 1);
  });

  return (
    <group position={position}>
      <mesh ref={flame} position={[0, 0.5, 0]}>
        <coneGeometry args={[0.28, 0.8, 12, 1, true]} />
        <meshBasicMaterial color="#ffb35a" toneMapped={false} transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <pointLight ref={light} position={[0, 0.9, 0]} color="#ff9440" distance={30} decay={2} />
    </group>
  );
}

/** Kamera ko'rish masofasi va tuman - ochiq xarita uchun */
function SkyAndFog() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const prev = { near: camera.near, far: camera.far, fog: scene.fog };
    camera.near = 0.08;
    camera.far = 2500;
    camera.updateProjectionMatrix();
    scene.fog = new THREE.FogExp2(NIGHT, 0.0045);
    return () => {
      camera.near = prev.near;
      camera.far = prev.far;
      camera.updateProjectionMatrix();
      scene.fog = prev.fog;
    };
  }, [camera, scene]);
  return null;
}

export function Forest({ children }: { children?: ReactNode }) {
  const layout = use(loadJson<ForestLayout>('/maps/forest/layout.json'));
  const terrain = use(loadTerrain());

  const map = useMemo<MapData>(
    () => ({
      id: 'forest',
      seats: layout.seats,
      spawn: layout.spawn,
      // Hozircha avatarlar faqat realtime chiroqlardan (oy, gulxan, osmon) yoritiladi
      lookupLight: (_x, _z, out) => {
        out.house.setRGB(0, 0, 0);
        out.base.setRGB(0, 0, 0);
        out.screen.setRGB(0, 0, 0);
        return out;
      },
    }),
    [layout],
  );

  return (
    <MapContext value={map}>
      <color attach="background" args={[NIGHT]} />
      <SkyAndFog />
      <hemisphereLight args={['#2a3a5c', '#0b0907', 0.35]} />
      <directionalLight position={[-120, 220, -260]} color="#a8bcff" intensity={0.55} />
      {/* Oy (vaqtinchalik) */}
      <mesh position={[-300, 520, -900]}>
        <sphereGeometry args={[28, 32, 16]} />
        <meshBasicMaterial color="#e8ecf5" toneMapped={false} fog={false} />
      </mesh>
      <Terrain data={terrain} />
      <TerrainColliders data={terrain} />
      <Water stream={terrain.meta.stream} />
      <Bridge bridge={terrain.meta.bridge} />
      <Camp seats={layout.seats} screen={layout.screen} />
      <Campfire position={layout.fire} />
      <ScreenGlow center={layout.screen.center} />
      {children}
    </MapContext>
  );
}

export default Forest;
