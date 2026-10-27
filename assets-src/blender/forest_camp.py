"""Gulxan maydoni (lager): o'choq, o'tirish to'nkalari, mato kino ekrani va lager buyumlari.

    blender -b --factory-startup -P assets-src/blender/forest_camp.py [-- --preview]

Natija (client/public/maps/forest):
    models/camp.glb   - barcha statik buyumlar (materiallar nomi bilan, teksturalar client'da);
                        "Screen" obyekti - video chiqadigan yuza (UV 0..1)
    camp.json         - to'qnashuv shakllari, chiroq nuqtalari (three.js koordinatalarida)
    layout.json       - o'tirish joylari (to'nkalar), gulxan, ekran, kirish joyi
--preview: assets-src/out/forest_camp.png (Cycles, teksturalar bilan)

Koordinatalar: Blender (x, y, z) = three.js (x, -z, y). Gulxan markazi - koordinata boshi.
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, OUT_DIR, MeshBuilder, export_glb, make_material, reset_scene, script_args  # noqa: E402

OUT = os.path.join(CLIENT_PUBLIC, 'maps', 'forest')
random.seed(23)

SCREEN_W, SCREEN_H = 8.0, 4.5
SCREEN_C = (0.0, 12.5, 3.9)          # Blender: ekran markazi (three: z = -12.5)
LOG_R = 0.24                          # o'tirish to'nkasi radiusi (usti ~0.45 m)
SEAT_GAP = 0.75

colliders = []   # three.js koordinatalarida
lights = {}


def j(a):
    return random.uniform(-a, a)


def three(v):
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def add_box_collider(center, half, yaw=0.0):
    """center/half Blender'da; yaw - Blender Z atrofida burilish"""
    colliders.append({'shape': 'box', 'center': three(center), 'half': [round(half[0], 3), round(half[2], 3), round(half[1], 3)], 'yaw': round(yaw, 4)})


def add_cyl_collider(base, radius, height):
    c = (base[0], base[1], base[2] + height / 2)
    colliders.append({'shape': 'cyl', 'center': three(c), 'radius': round(radius, 3), 'half': round(height / 2, 3)})


