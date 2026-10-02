"""Belna star mascot — procedural Blender build + sprite renders.

Run headless:
  blender -b -P design/mascot/build_mascot.py -- [--preview] [--only props|laptop|desk] [--colors a,b] [--out DIR]

Builds a soft, puffy clay star from metaballs, saves mascot.blend and a
lightweight mascot.glb next to this script, then renders transparent WebP
sprites into app/mascot/:
  star-<colour>        plain front view, one per palette colour
  star-lingon-hold     hold pose: the star's own side arms bend forward to grip
  prop-<name>          hero-loop props in the hold pose's hands (same frame)
  star-<colour>-<prop> landing helpers holding their item (hold pose)
  star-lingon-laptop   hold pose typing on a laptop, raised 3/4 view
  star-<colour>-desk   laptop pose wearing headphones (chat header, working)
Hands are always the star's own arm tips in the one hold pose, never add-ons.
The face is NOT rendered: app/mascot.js draws
eyes, mouth and blush as SVG on top so moods and blinking stay animatable.
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in argv
ONLY = argv[argv.index('--only') + 1] if '--only' in argv else None   # 'props' | 'laptop' | 'desk': skip body sprites
OUT = argv[argv.index('--out') + 1] if '--out' in argv else os.path.join(ROOT, 'app', 'mascot')

# Keep in sync with PALETTE in app/mascot.js (body colours).
PALETTE = {
    'lingon': '#4A7FD4',
    'blueberry': '#B7D6FF',
    'moss': '#D8F3B0',
    'sun': '#FFE0A3',
    'rose': '#E8B5F4',
}
COLORS = argv[argv.index('--colors') + 1].split(',') if '--colors' in argv else list(PALETTE)

SIZE = 512          # sprite resolution (square)
ORTHO = 2.2         # camera ortho scale; star spans ~1.9 units


def lin(hexstr):
    """sRGB hex -> linear RGBA."""
    h = hexstr.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


_CENTRE = None   # idle star's bbox centre (x, z), shared by every pose


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------- geometry
# Holding pose: the star has no hands — its two side points ARE the arms.
# Each side point is one tapered, round-tipped point swept along a path: it
# leaves the shoulder like the idle point, then curls forward and down so its
# own tip rests on the item. It is fused into the body by the voxel remesh,
# so there is no joint, mitten or add-on.  (x, y, z, radius) for the right arm
ARM_PATH = [(0.3, 0.0, 0.1, 0.27), (0.56, -0.02, 0.13, 0.24), (0.8, -0.13, 0.0, 0.185),
            (0.74, -0.34, -0.26, 0.14), (0.54, -0.48, -0.42, 0.115)]
HOLD_X, HOLD_Y, HOLD_Z = ARM_PATH[-1][:3]    # tip centre; re-based once the frame is known


def build_arm(side):
    cu = bpy.data.curves.new('Arm', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 10
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS')
    sp.points.add(len(ARM_PATH) - 1)
    for pt, (x, y, z, r) in zip(sp.points, ARM_PATH):
        pt.co = (side * x, y, z, 1.0)
        pt.radius = r
    sp.order_u = 3
    sp.use_endpoint_u = True
    sp.resolution_u = 24
    o = bpy.data.objects.new('Arm', cu)
    bpy.context.collection.objects.link(o)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob is o)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target='MESH')
    arm = bpy.context.active_object
    x, y, z, r = ARM_PATH[-1]
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=r, location=(side * x, y, z))
    return [arm, bpy.context.active_object]


def build_star(pose='idle'):
    """Metaball star: fat centre + two tapered lobes per arm, blended soft.
    pose='hold' replaces the two side points with build_arm() holding arms."""
    mb = bpy.data.metaballs.new('StarMeta')
    mb.resolution = 0.03
    mb.render_resolution = 0.018
    mb.threshold = 0.6
    obj = bpy.data.objects.new('StarMeta', mb)
    bpy.context.collection.objects.link(obj)

    def ell(x, z, angle, r, sx, sy, sz, stiff=2.0, y=0.0, dirv=None):
        e = mb.elements.new(type='ELLIPSOID')
        e.co = (x, y, z)
        e.radius = r
        e.stiffness = stiff
        e.size_x, e.size_y, e.size_z = sx, sy, sz  # along arm, depth, across arm
        e.rotation = (Vector((1, 0, 0)).rotation_difference(dirv) if dirv is not None
                      else Euler((0.0, -angle, 0.0)).to_quaternion())
        return e

    # centre body — the puffiest part
    ell(0.0, -0.02, 0.0, 0.60, 1.0, 0.78, 1.0, 2.2)
    for k in range(5):
        a = math.radians(90 + 72 * k)
        d = (math.cos(a), math.sin(a))
        # base lobe (wide, thick) and tip lobe (narrow, rounded); in the hold
        # pose the side points keep their shoulder lobe and the swept arm grows
        # out of it, so the join is the star's own shoulder, not a seam
        ell(d[0] * 0.38, d[1] * 0.38, a, 0.46, 1.2, 0.74, 0.92, 2.0)
        if pose == 'hold' and k in (1, 4):
            continue
        ell(d[0] * 0.68, d[1] * 0.68, a, 0.29, 1.45, 0.86, 0.78, 2.0)

    # bake to mesh
    dg = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    star = bpy.data.objects.new('BelnaStarHold' if pose == 'hold' else 'BelnaStar', mesh)
    bpy.context.collection.objects.link(star)
    if pose == 'hold':
        parts = build_arm(1) + build_arm(-1)
        for ob in bpy.context.scene.objects:
            ob.select_set(ob is star or ob in parts)
        bpy.context.view_layer.objects.active = star
        bpy.ops.object.join()               # the remesh below fuses them into one body

    # clean quad-ish topology + smooth
    bpy.context.view_layer.objects.active = star
    star.select_set(True)
    rm = star.modifiers.new('Remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = 0.018
    sm = star.modifiers.new('Smooth', 'CORRECTIVE_SMOOTH')
    sm.iterations = 22 if pose == 'hold' else 8
    sm.use_only_smooth = True
    bpy.ops.object.modifier_apply(modifier='Remesh')
    bpy.ops.object.modifier_apply(modifier='Smooth')
    bpy.ops.object.shade_smooth()

    # recentre so the idle silhouette is centred on the origin; the hold pose
    # reuses the same offset so head, face and legs line up pixel for pixel
    global _CENTRE
    if pose == 'idle' or _CENTRE is None:
        bb = [star.matrix_world @ Vector(c) for c in star.bound_box]
        _CENTRE = ((min(v.x for v in bb) + max(v.x for v in bb)) / 2,
                   (min(v.z for v in bb) + max(v.z for v in bb)) / 2)
    mesh = star.data
    cx, cz = _CENTRE
    if pose == 'hold':
        global HOLD_X, HOLD_Z
        HOLD_X, HOLD_Z = ARM_PATH[-1][0] - cx, ARM_PATH[-1][2] - cz
    for v in mesh.vertices:
        v.co.x -= cx
        v.co.z -= cz
    return star


# ---------------------------------------------------------------- material
def clay_material():
    m = bpy.data.materials.new('BelnaClay')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = lin(PALETTE['lingon'])
    bsdf.inputs['Roughness'].default_value = 0.78
    bsdf.inputs['Subsurface Weight'].default_value = 0.12
    bsdf.inputs['Subsurface Radius'].default_value = (0.3, 0.4, 0.8)
    bsdf.inputs['Subsurface Scale'].default_value = 0.05
    bsdf.inputs['Sheen Weight'].default_value = 0.35
    bsdf.inputs['Sheen Roughness'].default_value = 0.6
    bsdf.inputs['Specular IOR Level'].default_value = 0.25
    # fine felt / soft-touch grain
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 90.0
    nz.inputs['Detail'].default_value = 6.0
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.06
    bump.inputs['Distance'].default_value = 0.02
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    nt.links.new(nz.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def set_color(mat, hexstr):
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = lin(hexstr)


# ---------------------------------------------------------------- scene
def area(name, loc, energy, size, color=(1, 1, 1)):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    ld.color = color
    lo = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(lo)
    lo.location = loc
    d = Vector((0, 0, 0)) - Vector(loc)
    lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return lo


def setup_scene():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48 if PREVIEW else 160
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.render.resolution_x = SIZE
    sc.render.resolution_y = SIZE
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = -0.22
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.quality = 88

    world = bpy.data.worlds.new('Studio')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
    bg.inputs['Strength'].default_value = 0.2
    sc.world = world

    # soft studio: big key top-left-front, fill right, top rim
    area('Key', (-3.4, -3.6, 3.2), 520, 3.5)
    area('Fill', (3.8, -3.0, -0.4), 70, 5.0, (0.96, 0.98, 1.0))
    area('Rim', (0.4, 3.0, 3.8), 260, 3.0)

    cam_d = bpy.data.cameras.new('Cam')
    cam_d.type = 'ORTHO'
    cam_d.ortho_scale = ORTHO
    cam = bpy.data.objects.new('Cam', cam_d)
    bpy.context.collection.objects.link(cam)
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    return sc, cam


# ---------------------------------------------------------------- props
# Everything below sits in front of the star's lower body: the face overlay
# ends around z = -0.26, so prop tops stay under that line.
_mats = {}


def mat(hexstr, rough=0.72, sheen=0.25, metal=0.0, emit=0.0):
    key = (hexstr, rough, sheen, metal, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(f'Clay{len(_mats)}')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexstr)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Sheen Weight'].default_value = sheen
    b.inputs['Specular IOR Level'].default_value = 0.3
    if emit:
        b.inputs['Emission Color'].default_value = lin(hexstr)
        b.inputs['Emission Strength'].default_value = emit
    _mats[key] = m
    return m


def _finish(o, color, bevel=0.0, segments=5, smooth_angle=None, **mk):
    bpy.context.view_layer.objects.active = o
    if bevel:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel
        b.segments = segments
        b.limit_method = 'NONE'
        bpy.ops.object.modifier_apply(modifier='Bevel')
    if smooth_angle is None:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    o.data.materials.append(mat(color, **mk))
    return o


def rbox(w, d, h, loc, color, bevel=0.03, rot=(0, 0, 0), **mk):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, color, bevel=bevel, smooth_angle=40, **mk)


def ball(r, loc, color, scale=(1, 1, 1), rot=(0, 0, 0), **mk):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=r, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, color, **mk)


def disc(r, depth, loc, color, rot=(math.radians(90), 0, 0), verts=40, bevel=0.006, **mk):
    """Cylinder; default axis points at the camera (-Y)."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, color, bevel=bevel, segments=3, smooth_angle=40, **mk)


