import * as THREE from 'three';
import type { Quality } from '../state/store';
import { applyHallLightmap } from './lighting';
import { createCarpetTexture } from './carpet';

/** public/textures ichidagi Poly Haven (CC0) to'plamlari */
export const TEXTURE_SETS = ['velour_velvet', 'wool_boucle', 'hessian_380', 'dark_wood', 'concrete_floor_painted'] as const;
export type TextureSet = (typeof TEXTURE_SETS)[number];
export type PbrTextures = Record<TextureSet, { diff: THREE.Texture; nor: THREE.Texture; rough: THREE.Texture }>;

export function texturePaths() {
  const out: Record<string, string> = {};
  for (const s of TEXTURE_SETS) {
    out[`${s}/diff`] = `/textures/${s}/diff.jpg`;
    out[`${s}/nor`] = `/textures/${s}/nor.jpg`;
    out[`${s}/rough`] = `/textures/${s}/rough.jpg`;
  }
  return out;
}

export function groupTextures(flat: Record<string, THREE.Texture>): PbrTextures {
  const out = {} as PbrTextures;
  for (const s of TEXTURE_SETS) {
    out[s] = { diff: flat[`${s}/diff`], nor: flat[`${s}/nor`], rough: flat[`${s}/rough`] };
    out[s].diff.colorSpace = THREE.SRGBColorSpace;
  }
  return out;
}

/** Texturani nusxalab, real o'lchamda takrorlanadigan qiladi (UV metrlarda). */
function tiled(tex: THREE.Texture, meters: number, anisotropy: number) {
  const t = tex.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / meters, 1 / meters);
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

export interface EmissiveSet {
  house: THREE.MeshStandardMaterial[];
  sconce: THREE.MeshStandardMaterial[];
  always: { mat: THREE.MeshStandardMaterial; intensity: number }[];
  projector: THREE.MeshStandardMaterial[];
}

/**
 * Blender material nomlari bo'yicha three.js materiallarini yaratadi.
 * Emissiv materiallar (EMIT_*) yorug'lik holatiga qarab LightingController tomonidan boshqariladi.
 */
