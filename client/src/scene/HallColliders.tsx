import { useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { RigidBody, TrimeshCollider } from '@react-three/rapier';

/** Soddalashtirilgan to'qnashuv geometriyasi (devorlar, zinalar, o'rindiq qatorlari). */
export function HallColliders() {
  const gltf = useGLTF('/models/hall_collision.glb');
  const shapes = useMemo(() => {
    const out: { vertices: Float32Array; indices: Uint32Array }[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      const idx = geo.index ? Uint32Array.from(geo.index.array) : Uint32Array.from({ length: geo.attributes.position.count }, (_, i) => i);
      out.push({ vertices: geo.attributes.position.array as Float32Array, indices: idx });
    });
    return out;
  }, [gltf]);

  return (
    <RigidBody type="fixed" colliders={false}>
      {shapes.map((s, i) => (
        <TrimeshCollider key={i} args={[s.vertices, s.indices]} />
      ))}
    </RigidBody>
  );
}

useGLTF.preload('/models/hall_collision.glb');
