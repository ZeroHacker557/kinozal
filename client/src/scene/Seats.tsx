import { useEffect, useMemo } from 'react';
import { interactables } from '../interaction/interactables';
import { seatOwner, useRoom } from '../net/roomStore';
import { requestSit } from '../net/net';
import * as THREE from 'three';
import { useGLTF, useTexture } from '@react-three/drei';
import { useGame } from '../state/store';
import { useHall } from './Hall';
import { applyProbeLighting } from './lighting';
import type { Vec3 } from './layout';

/** O'rindiq oldidagi oyoq qo'yish joyi (yorug'lik shu yerdan o'lchanadi) */
const PROBE_FORWARD = -0.55;

/**
 * 210 ta o'rindiq va tirsakliklar - har bir material bo'lagi uchun bitta InstancedMesh.
 * Yorug'lik har bir o'rindiq joyidagi lightmap qiymatidan olinadi (+ pishirilgan AO).
 */
export function Seats() {
  const { layout, probes } = useHall();
  const gltf = useGLTF('/models/seat.glb');
  const quality = useGame((s) => s.quality);
  const [ao, velvetDiff, velvetNor] = useTexture([
    '/models/seat_ao.png',
    '/textures/velour_velvet/diff.jpg',
    '/textures/velour_velvet/nor.jpg',
  ]);

  const meshes = useMemo(() => {
    ao.flipY = false;
    ao.channel = 1;
    ao.needsUpdate = true;

    const tiled = (t: THREE.Texture, m: number) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(1 / m, 1 / m);
      c.anisotropy = quality === 'low' ? 1 : 4;
      c.needsUpdate = true;
      return c;
    };
    const velvetMap = tiled(velvetDiff, 0.4);
    velvetMap.colorSpace = THREE.SRGBColorSpace;

    const make = (name: string): THREE.MeshStandardMaterial => {
      let m: THREE.MeshStandardMaterial;
      switch (name) {
        case 'SeatVelvet':
          m =
            quality === 'high'
              ? new THREE.MeshPhysicalMaterial({
                  map: velvetMap,
                  normalMap: tiled(velvetNor, 0.4),
                  color: new THREE.Color(0.9, 0.8, 0.8),
                  roughness: 0.95,
                  sheen: 1,
                  sheenColor: new THREE.Color(0.9, 0.3, 0.35),
                  sheenRoughness: 0.5,
                })
              : new THREE.MeshStandardMaterial({
                  map: velvetMap,
                  normalMap: tiled(velvetNor, 0.4),
                  color: new THREE.Color(0.9, 0.8, 0.8),
                  roughness: 0.95,
                });
          break;
        case 'SeatPlastic':
          m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.022, 0.022, 0.025), roughness: 0.6, envMapIntensity: 0.35 });
          break;
        case 'ArmPad':
          m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.03, 0.028, 0.027), roughness: 0.6, envMapIntensity: 0.4 });
          break;
        case 'MetalBrushed':
          m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.8, 0.8, 0.82), metalness: 1, roughness: 0.32 });
          break;
        default:
          m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.004, 0.004, 0.004), roughness: 0.9 });
      }
      if (name === 'SeatVelvet') m.envMapIntensity = 0.3;
      m.aoMap = ao;
      m.aoMapIntensity = 1;
      applyProbeLighting(m);
      return m;
    };

    const instanced = (nodeName: string, positions: Vec3[]) => {
      const node = gltf.scene.getObjectByName(nodeName);
      if (!node) throw new Error(`seat.glb: ${nodeName} topilmadi`);
      const parts: THREE.Mesh[] = [];
      node.traverse((o) => (o as THREE.Mesh).isMesh && parts.push(o as THREE.Mesh));

      // Har bir nusxa uchun probe yorug'ligi
      const n = positions.length;
      const ph = new Float32Array(n * 3), pb = new Float32Array(n * 3), ps = new Float32Array(n * 3);
      positions.forEach(([x, , z], i) => {
        const s = probes.sample(x, z + PROBE_FORWARD);
        s.house.toArray(ph, i * 3);
        s.base.toArray(pb, i * 3);
        s.screen.toArray(ps, i * 3);
      });

      const m4 = new THREE.Matrix4();
      return parts.map((part) => {
        const geo = part.geometry.clone();
        geo.setAttribute('aPH', new THREE.InstancedBufferAttribute(ph, 3));
        geo.setAttribute('aPB', new THREE.InstancedBufferAttribute(pb, 3));
        geo.setAttribute('aPS', new THREE.InstancedBufferAttribute(ps, 3));
        const mesh = new THREE.InstancedMesh(geo, make((part.material as THREE.Material).name), n);
        positions.forEach((p, i) => mesh.setMatrixAt(i, m4.makeTranslation(p[0], p[1], p[2])));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = quality !== 'low';
        return mesh;
      });
    };

    const seatParts = instanced('Seat', layout.seats.map((s) => s.position));
    for (const m of seatParts) m.userData.isSeat = true;
    return [...seatParts, ...instanced('Armrest', layout.armrests)];
  }, [gltf, ao, velvetDiff, velvetNor, layout, probes, quality]);

  // O'rindiqqa qarab E - o'tirish (instanceId -> layout.seats indeksi)
  useEffect(() => {
    const seatMeshes = meshes.filter((m) => m.userData.isSeat);
    const seatAt = (hit: THREE.Intersection) => (hit.instanceId != null ? layout.seats[hit.instanceId] : null);
    return interactables.add({
      id: 'seats',
      target: seatMeshes,
      maxDistance: 3.2,
      label: (hit) => {
        const seat = seatAt(hit);
        if (!seat) return null;
        const owner = seatOwner(seat.id);
        if (owner && owner.id !== useRoom.getState().selfId) return `Band · ${owner.nickname}`;
        return `O'tirish · ${seat.row}${seat.number}-o'rindiq`;
      },
      use: (hit) => {
        const seat = seatAt(hit);
        if (!seat) return;
        const owner = seatOwner(seat.id);
        if (owner && owner.id !== useRoom.getState().selfId) return;
        requestSit(seat.id);
      },
    });
  }, [meshes, layout]);

  return (
    <group>
      {meshes.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </group>
  );
}

useGLTF.preload('/models/seat.glb');
