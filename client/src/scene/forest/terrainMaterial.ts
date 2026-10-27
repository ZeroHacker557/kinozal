import * as THREE from 'three';

/**
 * Relyef materiali: splat xaritasi bo'yicha 4 qatlam (o'tloq, o'rmon tagi, yo'l/loy, qoya) aralashadi.
 * - teksturalar dunyo koordinatasi (xz) bo'yicha takrorlanadi; takrorlanish ko'rinmasligi uchun
 *   hududlarga tasodifiy siljish beriladi va ikki namuna silliq aralashtiriladi (I. Quilez, "texture no tile");
 *   uzoqda qatlam o'rtacha rangiga o'tadi - qiya qarashda ham chiziq paydo bo'lmaydi;
 * - qatlamlar chegarasi "balandlik" bo'yicha keskinlashtiriladi (tosh orasidan o't chiqqandek);
 * - normal xaritalar dunyo fazosida qo'llanadi (UV yo'q, tangent xz tekisligidan).
 * Splat: R o'tloq, G yo'l/loy, B qoya; o'rmon tagi = 1 - R - G - B.
 */
export interface TerrainTextures {
  splat: THREE.Texture;
  diffuse: THREE.Texture[];
  normal: THREE.Texture[];
}

/** Qatlam takrorlanish o'lchami (metr): o'tloq, o'rmon tagi, yo'l, qoya */
const TILE = new THREE.Vector4(3.2, 3.6, 2.8, 7.0);
/** Qatlamlar g'adir-budurligi (nam loy oy nurida biroz yaltiraydi) */
const ROUGH = new THREE.Vector4(0.96, 0.93, 0.78, 0.88);