export function createHallMaterials(tex: PbrTextures, lmHouse: THREE.Texture, quality: Quality) {
  const aniso = quality === 'high' ? 8 : quality === 'medium' ? 4 : 1;
  const physical = quality !== 'low';
  const emissive: EmissiveSet = { house: [], sconce: [], always: [], projector: [] };

  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);

  const carpetMap = createCarpetTexture();
  carpetMap.repeat.set(1 / 1.6, 1 / 1.6);
  carpetMap.anisotropy = aniso;

  const velvetParams = (meters: number, tint: THREE.ColorRepresentation): THREE.MeshPhysicalMaterialParameters => ({
    map: tiled(tex.velour_velvet.diff, meters, aniso),
    normalMap: tiled(tex.velour_velvet.nor, meters, aniso),
    roughnessMap: tiled(tex.velour_velvet.rough, meters, aniso),
    color: tint,
    roughness: 1,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });

  const lit: Record<string, THREE.MeshStandardMaterial> = {
    Carpet: std({
      map: carpetMap,
      normalMap: tiled(tex.wool_boucle.nor, 0.35, aniso),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.97,
    }),
    WallFabric: std({
      map: tiled(tex.hessian_380.diff, 0.9, aniso),
      normalMap: tiled(tex.hessian_380.nor, 0.9, aniso),
      roughnessMap: tiled(tex.hessian_380.rough, 0.9, aniso),
      color: new THREE.Color(0.2, 0.2, 0.235),
      roughness: 1,
    }),
    WallBase: std({ color: new THREE.Color(0.03, 0.03, 0.035), roughness: 0.85 }),
    Wood: std({
      map: tiled(tex.dark_wood.diff, 1.4, aniso),
      normalMap: tiled(tex.dark_wood.nor, 1.4, aniso),
      roughnessMap: tiled(tex.dark_wood.rough, 1.4, aniso),
      color: new THREE.Color(0.75, 0.6, 0.5),
      roughness: 0.9,
      envMapIntensity: 0.2,
    }),
    Ceiling: std({
      color: new THREE.Color(0.02, 0.02, 0.025),
      normalMap: tiled(tex.concrete_floor_painted.nor, 2.5, aniso),
      roughness: 0.95,
    }),
    CeilingSlat: std({
      map: tiled(tex.dark_wood.diff, 1.4, aniso),
      color: new THREE.Color(0.22, 0.19, 0.17),
      roughness: 0.85,
      envMapIntensity: 0.05,
    }),
    MaskBlack: std({ color: new THREE.Color(0.004, 0.004, 0.004), roughness: 1 }),
    Curtain: physical
      ? new THREE.MeshPhysicalMaterial({
          ...velvetParams(0.6, new THREE.Color(0.85, 0.75, 0.75)),
          sheen: 1,
          sheenColor: new THREE.Color(0.9, 0.25, 0.3),
          sheenRoughness: 0.45,
        })
      : std(velvetParams(0.6, new THREE.Color(0.85, 0.75, 0.75))),
    MetalBrushed: std({ color: new THREE.Color(0.8, 0.8, 0.82), metalness: 1, roughness: 0.32 }),
    MetalDark: std({ color: new THREE.Color(0.06, 0.06, 0.065), metalness: 0.85, roughness: 0.42 }),
    StageTop: std({ color: new THREE.Color(0.012, 0.012, 0.014), roughness: 0.75 }),
    SpeakerGrille: std({
      color: new THREE.Color(0.025, 0.025, 0.028),
      normalMap: tiled(tex.hessian_380.nor, 0.25, aniso),
      roughness: 1,
    }),
    SwitchPlate: std({ color: new THREE.Color(0.55, 0.54, 0.52), roughness: 0.4 }),
    BoothInterior: std({ color: new THREE.Color(0.03, 0.03, 0.035), roughness: 0.9 }),
    SignBody: std({ color: new THREE.Color(0.02, 0.02, 0.02), roughness: 0.5 }),
  };
  for (const m of Object.values(lit)) applyHallLightmap(m, lmHouse);

  const emit = (color: THREE.ColorRepresentation) =>
    std({ color: 0x000000, emissive: new THREE.Color(color), emissiveIntensity: 0, roughness: 0.6 });

  const special: Record<string, THREE.Material> = {
    BoothGlass: new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0.05, 0.06, 0.07),
      roughness: 0.05,
      metalness: 0,
      transparent: true,
      opacity: 0.35,
      envMapIntensity: 1.5,
    }),
  };

  const emitMats: Record<string, THREE.MeshStandardMaterial> = {
    EMIT_House: emit(new THREE.Color(1.0, 0.85, 0.68)),
    EMIT_Sconce: emit(new THREE.Color(1.0, 0.78, 0.55)),
    EMIT_Step: emit(new THREE.Color(1.0, 0.72, 0.42)),
    EMIT_Exit: emit(new THREE.Color(0.15, 1.0, 0.35)),
    EMIT_Label: emit(new THREE.Color(1.0, 0.82, 0.6)),
    EMIT_Projector: emit(new THREE.Color(0.85, 0.9, 1.0)),
  };
  emissive.house.push(emitMats.EMIT_House);
  emissive.sconce.push(emitMats.EMIT_Sconce);
  emissive.always.push({ mat: emitMats.EMIT_Step, intensity: 2.2 });
  emissive.always.push({ mat: emitMats.EMIT_Exit, intensity: 2.5 });
  emissive.always.push({ mat: emitMats.EMIT_Label, intensity: 1.2 });
  emissive.projector.push(emitMats.EMIT_Projector);

  const all: Record<string, THREE.Material> = { ...lit, ...special, ...emitMats };
  return { materials: all, emissive };
}
