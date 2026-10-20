import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../state/store';
import { useHall } from './Hall';
import { hallUniforms, lightingState } from './lighting';

/** Ekran nurining kuchi (lightmap "screen" qatlamiga ko'paytiriladi) */
const SCREEN_GAIN = 3.0;
/** Zal chiroqlari to'liq yonganda lightmap kuchaytirgichi (bake quvvatini kalibrlash) */
const HOUSE_GAIN = 1.8;
/** Chiroqlar yonishi/o'chishi tezligi (dimmer) */
const FADE_ON = 2.6;
const FADE_OFF = 1.8;

/**
 * Zal chiroqlarining holatini har kadrda yangilaydi: lightmap qatlamlari, emissiv
 * lampalar, muhit aksi. O'chirilganda kinoteatrdagidek silliq xiralashadi.
 */
export function LightingController() {
  const { emissive } = useHall();
  const scene = useThree((s) => s.scene);

  useFrame((_, dt) => {
    const target = useGame.getState().lightsOn ? 1 : 0;
    const rate = target > lightingState.house ? FADE_ON : FADE_OFF;
    lightingState.house = THREE.MathUtils.damp(lightingState.house, target, rate, Math.min(dt, 0.1));
    if (Math.abs(lightingState.house - target) < 0.001) lightingState.house = target;
    // Lampalarning yorqinligi chiziqli emas: o'chishda oxirida tez so'nadi
    const h = lightingState.house * lightingState.house * (3 - 2 * lightingState.house);

    hallUniforms.uHouse.value = h * HOUSE_GAIN;
    hallUniforms.uScreenColor.value.copy(lightingState.screenAverage).multiplyScalar(SCREEN_GAIN);

    for (const m of emissive.house) m.emissiveIntensity = 9 * h;
    for (const m of emissive.sconce) m.emissiveIntensity = 6 * (0.06 + 0.94 * h);
    for (const { mat, intensity } of emissive.always) mat.emissiveIntensity = intensity;
    for (const m of emissive.projector) m.emissiveIntensity = 8;

    scene.environmentIntensity = 0.04 + 0.5 * h;
  });

  return null;
}
