"""Ignabargli daraxtlar: Poly Haven (CC0) shox/po'stloq teksturalaridan protsedural archa va qarag'aylar.

    blender -b --factory-startup -P assets-src/blender/forest_trees.py [-- --preview]

Bosqichlar:
 1) Shox to'plami (spray): atlasdagi bir nechta shox kartochkasi bitta novdaga terilib, ortografik render
    qilinadi -> textures/fir_spray.png, pine_spray.png (RGBA). Daraxt shoxlariga shu to'plam qadaladi -
    kam poligon bilan qalin ignabarg.
 2) Daraxtlar: archa A/B, qarag'ay, qurigan archa. Har biri LOD0 (yaqin), LOD1 (o'rta).
 3) Impostor: har daraxt yondan render qilinadi -> textures/tree_impostors.png; uzoqda kesishgan ikki tekislik.
Natija: client/public/maps/forest/models/trees.glb, trees.json (variantlar: balandlik, tana radiusi, atlas joyi)
Kerakli xom fayllar: node tools/fetch-nature.mjs
"""
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, OUT_DIR, ROOT, MeshBuilder, export_glb, make_material, reset_scene, script_args  # noqa: E402

NATURE = os.path.join(ROOT, 'assets-src', 'nature')
OUT = os.path.join(CLIENT_PUBLIC, 'maps', 'forest')
TEX_OUT = os.path.join(OUT, 'textures')

# Atlasdagi shox kartochkalari (u0, v0, u1, v1; v - rasm tepasidan), alfa niqobdan avtomatik topilgan
FIR_SPRITES = [(0.340, 0.422, 0.535, 0.777), (0.637, 0.484, 0.926, 0.832), (0.766, 0.055, 0.887, 0.371), (0.203, 0.086, 0.406, 0.312)]
PINE_SPRITES = [(0.043, 0.059, 0.211, 0.441)]
IMP_W, IMP_H = 512, 512


