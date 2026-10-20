import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AVATARS, type AvatarId } from '@shared/protocol.ts';

/**
 * Avatar modellari va animatsiyalari (Microsoft Rocketbox, MIT). Har bir clip alohida faylda
 * va faqat kerak bo'lganda yuklanadi.
 */
const loader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();

export type ClipName =
  | 'idle' | 'idle_look' | 'walk' | 'run'
  | 'sit' | 'sit_relaxed' | 'sit_look' | 'sit_yawn'
  | 'wave' | 'clap' | 'cheer' | 'dance' | 'dance2' | 'laugh' | 'talk' | 'crouch';

export function genderOf(id: AvatarId): 'm' | 'f' {
  return AVATARS.find((a) => a.id === id)?.gender ?? 'm';
}

const clipCache = new Map<string, Promise<THREE.AnimationClip>>();

export function loadClip(gender: 'm' | 'f', name: ClipName): Promise<THREE.AnimationClip> {
  const key = `${gender}/${name}`;
  let p = clipCache.get(key);
  if (!p) {
    p = loader.loadAsync(`/avatars/anims_${gender}/${name}.glb`).then((g) => {
      const clip = g.animations[0];
      clip.name = name;
      // Ildiz (armatura) tugunini animatsiya qilmaymiz - joylashuvni o'yin boshqaradi
      clip.tracks = clip.tracks.filter((t) => !t.name.startsWith('Avatar.'));
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

export function loadAvatar(id: AvatarId): Promise<AvatarTemplate> {
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
