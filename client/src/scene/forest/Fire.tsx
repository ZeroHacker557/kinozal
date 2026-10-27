import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGame } from '../../state/store';
import { hallUniforms } from '../lighting';
import { startFireSound } from '../../audio/ambient';
import type { Vec3 } from '../layout';

/**
 * Gulxan: shader alanga (kameraga qaragan, shamolda egiladi), ko'tariluvchi uchqunlar, tutun,
 * miltillovchi soyali nur va fazoviy chirsillash ovozi. Hammasi GPU'da hisoblanadi (CPU'da zarracha yo'q).
 */

/** Umumiy uniformlar: vaqt, shamol, olov kuchi (miltillash) - cho'g' materiali ham shulardan foydalanadi */
export const fireUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2(0.22, -0.08) },
  uFire: { value: 1 },
};

const NOISE = /* glsl */ `
  float fHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float fNoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( fHash( i ), fHash( i + vec2( 1, 0 ) ), u.x ), mix( fHash( i + vec2( 0, 1 ) ), fHash( i + 1.0 ), u.x ), u.y );
  }
  float fFbm( vec2 p ) {
    float s = 0.0, a = 0.5;
    for ( int i = 0; i < 4; i++ ) { s += a * fNoise( p ); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }`;

// ------------------------------------------------------------------ alanga
const flameVertex = /* glsl */ `
  uniform vec2 uScale;
  uniform vec2 uWind;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 c = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    // Silindrik billboard: faqat Y o'qi atrofida kameraga buriladi
    vec3 toCam = cameraPosition - c; toCam.y = 0.0;
    vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), normalize( toCam + vec3( 1e-4, 0.0, 0.0 ) ) ) );
    float h = uv.y;
    vec3 p = c + right * ( uv.x - 0.5 ) * uScale.x + vec3( 0.0, h * uScale.y, 0.0 );
    p.xz += uWind * h * h * uScale.y * 0.35;
    gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
  }`;

const flameFragment = /* glsl */ `
  uniform float uTime, uSeed, uFire, uHot;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float y = vUv.y;
    float t = uTime + uSeed * 13.0;
    float n = fFbm( vec2( vUv.x * 3.0 + uSeed * 7.0, y * 2.3 - t * 2.4 ) );
    float n2 = fFbm( vec2( vUv.x * 6.5 - uSeed * 3.0, y * 5.2 - t * 4.3 ) );
    // Alanga tilchalari: markazdan og'ish shovqin bilan, yuqoriga qarab ko'payadi
    float x = vUv.x - 0.5 + ( n - 0.5 ) * 0.38 * y + ( n2 - 0.5 ) * 0.14 * y;
    float width = mix( 0.34, 0.015, pow( y, 0.85 ) );
    float body = 1.0 - smoothstep( width * 0.2, width, abs( x ) );
    float d = body * smoothstep( 0.0, 0.14, y ) * ( 1.0 - y * 0.7 );
    d *= 0.5 + 0.95 * n;
    d = clamp( d - y * 0.3 * ( 1.0 - n2 ) + uHot * 0.12 * ( 1.0 - y ), 0.0, 1.0 );
    // Rang: to'q qizil -> to'q sariq -> sariq -> deyarli oq (eng issiq yadro)
    vec3 col = mix( vec3( 0.45, 0.04, 0.0 ), vec3( 1.0, 0.36, 0.05 ), smoothstep( 0.08, 0.42, d ) );
    col = mix( col, vec3( 1.0, 0.72, 0.32 ), smoothstep( 0.42, 0.75, d ) );
    col = mix( col, vec3( 1.0, 0.95, 0.8 ), smoothstep( 0.78, 1.0, d ) );
    float a = smoothstep( 0.02, 0.32, d );
    gl_FragColor = vec4( col * a * ( 2.2 + uHot ) * uFire, 1.0 );
  }`;

function Flames() {
  const items = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, 0.5, 0);
    // Asosiy alanga + atrofda kichikroq tilchalar
    const defs: { p: Vec3; s: [number, number]; seed: number; hot: number }[] = [
      { p: [0, 0.08, 0], s: [1.05, 1.65], seed: 0.1, hot: 1 },
      { p: [0.16, 0.06, 0.05], s: [0.6, 1.1], seed: 0.37, hot: 0.4 },
      { p: [-0.15, 0.06, -0.08], s: [0.62, 1.2], seed: 0.71, hot: 0.4 },
      { p: [0.02, 0.05, -0.18], s: [0.5, 0.9], seed: 0.93, hot: 0.2 },
      { p: [-0.05, 0.05, 0.17], s: [0.48, 0.85], seed: 0.55, hot: 0.2 },
    ];
    return defs.map((d, i) => {
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: fireUniforms.uTime,
          uWind: fireUniforms.uWind,
          uFire: fireUniforms.uFire,
          uScale: { value: new THREE.Vector2(...d.s) },
          uSeed: { value: d.seed },
          uHot: { value: d.hot },
        },
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...d.p);
      mesh.frustumCulled = false;
      mesh.renderOrder = 3 + i;
      return mesh;
    });
  }, []);
  useEffect(() => () => items.forEach((m) => (m.material as THREE.Material).dispose()), [items]);
  return (
    <>
      {items.map((m) => (
        <primitive key={m.uuid} object={m} />
      ))}
    </>
  );
}

