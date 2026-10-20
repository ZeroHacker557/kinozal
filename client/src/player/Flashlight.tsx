import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGame } from '../state/store';
import { lightingState } from '../scene/lighting';
import { remoteView } from '../avatar/remoteView';

const COLOR = new THREE.Color(1.0, 0.95, 0.86); // iliq LED
const ANGLE = 0.4;
const INTENSITY = 14;
const REMOTE_SLOTS = 3;

/**
 * Haqiqiy fonar nuri naqshi (light cookie): yorqin markaz, reflektor halqasi,
 * yumshoq chet va linzadagi mayda notekisliklar.
 */
function createCookie() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blotches = Array.from({ length: 9 }, () => ({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, r: 0.15 + rnd() * 0.3, k: 0.05 + rnd() * 0.07 }));
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / (S - 1)) * 2 - 1, v = (y / (S - 1)) * 2 - 1;
      const r = Math.hypot(u, v);
      let i = 0;
      i += Math.exp(-Math.pow(r / 0.2, 2)) * 1.0;                 // markaziy dog'
      i += 0.55 * Math.exp(-Math.pow((r - 0.5) / 0.09, 2));        // reflektor halqasi
      i += 0.32 * (1 - THREE.MathUtils.smoothstep(r, 0.55, 0.95)); // tashqi yorug'lik
      i *= 1 - THREE.MathUtils.smoothstep(r, 0.88, 1.0);
      for (const b of blotches) i *= 1 - b.k * Math.exp(-((u - b.x) ** 2 + (v - b.y) ** 2) / (b.r * b.r));
      const val = Math.max(0, Math.min(1, i)) * 255;
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = val;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const beamVertex = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  vT = 1.0 - uv.y; // 0 - fonar, 1 - konus oxiri
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const beamFragment = /* glsl */ `
uniform float uStrength;
uniform vec3 uColor;
varying float vT;
varying vec3 vN;
varying vec3 vV;
void main() {
  float t = clamp(vT, 0.0, 1.0);
  // Hajm effekti: nur markazi (ko'rish nuri ko'proq "tuman"dan o'tadi) yorqinroq, chetlari xira
  float facing = abs(dot(normalize(vN), normalize(vV)));
  float a = uStrength * pow(max(1.0 - t, 0.0), 2.0) * pow(facing, 1.5);
  gl_FragColor = vec4(uColor * clamp(a, 0.0, 2.0), 1.0);
}`;

