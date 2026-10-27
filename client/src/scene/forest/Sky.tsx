import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useLoader } from '@react-three/fiber';

/**
 * Tungi osmon: haqiqiy Oy (NASA SVS CGI Moon Kit - LRO rangli mozaikasi va LOLA relyefi, public domain)
 * va yulduzlar. Oy Lommel-Seeliger modeli bilan yoritiladi (haqiqiy Oy diski chetga qarab qoraymaydi),
 * yoritilgan qism chegarasida kraterlar relyefi ko'rinadi; atrofida yengil nur halqasi.
 * Hammasi kamera bilan birga siljiydi (cheksiz uzoqda).
 */

/** Oyga yo'nalish (gulxan maydonidan qasr ustida) */
export const MOON_DIR = new THREE.Vector3(-0.3, 0.42, -0.86).normalize();
const MOON_DIST = 1900;
/** Burchak o'lchami ~2.6 gradus (haqiqiysi 0.52 - o'yinlarda sezilishi uchun kattalashtirilgan) */
const MOON_R = MOON_DIST * Math.tan(THREE.MathUtils.degToRad(1.3));
/** Faza: o'suvchi deyarli to'lin oy (quyosh yo'nalishi kuzatuvchidan ~32 gradus burilgan) */
const PHASE = THREE.MathUtils.degToRad(32);

const moonVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vN = normalize( mat3( modelMatrix ) * normal );
    // Uzunlik bo'ylab urinma (u o'sadigan tomon)
    vT = normalize( mat3( modelMatrix ) * vec3( normal.z, 0.0, -normal.x ) + 1e-5 );
    vec4 wp = modelMatrix * vec4( position, 1.0 );
    vView = normalize( cameraPosition - wp.xyz );
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const moonFragment = /* glsl */ `
  uniform sampler2D uMap, uNormal;
  uniform vec3 uSun;
  uniform float uBright;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vT;
  varying vec3 vView;
  void main() {
    vec3 n = normalize( vN );
    vec3 t = normalize( vT - n * dot( vT, n ) );
    vec3 b = cross( n, t );
    vec3 nm = texture2D( uNormal, vUv ).xyz * 2.0 - 1.0;
    vec3 N = normalize( t * nm.x + b * nm.y + n * nm.z );
    float mu0 = max( dot( N, uSun ), 0.0 );
    float mu = max( dot( n, vView ), 0.05 );
    // Lommel-Seeliger: Oy regolitining yoritilishi (disk chetida qoraymaydi)
    float ls = mu0 / ( mu0 + mu );
    vec3 albedo = texture2D( uMap, vUv ).rgb;
    vec3 col = albedo * ( ls * 2.0 * uBright ) + albedo * 0.015; // + yer nuri (earthshine)
    gl_FragColor = vec4( col, 1.0 );
    #include <colorspace_fragment>
  }`;

const haloFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float r = length( vUv - 0.5 ) * 2.0;
    // Havodagi tarqalish: oy yonida kichik, xira halqa (katta yorug' disk ignalar orasidan "qor"dek ko'rinadi)
    float a = exp( -r * 8.0 ) * 0.28 + exp( -r * 3.0 ) * 0.035;
    a *= smoothstep( 1.0, 0.6, r );
    gl_FragColor = vec4( uColor * a, 1.0 );
  }`;

const starVertex = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime, uPx;
  varying float vB;
  void main() {
    vec4 mv = modelViewMatrix * vec4( position, 1.0 );
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max( aSize * uPx, 1.0 );
    // Yengil miltillash, ufqqa yaqin yulduzlar xiraroq (havo qatlami)
    float tw = 0.75 + 0.25 * sin( uTime * ( 1.5 + fract( aSeed * 7.1 ) * 3.0 ) + aSeed * 50.0 );
    vB = tw * smoothstep( -0.02, 0.25, normalize( position ).y ) * ( 0.25 + 0.75 * fract( aSeed * 3.7 ) );
  }`;

const starFragment = /* glsl */ `
  varying float vB;
  void main() {
    float r = length( gl_PointCoord - 0.5 );
    float a = smoothstep( 0.5, 0.0, r );
    gl_FragColor = vec4( vec3( 0.85, 0.9, 1.0 ) * a * vB * 1.4, 1.0 );
  }`;

export function Sky() {
  const [map, nrm] = useLoader(THREE.TextureLoader, ['/maps/forest/textures/moon_color.jpg', '/maps/forest/textures/moon_normal.jpg']);

  const { group, moon, stars, starMat } = useMemo(() => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    nrm.colorSpace = THREE.NoColorSpace;
    for (const t of [map, nrm]) {
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
    }
    const group = new THREE.Group();

    // Oy
    const toObserver = MOON_DIR.clone().negate();
    const sun = toObserver.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), PHASE).normalize();
    const moonMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uNormal: { value: nrm }, uSun: { value: sun }, uBright: { value: 1.0 } },
      vertexShader: moonVertex,
      fragmentShader: moonFragment,
      fog: false,
      depthWrite: false,
    });
    const moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 96, 48), moonMat);
    moon.position.copy(MOON_DIR).multiplyScalar(MOON_DIST);
    moon.lookAt(0, 0, 0);
    moon.rotateY(-Math.PI / 2); // ko'rinadigan tomoni (u = 0.5, Yerga qaragan yarim shar) kuzatuvchiga
    moon.renderOrder = -1;
    group.add(moon);

    // Nur halqasi (havodagi tarqalish)
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(MOON_R * 5, MOON_R * 5),
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0.55, 0.62, 0.8) } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
        fragmentShader: haloFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    halo.position.copy(MOON_DIR).multiplyScalar(MOON_DIST + MOON_R * 2);
    halo.lookAt(0, 0, 0);
    halo.renderOrder = -2;
    group.add(halo);

    // Yulduzlar
    const N = 3200;
    const pos = new Float32Array(N * 3), size = new Float32Array(N), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const d = new THREE.Vector3(r * Math.cos(a), Math.abs(u) * 0.95 + 0.02, r * Math.sin(a)).normalize();
      // Oy yonida yulduzlar ko'rinmaydi (yorug')
      if (d.dot(MOON_DIR) > 0.985) {
        i--;
        continue;
      }
      pos.set(d.multiplyScalar(2200).toArray(), i * 3);
      size[i] = Math.random() < 0.04 ? 2.6 : 0.7 + Math.random() * 1.1;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const starMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
      vertexShader: starVertex,
      fragmentShader: starFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const stars = new THREE.Points(geo, starMat);
    stars.renderOrder = -3;
    stars.frustumCulled = false;
    group.add(stars);
    return { group, moon, stars, starMat };
  }, [map, nrm]);

  useEffect(
    () => () => {
      moon.geometry.dispose();
      (moon.material as THREE.Material).dispose();
      stars.geometry.dispose();
      starMat.dispose();
    },
    [moon, stars, starMat],
  );

  useFrame(({ camera, clock, gl }) => {
    // Osmon kamera bilan siljiydi - yurganda oy "ergashadi" (cheksiz uzoqlik)
    group.position.copy(camera.position);
    starMat.uniforms.uTime.value = clock.elapsedTime;
    // Zoom qilinganda yulduzlar ham biroz kattalashadi
    const cam = camera as THREE.PerspectiveCamera;
    starMat.uniforms.uPx.value = Math.min(2.2, 72 / cam.fov) ** 0.5 * gl.getPixelRatio();
  });

  return <primitive object={group} />;
}
