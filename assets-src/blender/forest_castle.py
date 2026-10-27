"""Qasr: tepalikdagi plato ustida devorlar, minoralar, darvoza va asosiy minora (keep).

    blender -b --factory-startup -P assets-src/blender/forest_castle.py [-- --preview]

Natija (client/public/maps/forest):
    models/castle.glb - materiallar nomi bilan (teksturalar client'da): CastleStone, CastleBase, Roof, Slit,
                        WindowGlow, WindowDark, Iron, Wood, Banner, Cobble, TorchHead
    castle.json       - to'qnashuv shakllari, mash'ala nuqtalari (three.js koordinatalarida)
Plato markazi va balandligi terrain.json'dan olinadi (forest_terrain.py).
Koordinatalar: Blender (x, y, z) = three.js (x, -z, y).
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, OUT_DIR, MeshBuilder, export_glb, make_material, reset_scene, script_args  # noqa: E402

OUT = os.path.join(CLIENT_PUBLIC, 'maps', 'forest')
meta = json.load(open(os.path.join(OUT, 'terrain.json')))
C3 = meta['castle']['center']                     # three.js [x, y, z]
CX, CY, BASE = C3[0], -C3[2], C3[1]               # Blender markaz va plato balandligi
random.seed(31)

WALL_H = 10.0
WALL_T = 2.4
TOWER_R = 3.8
TOWER_H = 15.5

colliders = []
torches = []


def j(a):
    return random.uniform(-a, a)


def three(v):
    return [round(v[0], 3), round(v[2], 3), round(-v[1], 3)]


def P(ang_deg, r):
    """three.js burchagi (x = cos, z = sin) va radius -> Blender nuqta (markazga nisbatan)"""
    a = math.radians(ang_deg)
    return Vector((CX + math.cos(a) * r, CY - math.sin(a) * r, BASE))


def add_box(center, half, yaw):
    colliders.append({'shape': 'box', 'center': three(center), 'half': [round(half[0], 3), round(half[2], 3), round(half[1], 3)], 'yaw': round(yaw, 4)})


def add_cyl(base, radius, height):
    colliders.append({'shape': 'cyl', 'center': three(Vector(base) + Vector((0, 0, height / 2))), 'radius': round(radius, 3), 'half': round(height / 2, 3)})


def oriented_box(mb, center, size, yaw, mat, bevel=0.0):
    """size = (uzunlik X, qalinlik Y, balandlik Z) - markazdan; yaw - Blender Z atrofida"""
    m = Matrix.Translation(center) @ Matrix.Rotation(yaw, 4, 'Z')
    sx, sy, sz = size
    mb.box((-sx / 2, -sy / 2, -sz / 2), (sx / 2, sy / 2, sz / 2), mat, bevel=bevel, segments=1, matrix=m)


def cylinder(mb, base, r, h, mat, seg=24, r2=None, cap=True):
    mb.cylinder((base[0], base[1], base[2] + h / 2), r, h, mat, segments=seg, cap=cap, radius2=r2)


def cloth(mb, corners, mat, nu=8, nv=12, wave=0.0):
    a, b, c, d = [Vector(p) for p in corners]
    nrm = (b - a).cross(d - a).normalized()

    def fn(u, v):
        p = (a.lerp(b, u)).lerp(d.lerp(c, u), v)
        return p + nrm * (math.sin(u * 7 + v * 3) * wave * (1 - v))
    mb.grid(fn, nu, nv, mat)


# ------------------------------------------------------------------ materiallar
def materials():
    M = {}
    for name, col, rough, metal in [
        ('CastleStone', (0.32, 0.31, 0.29), 0.9, 0), ('CastleBase', (0.24, 0.26, 0.21), 0.95, 0), ('Roof', (0.08, 0.09, 0.1), 0.7, 0),
        ('Slit', (0.01, 0.01, 0.01), 1.0, 0), ('WindowDark', (0.02, 0.02, 0.025), 0.3, 0), ('Iron', (0.1, 0.1, 0.11), 0.5, 1.0),
        ('Wood', (0.22, 0.16, 0.1), 0.85, 0), ('Banner', (0.3, 0.04, 0.04), 1.0, 0), ('Cobble', (0.3, 0.3, 0.29), 0.9, 0),
        ('WindowGlow', (1.0, 0.62, 0.3), 0.5, 0), ('TorchHead', (1.0, 0.5, 0.2), 0.5, 0),
    ]:
        M[name] = make_material(name, col, rough=rough, metal=metal)
    for k, s in (('WindowGlow', 4.0), ('TorchHead', 8.0)):
        b = M[k].node_tree.nodes['Principled BSDF']
        b.inputs['Emission Color'].default_value = (*M[k].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value[:3], 1)
        b.inputs['Emission Strength'].default_value = s
    return M


# ------------------------------------------------------------------ qismlar
def crenellate_line(mb, a, b, z, mat, outward, merlon=1.0, gap=0.75, h=0.95, t=0.55):
    """a -> b chiziq bo'ylab tishli parapet; outward - tashqi tomonga birlik vektor"""
    d = b - a
    L = d.length
    dirv = d.normalized()
    yaw = math.atan2(dirv.y, dirv.x)
    n = max(1, int((L + gap) / (merlon + gap)))
    pad = (L - (n * merlon + (n - 1) * gap)) / 2
    for i in range(n):
        s = pad + i * (merlon + gap) + merlon / 2
        c = a + dirv * s + outward * 0.0 + Vector((0, 0, z + h / 2))
        oriented_box(mb, c, (merlon, t, h), yaw, mat, bevel=0.03)
    # Parapet osti (yaxlit past devorcha)
    oriented_box(mb, a.lerp(b, 0.5) + Vector((0, 0, z + 0.25)), (L, t, 0.5), yaw, mat)


