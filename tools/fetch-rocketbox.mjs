// Microsoft Rocketbox (MIT) avatarlari va animatsiyalarini yuklaydi -> assets-src/rocketbox
// Ishlatish: node tools/fetch-rocketbox.mjs
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets-src', 'rocketbox');
const RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/';
const TREE = 'https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1';

export const AVATARS = [
  'Female_Adult_01', 'Female_Adult_04', 'Female_Adult_13', 'Female_Adult_17',
  'Male_Adult_02', 'Male_Adult_04', 'Male_Adult_06', 'Male_Adult_08',
];

export const ANIMS = [
  'idle_neutral_01', 'idle_look_around_01', 'walk_neutral_01', 'run_neutral_01',
  'sit_down_chair_01', 'sit_stand_up_chair_01', 'sit_chair_idle_neutral_01', 'sit_chair_idle_relaxed_01',
  'sit_chair_idle_look_around', 'sit_chair_idle_yawn', 'wave_01', 'claphands_01', 'cheer_01',
  'dancing_cool', 'dancing_neutral', 'gestic_laugh_loud', 'gestic_talk_neutral_01', 'crouch_idle',
];

async function exists(p, size) {
  try {
    const s = await stat(p);
    return !size || s.size === size;
  } catch {
    return false;
  }
}

const tree = (await (await fetch(TREE, { headers: { 'User-Agent': 'kino-zal' } })).json()).tree;
const jobs = [];
for (const a of AVATARS) {
  for (const f of tree) {
    if (f.type !== 'blob' || !f.path.startsWith(`Assets/Avatars/Adults/${a}/`)) continue;
    // Yuz blendshape'lari, ajin xaritalari va Unity fayllari kerak emas
    if (/_facial\.fbx$|wrinkle| - wr|\.shader$|\.mat$|\.meta$|\.png$/i.test(f.path)) continue;
    jobs.push({ src: f.path, dst: join(out, 'avatars', a, f.path.split('/').pop()), size: f.size });
  }
}
for (const g of ['m', 'f']) {
  for (const n of ANIMS) {
    const f = tree.find((t) => t.type === 'blob' && t.path.startsWith('Assets/Animations/') && t.path.endsWith(`/${g}_${n}.max.fbx`));
    if (!f) {
      console.warn(`! topilmadi: ${g}_${n}`);
      continue;
    }
    const kind = f.path.split('/')[2].replace('all_animations_max_motextr_', '');
    jobs.push({ src: f.path, dst: join(out, 'anims', `${g}_${n}__${kind}.fbx`), size: f.size });
  }
}

let done = 0, bytes = 0;
const total = jobs.reduce((s, j) => s + j.size, 0);
async function worker() {
  for (;;) {
    const j = jobs.shift();
    if (!j) return;
    if (!(await exists(j.dst, j.size))) {
      await mkdir(dirname(j.dst), { recursive: true });
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await fetch(RAW + j.src.split('/').map(encodeURIComponent).join('/'));
          if (!r.ok) throw new Error(`${r.status}`);
          await writeFile(j.dst, Buffer.from(await r.arrayBuffer()));
          break;
        } catch (e) {
          if (attempt >= 3) throw new Error(`${j.src}: ${e.message}`);
        }
      }
    }
    done++;
    bytes += j.size;
    if (done % 10 === 0) console.log(`${done} fayl, ${(bytes / 1e6).toFixed(0)}/${(total / 1e6).toFixed(0)} MB`);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`TAYYOR: ${done} fayl, ${(bytes / 1e6).toFixed(0)} MB`);
