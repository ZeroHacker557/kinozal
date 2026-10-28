"""Ritsar avatari: Sketchfab "Medieval Knight | Sculpture | Game ready" (by__Rx, CC BY 4.0) web uchun.

    blender -b --factory-startup -P assets-src/blender/knight_build.py [-- --no-anims] [-- --no-thumbs]

 1) Model: Sketchfab ierarxiyasi tozalanadi, bo'yi 1.85 m ga keltiriladi, 44 mesh bitta skinned mesh'ga
    (3 material) birlashtiriladi, uzoq masofa uchun ~25% soddalashtirilgan nusxa (LOD1), teksturalar 1024.
    -> client/public/avatars/knight/knight.glb
 2) Animatsiyalar: Rocketbox (Bip01) mocap clip'lari Mixamo skeletiga ko'chiriladi (retarget).
    Har suyak, har kadr (armatura fazosida):  T(t) = S(t) * Sr^-1 * A * Tr
      S(t) - manba suyak aylanishi, Sr - manbaning tinch holati, Tr - ritsarning tinch holati,
      A - ritsar suyagini manbaning tinch yo'nalishiga buruvchi aylanish (A-poza va "qo'l pastda" farqi).
    Tos joylashuvi bo'y nisbatiga ko'paytiriladi. -> client/public/avatars/knight/anims/<clip>.glb
 3) Lobbi rasmlari: 4 variant (rang - metall/mato bo'yicha) -> client/public/avatars/Knight_*/thumb.jpg
Kerak: assets-src/knight/knight.glb (Sketchfab GLB 4k), assets-src/rocketbox/anims (fetch-rocketbox.mjs).
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(__file__))
from common import CLIENT_PUBLIC, ROOT, script_args  # noqa: E402

SRC = os.path.join(ROOT, 'assets-src', 'knight', 'knight.glb')
ANIMS = os.path.join(ROOT, 'assets-src', 'rocketbox', 'anims')
OUT = os.path.join(CLIENT_PUBLIC, 'avatars', 'knight')
HEIGHT = 1.85
TEX = 1024
FPS = 30

CLIPS = {
    'idle': 'idle_neutral_01__static', 'idle_look': 'idle_look_around_01__static',
    'walk': 'walk_neutral_01__xy', 'run': 'run_neutral_01__xy',
    'sit': 'sit_chair_idle_neutral_01__static', 'sit_relaxed': 'sit_chair_idle_relaxed_01__static',
    'sit_look': 'sit_chair_idle_look_around__static', 'sit_yawn': 'sit_chair_idle_yawn__static',
    'wave': 'wave_01__static', 'clap': 'claphands_01__static', 'cheer': 'cheer_01__static',
    'dance': 'dancing_cool__static', 'dance2': 'dancing_neutral__static', 'laugh': 'gestic_laugh_loud__static',
    'talk': 'gestic_talk_neutral_01__static', 'crouch': 'crouch_idle__static',
}

# Manba (Bip01) -> ritsar (Mixamo, Sketchfab qo'shgan raqam qo'shimchasisiz); uchinchi - yo'nalish uchun bola suyaklar
MAP = [
    ('Bip01 Pelvis', 'Hips', ('Bip01 Spine', 'Spine')),
    ('Bip01 Spine', 'Spine', ('Bip01 Spine1', 'Spine1')),
    ('Bip01 Spine1', 'Spine1', ('Bip01 Spine2', 'Spine2')),
    ('Bip01 Spine2', 'Spine2', ('Bip01 Neck', 'Neck')),
    ('Bip01 Neck', 'Neck', ('Bip01 Head', 'Head')),
    ('Bip01 Head', 'Head', ('Bip01 HeadNub', 'HeadTop_End')),
]
for s, t in (('L', 'Left'), ('R', 'Right')):
    MAP += [
        (f'Bip01 {s} Clavicle', f'{t}Shoulder', (f'Bip01 {s} UpperArm', f'{t}Arm')),
        (f'Bip01 {s} UpperArm', f'{t}Arm', (f'Bip01 {s} Forearm', f'{t}ForeArm')),
        (f'Bip01 {s} Forearm', f'{t}ForeArm', (f'Bip01 {s} Hand', f'{t}Hand')),
        (f'Bip01 {s} Hand', f'{t}Hand', (f'Bip01 {s} Finger2', f'{t}HandMiddle1')),
        (f'Bip01 {s} Thigh', f'{t}UpLeg', (f'Bip01 {s} Calf', f'{t}Leg')),
        (f'Bip01 {s} Calf', f'{t}Leg', (f'Bip01 {s} Foot', f'{t}Foot')),
        (f'Bip01 {s} Foot', f'{t}Foot', (f'Bip01 {s} Toe0', f'{t}ToeBase')),
        (f'Bip01 {s} Toe0', f'{t}ToeBase', (f'Bip01 {s} Toe0Nub', f'{t}Toe_End')),
    ]
    # Barmoqlar (Rocketbox: 0 - bosh barmoq, 1 - ko'rsatkich, 2 - o'rta, 3 - nomsiz)
    for fi, fname in ((0, 'Thumb'), (1, 'Index'), (2, 'Middle'), (3, 'Ring')):
        seg = [f'Bip01 {s} Finger{fi}', f'Bip01 {s} Finger{fi}1', f'Bip01 {s} Finger{fi}2', f'Bip01 {s} Finger{fi}Nub']
        for k in range(3):
            MAP.append((seg[k], f'{t}Hand{fname}{k + 1}', (seg[k + 1], f'{t}Hand{fname}{k + 2}')))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def short(name):
    """'mixamorig:LeftArm_09' -> 'LeftArm'"""
    n = name.split(':')[-1]
    head, _, tail = n.rpartition('_')
    return head if head and tail.isdigit() else n


# ------------------------------------------------------------------ 1) model
def load_knight():
    reset()
    bpy.ops.import_scene.gltf(filepath=SRC)
    for o in list(bpy.data.objects):
        # Icosphere - Sketchfab qoldig'i; Object_89 - ko'krakdagi ingichka ip bezaklari: qo'l va tosga
        # aralash bog'langan, harakatda havoda cho'zilgan chiziq bo'lib qoladi
        if o.name in ('Icosphere', 'Object_89'):
            bpy.data.objects.remove(o)
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # Sketchfab'ning o'z idle animatsiyasi (boshqa birlikda) kerak emas
    for o in [arm, *meshes]:
        o.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    # Animatsiya o'chirilgach suyaklarda oxirgi poza qoladi - tinch holatga qaytariladi
    # (aks holda masshtab qo'llanganda mesh skelet bilan birga uchib ketadi)
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    # Ierarxiyani tozalash: armatura dunyo transformini o'zida saqlab ota-onasiz qoladi
    mw = arm.matrix_world.copy()
    arm.parent = None
    arm.matrix_world = mw
    for o in list(bpy.data.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o)
    # Bo'y: eng baland cho'qqi (dunyoda)
    bpy.context.view_layer.update()
    top = max((m.matrix_world @ v.co).z for m in meshes for v in m.data.vertices)
    bot = min((m.matrix_world @ v.co).z for m in meshes for v in m.data.vertices)
    k = HEIGHT / (top - bot)
    arm.scale = arm.scale * k
    arm.location = arm.location * k - Vector((0, 0, bot * k))
    bpy.context.view_layer.update()
    select_only([arm, *meshes], arm)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # Barcha meshlar bittaga (3 material -> 3 primitiv, bitta skelet)
    select_only(meshes, meshes[0])
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = body.data.name = 'Knight'
    # Teksturalar
    for img in bpy.data.images:
        if max(img.size) > TEX:
            img.scale(TEX, TEX)
    print(f'[knight] bo\'y {top - bot:.2f} -> {HEIGHT} (k={k:.4f}), {len(body.data.polygons)} yuz')
    return arm, body


def make_lod(body):
    lo = body.copy()
    lo.data = body.data.copy()
    lo.name = lo.data.name = 'Knight_LOD1'
    bpy.context.scene.collection.objects.link(lo)
    mod = lo.modifiers.new('dec', 'DECIMATE')
    mod.ratio = 0.25
    # Armatura modifikatoridan oldin turishi kerak (aks holda poza mesh'ga "pishib" qoladi)
    lo.modifiers.move(lo.modifiers.find('dec'), 0)
    select_only([lo])
    bpy.ops.object.modifier_apply(modifier='dec')
    print(f'[knight] LOD1: {len(lo.data.polygons)} yuz')
    return lo


def export_model(arm, objs):
    os.makedirs(OUT, exist_ok=True)
    select_only([arm, *objs], arm)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'knight.glb'), export_format='GLB', use_selection=True,
                              export_skins=True, export_animations=False, export_materials='EXPORT',
                              export_image_format='JPEG', export_jpeg_quality=88, export_yup=True)
    print(f"[knight] knight.glb {os.path.getsize(os.path.join(OUT, 'knight.glb')) / 1e6:.1f} MB")


# ------------------------------------------------------------------ 2) animatsiyalar
def import_source(clip):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(ANIMS, f'm_{clip}.fbx'), automatic_bone_orientation=False, ignore_leaf_bones=False)
    objs = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in objs if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action)
    return src, objs


def retarget(tgt, src, clip_name):
    """Manba harakatini ritsar skeletiga ko'chirib, yangi action yaratadi (to'g'ridan fcurve'larga)."""
    tb = {short(b.name): b for b in tgt.data.bones}
    sb = src.data.bones
    pairs = [(s, t, c) for s, t, c in MAP if s in sb and t in tb]
    act = src.animation_data.action
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    s_rot = src.matrix_world.to_quaternion()
    t_rot_inv = tgt.matrix_world.to_quaternion().inverted()
    conv = t_rot_inv @ s_rot  # manba armatura fazosi -> ritsar armatura fazosi (aylanish)
    # Tinch holat ma'lumotlari
    info = {}
    for s, t, (sc, tc) in pairs:
        S = sb[s]
        T = tb[t]
        Sr = conv @ S.matrix_local.to_quaternion()
        ds = conv @ ((sb[sc].head_local if sc in sb else S.tail_local) - S.head_local)
        own = T.tail_local - T.head_local
        dt = (tb[tc].head_local - T.head_local) if tc in tb else own
        # Sketchfab konvertatsiyasida ba'zi uch suyaklar (HeadTop_End) koordinata boshiga tushib qolgan -
        # bola suyak noto'g'ri tomonda bo'lsa suyakning o'z dumi olinadi
        if dt.length < 1e-3 or dt.normalized().dot(own.normalized()) < 0.3:
            dt = own
        A = dt.normalized().rotation_difference(ds.normalized())
        info[t] = (s, Sr, A, T.matrix_local.to_quaternion())
    # Bo'y nisbati: tos balandligi (dunyoda)
    s_pelvis_rest = (src.matrix_world @ sb['Bip01 Pelvis'].head_local).z
    t_hips_rest = (tgt.matrix_world @ tb['Hips'].head_local).z
    ratio = t_hips_rest / s_pelvis_rest
    # Ritsar suyaklari ierarxiya tartibida
    order = []

    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)
    for b in tgt.data.bones:
        if b.parent is None:
            walk(b)

    frames = list(range(f0, f1 + 1))
    keys = {b.name: [] for b in order}   # (frame, quat)
    hips_loc = []
    scene = bpy.context.scene
    for f in frames:
        scene.frame_set(f)
        posed = {}  # ritsar suyagi -> armatura fazosidagi 4x4 (posed)
        for b in order:
            sn = short(b.name)
            parent_m = posed[b.parent.name] if b.parent else Matrix.Identity(4)
            parent_rest = b.parent.matrix_local if b.parent else Matrix.Identity(4)
            bl = parent_rest.inverted() @ b.matrix_local  # tinch lokal
            if sn in info:
                s, Sr, A, Tr = info[sn]
                S = conv @ src.pose.bones[s].matrix.to_quaternion()
                T = S @ Sr.inverted() @ A @ Tr
                m = T.to_matrix().to_4x4()
                if sn == 'Hips':
                    p_world = (src.matrix_world @ src.pose.bones[s].matrix.translation) * ratio
                    m.translation = tgt.matrix_world.inverted() @ p_world
                else:
                    m.translation = (parent_m @ bl).translation
            else:
                m = parent_m @ bl
            posed[b.name] = m
            basis = bl.inverted() @ parent_m.inverted() @ m
            keys[b.name].append(basis.to_quaternion())
            if sn == 'Hips':
                hips_loc.append(basis.translation.copy())
    # Action yozish
    new = bpy.data.actions.new(clip_name)
    for b in order:
        q = keys[b.name]
        if all(abs(x.angle) < 1e-4 for x in q) and short(b.name) not in info:
            continue
        for i in range(4):
            fc = new.fcurves.new(f'pose.bones["{b.name}"].rotation_quaternion', index=i, action_group=b.name)
            fc.keyframe_points.add(len(frames))
            co = []
            prev = None
            for fr, qq in zip(frames, q):
                if prev is not None and prev.dot(qq) < 0:  # kvaternion ishorasi uzluksiz bo'lsin
                    qq = -qq
                prev = qq
                co += [fr - f0, qq[i]]
            fc.keyframe_points.foreach_set('co', co)
            fc.update()
    hb = next(b for b in order if short(b.name) == 'Hips')
    for i in range(3):
        fc = new.fcurves.new(f'pose.bones["{hb.name}"].location', index=i, action_group=hb.name)
        fc.keyframe_points.add(len(frames))
        co = []
        for fr, v in zip(frames, hips_loc):
            co += [fr - f0, v[i]]
        fc.keyframe_points.foreach_set('co', co)
        fc.update()
    return new


def build_anims():
    os.makedirs(os.path.join(OUT, 'anims'), exist_ok=True)
    total = 0
    for name, clip in CLIPS.items():
        tgt, _ = load_knight_armature_only()
        src, objs = import_source(clip)
        act = retarget(tgt, src, name)
        for o in objs:
            if o.animation_data:
                o.animation_data_clear()
            bpy.data.objects.remove(o)
        tgt.animation_data_create()
        tgt.animation_data.action = act
        for pb in tgt.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        tgt.name = 'Knight'
        select_only([tgt])
        path = os.path.join(OUT, 'anims', f'{name}.glb')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                                  export_animation_mode='ACTIVE_ACTIONS', export_skins=False, export_materials='NONE',
                                  export_optimize_animation_size=True, export_yup=True)
        total += os.path.getsize(path)
        print(f'[knight] {name}: {act.frame_range[1] - act.frame_range[0] + 1:.0f} kadr')
    print(f'[knight] animatsiyalar {total / 1e6:.1f} MB')


def load_knight_armature_only():
    """Har clip uchun toza sahna: ritsar modelini yuklab, faqat armaturani qoldiradi"""
    arm, body = load_knight()
    bpy.data.objects.remove(body)
    return arm, None


# ------------------------------------------------------------------ 3) lobbi rasmlari
VARIANTS = {
    'Knight_Silver': ((0.95, 0.96, 1.0), (0.42, 0.06, 0.05)),
    'Knight_Black': ((0.32, 0.32, 0.34), (0.08, 0.08, 0.09)),
    'Knight_Gold': ((1.0, 0.78, 0.42), (0.07, 0.13, 0.42)),
    'Knight_Rust': ((0.78, 0.55, 0.4), (0.1, 0.22, 0.1)),
}


def thumbs(arm, body):
    """Har variant: metall qismlar va mato boshqa rangga bo'yaladi (metallik xaritasi bo'yicha)"""
    scene = bpy.context.scene
    # Materiallarga rang ko'paytiruvchi qo'shish (metallik bo'yicha aralash)
    tints = []
    for m in body.data.materials:
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
        base_link = bsdf.inputs['Base Color'].links[0]
        metal_link = bsdf.inputs['Metallic'].links[0] if bsdf.inputs['Metallic'].links else None
        mix_t = nt.nodes.new('ShaderNodeMix')
        mix_t.data_type = 'RGBA'
        if metal_link:
            nt.links.new(metal_link.from_socket, mix_t.inputs['Factor'])
        mul = nt.nodes.new('ShaderNodeMix')
        mul.data_type = 'RGBA'
        mul.blend_type = 'MULTIPLY'
        mul.inputs['Factor'].default_value = 1.0
        nt.links.new(base_link.from_socket, mul.inputs[6])
        nt.links.new(mix_t.outputs[2], mul.inputs[7])
        nt.links.new(mul.outputs[2], bsdf.inputs['Base Color'])
        tints.append(mix_t)
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    cam.data.lens = 50
    cam.location = (0.35, -4.4, 1.25)
    cam.rotation_euler = (Vector((0, 0, 1.05)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam
    for name, rot, e in (('Key', (55, 0, 30), 3.5), ('Rim', (60, 0, 200), 2.5)):
        l = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        l.data.energy = e
        l.rotation_euler = tuple(math.radians(v) for v in rot)
        scene.collection.objects.link(l)
    world = bpy.data.worlds.new('W')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.06, 0.08, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 32
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = 240, 400
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = 88
    scene.view_settings.view_transform = 'AgX'
    for name, (metal, cloth) in VARIANTS.items():
        for t in tints:
            t.inputs[6].default_value = (*cloth, 1)
            t.inputs[7].default_value = (*metal, 1)
        d = os.path.join(CLIENT_PUBLIC, 'avatars', name)
        os.makedirs(d, exist_ok=True)
        scene.render.filepath = os.path.join(d, 'thumb.jpg')
        bpy.ops.render.render(write_still=True)
        print(f'[knight] {name}/thumb.jpg')


def main():
    args = script_args()
    arm, body = load_knight()
    lod = make_lod(body)
    export_model(arm, [body, lod])
    if '--no-thumbs' not in args:
        bpy.data.objects.remove(lod)
        thumbs(arm, body)
    if '--no-anims' not in args:
        build_anims()
    print('[knight] tayyor')


main()