def wall_segment(mb, M, a, b, centroid, cut_gate=False):
    """Ikki minora markazi orasidagi devor (pastki moxli qiya qism + asosiy devor + tishli parapet)"""
    d = b - a
    L = d.length
    dirv = d.normalized()
    yaw = math.atan2(dirv.y, dirv.x)
    mid = a.lerp(b, 0.5)
    out = Vector((dirv.y, -dirv.x, 0))
    if out.dot(mid - centroid) < 0:
        out = -out
    inner_len = L - 2 * TOWER_R * 0.6
    pieces = [(mid, inner_len)]
    if cut_gate:
        # Darvoza minoralari egallagan joy (o'rtada 11 m) devorsiz
        half_gap = 5.5
        l1 = inner_len / 2 - half_gap
        pieces = [(mid - dirv * (half_gap + l1 / 2), l1), (mid + dirv * (half_gap + l1 / 2), l1)]
    for c, ln in pieces:
        # Pastki qiya qism (batter)
        base = mb.box((-ln / 2, -WALL_T / 2 - 0.45, 0), (ln / 2, WALL_T / 2 + 0.45, 2.2), M['CastleBase'],
                      matrix=Matrix.Translation(c + Vector((0, 0, -1.6))) @ Matrix.Rotation(yaw, 4, 'Z'))
        for v in base:
            if v.co.z > c.z + 0.2:
                # Yuqori qirralari ichkariga (qiyalik)
                lv = Matrix.Rotation(-yaw, 4, 'Z') @ (v.co - c)
                lv.y *= (WALL_T / 2) / (WALL_T / 2 + 0.45)
                v.co = c + Matrix.Rotation(yaw, 4, 'Z') @ lv
        oriented_box(mb, c + Vector((0, 0, 0.6 + (WALL_H - 0.6) / 2)), (ln, WALL_T, WALL_H - 0.6), yaw, M['CastleStone'])
        # Tishlar tashqi chetda, ichkarida past parapet
        a2 = c - dirv * ln / 2 + out * (WALL_T / 2 - 0.28)
        b2 = c + dirv * ln / 2 + out * (WALL_T / 2 - 0.28)
        crenellate_line(mb, a2, b2, WALL_H, M['CastleStone'], out)
        ai = c - dirv * ln / 2 - out * (WALL_T / 2 - 0.2)
        oriented_box(mb, ai.lerp(ai + dirv * ln, 0.5) + Vector((0, 0, WALL_H + 0.45)), (ln, 0.4, 0.9), yaw, M['CastleStone'])
        # Shinaklar (tashqi yuzada)
        k = int(ln / 4.5)
        for i in range(k):
            s = (i + 0.5) / k - 0.5
            p = c + dirv * s * ln + out * (WALL_T / 2 + 0.01) + Vector((0, 0, 6.2))
            oriented_box(mb, p, (0.14, 0.06, 1.3), yaw, M['Slit'])
        add_box(c + Vector((0, 0, WALL_H / 2 - 0.5)), (ln / 2, WALL_T / 2 + 0.3, WALL_H / 2 + 0.5), yaw)