def ring(major, minor, loc, color, rot=(0, 0, 0), **mk):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, location=loc, rotation=rot,
                                     major_segments=48, minor_segments=16)
    return _finish(bpy.context.active_object, color, **mk)


def plate(points, thick, y, color, bevel=0.006, **mk):
    """Flat polygon in the XZ plane at depth y, given (x, z) points."""
    me = bpy.data.meshes.new('plate')
    me.from_pydata([(x, 0.0, z) for x, z in points], [], [list(range(len(points)))])
    o = bpy.data.objects.new('plate', me)
    bpy.context.collection.objects.link(o)
    o.location.y = y
    bpy.context.view_layer.objects.active = o
    s = o.modifiers.new('Solid', 'SOLIDIFY')
    s.thickness = thick
    bpy.ops.object.modifier_apply(modifier='Solid')
    return _finish(o, color, bevel=bevel, segments=3, smooth_angle=40, **mk)


def front_y(star, x, z):
    """Depth of the star's front surface at (x, z)."""
    hit, loc, _n, _i = star.ray_cast(Vector((x, -5.0, z)), Vector((0.0, 1.0, 0.0)))
    return loc.y if hit else -0.3


def football(r, loc):
    phi = (1 + 5 ** 0.5) / 2
    dirs = []
    for a in (-1, 1):
        for b in (-phi, phi):
            dirs += [Vector((0, a, b)), Vector((a, b, 0)), Vector((b, 0, a))]
    dirs = [d.normalized() for d in dirs]
    # turn the ball so one pentagon faces the camera, rotated a little for life
    q = dirs[0].rotation_difference(Vector((0, -1, 0)))
    q = Euler((math.radians(14), math.radians(-18), math.radians(10))).to_quaternion() @ q
    dirs = [q @ d for d in dirs]
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=6, radius=r, location=loc)
    o = bpy.context.active_object
    for p in o.data.polygons:
        n = p.normal
        p.material_index = 1 if max(n.dot(d) for d in dirs) > math.cos(math.radians(19)) else 0
    _finish(o, '#FBFBF8', rough=0.55)
    o.data.materials.append(mat('#23252B', rough=0.5))
    return o


