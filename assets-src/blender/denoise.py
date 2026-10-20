"""Pishirilgan lightmap'larni alohida Blender jarayonida OIDN bilan tozalaydi.
Kam xotirali kompyuterda 2048px rasmni bir yo'la tozalab bo'lmaydi (OIDN jimgina bo'sh natija
qaytaradi), shuning uchun rasm bir-birini qoplaydigan bo'laklarga bo'linib tozalanadi.

  blender -b --factory-startup -P assets-src/blender/denoise.py -- client/public/lightmaps/house.exr ...
"""
import os
import sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from common import script_args  # noqa: E402

TILE = 768
OVERLAP = 48

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
scene.use_nodes = True
s = scene.render.image_settings
s.file_format = 'OPEN_EXR'
s.color_depth = '32'
s.exr_codec = 'ZIP'
s.color_mode = 'RGBA'
scene.render.resolution_percentage = 100

tree = scene.node_tree
tree.nodes.clear()
n_img = tree.nodes.new('CompositorNodeImage')
n_dn = tree.nodes.new('CompositorNodeDenoise')
n_dn.use_hdr = True
n_out = tree.nodes.new('CompositorNodeComposite')
tree.links.new(n_img.outputs['Image'], n_dn.inputs['Image'])
tree.links.new(n_dn.outputs['Image'], n_out.inputs['Image'])


def read(img):
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(img.size[1], img.size[0], 4)


def denoise_tile(arr, tmp):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('tile', w, h, float_buffer=True, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    n_img.image = img
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = tmp
    bpy.ops.render.render(write_still=True)
    out = bpy.data.images.load(tmp, check_existing=False)
    res = read(out)
    bpy.data.images.remove(out)
    bpy.data.images.remove(img)
    os.remove(tmp)
    return res


def feather(n, lo, hi):
    """Bo'lak chetlarida yumshoq o'tish og'irliklari (bo'laklar silliq qo'shiladi)."""
    w = np.ones(n, dtype=np.float32)
    if lo:
        w[:OVERLAP] = np.linspace(0.0, 1.0, OVERLAP, dtype=np.float32)
    if hi:
        w[-OVERLAP:] = np.linspace(1.0, 0.0, OVERLAP, dtype=np.float32)
    return w


for path in script_args():
    path = os.path.abspath(path)
    src = bpy.data.images.load(path, check_existing=False)
    arr = read(src)
    bpy.data.images.remove(src)
    arr[..., 3] = 1.0
    H, W = arr.shape[:2]
    acc = np.zeros_like(arr)
    wsum = np.zeros((H, W, 1), dtype=np.float32)
    ok = True
    for y0 in range(0, H, TILE):
        for x0 in range(0, W, TILE):
            ya, yb = max(0, y0 - OVERLAP), min(H, y0 + TILE + OVERLAP)
            xa, xb = max(0, x0 - OVERLAP), min(W, x0 + TILE + OVERLAP)
            tile = denoise_tile(np.ascontiguousarray(arr[ya:yb, xa:xb]), path + '.tile.exr')
            if tile[..., :3].max() <= 0 and arr[ya:yb, xa:xb, :3].max() > 0:
                ok = False
                break
            wy = feather(yb - ya, ya > 0, yb < H)[:, None, None]
            wx = feather(xb - xa, xa > 0, xb < W)[None, :, None]
            wgt = wy * wx
            acc[ya:yb, xa:xb] += tile * wgt
            wsum[ya:yb, xa:xb] += wgt
        if not ok:
            break
    if not ok:
        print(f'DENOISE O\'TKAZIB YUBORILDI (bo\'sh natija): {path}')
        continue
    res = acc / np.maximum(wsum, 1e-6)
    # Atlasning bo'sh joylari bo'sh qolsin (lightmap chegaralari aniq bo'lishi uchun)
    empty = arr[..., :3].max(axis=2) <= 0
    res[empty, :3] = 0
    res[..., 3] = 1.0

    out = bpy.data.images.new('out', W, H, float_buffer=True, alpha=False)
    out.pixels.foreach_set(res.astype(np.float32).ravel())
    out.filepath_raw = path
    out.file_format = 'OPEN_EXR'
    scene.render.image_settings.color_depth = '16'
    scene.render.image_settings.color_mode = 'RGB'
    out.save_render(path, scene=scene)
    scene.render.image_settings.color_depth = '32'
    scene.render.image_settings.color_mode = 'RGBA'
    bpy.data.images.remove(out)
    print(f'DENOISE {os.path.basename(path)}: o\'rtacha {arr[..., :3].mean():.4f} -> {res[..., :3].mean():.4f}')
