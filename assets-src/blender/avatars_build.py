"""Rocketbox avatarlari va animatsiyalarini web uchun tayyorlaydi.

  blender -b --factory-startup -P assets-src/blender/avatars_build.py

Natija (client/public/avatars):
  <id>/model.glb        mesh + skelet (materiallar: body, head, opacity)
  <id>/*.jpg|png        1K texturalar (rang, normal, roughness), opacity alfa bilan
  <id>/thumb.jpg        lobbi uchun rasm
  anims_m.glb / anims_f.glb  barcha animatsiyalar (har biri alohida clip, joyida)
"""
import os
import sys
import glob
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from common import ROOT, CLIENT_PUBLIC  # noqa: E402

SRC = os.path.join(ROOT, 'assets-src', 'rocketbox')
OUT = os.path.join(CLIENT_PUBLIC, 'avatars')
TEX = 1024

# Clip nomi -> manba fayl (jins prefiksisiz). Yurish/yugurish ildiz harakatisiz (joyida).
CLIPS = {
    'idle': 'idle_neutral_01__static',
    'idle_look': 'idle_look_around_01__static',
    'walk': 'walk_neutral_01__xy',
    'run': 'run_neutral_01__xy',
    'sit': 'sit_chair_idle_neutral_01__static',
    'sit_relaxed': 'sit_chair_idle_relaxed_01__static',
    'sit_look': 'sit_chair_idle_look_around__static',
    'sit_yawn': 'sit_chair_idle_yawn__static',
    'wave': 'wave_01__static',
    'clap': 'claphands_01__static',
    'cheer': 'cheer_01__static',
    'dance': 'dancing_cool__static',
    'dance2': 'dancing_neutral__static',
    'laugh': 'gestic_laugh_loud__static',
    'talk': 'gestic_talk_neutral_01__static',
    'crouch': 'crouch_idle__static',
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False, ignore_leaf_bones=False)
    return [o for o in bpy.data.objects if o not in before]


def pixels(img):
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(img.size[1], img.size[0], 4)


def save_image(arr, path, fmt, alpha=False):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('out', w, h, alpha=alpha)
    img.colorspace_settings.name = 'Non-Color'  # qiymatlar o'zgartirishsiz yoziladi
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.filepath_raw = path
    img.file_format = fmt
    img.save(filepath=path, quality=88)
    bpy.data.images.remove(img)


def load_resized(path, size):
    img = bpy.data.images.load(path, check_existing=False)
    img.colorspace_settings.name = 'Non-Color'
    if img.size[0] != size:
        img.scale(size, size)
    arr = pixels(img)
    bpy.data.images.remove(img)
    return arr


