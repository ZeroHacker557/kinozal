import { use, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useRapier } from '@react-three/rapier';
import { useGame } from '../../state/store';
import { loadBinary, loadJson } from '../layout';
import { fireUniforms } from './Fire';
import { view } from '../view';

/**
 * O'rmon tabiati (Blender: forest_trees.py, forest_scatter.py): ~30 ming nusxa.
 * - Har variant InstancedMesh; daraxtlarda 3 daraja: LOD0 (to'liq), LOD1 (sodda), LOD2 (impostor - kesishgan 2 tekislik);
 * - Xarita 32 m kataklarga bo'lingan: har kadr faqat ko'rinadigan (kamera piramidasi ichidagi) va yaqin kataklar ko'riladi;
 * - mayda o'simliklar faqat yaqinda chiziladi, chegarada silliq kichrayib yo'qoladi (keskin paydo bo'lmaydi);
 * - shamol: barg/o't uchlari vertex shaderda chayqaladi.
 */

interface VariantInfo {
  name: string;
  group: 'tree' | 'plant' | 'rock' | 'wood';
  offset: number;
  count: number;
  size: [number, number, number];
  collider?: { shape: 'cyl'; radius: number; height: number } | { shape: 'box'; half: [number, number, number] };
}
interface NatureMeta {
  stride: number;
  variants: VariantInfo[];
}

const CELL = 32;
const HALF = 256;
const CELLS = (HALF * 2) / CELL;

/** Variant ko'rinish masofalari (m) */
function ranges(name: string, group: VariantInfo['group'], quality: string): number[] {
  const q = quality === 'low' ? 0.7 : quality === 'high' ? 1.3 : 1;
  if (group === 'tree') return [20 * q, 75 * q, 430];
  if (name === 'grass') return [30 * q];
  if (name.startsWith('fern') || name.startsWith('plant') || name.startsWith('branches')) return [34 * q];
  if (name === 'mushrooms') return [70];
  if (name.startsWith('bush')) return [60 * q];
  // Qoya va xodalar: yaqin + sodda uzoq daraja
  if (group === 'wood') return [45 * q, 130];
  return [55 * q, 260];
}

/** Ikki tomonlama, lekin normali atayin berilgan kartochkalar: orqa yuzada normal teskari aylantirilmaydi */
const NORMAL_NO_FLIP = THREE.ShaderChunk.normal_fragment_begin.replace(/normal \*= faceDirection;/g, '');

/**
 * Barg, o't va butalarga shamol: mahalliy balandlik kvadrati bo'yicha chayqalish.
 * noFlip - kartochkalar (o't, shox to'plami, impostor): normal yuqoriga/tojdan tashqariga yo'naltirilgan,
 * orqa tomondan ham xuddi shunday yoritilishi kerak.
 */
