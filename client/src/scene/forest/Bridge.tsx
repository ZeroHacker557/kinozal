import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { forestTextureUrls, texturedMaterial } from './forestMaterials';
import type { TerrainMeta } from './terrainData';

const URL = '/maps/forest/models/bridge.glb';

/** Soy ustidagi yog'och ko'prik (Blender: forest_bridge.py). Taxta usti = bridge.position.y */
export function Bridge({ bridge }: { bridge: TerrainMeta['bridge'] }) {
  const gltf = useGLTF(URL);
  const wood = useLoader(THREE.TextureLoader, forestTextureUrls('rough_wood'));
  const bark = useLoader(THREE.TextureLoader, forestTextureUrls('bark_brown_02'));
  const rock = useLoader(THREE.TextureLoader, forestTextureUrls('mossy_rock'));

  const materials = useMemo<Record<string, THREE.Material>>(
    () => ({
      Plank: texturedMaterial(wood, { tile: 1.0, turn: true, color: '#d8d2c8' }),
      Wood: texturedMaterial(wood, { tile: 1.0, color: '#d8d2c8' }),
      Log: texturedMaterial(bark, { tile: 1.2, turn: true, roughness: 0.95 }),
      Stone: texturedMaterial(rock, { tile: 1.5, roughness: 0.9 }),
    }),
    [wood, bark, rock],
  );
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const scene = useMemo(() => {
    const root = gltf.scene.clone(true);
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = list.map((m) => materials[m.name] ?? m);
      mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
      mesh.castShadow = mesh.receiveShadow = true;
    });
    return root;
  }, [gltf, materials]);

  const half = bridge.length / 2;
  return (
    <group position={bridge.position} rotation-y={bridge.yaw}>
      <primitive object={scene} />
      <RigidBody type="fixed" colliders={false}>
        {/* Taxta yo'lak va panjaralar (player ko'prikdan tushib ketmasin) */}
        <CuboidCollider args={[bridge.width / 2 + 0.05, 0.06, half + 0.4]} position={[0, -0.06, 0]} />
        <CuboidCollider args={[0.08, 0.6, half - 0.4]} position={[-1.32, 0.55, 0]} />
        <CuboidCollider args={[0.08, 0.6, half - 0.4]} position={[1.32, 0.55, 0]} />
      </RigidBody>
    </group>
  );
}

useGLTF.preload(URL);
