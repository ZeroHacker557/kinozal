"""Tezkor tekshiruv rendeli (Eevee). blender -b assets-src/out/hall.blend -P preview.py -- [house|base]"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from common import script_args, OUT_DIR  # noqa: E402

args = script_args()
mode = args[0] if args else 'house'
scene = bpy.context.scene
for eng in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        pass
scene.render.resolution_x, scene.render.resolution_y = 1280, 720
scene.view_settings.view_transform = 'AgX'
scene.view_settings.exposure = 1.0

bpy.data.collections['L_House'].hide_render = mode != 'house'
EMIT = {'EMIT_House': 30 if mode == 'house' else 0, 'EMIT_Sconce': 20 if mode == 'house' else 2,
        'EMIT_Step': 8, 'EMIT_Exit': 6, 'EMIT_Label': 3, 'EMIT_Projector': 10}
for name, s in EMIT.items():
    m = bpy.data.materials.get(name)
    if m:
        m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = s
bpy.data.collections['Collision'].hide_render = True

cam_data = bpy.data.cameras.new('cam')
cam_data.lens = 18
cam = bpy.data.objects.new('cam', cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

VIEWS = {
    'back': ((0, -9.5, 5.7), (0, 8, 3.5)),
    'door': ((-7.8, 9.2, 1.65), (2, 0, 2.2)),
    'aisle': ((8.3, -2, 3.6), (-2, 8, 2.5)),
    'switch': ((-8.2, 10.2, 1.55), (-9, 10.6, 1.2)),
}
for name, (loc, target) in VIEWS.items():
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT_DIR, f'preview_{mode}_{name}.png')
    bpy.ops.render.render(write_still=True)
print('PREVIEW TAYYOR')