# ------------------------------------------------------------------ yordamchi geometriya
def log(mb, p0, p1, r, bark, end, segments=14, taper=0.92, wobble=0.012):
    """Po'stloqli xoda: kesilgan uchlari alohida material (yillik halqalar uchun)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation((p0 + p1) / 2) @ rot
    res = bmesh.ops.create_cone(mb.bm, cap_ends=True, cap_tris=False, segments=segments,
                                radius1=r, radius2=r * taper, depth=d.length, matrix=m)
    axis = d.normalized()
    bi, ei = mb.mi(bark), mb.mi(end)
    for v in res['verts']:
        # Po'stloq notekisligi
        n = noise.noise(v.co * 3.1) * wobble
        radial = (v.co - p0) - axis * (v.co - p0).dot(axis)
        if radial.length > 1e-4:
            v.co += radial.normalized() * n
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.normal_update()
        f.material_index = ei if abs(f.normal.dot(axis)) > 0.9 else bi
        f.smooth = abs(f.normal.dot(axis)) <= 0.9


def rock(mb, center, size, mat, seed=0, rough=0.28):
    """Notekis tosh: ikosfera + shovqin bilan siljitish."""
    m = Matrix.Translation(Vector(center)) @ Matrix.Rotation(random.uniform(0, 6.28), 4, 'Z') @ \
        Matrix.Diagonal((size[0], size[1], size[2], 1))
    res = bmesh.ops.create_icosphere(mb.bm, subdivisions=2, radius=1.0, matrix=m)
    c = Vector(center)
    off = Vector((seed * 7.1, seed * 3.3, seed * 1.7))
    for v in res['verts']:
        dvec = v.co - c
        k = 1 + rough * noise.noise(dvec * 2.2 + off) + 0.08 * noise.noise(dvec * 7 + off)
        v.co = c + dvec * k
    idx = mb.mi(mat)
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = idx
        f.smooth = True


def rope(mb, a, b, mat, r=0.012, sag=0.0, n=6):
    a, b = Vector(a), Vector(b)
    pts = [a.lerp(b, t / n) - Vector((0, 0, sag * math.sin(math.pi * t / n))) for t in range(n + 1)]
    for p, q in zip(pts, pts[1:]):
        mb.tube(p, q, r, mat, segments=6)


def cloth(mb, corners, mat, nu=16, nv=10, billow=0.0, normal=None, wave=0.0):
    """Mato: 4 burchak orasida to'r; billow - o'rtasi normal bo'ylab bo'rtadi, wave - mayda burmalar"""
    a, b, c, d = [Vector(p) for p in corners]
    nrm = Vector(normal) if normal else (b - a).cross(d - a).normalized()

    def fn(u, v):
        p = (a.lerp(b, u)).lerp(d.lerp(c, u), v)
        bump = math.sin(math.pi * u) * math.sin(math.pi * v) * billow + math.sin(u * 23 + v * 5) * wave * math.sin(math.pi * v)
        return p + nrm * bump
    mb.grid(fn, nu, nv, mat)


# ------------------------------------------------------------------ materiallar
def materials():
    M = {}
    for name, col, rough, metal in [
        ('Bark', (0.2, 0.15, 0.1), 0.95, 0), ('LogEnd', (0.55, 0.42, 0.28), 0.9, 0), ('Firewood', (0.16, 0.12, 0.08), 0.95, 0),
        ('Charcoal', (0.02, 0.02, 0.02), 0.75, 0), ('Ash', (0.32, 0.31, 0.3), 1.0, 0), ('Stone', (0.35, 0.36, 0.33), 0.9, 0),
        ('StoneSoot', (0.12, 0.12, 0.11), 0.9, 0), ('Wood', (0.32, 0.3, 0.27), 0.85, 0), ('Plank', (0.32, 0.3, 0.27), 0.85, 0),
        ('Rope', (0.42, 0.34, 0.22), 1.0, 0), ('Canvas', (0.78, 0.75, 0.68), 1.0, 0), ('TentCanvas', (0.36, 0.31, 0.24), 1.0, 0),
        ('Banner', (0.3, 0.04, 0.04), 1.0, 0), ('Iron', (0.12, 0.12, 0.13), 0.45, 1.0), ('Glow', (1.0, 0.7, 0.35), 0.5, 0),
        ('Screen', (0.05, 0.05, 0.06), 0.9, 0),
    ]:
        M[name] = make_material(name, col, rough=rough, metal=metal)
    M['Glow'].node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = (1.0, 0.62, 0.28, 1)
    M['Glow'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 6.0
    return M


# ------------------------------------------------------------------ qismlar
def fire_pit(M):
    mb = MeshBuilder('FirePit')
    # Tosh halqa (ichki tomoni qoraygan)
    n = 13
    for i in range(n):
        a = i / n * 2 * math.pi + j(0.08)
        r = 0.82 + j(0.04)
        s = (0.2 + j(0.04), 0.16 + j(0.03), 0.13 + j(0.03))
        rock(mb, (math.cos(a) * r, math.sin(a) * r, s[2] * 0.55), s, M['StoneSoot'] if i % 3 else M['Stone'], seed=i)
    # Ikkinchi qator mayda toshlar (tashqarida, yarim ko'milgan)
    for i in range(9):
        a = (i + 0.5) / 9 * 2 * math.pi
        rock(mb, (math.cos(a) * 1.05, math.sin(a) * 1.05, 0.03), (0.12, 0.1, 0.07), M['Stone'], seed=40 + i)
    # Kul yostig'i
    mb.cylinder((0, 0, 0.015), 0.68, 0.04, M['Ash'], segments=24)
    # Ko'mir bo'laklari
    for i in range(26):
        a, r = random.uniform(0, 6.28), random.uniform(0.05, 0.6)
        sz = random.uniform(0.03, 0.07)
        m = Matrix.Translation((math.cos(a) * r, math.sin(a) * r, 0.045)) @ Matrix.Rotation(j(3), 4, 'Z') @ Matrix.Rotation(j(0.5), 4, 'X')
        mb.box((-sz, -sz * 0.7, -sz * 0.5), (sz, sz * 0.7, sz * 0.5), M['Charcoal'], bevel=0.008, segments=1, matrix=m)
    # Yonayotgan o'tinlar: chayla (teepee) shaklida, uchlari ko'mirlangan
    for i in range(5):
        a = i / 5 * 2 * math.pi + 0.3
        base = Vector((math.cos(a) * 0.42, math.sin(a) * 0.42, 0.05))
        top = Vector((math.cos(a) * 0.06, math.sin(a) * 0.06, 0.62))
        mid = base.lerp(top, 0.45)
        r = 0.05 + j(0.012)
        log(mb, base, mid, r, M['Firewood'], M['Charcoal'], segments=8, taper=0.9)
        log(mb, mid, top, r * 0.9, M['Charcoal'], M['Charcoal'], segments=8, taper=0.6)
    # Pastda ko'ndalang yotgan ikki o'tin
    for a in (0.4, 2.1):
        d = Vector((math.cos(a), math.sin(a), 0))
        log(mb, d * -0.55 + Vector((0, 0, 0.08)), d * 0.55 + Vector((0, 0, 0.1)), 0.065, M['Firewood'], M['Charcoal'], segments=10)
    add_cyl_collider((0, 0, 0), 1.0, 0.55)
    lights['fire'] = three((0, 0, 0.55))
    return mb.build()


def seating(M):
    """Taqa shaklidagi to'nkalar; o'rindiqlar layout.json'ga yoziladi."""
    mb = MeshBuilder('SeatLogs')
    seats, logs = [], []

    def add(i, R, deg, n):
        t = math.radians(deg)
        # three.js: markaz (sin t * R, cos t * R) xz'da; Blender'da y = -z
        cx, cz = math.sin(t) * R, math.cos(t) * R
        tx, tz = math.cos(t), -math.sin(t)
        length = SEAT_GAP * n + 0.5 + j(0.15)
        c = Vector((cx, -cz, LOG_R * 0.88))
        dirb = Vector((tx, -tz, 0))
        r = LOG_R + j(0.02)
        p0, p1 = c - dirb * length / 2, c + dirb * length / 2
        log(mb, p0 + Vector((0, 0, j(0.02))), p1 + Vector((0, 0, j(0.02))), r, M['Bark'], M['LogEnd'], segments=16, taper=0.9, wobble=0.018)
        # Kesilgan shox qoldiqlari
        for k in range(2):
            q = p0.lerp(p1, random.uniform(0.15, 0.85))
            side = Vector((0, 0, 1)).cross(dirb).normalized() * random.choice((-1, 1))
            base = q + side * r * 0.8 + Vector((0, 0, -r * 0.2))
            log(mb, base, base + side * 0.1 + Vector((0, 0, 0.03)), 0.035, M['Bark'], M['LogEnd'], segments=6)
        logs.append({'id': f'L{i}', 'position': [round(cx, 3), 0.0, round(cz, 3)], 'yaw': round(t, 4), 'length': round(length, 3)})
        for k in range(n):
            o = (k - (n - 1) / 2) * SEAT_GAP
            seats.append({'id': f'L{i}-{k + 1}', 'row': f'L{i}', 'number': k + 1,
                          'position': [round(cx + tx * o, 3), 0.0, round(cz + tz * o, 3)], 'yaw': round(t, 4)})
        colliders.append({'shape': 'box', 'center': [round(cx, 3), round(LOG_R * 0.88, 3), round(cz, 3)],
                          'half': [round(length / 2, 3), round(LOG_R * 0.88, 3), round(r * 0.9, 3)], 'yaw': round(t, 4)})

    for i, deg in enumerate([-100, -50, 0, 50, 100]):
        add(i + 1, 3.8, deg, 3)
    for k, deg in enumerate([-24, 24]):
        add(6 + k, 6.6, deg, 3)
    return mb.build(), seats, logs


