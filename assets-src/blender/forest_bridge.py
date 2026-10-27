"""Soy ustidagi yog'och ko'prik: tosh tayanchlar, xoda to'sinlar, notekis taxtalar, panjara va tirgaklar.

    blender -b --factory-startup -P assets-src/blender/forest_bridge.py [-- --preview]

Natija: client/public/maps/forest/models/bridge.glb (materiallar nomi bilan: Plank, Wood, Log, Stone -
teksturalar client'da beriladi; Plank va Log'da tola X/Y bo'ylab yotishi uchun tekstura 90 gradus buriladi). Ko'prik Blender +Y (three.js -Z) bo'ylab, markazi koordinata boshida,
taxta usti z = 0 da. --preview: assets-src/out/forest_bridge.png
"""
import math
import os
import random
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, OUT_DIR, MeshBuilder, export_glb, make_material, reset_scene, script_args  # noqa: E402

LENGTH = 11.0      # taxta qismi (three.js terrain.json bilan bir xil)
WIDTH = 2.6
PLANK_W = 0.24
PLANK_T = 0.06
RAIL_X = 1.30
POSTS = [-5.0, -3.35, -1.68, 0.0, 1.68, 3.35, 5.0]

random.seed(11)


def jitter(a):
    return random.uniform(-a, a)


def rot(rx=0.0, ry=0.0, rz=0.0):
    return (Matrix.Rotation(rz, 4, 'Z') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X'))


def build():
    reset_scene()
    plank = make_material('Plank', (0.32, 0.3, 0.27), rough=0.85)
    wood = make_material('Wood', (0.32, 0.3, 0.27), rough=0.85)
    log = make_material('Log', (0.22, 0.16, 0.11), rough=0.9)
    stone = make_material('Stone', (0.35, 0.36, 0.33), rough=0.9)

    mb = MeshBuilder('Bridge')

    # Taxtalar: har biri o'z uzunligi, siljishi va qiyshayishi bilan (qo'lda yotqizilgandek)
    n = int(LENGTH / (PLANK_W + 0.02))
    span = n * (PLANK_W + 0.02)
    for k in range(n):
        y = -span / 2 + (k + 0.5) * (PLANK_W + 0.02)
        ln = WIDTH + random.uniform(-0.12, 0.16)
        x0 = jitter(0.07)
        w = PLANK_W + jitter(0.02)
        m = Matrix.Translation((x0, y, -PLANK_T / 2 + jitter(0.006))) @ rot(rx=jitter(0.012), ry=jitter(0.014), rz=jitter(0.025))
        mb.box((-ln / 2, -w / 2, -PLANK_T / 2), (ln / 2, w / 2, PLANK_T / 2), plank, bevel=0.009, segments=1, matrix=m)

    # Xoda to'sinlar (3 ta) taxtalar ostida, uchlari tosh tayanchlarda
    for x in (-1.0, 0.0, 1.0):
        r = 0.15 + jitter(0.015)
        mb.cylinder((x + jitter(0.03), 0, -PLANK_T - r + 0.01), r, LENGTH + 1.4, log, segments=12, axis='y')

    # Ustunlar, panjara va tirgaklar (ikkala tomonda)
    for side in (-1, 1):
        x = side * RAIL_X
        tops = []
        for y in POSTS:
            h = 1.08 if abs(y) < 4.9 else 1.22
            m = Matrix.Translation((x, y, 0)) @ rot(rz=jitter(0.04), rx=jitter(0.015), ry=jitter(0.015))
            mb.box((-0.065, -0.065, -0.42), (0.065, 0.065, h), wood, bevel=0.012, segments=1, matrix=m)
            tops.append(Vector((x, y, h)))
            # Ustun tagidan to'singa tushadigan tashqi tirgak
            mb.tube((x + side * 0.02, y, -0.2), (x - side * 0.55, y, -0.36), 0.04, wood, segments=8)
        # Yuqori va o'rta panjara (biroz egilgan xodalar)
        for z, r in ((1.0, 0.058), (0.52, 0.042)):
            pts = [Vector((x + side * 0.08, y, z + (0.02 if abs(y) < 4.9 else 0) + jitter(0.012))) for y in POSTS]
            for a, b in zip(pts, pts[1:]):
                mb.tube(a, b, r + jitter(0.006), log, segments=10)
        # Har oraliqda bitta qiya tirgak
        for i, (y0, y1) in enumerate(zip(POSTS, POSTS[1:])):
            lo, hi = (y0, y1) if i % 2 == 0 else (y1, y0)
            mb.tube((x + side * 0.06, lo, 0.08), (x + side * 0.06, hi, 0.92), 0.034, wood, segments=8)

    # Tosh tayanchlar: o'zan chetida (qirg'oq tik tushadigan joyda) notekis toshlardan terilgan devor
    for end in (-1, 1):
        y0 = end * 4.25
        for row in range(4):
            z = -0.2 - row * 0.4
            xs = -1.7 + row * 0.1
            while xs < 1.7:
                sx = random.uniform(0.38, 0.62)
                sy = random.uniform(0.6, 0.95)
                sz = random.uniform(0.32, 0.44)
                c = (xs + sx / 2, y0 + end * jitter(0.08), z - sz / 2 + 0.05)
                m = Matrix.Translation(c) @ rot(rx=jitter(0.08), ry=jitter(0.08), rz=jitter(0.12))
                mb.box((-sx / 2, -sy / 2, -sz / 2), (sx / 2, sy / 2, sz / 2), stone, bevel=0.06, segments=2, matrix=m)
                xs += sx + 0.03

    ob = mb.build(smooth_angle=35)
    return ob


def preview(ob):
    """Teksturalar bilan tezkor render (faqat ko'rib chiqish uchun)."""
    t = os.path.join(CLIENT_PUBLIC, 'maps', 'forest', 'textures')
    tex = {
        'Plank': (os.path.join(t, 'rough_wood'), 1.0, True),
        'Wood': (os.path.join(t, 'rough_wood'), 1.0, False),
        'Log': (os.path.join(t, 'bark_brown_02'), 1.2, True),
        'Stone': (os.path.join(t, 'mossy_rock'), 1.5, False),
    }
    for m in ob.data.materials:
        d, tile, turn = tex[m.name]
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        uv = nt.nodes.new('ShaderNodeUVMap')
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1)
        mp.inputs['Rotation'].default_value = (0, 0, math.pi / 2 if turn else 0)
        nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
        di = nt.nodes.new('ShaderNodeTexImage')
        di.image = bpy.data.images.load(os.path.join(d, 'diff.jpg'))
        ni = nt.nodes.new('ShaderNodeTexImage')
        ni.image = bpy.data.images.load(os.path.join(d, 'nor.jpg'))
        ni.image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        for t in (di, ni):
            nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
        nt.links.new(di.outputs['Color'], bsdf.inputs['Base Color'])
        nt.links.new(ni.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    scene = bpy.context.scene
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -1.2))
    ground = bpy.context.active_object
    ground.data.materials.append(make_material('Ground', (0.05, 0.06, 0.04), rough=1))
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.06, 0.09, 1)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 32
    cam.location = (5.5, -8.5, 2.4)
    cam.rotation_euler = (Vector((0, 0.5, -0.2)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = os.path.join(OUT_DIR, 'forest_bridge.png')
    bpy.ops.render.render(write_still=True)


ob = build()
out = os.path.join(CLIENT_PUBLIC, 'maps', 'forest', 'models', 'bridge.glb')
export_glb([ob], out)
print(f'[bridge] {len(ob.data.polygons)} yuz -> {out}')
if '--preview' in script_args():
    preview(ob)