def prop_mail(star, zc=-0.52):
    y0 = front_y(star, 0, zc)
    w, h, d = 0.62, 0.40, 0.05
    y = y0 - d / 2 - 0.03
    top, bot = zc + h / 2, zc - h / 2
    objs = [rbox(w, d, h, (0, y, zc), '#FBF8F1', bevel=0.03)]
    fy = y - d / 2 - 0.004
    objs.append(plate([(-w / 2 + 0.03, bot + 0.03), (0, zc - 0.02), (w / 2 - 0.03, bot + 0.03)], 0.006, fy, '#F1EBDF'))
    objs.append(plate([(-w / 2 + 0.02, top - 0.02), (w / 2 - 0.02, top - 0.02), (0, zc - 0.06)], 0.012, fy - 0.006, '#F5F0E6'))
    objs.append(disc(0.05, 0.02, (0, fy - 0.02, zc - 0.06), PALETTE['lingon']))
    return objs


def prop_phone(star, zc=-0.5):
    """Phone held sideways for a call, so both hands can grip it."""
    y0 = front_y(star, 0, zc)
    w, h, d = 0.56, 0.3, 0.045
    y = y0 - d / 2 - 0.05
    objs = [rbox(w, d, h, (0, y, zc), '#2A2D34', bevel=0.045, rough=0.4, sheen=0.1)]
    sy = y - d / 2 - 0.002
    objs.append(rbox(w - 0.06, 0.006, h - 0.045, (0, sy, zc), '#DCEBFF', bevel=0.02, emit=0.35))
    objs.append(disc(0.062, 0.01, (-0.07, sy - 0.006, zc + 0.01), PALETTE['lingon']))
    objs.append(disc(0.038, 0.012, (0.14, sy - 0.006, zc - 0.05), '#34C759', emit=0.2))
    objs.append(disc(0.038, 0.012, (0.14, sy - 0.006, zc + 0.06), '#F0625D', emit=0.2))
    return objs


