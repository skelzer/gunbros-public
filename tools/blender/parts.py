"""
Reusable mobile parts. A part builds its objects, adds them to a render layer list and
returns a small dict that its pose helper drives. Sizes are sprite pixels at 1x.

So far: caterpillar tracks (tank, sapper) and two-bone legs (walker, shrike).
"""
import math

import bmesh
import bpy

import render_common as rc
from render_common import px


# --------------------------------------------------------------------------
# Tracks
# --------------------------------------------------------------------------

def stadium_points(a, r, segments=10):
    """Outline of a stadium in the XZ plane, resting on z = 0."""
    pts = []
    for i in range(segments + 1):
        t = math.pi / 2 - math.pi * i / segments
        pts.append((a + r * math.cos(t), r + r * math.sin(t)))
    for i in range(segments + 1):
        t = -math.pi / 2 - math.pi * i / segments
        pts.append((-a + r * math.cos(t), r + r * math.sin(t)))
    return pts


def add_stadium(name, a, r, y0, y1, material):
    pts = stadium_points(a, r)
    n = len(pts)
    verts = [(px(x), px(y0), px(z)) for x, z in pts] + [(px(x), px(y1), px(z)) for x, z in pts]
    faces = [list(range(n)), list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=True)


def tread_path(s, a, r):
    """Point, outward normal and tangent angle at arc length `s` (pixels) round the tread."""
    top = 2 * a
    arc = math.pi * r
    s %= 2 * top + 2 * arc
    if s < top:                                   # top run, moving forwards
        return (-a + s, 2 * r), (0, 1), 0.0
    s -= top
    if s < arc:                                   # front arc, over and down
        t = math.pi / 2 - s / r
        return (a + r * math.cos(t), r + r * math.sin(t)), (math.cos(t), math.sin(t)), t - math.pi / 2
    s -= arc
    if s < top:                                   # bottom run, moving backwards
        return (a - s, 0), (0, -1), math.pi
    s -= top
    t = -math.pi / 2 - s / r                      # rear arc, up and over
    return (-a + r * math.cos(t), r + r * math.sin(t)), (math.cos(t), math.sin(t)), t - math.pi / 2


def build_tracks(mats, root, body, a, r, half_width, width=5, cleats=14, wheels=4, hub='paint'):
    """
    Two belts (the near one with a recessed pocket, road wheels and rolling cleats).
    `a` is the x of the end arc centres, `r` their radius; the near belt's outer face is
    at y = -half_width. Object names start with tread, cleat, wheel, hub, hole: give
    those prefixes part groups. Needs the `rubber` and `steel` ramps plus `hub`.
    """
    near = add_stadium('tread_near', a, r, -half_width, -half_width + width, mats['rubber'])
    pocket = add_stadium('tread_pocket', a, r - 2.2, -half_width - 1, -half_width + 1.6, mats['rubber'])
    pocket.location.z = px(2.2)
    rc.boolean_cut(near, pocket)
    far = add_stadium('tread_far', a, r, half_width - width, half_width, mats['rubber'])
    for o in (near, far):
        rc.parent_keep(o, root)
        body.append(o)

    cleat_objs = []
    for i in range(cleats):
        c = rc.add_box(f'cleat_{i:02d}', (px(3.2), px(width + 0.6), px(1.6)), (0, 0, 0), mats['rubber'])
        rc.parent_keep(c, root)
        cleat_objs.append(c)
        body.append(c)

    wheel_objs = []
    wheel_r = r - 2.4
    for i in range(wheels):
        x = -a + 2 * a * i / (wheels - 1)
        centre = (px(x), px(-half_width + 0.9), px(r))
        w = rc.add_cylinder(f'wheel_{i}', px(wheel_r), px(2.4), centre, mats['steel'])
        cap = rc.add_sphere(f'hub_{i}', px(1.6), (centre[0], centre[1] - px(1.0), centre[2]),
                            mats[hub], scale=(1, 0.6, 1), segments=12, rings=6)
        rc.parent_keep(cap, w)
        body.extend((w, cap))
        for k in range(2):
            ang = k * math.pi
            hole = rc.add_cylinder(
                f'hole_{i}_{k}', px(1.0), px(0.8),
                (centre[0] + px(wheel_r * 0.66) * math.cos(ang), centre[1] - px(1.0),
                 centre[2] + px(wheel_r * 0.66) * math.sin(ang)),
                mats['rubber'], vertices=8, smooth=False)
            rc.parent_keep(hole, w)
            body.append(hole)
        rc.parent_keep(w, root)
        wheel_objs.append(w)

    return {'a': a, 'r': r, 'y': -half_width + width / 2, 'cleats': cleat_objs, 'wheels': wheel_objs}


def pose_tracks(tracks, phase):
    """`phase` 0..1 rolls the belt forward by one cleat spacing and the wheels half a turn,
    so any whole number of frames across 0..1 loops cleanly."""
    a, r = tracks['a'], tracks['r']
    length = 4 * a + 2 * math.pi * r
    spacing = length / len(tracks['cleats'])
    for i, c in enumerate(tracks['cleats']):
        (x, z), (nx, nz), ang = tread_path(i * spacing + spacing * phase, a, r)
        c.location = (px(x + nx * 0.3), px(tracks['y']), px(z + nz * 0.3))
        c.rotation_euler = (0, -ang, 0)
    for w in tracks['wheels']:
        w.rotation_euler = (0, math.radians(180.0 * phase), 0)


# --------------------------------------------------------------------------
# Two-bone legs
# --------------------------------------------------------------------------

def two_bone_ik(hip, ankle, upper, lower, knee='front'):
    """
    Knee position for a two-bone leg in the XZ plane. `hip` and `ankle` are (x, z) in
    pixels. `knee` picks which way it bends: 'front' like a person or the walker,
    'back' like a bird or a chicken walker.
    """
    dx, dz = ankle[0] - hip[0], ankle[1] - hip[1]
    d = max(1.0, min(math.hypot(dx, dz), upper + lower - 0.05))
    base = math.atan2(dz, dx)
    bend = math.acos(max(-1.0, min(1.0, (upper ** 2 + d ** 2 - lower ** 2) / (2 * upper * d))))
    options = [(hip[0] + upper * math.cos(base + s * bend), hip[1] + upper * math.sin(base + s * bend)) for s in (1, -1)]
    return (max if knee == 'front' else min)(options, key=lambda k: k[0])


def aim(obj, start, end, y):
    """Lay a limb whose mesh runs along +X from its origin from `start` to `end` (x, z)."""
    obj.location = (px(start[0]), px(y), px(start[1]))
    obj.rotation_euler = (0, -math.atan2(end[1] - start[1], end[0] - start[0]), 0)


def plant_z(y, ref_y):
    """Foot z (px) that lands a foot at depth `y` on the same canvas row as a foot at z 0
    and depth `ref_y`. The camera is tilted, so a foot further back at z 0 draws higher up
    and seems to float; this sinks it by just enough. Add it to every z of that foot."""
    return -(y - ref_y) * math.tan(math.radians(rc.CAMERA_TILT_DEG))


def walk_foot(phase, stride, lift):
    """Foot (x, z) through one step, in whole pixels: planted and sliding back, then
    lifted forwards. Offset the other leg by half a phase."""
    phase %= 1.0
    if phase < 0.5:
        return round(stride - 4 * stride * phase), 0
    u = (phase - 0.5) / 0.5
    return round(-stride + 2 * stride * u), round(lift * math.sin(math.pi * u))
