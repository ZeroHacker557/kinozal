"""Kino zalni to'liq quradi va eksport qiladi.

Ishga tushirish:
  blender -b -P assets-src/blender/hall_build.py

Natija:
  client/public/models/hall.glb            statik zal (UV0 - texturalar, UV1 - lightmap)
  client/public/models/hall_collision.glb  soddalashtirilgan to'qnashuv geometriyasi
  client/public/models/seat.glb            o'rindiq va tirsaklik (UV1 - AO)
  client/public/models/layout.json         o'rindiqlar, tugma, ekran, spawn joylari
  assets-src/out/hall.blend                lightmap pishirish uchun sahna
"""
import os
import sys
import json
import math
import random

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402
from common import (MeshBuilder, make_material, reset_scene, collection, lightmap_uv,  # noqa: E402
                    export_glb, to_three, OUT_DIR, CLIENT_PUBLIC)
from layout import *  # noqa: E402,F401,F403
from seat import build_seat  # noqa: E402

random.seed(7)
scene = reset_scene()

# ---------------------------------------------------------------------------
# Materiallar (nomlari client'dagi material sozlamalari bilan bir xil)
# ---------------------------------------------------------------------------
MAT = dict(
    carpet=make_material('Carpet', (0.075, 0.025, 0.03), rough=0.95),
    wall_fabric=make_material('WallFabric', (0.055, 0.055, 0.065), rough=0.95),
    wall_base=make_material('WallBase', (0.025, 0.025, 0.03), rough=0.8),
    wood=make_material('Wood', (0.11, 0.06, 0.035), rough=0.45),
    ceiling=make_material('Ceiling', (0.018, 0.018, 0.022), rough=0.9),
    slat=make_material('CeilingSlat', (0.03, 0.022, 0.018), rough=0.8),
    mask=make_material('MaskBlack', (0.006, 0.006, 0.006), rough=1.0),
    curtain=make_material('Curtain', (0.30, 0.02, 0.035), rough=0.85),
    metal=make_material('MetalBrushed', (0.55, 0.55, 0.56), rough=0.35, metal=1.0),
    metal_dark=make_material('MetalDark', (0.04, 0.04, 0.045), rough=0.4, metal=1.0),
    stage=make_material('StageTop', (0.012, 0.012, 0.014), rough=0.7),
    grille=make_material('SpeakerGrille', (0.02, 0.02, 0.022), rough=0.95),
    plate=make_material('SwitchPlate', (0.78, 0.77, 0.74), rough=0.35),
    glass=make_material('BoothGlass', (0.02, 0.025, 0.03), rough=0.05, alpha=0.4),
    booth=make_material('BoothInterior', (0.03, 0.03, 0.035), rough=0.8),
    sign=make_material('SignBody', (0.02, 0.02, 0.02), rough=0.5),
    e_house=make_material('EMIT_House', (1, 1, 1), emit=(1.0, 0.82, 0.62), emit_strength=0),
    e_sconce=make_material('EMIT_Sconce', (1, 1, 1), emit=(1.0, 0.75, 0.5), emit_strength=0),
    e_step=make_material('EMIT_Step', (1, 1, 1), emit=(1.0, 0.7, 0.4), emit_strength=0),
    e_exit=make_material('EMIT_Exit', (0.1, 1, 0.3), emit=(0.15, 1.0, 0.35), emit_strength=0),
    e_label=make_material('EMIT_Label', (1, 1, 1), emit=(1.0, 0.8, 0.55), emit_strength=0),
    e_proj=make_material('EMIT_Projector', (1, 1, 1), emit=(0.85, 0.9, 1.0), emit_strength=0),
)

static_coll = collection('Static')
seat_coll = collection('Seats')
col_coll = collection('Collision')
L_HOUSE = collection('L_House')     # zal chiroqlari (tugma bilan yoqiladi/o'chadi)
L_BASE = collection('L_Base')       # doim yonib turadigan (zina, EXIT, xira devor chiroqlari)

H = MeshBuilder('Hall')
C = MeshBuilder('Collision')   # to'qnashuv uchun oddiy qutilar
col_mat = make_material('Collision', (1, 0, 1))

layout_out = {'seats': [], 'armrests': [], 'interactables': [], 'lights': {}}


def col_box(mn, mx):
    C.box(mn, mx, col_mat)


# ---------------------------------------------------------------------------
# Chiroqlar
# ---------------------------------------------------------------------------
def kelvin(k):
    # Taxminiy issiq oq ranglar
    return {2700: (1.0, 0.72, 0.45), 3000: (1.0, 0.78, 0.55), 4000: (1.0, 0.88, 0.75)}[k]


