"""O'rmon relyefini Blender'da qurib, teksturalar bilan render qilish (ko'rib chiqish uchun).

forest_terrain.py --preview orqali chaqiriladi. Natija: assets-src/out/forest_ground.png (yerdan),
forest_aerial.png (tepadan, yorug'roq - shaklni ko'rish uchun), forest_terrain.blend.
"""
import math
import os

import bpy
import bmesh
import numpy as np

from common import CLIENT_PUBLIC, OUT_DIR, reset_scene

TEX = os.path.join(CLIENT_PUBLIC, 'maps', 'forest', 'textures')
# qatlam -> tekstura takrorlanish o'lchami (metr)
LAYERS = [('forest_leaves_02', 4.0), ('forrest_ground_01', 3.0), ('forest_ground_04', 3.0), ('mossy_rock', 6.0)]


def b(x, z, y=0.0):
    """three.js (x, y, z) -> Blender (x, -z, y)"""
    return (x, -z, y)


def terrain_mesh(h, step, half, down=2):
    hs = h[::down, ::down]
    rows, cols = hs.shape
    xs = np.linspace(-half, half, cols)
    zs = np.linspace(-half, half, rows)
    X, Z = np.meshgrid(xs, zs)
    verts = np.stack([X, -Z, hs], -1).reshape(-1, 3)
    ii, jj = np.meshgrid(np.arange(rows - 1), np.arange(cols - 1), indexing='ij')
    a = (ii * cols + jj).ravel()
    faces = np.stack([a, a + cols, a + cols + 1, a + 1], -1)
    me = bpy.data.meshes.new('Terrain')
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', verts.astype(np.float32).ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set('vertex_index', faces.astype(np.int32).ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set('loop_start', np.arange(0, faces.size, 4, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(len(faces), 4, np.int32))
    me.update(calc_edges=True)
    uv = me.uv_layers.new(name='UVMap')
    lv = np.empty(faces.size * 2, np.float32)
    idx = faces.ravel()
    lv[0::2] = (verts[idx, 0] + half) / (2 * half)
    lv[1::2] = 1 - (-verts[idx, 1] + half) / (2 * half)  # PNG 0-qatori = -Z
    uv.data.foreach_set('uv', lv)
    me.polygons.foreach_set('use_smooth', np.ones(len(faces), bool))
    ob = bpy.data.objects.new('Terrain', me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def terrain_material():
    m = bpy.data.materials.new('Terrain')
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bsdf = N['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.92
    coord = N.new('ShaderNodeTexCoord')
    uvn = N.new('ShaderNodeUVMap')
    splat = N.new('ShaderNodeTexImage')
    splat.image = img(os.path.join(CLIENT_PUBLIC, 'maps', 'forest', 'splat.png'), True)
    splat.interpolation = 'Cubic'
    L.new(uvn.outputs['UV'], splat.inputs['Vector'])
    sep = N.new('ShaderNodeSeparateColor')
    L.new(splat.outputs['Color'], sep.inputs['Color'])
    cols, nors = [], []
    for name, tile in LAYERS:
        mp = N.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
        L.new(coord.outputs['Object'], mp.inputs['Vector'])
        d = N.new('ShaderNodeTexImage')
        d.image = img(os.path.join(TEX, name, 'diff.jpg'))
        n = N.new('ShaderNodeTexImage')
        n.image = img(os.path.join(TEX, name, 'nor.jpg'), True)
        for t in (d, n):
            L.new(mp.outputs['Vector'], t.inputs['Vector'])
        cols.append(d.outputs['Color'])
        nors.append(n.outputs['Color'])
    # o'rmon tagi asos; ustiga o'tloq (R), yo'l (G), qoya (B)
    c, nn = cols[0], nors[0]
    for k, ch in ((1, 'Red'), (2, 'Green'), (3, 'Blue')):
        mc = N.new('ShaderNodeMix')
        mc.data_type = 'RGBA'
        L.new(sep.outputs[ch], mc.inputs['Factor'])
        L.new(c, mc.inputs[6])
        L.new(cols[k], mc.inputs[7])
        mn = N.new('ShaderNodeMix')
        mn.data_type = 'RGBA'
        L.new(sep.outputs[ch], mn.inputs['Factor'])
        L.new(nn, mn.inputs[6])
        L.new(nors[k], mn.inputs[7])
        c, nn = mc.outputs[2], mn.outputs[2]
    nm = N.new('ShaderNodeNormalMap')
    nm.inputs['Strength'].default_value = 1.0
    L.new(nn, nm.inputs['Color'])
    L.new(c, bsdf.inputs['Base Color'])
    L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def water_strip(meta):
    pts = meta['stream']['points']
    w = meta['stream']['width'] / 2
    bm = bmesh.new()
    prev = None
    for k, (x, z, y) in enumerate(pts):
        x2, z2, _ = pts[min(k + 1, len(pts) - 1)]
        x1, z1, _ = pts[max(k - 1, 0)]
        dx, dz = x2 - x1, z2 - z1
        ln = math.hypot(dx, dz) or 1
        nx, nz = -dz / ln, dx / ln
        a = bm.verts.new(b(x + nx * w, z + nz * w, y))
        c = bm.verts.new(b(x - nx * w, z - nz * w, y))
        if prev:
            bm.faces.new((prev[0], prev[1], c, a))
        prev = (a, c)
    me = bpy.data.meshes.new('Water')
    bm.to_mesh(me)
    ob = bpy.data.objects.new('Water', me)
    m = bpy.data.materials.new('Water')
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (0.01, 0.015, 0.02, 1)
    p.inputs['Roughness'].default_value = 0.04
    ob.data.materials.append(m)
    bpy.context.scene.collection.objects.link(ob)


def look_at(ob, target):
    d = (target[0] - ob.location[0], target[1] - ob.location[1], target[2] - ob.location[2])
    from mathutils import Vector
    ob.rotation_euler = Vector(d).to_track_quat('-Z', 'Y').to_euler()


def render(h, step, half, meta):
    scene = reset_scene()
    t = terrain_mesh(h, step, half)
    t.data.materials.append(terrain_material())
    water_strip(meta)

    # Oy (sovuq, past burchak) va gulxan
    moon = bpy.data.objects.new('Moon', bpy.data.lights.new('Moon', 'SUN'))
    moon.data.color = (0.62, 0.72, 1.0)
    moon.data.angle = math.radians(0.6)
    moon.rotation_euler = (math.radians(58), 0, math.radians(200))
    scene.collection.objects.link(moon)
    fire = bpy.data.objects.new('Fire', bpy.data.lights.new('Fire', 'POINT'))
    fire.data.color = (1.0, 0.5, 0.18)
    fire.data.energy = 1500
    fire.data.shadow_soft_size = 0.4
    fire.location = b(0, 0, 0.9)
    scene.collection.objects.link(fire)
    world = scene.world
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.006, 0.009, 0.018, 1)

    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.view_settings.view_transform = 'AgX'
    scene.render.image_settings.file_format = 'PNG'

    # 1) yerdan: maydondan shimolga, qasr tepaligiga qarab (tun)
    moon.data.energy = 0.35
    bg.inputs['Strength'].default_value = 1.0
    scene.view_settings.exposure = 1.6
    cam.data.lens = 24
    cam.location = b(4, 24, 1.7)
    look_at(cam, b(-2, -120, 12))
    scene.render.filepath = os.path.join(OUT_DIR, 'forest_ground.png')
    bpy.ops.render.render(write_still=True)

    # 2) tepadan: butun xarita shakli (yorug'roq)
    moon.data.energy = 3.0
    scene.view_settings.exposure = 0.0
    cam.data.lens = 30
    cam.location = b(210, 230, 230)
    look_at(cam, b(0, -40, 0))
    cam.data.clip_end = 2000
    scene.render.filepath = os.path.join(OUT_DIR, 'forest_aerial.png')
    bpy.ops.render.render(write_still=True)

    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'forest_terrain.blend'))
    print('[preview] tayyor')