// ------------------------------------------------------------------ uchqunlar
const emberVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime, uPx;
  uniform vec2 uWind;
  varying float vLife;
  varying float vFlick;
  void main() {
    float s = aSeed;
    float life = fract( uTime * ( 0.16 + fract( s * 13.7 ) * 0.22 ) + s );
    float rise = life * ( 2.0 + fract( s * 7.3 ) * 3.2 );
    vec3 p = position;
    p.y += 0.35 + rise;
    p.x += sin( uTime * 2.1 + s * 40.0 ) * 0.14 * life + uWind.x * rise * 0.6;
    p.z += cos( uTime * 1.7 + s * 31.0 ) * 0.14 * life + uWind.y * rise * 0.6;
    vec4 mv = modelViewMatrix * vec4( p, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max( uPx * ( 0.016 + 0.018 * fract( s * 3.1 ) ) / -mv.z, 1.5 );
    vLife = life;
    vFlick = 0.55 + 0.45 * sin( uTime * ( 14.0 + 10.0 * fract( s * 5.3 ) ) + s * 100.0 );
  }`;

const emberFragment = /* glsl */ `
  uniform float uFire;
  varying float vLife;
  varying float vFlick;
  void main() {
    float r = length( gl_PointCoord - 0.5 );
    float a = smoothstep( 0.5, 0.0, r );
    vec3 col = mix( vec3( 1.0, 0.82, 0.4 ), vec3( 1.0, 0.22, 0.02 ), vLife );
    float fade = ( 1.0 - vLife ) * smoothstep( 0.0, 0.06, vLife );
    gl_FragColor = vec4( col * a * fade * vFlick * 3.0 * uFire, 1.0 );
  }`;

function Embers({ count }: { count: number }) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.35;
      pos.set([Math.cos(a) * r, 0, Math.sin(a) * r], i * 3);
      seed[i] = Math.random();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: fireUniforms.uTime, uWind: fireUniforms.uWind, uFire: fireUniforms.uFire, uPx: { value: 500 } },
      vertexShader: emberVertex,
      fragmentShader: emberFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    p.renderOrder = 10;
    return p;
  }, [count]);
  useEffect(() => () => {
    points.geometry.dispose();
    (points.material as THREE.Material).dispose();
  }, [points]);
  useEffect(() => {
    // Nuqta o'lchami piksellarda: dunyo o'lchami * (ekran balandligi / 2) / tan(fov / 2) / masofa
    (points.material as THREE.ShaderMaterial).uniforms.uPx.value =
      (size.height * gl.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }, [points, size, camera.fov, gl]);
  return <primitive object={points} />;
}

// ------------------------------------------------------------------ tutun
const smokeVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform vec2 uWind;
  varying vec2 vUv;
  varying float vLife;
  varying float vSeed;
  void main() {
    float s = aSeed;
    float life = fract( uTime * 0.075 + s );
    float rise = 1.0 + life * 6.0;
    // Shamol tutunni yuqoriga chiqqan sari ko'proq og'diradi, har bulut o'z yo'lidan tarqaladi
    vec3 c = vec3( uWind.x, 0.0, uWind.y ) * life * life * 14.0;
    c += vec3( sin( s * 50.0 + uTime * 0.3 ), 0.0, cos( s * 37.0 + uTime * 0.25 ) ) * ( 0.25 + 1.4 * life ) * life;
    c.y = rise;
    float size = 0.7 + life * 4.5;
    float ang = s * 6.28 + life * ( fract( s * 9.1 ) - 0.5 ) * 2.0;
    vec2 q = ( uv - 0.5 ) * size;
    q = mat2( cos( ang ), sin( ang ), -sin( ang ), cos( ang ) ) * q;
    // Sferik billboard: kamera o'ng va yuqori yo'nalishlari bo'yicha
    vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
    vec3 wp = ( modelMatrix * vec4( c, 1.0 ) ).xyz + right * q.x + up * q.y;
    gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
    vUv = uv;
    vLife = life;
    vSeed = s;
  }`;

const smokeFragment = /* glsl */ `
  uniform float uTime, uFire;
  varying vec2 vUv;
  varying float vLife;
  varying float vSeed;
  ${NOISE}
  void main() {
    vec2 p = vUv - 0.5;
    float r = length( p ) * 2.0;
    float n = fFbm( vUv * 2.6 + vSeed * 31.0 + vec2( 0.0, -uTime * 0.05 ) );
    float mask = smoothstep( 1.0, 0.25, r + ( n - 0.5 ) * 0.7 );
    float alpha = mask * smoothstep( 0.0, 0.12, vLife ) * pow( 1.0 - vLife, 1.6 ) * 0.13;
    // Pastda olovdan iliq yoritilgan, yuqorida sovuq kulrang
    vec3 col = mix( vec3( 0.32, 0.17, 0.08 ) * ( 0.7 + 0.3 * uFire ), vec3( 0.045, 0.048, 0.055 ), smoothstep( 0.0, 0.3, vLife ) );
    gl_FragColor = vec4( col * ( 0.7 + 0.5 * n ), alpha );
  }`;

function Smoke({ count }: { count: number }) {
  const mesh = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = i / count + Math.random() * 0.03;
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: fireUniforms.uTime, uWind: fireUniforms.uWind, uFire: fireUniforms.uFire },
      vertexShader: smokeVertex,
      fragmentShader: smokeFragment,
      transparent: true,
      depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    return m;
  }, [count]);
  useEffect(() => () => {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }, [mesh]);
  return <primitive object={mesh} />;
}

