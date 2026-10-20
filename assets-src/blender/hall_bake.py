"""Lightmap'larni Cycles'da pishiradi (3 qatlam) + o'rindiq AO.

  blender -b assets-src/out/hall.blend -P assets-src/blender/hall_bake.py -- --res 2048 --samples 128

Qatlamlar (client'da qo'shiladi):  yorug'lik = base + house * zal_chiroqlari + screen * ekran_rangi
  house.exr   - zal chiroqlari (tugma bilan yoqiladi/o'chiriladi)
  base.exr    - doim yonib turadigan (zina LED, EXIT, xira devor chiroqlari)
  screen.exr  - ekrandan tushadigan oq yorug'lik (client'da video rangiga ko'paytiriladi)
  seat_ao.png - o'rindiq/tirsaklik uchun ambient occlusion
"""
import os
import sys
import time
import argparse
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from common import script_args, CLIENT_PUBLIC  # noqa: E402

p = argparse.ArgumentParser()
p.add_argument('--res', type=int, default=2048)
p.add_argument('--samples', type=int, default=128)
p.add_argument('--ao-res', type=int, default=1024)
p.add_argument('--only', default='house,base,screen,ao')
p.add_argument('--lm-dir', default=os.path.join(CLIENT_PUBLIC, 'lightmaps'))
args = p.parse_args(script_args())
only = set(args.only.split(','))

LM_DIR = args.lm_dir
os.makedirs(LM_DIR, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = args.samples
scene.cycles.max_bounces = 8
scene.cycles.diffuse_bounces = 4
scene.cycles.glossy_bounces = 2
scene.cycles.transparent_max_bounces = 4
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
# Kam RAM (7 GB) uchun: rasmni bo'laklarga bo'lib pishirish xotirani tejaydi
scene.cycles.use_auto_tile = True
scene.cycles.tile_size = 512
scene.render.bake.margin = 8
scene.render.bake.margin_type = 'EXTEND'

hall = bpy.data.objects['Hall']
screen = bpy.data.objects['Screen']
bpy.data.collections['Collision'].hide_render = True
bpy.data.objects['BoothGlass'].hide_render = True
bpy.data.objects['LightSwitch_Rocker'].hide_render = False

# Diffuse pass metall yuzalarda bo'sh chiqadi - pishirish vaqtida metallikni o'chiramiz,
# emissiv materiallar yorug'lik manbai sifatida ishtirok etmaydi (haqiqiy lampalar bor).
for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if not bsdf:
        continue
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Emission Strength'].default_value = 0.0
    if m.name.startswith('EMIT_'):
        bsdf.inputs['Base Color'].default_value = (0.5, 0.5, 0.5, 1)

screen_bsdf = screen.active_material.node_tree.nodes['Principled BSDF']


def set_bake_image(objs, img):
    for ob in objs:
        ob.data.uv_layers.active = ob.data.uv_layers['Lightmap']
        for slot in ob.material_slots:
            nt = slot.material.node_tree
            node = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage')
            node.name = 'BAKE_TARGET'
            node.image = img
            nt.nodes.active = node


def denoise_and_save(img, path, fmt):
    dn = bpy.data.scenes.get('Denoise') or bpy.data.scenes.new('Denoise')
    dn.render.engine = 'BLENDER_WORKBENCH'
    dn.render.resolution_x, dn.render.resolution_y = img.size
    dn.render.resolution_percentage = 100
    if not dn.camera:
        cam = bpy.data.objects.new('dn_cam', bpy.data.cameras.new('dn_cam'))
        dn.collection.objects.link(cam)
        dn.camera = cam
    dn.use_nodes = True
    tree = dn.node_tree
    tree.nodes.clear()
    n_img = tree.nodes.new('CompositorNodeImage')
    n_img.image = img
    n_dn = tree.nodes.new('CompositorNodeDenoise')
    n_dn.use_hdr = fmt == 'EXR'
    n_out = tree.nodes.new('CompositorNodeComposite')
    tree.links.new(n_img.outputs['Image'], n_dn.inputs['Image'])
    tree.links.new(n_dn.outputs['Image'], n_out.inputs['Image'])
    s = dn.render.image_settings
    if fmt == 'EXR':
        s.file_format = 'OPEN_EXR'
        s.color_depth = '16'
        s.exr_codec = 'ZIP'
        s.color_mode = 'RGB'
    else:
        s.file_format = 'PNG'
        s.color_depth = '8'
        s.color_mode = 'BW'
        # AO - chiziqli ma'lumot: hech qanday rang o'zgartirishsiz yoziladi
        dn.display_settings.display_device = 'sRGB'
        dn.view_settings.view_transform = 'Raw'
    dn.render.filepath = path
    bpy.ops.render.render(write_still=True, scene=dn.name)


def bake_layer(name, house, base, screen_on):
    t = time.time()
    bpy.data.collections['L_House'].hide_render = not house
    bpy.data.collections['L_Base'].hide_render = not base
    screen_bsdf.inputs['Emission Strength'].default_value = 4.0 if screen_on else 0.0
    img = bpy.data.images.new(f'LM_{name}', args.res, args.res, float_buffer=True, alpha=False)
    set_bake_image([hall], img)
    bpy.ops.object.select_all(action='DESELECT')
    hall.select_set(True)
    bpy.context.view_layer.objects.active = hall
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True,
                        margin=8, target='IMAGE_TEXTURES')
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    lum = px.reshape(-1, 4)[:, :3].mean(1)
    if lum.max() <= 0:
        raise RuntimeError(f'{name}: pishirilgan rasm bo\'sh chiqdi')
    # Xom natija saqlanadi; shovqin alohida jarayonda tozalanadi (denoise.py) - xotira tejaladi
    s = scene.render.image_settings
    s.file_format, s.color_depth, s.exr_codec, s.color_mode = 'OPEN_EXR', '16', 'ZIP', 'RGB'
    img.save_render(os.path.join(LM_DIR, f'{name}.exr'), scene=scene)
    bpy.data.images.remove(img)
    print(f'PISHIRILDI {name}: {time.time() - t:.0f}s, qoplama {(lum > 1e-6).mean():.0%}, o\'rtacha {lum.mean():.4f}')


if 'house' in only:
    bake_layer('house', True, False, False)
if 'base' in only:
    bake_layer('base', False, True, False)
if 'screen' in only:
    bake_layer('screen', False, False, True)

if 'ao' in only:
    t = time.time()
    import json
    with open(os.path.join(CLIENT_PUBLIC, 'models', 'layout.json'), encoding='utf-8') as fp:
        lay = json.load(fp)
    seat = bpy.data.objects[lay['bake']['aoSeat']]
    arm = bpy.data.objects[lay['bake']['aoArm']]
    scene.world.light_settings.distance = 0.6
    scene.cycles.samples = max(64, args.samples)
    img = bpy.data.images.new('AO_seat', args.ao_res, args.ao_res, float_buffer=True, alpha=False)
    set_bake_image([seat, arm], img)
    bpy.ops.object.select_all(action='DESELECT')
    seat.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = seat
    bpy.ops.object.bake(type='AO', use_clear=True, margin=8, target='IMAGE_TEXTURES')
    denoise_and_save(img, os.path.join(CLIENT_PUBLIC, 'models', 'seat_ao.png'), 'PNG')
    print(f'PISHIRILDI ao: {time.time() - t:.0f}s')

print('BAKE TAYYOR')