def screen_frame(M):
    """Ikki ustun orasiga arqon bilan tortilgan mato ekran."""
    mb = MeshBuilder('ScreenFrame')
    cx, cy, cz = SCREEN_C
    hw, hh = SCREEN_W / 2, SCREEN_H / 2
    px = hw + 0.42
    top = 6.7
    for s in (-1, 1):
        base = Vector((s * px, cy + 0.06, -0.3))
        log(mb, base, base + Vector((j(0.04), j(0.04), top + 0.55)), 0.13, M['Bark'], M['LogEnd'], segments=12, taper=0.85)
        add_cyl_collider((s * px, cy + 0.06, 0), 0.16, top)
        # Orqaga tortilgan tayanch arqon va qoziq
        stake = Vector((s * (px + 1.6), cy + 3.2, 0.0))
        rope(mb, (s * px, cy + 0.06, top), stake + Vector((0, 0, 0.25)), M['Rope'], r=0.014, sag=0.05, n=8)
        mb.box((-0.04, -0.04, -0.2), (0.04, 0.04, 0.32), M['Wood'], bevel=0.01, segments=1,
               matrix=Matrix.Translation(stake) @ Matrix.Rotation(0.3 * s, 4, 'Y'))
    # Yuqori ko'ndalang xoda
    log(mb, (-px - 0.25, cy + 0.06, top), (px + 0.25, cy + 0.06, top + 0.03), 0.09, M['Bark'], M['LogEnd'], segments=10)
    # Mato hoshiyasi (video yuzasidan biroz kattaroq, orqada)
    border = 0.22
    fy = cy + 0.025
    cloth(mb, [(-hw - border, fy, cz - hh - border), (hw + border, fy, cz - hh - border),
               (hw + border, fy, cz + hh + border), (-hw - border, fy, cz + hh + border)], M['Canvas'], nu=20, nv=12,
          normal=(0, 1, 0), wave=0.006)
    # Pastki tortqich xoda
    log(mb, (-hw - 0.1, cy + 0.08, cz - hh - border - 0.08), (hw + 0.1, cy + 0.08, cz - hh - border - 0.08), 0.045, M['Wood'], M['LogEnd'], segments=8)
    # Arqonlar: yuqori chetdan ko'ndalang xodaga (har ~1 m), yon chetlardan ustunlarga, pastdan qoziqlarga
    for k in range(9):
        x = -hw - border + k * (SCREEN_W + 2 * border) / 8
        rope(mb, (x, fy, cz + hh + border), (x * 1.02, cy + 0.06, top - 0.06), M['Rope'], r=0.01, n=2)
    for s in (-1, 1):
        for k in range(4):
            z = cz - hh + 0.3 + k * (SCREEN_H - 0.6) / 3
            rope(mb, (s * (hw + border), fy, z), (s * (px - 0.12), cy + 0.06, z + 0.05), M['Rope'], r=0.01, n=2)
        peg = Vector((s * (hw - 0.4), cy - 0.6, 0.0))
        rope(mb, (s * (hw - 0.4), cy + 0.08, cz - hh - border - 0.12), peg + Vector((0, 0, 0.2)), M['Rope'], r=0.01, n=3)
        mb.box((-0.03, -0.03, -0.15), (0.03, 0.03, 0.24), M['Wood'], bevel=0.008, segments=1, matrix=Matrix.Translation(peg))
    frame = mb.build()

    # Video yuzasi: alohida obyekt, UV 0..1 (pastki chap - (0, 0))
    sb = MeshBuilder('Screen')
    sb.grid(lambda u, v: Vector((-hw + u * SCREEN_W, cy, cz - hh + v * SCREEN_H)), 1, 1, M['Screen'])
    uv = sb.bm.loops.layers.uv.new('UVMap')
    for f in sb.bm.faces:
        for l in f.loops:
            l[uv].uv = ((l.vert.co.x + hw) / SCREEN_W, (l.vert.co.z - (cz - hh)) / SCREEN_H)
    me = bpy.data.meshes.new('Screen')
    sb.bm.normal_update()
    sb.bm.to_mesh(me)
    sb.bm.free()
    me.materials.append(M['Screen'])
    ob = bpy.data.objects.new('Screen', me)
    bpy.context.scene.collection.objects.link(ob)
    # Yuz -Y (Blender) = +Z (three) tomonga - o'tirganlarga qarasin
    if me.polygons[0].normal.y > 0:
        me.flip_normals()
    return frame, ob


