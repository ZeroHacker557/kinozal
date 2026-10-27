"""Blender skriptlari uchun umumiy yordamchilar (bmesh geometriya, materiallar, eksport)."""
import bpy
import bmesh
import math
import sys
import os
from mathutils import Vector, Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'assets-src', 'out')
CLIENT_PUBLIC = os.path.join(ROOT, 'client', 'public')


def script_args():
    a = sys.argv
    return a[a.index('--') + 1:] if '--' in a else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0, 0, 0, 1)
    scene.world = world
    return scene


def make_material(name, color, rough=0.8, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Alpha'].default_value = alpha
    if emit is not None:
        bsdf.inputs['Emission Color'].default_value = (*emit, 1)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    return m


class MeshBuilder:
    """Bitta obyekt uchun geometriyani bmesh'da yig'adi; materiallar slot indekslari bilan."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    # --- primitivlar -------------------------------------------------------
    def box(self, mn, mx, mat, bevel=0.0, segments=2, skip=(), face_mats=None, matrix=None, inward=False):
        """Eksa bo'yicha tekislangan quti. skip: tashlab yuboriladigan tomonlar ('+x','-z',...).
        face_mats: tomon -> material (masalan {'+z': carpet}). inward: ichidan ko'rinadigan xona."""
        mn, mx = Vector(mn), Vector(mx)
        size = mx - mn
        center = (mn + mx) / 2
        m = Matrix.Translation(center) @ Matrix.Diagonal((*size, 1))
        if matrix is not None:
            m = matrix @ m
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)['verts']
        faces = list({f for v in verts for f in v.link_faces})
        base = self.mi(mat)
        rot = matrix.to_3x3() if matrix is not None else Matrix.Identity(3)
        inv = rot.inverted()
        drop = []
        for f in faces:
            f.normal_update()
            n = inv @ f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            key = ('+' if n[ax] > 0 else '-') + 'xyz'[ax]
            f.material_index = base
            if face_mats and key in face_mats:
                f.material_index = self.mi(face_mats[key])
            if key in skip:
                drop.append(f)
        if bevel > 0 and not drop:
            edges = list({e for f in faces for e in f.edges})
            res = bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type='OFFSET',
                                  segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
            # Faska yuzalari asosiy materialni olsin (aks holda 0-slot materiali tushib qoladi)
            for f in res['faces']:
                f.material_index = base
        if drop:
            bmesh.ops.delete(self.bm, geom=drop, context='FACES_ONLY')
        if inward:
            keep = [f for f in faces if f.is_valid]
            bmesh.ops.reverse_faces(self.bm, faces=keep)
        return verts

    def cylinder(self, center, radius, depth, mat, segments=24, axis='z', cap=True, radius2=None):
        rot = {'z': Matrix.Identity(4),
               'x': Matrix.Rotation(math.pi / 2, 4, 'Y'),
               'y': Matrix.Rotation(math.pi / 2, 4, 'X')}[axis]
        m = Matrix.Translation(Vector(center)) @ rot
        res = bmesh.ops.create_cone(self.bm, cap_ends=cap, cap_tris=False, segments=segments,
                                    radius1=radius, radius2=radius if radius2 is None else radius2,
                                    depth=depth, matrix=m)
        idx = self.mi(mat)
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = idx
        return res['verts']

    def tube(self, p0, p1, radius, mat, segments=12):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        m = Matrix.Translation((p0 + p1) / 2) @ rot
        res = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segments,
                                    radius1=radius, radius2=radius, depth=d.length, matrix=m)
        idx = self.mi(mat)
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = idx

    def sphere(self, center, radius, mat, segs=16):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=segs // 2, radius=radius,
                                        matrix=Matrix.Translation(Vector(center)))
        idx = self.mi(mat)
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = idx

    def grid(self, fn, nu, nv, mat):
        """fn(u, v) -> Vector; u,v in [0,1]. To'r sirt (parda burmalari va h.k.)."""
        idx = self.mi(mat)
        rows = []
        for j in range(nv + 1):
            row = []
            for i in range(nu + 1):
                row.append(self.bm.verts.new(fn(i / nu, j / nv)))
            rows.append(row)
        for j in range(nv):
            for i in range(nu):
                f = self.bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
                f.material_index = idx
                f.smooth = True

    def text(self, body, size, matrix, mat, extrude=0.002):
        cu = bpy.data.curves.new('tmp_text', 'FONT')
        cu.body = body
        cu.size = size
        cu.align_x = 'CENTER'
        cu.align_y = 'CENTER'
        cu.extrude = extrude
        ob = bpy.data.objects.new('tmp_text', cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        me.transform(matrix)
        idx = self.mi(mat)
        for p in me.polygons:
            p.material_index = idx
        self.bm.from_mesh(me)
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)

    # --- yakunlash --------------------------------------------------------
    def world_uv(self, layer='UVMap'):
        """Har bir yuzaga dunyo koordinatalari (metr) bo'yicha quti proyeksiyasi.
        Natijada texturalar real o'lchamda takrorlanadi (repeat = 1 / plitka_o'lchami)."""
        uv = self.bm.loops.layers.uv.get(layer) or self.bm.loops.layers.uv.new(layer)
        for f in self.bm.faces:
            f.normal_update()
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                c = l.vert.co
                if ax == 0:
                    u, v = (c.y if n.x < 0 else -c.y), c.z
                elif ax == 1:
                    u, v = (-c.x if n.y < 0 else c.x), c.z
                else:
                    u, v = c.x, (c.y if n.z > 0 else -c.y)
                l[uv].uv = (u, v)

    def build(self, collection=None, smooth_angle=None):
        self.world_uv()
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        if smooth_angle is not None:
            # Burchakka qarab silliqlash (Blender 4.1+)
            me.shade_smooth()
            try:
                bpy.context.view_layer.objects.active = ob
                ob.select_set(True)
                bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
                ob.select_set(False)
            except Exception:
                pass
        return ob


def collection(name):
    c = bpy.data.collections.get(name)
    if not c:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def select_only(objs, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]


def lightmap_uv(objs, margin=0.004, angle=60):
    """Ikkinchi UV (lightmap) — barcha obyektlar uchun bitta umumiy atlas."""
    for o in objs:
        uvs = o.data.uv_layers
        lm = uvs.get('Lightmap') or uvs.new(name='Lightmap')
        uvs.active = lm
    select_only(objs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers['UVMap']


def export_glb(objs, path, vertex_color=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    select_only(objs)
    kwargs = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                  export_texcoords=True, export_normals=True, export_materials='EXPORT',
                  export_image_format='NONE', export_yup=True, export_extras=True)
    if vertex_color:
        kwargs['export_vertex_color'] = 'ACTIVE'
    bpy.ops.export_scene.gltf(**kwargs)


def to_three(v):
    """Blender (Z yuqori) -> three.js (Y yuqori)."""
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]