function applyWind(mat: THREE.Material, amp: number, noFlip = false) {
  const m = mat as THREE.MeshStandardMaterial;
  // glTF materiallari keshda qayta ishlatiladi - patch faqat bir marta
  if (m.userData.wind !== undefined) return;
  m.userData.wind = amp;
  m.onBeforeCompile = (shader) => {
    if (noFlip) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', NORMAL_NO_FLIP);
    shader.uniforms.uTime = fireUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          vec3 ip = vec3( 0.0 );
          #ifdef USE_INSTANCING
            ip = vec3( instanceMatrix[ 3 ][ 0 ], instanceMatrix[ 3 ][ 1 ], instanceMatrix[ 3 ][ 2 ] );
          #endif
          float hh = max( position.y, 0.0 );
          float ph = dot( ip.xz, vec2( 0.131, 0.217 ) );
          float k = hh * hh * ${amp.toFixed(5)};
          transformed.x += ( sin( uTime * 1.3 + ph ) * 0.6 + sin( uTime * 2.9 + ph * 1.7 ) * 0.25 ) * k;
          transformed.z += ( cos( uTime * 1.1 + ph * 1.3 ) * 0.5 ) * k;
        }`,
      );
  };
  m.customProgramCacheKey = () => `wind-${amp}-${noFlip ? 1 : 0}`;
  m.needsUpdate = true;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

/** glTF obyektidan (bitta yoki bir nechta materialli) geometriya bo'laklari */
function partsOf(root: THREE.Object3D): Part[] {
  const out: Part[] = [];
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
    out.push({ geometry: g, material: mesh.material as THREE.Material });
  });
  return out;
}

interface Lod {
  meshes: THREE.InstancedMesh[];
  attr: THREE.InstancedBufferAttribute;
  range: number;
  n: number;
}

interface Variant {
  info: VariantInfo;
  lods: Lod[];
  /** Har nusxa: x, y, z, burilish, masshtab */
  data: Float32Array;
  /** Oldindan hisoblangan matritsalar */
  mats: Float32Array;
  /** Katak -> nusxa indekslari */
  cells: Int32Array[];
  fade: boolean;
}

export function Nature() {
  const quality = useGame((s) => s.quality);
  const meta = use(loadJson<NatureMeta>('/maps/forest/nature.json'));
  const bin = use(loadBinary('/maps/forest/nature.bin'));
  const trees = useGLTF('/maps/forest/models/trees.glb');
  const props = useGLTF('/maps/forest/models/nature.glb');
  const tex = useLoader(THREE.TextureLoader, [
    '/maps/forest/textures/fir_spray.png',
    '/maps/forest/textures/pine_spray.png',
    '/maps/forest/textures/tree_impostors.png',
    '/maps/forest/textures/fir_bark/diff.jpg',
    '/maps/forest/textures/fir_bark/nor.jpg',
    '/maps/forest/textures/pine_bark/diff.jpg',
    '/maps/forest/textures/pine_bark/nor.jpg',
    '/maps/forest/textures/grass_clumps.png',
  ]);
  const { world, rapier } = useRapier();

  // ------------------------------------------------------------ materiallar
  const materials = useMemo(() => {
    const [firSpray, pineSpray, imp, firBark, firBarkN, pineBark, pineBarkN, grassTex] = tex;
    for (const t of [firSpray, pineSpray, imp, firBark, pineBark, grassTex]) t.colorSpace = THREE.SRGBColorSpace;
    // glTF UV'lari teksturani teskari (flipY = false) deb hisoblaydi
    for (const t of tex) {
      t.flipY = false;
      t.needsUpdate = true;
    }
    for (const t of [firBark, firBarkN, pineBark, pineBarkN]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1 / 1.2, 1 / 1.2);
    }
    for (const t of [firSpray, pineSpray, imp, grassTex]) t.anisotropy = 4;
    // vertexColors: Blender'da pishirilgan toj ichi soyasi (AO)
    const foliage = (map: THREE.Texture, color: string) =>
      new THREE.MeshStandardMaterial({ map, color, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92, vertexColors: true });
    // Uzoq daraja (LOD1, impostor): arzonroq Lambert yoritish - ko'p piksel, kam farq
    const far = (map: THREE.Texture, color: string) =>
      new THREE.MeshLambertMaterial({ map, color, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true });
    const m: Record<string, THREE.Material> = {
      FirSpray: foliage(firSpray, '#9eae8e'),
      PineSpray: foliage(pineSpray, '#a3ab8c'),
      FirSprayFar: far(firSpray, '#9eae8e'),
      PineSprayFar: far(pineSpray, '#a3ab8c'),
      FirBark: new THREE.MeshStandardMaterial({ map: firBark, normalMap: firBarkN, roughness: 0.95, color: '#a59c92', vertexColors: true }),
      PineBark: new THREE.MeshStandardMaterial({ map: pineBark, normalMap: pineBarkN, roughness: 0.95, color: '#a89a8a', vertexColors: true }),
      // Impostor normali yuqoriga qaragani uchun to'liq yoritiladi - yaqin daraxtlar bilan tenglash uchun to'qroq
      Impostor: new THREE.MeshLambertMaterial({ map: imp, color: '#5d6658', alphaTest: 0.45, side: THREE.DoubleSide }),
      Grass: new THREE.MeshStandardMaterial({ map: grassTex, color: '#a9b08f', alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.95 }),
    };
    applyWind(m.FirSpray, 0.0007, true);
    applyWind(m.PineSpray, 0.0006, true);
    applyWind(m.FirSprayFar, 0.0007, true);
    applyWind(m.PineSprayFar, 0.0006, true);
    applyWind(m.Grass, 0.12, true);
    applyWind(m.Impostor, 0, true);
    for (const [k, v] of Object.entries(m)) v.name = `nature:${k}`;
    return m;
  }, [tex]);

  // ------------------------------------------------------------ variantlar va LOD'lar
  const variants = useMemo(() => {
    const all = new Float32Array(bin);
    const objects = new Map<string, THREE.Object3D>();
    for (const root of [trees.scene, props.scene]) root.traverse((o) => o.name && !objects.has(o.name) && objects.set(o.name, o));
    const shared = new Set<THREE.Material>();
    const fixMaterial = (mat: THREE.Material, name: string, lod: number) => {
      const own = (lod > 0 && materials[mat.name + 'Far']) || materials[mat.name];
      if (own) return own;
      const m = mat as THREE.MeshStandardMaterial;
      if (!shared.has(m)) {
        shared.add(m);
        if (m.name === 'MushCap') {
          m.emissive = new THREE.Color('#3fd4c8');
          m.emissiveIntensity = 1.6;
        }
        if (m.map && (name.startsWith('fern') || name.startsWith('plant') || name.startsWith('bush'))) {
          m.alphaTest = Math.max(m.alphaTest, 0.4);
          m.side = THREE.DoubleSide;
          m.transparent = false;
          applyWind(m, name.startsWith('bush') ? 0.06 : 0.1);
        }
      }
      return m;
    };

    const out: Variant[] = [];
    for (const info of meta.variants) {
      const data = all.subarray(info.offset * meta.stride, (info.offset + info.count) * meta.stride);
      const names =
        info.group === 'tree'
          ? [`${info.name}_0`, `${info.name}_1`, `${info.name}_2`]
          : objects.has(`${info.name}_1`)
            ? [info.name, `${info.name}_1`]
            : [info.name];
      const rs = ranges(info.name, info.group, quality);
      const mats = new Float32Array(info.count * 16);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < info.count; i++) {
        const o = i * meta.stride;
        p.set(data[o], data[o + 1], data[o + 2]);
        q.setFromAxisAngle(up, data[o + 3]);
        s.setScalar(data[o + 4]);
        m4.compose(p, q, s).toArray(mats, i * 16);
      }
      const cells: Int32Array[] = [];
      const lists: number[][] = Array.from({ length: CELLS * CELLS }, () => []);
      for (let i = 0; i < info.count; i++) {
        const cx = Math.min(CELLS - 1, Math.max(0, Math.floor((data[i * meta.stride] + HALF) / CELL)));
        const cz = Math.min(CELLS - 1, Math.max(0, Math.floor((data[i * meta.stride + 2] + HALF) / CELL)));
        lists[cz * CELLS + cx].push(i);
      }
      for (const l of lists) cells.push(Int32Array.from(l));

      const lods: Lod[] = names.map((n, li) => {
        const obj = objects.get(n);
        if (!obj) throw new Error(`nature: ${n} topilmadi`);
        const parts = partsOf(obj);
        // Impostor tekisliklari: normal yuqoriga (osmondan va oydan yoritiladi)
        if (li === 2) for (const pt of parts) {
          const nrm = pt.geometry.getAttribute('normal');
          for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, 0, 1, 0);
        }
        // Yaqin LOD uchun ko'proq joy, uzoq uchun hammasi
        const cap = Math.min(info.count, li === 0 && info.group === 'tree' ? 600 : li === 1 ? 2500 : info.count);
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
        attr.setUsage(THREE.DynamicDrawUsage);
        const meshes = parts.map((pt) => {
          const im = new THREE.InstancedMesh(pt.geometry, fixMaterial(pt.material, info.name, li), cap);
          im.instanceMatrix = attr;
          im.count = 0;
          im.frustumCulled = false;
          im.castShadow = false;
          im.receiveShadow = info.group !== 'tree';
          return im;
        });
        return { meshes, attr, range: rs[li], n: 0 };
      });
      out.push({ info, lods, data, mats, cells, fade: info.group === 'plant' });
    }
    return out;
  }, [bin, meta, trees, props, materials, quality]);

  useEffect(
    () => () => {
      for (const v of variants) for (const l of v.lods) for (const m of l.meshes) m.geometry.dispose();
    },
    [variants],
  );

  // ------------------------------------------------------------ to'qnashuvlar (daraxt tanasi, qoya, to'nka, xoda)
  useEffect(() => {
    const created: ReturnType<typeof world.createCollider>[] = [];
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const v of variants) {
      const c = v.info.collider;
      if (!c) continue;
      for (let i = 0; i < v.info.count; i++) {
        const o = i * 5;
        const [x, y, z, rot, sc] = [v.data[o], v.data[o + 1], v.data[o + 2], v.data[o + 3], v.data[o + 4]];
        // Juda kichik toshlar to'smaydi
        if (c.shape === 'cyl') {
          const r = c.radius * sc * (v.info.group === 'tree' ? 1.15 : 1);
          if (r < 0.18) continue;
          const hh = (c.height * sc) / 2;
          created.push(world.createCollider(rapier.ColliderDesc.cylinder(hh, r).setTranslation(x, y + hh, z)));
        } else {
          q.setFromAxisAngle(up, rot);
          created.push(
            world.createCollider(
              rapier.ColliderDesc.cuboid(c.half[0] * sc, c.half[1] * sc, c.half[2] * sc)
                .setTranslation(x, y + c.half[1] * sc, z)
                .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
            ),
          );
        }
      }
    }
    return () => {
      for (const c of created) world.removeCollider(c, false);
    };
  }, [variants, world, rapier]);

  // ------------------------------------------------------------ har kadr: ko'rinadigan nusxalarni LOD bo'yicha taqsimlash
  const tmp = useMemo(
    () => ({
      frustum: new THREE.Frustum(),
      pv: new THREE.Matrix4(),
      box: new THREE.Box3(),
      visible: new Uint8Array(CELLS * CELLS),
      cellD: new Float32Array(CELLS * CELLS),
    }),
    [],
  );

  useFrame(({ camera }) => {
    tmp.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    tmp.frustum.setFromProjectionMatrix(tmp.pv);
    const cx = camera.position.x, cz = camera.position.z;
    // Zoom (C) qilinganda uzoqdagilar yaqin daraja bilan chiziladi - sifat yo'qolmaydi
    const zi = 1 / view.zoom;
    for (let j = 0; j < CELLS; j++) {
      for (let i = 0; i < CELLS; i++) {
        const x0 = -HALF + i * CELL, z0 = -HALF + j * CELL;
        tmp.box.min.set(x0 - 12, -10, z0 - 12);
        tmp.box.max.set(x0 + CELL + 12, 90, z0 + CELL + 12);
        const k = j * CELLS + i;
        tmp.visible[k] = tmp.frustum.intersectsBox(tmp.box) ? 1 : 0;
        const dx = Math.max(x0 - cx, 0, cx - (x0 + CELL)), dz = Math.max(z0 - cz, 0, cz - (z0 + CELL));
        tmp.cellD[k] = Math.hypot(dx, dz);
      }
    }
    for (const v of variants) {
      const maxR = v.lods[v.lods.length - 1].range;
      for (const l of v.lods) l.n = 0;
      const stride = 5;
      for (let k = 0; k < v.cells.length; k++) {
        if (!tmp.visible[k] || tmp.cellD[k] * zi > maxR) continue;
        const list = v.cells[k];
        for (let t = 0; t < list.length; t++) {
          const i = list[t];
          const o = i * stride;
          const dx = v.data[o] - cx, dz = v.data[o + 2] - cz;
          const d = Math.sqrt(dx * dx + dz * dz) * zi;
          let li = 0;
          while (li < v.lods.length && d > v.lods[li].range) li++;
          if (li >= v.lods.length) continue;
          const lod = v.lods[li];
          if (lod.n * 16 >= lod.attr.array.length) continue;
          const dst = lod.attr.array as Float32Array;
          dst.set(v.mats.subarray(i * 16, i * 16 + 16), lod.n * 16);
          if (v.fade) {
            // Chegaraga yaqinlashganda kichrayib yo'qoladi
            const f = Math.min(1, (lod.range - d) / 6);
            if (f < 1) {
              const b = lod.n * 16;
              for (let c = 0; c < 12; c++) if (c % 4 !== 3) dst[b + c] *= f;
            }
          }
          lod.n++;
        }
      }
      for (const l of v.lods) {
        l.attr.needsUpdate = true;
        l.attr.clearUpdateRanges();
        l.attr.addUpdateRange(0, l.n * 16);
        for (const m of l.meshes) m.count = l.n;
      }
    }
  });

  return (
    <group>
      {variants.flatMap((v) => v.lods.flatMap((l) => l.meshes.map((m) => <primitive key={m.uuid} object={m} />)))}
    </group>
  );
}

useGLTF.preload('/maps/forest/models/trees.glb');
useGLTF.preload('/maps/forest/models/nature.glb');