def woodpile(M, at):
    mb = MeshBuilder('Woodpile')
    x0, y0 = at
    rows = [(5, 0.0), (4, 0.19), (3, 0.37), (2, 0.54)]
    for n, z in rows:
        for k in range(n):
            x = x0 + (k - (n - 1) / 2) * 0.2 + j(0.015)
            p0 = Vector((x, y0 - 0.6 + j(0.06), z + 0.1))
            p1 = Vector((x + j(0.03), y0 + 0.6 + j(0.06), z + 0.1 + j(0.02)))
            log(mb, p0, p1, 0.095 + j(0.012), M['Bark'], M['LogEnd'], segments=9)
    # Ikki tomonda tirgak qoziqlar
    for s in (-1, 1):
        mb.box((-0.04, -0.04, 0), (0.04, 0.04, 0.85), M['Wood'], bevel=0.01, segments=1,
               matrix=Matrix.Translation((x0 + s * 0.6, y0 + j(0.2), 0)))
    add_box_collider((x0, y0, 0.4), (0.62, 0.65, 0.4))
    # Kundak va unga sanchilgan bolta
    bx, by = x0 + 1.4, y0 - 1.1
    log(mb, (bx, by, 0.0), (bx, by, 0.48), 0.27, M['Bark'], M['LogEnd'], segments=16, taper=0.97)
    m = Matrix.Translation((bx + 0.04, by, 0.5)) @ Matrix.Rotation(0.35, 4, 'Y')
    mb.box((-0.11, -0.012, -0.06), (0.06, 0.012, 0.06), M['Iron'], bevel=0.005, segments=1, matrix=m)
    mb.tube(m @ Vector((0.03, 0, 0.0)), m @ Vector((0.03, 0, 0.0)) + Vector((0.42, 0.02, 0.38)) * 0.9, 0.018, M['Wood'], segments=8)
    add_cyl_collider((bx, by, 0), 0.3, 0.5)
    # Atrofga sochilgan yorilgan o'tinlar
    for k in range(4):
        q = Vector((bx + j(0.7), by + j(0.7), 0.05))
        d = Vector((math.cos(k * 1.7), math.sin(k * 1.7), 0)) * 0.22
        log(mb, q - d, q + d, 0.05, M['Bark'], M['LogEnd'], segments=6)
    return mb.build()