def round_tower(mb, M, p, roof):
    cylinder(mb, p + Vector((0, 0, -1.6)), TOWER_R + 0.7, 3.8, M['CastleBase'], seg=28, r2=TOWER_R)
    cylinder(mb, p + Vector((0, 0, 2.2)), TOWER_R, TOWER_H - 2.2, M['CastleStone'], seg=28)
    top = TOWER_H
    # Konsolli yuqori qism (machicolation): biroz kengroq halqa
    cylinder(mb, p + Vector((0, 0, top - 0.8)), TOWER_R + 0.45, 0.8, M['CastleStone'], seg=28, r2=TOWER_R + 0.45)
    for i in range(14):
        a = i / 14 * 2 * math.pi
        c = p + Vector((math.cos(a) * (TOWER_R + 0.25), math.sin(a) * (TOWER_R + 0.25), top - 1.25))
        oriented_box(mb, c, (0.35, 0.5, 0.7), a + math.pi / 2, M['CastleStone'])
    if roof:
        cylinder(mb, p + Vector((0, 0, top)), TOWER_R + 0.4, 1.0, M['CastleStone'], seg=28)
        cylinder(mb, p + Vector((0, 0, top + 1.0)), TOWER_R + 0.9, 7.5, M['Roof'], seg=28, r2=0.05)
        mb.tube(p + Vector((0, 0, top + 8.4)), p + Vector((0, 0, top + 10.2)), 0.05, M['Iron'], segments=6)
    else:
        for i in range(12):
            a = i / 12 * 2 * math.pi
            c = p + Vector((math.cos(a) * (TOWER_R + 0.15), math.sin(a) * (TOWER_R + 0.15), top + 0.45))
            oriented_box(mb, c, (0.95, 0.55, 0.9), a + math.pi / 2, M['CastleStone'], bevel=0.03)
    # Shinaklar
    for i in range(4):
        a = i / 4 * 2 * math.pi + 0.4
        for z in (5.0, 9.5):
            c = p + Vector((math.cos(a) * (TOWER_R + 0.01), math.sin(a) * (TOWER_R + 0.01), z))
            oriented_box(mb, c, (0.06, 0.14, 1.2), a, M['Slit'])
    add_cyl(p + Vector((0, 0, -1)), TOWER_R + 0.4, TOWER_H + 1)


