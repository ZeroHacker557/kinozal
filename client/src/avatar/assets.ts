import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AVATARS, isKnight, type AvatarId } from '@shared/protocol.ts';

/**
 * Avatar modellari va animatsiyalari: Microsoft Rocketbox (MIT) va ritsar ("Medieval Knight | Sculpture |
 * Game ready", by__Rx, CC BY 4.0; Rocketbox mocap'i Blender'da uning skeletiga ko'chirilgan).
 * Har bir clip alohida faylda va faqat kerak bo'lganda yuklanadi.
 */
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

export type ClipName =
  | 'idle' | 'idle_look' | 'walk' | 'run'
  | 'sit' | 'sit_relaxed' | 'sit_look' | 'sit_yawn'
  | 'wave' | 'clap' | 'cheer' | 'dance' | 'dance2' | 'laugh' | 'talk' | 'crouch';

/** Skelet turi: Rocketbox erkak/ayol yoki ritsar (Mixamo) */
export type RigKind = 'm' | 'f' | 'knight';

export function rigOf(id: AvatarId): RigKind {
  if (isKnight(id)) return 'knight';
  return AVATARS.find((a) => a.id === id)?.gender ?? 'm';
}

const clipCache = new Map<string, Promise<THREE.AnimationClip>>();

export function loadClip(rig: RigKind, name: ClipName): Promise<THREE.AnimationClip> {
  const key = `${rig}/${name}`;
  let p = clipCache.get(key);
  if (!p) {
    const url = rig === 'knight' ? `/avatars/knight/anims/${name}.glb` : `/avatars/anims_${rig}/${name}.glb`;
    p = loader.loadAsync(url).then((g) => {
      const clip = g.animations[0];
      clip.name = name;
      // Ildiz (armatura) tugunini animatsiya qilmaymiz - joylashuvni o'yin boshqaradi
      clip.tracks = clip.tracks.filter((t) => !t.name.startsWith('Avatar.') && !t.name.startsWith('Knight.'));
      return clip;
    });
    clipCache.set(key, p);
  }
  return p;
}

interface AvatarTemplate {
  scene: THREE.Group;
}

const modelCache = new Map<string, Promise<AvatarTemplate>>();

function tex(url: string, srgb: boolean) {
  const t = texLoader.load(url);
  t.flipY = false; // glTF UV'lari
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Ritsar varianti: metall va mato rangi (chiziqli), metall g'adir-budurligi ko'paytiruvchisi */
const KNIGHT_TINTS: Record<string, { metal: [number, number, number]; cloth: [number, number, number]; rough: number }> = {
  Knight_Silver: { metal: [0.95, 0.96, 1.0], cloth: [0.55, 0.08, 0.06], rough: 0.85 },
  Knight_Black: { metal: [0.3, 0.3, 0.32], cloth: [0.12, 0.12, 0.13], rough: 1.1 },
  Knight_Gold: { metal: [1.0, 0.76, 0.4], cloth: [0.1, 0.17, 0.5], rough: 0.8 },
  Knight_Rust: { metal: [0.75, 0.5, 0.35], cloth: [0.14, 0.25, 0.12], rough: 1.35 },
};

/** Zirh aksi uchun yorug'lik muhiti (o'rmonda oyli osmon; zalda sahnaning o'z muhiti ishlatiladi) */
export const avatarEnv = { map: null as THREE.Texture | null };

/**
 * Ritsar materialiga variant rangi: metallik xaritasi bo'yicha metall va mato alohida bo'yaladi
 * (bitta tekstura - to'rt xil ritsar).
 */
export function applyKnightTint(mat: THREE.MeshStandardMaterial, id: AvatarId) {
  const t = KNIGHT_TINTS[id] ?? KNIGHT_TINTS.Knight_Silver;
  const uniforms = {
    uMetalTint: { value: new THREE.Vector3(...t.metal) },
    uClothTint: { value: new THREE.Vector3(...t.cloth) },
    uMetalRough: { value: t.rough },
  };
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, r) => {
    prev?.call(mat, shader, r);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uMetalTint, uClothTint;\nuniform float uMetalRough;')
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        {
          float mt = smoothstep( 0.25, 0.75, metalnessFactor );
          diffuseColor.rgb *= mix( uClothTint, uMetalTint, mt );
          roughnessFactor = clamp( mix( roughnessFactor, roughnessFactor * uMetalRough, mt ), 0.04, 1.0 );
        }`,
      );
  };
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `knight-${prevKey()}`;
  if (avatarEnv.map) {
    mat.envMap = avatarEnv.map;
    mat.envMapIntensity = 0.9;
  }
  mat.needsUpdate = true;
}

let knightTemplate: Promise<AvatarTemplate> | null = null;

function loadKnight(): Promise<AvatarTemplate> {
  knightTemplate ??= loader.loadAsync('/avatars/knight/knight.glb').then((g) => {
    g.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      // Uzoq masofa uchun sodda nusxa (AvatarRig ko'rinishini masofaga qarab almashtiradi)
      m.userData.lod = m.name.includes('LOD1') || m.parent?.name.includes('LOD1') ? 1 : 0;
    });
    return { scene: g.scene };
  });
  return knightTemplate;
}

export function loadAvatar(id: AvatarId): Promise<AvatarTemplate> {
  if (isKnight(id)) return loadKnight();
  let p = modelCache.get(id);
  if (!p) {
    p = loader.loadAsync(`/avatars/${id}/model.glb`).then((g) => {
      const base = `/avatars/${id}`;
      const mats: Record<string, THREE.MeshStandardMaterial> = {
        body: new THREE.MeshStandardMaterial({
          map: tex(`${base}/body_color.jpg`, true),
          normalMap: tex(`${base}/body_normal.jpg`, false),
          roughnessMap: tex(`${base}/body_rough.jpg`, false),
          roughness: 1,
        }),
        head: new THREE.MeshStandardMaterial({
          map: tex(`${base}/head_color.jpg`, true),
          normalMap: tex(`${base}/head_normal.jpg`, false),
          roughnessMap: tex(`${base}/head_rough.jpg`, false),
          roughness: 1,
        }),
        opacity: new THREE.MeshStandardMaterial({
          map: tex(`${base}/opacity.png`, true),
          alphaTest: 0.45,
          side: THREE.DoubleSide,
          roughness: 0.65,
        }),
      };
      g.scene.traverse((o) => {
        const m = o as THREE.SkinnedMesh;
        if (!m.isMesh) return;
        const name = (m.material as THREE.Material).name;
        m.material = mats[name] ?? mats.body;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false; // animatsiyada bounding box o'zgaradi
      });
      return { scene: g.scene };
    });
    modelCache.set(id, p);
  }
  return p;
}

/** Bitta playerga mustaqil nusxa (skelet ham nusxalanadi; materiallar va texturalar umumiy). */
export function instantiate(t: AvatarTemplate): THREE.Object3D {
  return cloneSkinned(t.scene);
}
