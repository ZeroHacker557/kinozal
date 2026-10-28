import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useGame } from '../../state/store';
import { MOON_DIR } from './Sky';
import type { TerrainData } from './terrainData';
import { startNatureSounds, type NatureSounds } from '../../audio/natureSounds';
import { avatarEnv } from '../../avatar/assets';

/**
 * Tungi atmosfera: osmon gumbazi (ufq - to'q ko'k, tepasi - qora, oy atrofi yorug'roq), suzuvchi bulutlar
 * (oy yonida kumush chetli), past tuman bo'laklari, oy nuri va o'yinchi atrofidagi oy soyalari.
 * Tuman rangi ufq rangi bilan bir xil - uzoqdagi relyef osmonga silliq qo'shiladi.
 */

/** Chiziqli rangda: ufq va tepa (tuman ham shu ufq rangi) */
export const HORIZON = new THREE.Color().setRGB(0.03, 0.044, 0.075);
const ZENITH = new THREE.Color().setRGB(0.004, 0.006, 0.014);
export const FOG_DENSITY = 0.0048;

const NOISE = /* glsl */ `
  float aHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float aNoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( aHash( i ), aHash( i + vec2( 1, 0 ) ), u.x ), mix( aHash( i + vec2( 0, 1 ) ), aHash( i + 1.0 ), u.x ), u.y );
  }
  float aFbm( vec2 p ) {
    float s = 0.0, a = 0.5;
    for ( int i = 0; i < 5; i++ ) { s += a * aNoise( p ); p = p * 2.07 + 13.1; a *= 0.5; }
    return s;
  }`;

const domeVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

const skyFragment = /* glsl */ `
  uniform vec3 uMoon, uHorizon, uZenith;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize( vDir );
    float h = clamp( d.y, -0.3, 1.0 );
    vec3 col = mix( uHorizon, uZenith, pow( smoothstep( -0.02, 0.65, h ), 0.55 ) );
    float md = max( dot( d, uMoon ), 0.0 );
    // Oy atrofidagi osmon yorishishi (keng va yumshoq)
    col += vec3( 0.05, 0.065, 0.1 ) * pow( md, 6.0 ) + vec3( 0.015, 0.02, 0.03 ) * pow( md, 2.0 );
    gl_FragColor = vec4( col, 1.0 );
  }`;

const cloudFragment = /* glsl */ `
  uniform vec3 uMoon;
  uniform float uTime;
  varying vec3 vDir;
  ${NOISE}
  void main() {
    vec3 d = normalize( vDir );
    if ( d.y < 0.01 ) discard;
    // Bulutlar tekis qatlam sifatida: ufqqa qarab siqiladi
    vec2 uv = d.xz / ( d.y + 0.1 ) * 1.4 + uTime * vec2( 0.0045, 0.0018 );
    float n = aFbm( uv ) + 0.18 * aFbm( uv * 3.1 - uTime * 0.006 );
    float cover = smoothstep( 0.52, 0.86, n ) * smoothstep( 0.01, 0.2, d.y );
    if ( cover < 0.004 ) discard;
    float md = max( dot( d, uMoon ), 0.0 );
    // Yupqa chetlar oy nurini o'tkazadi (kumush chet), qalin qismi qorong'i
    float thin = 1.0 - smoothstep( 0.55, 0.8, n );
    vec3 base = vec3( 0.007, 0.009, 0.014 );
    vec3 lit = vec3( 0.15, 0.17, 0.22 ) * ( pow( md, 10.0 ) * 1.4 + pow( md, 3.0 ) * 0.18 + 0.025 ) * ( 0.3 + thin );
    gl_FragColor = vec4( base + lit, cover * 0.94 );
  }`;