/** Fonar nurining havodagi ko'rinishi (konus; uchi fonarda). */
function createBeam() {
  const L = 7;
  const geo = new THREE.ConeGeometry(Math.tan(ANGLE) * L, L, 24, 1, true);
  geo.translate(0, -L / 2, 0);
  geo.rotateX(-Math.PI / 2); // uchi koordinata boshida, -Z tomonga ochiladi... keyin lookAt bilan yo'naltiriladi
  const mat = new THREE.ShaderMaterial({
    vertexShader: beamVertex,
    fragmentShader: beamFragment,
    uniforms: { uStrength: { value: 0 }, uColor: { value: COLOR.clone() } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/**
 * O'z fonarimiz (F) va boshqa playerlarning fonarlari. Chiroqlar soni doim bir xil (yoqish/o'chirish
 * faqat yorqinlikni o'zgartiradi) - shunda shaderlar qayta kompilyatsiya qilinmaydi.
 */
export function Flashlights() {
  const quality = useGame((s) => s.quality);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  const rig = useMemo(() => {
    const shadows = quality !== 'low';
    const local = new THREE.SpotLight(COLOR, 0, 30, ANGLE, 0.35, 2);
    local.position.set(0, -50, 0);
    local.target.position.set(0, -51, 0); // nol yo'nalish (NaN) bo'lmasligi uchun
    local.castShadow = shadows;
    if (shadows) {
      local.shadow.mapSize.setScalar(quality === 'high' ? 1024 : 512);
      local.shadow.camera.near = 0.15;
      local.shadow.camera.far = 30;
      local.shadow.bias = -0.0004;
      local.shadow.normalBias = 0.03;
      local.map = createCookie(); // cookie faqat soyali chiroqda ishlaydi
    }
    const remote = Array.from({ length: REMOTE_SLOTS }, () => {
      const l = new THREE.SpotLight(COLOR, 0, 25, ANGLE, 0.45, 2);
      // Muhim: chiroq va nishon bir nuqtada bo'lsa yo'nalish nol vektor -> shaderda NaN va butun
      // sahna qora bo'lib qoladi (intensivlik 0 bo'lsa ham). Ishlatilmaganda pastga qaratib qo'yiladi.
      l.position.set(0, -50, 0);
      l.target.position.set(0, -51, 0);
      const beam = createBeam();
      return { light: l, beam };
    });
    return { local, remote };
  }, [quality]);

  useEffect(() => {
    const { local, remote } = rig;
    scene.add(local, local.target);
    for (const r of remote) scene.add(r.light, r.light.target, r.beam.mesh);
    return () => {
      scene.remove(local, local.target);
      for (const r of remote) scene.remove(r.light, r.light.target, r.beam.mesh);
      local.dispose();
      for (const r of remote) {
        r.light.dispose();
        r.beam.mat.dispose();
        r.beam.mesh.geometry.dispose();
      }
    };
  }, [rig, scene]);

  const tmp = useMemo(
    () => ({ offset: new THREE.Vector3(), dir: new THREE.Vector3(), aim: new THREE.Vector3(), sway: new THREE.Vector3(), list: [] as { id: string; d: number }[] }),
    [],
  );

  useFrame((state, dt) => {
    const { local, remote } = rig;
    const { flashlight, sceneReady } = useGame.getState();
    const t = state.clock.elapsedTime;

    // --- o'z fonarimiz: o'ng qo'lda, kameradan biroz pastda; yo'nalish qo'l tebranishi bilan kechikadi
    tmp.offset.set(0.2, -0.24, -0.15).applyQuaternion(camera.quaternion);
    local.position.copy(camera.position).add(tmp.offset);
    camera.getWorldDirection(tmp.dir);
    tmp.sway.set(Math.sin(t * 1.3) * 0.012, Math.sin(t * 1.7) * 0.01, 0).applyQuaternion(camera.quaternion);
    tmp.aim.copy(camera.position).addScaledVector(tmp.dir, 8).add(tmp.sway);
    local.target.position.lerp(tmp.aim, 1 - Math.exp(-14 * dt));
    local.target.updateMatrixWorld();
    local.intensity = THREE.MathUtils.damp(local.intensity, flashlight ? INTENSITY : 0, 30, dt);
    // O'chiq fonar soyasi hisoblanmaydi; yuklanish paytida esa soya shaderlari tayyorlanadi.
    // Soya xaritasi hali yaratilmagan bo'lsa (sahna keshdan tez yuklandi, sifat o'zgardi) albatta bir marta
    // chiziladi: aks holda shaderdagi soya sampler'i bo'sh qoladi, WebGL har bir chizishni rad etadi - sahna qora.
    local.shadow.autoUpdate = flashlight || !sceneReady || !local.shadow.map;

    // --- boshqa playerlar: eng yaqin yoqilgan fonarlar
    tmp.list.length = 0;
    for (const [id, v] of remoteView) {
      if (v.flashlight) tmp.list.push({ id, d: v.head.distanceToSquared(camera.position) });
    }
    tmp.list.sort((a, b) => a.d - b.d);
    const dark = 1 - lightingState.house;
    remote.forEach((r, i) => {
      const item = tmp.list[i];
      const v = item && remoteView.get(item.id);
      if (!v) {
        r.light.intensity = THREE.MathUtils.damp(r.light.intensity, 0, 30, dt);
        if (r.light.intensity < 0.01) {
          r.light.intensity = 0;
          r.light.position.set(0, -50, 0);
          r.light.target.position.set(0, -51, 0);
          r.light.target.updateMatrixWorld();
        }
        r.beam.mat.uniforms.uStrength.value = 0;
        r.beam.mesh.visible = false;
        return;
      }
      r.light.position.copy(v.hand);
      r.light.target.position.copy(v.hand).addScaledVector(v.lookDir, 8);
      r.light.target.updateMatrixWorld();
      r.light.intensity = THREE.MathUtils.damp(r.light.intensity, INTENSITY, 30, dt);
      r.beam.mesh.visible = true;
      r.beam.mesh.position.copy(v.hand);
      r.beam.mesh.lookAt(r.light.target.position);
      r.beam.mat.uniforms.uStrength.value = 0.05 + 0.18 * dark;
    });
  });

  return null;
}