def tent(M, at, yaw):
    """A-shaklidagi chodir: ustunlar, mato, eshik pardasi, arqon va qoziqlar."""
    mb = MeshBuilder('Tent')
    R = Matrix.Translation((at[0], at[1], 0)) @ Matrix.Rotation(yaw, 4, 'Z')
    L, W, H = 3.2, 2.6, 2.1

    def P(x, y, z):
        return R @ Vector((x, y, z))
    for y in (-L / 2, L / 2):
        log(mb, P(0, y, -0.1), P(0, y, H + 0.15), 0.05, M['Wood'], M['LogEnd'], segments=8)
    log(mb, P(0, -L / 2 - 0.15, H), P(0, L / 2 + 0.15, H), 0.045, M['Wood'], M['LogEnd'], segments=8)
    for s in (-1, 1):
        cloth(mb, [P(s * W / 2, -L / 2, 0.05), P(s * W / 2, L / 2, 0.05), P(0, L / 2, H), P(0, -L / 2, H)], M['TentCanvas'],
              nu=12, nv=8, billow=-0.06 * s, normal=None, wave=0.004)
    # Orqa devor (yopiq) va old tomonda yarim ochilgan eshik pardalari
    cloth(mb, [P(-W / 2, L / 2, 0.05), P(W / 2, L / 2, 0.05), P(0, L / 2, H), P(0, L / 2, H)], M['TentCanvas'], nu=6, nv=6)
    cloth(mb, [P(-W / 2, -L / 2, 0.05), P(-0.25, -L / 2 - 0.25, 0.05), P(-0.02, -L / 2, H - 0.05), P(-0.02, -L / 2, H - 0.05)], M['TentCanvas'], nu=5, nv=6)
    cloth(mb, [P(W / 2 * 0.2, -L / 2 - 0.35, 0.05), P(W / 2, -L / 2, 0.05), P(0.02, -L / 2, H - 0.05), P(0.02, -L / 2, H - 0.05)], M['TentCanvas'], nu=5, nv=6)
    for s in (-1, 1):
        for y in (-L / 2 + 0.2, 0, L / 2 - 0.2):
            stake = P(s * (W / 2 + 0.9), y, 0)
            rope(mb, P(s * W / 4, y, H / 2 + 0.05), stake + Vector((0, 0, 0.18)), M['Rope'], r=0.009, sag=0.03, n=5)
            mb.box((-0.025, -0.025, -0.15), (0.025, 0.025, 0.2), M['Wood'], bevel=0.006, segments=1, matrix=Matrix.Translation(stake))
    add_box_collider((at[0], at[1], H / 2), (W / 2, L / 2, H / 2), yaw)
    return mb.build()