def gatehouse(mb, M, a, b, centroid):
    """Devor o'rtasidagi darvoza: ikki kvadrat minora, ravoq, temir panjara, yopiq eshik, mash'alalar"""
    dirv = (b - a).normalized()
    mid = a.lerp(b, 0.5)
    yaw = math.atan2(dirv.y, dirv.x)
    out = Vector((dirv.y, -dirv.x, 0))
    if out.dot(mid - centroid) < 0:
        out = -out
    R = Matrix.Rotation(yaw, 4, 'Z')
    W, D, H = 5.0, 6.5, 14.0      # minora eni (devor bo'ylab), chuqurligi, balandligi
    gate_w, gate_h = 4.0, 5.6
    for s in (-1, 1):
        c = mid + dirv * s * (gate_w / 2 + W / 2) + out * 0.8
        mb.box((-W / 2 - 0.4, -D / 2 - 0.4, -1.6), (W / 2 + 0.4, D / 2 + 0.4, 2.0), M['CastleBase'], matrix=Matrix.Translation(c) @ R)
        mb.box((-W / 2, -D / 2, 2.0), (W / 2, D / 2, H), M['CastleStone'], matrix=Matrix.Translation(c) @ R)
        # Tishlar (to'rt tomon)
        corners = [Vector((-W / 2, -D / 2, 0)), Vector((W / 2, -D / 2, 0)), Vector((W / 2, D / 2, 0)), Vector((-W / 2, D / 2, 0))]
        wc = [c + R @ q for q in corners]
        for k in range(4):
            e0, e1 = wc[k], wc[(k + 1) % 4]
            o = (e0.lerp(e1, 0.5) - c)
            o.z = 0
            crenellate_line(mb, e0, e1, H, M['CastleStone'], o.normalized(), merlon=0.9, gap=0.7)
        # Shinaklar va bitta yoritilgan deraza
        for z in (6.0, 10.0):
            p = c + out * (D / 2 + 0.01) + Vector((0, 0, z))
            oriented_box(mb, p, (0.14, 0.06, 1.3), yaw, M['Slit'])
        p = c + out * (D / 2 + 0.02) + Vector((0, 0, 11.6))
        oriented_box(mb, p, (0.6, 0.06, 1.0), yaw, M['WindowGlow'] if s > 0 else M['WindowDark'])
        # Osilgan bayroq
        top = c + out * (D / 2 + 0.06) + Vector((0, 0, H - 0.6))
        l, r = top - dirv * 0.75, top + dirv * 0.75
        cloth(mb, [l - Vector((0, 0, 4.2)), r - Vector((0, 0, 4.2)), r, l], M['Banner'], wave=0.04)
        mb.tube(l + Vector((0, 0, 0.05)) - dirv * 0.1, r + Vector((0, 0, 0.05)) + dirv * 0.1, 0.04, M['Wood'], segments=6)
        # Mash'ala (darvoza yonida, tashqi devorda)
        tp = mid + dirv * s * (gate_w / 2 + 0.9) + out * (0.8 + D / 2 + 0.25) + Vector((0, 0, 3.6))
        mb.tube(tp - out * 0.25 - Vector((0, 0, 0.2)), tp, 0.03, M['Iron'], segments=6)
        mb.tube(tp - Vector((0, 0, 0.55)), tp + Vector((0, 0, 0.05)), 0.035, M['Wood'], segments=6)
        cylinder(mb, tp + Vector((0, 0, 0.0)), 0.07, 0.16, M['TorchHead'], seg=8)
        torches.append(three(tp + Vector((0, 0, 0.18))))
        add_box(c + Vector((0, 0, H / 2 - 1)), (W / 2 + 0.4, D / 2 + 0.4, H / 2 + 1), yaw)
    # Ravoq ustidagi ko'prik qism (minoralar orasini birlashtiradi)
    span = mid + out * 0.8
    mb.box((-gate_w / 2, -D / 2, gate_h + 0.9), (gate_w / 2, D / 2, H - 1.5), M['CastleStone'], matrix=Matrix.Translation(span) @ R)
    crenellate_line(mb, span + R @ Vector((-gate_w / 2, D / 2 - 0.3, 0)) - Vector((0, 0, 1.5)),
                    span + R @ Vector((gate_w / 2, D / 2 - 0.3, 0)) - Vector((0, 0, 1.5)), H - 1.5, M['CastleStone'], out)
    # Ravoq (yarim aylana gumbaz) - ikki yon ustundan ko'tariladi
    n = 10
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        x0, z0 = math.cos(a0) * gate_w / 2, gate_h - gate_w / 2 + math.sin(a0) * gate_w / 2 + 0.9
        x1, z1 = math.cos(a1) * gate_w / 2, gate_h - gate_w / 2 + math.sin(a1) * gate_w / 2 + 0.9
        c0 = Vector(((x0 + x1) / 2, 0, (z0 + z1) / 2))
        lx = math.hypot(x1 - x0, z1 - z0)
        m = Matrix.Translation(span + R @ c0) @ R @ Matrix.Rotation(-math.atan2(z1 - z0, x1 - x0), 4, 'Y')
        mb.box((-lx / 2 - 0.02, -D / 2, 0), (lx / 2 + 0.02, D / 2, 0.55), M['CastleStone'], matrix=m)
    # Temir panjara (tushirilgan) va ortida yopiq eman eshik
    gp = span + out * (D / 2 - 0.9)
    for i in range(7):
        x = -gate_w / 2 + 0.3 + i * (gate_w - 0.6) / 6
        mb.box((-0.05, -0.05, 0), (0.05, 0.05, gate_h + 0.5), M['Iron'], matrix=Matrix.Translation(gp) @ R @ Matrix.Translation((x, 0, 0)))
    for k in range(6):
        z = 0.5 + k * gate_h / 6
        mb.box((-gate_w / 2, -0.04, z), (gate_w / 2, 0.04, z + 0.08), M['Iron'], matrix=Matrix.Translation(gp) @ R)
    for i in range(7):
        res = bmesh.ops.create_cone(mb.bm, cap_ends=True, cap_tris=True, segments=4, radius1=0.07, radius2=0, depth=0.25,
                                    matrix=Matrix.Translation(gp + R @ Vector((-gate_w / 2 + 0.3 + i * (gate_w - 0.6) / 6, 0, -0.1))) @ Matrix.Rotation(math.pi, 4, 'X'))
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = mb.mi(M['Iron'])
    door = span - out * (D / 2 - 0.6)
    for i in range(9):
        x = -gate_w / 2 + (i + 0.5) * gate_w / 9
        mb.box((-gate_w / 18 + 0.01, -0.12, 0), (gate_w / 18 - 0.01, 0.12, gate_h + 0.9 + math.sqrt(max(0, (gate_w / 2) ** 2 - x * x)) - 0.3),
               M['Wood'], matrix=Matrix.Translation(door) @ R @ Matrix.Translation((x, 0, 0)))
    for z in (1.2, 4.2):
        mb.box((-gate_w / 2, -0.18, z), (gate_w / 2, -0.12, z + 0.18), M['Iron'], matrix=Matrix.Translation(door) @ R)
    # Darvoza oldidagi tosh yo'lak
    # (plato chetidan chiqmasligi uchun qisqa)
    pave = mid + out * (D / 2 + 3.6) + Vector((0, 0, 0.0))
    mb.box((-3.2, -3.2, -0.3), (3.2, 3.2, 0.015), M['Cobble'], matrix=Matrix.Translation(pave) @ R)
    # Ichkariga o'tib bo'lmaydi: panjara joyida to'siq
    add_box(gp + Vector((0, 0, gate_h / 2)), (gate_w / 2, 0.3, gate_h / 2 + 1), yaw)


