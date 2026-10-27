import { use, useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody, CylinderCollider } from '@react-three/rapier';
import { loadJson, type SeatInfo, type Vec3 } from '../layout';
import { MapContext, type MapData } from '../mapContext';
import { hallUniforms } from '../lighting';
import { interactables } from '../../interaction/interactables';
import { requestSit } from '../../net/net';
import { seatOwner, useRoom } from '../../net/roomStore';

/**
 * "Qorong'u o'rmon" xaritasi. 1-bosqich: vaqtinchalik sahna (tekis yer, oddiy to'nkalar va gulxan o'rni) -
 * xarita tizimini sinash uchun. Relyef, o'rmon, qasr va yorug'lik keyingi bosqichlarda Blender'dan keladi.
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

const LOG_RADIUS = 0.23;
const NIGHT = '#070a12';

function Logs({ layout }: { layout: ForestLayout }) {
  const meshes = useRef<THREE.Mesh[]>([]);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3424', roughness: 0.95 }), []);

  useEffect(() => {
    const seatsOf = new Map<string, SeatInfo[]>();
    for (const s of layout.seats) seatsOf.set(s.row, [...(seatsOf.get(s.row) ?? []), s]);
    // To'nkaning qaralgan nuqtasiga eng yaqin bo'sh joy
    const seatAt = (hit: THREE.Intersection) => {
      const id = hit.object.userData.logId as string | undefined;
      const selfId = useRoom.getState().selfId;
      const free = (seatsOf.get(id ?? '') ?? []).filter((s) => {
        const owner = seatOwner(s.id);
        return !owner || owner.id === selfId;
      });
      let best: SeatInfo | null = null, bestD = Infinity;
      for (const s of free) {
        const d = Math.hypot(s.position[0] - hit.point.x, s.position[2] - hit.point.z);
        if (d < bestD) (best = s), (bestD = d);
      }
      return best;
    };
    return interactables.add({
      id: 'forest-logs',
      target: meshes.current,
      maxDistance: 3.2,
      label: (hit) => (seatAt(hit) ? "O'tirish" : 'Joy band'),
      use: (hit) => {
        const seat = seatAt(hit);
        if (seat) requestSit(seat.id);
      },
    });
  }, [layout]);

  return (
    <group>
      {layout.logs.map((l, i) => (
        <group key={l.id} position={l.position} rotation-y={l.yaw}>
          <mesh
            ref={(m) => {
              if (m) meshes.current[i] = m;
            }}
            userData={{ logId: l.id }}
            material={mat}
            position={[0, LOG_RADIUS * 0.9, 0]}
            rotation-z={Math.PI / 2}
            castShadow
            receiveShadow
          >
            <cylinderGeometry args={[LOG_RADIUS, LOG_RADIUS * 1.05, l.length, 14]} />
          </mesh>
          <RigidBody type="fixed" colliders={false}>
            <CylinderCollider args={[l.length / 2, LOG_RADIUS]} position={[0, LOG_RADIUS * 0.9, 0]} rotation-z={Math.PI / 2} />
          </RigidBody>
        </group>
      ))}
    </group>
  );
}

function Campfire({ position }: { position: Vec3 }) {
  const light = useRef<THREE.PointLight>(null);
  const flame = useRef<THREE.Mesh>(null);
  const stones = useMemo(() => {
    const out: { p: Vec3; s: number; r: number }[] = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      out.push({ p: [Math.cos(a) * 0.75, 0.08, Math.sin(a) * 0.75], s: 0.16 + ((i * 37) % 7) * 0.012, r: i * 1.7 });
    }
    return out;
  }, []);

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
      {stones.map((s, i) => (
        <mesh key={i} position={s.p} rotation={[s.r, s.r * 0.7, 0]} scale={s.s} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#3b3a38" roughness={0.9} />
        </mesh>
      ))}
      <mesh ref={flame} position={[0, 0.45, 0]}>
        <coneGeometry args={[0.35, 0.9, 12, 1, true]} />
        <meshBasicMaterial color="#ffb35a" toneMapped={false} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <pointLight ref={light} position={[0, 0.9, 0]} color="#ff9440" distance={30} decay={2} />
    </group>
  );
}

function ScreenStand({ screen }: { screen: ForestLayout['screen'] }) {
  const [x, y, z] = screen.center;
  const hw = screen.width / 2;
  const top = y + screen.height / 2;
  return (
    <group>
      <mesh position={[x, y, z]}>
        <planeGeometry args={[screen.width, screen.height]} />
        <meshStandardMaterial color="#cfcac0" roughness={1} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[x + sx * (hw + 0.15), (top + 0.4) / 2, z - 0.05]} castShadow>
          <cylinderGeometry args={[0.09, 0.11, top + 0.4, 10]} />
          <meshStandardMaterial color="#3a2a1d" roughness={0.9} />
        </mesh>
      ))}
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
    scene.fog = new THREE.FogExp2(NIGHT, 0.012);
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
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#1b2016" roughness={1} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[250, 0.5, 250]} position={[0, -0.5, 0]} />
      </RigidBody>
      <Campfire position={layout.fire} />
      <Logs layout={layout} />
      <ScreenStand screen={layout.screen} />
      {children}
    </MapContext>
  );
}

export default Forest;
