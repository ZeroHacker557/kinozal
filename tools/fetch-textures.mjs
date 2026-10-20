// Poly Haven (CC0) texturalarini yuklab oladi.
// Ishlatish: node tools/fetch-textures.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'client', 'public', 'textures');

// id -> qaysi material uchun ishlatiladi
const TEXTURES = {
  velour_velvet: "o'rindiq va parda baxmali",
  wool_boucle: 'gilam tolasi',
  hessian_380: 'akustik devor panellari',
  dark_wood: "yog'och bezaklar",
  concrete_floor_painted: "sahna oldi va ship",
};

// Poly Haven fayl kalitlari -> bizdagi nom
const MAPS = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
const RES = '1k';

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

for (const [id, purpose] of Object.entries(TEXTURES)) {
  const res = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!res.ok) throw new Error(`${id}: ${res.status}`);
  const files = await res.json();
  const dir = join(outDir, id);
  await mkdir(dir, { recursive: true });
  for (const [key, name] of Object.entries(MAPS)) {
    const url = files[key]?.[RES]?.jpg?.url;
    if (!url) { console.warn(`  ! ${id}: ${key} topilmadi`); continue; }
    const file = join(dir, `${name}.jpg`);
    if (await exists(file)) continue;
    const img = await fetch(url);
    await writeFile(file, Buffer.from(await img.arrayBuffer()));
  }
  console.log(`✓ ${id} (${purpose})`);
}
