import { use, useEffect, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { loadJson, type SeatInfo, type Vec3 } from '../layout';
import { MapContext, type MapData } from '../mapContext';
import { loadTerrain } from './terrainData';
import { Terrain, TerrainColliders } from './Terrain';
import { Water } from './Water';
import { Bridge } from './Bridge';
import { Camp, ScreenGlow } from './Camp';
import { Fire } from './Fire';
import { Nature } from './Nature';
import { Sky, MOON_DIR } from './Sky';

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
      {/* Oy nuri osmondagi Oy tomonidan tushadi */}
      <directionalLight position={MOON_DIR.clone().multiplyScalar(300).toArray()} color="#a8bcff" intensity={0.55} />
      <Sky />
      <Terrain data={terrain} />
      <TerrainColliders data={terrain} />
      <Water stream={terrain.meta.stream} />
      <Bridge bridge={terrain.meta.bridge} />
      <Nature />
      <Camp seats={layout.seats} screen={layout.screen} />
      <Fire position={layout.fire} />
      <ScreenGlow center={layout.screen.center} />
      {children}
    </MapContext>
  );
}

export default Forest;
