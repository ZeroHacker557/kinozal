import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGame } from '../state/store';
import { useHall } from './Hall';
import { lightingState } from './lighting';

const beamVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const beamFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
uniform float uTime;
varying vec2 vUv;
varying vec3 vWorld;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void main() {
  // Muhim: interpolatsiyada t 1 dan sal oshishi mumkin - pow(manfiy) NaN beradi va Bloom
  // uni butun kadrga yoyib, ekranni qora miltillatadi. Shuning uchun qat'iy chegaralanadi.
  float t = clamp(vUv.y, 0.0, 1.0);      // 0 - proyektor, 1 - ekran
  float edge = sin(3.14159 * clamp(vUv.x, 0.0, 1.0));
  float haze = 0.55 + 0.45 * noise(vWorld * 1.3 + vec3(0.0, uTime * 0.05, uTime * 0.03));
  float a = uStrength * pow(max(1.0 - t, 0.0), 1.6) * (0.25 + 0.75 * edge) * haze;
  gl_FragColor = vec4(uColor * clamp(a, 0.0, 4.0), 1.0);
}`;

const dustVertex = /* glsl */ `
uniform float uTime;
uniform vec3 uLens;
uniform vec3 uScreen;
uniform vec2 uHalf;
attribute float aSeed;
varying float vA;
void main() {
  vec3 p = position;
  p.y += sin(uTime * 0.2 + aSeed * 30.0) * 0.15;
  p.x += cos(uTime * 0.17 + aSeed * 20.0) * 0.15;
  // Nur ichidami? (lens -> ekran o'qi bo'yicha piramida)
  vec3 axis = uScreen - uLens;
  float L = length(axis);
  vec3 d = axis / L;
  float t = clamp(dot(p - uLens, d) / L, 0.0, 1.0);
  vec3 q = p - (uLens + d * t * L);
  vec2 lim = uHalf * t + 0.02;
  float inside = (1.0 - smoothstep(lim.x * 0.8, lim.x, abs(q.x))) * (1.0 - smoothstep(lim.y * 0.8, lim.y, abs(q.y)));
  vA = inside * (1.0 - t * 0.7) * (0.4 + 0.6 * fract(aSeed * 7.13));
  vec4 mv = viewMatrix * modelMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // Kameraga juda yaqin zarralar katta "yulduz" bo'lib ko'rinmasligi uchun so'ndiriladi
  vA *= smoothstep(1.5, 4.0, -mv.z);
  gl_PointSize = clamp((9.0 / max(-mv.z, 0.05)) * (0.6 + fract(aSeed * 3.7)), 1.0, 3.5);
}`;

const dustFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vA * uStrength;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/** Proyektordan ekranga tushadigan yorug'lik nuri va unda suzib yurgan chang zarralari. */
export function ProjectorBeam() {
  const { layout } = useHall();
  const quality = useGame((s) => s.quality);

  const { beam, dust, beamMat, dustMat } = useMemo(() => {
    const lens = new THREE.Vector3(...layout.projector);
    const c = new THREE.Vector3(...layout.screen.center);
    const hw = layout.screen.width / 2, hh = layout.screen.height / 2;
    const corners = [
      new THREE.Vector3(c.x - hw, c.y - hh, c.z),
      new THREE.Vector3(c.x + hw, c.y - hh, c.z),
      new THREE.Vector3(c.x + hw, c.y + hh, c.z),
      new THREE.Vector3(c.x - hw, c.y + hh, c.z),
    ];
    // 4 ta yon tomon; uv.x - ko'ndalang, uv.y - nur bo'ylab
    const pos: number[] = [], uv: number[] = [];
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      pos.push(lens.x, lens.y, lens.z, a.x, a.y, a.z, b.x, b.y, b.z);
      uv.push(0.5, 0, 0, 1, 1, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const beamMat = new THREE.ShaderMaterial({
      vertexShader: beamVertex,
      fragmentShader: beamFragment,
      uniforms: { uColor: { value: new THREE.Color() }, uStrength: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beam = new THREE.Mesh(g, beamMat);
    beam.frustumCulled = false;

    // Chang zarralari nur hajmi atrofida
    const N = quality === 'low' ? 0 : quality === 'medium' ? 300 : 700;
    const dp = new Float32Array(N * 3), seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const t = Math.pow(Math.random(), 0.7);
      const p = lens.clone().lerp(c, t);
      p.x += (Math.random() * 2 - 1) * hw * t;
      p.y += (Math.random() * 2 - 1) * hh * t;
      dp.set([p.x, p.y, p.z], i * 3);
      seeds[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const dustMat = new THREE.ShaderMaterial({
      vertexShader: dustVertex,
      fragmentShader: dustFragment,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color() },
        uStrength: { value: 0 },
        uLens: { value: lens },
        uScreen: { value: c },
        uHalf: { value: new THREE.Vector2(hw, hh) },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(dg, dustMat);
    dust.frustumCulled = false;
    return { beam, dust, beamMat, dustMat };
  }, [layout, quality]);

  useFrame(({ clock }) => {
    const dark = 1 - lightingState.house;
    const col = lightingState.screenAverage;
    const lum = col.r * 0.3 + col.g * 0.59 + col.b * 0.11;
    beamMat.uniforms.uTime.value = clock.elapsedTime;
    beamMat.uniforms.uColor.value.copy(col).multiplyScalar(1 / Math.max(lum, 0.05)).lerp(new THREE.Color(1, 1, 1), 0.4);
    beamMat.uniforms.uStrength.value = (0.012 + 0.05 * Math.min(lum * 4, 1)) * (0.15 + 0.85 * dark);
    dustMat.uniforms.uTime.value = clock.elapsedTime;
    dustMat.uniforms.uColor.value.copy(beamMat.uniforms.uColor.value);
    dustMat.uniforms.uStrength.value = 0.3 * dark * Math.min(lum * 4 + 0.2, 1);
  });

  return (
    <>
      <primitive object={beam} />
      <primitive object={dust} />
    </>
  );
}