def build_avatar(avatar_id):
    reset()
    folder = os.path.join(SRC, 'avatars', avatar_id)
    objs = import_fbx(os.path.join(folder, f'{avatar_id}.fbx'))
    arm = next(o for o in objs if o.type == 'ARMATURE')
    meshes = [o for o in objs if o.type == 'MESH']
    for o in objs:
        if o.type not in ('ARMATURE', 'MESH'):
            bpy.data.objects.remove(o)
    arm.name = 'Avatar'
    arm.animation_data_clear()

    out_dir = os.path.join(OUT, avatar_id)
    os.makedirs(out_dir, exist_ok=True)

    # Materiallarni "body/head/opacity" ga qayta nomlash va texturalarni web uchun tayyorlash
    for me in meshes:
        me.name = 'Body'
        for m in me.data.materials:
            for part in ('body', 'head', 'opacity'):
                if m.name.endswith('_' + part):
                    m.name = part
    tex = {os.path.basename(p).lower(): p for p in glob.glob(os.path.join(folder, '*.tga'))}

    def find(part, kind):
        for name, p in tex.items():
            if name.endswith(f'_{part}_{kind}.tga'):
                return p
        return None

    for part in ('body', 'head'):
        color = find(part, 'color')
        normal = find(part, 'normal')
        spec = find(part, 'specular')
        if color:
            save_image(load_resized(color, TEX), os.path.join(out_dir, f'{part}_color.jpg'), 'JPEG')
        if normal:
            save_image(load_resized(normal, TEX), os.path.join(out_dir, f'{part}_normal.jpg'), 'JPEG')
        if spec:
            s = load_resized(spec, TEX // 2)
            # Rocketbox "specular" (yaltiroqlik) -> PBR roughness
            rough = np.clip(0.95 - s[..., :3].mean(axis=2, keepdims=True) * 0.75, 0.3, 1.0)
            rgba = np.concatenate([np.repeat(rough, 3, axis=2), np.ones_like(rough)], axis=2)
            save_image(rgba, os.path.join(out_dir, f'{part}_rough.jpg'), 'JPEG')
    opacity = find('opacity', 'color')
    if opacity:
        save_image(load_resized(opacity, TEX // 2), os.path.join(out_dir, 'opacity.png'), 'PNG', alpha=True)

    thumb = os.path.join(SRC, 'previews', f'{avatar_id}.png')
    if os.path.exists(thumb):
        img = bpy.data.images.load(thumb, check_existing=False)
        w, h = img.size
        img.scale(int(w * 320 / h), 320)
        arr = pixels(img)
        # Shaffof fonni to'q rangga almashtirish
        a = arr[..., 3:4]
        arr[..., :3] = arr[..., :3] * a + np.array([0.08, 0.085, 0.1]) * (1 - a)
        arr[..., 3] = 1
        img_out = os.path.join(out_dir, 'thumb.jpg')
        save_image(arr, img_out, 'JPEG')
        bpy.data.images.remove(img)

    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    for me in meshes:
        me.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out_dir, 'model.glb'), export_format='GLB', use_selection=True,
        export_animations=False, export_skins=True, export_materials='EXPORT', export_image_format='NONE',
        export_texcoords=True, export_normals=True, export_yup=True)
    tris = sum(sum(len(p.vertices) - 2 for p in me.data.polygons) for me in meshes)
    height = max(v.co.z for me in meshes for v in me.data.vertices) * arm.scale.z
    print(f'AVATAR {avatar_id}: {tris} uchburchak, bo\'y ~{height:.2f} m, {len(arm.data.bones)} suyak')


# Yuz suyaklari (lab-sinxron keyinroq koddan boshqariladi) - animatsiyadan chiqariladi
FACE_BONES = ('Eye', 'Jaw', 'Lip', 'Tongue', 'Mouth', 'Masseter', 'Caninus', 'Cheek', 'Eyebrow', 'Nose', 'Upperlip')


def build_anims(gender):
    """Har bir clip o'z skeleti bilan alohida GLB: FBX fayllarining dam holatlari har xil,
    shuning uchun ularni bitta skeletga birlashtirib bo'lmaydi. glTF esa lokal transformlarni
    to'liq yozadi - three.js'da ular istalgan Biped avatarga to'g'ri tushadi."""
    out_dir = os.path.join(OUT, f'anims_{gender}')
    os.makedirs(out_dir, exist_ok=True)
    total = 0
    for clip, src in CLIPS.items():
        reset()
        objs = import_fbx(os.path.join(SRC, 'anims', f'{gender}_{src}.fbx'))
        arm = next(o for o in objs if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action)
        for o in objs:
            if o is not arm:
                if o.animation_data:
                    o.animation_data_clear()
                bpy.data.objects.remove(o)
        act = arm.animation_data.action
        act.name = clip
        for fc in list(act.fcurves):
            path = fc.data_path
            if not path.startswith('pose.bones'):
                act.fcurves.remove(fc)  # ildiz harakati -> animatsiya joyida
                continue
            bone = path.split('"')[1]
            if path.endswith('.scale') or any(k in bone for k in FACE_BONES):
                act.fcurves.remove(fc)
            elif path.endswith('.location') and bone != 'Bip01 Pelvis':
                act.fcurves.remove(fc)  # mocap'da faqat tos suyagi siljiydi
        arm.name = 'Avatar'
        bpy.ops.object.select_all(action='DESELECT')
        arm.select_set(True)
        bpy.context.view_layer.objects.active = arm
        path = os.path.join(out_dir, f'{clip}.glb')
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_animations=True,
            export_animation_mode='ACTIVE_ACTIONS', export_skins=False, export_materials='NONE',
            export_optimize_animation_size=True, export_yup=True)
        total += os.path.getsize(path)
    print(f'ANIMS {gender}: {len(CLIPS)} clip -> {total / 1e6:.1f} MB')


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    only = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    avatars = sorted(os.listdir(os.path.join(SRC, 'avatars')))
    for a in avatars:
        if not only or a in only:
            build_avatar(a)
    for g in ('m', 'f'):
        if not only or g in only:
            build_anims(g)
    print('AVATARLAR TAYYOR')
