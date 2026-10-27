/**
 * Build'dan keyin client/dist fayllarini oldindan siqish (.br va .gz).
 * Server brauzer qo'llagan formatni tayyor holda beradi - bepul hostingning kuchsiz CPU'si har so'rovda siqmaydi.
 * Ishga tushirish: node tools/precompress.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'client', 'dist');
/** Siqiladigan turlar (jpg/png/exr allaqachon siqilgan) */
const TYPES = new Set(['.js', '.css', '.html', '.json', '.svg', '.glb', '.wasm', '.txt', '.bin']);

let before = 0, after = 0, count = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TYPES.has(extname(p))) compress(p);
  }
}

function compress(file) {
  const raw = readFileSync(file);
  if (raw.length < 1024) return;
  const br = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  });
  // Foydasi kam bo'lsa siqilgan nusxa yozilmaydi
  if (br.length > raw.length * 0.9) return;
  writeFileSync(file + '.br', br);
  writeFileSync(file + '.gz', gzipSync(raw, { level: 9 }));
  before += raw.length;
  after += br.length;
  count++;
}

walk(DIST);
const mb = (n) => (n / 1e6).toFixed(2);
console.log(`siqildi: ${count} fayl, ${mb(before)} MB -> ${mb(after)} MB (brotli)`);
