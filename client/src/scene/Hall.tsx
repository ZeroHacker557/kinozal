import { createContext, use, useContext, useMemo, type ReactNode } from 'react';
import * as THREE from 'three';
import { useGLTF, useTexture } from '@react-three/drei';
import { useLoader } from '@react-three/fiber';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { useGame } from '../state/store';
import { loadLayout, type HallLayout } from './layout';
import { createHallMaterials, groupTextures, texturePaths, type EmissiveSet } from './materials';
import { hallUniforms } from './lighting';
import { LightProbeField } from './probes';
import { MapContext, type MapData } from './mapContext';

const LIGHTMAPS = ['/lightmaps/house.exr', '/lightmaps/base.exr', '/lightmaps/screen.exr'];

export interface HallData {
  layout: HallLayout;
  probes: LightProbeField;
  emissive: EmissiveSet;
  screen: THREE.Mesh;
  rocker: THREE.Object3D;
  /** Tugma paneli (null - eski hall.glb'da panel lightmap ichida) */
  switchPlate: THREE.Object3D | null;
}

const HallContext = createContext<HallData | null>(null);

export function useHall(): HallData {
  const h = useContext(HallContext);
  if (!h) throw new Error('useHall: <Hall> ichida ishlatilishi kerak');
  return h;
}

function prepareLightmap(t: THREE.DataTexture) {
  // EXRLoader qatorlarni pastdan yuqoriga yozadi, glTF UV'lari esa V bo'yicha teskari
  t.flipY = true;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.channel = 1;
  t.needsUpdate = true;
  return t;
}

export function Hall({ children }: { children?: ReactNode }) {
  const layout = use(loadLayout());
  const gltf = useGLTF('/models/hall.glb');
  const flat = useTexture(texturePaths()) as Record<string, THREE.Texture>;
  const [lmHouse, lmBase, lmScreen] = useLoader(EXRLoader, LIGHTMAPS) as THREE.DataTexture[];
  const quality = useGame((s) => s.quality);

  // Lightmap'lar va probe maydoni sifat sozlamasiga bog'liq emas
  const base = useMemo(() => {
    prepareLightmap(lmHouse);
    prepareLightmap(lmBase);
    prepareLightmap(lmScreen);
    hallUniforms.lmBase.value = lmBase;
    hallUniforms.lmScreen.value = lmScreen;

    const hallMeshes: THREE.Mesh[] = [];
    let screen: THREE.Mesh | null = null;
    let rocker: THREE.Object3D | null = null;
    let switchPlate: THREE.Object3D | null = null;
    gltf.scene.traverse((o) => {
      if (o.name === 'LightSwitch_Rocker') rocker = o;
      if (o.name === 'LightSwitch_Plate') switchPlate = o;
      if (!(o as THREE.Mesh).isMesh) return;
      const mesh = o as THREE.Mesh;
      if (mesh.name === 'Screen') screen = mesh;
      else if (mesh.geometry.attributes.uv1) hallMeshes.push(mesh);
    });
    if (!screen || !rocker) throw new Error('hall.glb: Screen yoki LightSwitch_Rocker topilmadi');

    const probes = new LightProbeField(hallMeshes, { house: lmHouse, base: lmBase, screen: lmScreen });
    probes.buildGrid(-9, 9, -13, 10.5, 0.5);
    return { probes, screen: screen as THREE.Mesh, rocker: rocker as THREE.Object3D, switchPlate };
  }, [gltf, lmHouse, lmBase, lmScreen]);

  const emissive = useMemo(() => {
    const { materials, emissive } = createHallMaterials(groupTextures(flat), lmHouse, quality);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      // Ekran va tugma o'z komponentlarida sozlanadi (ularda lightmap UV yo'q)
      if (!mesh.isMesh || mesh.name === 'Screen') return;
      // Asl (Blender) material nomi birinchi marta saqlab qo'yiladi: materiallar qayta
      // yaratilganda (sifat o'zgarishi, StrictMode) ham to'g'ri topiladi
      mesh.userData.matName ??= (mesh.material as THREE.Material).name;
      const name: string = mesh.userData.matName;
      if (!mesh.geometry.attributes.uv1 && name !== 'BoothGlass') return;
      const mat = materials[name];
      if (mat) mesh.material = mat;
      else console.warn(`[hall] material sozlanmagan: ${name}`);
      // Fonar nuri soya tashlashi uchun
      const emissive = name.startsWith('EMIT_') || name === 'BoothGlass';
      mesh.receiveShadow = !emissive;
      mesh.castShadow = !emissive;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    });
    return emissive;
  }, [gltf, flat, lmHouse, quality]);

  const data = useMemo<HallData>(
    () => ({ layout, probes: base.probes, emissive, screen: base.screen, rocker: base.rocker, switchPlate: base.switchPlate }),
    [layout, base, emissive],
  );

  const map = useMemo<MapData>(
    () => ({
      id: 'hall',
      seats: layout.seats,
      spawn: layout.spawn,
      lookupLight: (x, z, out) => base.probes.lookup(x, z, out),
    }),
    [layout, base],
  );

  return (
    <MapContext value={map}>
      <HallContext value={data}>
        <primitive object={gltf.scene} />
        {children}
      </HallContext>
    </MapContext>
  );
}

useGLTF.preload('/models/hall.glb');
