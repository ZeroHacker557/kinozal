import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

declare module 'three' {
  interface BufferGeometry {
    computeBoundsTree: typeof computeBoundsTree;
    disposeBoundsTree: typeof disposeBoundsTree;
  }
}

/** Bitta nuqtadagi pishirilgan yorug'lik (3 qatlam). */
export interface LightSample {
  house: THREE.Color;
  base: THREE.Color;
  screen: THREE.Color;
}

type Layers = { house: THREE.DataTexture; base: THREE.DataTexture; screen: THREE.DataTexture };

/**
 * Lightmap'lardan dinamik obyektlar (o'rindiqlar, playerlar, tugma) uchun yorug'lik oladi:
 * nuqta ostidagi polga nur tashlab, o'sha joyning lightmap qiymatini o'qiydi.
 * Natijada dinamik obyektlar ham zal bilan bir xil yoritiladi va realtime chiroq kerak emas.
 */
export class LightProbeField {
  private raycaster = new THREE.Raycaster();
  private meshes: THREE.Mesh[];
  private grid: Float32Array | null = null;
  private gridInfo = { x0: 0, z0: 0, nx: 0, nz: 0, step: 0.5 };

  constructor(meshes: THREE.Mesh[], private layers: Layers) {
    this.meshes = meshes;
    for (const m of meshes) {
      if (!m.geometry.boundsTree) m.geometry.computeBoundsTree();
    }
    this.raycaster.firstHitOnly = true;
  }

  /** (x, z) nuqtadagi pol yorug'ligi. fromY - nurni qaysi balandlikdan tushirish. */
  sample(x: number, z: number, fromY = 9.0): LightSample {
    const out: LightSample = { house: new THREE.Color(0, 0, 0), base: new THREE.Color(0, 0, 0), screen: new THREE.Color(0, 0, 0) };
    this.raycaster.set(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 20;
    const hit = this.raycaster.intersectObjects(this.meshes, false)[0];
    if (!hit || !hit.uv1) return out;
    readTexel(this.layers.house, hit.uv1, out.house);
    readTexel(this.layers.base, hit.uv1, out.base);
    readTexel(this.layers.screen, hit.uv1, out.screen);
    return out;
  }

  /** Butun zal bo'ylab tez o'qish uchun to'r (playerlar har kadrda ishlatadi). */
  buildGrid(minX: number, maxX: number, minZ: number, maxZ: number, step = 0.5) {
    const nx = Math.ceil((maxX - minX) / step) + 1;
    const nz = Math.ceil((maxZ - minZ) / step) + 1;
    const g = new Float32Array(nx * nz * 9);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const s = this.sample(minX + i * step, minZ + j * step);
        const o = (j * nx + i) * 9;
        g.set([s.house.r, s.house.g, s.house.b, s.base.r, s.base.g, s.base.b, s.screen.r, s.screen.g, s.screen.b], o);
      }
    }
    this.grid = g;
    this.gridInfo = { x0: minX, z0: minZ, nx, nz, step };
  }

  /** To'rdan bilinear o'qish. */
  lookup(x: number, z: number, out: LightSample): LightSample {
    const g = this.grid;
    if (!g) return out;
    const { x0, z0, nx, nz, step } = this.gridInfo;
    const fx = THREE.MathUtils.clamp((x - x0) / step, 0, nx - 1.001);
    const fz = THREE.MathUtils.clamp((z - z0) / step, 0, nz - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz);
    const tx = fx - i, tz = fz - j;
    const acc = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const corners: [number, number, number][] = [
      [i, j, (1 - tx) * (1 - tz)], [i + 1, j, tx * (1 - tz)], [i, j + 1, (1 - tx) * tz], [i + 1, j + 1, tx * tz],
    ];
    for (const [ci, cj, w] of corners) {
      const o = (cj * nx + ci) * 9;
      for (let k = 0; k < 9; k++) acc[k] += g[o + k] * w;
    }
    out.house.setRGB(acc[0], acc[1], acc[2]);
    out.base.setRGB(acc[3], acc[4], acc[5]);
    out.screen.setRGB(acc[6], acc[7], acc[8]);
    return out;
  }
}

/** Lightmap'dan 3x3 tekseldagi o'rtacha qiymat (shovqinni yumshatish uchun). */
function readTexel(tex: THREE.DataTexture, uv: THREE.Vector2, out: THREE.Color) {
  const { data, width, height } = tex.image as { data: Uint16Array | Float32Array; width: number; height: number };
  const half = data instanceof Uint16Array;
  // EXRLoader qatorlarni pastdan yuqoriga yozadi, glTF UV esa V bo'yicha teskari
  const cx = Math.round(uv.x * (width - 1));
  const cy = Math.round((1 - uv.y) * (height - 1));
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = THREE.MathUtils.clamp(cx + dx, 0, width - 1);
      const y = THREE.MathUtils.clamp(cy + dy, 0, height - 1);
      const o = (y * width + x) * 4;
      const vr = half ? THREE.DataUtils.fromHalfFloat(data[o]) : data[o];
      const vg = half ? THREE.DataUtils.fromHalfFloat(data[o + 1]) : data[o + 1];
      const vb = half ? THREE.DataUtils.fromHalfFloat(data[o + 2]) : data[o + 2];
      if (vr + vg + vb <= 0) continue; // atlas bo'sh joyi
      r += vr; g += vg; b += vb; n++;
    }
  }
  if (n) out.setRGB(r / n, g / n, b / n);
}
