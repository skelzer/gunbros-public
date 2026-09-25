"""
Hooded sorcerer (roster id `mage`): model, poses, layered renders.

    blender --background --python build_mobile_sorcerer.py -- --out work/sorcerer --scale 4

An old wizard in a deep violet hood. The robe is a lofted bell (custom rings, not a
cone) that flares into a pleated, scalloped skirt with a gold hem and a train at the
back, cinched by a gold belt; a scalloped shoulder cape sits under the hood. The hood is
a sphere with its face scooped out by a boolean towards the camera, a dark void inside
with two glowing eyes, a rolled rim round the opening, a long bone-white beard spilling
out of it and a floppy point that curls back and droops to a gold tassel. Gold stars
are stitched on the skirt, and a bell sleeve reaches forward to a gnarled staff whose split top cradles the crystal. The crystal is the gun,
so it alone is the `barrel` layer and turns to the aim.

The skirt stays on the ground while everything above the belt bobs, so breathing and
walking never push the hem through the floor.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import creature as cr  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

BARREL_LENGTH = 8
PIVOT = (15, 41)
NEAR_Y = -11
CANVAS = (88, 78)
ANCHOR = (46, 70)
WAIST_Z = 13

STATES = {
    'idle': (6, 10, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 6, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}

# Back to front, so part lines land on the part behind. Glow groups are matched by
# number across layers: the crystal's flash shares 21 with the body's fire.
PART_GROUPS = (
    ('sleevefar', 2), ('tip', 3), ('tassel', 4), ('robe', 5), ('hem', 6), ('star', 7),
    ('belt', 8), ('buckle', 9), ('mantle', 10), ('void', 11), ('eye', 12), ('hood', 13), ('rim', 14),
    ('beard', 15), ('staff', 17), ('prong', 18), ('ferrule', 19), ('sleeve', 20),
    ('cuff', 22), ('hand', 23), ('mote', 24), ('smoke', 25), ('boom', 26), ('fire', 21),
    ('crystal', 24), ('flash', 21),
)
HUES = ('violet', 'amber', 'orange', 'bone')


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def P(x, y, z):
    return Vector((px(x), px(y), px(z)))


def tube(name, pts, radii, material, squash=1.0, resolution=6):
    """A smooth bezier tube through `pts` whose thickness follows `radii` (copied from
    the wyvern). `squash` flattens it across y."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(1)
    cu.bevel_resolution = 4
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p, r in zip(sp.bezier_points, pts, radii):
        bp.co = P(*p)
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
        bp.radius = r
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = name
    if squash != 1.0:
        c = sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
        for v in obj.data.vertices:
            v.co.y = c.y + (v.co.y - c.y) * squash
    return rc.finish(obj, material, smooth=True)


def profile(table, z):
    """Linear interpolation of (z, rx, ry, cx) rows."""
    for a, b in zip(table, table[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0]) if b[0] > a[0] else 0
            return tuple(a[k] + (b[k] - a[k]) * t for k in (1, 2, 3))
    row = table[0] if z < table[0][0] else table[-1]
    return row[1], row[2], row[3]