def keep(mb, M, c):
    """Asosiy minora: to'rtburchak bino, burchak minorachalari, baland minora, yoritilgan derazalar"""
    W, D, H = 16.0, 13.0, 21.0
    mb.box((-W / 2 - 0.5, -D / 2 - 0.5, -1.5), (W / 2 + 0.5, D / 2 + 0.5, 2.5), M['CastleBase'], matrix=Matrix.Translation(c))
    mb.box((-W / 2, -D / 2, 2.5), (W / 2, D / 2, H), M['CastleStone'], matrix=Matrix.Translation(c))
    corners = [Vector((-W / 2, -D / 2, 0)), Vector((W / 2, -D / 2, 0)), Vector((W / 2, D / 2, 0)), Vector((-W / 2, D / 2, 0))]
    for k in range(4):
        e0, e1 = c + corners[k], c + corners[(k + 1) % 4]
        o = (e0.lerp(e1, 0.5) - c)
        o.z = 0
        crenellate_line(mb, e0, e1, H, M['CastleStone'], o.normalized())
    # Derazalar: 3 qavat, ba'zilari yonib turadi
    rng = random.Random(7)
    for k in range(4):
        e0, e1 = c + corners[k], c + corners[(k + 1) % 4]
        d = (e1 - e0)
        L = d.length
        dirv = d.normalized()
        yaw = math.atan2(dirv.y, dirv.x)
        o = Vector((dirv.y, -dirv.x, 0))
        if o.dot(e0.lerp(e1, 0.5) - c) < 0:
            o = -o
        n = int(L / 3.4)
        for fl, z in enumerate((7.0, 11.5, 16.0)):
            for i in range(n):
                p = e0 + dirv * ((i + 0.5) * L / n) + o * 0.02 + Vector((0, 0, z))
                lit = rng.random() < (0.35 if fl < 2 else 0.5)
                # Gotik deraza: to'rtburchak + ustida uchburchak qism
                oriented_box(mb, p, (0.75, 0.06, 1.6), yaw, M['WindowGlow'] if lit else M['WindowDark'])
                oriented_box(mb, p + Vector((0, 0, 0.95)), (0.5, 0.06, 0.3), yaw, M['WindowGlow'] if lit else M['WindowDark'])
                oriented_box(mb, p + o * 0.08 - Vector((0, 0, 0.9)), (1.0, 0.25, 0.14), yaw, M['CastleStone'])
    # Burchak minorachalari (konus tomli)
    for q in corners:
        p = c + q * 1.02
        cylinder(mb, p + Vector((0, 0, H - 4)), 1.7, 8.5, M['CastleStone'], seg=16)
        cylinder(mb, p + Vector((0, 0, H + 4.5)), 2.1, 5.5, M['Roof'], seg=16, r2=0.04)
        oriented_box(mb, p + Vector((0, 0, H + 2.0)), (0.12, 0.06, 1.0), 0, M['Slit'])
    # Baland minora (silueti uzoqdan ko'rinadi)
    sp = c + Vector((W / 2 - 3.2, D / 2 - 3.2, 0))
    cylinder(mb, sp + Vector((0, 0, H)), 3.1, 12.0, M['CastleStone'], seg=24)
    cylinder(mb, sp + Vector((0, 0, H + 11.5)), 3.5, 0.8, M['CastleStone'], seg=24)
    cylinder(mb, sp + Vector((0, 0, H + 12.3)), 3.8, 10.5, M['Roof'], seg=24, r2=0.05)
    for a in range(3):
        ang = a * 2.1
        p = sp + Vector((math.cos(ang) * 3.11, math.sin(ang) * 3.11, H + 8.0))
        oriented_box(mb, p, (0.06, 0.6, 1.3), ang, M['WindowGlow'])
    # Bayroqlar
    for fp, h in ((sp + Vector((0, 0, H + 22.8)), 3.2), (c + corners[0] * 1.02 + Vector((0, 0, H + 10.0)), 2.2)):
        mb.tube(fp, fp + Vector((0, 0, h)), 0.04, M['Iron'], segments=6)
        top = fp + Vector((0, 0, h - 0.1))
        cloth(mb, [top - Vector((0, 0, 1.0)), top + Vector((2.2, 0.3, -1.1)), top + Vector((2.2, 0.3, 0)), top], M['Banner'], nu=10, nv=4, wave=0.08)
    add_box(c + Vector((0, 0, H / 2)), (W / 2 + 0.5, D / 2 + 0.5, H / 2 + 1), 0)