def prop_laptop(star, zc=-0.56):
    y0 = front_y(star, 0, zc)
    w, h = 0.74, 0.46
    bot = zc - h / 2
    lid_y = y0 - 0.5
    objs = [rbox(w, 0.028, h, (0, lid_y, zc), '#D6DBE2', bevel=0.022, rough=0.38, sheen=0.1, metal=0.25,
                 rot=(math.radians(-8), 0, 0)),
            rbox(w + 0.02, 0.46, 0.03, (0, (lid_y + y0) / 2 - 0.02, bot), '#C9CFD8', bevel=0.012, rough=0.4, metal=0.25),
            disc(0.045, 0.01, (0, lid_y - 0.02, zc + 0.02), PALETTE['lingon'], emit=0.1)]
    return objs


def prop_wallet(star, zc=-0.6):
    y0 = front_y(star, 0, zc)
    w, h, d = 0.52, 0.32, 0.1
    y = y0 - d / 2 - 0.03
    top = zc + h / 2
    objs = [rbox(0.4, 0.014, 0.2, (-0.04, y - 0.01, top + 0.0), '#8CC784', bevel=0.004, rot=(0, math.radians(7), 0), rough=0.8),
            rbox(0.4, 0.014, 0.2, (0.05, y - 0.03, top - 0.02), '#B5DEAD', bevel=0.004, rot=(0, math.radians(-5), 0), rough=0.8),
            rbox(w, d, h, (0, y, zc), '#6E4630', bevel=0.045, rough=0.6),
            rbox(w * 0.62, 0.03, 0.14, (w * 0.2, y - d / 2 - 0.01, zc + 0.02), '#5A3826', bevel=0.02, rough=0.6),
            disc(0.028, 0.015, (w * 0.34, y - d / 2 - 0.032, zc + 0.02), '#E6BE63', rough=0.3, metal=0.6),
            disc(0.06, 0.018, (-w * 0.2, y - d / 2 - 0.02, zc - 0.07), '#E9B94E', rough=0.3, metal=0.6),
            disc(0.05, 0.018, (-w * 0.08, y - d / 2 - 0.035, zc - 0.1), '#F1CC6A', rough=0.3, metal=0.6)]
    return objs


