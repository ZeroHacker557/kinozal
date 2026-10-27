// Poly Haven (CC0) texturalarini yuklab oladi.
// Ishlatish: node tools/fetch-textures.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HALL = join(root, 'client', 'public', 'textures');
const FOREST = join(root, 'client', 'public', 'maps', 'forest', 'textures');

// id -> qayerga va qaysi material uchun
const TEXTURES = {
  velour_velvet: [HALL, "o'rindiq va parda baxmali"],
  wool_boucle: [HALL, 'gilam tolasi'],
  hessian_380: [HALL, 'akustik devor panellari'],
  dark_wood: [HALL, "yog'och bezaklar"],
  concrete_floor_painted: [HALL, "sahna oldi va ship"],
  // O'rmon relyefi qatlamlari (splat: R o'tloq, G o'rmon tagi, B yo'l/loy, A qoya)
  forrest_ground_01: [FOREST, "o'tloq"],
  forest_leaves_02: [FOREST, "o'rmon tagi (moxli barglar)"],
  forest_ground_04: [FOREST, "yo'l va soy bo'yi loyi"],
  mossy_rock: [FOREST, 'qoyalar'],
  rough_wood: [FOREST, "eskirgan taxta (ko'prik, to'nkalar)"],
  bark_brown_02: [FOREST, "moxli po'stloq (xodalar, bargli daraxtlar)"],
};

// Poly Haven fayl kalitlari -> bizdagi nom
const MAPS = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
const RES = '1k';

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

for (const [id, [outDir, purpose]] of Object.entries(TEXTURES)) {
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