def add_light(coll, kind, loc, energy, color, rot=(0, 0, 0), size=0.1, spot=None, blend=0.5, size_y=None):
    ld = bpy.data.lights.new(f'{coll.name}_{kind}', kind)
    ld.energy = energy
    ld.color = color
    if kind == 'SPOT':
        ld.spot_size = math.radians(spot or 90)
        ld.spot_blend = blend
        ld.shadow_soft_size = size
    elif kind == 'POINT':
        ld.shadow_soft_size = size
    elif kind == 'AREA':
        ld.shape = 'RECTANGLE'
        ld.size = size
        ld.size_y = size_y or size
    ob = bpy.data.objects.new(ld.name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    coll.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------
# Pol, qatorlar (stadion tipida), yon zinapoyalar
# ---------------------------------------------------------------------------
X = HALL_X
carpet, wood, metal = MAT['carpet'], MAT['wood'], MAT['metal']

# Old tekis qism (A qatordan sahnagacha)
H.box((-X, row_back(0), -0.2), (X, FRONT_Y, 0.0), carpet, skip=('-z', '-x', '+x', '+y', '-y'))
col_box((-X, row_back(0), -0.5), (X, FRONT_Y, 0.0))

for i in range(1, ROWS + 1):
    if i < ROWS:
        y0, y1, z = row_back(i), row_front(i), row_z(i)
    else:  # orqa yo'lak
        y0, y1, z = BACK_Y, WALKWAY_FRONT_Y, WALKWAY_Z
    # O'rindiqlar zonasi platformasi (old tomoni - "riser")
    H.box((-AISLE_X, y0, 0.0), (AISLE_X, y1, z), carpet, skip=('-z', '-y'))
    col_box((-AISLE_X, y0, 0.0), (AISLE_X, y1, z))
    # Yon yo'laklardagi zinalar: har qatorga 2 ta zina (0.2 m)
    mid = y1 - 0.65
    for side in (-1, 1):
        xa, xb = sorted((side * AISLE_X, side * X))
        for (ya, yb, zz) in ((mid, y1, z - ROW_RISE / 2), (y0, mid, z)):
            H.box((xa, ya, 0.0), (xb, yb, zz), carpet, skip=('-z', '-y', '+x' if side > 0 else '-x'))
            col_box((xa, ya, 0.0), (xb, yb, zz))
            # Zina cheti: metall profil + LED chiziq
            H.box((xa + 0.02, yb - 0.035, zz - 0.012), (xb - 0.02, yb + 0.004, zz + 0.004), metal)
            H.box((xa + 0.05, yb + 0.002, zz - 0.045), (xb - 0.05, yb + 0.008, zz - 0.03), MAT['e_step'])
            add_light(L_BASE, 'POINT', ((xa + xb) / 2, yb + 0.12, zz - 0.04), 0.35, kelvin(2700), size=0.05)

# Orqa yo'lak oldidagi yarim devor (yog'och qopqoqli)
hw_y0, hw_y1 = WALKWAY_FRONT_Y - 0.12, WALKWAY_FRONT_Y
H.box((-AISLE_X, hw_y0, row_z(ROWS - 1)), (AISLE_X, hw_y1, WALKWAY_Z + 0.95), MAT['wall_fabric'], skip=('-z',))
H.box((-AISLE_X - 0.02, hw_y0 - 0.04, WALKWAY_Z + 0.95), (AISLE_X + 0.02, hw_y1 + 0.04, WALKWAY_Z + 1.0), wood,
      bevel=0.012)
col_box((-AISLE_X, hw_y0 - 0.04, WALKWAY_Z), (AISLE_X, hw_y1 + 0.04, WALKWAY_Z + 1.1))

# ---------------------------------------------------------------------------
# Devorlar: akustik mato panellari, yog'och reykalar, karniz (cove) chiroqlari
# ---------------------------------------------------------------------------
WALL_T = 0.25
H.box((-X - WALL_T, BACK_Y, 0), (-X, FRONT_Y, CEIL_Z), MAT['wall_base'], skip=('-x', '-z', '+z', '-y', '+y'))
H.box((X, BACK_Y, 0), (X + WALL_T, FRONT_Y, CEIL_Z), MAT['wall_base'], skip=('+x', '-z', '+z', '-y', '+y'))
col_box((-X - 1, BACK_Y - 1, -1), (-X, FRONT_Y + 1, CEIL_Z + 1))
col_box((X, BACK_Y - 1, -1), (X + 1, FRONT_Y + 1, CEIL_Z + 1))
col_box((-X, FRONT_Y - 0.05, -1), (X, FRONT_Y + 1, CEIL_Z + 1))
col_box((-X, BACK_Y - 1, -1), (X, BACK_Y, CEIL_Z + 1))
col_box((-X, BACK_Y, CEIL_Z), (X, FRONT_Y, CEIL_Z + 1))

PANEL_TOP = 8.75
PANEL_STEP = 2.1
DOOR_ZONE = (DOOR_Y0 - 0.45, DOOR_Y1 + 0.75)
PANEL_FRONT_LIMIT = FRONT_Y - 0.9   # parda orqasida panel kerak emas


def floor_at(y):
    """Devor yonidagi (yo'lak) pol balandligi."""
    if y >= row_back(0):
        return 0.0
    for i in range(1, ROWS + 1):
        y0 = BACK_Y if i == ROWS else row_back(i)
        y1 = WALKWAY_FRONT_Y if i == ROWS else row_front(i)
        if y0 <= y <= y1:
            return row_z(i) if y < y1 - 0.65 else row_z(i) - ROW_RISE / 2
    return WALKWAY_Z


def side_wall(side):
    sx = side * X
    inner = side * (X - 0.06)       # mato panel yuzasi
    strip = side * (X - 0.085)      # yog'och reyka yuzasi
    ys = []
    y = BACK_Y
    while y < PANEL_FRONT_LIMIT:
        ys.append(y)
        y += PANEL_STEP
    for idx, y0 in enumerate(ys):
        y1 = min(y0 + PANEL_STEP, PANEL_FRONT_LIMIT)
        pa, pb = y0 + 0.05, y1 - 0.05
        # Pastki chegara: pol balandligidan 0.12 m pastda (zinalar ichiga kirib ketadi)
        z0 = max(0.0, min(floor_at(pa), floor_at(pb)) - 0.1)
        zx0, zx1 = sorted((sx, inner))
        if pb > DOOR_ZONE[0] and pa < DOOR_ZONE[1]:
            # Eshik zonasi: eshik ustida panel
            segs = []
            if pa < DOOR_ZONE[0]:
                segs.append((pa, DOOR_ZONE[0] - 0.05, z0))
            segs.append((max(pa, DOOR_ZONE[0]), min(pb, DOOR_ZONE[1]), DOOR_H + 0.75))
            if pb > DOOR_ZONE[1]:
                segs.append((DOOR_ZONE[1] + 0.05, pb, z0))
        else:
            segs = [(pa, pb, z0)]
        for (a, b2, zz) in segs:
            if b2 - a < 0.1:
                continue
            H.box((zx0, a, zz), (zx1, b2, PANEL_TOP), MAT['wall_fabric'], bevel=0.015, segments=2)
            # Gorizontal yupqa yog'och chiziq (panel o'rtasida, ritm uchun)
            H.box((min(inner, strip), a, PANEL_TOP - 1.9), (max(inner, strip), b2, PANEL_TOP - 1.86), wood)
        # Vertikal yog'och reyka (panellar orasida); eshik zonasida - eshik ustidan boshlanadi
        zs = max(0.0, floor_at(y1) - 0.1)
        if DOOR_ZONE[0] - 0.1 < y1 < DOOR_ZONE[1] + 0.1:
            zs = DOOR_H + 0.75
        if y1 < PANEL_FRONT_LIMIT - 0.01:
            rx0, rx1 = sorted((sx, side * (X - 0.11)))
            H.box((rx0, y1 - 0.06, zs), (rx1, y1 + 0.06, PANEL_TOP), wood, bevel=0.01)
    # Karniz: yog'och fasad + yuqoriga qaragan LED (shipni yoritadi)
    fx0, fx1 = sorted((sx, side * (X - 0.32)))
    H.box((fx0, BACK_Y, PANEL_TOP), (fx1, FRONT_Y, PANEL_TOP + 0.22), wood, bevel=0.015)
    lx0, lx1 = sorted((side * (X - 0.06), side * (X - 0.12)))
    H.box((lx0, BACK_Y, PANEL_TOP + 0.22), (lx1, FRONT_Y, PANEL_TOP + 0.235), MAT['e_house'])
    for k in range(6):
        yy = BACK_Y + (k + 0.5) * (FRONT_Y - BACK_Y) / 6
        add_light(L_HOUSE, 'AREA', (side * (X - 0.15), yy, PANEL_TOP + 0.3), 260, kelvin(2700),
                  size=0.08, size_y=(FRONT_Y - BACK_Y) / 6)


side_wall(-1)
side_wall(1)

# Devor chiroqlari (sconce): yuqoriga va pastga nur sochadi
SCONCE_YS = [BACK_Y + PANEL_STEP * k for k in (1, 3, 5, 7)]
for side in (-1, 1):
    for y in SCONCE_YS:
        z = 6.0
        bx = side * (X - 0.085)
        x0, x1 = sorted((bx, side * (X - 0.27)))
        H.box((x0, y - 0.13, z - 0.32), (x1, y + 0.13, z + 0.32), MAT['metal_dark'], bevel=0.02)
        gx0, gx1 = sorted((side * (X - 0.12), side * (X - 0.24)))
        H.box((gx0, y - 0.1, z + 0.32), (gx1, y + 0.1, z + 0.335), MAT['e_sconce'])
        H.box((gx0, y - 0.1, z - 0.335), (gx1, y + 0.1, z - 0.32), MAT['e_sconce'])
        lx = side * (X - 0.3)
        for (dz, rx) in ((0.4, 0.0), (-0.4, math.pi)):
            add_light(L_HOUSE, 'SPOT', (lx, y, z + dz), 180, kelvin(2700), rot=(rx, 0, 0),
                      spot=70, blend=0.8, size=0.08)
            add_light(L_BASE, 'SPOT', (lx, y, z + dz), 9, kelvin(2700), rot=(rx, 0, 0),
                      spot=70, blend=0.8, size=0.08)

# Surround kolonkalar (yon devorlarda)
for side in (-1, 1):
    for k in (2, 4, 6):
        y = BACK_Y + PANEL_STEP * k
        z = 7.4
        x0, x1 = sorted((side * (X - 0.085), side * (X - 0.42)))
        H.box((x0, y - 0.24, z - 0.36), (x1, y + 0.24, z + 0.36), MAT['metal_dark'], bevel=0.025, segments=3)
        gx = side * (X - 0.425)
        gx0, gx1 = sorted((gx, gx + side * 0.01))
        H.box((gx0, y - 0.21, z - 0.33), (gx1, y + 0.21, z + 0.33), MAT['grille'])
        # Devorga mahkamlagich
        bx0, bx1 = sorted((side * (X - 0.085), side * (X - 0.12)))
        H.box((bx0, y - 0.05, z - 0.5), (bx1, y + 0.05, z - 0.36), MAT['metal_dark'])

# ---------------------------------------------------------------------------
# Old devor, ekran, ramka, sahna, pardalar
# ---------------------------------------------------------------------------
H.box((-X, FRONT_Y - 0.02, 0), (X, FRONT_Y, CEIL_Z), MAT['mask'], skip=('+y', '-z', '+z', '-x', '+x'))

# Sahna
H.box((-X, STAGE_Y, 0), (X, FRONT_Y, STAGE_Z), MAT['stage'], skip=('-z', '+y', '-x', '+x'),
      face_mats={'-y': wood})
H.box((-X, STAGE_Y - 0.03, STAGE_Z - 0.02), (X, STAGE_Y + 0.02, STAGE_Z + 0.008), metal)
H.box((-X + 0.1, STAGE_Y - 0.012, 0.05), (X - 0.1, STAGE_Y - 0.006, 0.07), MAT['e_step'])
for k in range(9):
    add_light(L_BASE, 'POINT', (-X + 1 + k * 2, STAGE_Y - 0.12, 0.08), 0.5, kelvin(2700), size=0.05)
col_box((-X, STAGE_Y, 0), (X, FRONT_Y, STAGE_Z))

# Ekran atrofidagi qora baxmal ramka (masking)
sx0, sx1 = -SCREEN_W / 2, SCREEN_W / 2
sz0, sz1 = SCREEN_Z0, SCREEN_Z0 + SCREEN_H
fy0, fy1 = SCREEN_Y - 0.06, SCREEN_Y - 0.01
B = 0.35
H.box((sx0 - B, fy0, sz1), (sx1 + B, fy1, sz1 + B), MAT['mask'], bevel=0.02)
H.box((sx0 - B, fy0, sz0 - B), (sx1 + B, fy1, sz0), MAT['mask'], bevel=0.02)
H.box((sx0 - B, fy0, sz0), (sx0, fy1, sz1), MAT['mask'], bevel=0.02)
H.box((sx1, fy0, sz0), (sx1 + B, fy1, sz1), MAT['mask'], bevel=0.02)


def curtain(x0, x1, z0, z1, y_base, amp, wave, nu, nv, phase=0.0):
    w = x1 - x0

    def fn(u, v):
        x = x0 + u * w
        z = z0 + v * (z1 - z0)
        # Asosiy burmalar + kichik tasodifiy farq, pastda biroz kengroq
        a = amp * (0.85 + 0.3 * (1 - v))
        y = y_base - a * (math.sin((x / wave) * 2 * math.pi + phase) +
                          0.25 * math.sin((x / wave) * 5.3 * math.pi + phase * 2))
        return Vector((x, y, z))
    H.grid(fn, nu, nv, MAT['curtain'])


# Yon pardalar (ekran va devor oralig'ida, poldan shipgacha)
for side in (-1, 1):
    xa, xb = sorted((side * (SCREEN_W / 2 + B + 0.05), side * X))
    curtain(xa, xb, STAGE_Z, CEIL_Z - 0.2, FRONT_Y - 0.25, 0.07, 0.32, 160, 6, phase=side)
    col_box((xa, FRONT_Y - 0.5, 0), (xb, FRONT_Y, CEIL_Z))
# Yuqori parda (valance)
curtain(-X, X, CEIL_Z - 0.75, CEIL_Z, FRONT_Y - 0.45, 0.05, 0.25, 360, 3)
# Parda karnizi
H.box((-X, FRONT_Y - 0.62, CEIL_Z - 0.06), (X, FRONT_Y - 0.1, CEIL_Z), MAT['metal_dark'])

# ---------------------------------------------------------------------------
# Ship: qora akustik, chuqurlashtirilgan downlight'lar
# ---------------------------------------------------------------------------
H.box((-X, BACK_Y, CEIL_Z), (X, FRONT_Y, CEIL_Z + 0.2), MAT['ceiling'], skip=('+z', '-x', '+x', '-y', '+y'))
DOWN_XS = (-6.0, -2.0, 2.0, 6.0)
DOWN_YS = (-8.8, -5.2, -1.6, 2.0, 5.6, 9.2)
for x in DOWN_XS:
    for y in DOWN_YS:
        H.cylinder((x, y, CEIL_Z - 0.012), 0.13, 0.024, MAT['metal_dark'], segments=32)
        H.cylinder((x, y, CEIL_Z - 0.026), 0.085, 0.006, MAT['e_house'], segments=32)
        add_light(L_HOUSE, 'SPOT', (x, y, CEIL_Z - 0.04), 900, kelvin(3000), spot=95, blend=0.7, size=0.06)
# Ship bo'ylab yog'och akustik reykalar (o'rtada)
for k in range(-14, 15):
    x = k * 0.5
    if any(abs(x - dx) < 0.25 for dx in DOWN_XS):
        continue
    H.box((x - 0.04, BACK_Y + 1.0, CEIL_Z - 0.06), (x + 0.04, STAGE_Y - 1.0, CEIL_Z), MAT['slat'])

# ---------------------------------------------------------------------------
# Orqa devor va proyeksiya xonasi oynasi
# ---------------------------------------------------------------------------
WX0, WX1, WZ0, WZ1 = -1.3, 1.3, WALKWAY_Z + 2.7, WALKWAY_Z + 3.7
bw = (BACK_Y - 0.25, BACK_Y)
for (a, b2) in (((-X, WALKWAY_Z), (WX0, CEIL_Z)), ((WX1, WALKWAY_Z), (X, CEIL_Z)),
                ((WX0, WALKWAY_Z), (WX1, WZ0)), ((WX0, WZ1), (WX1, CEIL_Z))):
    H.box((a[0], bw[0], a[1]), (b2[0], bw[1], b2[1]), MAT['wall_fabric'], skip=('-y',))
# Orqa devor yog'och reykalari
for k in range(-8, 9):
    x = k * 1.05
    if WX0 - 0.1 < x < WX1 + 0.1:
        continue
    H.box((x - 0.05, BACK_Y, WALKWAY_Z), (x + 0.05, BACK_Y + 0.03, PANEL_TOP), wood)
# Oyna ramkasi va oyna
H.box((WX0 - 0.08, BACK_Y, WZ0 - 0.08), (WX1 + 0.08, BACK_Y + 0.04, WZ0), MAT['metal_dark'])
H.box((WX0 - 0.08, BACK_Y, WZ1), (WX1 + 0.08, BACK_Y + 0.04, WZ1 + 0.08), MAT['metal_dark'])
H.box((WX0 - 0.08, BACK_Y, WZ0), (WX0, BACK_Y + 0.04, WZ1), MAT['metal_dark'])
H.box((WX1, BACK_Y, WZ0), (WX1 + 0.08, BACK_Y + 0.04, WZ1), MAT['metal_dark'])
# Proyeksiya xonasi ichi
H.box((-2.2, BACK_Y - 2.4, WZ0 - 1.0), (2.2, BACK_Y - 0.25, WZ1 + 1.0), MAT['booth'],
      skip=('+y',), inward=True)
H.box((-0.35, BACK_Y - 1.6, WZ0 - 0.4), (0.35, BACK_Y - 0.6, WZ0 + 0.2), MAT['metal_dark'], bevel=0.03)
H.box((-0.3, BACK_Y - 1.4, WZ0 + 0.2), (0.3, BACK_Y - 0.6, WZ0 + 0.55), MAT['metal_dark'], bevel=0.05)
H.cylinder((0, BACK_Y - 0.5, WZ0 + 0.38), 0.09, 0.22, MAT['metal_dark'], axis='y')
H.cylinder((0, BACK_Y - 0.385, WZ0 + 0.38), 0.065, 0.01, MAT['e_proj'], axis='y')
add_light(L_BASE, 'POINT', (0, BACK_Y - 1.0, WZ1 + 0.6), 6, kelvin(4000), size=0.2)

booth_glass = MeshBuilder('BoothGlass')
booth_glass.box((WX0, BACK_Y + 0.01, WZ0), (WX1, BACK_Y + 0.02, WZ1), MAT['glass'])

# ---------------------------------------------------------------------------
# Eshiklar (chap - kirish, o'ng - chiqish), EXIT belgilari, chiroq tugmasi
# ---------------------------------------------------------------------------
def door(side):
    out = side * (X - 0.11)
    # Eshik atrofidagi yog'och qoplama (tugma ham shu yerda)
    wx0, wx1 = sorted((side * X, side * (X - 0.05)))
    H.box((wx0, DOOR_ZONE[0], 0), (wx1, DOOR_ZONE[1], DOOR_H + 0.75), wood, skip=('-z',))
    fx0, fx1 = sorted((side * X, side * (X - 0.14)))
    # Ramka
    H.box((fx0, DOOR_Y0 - 0.1, 0), (fx1, DOOR_Y0, DOOR_H + 0.1), MAT['metal_dark'], bevel=0.01)
    H.box((fx0, DOOR_Y1, 0), (fx1, DOOR_Y1 + 0.1, DOOR_H + 0.1), MAT['metal_dark'], bevel=0.01)
    H.box((fx0, DOOR_Y0 - 0.1, DOOR_H), (fx1, DOOR_Y1 + 0.1, DOOR_H + 0.1), MAT['metal_dark'], bevel=0.01)
    # Ikki tavaqa yog'och eshik
    dx0, dx1 = sorted((side * X, out))
    mid = (DOOR_Y0 + DOOR_Y1) / 2
    for (a, b2) in ((DOOR_Y0 + 0.005, mid - 0.004), (mid + 0.004, DOOR_Y1 - 0.005)):
        H.box((dx0, a, 0.01), (dx1, b2, DOOR_H - 0.005), wood, bevel=0.008)
        # Kichik oynacha
        gx0, gx1 = sorted((out, out - side * 0.004))
        H.box((gx0, a + 0.25, 1.35), (gx1, b2 - 0.25, 1.95), MAT['glass'])
    # Itarib ochiladigan metall tutqichlar
    px = out - side * 0.08
    for y in (DOOR_Y0 + 0.12, mid - 0.12, mid + 0.12, DOOR_Y1 - 0.12):
        H.box((min(out, px), y - 0.015, 1.0), (max(out, px), y + 0.015, 1.04), metal)
    H.tube((px, DOOR_Y0 + 0.12, 1.02), (px, mid - 0.12, 1.02), 0.018, metal)
    H.tube((px, mid + 0.12, 1.02), (px, DOOR_Y1 - 0.12, 1.02), 0.018, metal)
    # EXIT belgisi
    ez = DOOR_H + 0.45
    sx0_, sx1_ = sorted((side * (X - 0.06), side * (X - 0.16)))
    H.box((sx0_, mid - 0.34, ez - 0.13), (sx1_, mid + 0.34, ez + 0.13), MAT['sign'], bevel=0.008)
    tx = side * (X - 0.162)
    rot = Matrix.Rotation(-side * math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X')
    H.text('EXIT', 0.17, Matrix.Translation((tx, mid, ez)) @ rot, MAT['e_exit'], extrude=0.003)
    add_light(L_BASE, 'POINT', (side * (X - 0.4), mid, ez), 1.2, (0.2, 1.0, 0.4), size=0.1)


door(-1)
door(1)

# Chiroq tugmasi paneli (chap devor, kirish eshigi yonida). Alohida obyekt: juda kichik bo'lgani
# uchun lightmap'da emas, probe orqali yoritiladi.
SW_X = -X + 0.062
plate = MeshBuilder('LightSwitch_Plate')
plate.box((-X + 0.05, SWITCH_Y - 0.06, SWITCH_Z - 0.09), (SW_X, SWITCH_Y + 0.06, SWITCH_Z + 0.09), MAT['plate'],
          bevel=0.006, segments=2)
# Ramka atrofidagi ingichka soyali chok (panel devorga botib turgandek ko'rinadi)
plate.box((-X + 0.049, SWITCH_Y - 0.066, SWITCH_Z - 0.096), (-X + 0.0505, SWITCH_Y + 0.066, SWITCH_Z + 0.096),
          MAT['metal_dark'])
# Kichik yo'l-yo'riq yozuvi ("CHIROQ")
plate.text('CHIROQ', 0.022, Matrix.Translation((SW_X + 0.001, SWITCH_Y, SWITCH_Z + 0.115)) @
           Matrix.Rotation(math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X'), MAT['e_label'], extrude=0.0)

rocker = MeshBuilder('LightSwitch_Rocker')
rocker.box((-0.012, -0.022, -0.045), (0.012, 0.022, 0.045), MAT['plate'], bevel=0.005, segments=2)
rocker.box((0.0115, -0.004, 0.025), (0.0125, 0.004, 0.033), MAT['e_label'])  # kichik indikator
layout_out['interactables'].append({
    'id': 'light_switch',
    'type': 'light_switch',
    'position': to_three((SW_X + 0.012, SWITCH_Y, SWITCH_Z)),
    'normal': [1, 0, 0],
})

# ---------------------------------------------------------------------------
# Qator harflari (qatorning ikki chetida yonib turadigan kichik plastinkalar)
# ---------------------------------------------------------------------------
for i in range(ROWS):
    letter = ROW_LETTERS[i]
    z = row_z(i) + 0.42
    y = seat_y(i) + 0.05
    for side in (-1, 1):
        ax = side * (abs(armrest_x(0)) + 0.03)
        x0, x1 = sorted((ax, ax + side * 0.012))
        H.box((x0, y - 0.06, z - 0.05), (x1, y + 0.06, z + 0.05), MAT['sign'], bevel=0.004, segments=1)
        rot = Matrix.Rotation(side * math.pi / 2, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'X')
        H.text(letter, 0.07, Matrix.Translation((ax + side * 0.0135, y, z)) @ rot, MAT['e_label'], extrude=0.0)

# ---------------------------------------------------------------------------
# Yo'laklar bo'ylab devordagi tutqich (perila)
# ---------------------------------------------------------------------------
for side in (-1, 1):
    rx = side * (X - 0.16)
    pts = [(rx, row_back(0) + 0.3, 0.9)]
    for i in range(1, ROWS + 1):
        y1 = WALKWAY_FRONT_Y if i == ROWS else row_front(i)
        pts.append((rx, y1, row_z(i) - ROW_RISE / 2 + 0.9))
    pts.append((rx, WALKWAY_FRONT_Y - 1.0, WALKWAY_Z + 0.9))
    for p0, p1 in zip(pts, pts[1:]):
        H.tube(p0, p1, 0.022, metal, segments=14)
        # Kronshteyn
    for p in pts:
        H.tube((side * (X - 0.085), p[1], p[2] - 0.05), (rx, p[1], p[2] - 0.05), 0.01, metal, segments=8)

# ---------------------------------------------------------------------------
# Obyektlarni yaratish
# ---------------------------------------------------------------------------
hall = H.build(static_coll, smooth_angle=35)
glass_ob = booth_glass.build(static_coll)
rocker_ob = rocker.build(static_coll, smooth_angle=35)
plate_ob = plate.build(static_coll, smooth_angle=35)
rocker_ob.location = (SW_X + 0.012, SWITCH_Y, SWITCH_Z)
collision = C.build(col_coll)

# Ekran (alohida: video texture shu yerga tushadi). UV 0..1
sc = MeshBuilder('Screen')
scr_mat = make_material('ScreenSurface', (0.7, 0.7, 0.7), rough=0.9, emit=(1, 1, 1), emit_strength=0)
v = [sc.bm.verts.new(p) for p in ((sx0, SCREEN_Y, sz0), (sx1, SCREEN_Y, sz0),
                                  (sx1, SCREEN_Y, sz1), (sx0, SCREEN_Y, sz1))]
f = sc.bm.faces.new(v)
f.material_index = sc.mi(scr_mat)
screen = sc.build(static_coll)
uvl = screen.data.uv_layers['UVMap']
for loop, uv in zip(screen.data.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
    uvl.data[loop.index].uv = uv
if screen.data.polygons[0].normal.y > 0:   # ekran tomoshabinlarga (-Y) qarashi kerak
    screen.data.flip_normals()

# ---------------------------------------------------------------------------
# O'rindiqlar (pishirish uchun soya beradi; client'da instancing bilan chiziladi)
# ---------------------------------------------------------------------------
seat_proto, arm_proto = build_seat(seat_coll)
lightmap_uv([seat_proto, arm_proto], margin=0.01, angle=50)
for i in range(ROWS):
    z = row_z(i)
    y = seat_y(i)
    for k in range(SEATS_PER_ROW):
        x = seat_x(k)
        num = k + 1
        layout_out['seats'].append({
            'id': f'{ROW_LETTERS[i]}{num}', 'row': ROW_LETTERS[i], 'number': num,
            'position': to_three((x, y, z)),
        })
        ob = bpy.data.objects.new(f'Seat_{ROW_LETTERS[i]}{num}', seat_proto.data)
        ob.location = (x, y, z)
        seat_coll.objects.link(ob)
    for k in range(SEATS_PER_ROW + 1):
        x = armrest_x(k)
        layout_out['armrests'].append(to_three((x, y, z)))
        ob = bpy.data.objects.new(f'Arm_{ROW_LETTERS[i]}{k}', arm_proto.data)
        ob.location = (x, y, z)
        seat_coll.objects.link(ob)
# Prototiplar sahnadan tashqarida (faqat eksport uchun)
seat_proto.location = (0, 0, -50)
arm_proto.location = (0.7, 0, -50)
# AO pishirish uchun markazdagi o'rindiq nomi
layout_ao_seat = f'Seat_{ROW_LETTERS[4]}{SEATS_PER_ROW // 2 + 1}'
layout_ao_arm = f'Arm_{ROW_LETTERS[4]}{SEATS_PER_ROW // 2}'

# ---------------------------------------------------------------------------
# Lightmap UV va eksport
# ---------------------------------------------------------------------------
lightmap_uv([hall], margin=0.003, angle=60)

models = os.path.join(CLIENT_PUBLIC, 'models')
export_glb([hall, glass_ob, rocker_ob, plate_ob, screen], os.path.join(models, 'hall.glb'))
export_glb([collision], os.path.join(models, 'hall_collision.glb'))
# O'rindiq prototiplari: koordinata boshiga qaytarib eksport
seat_proto.location = (0, 0, 0)
arm_proto.location = (0, 0, 0)
export_glb([seat_proto, arm_proto], os.path.join(models, 'seat.glb'))
seat_proto.location = (0, 0, -50)
arm_proto.location = (0.7, 0, -50)

layout_out.update({
    'units': 'meters',
    'hall': {'minX': -X, 'maxX': X, 'front': to_three((0, FRONT_Y, 0))[2], 'back': to_three((0, BACK_Y, 0))[2],
             'ceiling': CEIL_Z},
    'screen': {'center': to_three((0, SCREEN_Y, SCREEN_Z0 + SCREEN_H / 2)), 'width': SCREEN_W,
               'height': SCREEN_H},
    'projector': to_three((0, BACK_Y - 0.385, WZ0 + 0.38)),
    'spawn': {'position': to_three((-X + 1.2, (DOOR_Y0 + DOOR_Y1) / 2, 0.0)), 'lookAt': to_three((0, 0, 1.6))},
    'rowLetters': ROW_LETTERS[:ROWS],
    'seatsPerRow': SEATS_PER_ROW,
    'bake': {'aoSeat': layout_ao_seat, 'aoArm': layout_ao_arm},
})
with open(os.path.join(models, 'layout.json'), 'w', encoding='utf-8') as fp:
    json.dump(layout_out, fp, ensure_ascii=False, indent=1)

os.makedirs(OUT_DIR, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'hall.blend'))
tris = sum(len(p.vertices) - 2 for p in hall.data.polygons)
seat_tris = sum(len(p.vertices) - 2 for p in seat_proto.data.polygons)
arm_tris = sum(len(p.vertices) - 2 for p in arm_proto.data.polygons)
print(f'TAYYOR: zal {tris} uchburchak, o\'rindiq {seat_tris}, tirsaklik {arm_tris}, '
      f'o\'rindiqlar soni {len(layout_out["seats"])}')
