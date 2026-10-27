"""O'rmon tabiati: Poly Haven (CC0) modellarini soddalashtirish va butun xaritaga ekish.

    blender -b --factory-startup -P assets-src/blender/forest_scatter.py

 1) Modellar: qirqquloq, buta, qoyalar, to'nkalar, yiqilgan xodalar, quruq shoxlar - soddalashtiriladi
    (Decimate), teksturalar kichraytiriladi -> models/nature.glb (har variant alohida obyekt)
    O't to'plami (grass_medium_01 atlasidan) va yonib turuvchi qo'ziqorinlar shu yerda yasaladi.
 2) Ekish: relyef (forest_height.npy), o'rmon zichligi, qatlamlar, qiyalik, yo'l/soy/lager/qasr bo'yicha
    -> nature.bin (Float32: x, y, z, burilish, masshtab) + nature.json (variantlar, to'qnashuv)
Kerak: forest_terrain.py (forest_height.npy), forest_trees.py (trees.json), node tools/fetch-nature.mjs
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, OUT_DIR, ROOT, export_glb, make_material, reset_scene, select_only  # noqa: E402

NATURE = os.path.join(ROOT, 'assets-src', 'nature')
OUT = os.path.join(CLIENT_PUBLIC, 'maps', 'forest')
HALF, RES = 256.0, 1025
STEP = 2 * HALF / (RES - 1)
rng = np.random.default_rng(2024)

# variant -> (manba, obyekt nomi, maqsad yuzlar soni, tekstura o'lchami)
PROPS = {
    'fern_a': ('fern_02', 'fern_02_b', 360, 512), 'fern_b': ('fern_02', 'fern_02_c', 360, 512),
    'fern_c': ('fern_02', 'fern_02_a', 200, 512), 'fern_d': ('fern_02', 'fern_02_d', 200, 512),
    'plant_a': ('shrub_03', 'shrub_03_a', 260, 512), 'plant_b': ('shrub_03', 'shrub_03_b', 260, 512),
    'bush_a': ('shrub_04', 'shrub_04', 700, 512),
    'rock_big_a': ('rock_moss_set_01', 'rock_moss_set_01_rock01', 800, 512),
    'rock_big_b': ('rock_moss_set_01', 'rock_moss_set_01_rock04', 800, 512),
    'rock_big_c': ('rock_moss_set_01', 'rock_moss_set_01_rock06', 800, 512),
    'rock_a': ('rock_moss_set_02', 'rock_moss_set_02_rock08', 400, 512), 'rock_b': ('rock_moss_set_02', 'rock_moss_set_02_rock10', 400, 512),
    'rock_c': ('rock_moss_set_02', 'rock_moss_set_02_rock11', 400, 512), 'rock_d': ('rock_moss_set_02', 'rock_moss_set_02_rock13', 400, 512),
    'boulder': ('boulder_01', 'boulder_01', 800, 512),
    'stump_a': ('tree_stump_01', 'tree_stump_01', 1500, 512), 'stump_b': ('tree_stump_02', 'tree_stump_02', 1500, 512),
    'log_a': ('dead_tree_trunk', 'dead_tree_trunk', 1400, 512), 'log_b': ('dead_tree_trunk_02', 'dead_tree_trunk_02', 2000, 512),
    'branches_a': ('dry_branches_medium_01', 'dry_branches_medium_01_a', 1400, 256),
    'branches_b': ('dry_branches_medium_01', 'dry_branches_medium_01_b', 1200, 256),
}
GRASS_SPRITES = [(0.238, 0.781, 0.434, 0.895), (0.625, 0.777, 0.824, 0.859), (0.625, 0.895, 0.742, 0.996), (0.270, 0.918, 0.434, 1.0)]


# ------------------------------------------------------------------ 1) modellar
def decimate_to(ob, target):
    """Collapse bir urinishda maqsadga yetmasligi mumkin (ko'p bo'lakli skan modellar) - takrorlanadi.
    Ba'zi skanlarda yuzalar cho'qqilarni bo'lishmaydi (har yuza alohida) - avval bir joydagilari birlashtiriladi."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    bm.to_mesh(ob.data)
    bm.free()
    for _ in range(6):
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        if tris <= target * 1.25:
            break
        mod = ob.modifiers.new('dec', 'DECIMATE')
        mod.ratio = max(0.02, target / tris)
        mod.use_collapse_triangulate = True
        select_only([ob])
        bpy.ops.object.modifier_apply(modifier='dec')
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def import_props():
    out = []
    imported = {}
    dims = {}
    for name, (src, obj, target, texsize) in PROPS.items():
        if src not in imported:
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=os.path.join(NATURE, src, src + '.gltf'))
            imported[src] = [o for o in bpy.data.objects if o not in before]
        ob = next(o for o in imported[src] if o.name == obj)
        ob = ob.copy()
        ob.data = ob.data.copy()
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = None
        ob.matrix_world = Matrix.Identity(4)
        ob.name = name
        ob.data.name = name
        # Soddalashtirish (target - uchburchaklar soni)
        tris = decimate_to(ob, target)
        print(f'[scatter] {name}: {tris} uchburchak')
        # Koordinata boshi - pastki markaz (yerga qo'yiladigan nuqta)
        me = ob.data
        co = np.empty(len(me.vertices) * 3, np.float32)
        me.vertices.foreach_get('co', co)
        co = co.reshape(-1, 3)
        mn, mx = co.min(0), co.max(0)
        shift = np.array([(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]], np.float32)
        me.vertices.foreach_set('co', (co - shift).ravel())
        me.update()
        dims[name] = [float(x) for x in (mx - mn)]
        # Tekstura o'lchamini kichraytirish
        for m in me.materials:
            if not m or not m.use_nodes:
                continue
            for n in m.node_tree.nodes:
                if n.type == 'TEX_IMAGE' and n.image and max(n.image.size) > texsize:
                    n.image.scale(texsize, texsize)
        out.append(ob)
    # Qoya va xodalar uzoqdan ham ko'rinadi: ikkinchi, ancha sodda daraja (<nom>_1)
    for ob in list(out):
        if not ob.name.startswith(('rock', 'boulder', 'log', 'stump')):
            continue
        lo = ob.copy()
        lo.data = ob.data.copy()
        bpy.context.scene.collection.objects.link(lo)
        lo.name = lo.data.name = ob.name + '_1'
        decimate_to(lo, max(80, PROPS[ob.name][2] // 4))
        out.append(lo)
    # Manba obyektlarini o'chirish
    for objs in imported.values():
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
    return out, dims


def grass_clump():
    """O't to'plami: atlasdagi o't kartochkalaridan 5 ta kesishgan tekislik (RGBA tekstura yasaladi)"""
    src = os.path.join(NATURE, 'grass_medium_01')
    d = bpy.data.images.load(os.path.join(src, 'Diffuse.jpg'))
    a = bpy.data.images.load(os.path.join(src, 'Alpha.jpg'))
    W, H = d.size
    rgba = np.array(d.pixels[:], np.float32).reshape(H, W, 4)
    alpha = np.array(a.pixels[:], np.float32).reshape(H, W, 4)[..., 0]
    rgba[..., 3] = alpha
    # Faqat pastki qism (o't kartochkalari) - 1024x256
    crop = rgba[: H // 4]  # Blender qatorlari pastdan: pastki chorak
    img = bpy.data.images.new('grass_clumps', W, H // 4, alpha=True)
    img.pixels.foreach_set(crop.ravel())
    img.update()
    img.filepath_raw = os.path.join(OUT, 'textures', 'grass_clumps.png')
    img.file_format = 'PNG'
    img.save()
    mat = make_material('Grass', (0.3, 0.35, 0.18), rough=0.95)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    r = np.random.default_rng(3)
    for k in range(5):
        u0, v0, u1, v1 = GRASS_SPRITES[k % len(GRASS_SPRITES)]
        # Kesilgan tekstura: rasm v (tepadan) 0.75..1 -> yangi UV 0..1 (pastdan): V = (1 - v) * 4
        U0, U1 = u0, u1
        V0, V1 = (1 - v1) * 4, (1 - v0) * 4
        ang = k / 5 * math.pi + r.uniform(-0.2, 0.2)
        x = Vector((math.cos(ang), math.sin(ang), 0))
        off = Vector((r.uniform(-0.12, 0.12), r.uniform(-0.12, 0.12), 0))
        h = r.uniform(0.32, 0.5)
        w = h * (u1 - u0) / (v1 - v0)
        pts = [off - x * w / 2, off + x * w / 2, off + x * w / 2 + Vector((0, 0, h)), off - x * w / 2 + Vector((0, 0, h))]
        f = bm.faces.new([bm.verts.new(p) for p in pts])
        for l, uv in zip(f.loops, [(U0, V0), (U1, V0), (U1, V1), (U0, V1)]):
            l[uvl].uv = uv
    me = bpy.data.meshes.new('grass')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    # Normal yuqoriga (o't yuzasi relyef bilan bir xil yoritilsin)
    me.normals_split_custom_set([(0, 0, 1)] * len(me.loops))
    ob = bpy.data.objects.new('grass', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def mushrooms():
    """Kechasi xira yonib turuvchi qo'ziqorinlar to'dasi (dark fantasy)"""
    stem = make_material('MushStem', (0.75, 0.72, 0.62), rough=0.7)
    cap = make_material('MushCap', (0.15, 0.55, 0.6), rough=0.4)
    bm = bmesh.new()
    r = np.random.default_rng(8)
    for k in range(7):
        a = r.uniform(0, 6.28)
        d = r.uniform(0, 0.22) if k else 0
        p = Vector((math.cos(a) * d, math.sin(a) * d, 0))
        h = r.uniform(0.05, 0.16) * (1.3 if k == 0 else 1)
        rad = h * r.uniform(0.45, 0.7)
        tilt = Matrix.Rotation(r.uniform(-0.25, 0.25), 4, 'X') @ Matrix.Rotation(r.uniform(-0.25, 0.25), 4, 'Y')
        m = Matrix.Translation(p) @ tilt
        res = bmesh.ops.create_cone(bm, cap_ends=False, segments=6, radius1=rad * 0.22, radius2=rad * 0.16, depth=h,
                                    matrix=m @ Matrix.Translation((0, 0, h / 2)))
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = 0
        res = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=5, radius=rad,
                                        matrix=m @ Matrix.Translation((0, 0, h)) @ Matrix.Diagonal((1, 1, 0.45, 1)))
        for v in res['verts']:
            if v.co.z < (m @ Vector((0, 0, h))).z - 0.002:
                v.co.z = (m @ Vector((0, 0, h))).z - 0.002
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = 1
            f.smooth = True
    me = bpy.data.meshes.new('mushrooms')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(stem)
    me.materials.append(cap)
    ob = bpy.data.objects.new('mushrooms', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# ------------------------------------------------------------------ 2) ekish
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def load_png(path):
    im = bpy.data.images.load(path)
    W, H = im.size
    px = np.array(im.pixels[:], np.float32).reshape(H, W, 4)
    bpy.data.images.remove(im)
    return np.flipud(px)  # 0-qator = -Z (PNG tepasi)


class Field:
    def __init__(self):
        self.h = np.load(os.path.join(OUT_DIR, 'forest_height.npy')).astype(np.float64)
        gz, gx = np.gradient(self.h, STEP)
        self.slope = np.hypot(gx, gz)
        self.density = load_png(os.path.join(OUT, 'density.png'))[..., 0]
        self.splat = load_png(os.path.join(OUT, 'splat.png'))[..., :3]
        self.meta = json.load(open(os.path.join(OUT, 'terrain.json')))
        stream = np.array(self.meta['stream']['points'])
        self.sx, self.sz = stream[:, 0], stream[:, 1]
        paths = [np.array(p) for p in self.meta['paths'].values()]
        self.path_pts = np.concatenate([self.densify(p) for p in paths])

    @staticmethod
    def densify(p, step=1.0):
        out = []
        for a, b in zip(p, p[1:]):
            n = max(1, int(np.hypot(*(b - a)) / step))
            for t in np.linspace(0, 1, n, endpoint=False):
                out.append(a + (b - a) * t)
        out.append(p[-1])
        return np.array(out)

    def grid(self, arr, x, z):
        """Bilinear namuna (arr - RES x RES yoki kichikroq kvadrat)"""
        n = arr.shape[0]
        fx = (x + HALF) / (2 * HALF) * (n - 1)
        fz = (z + HALF) / (2 * HALF) * (n - 1)
        j = np.clip(np.floor(fx).astype(int), 0, n - 2)
        i = np.clip(np.floor(fz).astype(int), 0, n - 2)
        tx, tz = fx - j, fz - i
        if arr.ndim == 3:
            tx, tz = tx[:, None], tz[:, None]
        return (arr[i, j] * (1 - tx) + arr[i, j + 1] * tx) * (1 - tz) + (arr[i + 1, j] * (1 - tx) + arr[i + 1, j + 1] * tx) * tz

    def stream_dist(self, x, z):
        return np.abs(z - np.interp(x, self.sx, self.sz))

    def path_dist(self, x, z):
        # Yo'l nuqtalari ~1 m oraliqda; bo'laklab hisoblash (xotira tejaladi)
        out = np.empty(len(x))
        for s in range(0, len(x), 4000):
            dx = x[s:s + 4000, None] - self.path_pts[None, :, 0]
            dz = z[s:s + 4000, None] - self.path_pts[None, :, 1]
            out[s:s + 4000] = np.sqrt((dx * dx + dz * dz).min(1))
        return out


# Lager buyumlari (three.js xz) - atrofiga hech narsa ekilmaydi
CAMP_SPOTS = [(-6.2, -3.4, 3.0), (-4.8, -2.3, 1.5), (13.5, 7.5, 3.5), (10.0, 11.5, 2.0), (12.3, 10.2, 2.0), (-10.5, 4.0, 1.5),
              (-5.0, -8.0, 1.5), (0.0, -12.5, 6.0)]


def candidates(field, spacing, jitter=0.45):
    n = int(2 * HALF / spacing)
    gx, gz = np.meshgrid(np.arange(n), np.arange(n))
    x = -HALF + (gx.ravel() + 0.5) * spacing + rng.uniform(-jitter, jitter, gx.size) * spacing
    z = -HALF + (gz.ravel() + 0.5) * spacing + rng.uniform(-jitter, jitter, gx.size) * spacing
    keep = (np.abs(x) < HALF - 7) & (np.abs(z) < HALF - 7)
    return x[keep], z[keep]


def site(field, x, z):
    s = {}
    s['h'] = field.grid(field.h, x, z)
    s['slope'] = field.grid(field.slope, x, z)
    s['dens'] = field.grid(field.density, x, z)
    sp = field.grid(field.splat, x, z)
    s['grass'], s['dirt'], s['rock'] = sp[:, 0], sp[:, 1], sp[:, 2]
    s['forest'] = np.clip(1 - sp.sum(1), 0, 1)
    s['fire'] = np.hypot(x, z)
    s['stream'] = field.stream_dist(x, z)
    s['path'] = field.path_dist(x, z)
    c = field.meta['castle']['center']
    s['castle'] = np.hypot(x - c[0], z - c[2])
    b = field.meta['bridge']['position']
    s['bridge'] = np.hypot(x - b[0], z - b[2])
    camp = np.full(len(x), np.inf)
    for cx, cz, r in CAMP_SPOTS:
        camp = np.minimum(camp, np.hypot(x - cx, z - cz) - r)
    s['camp'] = camp
    return s


def pick(x, z, mask, prob):
    keep = mask & (rng.random(len(x)) < prob)
    return x[keep], z[keep]


def scatter(field, dims, trees_meta):
    inst = {}

    def add(name, x, z, y, scale, rot=None):
        if len(x) == 0:
            return
        rot = rng.uniform(0, 2 * math.pi, len(x)) if rot is None else rot
        arr = np.stack([x, y, z, rot, scale], 1).astype(np.float32)
        inst[name] = np.concatenate([inst[name], arr]) if name in inst else arr

    # --- daraxtlar
    x, z = candidates(field, 5.0)
    s = site(field, x, z)
    ok = (s['fire'] > 26) & (s['path'] > 4.5) & (s['stream'] > 6.5) & (s['castle'] > 50) & (s['bridge'] > 10) & (s['slope'] < 0.75)
    prob = np.clip(s['dens'], 0, 1) ** 1.1 * 0.95 + 0.04 * (s['slope'] < 0.6)
    x, z = pick(x, z, ok, prob)
    s = site(field, x, z)
    u = rng.random(len(x))
    pine_bias = smoothstep(4, 18, s['h']) * 0.25 + s['grass'] * 0.3   # baland va ochiqroq joyda qarag'ay ko'proq
    kinds = np.where(u < 0.06, 'dead_a', np.where(u < 0.06 + 0.18 + pine_bias, 'pine_a', np.where(rng.random(len(x)) < 0.55, 'fir_a', 'fir_b')))
    for k, (lo, hi) in {'fir_a': (0.8, 1.25), 'fir_b': (0.75, 1.2), 'pine_a': (0.85, 1.2), 'dead_a': (0.7, 1.15)}.items():
        m = kinds == k
        add(k, x[m], z[m], s['h'][m] - 0.25, rng.uniform(lo, hi, m.sum()))
    # O'rmon chetlarida yosh archalar (fir_b kichraytirilgan)
    x, z = candidates(field, 7.0)
    s = site(field, x, z)
    ok = (s['fire'] > 22) & (s['path'] > 3.5) & (s['stream'] > 5) & (s['castle'] > 46) & (s['bridge'] > 8) & (s['slope'] < 0.6)
    edge = (s['dens'] > 0.12) & (s['dens'] < 0.55)
    x, z = pick(x, z, ok & edge, 0.4)
    add('fir_b', x, z, field.grid(field.h, x, z) - 0.1, rng.uniform(0.22, 0.45, len(x)))

    # --- qirqquloq, mayda o'simlik, buta
    x, z = candidates(field, 2.6)
    s = site(field, x, z)
    ok = (s['fire'] > 12) & (s['path'] > 2.2) & (s['stream'] > 3.2) & (s['castle'] > 46) & (s['slope'] < 0.55) & (s['camp'] > 1)
    x, z = pick(x, z, ok, np.clip(s['dens'] * 0.7 + s['forest'] * 0.2, 0, 0.75) * (s['rock'] < 0.4))
    names = rng.choice(['fern_a', 'fern_b', 'fern_c', 'fern_d', 'plant_a', 'plant_b'], len(x), p=[0.25, 0.25, 0.15, 0.15, 0.1, 0.1])
    for k in ('fern_a', 'fern_b', 'fern_c', 'fern_d', 'plant_a', 'plant_b'):
        m = names == k
        sc = rng.uniform(1.0, 1.7, m.sum()) if k.startswith('fern') else rng.uniform(1.6, 2.6, m.sum())
        add(k, x[m], z[m], field.grid(field.h, x[m], z[m]) - 0.03, sc)
    x, z = candidates(field, 6.5)
    s = site(field, x, z)
    ok = (s['fire'] > 14) & (s['path'] > 2.5) & (s['stream'] > 3) & (s['castle'] > 46) & (s['slope'] < 0.5) & (s['camp'] > 2)
    x, z = pick(x, z, ok, 0.12 + 0.3 * smoothstep(0.1, 0.5, s['dens']) * (1 - s['dens']))
    add('bush_a', x, z, field.grid(field.h, x, z) - 0.05, rng.uniform(1.6, 3.0, len(x)))

    # --- o't to'plamlari (o'tloq qatlami va o'rmon cheti)
    x, z = candidates(field, 1.7)
    s = site(field, x, z)
    ok = (s['fire'] > 8.5) & (s['path'] > 1.4) & (s['stream'] > 2.9) & (s['slope'] < 0.6) & (s['camp'] > 0.5) & (s['castle'] > 44)
    prob = np.clip(s['grass'] * 0.9 + s['forest'] * 0.25 * (1 - s['dens']), 0, 0.92)
    x, z = pick(x, z, ok, prob)
    add('grass', x, z, field.grid(field.h, x, z) - 0.02, rng.uniform(0.8, 1.5, len(x)))

    # --- qoyalar
    x, z = candidates(field, 11.0)
    s = site(field, x, z)
    ok = (s['fire'] > 24) & (s['path'] > 3.5) & (s['stream'] > 2.6) & (s['castle'] > 46) & (s['bridge'] > 8) & (s['camp'] > 3)
    prob = 0.05 + 0.45 * smoothstep(0.35, 0.8, s['slope']) + 0.35 * s['rock']
    x, z = pick(x, z, ok, prob)
    s = site(field, x, z)
    big = (s['slope'] > 0.45) | (s['rock'] > 0.4) | (rng.random(len(x)) < 0.15)
    for m, choices, sc in ((big, ['rock_big_a', 'rock_big_b', 'rock_big_c', 'boulder'], (0.8, 1.6)),
                           (~big, ['rock_a', 'rock_b', 'rock_c', 'rock_d'], (0.6, 1.4))):
        names = rng.choice(choices, m.sum())
        xs, zs = x[m], z[m]
        for k in choices:
            mm = names == k
            scale = rng.uniform(sc[0], sc[1], mm.sum())
            hgt = dims[k][2] * scale
            add(k, xs[mm], zs[mm], field.grid(field.h, xs[mm], zs[mm]) - hgt * 0.22, scale)
    # Soy bo'yida mayda toshlar
    x, z = candidates(field, 4.0)
    s = site(field, x, z)
    ok = (s['stream'] > 2.4) & (s['stream'] < 4.5) & (s['bridge'] > 6) & (s['path'] > 2.5)
    x, z = pick(x, z, ok, 0.35)
    names = rng.choice(['rock_a', 'rock_b', 'rock_c', 'rock_d'], len(x))
    for k in ('rock_a', 'rock_b', 'rock_c', 'rock_d'):
        m = names == k
        sc = rng.uniform(0.3, 0.7, m.sum())
        add(k, x[m], z[m], field.grid(field.h, x[m], z[m]) - dims[k][2] * sc * 0.3, sc)

    # --- to'nkalar, yiqilgan xodalar, quruq shoxlar
    for names, spacing, prob_k, sc, slope_max, sink in ((['stump_a', 'stump_b'], 15.0, 0.22, (0.8, 1.3), 0.4, 0.08),
                                                        (['log_a', 'log_b'], 17.0, 0.25, (0.9, 1.5), 0.22, 0.12),
                                                        (['branches_a', 'branches_b'], 6.0, 0.28, (0.9, 1.6), 0.45, 0.02)):
        x, z = candidates(field, spacing)
        s = site(field, x, z)
        ok = (s['fire'] > 20) & (s['path'] > 3) & (s['stream'] > 4) & (s['castle'] > 46) & (s['bridge'] > 8) & (s['slope'] < slope_max) & (s['camp'] > 2)
        x, z = pick(x, z, ok, prob_k * np.clip(s['dens'] * 1.4, 0, 1))
        pickn = rng.choice(names, len(x))
        for k in names:
            m = pickn == k
            add(k, x[m], z[m], field.grid(field.h, x[m], z[m]) - sink, rng.uniform(sc[0], sc[1], m.sum()))

    # --- yonuvchi qo'ziqorinlar: qalin o'rmonda va maydon chetida
    x, z = candidates(field, 13.0)
    s = site(field, x, z)
    ok = (s['fire'] > 20) & (s['path'] > 2.5) & (s['stream'] > 3) & (s['slope'] < 0.4) & (s['castle'] > 46)
    x, z = pick(x, z, ok, 0.18 * np.clip(s['dens'] * 1.5, 0, 1))
    a = rng.uniform(0, 2 * math.pi, 7)
    x = np.concatenate([x, np.cos(a) * rng.uniform(22, 27, 7)])
    z = np.concatenate([z, np.sin(a) * rng.uniform(22, 27, 7)])
    add('mushrooms', x, z, field.grid(field.h, x, z) - 0.01, rng.uniform(0.9, 1.6, len(x)))
    return inst


def main():
    reset_scene()
    objs, dims = import_props()
    objs.append(grass_clump())
    objs.append(mushrooms())
    dims['grass'] = [0.6, 0.6, 0.5]
    dims['mushrooms'] = [0.5, 0.5, 0.2]
    os.makedirs(os.path.join(OUT, 'models'), exist_ok=True)
    # Teksturali modellar (glTF ichida rasm bilan)
    select_only(objs)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'models', 'nature.glb'), export_format='GLB', use_selection=True,
                              export_apply=True, export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_image_format='AUTO', export_yup=True)
    trees_meta = json.load(open(os.path.join(OUT, 'trees.json')))
    field = Field()
    inst = scatter(field, dims, trees_meta)

    # Binar fayl: variantlar ketma-ket, har nusxa 5 float
    order = sorted(inst)
    offset = 0
    variants = []
    tree_r = {v['name']: v['trunkRadius'] for v in trees_meta['variants']}
    with open(os.path.join(OUT, 'nature.bin'), 'wb') as fp:
        for k in order:
            a = inst[k]
            fp.write(a.astype('<f4').tobytes())
            group = 'tree' if k in tree_r else 'rock' if k.startswith(('rock', 'boulder')) else 'wood' if k.startswith(('stump', 'log')) else 'plant'
            v = {'name': k, 'group': group, 'offset': offset, 'count': len(a), 'size': [round(d, 3) for d in dims.get(k, [1, 1, 1])]}
            if k in tree_r:
                v['collider'] = {'shape': 'cyl', 'radius': tree_r[k], 'height': 4.0}
            elif group == 'rock':
                d = dims[k]
                v['collider'] = {'shape': 'cyl', 'radius': round(0.38 * max(d[0], d[1]), 3), 'height': round(d[2], 3)}
            elif k.startswith('stump'):
                d = dims[k]
                v['collider'] = {'shape': 'cyl', 'radius': round(0.32 * max(d[0], d[1]), 3), 'height': round(d[2], 3)}
            elif k.startswith('log'):
                d = dims[k]
                v['collider'] = {'shape': 'box', 'half': [round(d[0] / 2 * 0.9, 3), round(d[2] / 2, 3), round(d[1] / 2 * 0.6, 3)]}
            variants.append(v)
            offset += len(a)
    with open(os.path.join(OUT, 'nature.json'), 'w') as fp:
        json.dump({'stride': 5, 'variants': variants}, fp, indent=1)
    for v in variants:
        print(f"[scatter] {v['name']:12s} {v['count']:6d}")
    print(f'[scatter] jami {offset} nusxa')


main()
