import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import { CuboidCollider, HeightfieldCollider, RigidBody } from '@react-three/rapier';
import { useGame } from '../../state/store';
import { CHUNK_CELLS, LOD_STEPS, type TerrainData } from './terrainData';
import { createTerrainMaterial } from './terrainMaterial';

const BASE = '/maps/forest';

/** Uzoqlik (m) -> LOD qadami. Bo'lak 64 m. */
function lodFor(dist: number) {
  return dist < 50 ? 0 : dist < 120 ? 1 : dist < 230 ? 2 : 3;
}

export function Terrain({ data }: { data: TerrainData }) {
  const quality = useGame((s) => s.quality);
  const gl = useThree((s) => s.gl);
  const layers = data.meta.layers;
  const urls = useMemo(
    () => [`${BASE}/splat.png`, ...layers.map((l) => `${BASE}/textures/${l}/diff.jpg`), ...layers.map((l) => `${BASE}/textures/${l}/nor.jpg`)],
    [layers],
  );
  const loaded = useLoader(THREE.TextureLoader, urls);

  const material = useMemo(() => {
    const aniso = Math.min(quality === 'high' ? 8 : 4, gl.capabilities.getMaxAnisotropy());
    const [splat, ...rest] = loaded;
    splat.flipY = false;
    splat.colorSpace = THREE.NoColorSpace;
    splat.wrapS = splat.wrapT = THREE.ClampToEdgeWrapping;
    splat.needsUpdate = true;
    rest.forEach((t, i) => {
      t.flipY = false;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = i < 4 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = aniso;
      t.needsUpdate = true;
    });
    return createTerrainMaterial({ splat, diffuse: rest.slice(0, 4), normal: rest.slice(4) }, data.meta.size, quality !== 'low');
  }, [loaded, data, quality, gl]);
  useEffect(() => () => material.dispose(), [material]);

  // Bo'laklar: har biri o'z LOD geometriyalarini dangasa (kerak bo'lganda) quradi
  const chunks = useMemo(() => {
    const n = data.chunks;
    const out: { mesh: THREE.Mesh; geos: (THREE.BufferGeometry | null)[]; lod: number; ci: number; cj: number; center: THREE.Vector2 }[] = [];
    const size = CHUNK_CELLS * data.step;
    for (let ci = 0; ci < n; ci++) {
      for (let cj = 0; cj < n; cj++) {
        const geos: (THREE.BufferGeometry | null)[] = LOD_STEPS.map(() => null);
        geos[3] = data.buildChunk(ci, cj, LOD_STEPS[3]);
        const mesh = new THREE.Mesh(geos[3]);
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        const center = new THREE.Vector2(-data.half + (cj + 0.5) * size, -data.half + (ci + 0.5) * size);
        out.push({ mesh, geos, lod: 3, ci, cj, center });
      }
    }
    return out;
  }, [data]);

  useEffect(() => {
    for (const c of chunks) c.mesh.material = material;
  }, [chunks, material]);
  useEffect(() => () => chunks.forEach((c) => c.geos.forEach((g) => g?.dispose())), [chunks]);

  const half = (CHUNK_CELLS * data.step) / 2;
  const tmp = useMemo(() => new THREE.Vector2(), []);
  useFrame(({ camera }) => {
    let built = 0;
    for (const c of chunks) {
      // Kameradan bo'lak to'rtburchagigacha eng qisqa masofa
      tmp.set(
        Math.max(Math.abs(camera.position.x - c.center.x) - half, 0),
        Math.max(Math.abs(camera.position.z - c.center.y) - half, 0),
      );
      const want = lodFor(tmp.length());
      if (want === c.lod) continue;
      if (!c.geos[want]) {
        // Bir kadrda ko'pi bilan 2 ta yangi geometriya - qotib qolmasin
        if (built >= 2) continue;
        c.geos[want] = data.buildChunk(c.ci, c.cj, LOD_STEPS[want]);
        built++;
      }
      c.mesh.geometry = c.geos[want]!;
      c.lod = want;
    }
  });

  return (
    <group>
      {chunks.map((c) => (
        <primitive key={`${c.ci}-${c.cj}`} object={c.mesh} />
      ))}
    </group>
  );
}

/** Relyef to'qnashuvi (Rapier heightfield) va xarita chetidagi ko'rinmas devorlar. */
export function TerrainColliders({ data }: { data: TerrainData }) {
  const args = useMemo(() => {
    const n = data.res - 1;
    // Rapier: balandliklar ustun bo'yicha (column-major): heights[j * (n + 1) + i], i - qator (Z), j - ustun (X)
    const h = new Array<number>((n + 1) * (n + 1));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) h[j * (n + 1) + i] = data.heights[i * data.res + j];
    return [n, n, h, { x: data.meta.size, y: 1, z: data.meta.size }] as [number, number, number[], { x: number; y: number; z: number }];
  }, [data]);
  const s = data.half;
  const ref = useRef(null);
  return (
    <RigidBody ref={ref} type="fixed" colliders={false}>
      <HeightfieldCollider args={args} />
      <CuboidCollider args={[0.5, 200, s]} position={[-s + 4, 100, 0]} />
      <CuboidCollider args={[0.5, 200, s]} position={[s - 4, 100, 0]} />
      <CuboidCollider args={[s, 200, 0.5]} position={[0, 100, -s + 4]} />
      <CuboidCollider args={[s, 200, 0.5]} position={[0, 100, s - 4]} />
    </RigidBody>
  );
}
