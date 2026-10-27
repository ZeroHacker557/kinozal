import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { TerrainMeta } from './terrainData';

const uTime = { value: 0 };

/**
 * Soy suvi: o'zan bo'ylab lenta. Qora, silliq yuza - oy nurini aks ettiradi; yuzadagi mayda
 * to'lqinlar oqim yo'nalishida siljiydi (normal shovqin bilan).
 */
export function Water({ stream }: { stream: TerrainMeta['stream'] }) {
  const geometry = useMemo(() => {
    const pts = stream.points;
    const w = stream.width / 2;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    let along = 0;
    for (let k = 0; k < pts.length; k++) {
      const [x, z, y] = pts[k];
      const [x1, z1] = pts[Math.max(k - 1, 0)];
      const [x2, z2] = pts[Math.min(k + 1, pts.length - 1)];
      const dx = x2 - x1, dz = z2 - z1, ln = Math.hypot(dx, dz) || 1;
      const nx = -dz / ln, nz = dx / ln;
      if (k > 0) along += Math.hypot(x - pts[k - 1][0], z - pts[k - 1][1]);
      pos.push(x + nx * w, y, z + nz * w, x - nx * w, y, z - nz * w);
      uv.push(along, 0, along, 1);
      if (k > 0) {
        const a = (k - 1) * 2;
        idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Yuqoriga qaragan bo'lishi shart (lentaning aylanish yo'nalishiga bog'liq emas)
    const n = g.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    return g;
  }, [stream]);

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#05080a', roughness: 0.06, metalness: 0, side: THREE.DoubleSide });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vWUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvWUv = uv;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uTime;
          varying vec2 vWUv;
          float wHash( vec2 p ) { return fract( sin( dot( p, vec2( 41.3, 289.1 ) ) ) * 15731.743 ); }
          float wNoise( vec2 p ) {
            vec2 i = floor( p ), f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
            return mix( mix( wHash( i ), wHash( i + vec2( 1, 0 ) ), u.x ), mix( wHash( i + vec2( 0, 1 ) ), wHash( i + 1.0 ), u.x ), u.y );
          }
          float wHeight( vec2 p ) {
            vec2 q = vec2( p.x * 0.9 - uTime * 0.55, p.y * 3.2 );
            return wNoise( q * 1.3 ) * 0.6 + wNoise( q * 3.1 + 7.0 ) * 0.3 + wNoise( q * 7.7 - 3.0 ) * 0.1;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          /* glsl */ `{
            float e = 0.05;
            float h0 = wHeight( vWUv );
            vec3 nw = normalize( vec3( -( wHeight( vWUv + vec2( e, 0 ) ) - h0 ) * 1.6, 1.0, -( wHeight( vWUv + vec2( 0, e ) ) - h0 ) * 1.6 ) );
            normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );
          }`,
        );
    };
    m.customProgramCacheKey = () => 'forest-water-v1';
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useFrame((_, dt) => {
    uTime.value += Math.min(dt, 0.1);
  });

  return <mesh geometry={geometry} material={material} receiveShadow />;
}
