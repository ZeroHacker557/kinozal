import * as THREE from 'three';
import type { Vec3 } from '../layout';

/** Blender (forest_terrain.py) eksport qilgan relyef ma'lumoti: terrain.json + terrain.bin */
export interface TerrainMeta {
  size: number;
  res: number;
  hmin: number;
  hmax: number;
  /** splat qatlamlari tartibi: o'tloq, o'rmon tagi, yo'l/loy, qoya */
  layers: [string, string, string, string];
  stream: { points: [number, number, number][]; width: number };
  bridge: { position: Vec3; yaw: number; length: number; width: number };
  paths: Record<string, [number, number][]>;
  castle: { center: Vec3; radius: number; gate: Vec3 };
}

/** Bo'lak (chunk) o'lchami: 64 m = 128 katak */
export const CHUNK_CELLS = 128;
/** Uzoqlik bo'yicha detallik: qadam (katak) */
export const LOD_STEPS = [1, 2, 4, 8] as const;

export class TerrainData {
  readonly meta: TerrainMeta;
  readonly res: number;
  readonly half: number;
  readonly step: number;
  /** Balandliklar: [qator (z)][ustun (x)] */
  readonly heights: Float32Array;

  constructor(meta: TerrainMeta, raw: Uint16Array) {
    this.meta = meta;
    this.res = meta.res;
    this.half = meta.size / 2;
    this.step = meta.size / (meta.res - 1);
    const k = (meta.hmax - meta.hmin) / 65535;
    this.heights = new Float32Array(raw.length);
    // Har qator: birinchi qiymat to'liq, keyingilari oldingisidan farq (mod 65536)
    for (let i = 0; i < this.res; i++) {
      let q = 0;
      for (let j = 0; j < this.res; j++) {
        const o = i * this.res + j;
        q = (q + raw[o]) & 0xffff;
        this.heights[o] = meta.hmin + q * k;
      }
    }
  }

  /** To'r nuqtasidagi balandlik (chegaradan tashqarisi qisiladi) */
  at(i: number, j: number) {
    const r = this.res - 1;
    i = i < 0 ? 0 : i > r ? r : i;
    j = j < 0 ? 0 : j > r ? r : j;
    return this.heights[i * this.res + j];
  }

  /** Istalgan nuqtadagi balandlik (ikki chiziqli interpolatsiya) */
  heightAt(x: number, z: number) {
    const fx = (x + this.half) / this.step, fz = (z + this.half) / this.step;
    const j = Math.floor(fx), i = Math.floor(fz);
    const tx = fx - j, tz = fz - i;
    const a = this.at(i, j), b = this.at(i, j + 1), c = this.at(i + 1, j), d = this.at(i + 1, j + 1);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** To'liq aniqlikdagi normal (markaziy farq) - past LOD'da ham shakl aniq yoritiladi */
  normalAtGrid(i: number, j: number, out: THREE.Vector3) {
    const dx = this.at(i, j + 1) - this.at(i, j - 1);
    const dz = this.at(i + 1, j) - this.at(i - 1, j);
    return out.set(-dx, 2 * this.step, -dz).normalize();
  }

  get chunks() {
    return (this.res - 1) / CHUNK_CELLS;
  }

  /**
   * Bitta bo'lak geometriyasi. Chetlarida pastga tushgan "etak" (skirt) bor - qo'shni bo'laklar
   * har xil detallikda bo'lsa ham orada tirqish ko'rinmaydi.
   */
  buildChunk(ci: number, cj: number, step: number): THREE.BufferGeometry {
    const n = CHUNK_CELLS / step + 1;
    const i0 = ci * CHUNK_CELLS, j0 = cj * CHUNK_CELLS;
    const skirt = 4 * (n - 1);
    const count = n * n + skirt;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    let minY = Infinity, maxY = -Infinity;
    const put = (k: number, i: number, j: number, drop: number) => {
      const y = this.at(i, j);
      pos[k * 3] = -this.half + j * this.step;
      pos[k * 3 + 1] = y - drop;
      pos[k * 3 + 2] = -this.half + i * this.step;
      this.normalAtGrid(i, j, v);
      nor[k * 3] = v.x;
      nor[k * 3 + 1] = v.y;
      nor[k * 3 + 2] = v.z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) put(a * n + b, i0 + a * step, j0 + b * step, 0);

    const idx: number[] = [];
    for (let a = 0; a < n - 1; a++) {
      for (let b = 0; b < n - 1; b++) {
        const p = a * n + b;
        idx.push(p, p + n, p + 1, p + 1, p + n, p + n + 1);
      }
    }
    // Etak: perimetr bo'ylab (soat yo'nalishida) har bir chet nuqtaning pastga tushirilgan nusxasi
    const drop = 0.6 + step * 0.35;
    const ring: number[] = [];
    for (let b = 0; b < n - 1; b++) ring.push(b);
    for (let a = 0; a < n - 1; a++) ring.push(a * n + n - 1);
    for (let b = n - 1; b > 0; b--) ring.push((n - 1) * n + b);
    for (let a = n - 1; a > 0; a--) ring.push(a * n);
    ring.forEach((p, r) => put(n * n + r, i0 + Math.floor(p / n) * step, j0 + (p % n) * step, drop));
    for (let r = 0; r < ring.length; r++) {
      const a = ring[r], b = ring[(r + 1) % ring.length];
      const sa = n * n + r, sb = n * n + ((r + 1) % ring.length);
      idx.push(a, sa, b, b, sa, sb);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    const cx = -this.half + (j0 + CHUNK_CELLS / 2) * this.step;
    const cz = -this.half + (i0 + CHUNK_CELLS / 2) * this.step;
    const sz = CHUNK_CELLS * this.step;
    g.boundingBox = new THREE.Box3(new THREE.Vector3(cx - sz / 2, minY - drop, cz - sz / 2), new THREE.Vector3(cx + sz / 2, maxY, cz + sz / 2));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }
}

let cache: Promise<TerrainData> | null = null;

export function loadTerrain(): Promise<TerrainData> {
  cache ??= Promise.all([
    fetch('/maps/forest/terrain.json').then((r) => {
      if (!r.ok) throw new Error(`terrain.json: ${r.status}`);
      return r.json() as Promise<TerrainMeta>;
    }),
    fetch('/maps/forest/terrain.bin').then((r) => {
      if (!r.ok) throw new Error(`terrain.bin: ${r.status}`);
      return r.arrayBuffer();
    }),
  ]).then(([meta, buf]) => new TerrainData(meta, new Uint16Array(buf)));
  return cache;
}
