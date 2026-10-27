import { use, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { forestTextureUrls, texturedMaterial } from './forestMaterials';
import { loadJson, type SeatInfo, type Vec3 } from '../layout';
import { ScreenSurface } from '../Screen';
import { lightingState } from '../lighting';
import { interactables } from '../../interaction/interactables';
import { requestSit } from '../../net/net';
import { seatOwner, useRoom } from '../../net/roomStore';
import { applyEmberGlow } from './Fire';

const URL = '/maps/forest/models/camp.glb';
const HESSIAN = ['/textures/hessian_380/diff.jpg', '/textures/hessian_380/nor.jpg'];

type CampCollider =
  | { shape: 'box'; center: Vec3; half: Vec3; yaw: number }
  | { shape: 'cyl'; center: Vec3; radius: number; half: number };

export interface CampMeta {
  colliders: CampCollider[];
  lights: { fire: Vec3; lantern: Vec3 };
}

/**
 * Gulxan maydoni (Blender: forest_camp.py): o'choq, to'nkalar, mato ekran, chodir, o'tin, qurol tokchasi...
 * To'nkaga qarab E - qaralgan nuqtaga eng yaqin bo'sh joyga o'tirish.
 */
export function Camp({ seats, screen }: { seats: SeatInfo[]; screen: { width: number; height: number } }) {
  const gltf = useGLTF(URL);
  const meta = use(loadJson<CampMeta>('/maps/forest/camp.json'));
  const wood = useLoader(THREE.TextureLoader, forestTextureUrls('rough_wood'));
  const bark = useLoader(THREE.TextureLoader, forestTextureUrls('bark_brown_02'));
  const rock = useLoader(THREE.TextureLoader, forestTextureUrls('mossy_rock'));
  const cloth = useLoader(THREE.TextureLoader, HESSIAN);

  const materials = useMemo<Record<string, THREE.Material>>(() => {
    const plain = (color: string, roughness = 0.95, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const glow = new THREE.MeshStandardMaterial({ color: '#2a1a0c', emissive: '#ffb060', emissiveIntensity: 3.2 });
    // Ko'mir va o'tin uchlari gulxan ichida qizarib turadi
    const charcoal = plain('#0e0d0c', 0.75);
    applyEmberGlow(charcoal);
    return {
      Bark: texturedMaterial(bark, { tile: 1.0, turn: true, roughness: 0.95 }),
      Firewood: texturedMaterial(bark, { tile: 0.8, turn: true, color: '#8a8580', roughness: 0.95 }),
      LogEnd: texturedMaterial(wood, { tile: 0.5, color: '#e9cfa6' }),
      Wood: texturedMaterial(wood, { tile: 1.0, color: '#d8d2c8' }),
      Plank: texturedMaterial(wood, { tile: 1.0, turn: true, color: '#d8d2c8' }),
      Stone: texturedMaterial(rock, { tile: 1.0 }),
      StoneSoot: texturedMaterial(rock, { tile: 1.0, color: '#4a4846' }),
      // Matolar ikki tomondan ko'rinadi (chodir, bayroq, ekran hoshiyasi - yupqa sirtlar)
      Canvas: texturedMaterial(cloth, { tile: 0.6, color: '#f2ead8', roughness: 1, side: THREE.DoubleSide }),
      TentCanvas: texturedMaterial(cloth, { tile: 0.6, color: '#8f7f66', roughness: 1, side: THREE.DoubleSide }),
      Banner: texturedMaterial(cloth, { tile: 0.6, color: '#7e1616', roughness: 1, side: THREE.DoubleSide }),
      Charcoal: charcoal,
      Ash: plain('#4f4b47', 1),
      Rope: plain('#6e5a3c', 1),
      Iron: plain('#2b2b2e', 0.45, 0.85),
      Glow: glow,
    };
  }, [wood, bark, rock, cloth]);
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials]);

  const { root, screenMesh, seatMesh } = useMemo(() => {
    const root = gltf.scene.clone(true);
    let screenMesh: THREE.Mesh | null = null;
    let seatMesh: THREE.Object3D | null = null;
    root.traverse((o) => {
      if (o.name === 'SeatLogs') seatMesh = o;
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name === 'Screen' || mesh.parent?.name === 'Screen') {
        screenMesh = mesh;
        return;
      }
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const mapped = list.map((m) => materials[m.name] ?? m);
      mesh.material = Array.isArray(mesh.material) ? mapped : mapped[0];
      // O'choq gulxan nurini to'smasin (nur manbai alanga ichida)
      let firePit = false;
      for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (p.name === 'FirePit') firePit = true;
      mesh.castShadow = !firePit;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
    });
    if (!screenMesh || !seatMesh) throw new Error('camp.glb: Screen yoki SeatLogs topilmadi');
    return { root, screenMesh: screenMesh as THREE.Mesh, seatMesh: seatMesh as THREE.Object3D };
  }, [gltf, materials]);

  // O'tirish: to'nkadagi qaralgan nuqtaga eng yaqin bo'sh joy
  useEffect(() => {
    const seatAt = (hit: THREE.Intersection) => {
      const selfId = useRoom.getState().selfId;
      let best: SeatInfo | null = null, bestD = 1.2;
      for (const s of seats) {
        const owner = seatOwner(s.id);
        if (owner && owner.id !== selfId) continue;
        const d = Math.hypot(s.position[0] - hit.point.x, s.position[2] - hit.point.z);
        if (d < bestD) (best = s), (bestD = d);
      }
      return best;
    };
    return interactables.add({
      id: 'forest-logs',
      target: seatMesh,
      maxDistance: 3.2,
      label: (hit) => (seatAt(hit) ? "O'tirish" : 'Joy band'),
      use: (hit) => {
        const seat = seatAt(hit);
        if (seat) requestSit(seat.id);
      },
    });
  }, [seatMesh, seats]);

  return (
    <group>
      <primitive object={root} />
      <ScreenSurface mesh={screenMesh} aspect={screen.width / screen.height} title="O'RMON KINOSI" />
      <RigidBody type="fixed" colliders={false}>
        {meta.colliders.map((c, i) =>
          c.shape === 'box' ? (
            <CuboidCollider key={i} args={c.half} position={c.center} rotation={[0, c.yaw, 0]} />
          ) : (
            <CylinderCollider key={i} args={[c.half, c.radius]} position={c.center} />
          ),
        )}
      </RigidBody>
      <pointLight position={meta.lights.lantern} color="#ffa255" intensity={2.2} distance={9} decay={2} />
    </group>
  );
}

/** Ekrandan o'tirganlarga tushadigan nur: rangi ekrandagi tasvirning o'rtacha rangi. */
export function ScreenGlow({ center }: { center: Vec3 }) {
  const light = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => {
    const o = new THREE.Object3D();
    o.position.set(center[0], 0.6, center[2] + 14);
    return o;
  }, [center]);
  useFrame(() => {
    const l = light.current;
    if (!l) return;
    l.color.copy(lightingState.screenAverage);
    const lum = 0.2126 * l.color.r + 0.7152 * l.color.g + 0.0722 * l.color.b;
    if (lum > 1e-4) l.color.multiplyScalar(1 / lum);
    l.intensity = 40 * lum;
  });
  return (
    <>
      <primitive object={target} />
      <spotLight
        ref={light}
        position={[center[0], center[1], center[2] + 0.4]}
        target={target}
        angle={1.15}
        penumbra={1}
        distance={32}
        decay={2}
      />
    </>
  );
}

useGLTF.preload(URL);
