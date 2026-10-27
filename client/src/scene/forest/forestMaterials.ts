import * as THREE from 'three';

const BASE = '/maps/forest/textures';

/** O'rmon modellari uchun tekstura to'plamlari (Poly Haven, CC0): diff + nor (+ rough) */
export const FOREST_TEXTURES = {
  rough_wood: { rough: true },
  bark_brown_02: { rough: false },
  mossy_rock: { rough: false },
} as const;
export type ForestTexture = keyof typeof FOREST_TEXTURES;

export function forestTextureUrls(id: ForestTexture) {
  const urls = [`${BASE}/${id}/diff.jpg`, `${BASE}/${id}/nor.jpg`];
  if (FOREST_TEXTURES[id].rough) urls.push(`${BASE}/${id}/rough.jpg`);
  return urls;
}

/**
 * Model materiali: Blender'dagi dunyo UV'si (1 birlik = 1 m) bo'yicha takrorlanadigan tekstura.
 * turn - tola yo'nalishini 90 gradusga burish (taxta va xodalarda tola uzunasiga yotishi uchun).
 */
export function texturedMaterial(
  loaded: THREE.Texture[],
  opts: { tile: number; turn?: boolean; color?: THREE.ColorRepresentation; roughness?: number; anisotropy?: number },
) {
  const [diff, nor, rough] = loaded.map((t, i) => {
    const c = t.clone();
    c.wrapS = c.wrapT = THREE.RepeatWrapping;
    c.repeat.set(1 / opts.tile, 1 / opts.tile);
    c.rotation = opts.turn ? Math.PI / 2 : 0;
    c.colorSpace = i === 0 ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    c.anisotropy = opts.anisotropy ?? 4;
    c.needsUpdate = true;
    return c;
  });
  return new THREE.MeshStandardMaterial({
    map: diff,
    normalMap: nor,
    roughnessMap: rough ?? null,
    roughness: opts.roughness ?? 0.9,
    color: opts.color ?? '#ffffff',
  });
}