def barrel(mb, M, at, h=0.95, r=0.32):
    x, y = at

    def fn(u, v):
        a = u * 2 * math.pi
        rr = r * (1 + 0.13 * math.sin(math.pi * v))
        return Vector((x + math.cos(a) * rr, y + math.sin(a) * rr, v * h))
    mb.grid(fn, 20, 8, M['Plank'])
    for z in (0.08, 0.3, h - 0.3, h - 0.08):
        rr = r * (1 + 0.13 * math.sin(math.pi * z / h)) + 0.006
        mb.cylinder((x, y, z), rr, 0.035, M['Iron'], segments=20, cap=False)
    mb.cylinder((x, y, h - 0.02), r * 0.99, 0.03, M['Wood'], segments=20)
    add_cyl_collider((x, y, 0), r * 1.12, h)


def gear(M, at):
    """Qurol tokchasi (nayzalar, qalqon), bochkalar va yashik"""
    mb = MeshBuilder('Gear')
    x0, y0 = at
    # Tokcha: ikki ustun + ko'ndalang xoda
    for s in (-1, 1):
        mb.box((-0.05, -0.05, 0), (0.05, 0.05, 1.45), M['Wood'], bevel=0.01, segments=1, matrix=Matrix.Translation((x0 + s * 0.8, y0, 0)))
    log(mb, (x0 - 0.9, y0, 1.3), (x0 + 0.9, y0, 1.3), 0.04, M['Wood'], M['LogEnd'], segments=8)
    log(mb, (x0 - 0.9, y0 + 0.02, 0.35), (x0 + 0.9, y0 + 0.02, 0.35), 0.035, M['Wood'], M['LogEnd'], segments=8)
    for k, xo in enumerate((-0.45, -0.1, 0.3)):
        b = Vector((x0 + xo, y0 + 0.35, 0.0))
        t = Vector((x0 + xo + 0.05, y0 - 0.06, 2.25))
        mb.tube(b, t, 0.018, M['Wood'], segments=8)
        d = (t - b).normalized()
        # Nayza uchi
        m = Matrix.Translation(t + d * 0.14) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        res = bmesh.ops.create_cone(mb.bm, cap_ends=True, cap_tris=True, segments=4, radius1=0.035, radius2=0.0, depth=0.28, matrix=m)
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = mb.mi(M['Iron'])
    # Qalqon tokchaga suyangan
    shield_m = Matrix.Translation((x0 + 0.55, y0 - 0.22, 0.42)) @ Matrix.Rotation(math.pi / 2 - 0.25, 4, 'X')
    res = bmesh.ops.create_cone(mb.bm, cap_ends=True, cap_tris=False, segments=28, radius1=0.4, radius2=0.4, depth=0.035, matrix=shield_m)
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mb.mi(M['Plank'])
    res = bmesh.ops.create_cone(mb.bm, cap_ends=False, cap_tris=False, segments=28, radius1=0.415, radius2=0.415, depth=0.05, matrix=shield_m)
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mb.mi(M['Iron'])
    boss = shield_m @ Matrix.Translation((0, 0, -0.03))
    res = bmesh.ops.create_uvsphere(mb.bm, u_segments=12, v_segments=6, radius=0.08, matrix=boss @ Matrix.Diagonal((1, 1, 0.5, 1)))
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mb.mi(M['Iron'])
        f.smooth = True
    add_box_collider((x0, y0, 0.7), (0.95, 0.35, 0.7))
    # Bochkalar va yashik
    barrel(mb, M, (x0 + 2.0, y0 + 0.5))
    barrel(mb, M, (x0 + 2.55, y0 - 0.2), h=0.9, r=0.3)
    cx, cy = x0 + 2.3, y0 + 1.35
    for z in range(4):
        mb.box((-0.38, -0.3, 0), (0.38, 0.3, 0.13), M['Plank'], bevel=0.008, segments=1,
               matrix=Matrix.Translation((cx, cy, z * 0.14 + 0.005)) @ Matrix.Rotation(0.2, 4, 'Z'))
    for s in (-1, 1):
        for t in (-1, 1):
            mb.box((-0.03, -0.03, 0), (0.03, 0.03, 0.57), M['Wood'], bevel=0.005, segments=1,
                   matrix=Matrix.Translation((cx, cy, 0)) @ Matrix.Rotation(0.2, 4, 'Z') @ Matrix.Translation((s * 0.36, t * 0.28, 0)))
    add_box_collider((cx, cy, 0.29), (0.4, 0.32, 0.29), 0.2)
    return mb.build()


