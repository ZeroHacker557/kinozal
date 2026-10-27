// O'rmon uchun Poly Haven (CC0) modellari va daraxt teksturalarini yuklab oladi -> assets-src/nature/<id>/
// (xom fayllar git'ga kirmaydi; Blender skripti forest_nature.py ularni qayta ishlab client/public ga chiqaradi)
// Ishlatish: node tools/fetch-nature.mjs
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'assets-src', 'nature');

/** To'liq glTF modellar (1k teksturalar bilan) */
const MODELS = [
  'fern_02', 'shrub_03', 'shrub_04', 'rock_moss_set_01', 'rock_moss_set_02', 'boulder_01',
  'tree_stump_01', 'tree_stump_02', 'dead_tree_trunk', 'dead_tree_trunk_02', 'dry_branches_medium_01',
];
/** Faqat teksturalar (daraxtlar juda og'ir - geometriyani Blender'da o'zimiz quramiz) */
const TEXTURES = {
  fir_tree_01: ['twig_diff', 'twig_alpha', 'twig_nor_gl', 'bark_diff', 'bark_nor_gl'],
  pine_tree_01: ['twig_diff', 'twig_alpha', 'twig_nor_gl', 'bark_diff', 'bark_nor_gl'],
  grass_medium_01: ['Diffuse', 'Alpha'],
};
const RES = '1k';

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, file) {
  if (await exists(file)) return 0;
  await mkdir(dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await writeFile(file, buf);
      return buf.length;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
    }
  }
}

async function files(id) {
  const r = await fetch(`https://api.polyhaven.com/files/${id}`);
  if (!r.ok) throw new Error(`${id}: ${r.status}`);
  return r.json();
}

let total = 0;
for (const id of MODELS) {
  const f = await files(id);
  const g = f.gltf?.[RES]?.gltf;
  if (!g) {
    console.warn(`! ${id}: glTF ${RES} yo'q`);
    continue;
  }
  const dir = join(outDir, id);
  total += await download(g.url, join(dir, `${id}.gltf`));
  for (const [path, inc] of Object.entries(g.include ?? {})) total += await download(inc.url, join(dir, path));
  console.log(`✓ ${id}`);
}
for (const [id, keys] of Object.entries(TEXTURES)) {
  const f = await files(id);
  for (const k of keys) {
    const url = f[k]?.[RES]?.jpg?.url ?? f[k]?.[RES]?.png?.url;
    if (!url) {
      console.warn(`! ${id}: ${k} yo'q`);
      continue;
    }
    total += await download(url, join(outDir, id, `${k}.${url.endsWith('.png') ? 'png' : 'jpg'}`));
  }
  console.log(`✓ ${id} (teksturalar)`);
}
console.log(`yuklandi: ${(total / 1e6).toFixed(1)} MB`);