export function createTerrainMaterial(tex: TerrainTextures, size: number, detail: boolean) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (shader) => {
    mat.userData.shader = shader; // dev: uniformlarni jonli sozlash uchun
    Object.assign(shader.uniforms, {
      tSplat: { value: tex.splat },
      tD0: { value: tex.diffuse[0] }, tD1: { value: tex.diffuse[1] }, tD2: { value: tex.diffuse[2] }, tD3: { value: tex.diffuse[3] },
      tN0: { value: tex.normal[0] }, tN1: { value: tex.normal[1] }, tN2: { value: tex.normal[2] }, tN3: { value: tex.normal[3] },
      uTile: { value: TILE },
      uRough: { value: ROUGH },
      uSize: { value: size },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTPos;\nvarying vec3 vTNor;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vTPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
        vTNor = normalize( mat3( modelMatrix ) * objectNormal );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        ${detail ? '#define TERRAIN_DETAIL' : ''}
        varying vec3 vTPos;
        varying vec3 vTNor;
        uniform sampler2D tSplat;
        uniform sampler2D tD0, tD1, tD2, tD3, tN0, tN1, tN2, tN3;
        uniform vec4 uTile, uRough;
        uniform float uSize;
        vec4 tW;          // qatlam og'irliklari (keskinlashtirilgan)
        vec2 tUV[4];      // qatlam UV'lari
        float tK;         // hudud indeksi uchun past chastotali shovqin
        float tFar;       // uzoqlik (0..1): o'rtacha rangga o'tish

        float tHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
        float tNoise( vec2 p ) {
          vec2 i = floor( p ), f = fract( p );
          vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( tHash( i ), tHash( i + vec2( 1, 0 ) ), u.x ), mix( tHash( i + vec2( 0, 1 ) ), tHash( i + 1.0 ), u.x ), u.y );
        }
        vec4 tSample( sampler2D t, int k ) {
          vec2 uv = tUV[k];
          #ifdef TERRAIN_DETAIL
            vec2 gx = dFdx( uv ), gy = dFdy( uv );
            float l = tK * 8.0, f = fract( l ), ia = floor( l );
            vec2 oa = sin( vec2( 3.0, 7.0 ) * ia ), ob = sin( vec2( 3.0, 7.0 ) * ( ia + 1.0 ) );
            vec4 a = textureGrad( t, uv + oa, gx, gy ), b = textureGrad( t, uv + ob, gx, gy );
            return mix( a, b, smoothstep( 0.2, 0.8, f - 0.1 * dot( a.rgb - b.rgb, vec3( 1.0 ) ) ) );
          #else
            return texture2D( t, uv );
          #endif
        }`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `{
          vec2 xz = vTPos.xz;
          vec3 s = texture2D( tSplat, ( xz + uSize * 0.5 ) / uSize ).rgb;
          vec4 w = vec4( s.r, clamp( 1.0 - s.r - s.g - s.b, 0.0, 1.0 ), s.g, s.b );
          for ( int k = 0; k < 4; k++ ) tUV[k] = xz / uTile[k];
          tK = tNoise( xz * 0.07 ) * 0.7 + tNoise( xz * 0.23 ) * 0.3;
          tFar = smoothstep( 35.0, 200.0, distance( vTPos, cameraPosition ) );
          vec3 c0 = tSample( tD0, 0 ).rgb, c1 = tSample( tD1, 1 ).rgb, c2 = tSample( tD2, 2 ).rgb, c3 = tSample( tD3, 3 ).rgb;
          // Tekstura yorqinligi = "balandlik": chegarada baland (tosh, barg) qismlar ustun chiqadi
          vec4 hgt = vec4( dot( c0, vec3( 0.33 ) ), dot( c1, vec3( 0.33 ) ), dot( c2, vec3( 0.33 ) ), dot( c3, vec3( 0.33 ) ) );
          vec4 hw = w * ( hgt * 1.6 + 0.25 );
          float mx = max( max( hw.x, hw.y ), max( hw.z, hw.w ) );
          hw = max( hw - mx + 0.18, 0.0 ) * step( 0.001, w );
          tW = hw / max( dot( hw, vec4( 1.0 ) ), 1e-4 );
          vec3 albedo = c0 * tW.x + c1 * tW.y + c2 * tW.z + c3 * tW.w;
          // Uzoqda har qatlam o'rtacha rangiga (eng kichik mip) o'tadi
          vec3 avg = textureLod( tD0, vec2( 0.5 ), 10.0 ).rgb * tW.x + textureLod( tD1, vec2( 0.5 ), 10.0 ).rgb * tW.y
                   + textureLod( tD2, vec2( 0.5 ), 10.0 ).rgb * tW.z + textureLod( tD3, vec2( 0.5 ), 10.0 ).rgb * tW.w;
          albedo = mix( albedo, avg, tFar * 0.85 );
          // Katta masshtabdagi rang tebranishi (takrorlanishni yashiradi)
          float macro = tNoise( xz * 0.011 ) * 0.6 + tNoise( xz * 0.037 ) * 0.4;
          albedo *= 0.82 + 0.36 * macro;
          diffuseColor.rgb *= albedo;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = dot( tW, uRough );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `{
          vec3 nt = ( tSample( tN0, 0 ).xyz * 2.0 - 1.0 ) * tW.x + ( tSample( tN1, 1 ).xyz * 2.0 - 1.0 ) * tW.y
                  + ( tSample( tN2, 2 ).xyz * 2.0 - 1.0 ) * tW.z + ( tSample( tN3, 3 ).xyz * 2.0 - 1.0 ) * tW.w;
          nt = mix( nt, vec3( 0.0, 0.0, 1.0 ), tFar );
          vec3 N = normalize( vTNor );
          // Tekstura x -> dunyo +X, tekstura "yuqori" (flipY yo'q) -> dunyo -Z
          vec3 T = normalize( vec3( 1.0, 0.0, 0.0 ) - N * N.x );
          vec3 B = cross( N, T );
          vec3 nw = normalize( T * nt.x + B * nt.y + N * max( nt.z, 0.2 ) );
          normal = normalize( ( viewMatrix * vec4( nw, 0.0 ) ).xyz );
        }`,
      );
  };
  mat.customProgramCacheKey = () => `terrain-v3-${detail ? 'hq' : 'lq'}`;
  return mat;
}