def loft(name, rings, material, segs=40, grow=0.0):
    """
    A closed body lofted through horizontal rings. Each ring is a dict with z, rx, ry,
    cx and optional wave (the ring's z dips and rises `wave` px, `n` times round, for a
    scalloped hem), pleat (radius ripple for folds, `folds` times round) and trail (the
    back half stretched in x, for a train).
    """
    bm = bmesh.new()
    grid = []
    for ring in rings:
        row = []
        for s in range(segs):
            a = 2 * math.pi * s / segs
            ca, sa = math.cos(a), math.sin(a)
            k = 1 + ring.get('pleat', 0) * math.cos(ring.get('folds', 7) * a)
            rx, ry = (ring['rx'] + grow) * k, (ring['ry'] + grow) * k
            x = ring['cx'] + rx * ca * (ring.get('trail', 1) if ca < 0 else 1)
            z = ring['z'] + ring.get('wave', 0) * (0.5 - 0.5 * math.cos(ring.get('n', 5) * a))
            row.append(bm.verts.new((px(x), px(ry * sa), px(z))))
        grid.append(row)
    for r in range(len(grid) - 1):
        for s in range(segs):
            bm.faces.new((grid[r][s], grid[r][(s + 1) % segs], grid[r + 1][(s + 1) % segs], grid[r + 1][s]))
    for row, ring in ((grid[0], rings[0]), (grid[-1], rings[-1])):
        c = bm.verts.new((px(ring['cx']), 0, px(ring['z'])))
        for s in range(segs):
            bm.faces.new((row[s], row[(s + 1) % segs], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=True)


def ring_row(table, z, **extra):
    rx, ry, cx = profile(table, z)
    return dict(z=z, rx=rx, ry=ry, cx=cx, **extra)


def torus(name, centre, normal, major, minor, material):
    bpy.ops.mesh.primitive_torus_add(major_radius=px(major), minor_radius=px(minor), major_segments=24, minor_segments=8,
                                     location=P(*centre))
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = Vector((0, 0, 1)).rotation_difference(Vector(normal).normalized()).to_euler()
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return rc.finish(obj, material, smooth=True)


# Robe silhouette: (z, rx, ry, cx). A wide skirt pulled in at the belt, sloping shoulders.
ROBE = [(0, 13.5, 11.0, -1.5), (4, 12.4, 10.2, -1.0), (9, 10.4, 9.0, -0.5), (13, 8.6, 7.8, 0.0),
        (18, 8.8, 7.8, 0.3), (22, 8.0, 7.2, 0.5), (25, 5.6, 5.2, 0.5), (26.5, 0.8, 0.8, 0.5)]

HOOD_C = (1, 0, 31)
HOOD_R = 11
FACE = Vector((0.6, -0.8, -0.08)).normalized()     # the hood opening looks at the camera, three quarters


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build(mats, proj):
    body, barrel = [], []
    rig = {}
    V, A, O, B = mats['violet'], mats['amber'], mats['orange'], mats['bone']
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', P(0, 0, WAIST_Z))
    rc.parent_keep(chassis, root)

    def on(parent, *objs):
        for o in objs:
            rc.parent_keep(o, parent)
            body.append(o)
        return objs[0] if len(objs) == 1 else objs

    # --- skirt (stays on the ground) and bodice (bobs with the chassis) ---------------
    skirt_rings = [ring_row(ROBE, 0.4, wave=1.2, n=6, pleat=0.035, folds=7, trail=1.12)]
    skirt_rings += [ring_row(ROBE, z, pleat=0.035 * (1 - z / 14), folds=7, trail=1 + 0.12 * (1 - z / 8) if z < 8 else 1)
                    for z in (2, 4, 6, 8, 10, 12, 14)]
    skirt = on(root, loft('robe_skirt', skirt_rings, V))
    hem = loft('hem', [ring_row(ROBE, 0.0, wave=1.2, n=6, pleat=0.035, folds=7, trail=1.12),
                       ring_row(ROBE, 2.4, wave=1.2, n=6, pleat=0.03, folds=7, trail=1.1)], A, grow=0.45)
    rc.set_origin(hem, P(0, 0, 0))
    on(root, hem)
    bodice = on(chassis, loft('robe_bodice', [ring_row(ROBE, z) for z in (12, 15, 18, 21, 23, 25, 26.5)], V))
    belt = on(chassis, loft('belt', [ring_row(ROBE, z) for z in (11.9, 13.2, 14.5)], A, grow=0.55))
    a = math.radians(-58)
    bx, by = 0.0 + 9.3 * math.cos(a), 8.4 * math.sin(a)
    buckle = rc.add_box('buckle', (px(2.8), px(1.4), px(3.4)), P(bx, by - 0.3, 13.2), A, bevel=px(0.5))
    buckle.rotation_euler.z = a + math.pi / 2
    on(chassis, buckle)

    # Stars stitched on the near side of the skirt: small unlit diamonds.
    for k, (sx, sz, r) in enumerate(((-4.5, 4.5, 1.7), (3.5, 7.5, 1.5), (-1, 10.8, 1.2))):
        rx, ry, cx = profile(ROBE, sz)
        u = max(-0.95, min(0.95, (sx - cx) / rx))
        sy = -ry * math.sqrt(1 - u * u) - 0.35
        star = rc.add_cylinder(f'star_{k}', px(r), px(0.5), P(sx, sy, sz), mats['lamp'], axis='Y', vertices=4, smooth=False)
        star.rotation_euler.z = -math.asin(u) * 0.8
        on(skirt, star)

    # --- shoulder cape, scalloped at the bottom -----------------------------------------
    mantle = on(chassis, loft('mantle', [dict(z=17.0, rx=11.6, ry=10.2, cx=0.2, wave=1.6, n=5),
                                         dict(z=18.8, rx=11.4, ry=10.0, cx=0.3, wave=1.2, n=5),
                                         dict(z=22.0, rx=10.0, ry=9.0, cx=0.5),
                                         dict(z=25.5, rx=7.5, ry=7.0, cx=0.8),
                                         dict(z=28.0, rx=3.0, ry=3.0, cx=1.0)], V))

    # --- hood: a sphere with the face scooped out, a void, eyes, a rim and a beard ---
    head = rc.add_empty('head_grp', P(*HOOD_C))
    rc.parent_keep(head, chassis)
    c = Vector(HOOD_C)
    hood = rc.add_sphere('hood', px(HOOD_R), P(*HOOD_C), V, scale=(1.06, 1, 1), segments=32, rings=16)
    d, r_cut = 12.0, 8.0
    cutter = rc.add_sphere('cut_face', px(r_cut), P(*(c + FACE * d)), V, segments=24, rings=12)
    mod = hood.modifiers.new('Face', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    cutter.hide_render = cutter.hide_viewport = True
    rc.parent_keep(cutter, hood)
    void = rc.add_sphere('void', px(HOOD_R - 1.2), P(*HOOD_C), mats['ink'], segments=24, rings=12)
    a_ = (d * d + HOOD_R * HOOD_R - r_cut * r_cut) / (2 * d)
    rho = math.sqrt(HOOD_R * HOOD_R - a_ * a_)
    rim = torus('rim', tuple(c + FACE * (a_ - 0.2)), FACE, rho, 1.25, V)
    eyes = []
    base = math.atan2(FACE.y, FACE.x)
    for k, off in enumerate((10, -28)):
        ang = base + math.radians(off)
        er = HOOD_R - 1.6
        e = rc.add_cylinder(f'eye_{k}', px(1.75), px(0.6), P(c.x + er * math.cos(ang), er * math.sin(ang) - 0.5, 32.4),
                            mats['cyan'], vertices=12, smooth=False)
        eyes.append(e)
    beard = tube('beard', [(5.2, -7.6, 28.2), (7.2, -10.0, 24.2), (8.0, -12.6, 19.5), (7.4, -13.6, 15), (8.8, -13.4, 11.0)],
                 (3.6, 3.5, 2.9, 1.8, 0.2), B, squash=0.7)
    moustache = tube('beard_tache', [(3.6, -9.4, 28.6), (6.8, -9.8, 28.6), (9.6, -8.6, 27.0)], (0.9, 1.3, 0.3), B)
    # The floppy point: rooted at the back of the crown, curling back and down to a tassel.
    tip = tube('tip', [(-2, 0, 38), (-9, -0.3, 42.5), (-16, -0.6, 41.5), (-20.5, -0.8, 36), (-21, -0.8, 32.5)],
               (6.8, 4.6, 2.9, 1.6, 0.9), V, squash=0.85)
    rc.set_origin(tip, P(-4, 0, 39))
    tassel = rc.add_sphere('tassel', px(2.0), P(-21, -0.8, 31), A, segments=12, rings=6)
    rc.parent_keep(tassel, tip)
    body.append(tassel)
    for o in (hood, void, rim, beard, moustache, tip) + tuple(eyes):
        on(head, o)

    # --- arms: a bell sleeve to the staff (and the far one peeking behind it) ----------
    sleeve = tube('sleeve', [(2.5, -7.5, 23), (8.5, -10, 19.5), (12.8, -10.4, 18.6)], (2.6, 3.2, 4.1), V)
    cuff = torus('cuff', (12.9, -10.4, 18.6), (1, 0, 0.1), 3.7, 0.8, A)
    hand = rc.add_sphere('hand', px(2.1), P(15, -10.2, 19), B, segments=12, rings=8)
    far = tube('sleevefar', [(3, 6, 23), (9, 2, 25), (13.2, -4, 26)], (2.4, 2.8, 3.4), V)
    farhand = rc.add_sphere('handfar', px(1.9), P(15, -6.4, 26.2), B, segments=12, rings=8)
    on(chassis, sleeve, cuff, hand, far, farhand)
    rig['farhand'] = farhand

    # --- the staff: gnarled wood, a gold ferrule and a split top that holds the crystal --
    dx, up = PIVOT
    pz = proj.z_for_height(up) * rc.PX_PER_UNIT
    top = pz - 3.5
    staff = tube('staff', [(15, -8, 0.3), (14.5, -8, 9), (15.5, -8, 20), (14.8, -8, 29), (15, -8, top)],
                 (1.25, 1.2, 1.3, 1.2, 1.35), O)
    knots = [rc.add_sphere(f'staff_knot_{k}', px(1.7), P(x, -8.2, z), O, scale=(1, 1, 1.3), segments=10, rings=6)
             for k, (x, z) in enumerate(((14.6, 9.5), (15.3, 23)))]
    ferrule = rc.add_cylinder('ferrule', px(1.9), px(2.2), P(15, -8, top - 1.2), A, axis='Z', vertices=10)
    prongs = [tube(f'prong_{k}', [(15, -8, top - 0.5), (15 + s * 3.2, -8, top + 1.2), (15 + s * 4.6, -8, top + 4.2), (15 + s * 3.6, -8, top + 6.4)],
                   (1.2, 1.0, 0.7, 0.25), O) for k, s in enumerate((-1, 1))]
    rc.set_origin(staff, P(15, -8, 0))
    on(chassis, staff)
    on(staff, ferrule, *knots, *prongs)

    # --- motes that circle the crystal ----------------------------------------------------
    motes = [on(chassis, rc.add_sphere(f'mote_{k}', px(1.3), P(dx, -10, pz), mats['cyan'], segments=8, rings=5)) for k in range(2)]

    # --- the crystal: barrel layer ----------------------------------------------------------
    pivot_w = P(dx, 0, pz)
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    front = cr.cone('crystal_front', 4.3, 0, BARREL_LENGTH, (dx + BARREL_LENGTH / 2, -8, pz), mats['glass'], axis='X', vertices=6, flat=True)
    back = cr.cone('crystal_back', 4.3, 0, 4.6, (dx - 2.3, -8, pz), mats['glass'], axis='X', vertices=6, flat=True)
    back.rotation_euler = (0, 0, math.pi)
    for o in (front, back):
        rc.parent_keep(o, pivot)
        barrel.append(o)
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + P(BARREL_LENGTH + 4.5, -8, 0), 6.5, pivot, tall=1)
    barrel.extend(rig['flash'])

    rig['fx'] = cr.death_fx(mats, root, body, (1, 22), 16, y=-16, fires=(5.6, 4.2))
    rig.update(chassis=chassis, head=head, tip=tip, eyes=eyes, hem=hem, skirt=skirt, motes=motes,
               staff=staff, mantle=mantle, bodice=bodice, pivot=pivot, pz=pz)
    rig['layers'] = {'body': body, 'barrel': barrel}
    rig['rest'] = cr.snapshot([chassis, head, tip, hem, skirt, staff, mantle, bodice] + motes)
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    chassis, head, tip, hem, eyes = rig['chassis'], rig['head'], rig['tip'], rig['hem'], rig['eyes']
    cr.restore(rig['rest'])
    for e in eyes:
        e.scale = (1, 1, 1)
        e.data.materials[0] = mats['cyan']
    rc.hide(rig['layers']['barrel'], False)
    rc.pose_fire(rig['flash'], 0)
    cr.reset_fx(rig['fx'])
    rc.set_burnt(mats, palette, False, hues=HUES)

    dx = dz = 0

    def lids(k):
        for e in eyes:
            e.scale = (1, 1, k)

    def flop(deg):
        tip.rotation_euler.y = math.radians(deg)          # positive lifts the point

    orbit = {'idle': i / 6, 'move': i / 6, 'charge': i / 2 + 0.25, 'fire': i / 5}.get(state)
    rc.hide(rig['motes'], orbit is None)
    if orbit is not None:
        radius = 5 if state == 'charge' else 9              # drawn in as it charges
        for k, m in enumerate(rig['motes']):
            a = 2 * math.pi * (orbit + k * 0.5)
            m.location.x = px(PIVOT[0] + round(radius * math.cos(a)))
            m.location.z = px(round(rig['pz'] + radius * 0.6 * math.sin(a)))

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        flop((0, -6, -12, -14, -8, 0)[i])
        if i == 4:
            lids(0.15)

    elif state == 'move':
        # A glide with a waddle: the skirt rocks from side to side under a bobbing
        # body and the gold hem trails it by a frame.
        rig['skirt'].location.x += px((0, 1, 1, 0, -1, -1)[i])
        dz = (-1, 0, 0)[i % 3]
        head.location.z += px((0, -1, 0)[i % 3])
        hem.location.x += px((0, -1, -1, 0, 1, 1)[i])
        flop((6, 12, 6, -4, -10, -4)[i])

    elif state == 'charge':
        dz = (-1, -2)[i]
        dx = -1
        head.location.x += px((0, -1)[i])
        lids(0.8)                                           # a squint; any narrower and the outline eats them
        flop((18, 26)[i])
        hem.location.x += px((-1, -2)[i])

    elif state == 'fire':
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        lids((0.4, 0.4, 0.7, 1, 1)[i])
        flop((30, 22, 10, 0, -4)[i])
        hem.location.x += px((2, 1, 1, 0, 0)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        lids((0.25, 0.25, 0.7)[i])
        flop((28, -10, 0)[i])
        hem.location.x += px((2, -1, 0)[i])

    elif state == 'death':
        # Flash, fireball, the crystal is gone; nothing is inside the robe, so it slumps
        # into an empty heap, the hood drops on to it and the staff topples backwards.
        cr.pose_death_fx(rig['fx'], i, fire_at=((2, 16), (-7, 11)), smoke_at=(0, 26))
        if i == 0:
            dz = 1
        if i >= 2:
            t = i - 2
            rc.set_burnt(mats, palette, True, hues=HUES)
            for e in eyes:
                e.data.materials[0] = mats['ink']
            rc.hide(rig['layers']['barrel'], True)
            rc.hide(rig['motes'], True)
            dz = (-3, -7, -10, -11, -11)[t]
            rig['skirt'].scale = (1 + 0.06 * t, 1, (0.85, 0.65, 0.5, 0.45, 0.45)[t])
            hem.scale = (1 + 0.06 * t, 1, 1)
            rig['bodice'].scale = (1, 1, (0.9, 0.75, 0.6, 0.55, 0.55)[t])
            rig['mantle'].scale = (1.05, 1, (0.9, 0.7, 0.6, 0.55, 0.55)[t])
            head.location.z += px((0, -1, -3, -4, -4)[t])
            head.location.x += px((1, 2, 3, 3, 3)[t])
            head.rotation_euler.y = math.radians((8, 18, 26, 30, 30)[t])
            flop((-10, -22, -30, -34, -34)[t])
            rig['staff'].rotation_euler.y = math.radians((-6, -20, -45, -70, -70)[t])
            rig['staff'].location.z -= px(dz)                # the staff stands on the ground

    chassis.location.x += px(dx)
    chassis.location.z += px(dz)


if __name__ == '__main__':
    rc.run_mobile(
        name='sorcerer', canvas=CANVAS, anchor=ANCHOR, near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('violet', 'amber', 'orange', 'bone', 'glass', 'smoke', 'cyan', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