def prop_schedule(star, color, zc=-0.53):
    y0 = front_y(star, 0, zc)
    w, h, d = 0.66, 0.48, 0.035
    y = y0 - d / 2 - 0.04
    top = zc + h / 2
    objs = [rbox(w, d, h, (0, y, zc), '#FFFFFF', bevel=0.03, rough=0.6),
            rbox(w - 0.03, 0.01, 0.1, (0, y - d / 2 - 0.004, top - 0.065), '#F07E74', bevel=0.004, rough=0.6)]
    for x in (-0.14, 0.14):
        objs.append(ring(0.045, 0.013, (x, y - 0.01, top + 0.012), '#5B6170', rot=(0, math.radians(90), 0), rough=0.35, metal=0.4))
    cells = ['#4A7FD4', '#EEF1F5', '#7BC47F', '#F2C14E',
             '#EEF1F5', '#E58BB1', '#EEF1F5', '#4A7FD4',
             '#F2C14E', '#EEF1F5', '#9B6BD3', '#EEF1F5']
    fy = y - d / 2 - 0.008
    for i, c in enumerate(cells):
        cx = -0.24 + (i % 4) * 0.16
        cz = top - 0.17 - (i // 4) * 0.1
        objs.append(rbox(0.12, 0.012, 0.075, (cx, fy, cz), c, bevel=0.014, rough=0.6))
    return objs


def prop_bag(star, color, zc=-0.56):
    y0 = front_y(star, 0, zc)
    w, h, d = 0.62, 0.5, 0.16
    y = y0 - d / 2 - 0.02
    top = zc + h / 2
    objs = [core(rbox(w, d, h, (0, y, zc), '#D9A867', bevel=0.035, rough=0.8)),
            rbox(w + 0.004, d + 0.004, 0.06, (0, y, top - 0.04), '#C8924F', bevel=0.03, rough=0.8),
            ring(0.09, 0.016, (0, y - d / 2 + 0.03, top - 0.01), '#B97F40', rot=(math.radians(90), 0, 0), rough=0.7),
            # groceries peeking out
            ball(0.045, (-0.13, y + 0.02, top + 0.035), '#E7AE5A', scale=(1, 1, 2.0),
                 rot=(0, math.radians(-24), 0), rough=0.8),
            ball(0.06, (0.1, y - 0.01, top + 0.0), '#6DB46A', rough=0.7),
            ball(0.052, (0.18, y + 0.02, top + 0.005), '#5DA35B', rough=0.7),
            ball(0.055, (0.0, y - 0.03, top - 0.005), '#E5484D', rough=0.45)]
    objs.append(disc(0.052, 0.01, (0, y - d / 2 - 0.006, zc - 0.03), color, rough=0.6))
    return objs


def prop_school(star, color, zc=-0.6):
    y0 = front_y(star, 0, zc)
    y = y0 - 0.2
    objs = []
    base = zc - 0.16
    for i, (c, yaw, dx) in enumerate([('#E86A6A', 6, 0.0), ('#4FB3A9', -8, 0.03), ('#7BC47F', 5, -0.02)]):
        z = base + i * 0.13
        objs.append(core(rbox(0.6 - i * 0.04, 0.3, 0.12, (dx, y, z), c, bevel=0.02, rot=(0, 0, math.radians(yaw)), rough=0.65)))
        objs.append(rbox(0.57 - i * 0.04, 0.28, 0.09, (dx + 0.02, y - 0.012, z), '#FBF6EA', bevel=0.012,
                         rot=(0, 0, math.radians(yaw)), rough=0.8))
    # pencil lying across the top book, pointing right (+X)
    ptop = base + 2 * 0.13 + 0.09
    py = y - 0.07
    along_x = (0, math.radians(90), 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.03, depth=0.32, location=(-0.05, py, ptop), rotation=along_x)
    objs.append(_finish(bpy.context.active_object, '#F2C14E', bevel=0.006, segments=2, smooth_angle=40))
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.03, radius2=0.004, depth=0.07,
                                    location=(0.145, py, ptop), rotation=along_x)
    objs.append(_finish(bpy.context.active_object, '#EBC99A', smooth_angle=40))
    objs.append(disc(0.031, 0.045, (-0.232, py, ptop), '#F29CB4', rot=along_x, bevel=0.01))
    objs.append(ball(0.048, (0.17, y - 0.02, base + 0.308), '#E5484D', rough=0.45))
    return objs


