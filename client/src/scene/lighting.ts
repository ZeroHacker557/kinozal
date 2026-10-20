import * as THREE from 'three';

/**
 * Zal yorug'ligi butunlay pishirilgan (Cycles) va 3 qatlamdan iborat:
 *   yorug'lik = base + house * uHouse + screen * uScreenColor
 * uHouse       - zal chiroqlari darajasi (0..1, devordagi tugma bilan silliq o'zgaradi)
 * uScreenColor - ekrandagi tasvirning o'rtacha rangi (ekrandan zalga tushadigan nur)
 *
 * Statik zal lightmap'dan, dinamik obyektlar (o'rindiq, player) esa shu lightmap'lardan
 * olingan "probe" qiymatlaridan yoritiladi. Sahnada realtime chiroq yo'q — bu kuchsiz
 * videokartalarda ham yuqori FPS beradi.
 */
export const hallUniforms = {
  uHouse: { value: 1 },
  uScreenColor: { value: new THREE.Color(0, 0, 0) },
  lmBase: { value: null as THREE.Texture | null },
  lmScreen: { value: null as THREE.Texture | null },
};

/** Boshqa komponentlar o'qiydigan joriy holat (LightingController yangilaydi). */
export const lightingState = {
  house: 1,
  /** Ekrandagi tasvirning o'rtacha rangi (Screen komponenti yozadi) */
  screenAverage: new THREE.Color(0.05, 0.06, 0.08),
};

/** Blender diffuse bake -> three.js irradiance o'tkazish koeffitsienti */
const LIGHTMAP_SCALE = Math.PI;
/** Probe (pol ustidagi qiymat) -> dinamik obyekt yorug'ligi */
const PROBE_SCALE = Math.PI;

const IBL_DIFFUSE = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
const LM_LINE = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;';

function checkChunk(src: string, needle: string) {
  if (!src.includes(needle)) console.warn(`[lighting] shader chunk'da "${needle}" topilmadi`);
}
checkChunk(THREE.ShaderChunk.lights_fragment_maps, IBL_DIFFUSE);
checkChunk(THREE.ShaderChunk.lights_fragment_maps, LM_LINE);

// Muhit xaritasi (env map) faqat aksni beradi; diffuz yorug'lik pishirilgan ma'lumotdan keladi.
const MAPS_NO_IBL_DIFFUSE = THREE.ShaderChunk.lights_fragment_maps.replace(IBL_DIFFUSE, '');

const HALL_CHUNK = MAPS_NO_IBL_DIFFUSE.replace(
  LM_LINE,
  /* glsl */ `vec3 lightMapIrradiance = (
      lightMapTexel.rgb * uHouse
      + texture2D( lmBase, vLightMapUv ).rgb
      + texture2D( lmScreen, vLightMapUv ).rgb * uScreenColor
    ) * lightMapIntensity;`,
);

/** Statik zal materiali: 3 qatlamli lightmap (lightMap = house qatlami). */
export function applyHallLightmap(mat: THREE.MeshStandardMaterial, house: THREE.Texture) {
  mat.lightMap = house;
  mat.lightMapIntensity = LIGHTMAP_SCALE;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHouse = hallUniforms.uHouse;
    shader.uniforms.uScreenColor = hallUniforms.uScreenColor;
    shader.uniforms.lmBase = hallUniforms.lmBase;
    shader.uniforms.lmScreen = hallUniforms.lmScreen;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <lightmap_pars_fragment>',
        /* glsl */ `#include <lightmap_pars_fragment>
        uniform sampler2D lmBase;
        uniform sampler2D lmScreen;
        uniform float uHouse;
        uniform vec3 uScreenColor;`,
      )
      .replace('#include <lights_fragment_maps>', HALL_CHUNK);
  };
  mat.customProgramCacheKey = () => 'hall-lightmap-v2';
  mat.needsUpdate = true;
}

/** Bitta obyekt uchun probe qiymatlari (instancing ishlatilmaganda). */
export interface ProbeUniforms {
  uPH: { value: THREE.Color };
  uPB: { value: THREE.Color };
  uPS: { value: THREE.Color };
}

export function createProbeUniforms(): ProbeUniforms {
  return { uPH: { value: new THREE.Color() }, uPB: { value: new THREE.Color() }, uPS: { value: new THREE.Color() } };
}

/**
 * Dinamik obyekt materiali: yorug'lik probe'dan (instancing'da har nusxa uchun atributlar
 * aPH/aPB/aPS, aks holda uniform'lar). Yuqoriga qaragan yuzalar zal chiroqlaridan,
 * ekranga qaragan yuzalar ekran nuridan ko'proq yorug'lik oladi.
 */
export function applyProbeLighting(mat: THREE.MeshStandardMaterial, probe?: ProbeUniforms) {
  const instanced = !probe;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHouse = hallUniforms.uHouse;
    shader.uniforms.uScreenColor = hallUniforms.uScreenColor;
    if (probe) Object.assign(shader.uniforms, probe);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${instanced ? 'attribute vec3 aPH; attribute vec3 aPB; attribute vec3 aPS;' : 'uniform vec3 uPH; uniform vec3 uPB; uniform vec3 uPS;'}
        varying vec3 vPH; varying vec3 vPB; varying vec3 vPS; varying vec3 vWorldN;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        ${instanced ? 'vPH = aPH; vPB = aPB; vPS = aPS;' : 'vPH = uPH; vPB = uPB; vPS = uPS;'}
        vec3 probeN = objectNormal;
        #ifdef USE_INSTANCING
          probeN = mat3( instanceMatrix ) * probeN;
        #endif
        vWorldN = normalize( mat3( modelMatrix ) * probeN );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uHouse;
        uniform vec3 uScreenColor;
        varying vec3 vPH; varying vec3 vPB; varying vec3 vPS; varying vec3 vWorldN;`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        /* glsl */ `${MAPS_NO_IBL_DIFFUSE}
        #if defined( RE_IndirectDiffuse )
        {
          vec3 wn = normalize( vWorldN );
          float fHouse = 0.3 + 0.7 * clamp( wn.y * 0.5 + 0.5, 0.0, 1.0 );
          float fScreen = 0.15 + 0.85 * clamp( -wn.z * 0.5 + 0.5, 0.0, 1.0 );
          irradiance += ( vPH * uHouse * fHouse + vPB + vPS * uScreenColor * fScreen ) * ${PROBE_SCALE.toFixed(4)};
        }
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => (instanced ? 'probe-instanced-v1' : 'probe-uniform-v1');
  mat.needsUpdate = true;
}