def banner(M, at):
    mb = MeshBuilder('Banner')
    x, y = at
    log(mb, (x, y, -0.3), (x, y, 4.2), 0.06, M['Wood'], M['LogEnd'], segments=10, taper=0.85)
    log(mb, (x - 0.55, y, 3.95), (x + 0.55, y, 3.95), 0.03, M['Wood'], M['LogEnd'], segments=8)
    cloth(mb, [(x - 0.5, y + 0.02, 1.7), (x + 0.5, y + 0.02, 1.6), (x + 0.5, y + 0.02, 3.93), (x - 0.5, y + 0.02, 3.93)],
          M['Banner'], nu=8, nv=14, normal=(0, 1, 0), wave=0.035)
    # Uchburchak quyruq
    cloth(mb, [(x - 0.5, y + 0.02, 1.7), (x, y + 0.02, 1.25), (x + 0.5, y + 0.02, 1.6), (x + 0.5, y + 0.02, 1.6)], M['Banner'], nu=4, nv=2)
    add_cyl_collider((x, y, 0), 0.12, 4.0)
    return mb.build()


def lantern_post(M, at):
    mb = MeshBuilder('LanternPost')
    x, y = at
    log(mb, (x, y, -0.3), (x, y, 2.5), 0.07, M['Wood'], M['LogEnd'], segments=10, taper=0.9)
    log(mb, (x, y, 2.3), (x + 0.6, y, 2.3), 0.035, M['Wood'], M['LogEnd'], segments=8)
    lx, lz = x + 0.55, 1.95
    mb.tube((lx, y, 2.27), (lx, y, lz + 0.2), 0.006, M['Iron'], segments=5)
    # Fonar: temir ramka, ichida yonib turgan shisha
    mb.box((-0.09, -0.09, -0.01), (0.09, 0.09, 0.01), M['Iron'], matrix=Matrix.Translation((lx, y, lz - 0.14)))
    mb.box((-0.07, -0.07, -0.12), (0.07, 0.07, 0.12), M['Glow'], matrix=Matrix.Translation((lx, y, lz)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.box((-0.008, -0.008, -0.13), (0.008, 0.008, 0.13), M['Iron'], matrix=Matrix.Translation((lx + sx * 0.075, y + sy * 0.075, lz)))
    res = bmesh.ops.create_cone(mb.bm, cap_ends=True, cap_tris=True, segments=4, radius1=0.13, radius2=0.0, depth=0.12,
                                matrix=Matrix.Translation((lx, y, lz + 0.18)) @ Matrix.Rotation(math.pi / 4, 4, 'Z'))
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = mb.mi(M['Iron'])
    add_cyl_collider((x, y, 0), 0.12, 2.5)
    lights['lantern'] = three((lx, y, lz))
    return mb.build()


def build():
    reset_scene()
    M = materials()
    objs = [fire_pit(M)]
    seat_ob, seats, logs = seating(M)
    objs.append(seat_ob)
    frame, scr = screen_frame(M)
    objs += [frame, scr]
    objs.append(woodpile(M, (-6.2, 3.4)))
    objs.append(tent(M, (13.5, -7.5), math.radians(-70)))
    objs.append(gear(M, (10.0, -11.5)))
    objs.append(banner(M, (-10.5, -4.0)))
    objs.append(lantern_post(M, (-5.0, 8.0)))

    os.makedirs(os.path.join(OUT, 'models'), exist_ok=True)
    export_glb(objs, os.path.join(OUT, 'models', 'camp.glb'))
    with open(os.path.join(OUT, 'camp.json'), 'w') as fp:
        json.dump({'colliders': colliders, 'lights': lights}, fp, indent=1)
    layout = {
        'seats': seats, 'logs': logs, 'fire': [0.0, 0.0, 0.0],
        'screen': {'center': [SCREEN_C[0], SCREEN_C[2], -SCREEN_C[1]], 'width': SCREEN_W, 'height': SCREEN_H},
        'spawn': {'position': [0, 0, 15], 'lookAt': [0, 1.2, 0], 'radius': 1.5},
        'bounds': {'min': [-250, -250], 'max': [250, 250]},
    }
    with open(os.path.join(OUT, 'layout.json'), 'w') as fp:
        json.dump(layout, fp, indent=1)
    tris = sum(len(o.data.polygons) for o in objs)
    print(f'[camp] {len(objs)} obyekt, {tris} yuz, {len(seats)} o\'rindiq, {len(colliders)} to\'qnashuv shakli')
    return objs


def preview(objs):
    T = os.path.join(CLIENT_PUBLIC, 'maps', 'forest', 'textures')
    H = os.path.join(CLIENT_PUBLIC, 'textures')
    tex = {
        'Bark': (os.path.join(T, 'bark_brown_02'), 1.0, True, None), 'Firewood': (os.path.join(T, 'bark_brown_02'), 0.8, True, 0.6),
        'LogEnd': (os.path.join(T, 'rough_wood'), 0.5, False, (1.2, 1.0, 0.75)), 'Wood': (os.path.join(T, 'rough_wood'), 1.0, False, None),
        'Plank': (os.path.join(T, 'rough_wood'), 1.0, True, None), 'Stone': (os.path.join(T, 'mossy_rock'), 1.0, False, None),
        'StoneSoot': (os.path.join(T, 'mossy_rock'), 1.0, False, 0.35), 'Canvas': (os.path.join(H, 'hessian_380'), 0.6, False, (1.5, 1.45, 1.3)),
        'TentCanvas': (os.path.join(H, 'hessian_380'), 0.6, False, (0.8, 0.7, 0.55)), 'Banner': (os.path.join(H, 'hessian_380'), 0.6, False, (0.7, 0.08, 0.08)),
    }
    for m in bpy.data.materials:
        if m.name not in tex:
            continue
        d, tile, turn, tint = tex[m.name]
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        uv = nt.nodes.new('ShaderNodeUVMap')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        mp.inputs['Rotation'].default_value = (0, 0, math.pi / 2 if turn else 0)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
        di = nt.nodes.new('ShaderNodeTexImage')
        di.image = bpy.data.images.load(os.path.join(d, 'diff.jpg'), check_existing=True)
        nt.links.new(mp.outputs['Vector'], di.inputs['Vector'])
        col = di.outputs['Color']
        if tint is not None:
            mul = nt.nodes.new('ShaderNodeMix')
            mul.data_type = 'RGBA'
            mul.blend_type = 'MULTIPLY'
            mul.inputs['Factor'].default_value = 1.0
            nt.links.new(col, mul.inputs[6])
            t = tint if isinstance(tint, tuple) else (tint, tint, tint)
            mul.inputs[7].default_value = (*t, 1)
            col = mul.outputs[2]
        nt.links.new(col, bsdf.inputs['Base Color'])
        ni = nt.nodes.new('ShaderNodeTexImage')
        ni.image = bpy.data.images.load(os.path.join(d, 'nor.jpg'), check_existing=True)
        ni.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(mp.outputs['Vector'], ni.inputs['Vector'])
        nt.links.new(ni.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    # Ekran: kutish tasviri o'rniga yorug' kulrang
    scr = bpy.data.materials['Screen'].node_tree.nodes['Principled BSDF']
    scr.inputs['Emission Color'].default_value = (0.25, 0.3, 0.45, 1)
    scr.inputs['Emission Strength'].default_value = 1.5

    scene = bpy.context.scene
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
    g = bpy.context.active_object
    gm = make_material('PreviewGround', (0.06, 0.07, 0.045), rough=1)
    g.data.materials.append(gm)
    moon = bpy.data.objects.new('Moon', bpy.data.lights.new('Moon', 'SUN'))
    moon.data.energy = 0.25
    moon.data.color = (0.6, 0.7, 1.0)
    moon.rotation_euler = (math.radians(55), 0, math.radians(200))
    scene.collection.objects.link(moon)
    fire = bpy.data.objects.new('Fire', bpy.data.lights.new('Fire', 'POINT'))
    fire.data.energy = 900
    fire.data.color = (1.0, 0.5, 0.2)
    fire.data.shadow_soft_size = 0.3
    fire.location = (0, 0, 0.7)
    scene.collection.objects.link(fire)
    lan = bpy.data.objects.new('Lantern', bpy.data.lights.new('Lantern', 'POINT'))
    lan.data.energy = 40
    lan.data.color = (1.0, 0.6, 0.3)
    l3 = lights['lantern']
    lan.location = (l3[0], -l3[2], l3[1])
    scene.collection.objects.link(lan)
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.004, 0.006, 0.012, 1)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 26
    cam.location = (4.5, -10.5, 2.6)
    cam.rotation_euler = (Vector((-0.5, 4.0, 1.6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 1.0
    scene.render.filepath = os.path.join(OUT_DIR, 'forest_camp.png')
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'forest_camp.blend'))


objs = build()
if '--preview' in script_args():
    preview(objs)