// ------------------------------------------------------------------ cho'g' (ko'mir materiali uchun)
/**
 * Ko'mir/o'tin uchlari: olov markaziga yaqin joylarda qizarib "nafas oladi" (emissive shovqin).
 * Gulxan koordinata boshida deb olinadi (forest_camp.py).
 */
export function applyEmberGlow(mat: THREE.MeshStandardMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = fireUniforms.uTime;
    shader.uniforms.uFire = fireUniforms.uFire;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEmb;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvEmb = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime, uFire;
        varying vec3 vEmb;
        ${NOISE}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        {
          float heat = 1.0 - smoothstep( 0.22, 0.72, length( vEmb.xz ) );
          heat *= 1.0 - smoothstep( 0.35, 0.75, vEmb.y );
          float n = fNoise( vEmb.xz * 11.0 + vEmb.y * 7.0 + vec2( uTime * 0.35, -uTime * 0.2 ) );
          float cracks = smoothstep( 0.45, 0.85, n );
          float pulse = 0.65 + 0.35 * sin( uTime * 1.3 + n * 9.0 );
          totalEmissiveRadiance += vec3( 1.0, 0.25, 0.04 ) * heat * cracks * pulse * 2.4 * uFire;
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'ember-v1';
  mat.needsUpdate = true;
}

// ------------------------------------------------------------------ nur
/** Silliq 1D shovqin (miltillash uchun) */
function noise1(t: number) {
  const i = Math.floor(t), f = t - i;
  const h = (n: number) => {
    const x = Math.sin(n * 127.1) * 43758.5453;
    return x - Math.floor(x);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

function FireLight() {
  const quality = useGame((s) => s.quality);
  const light = useRef<THREE.PointLight>(null);
  useEffect(() => {
    const l = light.current;
    if (!l) return;
    const shadows = quality !== 'low';
    l.castShadow = shadows;
    if (shadows) {
      const size = quality === 'high' ? 1024 : 512;
      l.shadow.mapSize.set(size, size);
      l.shadow.camera.near = 0.15;
      l.shadow.camera.far = 16;
      l.shadow.bias = -0.0015;
      l.shadow.normalBias = 0.03;
      l.shadow.radius = 3;
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
  }, [quality]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    // Bir necha chastotadagi shovqin: sekin "nafas" + tez titrash
    const f = 0.78 + 0.16 * noise1(t * 1.3) + 0.1 * noise1(t * 5.1 + 10) + 0.06 * noise1(t * 13.7 + 20);
    fireUniforms.uFire.value = f;
    hallUniforms.uHouse.value = f;
    hallUniforms.uScreenColor.value.setRGB(0, 0, 0);
    const l = light.current;
    if (!l) return;
    l.intensity = 17 * f;
    // Alanga tilchalari bilan nur manbai ham biroz siljiydi - soyalar "tirik"
    l.position.set((noise1(t * 2.3) - 0.5) * 0.08, 1.05 + (noise1(t * 3.1 + 5) - 0.5) * 0.1, (noise1(t * 2.7 + 9) - 0.5) * 0.08);
    l.color.setRGB(1, 0.5 + 0.06 * f, 0.2 + 0.04 * f);
  });
  return <pointLight ref={light} position={[0, 1.05, 0]} distance={32} decay={2} />;
}

function FireSound({ position }: { position: Vec3 }) {
  useEffect(() => startFireSound(position[0], position[1] + 0.5, position[2]), [position]);
  return null;
}

export function Fire({ position }: { position: Vec3 }) {
  const quality = useGame((s) => s.quality);
  useFrame((_, dt) => {
    fireUniforms.uTime.value += Math.min(dt, 0.1);
    const t = fireUniforms.uTime.value;
    // Shamol: asosiy yo'nalish + sekin o'zgaruvchan shabada
    fireUniforms.uWind.value.set(0.2 + 0.12 * Math.sin(t * 0.31) + 0.05 * Math.sin(t * 1.7), -0.07 + 0.06 * Math.sin(t * 0.23 + 1));
  });
  return (
    <group position={position}>
      <Flames />
      <Embers count={quality === 'low' ? 40 : 90} />
      <Smoke count={quality === 'low' ? 8 : 14} />
      <FireLight />
      <FireSound position={position} />
    </group>
  );
}