export function SkyDome() {
  const { dome, clouds, cloudMat } = useMemo(() => {
    const geo = new THREE.SphereGeometry(2300, 48, 24);
    const dome = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uMoon: { value: MOON_DIR }, uHorizon: { value: HORIZON }, uZenith: { value: ZENITH } },
        vertexShader: domeVertex,
        fragmentShader: skyFragment,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: { uMoon: { value: MOON_DIR }, uTime: { value: 0 } },
      vertexShader: domeVertex,
      fragmentShader: cloudFragment,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    // Bulutlar yulduzlar va oydan keyin chiziladi - ularni yopadi
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(2150, 48, 24), cloudMat);
    clouds.renderOrder = -1;
    clouds.frustumCulled = false;
    return { dome, clouds, cloudMat };
  }, []);
  useEffect(
    () => () => {
      for (const m of [dome, clouds]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    },
    [dome, clouds],
  );
  useFrame(({ camera, clock }) => {
    dome.position.copy(camera.position);
    clouds.position.copy(camera.position);
    cloudMat.uniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <>
      <primitive object={dome} />
      <primitive object={clouds} />
    </>
  );
}

// ------------------------------------------------------------------ oy nuri va soyalari
/**
 * Oy nuri: soya kamerasi o'yinchiga ergashadi (atrofdagi R metr), siljiganda soyalar "titramasligi"
 * uchun markaz soya xaritasi pikseliga qotiriladi.
 */
export function MoonLight() {
  const quality = useGame((s) => s.quality);
  const light = useRef<THREE.DirectionalLight>(null);
  const cfg = quality === 'low' ? null : quality === 'high' ? { size: 2048, r: 50 } : { size: 1024, r: 36 };
  const tmp = useMemo(() => {
    const rot = new THREE.Matrix4().lookAt(MOON_DIR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0));
    return { rot, inv: rot.clone().invert(), p: new THREE.Vector3() };
  }, []);

  useEffect(() => {
    const l = light.current;
    if (!l) return;
    l.castShadow = !!cfg;
    if (cfg) {
      l.shadow.mapSize.set(cfg.size, cfg.size);
      const c = l.shadow.camera;
      c.left = c.bottom = -cfg.r;
      c.right = c.top = cfg.r;
      c.near = 1;
      c.far = 700;
      c.updateProjectionMatrix();
      l.shadow.bias = -0.0006;
      l.shadow.normalBias = 0.05;
      l.shadow.map?.dispose();
      l.shadow.map = null;
    }
  }, [cfg?.size, cfg?.r]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ camera }) => {
    const l = light.current;
    if (!l) return;
    // Yorug'lik fazosida markazni piksel to'riga qotirish
    tmp.p.copy(camera.position).applyMatrix4(tmp.inv);
    if (cfg) {
      const texel = (2 * cfg.r) / cfg.size;
      tmp.p.x = Math.round(tmp.p.x / texel) * texel;
      tmp.p.y = Math.round(tmp.p.y / texel) * texel;
    }
    tmp.p.applyMatrix4(tmp.rot);
    l.target.position.copy(tmp.p);
    l.target.updateMatrixWorld();
    l.position.copy(tmp.p).addScaledVector(MOON_DIR, 350);
  });

  return <directionalLight ref={light} color="#9db3ea" intensity={1.25} />;
}

// ------------------------------------------------------------------ past tuman
const mistVertex = /* glsl */ `
  attribute vec4 aPos; // x, y, z, o'lcham
  attribute float aSeed;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  void main() {
    vec3 c = aPos.xyz;
    vec3 toCam = cameraPosition - c; toCam.y = 0.0;
    float dist = length( toCam );
    vec3 right = normalize( cross( vec3( 0.0, 1.0, 0.0 ), toCam / max( dist, 1e-3 ) ) );
    vec3 p = c + right * ( uv.x - 0.5 ) * aPos.w + vec3( 0.0, ( uv.y - 0.15 ) * aPos.w * 0.28, 0.0 );
    gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );
    vUv = uv;
    vSeed = aSeed;
    // Juda yaqinda (kamera tuman ichida) va uzoqda yo'qoladi
    vFade = smoothstep( 4.0, 14.0, dist ) * ( 1.0 - smoothstep( 45.0, 62.0, dist ) );
  }`;

const mistFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vSeed;
  varying float vFade;
  ${NOISE}
  void main() {
    vec2 q = vUv - vec2( 0.5, 0.35 );
    float r = length( q * vec2( 1.0, 2.2 ) ) * 2.0;
    float n = aFbm( vUv * vec2( 3.0, 1.2 ) + vec2( uTime * 0.02 + vSeed * 9.0, vSeed * 3.0 ) );
    float a = smoothstep( 1.0, 0.2, r + ( n - 0.5 ) * 0.9 ) * smoothstep( 0.0, 0.25, vUv.y );
    gl_FragColor = vec4( uColor, a * 0.11 * vFade );
  }`;

export function Mist({ terrain, count = 26 }: { terrain: TerrainData; count?: number }) {
  const quality = useGame((s) => s.quality);
  const n = quality === 'low' ? Math.round(count * 0.5) : count;
  const { mesh, pos, seeds } = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    pos.setUsage(THREE.DynamicDrawUsage);
    const seed = new Float32Array(n);
    const seeds: { x: number; z: number; s: number; drift: number }[] = [];
    for (let i = 0; i < n; i++) {
      seed[i] = Math.random();
      seeds.push({ x: Math.random() * 120, z: Math.random() * 120, s: 12 + Math.random() * 12, drift: 0.2 + Math.random() * 0.3 });
    }
    geo.setAttribute('aPos', pos);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color().setRGB(0.07, 0.085, 0.115) } },
      vertexShader: mistVertex,
      fragmentShader: mistFragment,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    return { mesh, pos, seeds };
  }, [n]);
  useEffect(
    () => () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    },
    [mesh],
  );

  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    (mesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
    const a = pos.array as Float32Array;
    const T = 120;
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i];
      // Kamera atrofida 120 m katakda takrorlanadi va shamol bilan sekin suriladi
      const sx = s.x + t * s.drift, sz = s.z + t * s.drift * 0.4;
      const x = camera.position.x + ((((sx - camera.position.x) % T) + T * 1.5) % T) - T / 2;
      const z = camera.position.z + ((((sz - camera.position.z) % T) + T * 1.5) % T) - T / 2;
      a[i * 4] = x;
      a[i * 4 + 1] = terrain.heightAt(x, z) + 0.2;
      a[i * 4 + 2] = z;
      a[i * 4 + 3] = s.s;
    }
    pos.needsUpdate = true;
  });

  return <primitive object={mesh} />;
}

// ------------------------------------------------------------------ tabiat ovozlari
/** Shamol, chigirtkalar, boyqush, bo'ri, soy - tinglovchi (kamera) atrofida */
export function NatureAudio({ terrain }: { terrain: TerrainData }) {
  const ref = useRef<NatureSounds | null>(null);
  const tmp = useMemo(() => ({ frame: 0, stream: null as { x: number; y: number; z: number } | null }), []);
  useEffect(() => {
    const s = startNatureSounds();
    ref.current = s;
    return () => {
      s.stop();
      ref.current = null;
    };
  }, []);
  useFrame(({ camera }) => {
    const s = ref.current;
    if (!s) return;
    // Eng yaqin soy nuqtasi (har 10 kadrda)
    if (tmp.frame++ % 10 === 0) {
      let best = Infinity, bp: [number, number, number] | null = null;
      for (const p of terrain.meta.stream.points) {
        const d = (p[0] - camera.position.x) ** 2 + (p[1] - camera.position.z) ** 2;
        if (d < best) (best = d), (bp = p);
      }
      tmp.stream = bp && best < 70 * 70 ? { x: bp[0], y: bp[2], z: bp[1] } : null;
    }
    const nearCamp = Math.hypot(camera.position.x, camera.position.z) < 26;
    s.update(camera.position, tmp.stream, nearCamp);
  });
  return null;
}

// ------------------------------------------------------------------ zirh aksi uchun muhit
/**
 * Ritsar zirhida aks etadigan osmon: qorong'i gradient va yorug' oy (PMREM). Faqat avatar
 * materiallariga beriladi - qolgan sahna o'z yoritilishida qoladi.
 */
export function KnightEnv() {
  const gl = useThree((s) => s.gl);
  useMemo(() => {
    const scene = new THREE.Scene();
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        uniforms: { uMoon: { value: MOON_DIR } },
        vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
        fragmentShader: /* glsl */ `
          uniform vec3 uMoon;
          varying vec3 vD;
          void main() {
            vec3 d = normalize( vD );
            vec3 c = mix( vec3( 0.03, 0.04, 0.06 ), vec3( 0.006, 0.008, 0.014 ), smoothstep( 0.0, 0.7, d.y ) );
            c = mix( c, vec3( 0.012, 0.012, 0.01 ), smoothstep( 0.0, -0.3, d.y ) );
            float m = max( dot( d, uMoon ), 0.0 );
            c += vec3( 0.9, 0.95, 1.1 ) * smoothstep( 0.9975, 0.999, m ) * 6.0 + vec3( 0.08, 0.1, 0.14 ) * pow( m, 30.0 );
            gl_FragColor = vec4( c, 1.0 );
          }`,
      }),
    );
    scene.add(sky);
    const pmrem = new THREE.PMREMGenerator(gl);
    const rt = pmrem.fromScene(scene, 0);
    avatarEnv.map?.dispose();
    avatarEnv.map = rt.texture;
    pmrem.dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
  }, [gl]);
  useEffect(
    () => () => {
      avatarEnv.map?.dispose();
      avatarEnv.map = null;
    },
    [],
  );
  return null;
}
