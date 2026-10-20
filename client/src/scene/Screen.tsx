import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useHall } from './Hall';
import { lightingState } from './lighting';
import { useScreen } from '../screen/screenStore';

/** Ekran ulashilmaganda ko'rinadigan kutish tasviri. */
function createIdleTexture() {
  const W = 2048, H = 1152;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  const bg = g.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H / 2, W * 0.65);
  bg.addColorStop(0, '#1a2238');
  bg.addColorStop(0.55, '#0b0f1c');
  bg.addColorStop(1, '#030409');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Plyonka kadrlari motivi (yuqori va pastki chiziqlar)
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let x = 40; x < W; x += 90) {
    g.fillRect(x, 50, 46, 30);
    g.fillRect(x, H - 80, 46, 30);
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(232, 214, 180, 0.95)';
  g.font = '600 150px Inter, "Segoe UI", sans-serif';
  g.letterSpacing = '24px';
  g.fillText('KINO ZAL', W / 2, H * 0.42);

  g.letterSpacing = '0px';
  g.fillStyle = 'rgba(200, 210, 235, 0.75)';
  g.font = '400 54px Inter, "Segoe UI", sans-serif';
  g.fillText('Ekran ulashilishini kutyapmiz…', W / 2, H * 0.58);

  g.fillStyle = 'rgba(200, 210, 235, 0.4)';
  g.font = '400 34px Inter, "Segoe UI", sans-serif';
  g.fillText("Xona egasi ekranini ulashganda tasvir shu yerda paydo bo'ladi", W / 2, H * 0.66);

  // Ingichka oltin chiziq
  g.strokeStyle = 'rgba(200, 160, 90, 0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(W / 2 - 260, H * 0.5);
  g.lineTo(W / 2 + 260, H * 0.5);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.flipY = false; // glTF UV'lari V bo'yicha teskari
  return { tex, canvas: c };
}

let sampler: CanvasRenderingContext2D | null = null;

/** Tasvirning o'rtacha rangi (chiziqli fazoda) - ekrandan zalga tushadigan nur rangi. */
export function averageColor(source: CanvasImageSource, out: THREE.Color) {
  if (!sampler) {
    const s = document.createElement('canvas');
    s.width = s.height = 8;
    sampler = s.getContext('2d', { willReadFrequently: true })!;
  }
  sampler.drawImage(source, 0, 0, 8, 8);
  const d = sampler.getImageData(0, 0, 8, 8).data;
  let r = 0, gg = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    gg += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return out.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
}

/**
 * Ekran materiali: tasvir formati ekrannikiga mos kelmasa cho'zilmaydi, qora chiziqlar bilan
 * joylashadi (letterbox / pillarbox).
 */
function createScreenMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null as THREE.Texture | null },
      uScale: { value: new THREE.Vector2(1, 1) },
      // three.js video teksturani sRGB holida saqlaydi (o'z materiallarida shaderda dekodlaydi) - biz ham shunday qilamiz
      uDecode: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec2 uScale;
      uniform float uDecode;
      varying vec2 vUv;
      void main() {
        vec2 uv = (vUv - 0.5) / uScale + 0.5;
        vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
        vec4 t = texture2D(map, clamp(uv, 0.0, 1.0));
        if (uDecode > 0.5) t = sRGBTransferEOTF(t);
        vec3 c = t.rgb * inside.x * inside.y;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    toneMapped: false,
  });
}

/** Ekran yorug'ligini yangilash oralig'i (s) va silliqlash tezligi */
const SAMPLE_EVERY = 0.1;
const LIGHT_DAMP = 6;

export function Screen() {
  const { screen, layout } = useHall();
  const video = useScreen((s) => s.video);
  const mat = useMemo(createScreenMaterial, []);
  const state = useRef({
    idle: null as ReturnType<typeof createIdleTexture> | null,
    el: null as HTMLVideoElement | null,
    target: new THREE.Color(),
    coverage: 1,
    sampleIn: 0,
  });
  const screenAspect = layout.screen.width / layout.screen.height;

  // Kutish tasviri va material
  useEffect(() => {
    const s = state.current;
    s.idle = createIdleTexture();
    screen.material = mat;
    // Shrift yuklangach qayta chizish
    document.fonts?.ready.then(() => {
      if (!s.idle) return;
      const fresh = createIdleTexture();
      if (mat.uniforms.map.value === s.idle.tex) mat.uniforms.map.value = fresh.tex;
      s.idle.tex.dispose();
      s.idle = fresh;
    });
    return () => {
      s.idle?.tex.dispose();
      s.idle = null;
      mat.dispose();
    };
  }, [screen, mat]);

  // Ulashilgan video
  useEffect(() => {
    const s = state.current;
    if (!video) {
      mat.uniforms.map.value = s.idle?.tex ?? null;
      mat.uniforms.uDecode.value = 0;
      mat.uniforms.uScale.value.set(1, 1);
      s.el = null;
      s.coverage = 1;
      if (s.idle) averageColor(s.idle.canvas, s.target);
      return;
    }
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.autoplay = true;
    el.srcObject = new MediaStream([video]);
    void el.play().catch(() => {});
    const tex = new THREE.VideoTexture(el);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    // Orqa qatorlardan qaraganda mayda detallar "jimirlamasligi" uchun mipmap
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4;
    const fit = () => {
      if (!el.videoWidth || !el.videoHeight) return;
      const va = el.videoWidth / el.videoHeight;
      const sc = va > screenAspect ? [1, screenAspect / va] : [va / screenAspect, 1];
      mat.uniforms.uScale.value.set(sc[0], sc[1]);
      s.coverage = sc[0] * sc[1];
    };
    el.addEventListener('loadedmetadata', fit);
    el.addEventListener('resize', fit);
    mat.uniforms.map.value = tex;
    mat.uniforms.uDecode.value = 1;
    s.el = el;
    s.sampleIn = 0;
    return () => {
      el.removeEventListener('loadedmetadata', fit);
      el.removeEventListener('resize', fit);
      el.pause();
      el.srcObject = null;
      tex.dispose();
      if (s.el === el) s.el = null;
    };
  }, [video, mat, screenAspect]);

  useFrame((_, dt) => {
    const s = state.current;
    // Video bo'lsa: tasvir rangi har 0.1 s o'lchanadi, qora chiziqlar ulushi hisobga olinadi
    if (s.el && s.el.readyState >= 2) {
      s.sampleIn -= dt;
      if (s.sampleIn <= 0) {
        s.sampleIn = SAMPLE_EVERY;
        averageColor(s.el, s.target).multiplyScalar(s.coverage);
      }
    }
    // Ekran nuri silliq o'zgaradi (kadr almashganda zal "miltillamaydi")
    lightingState.screenAverage.lerp(s.target, 1 - Math.exp(-LIGHT_DAMP * Math.min(dt, 0.1)));
  });

  return null;
}