def prop_football(star, color, zc=-0.55):
    y0 = front_y(star, 0, zc)
    r = 0.22
    return [football(r, (0, y0 - r - 0.02, zc))]


HERO_PROPS = {'mail': prop_mail, 'phone': prop_phone, 'laptop': prop_laptop, 'wallet': prop_wallet}
# orbiting helpers on the landing page: (body colour, prop, builder, max height)
HELPERS = [('lingon', 'schedule', prop_schedule, 0.86), ('blueberry', 'school', prop_school, 0.9),
           ('moss', 'football', prop_football, 1.04), ('rose', 'bag', prop_bag, 0.96)]


def remove(objs):
    for o in objs:
        bpy.data.objects.remove(o)


FACE_BOTTOM = -0.29   # lowest z the SVG face (mouth + blush) reaches
# Helpers render in a taller frame so big items fit under the face; the SVG
# places that sprite at x/y -10.9/0, 141.8 wide in the 120 viewBox.
HELPER_ORTHO, HELPER_CZ = 2.6, -0.2


def _bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))


def core(o):
    """Mark the part of a prop the arms grip (bag box, book stack…); extras
    such as groceries or an apple ride on top, between the arm tips."""
    o['core'] = True
    return o


def fit(star, objs, max_h=0.66, grip=0.47, top_pad=0.05):
    """Scale and move a prop so the star's own point tips (±HOLD_X, HOLD_Z)
    rest on the upper corners of its core: every item is carried the same
    way, sits in front of the belly, and never rises into the face."""
    bpy.context.view_layer.update()
    lo, hi = _bbox(objs)
    clo, chi = _bbox([o for o in objs if o.get('core')] or objs)
    s = min(grip / ((chi.x - clo.x) / 2), max_h / (hi.z - lo.z))
    extra = (hi.z - chi.z) * s                    # what rises above the core
    top = min(HOLD_Z + top_pad, FACE_BOTTOM - extra)
    anchor = Vector(((clo.x + chi.x) / 2, lo.y, chi.z))
    zc = top - (chi.z - (lo.z + hi.z) / 2) * s
    depth = (hi.y - lo.y) * s
    front = min(HOLD_Y + 0.05, front_y(star, 0.0, zc) - depth - 0.01)
    target = Vector((0.0, front, top))
    for o in objs:
        o.location = target + (o.location - anchor) * s
        o.scale = o.scale * s


def laptop_scene():
    """Open laptop in front of the hold pose: keyboard under the arm tips,
    lid hinged on the far side (screen facing the star)."""
    top = HOLD_Z - 0.09                     # keyboard deck just under the point tips
    near, far = HOLD_Y + 0.08, HOLD_Y - 0.46
    deck_y = (near + far) / 2
    tilt = math.radians(28)
    lid_c = Vector((0, far - math.sin(tilt) * 0.17, top + math.cos(tilt) * 0.17))
    back = Vector((0, -math.cos(tilt), math.sin(tilt)))   # lid outward normal (away from star)
    alu = dict(rough=0.38, sheen=0.1, metal=0.25)
    return [
        rbox(1.08, near - far, 0.04, (0, deck_y, top - 0.02), '#CDD3DB', bevel=0.02, **alu),
        rbox(0.86, 0.3, 0.008, (0, deck_y - 0.03, top + 0.001), '#9AA3B1', bevel=0.004, rough=0.6),
        rbox(1.08, 0.03, 0.34, tuple(lid_c), '#D6DBE2', bevel=0.022, rot=(tilt, 0, 0), **alu),
        rbox(1.0, 0.006, 0.28, tuple(lid_c - back * 0.017), '#1E2A3A', bevel=0.01, rot=(tilt, 0, 0), emit=0.3),
        disc(0.05, 0.01, tuple(lid_c + back * 0.018), PALETTE['lingon'], rot=(math.radians(90) + tilt, 0, 0), emit=0.1),
    ]