def load_img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def sprite_material(name, diff, alpha):
    """Faqat tekstura rangi (emission) + alfa: render natijasi albedo bo'ladi."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexImage')
    tc.image = load_img(diff)
    ta = nt.nodes.new('ShaderNodeTexImage')
    ta.image = load_img(alpha, True)
    uv = nt.nodes.new('ShaderNodeUVMap')
    for t in (tc, ta):
        nt.links.new(uv.outputs['UV'], t.inputs['Vector'])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(tc.outputs['Color'], em.inputs['Color'])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix = nt.nodes.new('ShaderNodeMixShader')
    # alfa jpg kulrang: keskin chegara
    ramp = nt.nodes.new('ShaderNodeMapRange')
    ramp.inputs['From Min'].default_value = 0.35
    ramp.inputs['From Max'].default_value = 0.65
    nt.links.new(ta.outputs['Color'], ramp.inputs['Value'])
    nt.links.new(ramp.outputs['Result'], mix.inputs['Fac'])
    nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
    nt.links.new(em.outputs['Emission'], mix.inputs[2])
    nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    return m


def textured_emission(name, img_path, alpha_from_tex=True):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = load_img(img_path)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(t.outputs['Color'], em.inputs['Color'])
    if alpha_from_tex:
        tr = nt.nodes.new('ShaderNodeBsdfTransparent')
        mix = nt.nodes.new('ShaderNodeMixShader')
        ramp = nt.nodes.new('ShaderNodeMapRange')
        ramp.inputs['From Min'].default_value = 0.3
        ramp.inputs['From Max'].default_value = 0.6
        nt.links.new(t.outputs['Alpha'], ramp.inputs['Value'])
        nt.links.new(ramp.outputs['Result'], mix.inputs['Fac'])
        nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
        nt.links.new(em.outputs['Emission'], mix.inputs[2])
        nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
    else:
        nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def quad(bm, uvl, center, xdir, ydir, w, h, uvr, mat_index):
    """Markazi center, kengligi xdir bo'ylab w, balandligi ydir bo'ylab h; uvr = (u0, v0, u1, v1) Blender UV"""
    c, x, y = Vector(center), Vector(xdir).normalized(), Vector(ydir).normalized()
    pts = [c - x * w / 2 - y * h / 2, c + x * w / 2 - y * h / 2, c + x * w / 2 + y * h / 2, c - x * w / 2 + y * h / 2]
    vs = [bm.verts.new(p) for p in pts]
    f = bm.faces.new(vs)
    f.material_index = mat_index
    u0, v0, u1, v1 = uvr
    for l, uv in zip(f.loops, [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]):
        l[uvl].uv = uv
    return f


def render_setup(res_x, res_y, ortho_scale, cam_loc, cam_rot):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = res_x, res_y
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
        scene.collection.objects.link(cam)
        scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = ortho_scale
    cam.location = cam_loc
    cam.rotation_euler = cam_rot
    cam.data.clip_end = 200
    return scene


def clear_objects():
    for o in list(bpy.data.objects):
        if o.type != 'CAMERA':
            bpy.data.objects.remove(o, do_unlink=True)


# ------------------------------------------------------------------ 1) shox to'plami
def clean_alpha(src, rects, out_path):
    """Har kartochka ichida faqat eng katta yaxlit bo'lak (shoxning o'zi) qoladi - atlasdagi qo'shni
    bo'laklarning qoldiqlari kesib tashlanadi."""
    from collections import deque
    im = bpy.data.images.load(src)
    W, H = im.size
    px = np.array(im.pixels[:], np.float32).reshape(H, W, 4)[..., 0]  # pastdan yuqoriga
    bpy.data.images.remove(im)
    clean = np.zeros_like(px)
    for u0, v0, u1, v1 in rects:
        # rasm koordinatasi (v tepadan) -> Blender piksel qatori (pastdan)
        r0, r1 = int((1 - v1) * H), int((1 - v0) * H)
        c0, c1 = int(u0 * W), int(u1 * W)
        sub = px[r0:r1, c0:c1] > 0.35
        lab = np.zeros(sub.shape, np.int32)
        best, best_n, n = 0, 0, 0
        for y, x in zip(*np.nonzero(sub)):
            if lab[y, x]:
                continue
            n += 1
            q = deque([(y, x)])
            lab[y, x] = n
            cnt = 0
            while q:
                cy, cx = q.popleft()
                cnt += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < sub.shape[0] and 0 <= nx < sub.shape[1] and sub[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = n
                        q.append((ny, nx))
            if cnt > best_n:
                best, best_n = n, cnt
        keep = lab == best
        # Chegara yumshoqligini saqlash uchun 1 piksel kengaytirib asl alfani olamiz
        grow = keep.copy()
        grow[1:] |= keep[:-1]
        grow[:-1] |= keep[1:]
        grow[:, 1:] |= keep[:, :-1]
        grow[:, :-1] |= keep[:, 1:]
        clean[r0:r1, c0:c1] = np.where(grow, px[r0:r1, c0:c1], 0)
    out = bpy.data.images.new('clean_alpha', W, H, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = clean
    out.pixels.foreach_set(rgba.ravel())
    out.update()
    out.filepath_raw = out_path
    out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    return out_path


def render_spray(kind):
    """Novda bo'ylab shox kartochkalari; tepadan ortografik render (1024x768 = 1.15 x 0.8625 m, novda +X bo'ylab)"""
    clear_objects()
    src = os.path.join(NATURE, 'fir_tree_01' if kind == 'fir' else 'pine_tree_01')
    sprites = FIR_SPRITES if kind == 'fir' else PINE_SPRITES
    alpha = clean_alpha(os.path.join(src, 'twig_alpha.jpg'), sprites, os.path.join(OUT_DIR, f'{kind}_twig_alpha_clean.png'))
    mat = sprite_material(f'{kind}_sprite', os.path.join(src, 'twig_diff.jpg'), alpha)
    rng = random.Random(5 if kind == 'fir' else 9)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    n = 16 if kind == 'fir' else 11
    for i in range(n):
        t = (i + 0.5) / n
        side = 1 if i % 2 == 0 else -1
        u0, v0, u1, v1 = rng.choice(sprites)
        asp = (u1 - u0) / (v1 - v0)
        size = (0.42 if kind == 'fir' else 0.5) * (1.15 - 0.45 * t) * rng.uniform(0.85, 1.15)
        ang = math.radians(side * rng.uniform(35, 62) * (1 - 0.5 * t))
        d = Vector((math.cos(ang), math.sin(ang), 0))
        base = Vector((0.05 + t * 0.82, 0, i * 0.0015))
        # Kartochka "yuqorisi" (rasm tepasi) novdadan tashqariga qarasin
        quad(bm, uvl, base + d * size / 2, Vector((-d.y, d.x, 0)), d, size * asp, size, (u0, 1 - v1, u1, 1 - v0), 0)
    # Uchi
    u0, v0, u1, v1 = sprites[0]
    asp = (u1 - u0) / (v1 - v0)
    quad(bm, uvl, Vector((0.9 + 0.12, 0, 0.03)), Vector((0, 1, 0)), Vector((1, 0, 0)), 0.3 * asp, 0.3, (u0, 1 - v1, u1, 1 - v0), 0)
    me = bpy.data.meshes.new('spray')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new('spray', me)
    bpy.context.scene.collection.objects.link(ob)
    scene = render_setup(1024, 768, 1.15, (0.55, 0, 5), (0, 0, 0))
    scene.render.filepath = os.path.join(TEX_OUT, f'{kind}_spray.png')
    bpy.ops.render.render(write_still=True)
    print(f'[trees] {kind}_spray.png')


# ------------------------------------------------------------------ 2) daraxtlar
def cone(mb, p0, p1, r0, r1, mat, segments):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    m = Matrix.Translation((p0 + p1) / 2) @ d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    res = bmesh.ops.create_cone(mb.bm, cap_ends=False, cap_tris=False, segments=segments, radius1=r0, radius2=r1, depth=d.length, matrix=m)
    idx = mb.mi(mat)
    for f in {f for v in res['verts'] for f in v.link_faces}:
        f.material_index = idx
        f.smooth = True


def trunk(mb, H, R0, mat, rng, segments):
    """Biroz qiyshiq, uchiga qarab ingichkalashuvchi tana (4 bo'lak)"""
    pts = [Vector((0, 0, -0.4))]
    for k in range(1, 5):
        z = H * k / 4
        pts.append(Vector((rng.uniform(-0.12, 0.12) * k / 4, rng.uniform(-0.12, 0.12) * k / 4, z)))
    radii = [R0 * 1.25, R0, R0 * 0.7, R0 * 0.42, 0.03]
    for k in range(4):
        cone(mb, pts[k], pts[k + 1], radii[k], radii[k + 1], mat, segments)
    # Ildiz bo'rtiqlari (faqat yaqin LOD)
    if segments >= 8:
        for a in range(5):
            ang = a / 5 * 2 * math.pi + rng.uniform(-0.3, 0.3)
            d = Vector((math.cos(ang), math.sin(ang), 0))
            cone(mb, d * R0 * 0.5 + Vector((0, 0, 0.5)), d * R0 * 2.1 + Vector((0, 0, -0.25)), R0 * 0.32, R0 * 0.08, mat, 5)
    return pts


def trunk_point(pts, z):
    for a, b in zip(pts, pts[1:]):
        if a.z <= z <= b.z:
            t = (z - a.z) / (b.z - a.z)
            return a.lerp(b, t)
    return pts[-1]


def conifer(name, kind, H, R0, seed, lod, spray_mat, bark_mat, dead=False):
    """Archa/qarag'ay. lod 0 - to'liq, 1 - soddalashtirilgan (kam kartochka, shox tanasi yo'q)."""
    rng = random.Random(seed)
    mb = MeshBuilder(name)
    pts = trunk(mb, H, R0, bark_mat, rng, 10 if lod == 0 else 6)
    foliage = []  # (face, kartochka markazi) - normal uchun
    uvl = mb.bm.loops.layers.uv.get('UVMap') or mb.bm.loops.layers.uv.new('UVMap')
    si = mb.mi(spray_mat) if spray_mat else 0
    if kind == 'pine':
        z0, step = H * 0.5, 0.55
    else:
        z0, step = 1.6 + rng.uniform(0, 0.8), 0.42
    if lod == 1:
        step *= 1.9
    z = z0
    golden = math.pi * (3 - math.sqrt(5))
    az = rng.uniform(0, 6.28)
    Lmax = (0.26 if kind == 'fir' else 0.2) * H
    while z < H - 0.5:
        rel = (z - z0) / (H - z0)
        nb = rng.randint(5, 7) if kind == 'fir' else rng.randint(4, 6)
        if lod == 1:
            nb = max(3, nb - 2)
        for b in range(nb):
            az += golden + rng.uniform(-0.25, 0.25)
            if kind == 'fir':
                L = (0.35 + Lmax * (1 - rel) ** 1.05) * rng.uniform(0.85, 1.12)
                elev = -0.32 + 0.22 * rel + rng.uniform(-0.08, 0.08)
            else:
                # Qarag'ay toji: o'rtasi keng, yumaloq
                L = (0.6 + Lmax * math.sin(math.pi * min(1, rel * 1.1 + 0.08)) ** 0.8) * rng.uniform(0.75, 1.2)
                elev = 0.12 + rng.uniform(-0.15, 0.2)
            if dead:
                L *= rng.uniform(0.3, 0.75)
            base = trunk_point(pts, z)
            d = Vector((math.cos(az), math.sin(az), math.tan(elev))).normalized()
            tip = base + d * L + Vector((0, 0, (0.08 if kind == 'fir' else 0.12) * L))
            mid = base.lerp(tip, 0.5) + Vector((0, 0, -0.06 * L if kind == 'fir' else 0.03 * L))
            br = 0.018 + 0.011 * L
            if lod == 0 or dead:
                cone(mb, base, mid, br, br * 0.7, bark_mat, 3 if not dead else 4)
                cone(mb, mid, tip, br * 0.7, 0.008, bark_mat, 3 if not dead else 4)
            if dead or not spray_mat:
                continue
            # Shox to'plami kartochkalari: novda bo'ylab, deyarli gorizontal, atrofga biroz burilgan
            k = max(1, round(L / ((1.15 if kind == 'fir' else 0.85) if lod == 0 else 2.2)))
            for j in range(k):
                t0 = j / k
                t1 = (j + 1) / k
                a = (base.lerp(mid, min(1, t0 * 2)) if t0 < 0.5 else mid.lerp(tip, (t0 - 0.5) * 2))
                bpt = (base.lerp(mid, min(1, t1 * 2)) if t1 < 0.5 else mid.lerp(tip, (t1 - 0.5) * 2))
                seg = bpt - a
                ln = max(seg.length, 0.3) * rng.uniform(1.25, 1.5) * (1.0 if kind == 'fir' else 1.35)
                along = seg.normalized()
                side = Vector((0, 0, 1)).cross(along).normalized()
                roll = rng.uniform(-0.45, 0.45)
                side = (Matrix.Rotation(roll, 3, along) @ side).normalized()
                # Tekstura nisbati 4:3 (render maydoni 1.15 x 0.8625 m)
                w = ln * 0.75 * (1.2 if lod == 1 else 1)
                c = a + along * ln * 0.47 + Vector((0, 0, 0.02))
                f = quad(mb.bm, uvl, c, along, side, ln, w, (0, 0, 1, 1), si)
                foliage.append(f)
                if lod == 1 or rng.random() < (0.35 if kind == 'fir' else 0.7):
                    # Kesishgan ikkinchi kartochka - hajm uchun
                    up = along.cross(side).normalized()
                    f2 = quad(mb.bm, uvl, c, along, (side * 0.4 + up).normalized(), ln * 0.85, w * 0.7, (0, 0, 1, 1), si)
                    foliage.append(f2)
        z += step * rng.uniform(0.8, 1.2)
    # Tepa (yetakchi novda)
    if spray_mat and not dead:
        top = trunk_point(pts, H - 0.2)
        for a in range(3):
            ang = a / 3 * math.pi
            quad(mb.bm, uvl, top + Vector((0, 0, 0.45)), Vector((0, 0, 1)), Vector((math.cos(ang), math.sin(ang), 0)), 1.1, 0.55, (0, 0, 1, 1), si)
    return mb, foliage, pts


def build_tree(name, kind, H, R0, seed, lod, mats, dead=False):
    spray = None if dead else mats[f'{kind}_spray']
    bark = mats['pine_bark' if kind == 'pine' else 'fir_bark']
    mb, _foliage, _pts = conifer(name, kind, H, R0, seed, lod, spray, bark, dead)
    # Barg kartochkalari uchun "sferik" normal: tojdan tashqariga - hajmli, yumshoq yoritish
    mb.world_uv()
    crown_c = Vector((0, 0, H * (0.55 if kind == 'fir' else 0.8)))
    me = bpy.data.meshes.new(name)
    mb.bm.normal_update()
    # Shox kartochkalarida dunyo UV o'rniga o'z UV'si qolishi kerak: world_uv'dan keyin qayta yozamiz
    uvl = mb.bm.loops.layers.uv['UVMap']
    for f in mb.bm.faces:
        if f.material_index == (mb.mats.index(spray) if spray in mb.mats else -1):
            for l, uv in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
                l[uvl].uv = uv
    mb.bm.to_mesh(me)
    mb.bm.free()
    for m in mb.mats:
        me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if spray is not None and spray in mb.mats:
        si = mb.mats.index(spray)
        normals = [None] * len(me.loops)
        for p in me.polygons:
            for li in p.loop_indices:
                v = me.vertices[me.loops[li].vertex_index].co
                if p.material_index == si:
                    n = (Vector((v.x, v.y, v.z)) - crown_c)
                    n.z = n.z * 0.5 + 1.2  # yuqoriga og'ish
                    normals[li] = n.normalized()
                else:
                    normals[li] = p.normal.copy() if not p.use_smooth else me.vertices[me.loops[li].vertex_index].normal.copy()
        me.normals_split_custom_set([tuple(n) for n in normals])
    return ob


def materials():
    fir = os.path.join(NATURE, 'fir_tree_01')
    pine = os.path.join(NATURE, 'pine_tree_01')
    M = {
        'fir_bark': make_material('FirBark', (0.25, 0.2, 0.16), rough=0.95),
        'pine_bark': make_material('PineBark', (0.3, 0.2, 0.14), rough=0.95),
        'fir_spray': make_material('FirSpray', (0.2, 0.3, 0.15), rough=0.9),
        'pine_spray': make_material('PineSpray', (0.22, 0.3, 0.14), rough=0.9),
    }
    # Render uchun teksturalar (glTF'ga rasm yozilmaydi - client o'zi beradi)
    for key, tex in (('fir_bark', os.path.join(fir, 'bark_diff.jpg')), ('pine_bark', os.path.join(pine, 'bark_diff.jpg')),
                     ('fir_spray', os.path.join(TEX_OUT, 'fir_spray.png')), ('pine_spray', os.path.join(TEX_OUT, 'pine_spray.png'))):
        nt = M[key].node_tree
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(tex)
        bsdf = nt.nodes['Principled BSDF']
        if 'bark' in key:
            uv = nt.nodes.new('ShaderNodeUVMap')
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (1 / 1.2, 1 / 1.2, 1)
            nt.links.new(uv.outputs['UV'], mp.inputs['Vector'])
            nt.links.new(mp.outputs['Vector'], t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
        if 'spray' in key:
            nt.links.new(t.outputs['Alpha'], bsdf.inputs['Alpha'])
    return M


# Variantlar: nom, tur, balandlik, tana radiusi, urug', qurigan
VARIANTS = [
    ('fir_a', 'fir', 19.0, 0.34, 101, False),
    ('fir_b', 'fir', 13.5, 0.24, 202, False),
    ('pine_a', 'pine', 22.0, 0.32, 303, False),
    ('dead_a', 'fir', 15.0, 0.26, 404, True),
]


def to_emission_for_render(mats):
    """Impostor render uchun: materiallarni faqat albedo (emission) ko'rinishiga o'tkazish"""
    for key, m in mats.items():
        nt = m.node_tree
        bsdf = nt.nodes['Principled BSDF']
        col_link = bsdf.inputs['Base Color'].links
        out = nt.nodes['Material Output']
        em = nt.nodes.new('ShaderNodeEmission')
        if col_link:
            nt.links.new(col_link[0].from_socket, em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = bsdf.inputs['Base Color'].default_value
        if 'spray' in key:
            tex = col_link[0].from_node
            tr = nt.nodes.new('ShaderNodeBsdfTransparent')
            mix = nt.nodes.new('ShaderNodeMixShader')
            ramp = nt.nodes.new('ShaderNodeMapRange')
            ramp.inputs['From Min'].default_value = 0.3
            ramp.inputs['From Max'].default_value = 0.6
            nt.links.new(tex.outputs['Alpha'], ramp.inputs['Value'])
            nt.links.new(ramp.outputs['Result'], mix.inputs['Fac'])
            nt.links.new(tr.outputs['BSDF'], mix.inputs[1])
            nt.links.new(em.outputs['Emission'], mix.inputs[2])
            nt.links.new(mix.outputs['Shader'], out.inputs['Surface'])
        else:
            nt.links.new(em.outputs['Emission'], out.inputs['Surface'])


def impostor_quads(name, H, W, slot, nslots, mat, frame):
    """Kesishgan ikki tekislik; UV atlasdagi o'z ustunining o'rtasidagi W kenglikdagi qismi
    (frame - render kadri eni: bo'sh chetlar chizilmaydi, piksel sarfi kamayadi)"""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new('UVMap')
    c = (slot + 0.5) / nslots
    half = (W / frame) / nslots / 2
    u0, u1 = c - half, c + half
    for ang in (0, math.pi / 2):
        x = Vector((math.cos(ang), math.sin(ang), 0))
        quad(bm, uvl, Vector((0, 0, H / 2 - 0.4)), x, Vector((0, 0, 1)), W, H, (u0, 0, u1, 1), 0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    reset_scene()
    os.makedirs(TEX_OUT, exist_ok=True)
    render_spray('fir')
    render_spray('pine')
    clear_objects()
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m)
    mats = materials()

    meta = {'variants': []}
    export = []
    for name, kind, H, R0, seed, dead in VARIANTS:
        for lod in (0, 1):
            ob = build_tree(f'{name}_{lod}', kind, H, R0, seed, lod, mats, dead)
            export.append(ob)
        tris = sum(len(p.vertices) - 2 for p in bpy.data.objects[f'{name}_0'].data.polygons)
        tris1 = sum(len(p.vertices) - 2 for p in bpy.data.objects[f'{name}_1'].data.polygons)
        meta['variants'].append({'name': name, 'kind': kind, 'height': H, 'trunkRadius': R0, 'dead': dead, 'tris': [tris, tris1]})
        print(f'[trees] {name}: LOD0 {tris} uchburchak, LOD1 {tris1}')

    # Impostor atlas: har variant LOD0 yondan, albedo
    n = len(VARIANTS)
    imp_paths = []
    to_emission_for_render(mats)
    for i, (name, kind, H, R0, seed, dead) in enumerate(VARIANTS):
        for o in bpy.context.scene.objects:
            o.hide_render = o.name != f'{name}_0'
        # Kvadrat kadr: kenglik ham H + 0.4 (keng archa sig'adi)
        meta['variants'][i]['impostor'] = {'width': H + 0.4, 'height': H + 0.4}
        scene = render_setup(IMP_W, IMP_H, H + 0.4, (0, -60, (H + 0.4) / 2 - 0.4), (math.pi / 2, 0, 0))
        p = os.path.join(OUT_DIR, f'imp_{name}.png')
        scene.render.filepath = p
        bpy.ops.render.render(write_still=True)
        imp_paths.append(p)
    # Atlasni yig'ish (numpy)
    atlas = np.zeros((IMP_H, IMP_W * n, 4), np.float32)
    for i, p in enumerate(imp_paths):
        im = bpy.data.images.load(p)
        px = np.array(im.pixels[:], np.float32).reshape(IMP_H, IMP_W, 4)
        atlas[:, i * IMP_W:(i + 1) * IMP_W] = px
        bpy.data.images.remove(im)
    img = bpy.data.images.new('tree_impostors', IMP_W * n, IMP_H, alpha=True)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(atlas.ravel())
    img.update()
    img.filepath_raw = os.path.join(TEX_OUT, 'tree_impostors.png')
    img.file_format = 'PNG'
    img.save()

    imp_mat = make_material('Impostor', (0.2, 0.25, 0.15), rough=0.95)
    for o in bpy.context.scene.objects:
        o.hide_render = False
    for i, (name, kind, H, R0, seed, dead) in enumerate(VARIANTS):
        v = meta['variants'][i]['impostor']
        frame = v['width']
        # Daraxtning haqiqiy eni (shoxlar uchi) - kadrdan torroq
        v['width'] = round(H * (0.66 if kind == 'fir' else 0.56), 2)
        export.append(impostor_quads(f'{name}_2', v['height'], v['width'], i, n, imp_mat, frame))

    os.makedirs(os.path.join(OUT, 'models'), exist_ok=True)
    export_glb(export, os.path.join(OUT, 'models', 'trees.glb'))
    # Po'stloq teksturalari client uchun
    import shutil
    for src, dst in (('fir_tree_01', 'fir_bark'), ('pine_tree_01', 'pine_bark')):
        os.makedirs(os.path.join(TEX_OUT, dst), exist_ok=True)
        shutil.copy(os.path.join(NATURE, src, 'bark_diff.jpg'), os.path.join(TEX_OUT, dst, 'diff.jpg'))
        shutil.copy(os.path.join(NATURE, src, 'bark_nor_gl.jpg'), os.path.join(TEX_OUT, dst, 'nor.jpg'))
    with open(os.path.join(OUT, 'trees.json'), 'w') as fp:
        json.dump(meta, fp, indent=1)
    print('[trees] tayyor')

    if '--preview' in script_args():
        preview(export)


def preview(objs):
    """Bir nechta daraxt yonma-yon (LOD0) - ko'rib chiqish uchun"""
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = not o.name.endswith('_0')
    xs = {'fir_a_0': -9, 'fir_b_0': -3, 'pine_a_0': 4, 'dead_a_0': 10}
    for o in scene.objects:
        if o.name in xs:
            o.location = (xs[o.name], 0, 0)
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.collection.objects.link(sun)
    scene.render.film_transparent = False
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.42, 0.55, 1)
    cam = scene.camera
    cam.data.type = 'PERSP'
    cam.data.lens = 28
    cam.location = (0, -34, 9)
    cam.rotation_euler = (math.radians(86), 0, 0)
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = 'AgX'
    scene.render.filepath = os.path.join(OUT_DIR, 'forest_trees.png')
    bpy.ops.render.render(write_still=True)


main()
