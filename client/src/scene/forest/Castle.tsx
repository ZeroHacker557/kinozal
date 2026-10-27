import { use, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { loadJson, type Vec3 } from '../layout';
import { texturedMaterial } from './forestMaterials';
import { createFlameMesh, fireUniforms } from './Fire';

const URL = '/maps/forest/models/castle.glb';
const T = '/maps/forest/textures';

type Collider = { shape: 'box'; center: Vec3; half: Vec3; yaw: number } | { shape: 'cyl'; center: Vec3; radius: number; half: number };

interface CastleMeta {
  colliders: Collider[];
  torches: Vec3[];
}

/**
 * Qasr (Blender: forest_castle.py): devorlar, minoralar, darvoza (panjara tushirilgan), asosiy minora,
 * yoritilgan derazalar. Darvoza oldida ikki mash'ala - alanga shaderi va bitta iliq nur.
 */
export function Castle() {
  const gltf = useGLTF(URL);
  const meta = use(loadJson<CastleMeta>('/maps/forest/castle.json'));
  const tex = useLoader(THREE.TextureLoader, [
    `${T}/castle_wall_slates/diff.jpg`, `${T}/castle_wall_slates/nor.jpg`,
    `${T}/mossy_stone_wall/diff.jpg`, `${T}/mossy_stone_wall/nor.jpg`,
    `${T}/roof_slates_02/diff.jpg`, `${T}/roof_slates_02/nor.jpg`,
    `${T}/cobblestone_floor_08/diff.jpg`, `${T}/cobblestone_floor_08/nor.jpg`,
    `${T}/rough_wood/diff.jpg`, `${T}/rough_wood/nor.jpg`,
    '/textures/hessian_380/diff.jpg', '/textures/hessian_380/nor.jpg',
  ]);

  const materials = useMemo<Record<string, THREE.Material>>(() => {
    const pair = (i: number) => [tex[i * 2], tex[i * 2 + 1]];
    return {
      CastleStone: texturedMaterial(pair(0), { tile: 3.0, color: '#b9b4ac', roughness: 0.92, anisotropy: 8 }),
      CastleBase: texturedMaterial(pair(1), { tile: 2.5, color: '#9a9a8c', roughness: 0.95 }),
      Roof: texturedMaterial(pair(2), { tile: 2.0, color: '#4a4c52', roughness: 0.75 }),
      Cobble: texturedMaterial(pair(3), { tile: 2.0, color: '#a8a6a0', roughness: 0.9 }),
      Wood: texturedMaterial(pair(4), { tile: 1.0, turn: true, color: '#8a7a68' }),
      Banner: texturedMaterial(pair(5), { tile: 0.6, color: '#7e1616', roughness: 1, side: THREE.DoubleSide }),
      Iron: new THREE.MeshStandardMaterial({ color: '#2a2a2d', roughness: 0.5, metalness: 0.85 }),
      Slit: new THREE.MeshBasicMaterial({ color: '#030303' }),
      WindowDark: new THREE.MeshStandardMaterial({ color: '#06070a', roughness: 0.25 }),
      // Derazalardagi sham/mash'ala nuri
      WindowGlow: new THREE.MeshStandardMaterial({ color: '#1a1008', emissive: '#ffa84a', emissiveIntensity: 2.4 }),
      TorchHead: new THREE.MeshStandardMaterial({ color: '#1a0a04', emissive: '#ff8a30', emissiveIntensity: 3 }),
    };
  }, [tex]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const root = useMemo(() => {
    const r = gltf.scene.clone(true);
    r.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = list.map((m) => materials[m.name] ?? m);
      mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    });
    return r;
  }, [gltf, materials]);

  // Mash'ala alangalari
  const flames = useMemo(
    () =>
      meta.torches.map((p, i) => {
        const g = new THREE.Group();
        g.position.set(...p);
        const a = createFlameMesh([0.32, 0.62], 0.2 + i * 0.37, 0.5);
        const b = createFlameMesh([0.22, 0.45], 0.6 + i * 0.29, 0.2);
        b.position.set(0.03, 0, 0.02);
        g.add(a, b);
        return g;
      }),
    [meta],
  );
  useEffect(
    () => () => flames.forEach((g) => g.children.forEach((m) => ((m as THREE.Mesh).material as THREE.Material).dispose())),
    [flames],
  );

  // Ikki mash'ala orasida bitta iliq nur (har biriga alohida chiroq qimmat)
  const lightPos = useMemo<Vec3>(() => {
    const [a, b] = meta.torches;
    return a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.3, (a[2] + b[2]) / 2 + 1.2] : [0, -100, 0];
  }, [meta]);
  const light = useMemo(() => new THREE.PointLight('#ff9a48', 0, 22, 2), []);
  useFrame(() => {
    light.intensity = 7 * (0.85 + 0.15 * fireUniforms.uFire.value);
  });

  return (
    <group>
      <primitive object={root} />
      {flames.map((g) => (
        <primitive key={g.uuid} object={g} />
      ))}
      <primitive object={light} position={lightPos} />
      <RigidBody type="fixed" colliders={false}>
        {meta.colliders.map((c, i) =>
          c.shape === 'box' ? (
            <CuboidCollider key={i} args={c.half} position={c.center} rotation={[0, c.yaw, 0]} />
          ) : (
            <CylinderCollider key={i} args={[c.half, c.radius]} position={c.center} />
          ),
        )}
      </RigidBody>
    </group>
  );
}

useGLTF.preload(URL);