def build():
    reset_scene()
    M = materials()
    mb = MeshBuilder('Castle')
    angs = [60, 120, 175, 230, 285, 335, 20]
    rads = [31, 31, 30, 30.5, 30, 31, 30]
    pts = [P(a, r) for a, r in zip(angs, rads)]
    centroid = Vector((CX, CY, BASE))
    roofs = {175, 285, 20}
    for i, (a, p) in enumerate(zip(angs, pts)):
        round_tower(mb, M, p, a in roofs)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        gate = angs[i] == 60  # 60 -> 120 orasidagi devor janubga qaragan (darvoza)
        wall_segment(mb, M, a, b, centroid, cut_gate=gate)
        if gate:
            gatehouse(mb, M, a, b, centroid)
    keep(mb, M, Vector((CX, CY + 5.0, BASE)))
    ob = mb.build(smooth_angle=40)
    return ob


ob = build()
os.makedirs(os.path.join(OUT, 'models'), exist_ok=True)
export_glb([ob], os.path.join(OUT, 'models', 'castle.glb'))
with open(os.path.join(OUT, 'castle.json'), 'w') as fp:
    json.dump({'colliders': colliders, 'torches': torches}, fp, indent=1)
print(f'[castle] {len(ob.data.polygons)} yuz, {len(colliders)} to\'qnashuv, {len(torches)} mash\'ala')

if '--preview' in script_args():
    T = os.path.join(CLIENT_PUBLIC, 'maps', 'forest', 'textures')
    tex = {'CastleStone': ('castle_wall_slates', 3.0), 'CastleBase': ('mossy_stone_wall', 2.5), 'Roof': ('roof_slates_02', 2.0),
           'Cobble': ('cobblestone_floor_08', 2.0), 'Wood': ('rough_wood', 1.0)}
    for m in ob.data.materials:
        if m.name not in tex:
            continue
        d, tile = tex[m.name]
        nt = m.node_tree
        b = nt.nodes['Principled BSDF']
        uv = nt.nodes.new('ShaderNodeUVMap')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
        di = nt.nodes.new('ShaderNodeTexImage')
        di.image = bpy.data.images.load(os.path.join(T, d, 'diff.jpg'))
        nt.links.new(mp.outputs['Vector'], di.inputs['Vector'])
        nt.links.new(di.outputs['Color'], b.inputs['Base Color'])
        ni = nt.nodes.new('ShaderNodeTexImage')
        ni.image = bpy.data.images.load(os.path.join(T, d, 'nor.jpg'))
        ni.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(mp.outputs['Vector'], ni.inputs['Vector'])
        nt.links.new(ni.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    scene = bpy.context.scene
    bpy.ops.mesh.primitive_plane_add(size=200, location=(CX, CY, BASE))
    bpy.context.active_object.data.materials.append(make_material('G', (0.08, 0.08, 0.06), rough=1))
    sun = bpy.data.objects.new('Moon', bpy.data.lights.new('Moon', 'SUN'))
    sun.data.energy = 1.6
    sun.data.color = (0.7, 0.78, 1.0)
    sun.rotation_euler = (math.radians(60), 0, math.radians(160))
    scene.collection.objects.link(sun)
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.025, 0.04, 1)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 30
    cam.location = (CX + 28, CY - 62, BASE + 9)
    cam.rotation_euler = (Vector((CX, CY, BASE + 11)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 0.6
    scene.render.filepath = os.path.join(OUT_DIR, 'forest_castle.png')
    bpy.ops.render.render(write_still=True)