def surface(star, deg):
    """Point and outward normal of the star's silhouette in the XZ plane,
    ray-cast inward from direction `deg` (0 = +x, 90 = top point)."""
    a = math.radians(deg)
    d = Vector((math.cos(a), 0.0, math.sin(a)))
    hit, loc, n, _i = star.ray_cast(d * 3.0, -d)
    return (loc, n.normalized()) if hit else (d * 0.6, d)


def headphones(star):
    """Over-ear headphones: cups tucked into the shoulders between the top
    point and the side arms, band hugging the top point's contour."""
    shell, cushion, cap = '#F3F4F7', '#2A2D35', '#FF7A6B'
    soft = dict(rough=0.5, sheen=0.2)
    objs = []
    for side in (-1, 1):
        loc, n = surface(star, 90 - side * 47)
        rot = n.to_track_quat('Z', 'Y').to_euler()
        objs.append(ball(0.15, tuple(loc + n * 0.02), cushion, scale=(1, 1, 0.42), rot=rot, rough=0.85, sheen=0.4))
        objs.append(ball(0.165, tuple(loc + n * 0.075), shell, scale=(1, 1, 0.5), rot=rot, **soft))
        objs.append(ball(0.085, tuple(loc + n * 0.135), cap, scale=(1, 1, 0.35), rot=rot, **soft))
    # band: follow the silhouette just above the surface, cup to cup
    pts = []
    for deg in range(43, 138, 4):
        loc, n = surface(star, deg)
        pts.append(loc + n * 0.05 + Vector((0, 0.04, 0)))
    cu = bpy.data.curves.new('Band', 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.034
    cu.bevel_resolution = 4
    cu.use_fill_caps = True
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for p, co in zip(sp.points, pts):
        p.co = (co.x, co.y, co.z, 1.0)
    sp.order_u = 4
    sp.use_endpoint_u = True
    sp.resolution_u = 12
    band = bpy.data.objects.new('Band', cu)
    bpy.context.collection.objects.link(band)
    bpy.context.view_layer.objects.active = band
    for o in bpy.context.scene.objects:
        o.select_set(o is band)
    bpy.ops.object.convert(target='MESH')
    band = bpy.context.active_object
    objs.append(_finish(band, shell, **soft))
    return objs


FACE_VB = {'eyeL': (49.6, 63.5), 'eyeR': (70.4, 63.5), 'mouth': (60, 69.5)}


def project_face(sc, cam, star, res):
    """Where the SVG face lands on a rotated/tilted render: project the face
    anchor points from the star's front surface into pixel space."""
    from bpy_extras.object_utils import world_to_camera_view
    bpy.context.view_layer.update()
    unit = ORTHO / 512
    out = {}
    for k, (u, v) in FACE_VB.items():
        x, z = (u / 120 * 512 - 256) * unit, -(v / 120 * 512 - 256) * unit
        co = star.matrix_world @ Vector((x, front_y(star, x, z), z))
        p = world_to_camera_view(sc, cam, co)
        out[k] = (round(p.x * res, 1), round((1 - p.y) * res, 1))
    print('FACE', res, out)
    return out


def render_held(sc, star, star_mat):
    """Hero props (prop-*) and helper composites (star-<colour>-<prop>)."""

    star.is_shadow_catcher = True
    sc.render.resolution_x = sc.render.resolution_y = 384
    for name, build in HERO_PROPS.items():
        objs = build(star)
        fit(star, objs)
        render(sc, os.path.join(OUT, f'prop-{name}.webp'))
        remove(objs)
    star.is_shadow_catcher = False

    cam = sc.camera
    cam.data.ortho_scale = HELPER_ORTHO
    cam.location.z = HELPER_CZ
    sc.render.resolution_x = sc.render.resolution_y = 300
    for color, name, build, max_h in HELPERS:
        set_color(star_mat, PALETTE[color])
        objs = build(star, PALETTE[color])
        fit(star, objs, max_h=max_h, grip=0.5, top_pad=1.0 if name == 'football' else 0.05)
        render(sc, os.path.join(OUT, f'star-{color}-{name}.webp'))
        remove(objs)
    set_color(star_mat, PALETTE['lingon'])
    cam.data.ortho_scale = ORTHO
    cam.location.z = 0.0


def render_hold(sc, cam, star, star_mat):
    """Everything the star holds, always with its own arms in the one hold pose.
    - star-lingon-hold: hero body; prop-*: hero props with the star as shadow
      catcher (contact shadows, and the arm tips cut the prop where they grip)
    - star-<colour>-<prop>: helpers, star + prop in one sprite
    - star-lingon-laptop: 3/4 typing pose for the landing comparison"""
    set_color(star_mat, PALETTE['lingon'])
    if ONLY not in ('laptop', 'desk'):
        render(sc, os.path.join(OUT, 'star-lingon-hold.webp'))
        render_held(sc, star, star_mat)
    set_color(star_mat, PALETTE['lingon'])

    # typing at a laptop, seen from a raised 3/4 angle; the desk variant
    # (chat header "working" pose) adds headphones, one sprite per colour
    desk = ONLY == 'desk'
    objs = laptop_scene() + (headphones(star) if desk else [])
    rig = bpy.data.objects.new('LaptopRig', None)
    bpy.context.collection.objects.link(rig)
    for o in objs + [star]:
        o.parent = rig
    rig.rotation_euler = (0, 0, math.radians(27))
    elev = math.radians(11)
    cam.location = (0, -10 * math.cos(elev), 10 * math.sin(elev))
    cam.rotation_euler = (math.radians(90) - elev, 0, 0)
    cam.data.ortho_scale = 2.5
    res = 320 if desk else 640
    sc.render.resolution_x = sc.render.resolution_y = res
    project_face(sc, cam, star, res)
    if desk:
        for key in COLORS:
            set_color(star_mat, PALETTE[key])
            render(sc, os.path.join(OUT, f'star-{key}-desk.webp'))
        set_color(star_mat, PALETTE['lingon'])
    else:
        render(sc, os.path.join(OUT, 'star-lingon-laptop.webp'))
    star.parent = None
    remove(objs + [rig])
    cam.location = (0, -10, 0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam.data.ortho_scale = ORTHO
    sc.render.resolution_x = sc.render.resolution_y = SIZE


def render(sc, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)


def main():
    reset()
    sc, cam = setup_scene()
    mat = clay_material()
    star = build_star('idle')        # built first: fixes the frame every pose shares
    star.data.materials.append(mat)
    hold = build_star('hold')
    hold.data.materials.append(mat)

    if PREVIEW and ONLY != 'desk':
        star.hide_render = True
        render(sc, os.path.join(OUT, 'preview-hold.webp'))
        objs = prop_mail(hold)
        fit(hold, objs)
        render(sc, os.path.join(OUT, 'preview-mail.webp'))
        remove(objs)
        cam.data.ortho_scale, cam.location.z = HELPER_ORTHO, HELPER_CZ
        for name, build, max_h in (('school', prop_school, 0.9), ('bag', prop_bag, 0.96)):
            objs = build(hold, PALETTE['lingon'])
            fit(hold, objs, max_h=max_h, grip=0.5)
            render(sc, os.path.join(OUT, f'preview-{name}.webp'))
            remove(objs)
        return

    if ONLY not in ('props', 'laptop', 'desk'):
        # front sprites, one per palette colour (no hands: the plain mascot)
        hold.hide_render = True
        for key, hexstr in PALETTE.items():
            set_color(mat, hexstr)
            render(sc, os.path.join(OUT, f'star-{key}.webp'))
        hold.hide_render = False

    star.hide_render = True
    render_hold(sc, cam, hold, mat)
    star.hide_render = False
    if ONLY in ('props', 'laptop', 'desk'):
        return

    # source files: .blend for editing, decimated .glb for real-time 3D use
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'mascot.blend'), compress=True)
    for o in bpy.context.scene.objects:
        o.select_set(o is star)
    bpy.context.view_layer.objects.active = star
    dec = star.modifiers.new('Decimate', 'DECIMATE')
    dec.ratio = 0.12
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(HERE, 'mascot.glb'),
        use_selection=True,
        export_apply=True,
        export_draco_mesh_compression_enable=False,
    )
    star.modifiers.remove(dec)


main()
