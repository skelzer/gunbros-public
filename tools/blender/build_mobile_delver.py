"""
Burrowing drill creature (roster id `nak`): model, poses, layered renders.

    blender --background --python build_mobile_delver.py -- --out work/delver --scale 4

A rust-orange armadillo miner. Its back is a domed carapace cut into overlapping bands
(every other band stands proud, so the id pass lines each one and the top of the
silhouette steps), over a dark belly, with a banded tapering tail. Big mole-like
digging arms end in steel spade claws; stubby hind legs push. The head wears a dark
goggle band with two pale eyes and an amber hard hat with a brim and a headlamp.

The drill socketed in its jaw is the `barrel` layer: an amber collar and a steel bit
with four flutes twisted along its length, flat shaded, so the toon ramp paints spiral
bands. Turning the bit by a quarter of a flute between frames makes the bands crawl.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import creature as cr  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (6, 12)
BARREL_LENGTH = 15
NEAR_Y = -12
NEAR_LIMB_Y = -8                # depth of the near arm and hind leg
PAW_DROP, HIND_DROP = 0.9, 0.55  # px that land the near paw and foot on the ground row
HEAD_C = (6, 0, 21.5)
HEAD_R = (8.5, 8.6, 8)
SHELL_C = (-10, 0, 12.5)
SHELL_R = (16.5, 11.5, 13.5)

# Glow groups are matched by number across layers: the barrel's flash shares the
# body's fire number, never a solid part's.
PART_GROUPS = (
    ('leg_far', 1), ('tail', 2), ('belly', 3), ('shell_a', 4), ('shell_b', 5), ('knob', 6),
    ('leg_near', 7), ('claw', 8), ('head', 10), ('goggle', 11), ('eye', 12), ('pupil', 13),
    ('helmet', 14), ('brim', 15), ('lamphouse', 16), ('lens', 17), ('wreck', 18),
    ('smoke', 19), ('boom', 20), ('fire', 21),
    ('collar', 1), ('bit', 2), ('flash', 21),
)
HUES = ('orange', 'amber')


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def tube(name, pts, radii, material, squash=1.0, resolution=6, smooth=True):
    """A bezier tube through `pts` whose thickness follows `radii` (copied from the
    wyvern). `squash` flattens it across y. Converted to a mesh."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(1)
    cu.bevel_resolution = 4
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p, r in zip(sp.bezier_points, pts, radii):
        bp.co = Vector(tuple(px(c) for c in p))
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
    return rc.finish(obj, material, smooth=smooth)


def intersect(obj, name, size, centre, material):
    """Keep only the part of `obj` inside a box (sizes and centre in pixels)."""
    box = rc.add_box(f'cut_{name}', tuple(px(s) for s in size), tuple(px(c) for c in centre), material)
    mod = obj.modifiers.new('Keep', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, obj)
    return obj


def carapace(bands, floor, material):
    """
    The domed back cut into bands across its length. `bands` is (x0, x1, grow) from
    the tail forwards: each band is the dome grown by `grow` pixels and cut to x0..x1
    and to above `floor`, alternating between two part groups so a line runs between
    neighbours. Alternating the growth makes the bands overlap like armour.
    """
    out = []
    cx, _, cz = SHELL_C
    for k, (x0, x1, grow) in enumerate(bands):
        tag = ('shell_a', 'shell_b')[k % 2]
        r = tuple(v + grow for v in SHELL_R)
        s = cr.blob(f'{tag}_{k}', SHELL_C, r, material, 40, 20)
        intersect(s, f'{tag}_{k}', (x1 - x0, 40, 40), ((x0 + x1) / 2, 0, floor + 20), material)
        out.append(s)
    return out


def fluted_bit(name, x0, x1, r0, material, flutes=4, turns=0.6, rings=8, depth=0.55):
    """
    A drill bit along x from x0 to a point at x1: a star-shaped section (`flutes` ridges
    with grooves `depth` of the radius deep) twisted `turns` times along its length and
    flat shaded, so the toon ramp paints spiral bands without any extra parts (a
    separate thread wound round it added part lines everywhere and read as a dark mass).
    """
    import bmesh
    bm = bmesh.new()
    n = flutes * 2
    grid = []
    for k in range(rings):
        t = k / rings
        r = r0 * (1 - t) + 0.25 * t
        row = []
        for j in range(n):
            a = 2 * math.pi * (j / n + turns * t)
            rr = r * (1.0 if j % 2 == 0 else depth)
            row.append(bm.verts.new((px(x0 + (x1 - x0) * t), px(rr * math.sin(a)), px(PIVOT_Z + rr * math.cos(a)))))
        grid.append(row)
    tip = bm.verts.new((px(x1), 0, px(PIVOT_Z)))
    for k in range(rings - 1):
        for j in range(n):
            bm.faces.new((grid[k][j], grid[k][(j + 1) % n], grid[k + 1][(j + 1) % n], grid[k + 1][j]))
    for j in range(n):
        bm.faces.new((grid[-1][j], grid[-1][(j + 1) % n], tip))
    bm.faces.new(list(reversed(grid[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=False)


PIVOT_Z = 0.0     # the pivot's world height in pixels, set in build()


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def foot_z(y, drop):
    """Foot z offset (px): `drop` puts a near foot on the ground row; a far one sinks
    further by what the camera tilt lifts it, so it plants on the same row."""
    return -drop + parts.plant_z(y, NEAR_LIMB_Y)


def build_arm(side, y, mats, root):
    """A mole's digging arm: a thick forearm down from the shoulder to a spade paw
    with three broad steel claws raking forward. Origin at the shoulder. The forearm
    reaches down far enough to plant the paw on the ground row (see `foot_z`)."""
    tag = 'leg_near' if side == 'near' else 'leg_far'
    ctag = 'claw_near' if side == 'near' else 'leg_far_claw'
    fz = foot_z(y, PAW_DROP)
    arm = tube(f'{tag}_arm', [(1, y, 11), (5, y - 0.5, 6.5 + fz / 2), (7.5, y - 0.8, 3.5 + fz)], (3.6, 2.9, 2.5),
               mats['orange'])
    paw = cr.blob(f'{tag}_paw', (9, y - 0.8, 2.6 + fz), (3.2, 2.6, 2.2), mats['orange'], 16, 8)
    claws = []
    for k, (dz, dy) in enumerate(((1.3, -1.2), (0, 0), (-1.1, 1.2))):
        c = cr.cone(f'{ctag}_{k}', 1.25, 0.1, 4.6, (12.6, y - 0.8 + dy, 2.2 + dz + fz), mats['steel'], axis='X',
                    vertices=4, flat=True, tilt_deg=18 + 8 * k)
        c.scale = (1, 1.6, 0.8)
        claws.append(c)
    hinge = rc.add_empty(f'shoulder_{side}', (px(1), px(y), px(11)))
    for o in [arm, paw] + claws:
        rc.parent_keep(o, hinge)
    rc.parent_keep(hinge, root)
    return hinge, [arm, paw] + claws


def build_hind(side, y, mats, root):
    """A stubby hind leg; the shin reaches down far enough to plant the foot flat."""
    tag = 'leg_near' if side == 'near' else 'leg_far'
    ctag = 'claw_near' if side == 'near' else 'leg_far_claw'
    fz = foot_z(y, HIND_DROP)
    thigh = cr.blob(f'{tag}_thigh', (-19, y, 7), (4.6, 3.4, 5), mats['orange'], 16, 8)
    shin = tube(f'{tag}_shin', [(-19, y, 5), (-18, y - 0.4, 2 + fz)], (2.8, 2.4), mats['orange'])
    foot = cr.blob(f'{tag}_foot', (-16.5, y - 0.4, 1.5 + fz), (3.6, 2.4, 1.6), mats['orange'], 16, 8)
    claws = [cr.cone(f'{ctag}_h{k}', 0.9, 0, 2.6, (-12.5, y - 0.4 + dy, 1.0 + fz), mats['steel'], axis='X', vertices=6)
             for k, dy in enumerate((-1, 1))]
    hip = rc.add_empty(f'hip_{side}', (px(-19), px(y), px(8)))
    for o in [thigh, shin, foot] + claws:
        rc.parent_keep(o, hip)
    rc.parent_keep(hip, root)
    return hip, [thigh, shin, foot] + claws


def build(mats, proj):
    global PIVOT_Z
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    hull = rc.add_empty('hull', (0, 0, 0))                  # everything but the legs
    rc.parent_keep(hull, root)

    # --- limbs: far side first so the body covers them ------------------------------
    arms, hinds, far_parts, near_parts = {}, {}, [], []
    for side, y in (('far', 7), ('near', NEAR_LIMB_Y)):
        arms[side], a_parts = build_arm(side, y, mats, root)
        hinds[side], h_parts = build_hind(side, y + (1 if side == 'far' else 0), mats, root)
        (far_parts if side == 'far' else near_parts).extend(a_parts + h_parts)

    # --- the carapace: banded dome over a dark belly -------------------------------
    bands = [(-28, -21, 0.0), (-21, -15, 0.9), (-15, -9.5, 0.0), (-9.5, -4, 0.9), (-4, 1.5, 0.0), (1.5, 8, 0.9)]
    shells = carapace(bands, 6.5, mats['orange'])
    belly = cr.blob('belly', (-9, 0, 8.5), (15, 9, 5), mats['rubber'], 24, 12)
    knobs = []
    for k, (x0, x1, grow) in enumerate(bands[1:5]):
        xm = (x0 + x1) / 2
        top = SHELL_C[2] + (SHELL_R[2] + grow) * math.sqrt(max(0.0, 1 - ((xm - SHELL_C[0]) / (SHELL_R[0] + grow)) ** 2))
        knobs.append(cr.cone(f'knob_{k}', 2.2, 0.2, 3.4, (xm - 0.5, 0, top + 1.0), mats['amber'], vertices=4,
                             flat=True, tilt_deg=-18 - 6 * k))

    # A banded tail that tapers to a point, trailing on the ground.
    tail = tube('tail_root', [(-24, 0, 9), (-30, 0, 6.5), (-35, 0, 5), (-39, 0, 5.5)], (4.2, 3.2, 2.2, 0.5), mats['orange'])
    rc.set_origin(tail, (px(-24), 0, px(9)))
    rings = []
    for k, (x, z, r) in enumerate(((-29, 6.9, 3.5), (-33.5, 5.4, 2.6))):
        ring = rc.add_cylinder(f'knob_tail_{k}', px(r), px(1.4), (px(x), 0, px(z)), mats['amber'], axis='X', vertices=16)
        ring.rotation_euler = (0, math.radians(-20), 0)
        rc.parent_keep(ring, tail)
        rings.append(ring)

    # --- head: goggles, pale eyes, hard hat with a headlamp -------------------------
    head_grp = rc.add_empty('head_grp', (px(HEAD_C[0] - 4), 0, px(HEAD_C[2] - 5)))
    head = cr.blob('head', HEAD_C, HEAD_R, mats['orange'], 32, 16)
    goggle = cr.band('goggle', HEAD_C, HEAD_R, 0.7, (14, 13, 5.2), (HEAD_C[0] + 6, -6.5, HEAD_C[2] + 0.6), mats['rubber'])
    eyes, face = [], []
    for tag, dx, r in (('0', 1.8, 2.7), ('1', 6.6, 2.3)):
        # Sit each lens just proud of the goggle band (the head grown by 0.7).
        gy = (HEAD_R[1] + 0.7) * math.sqrt(1 - (dx / (HEAD_R[0] + 0.7)) ** 2)
        c = (HEAD_C[0] + dx, -gy - 0.3, HEAD_C[2] + 0.6)
        e, objs = cr.eye(tag, c, r, mats, white='lamp', pupil_r=1.0, look=0.8)
        eyes.append(e)
        face += objs
    helmet = cr.band('helmet', HEAD_C, HEAD_R, 1.3, (30, 30, 20), (HEAD_C[0], 0, HEAD_C[2] + 3.6 + 10), mats['amber'])
    brim = rc.add_cylinder('brim', px(9.6), px(1.3), (px(HEAD_C[0] + 1.2), 0, px(HEAD_C[2] + 3.4)), mats['amber'],
                           axis='Z', vertices=24)
    brim.scale = (1.12, 1.0, 1)
    ridge = tube('helmet_ridge', [(HEAD_C[0] - 7.5, 0, HEAD_C[2] + 5), (HEAD_C[0] - 2, 0, HEAD_C[2] + 9.6),
                                  (HEAD_C[0] + 4, 0, HEAD_C[2] + 9.2), (HEAD_C[0] + 7, 0, HEAD_C[2] + 6.8)],
                 (1.2, 1.3, 1.3, 1.1), mats['amber'])
    lamphouse = rc.add_cylinder('lamphouse', px(2.5), px(2.6), (px(HEAD_C[0] + 8.2), 0, px(HEAD_C[2] + 6.6)),
                                mats['steel'], axis='X', vertices=12)
    lamphouse.rotation_euler = (0, math.radians(-12), 0)
    lens = cr.blob('lens', (HEAD_C[0] + 9.6, 0, HEAD_C[2] + 6.9), (1.0, 2.0, 2.0), mats['flash'], 12, 8)
    head_parts = [head, goggle, helmet, brim, ridge, lamphouse, lens] + eyes
    for o in head_parts:
        rc.parent_keep(o, head_grp)

    for o in shells + knobs + [belly, tail, head_grp]:
        rc.parent_keep(o, hull)
    body.extend(far_parts + [tail] + rings + [belly] + shells + knobs + near_parts
                + [head, goggle] + face + [helmet, brim, ridge, lamphouse, lens])
    rig.update(hull=hull, head_grp=head_grp, eyes=eyes, arms=arms, hinds=hinds, tail=tail,
               shells=shells, lens=lens)

    # --- the drill: barrel layer ------------------------------------------------------
    pivot_w = Vector((px(PIVOT[0]), 0, px(proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT)))
    PIVOT_Z = pivot_w.z * rc.PX_PER_UNIT
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, hull)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    collar = rc.add_cylinder('collar', px(4.4), px(3.0), pivot_w + Vector((px(1.2), 0, 0)), mats['amber'], axis='X', vertices=16)
    bit_grp = rc.add_empty('bit_grp', pivot_w)
    x0 = PIVOT[0] + 2.6
    bit = fluted_bit('bit', x0, PIVOT[0] + BARREL_LENGTH, 4.0, mats['steel'])
    rc.parent_keep(bit, bit_grp)
    for o in (collar, bit_grp):
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    barrel.extend((collar, bit))
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH + 3), px(-8), 0)), 5.5, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp, bit=bit_grp)

    # The drill bit that snaps off in the death, lying on the ground.
    wreck = cr.cone('wreck_bit', 3.9, 0.3, BARREL_LENGTH - 2.6, (0, -13, 0), mats['steel'], axis='X', vertices=8, flat=True)
    rc.parent_keep(wreck, root)
    body.append(wreck)
    rig['wreck'] = wreck
    rig['fx'] = cr.death_fx(mats, root, body, (0, 16), 14, y=-15, fires=(5.4, 4.0))
    rig['layers'] = {'body': body, 'barrel': barrel}
    rig['rest'] = cr.snapshot([hull, head_grp, tube_grp, bit_grp, wreck, tail]
                              + list(arms.values()) + list(hinds.values()) + shells)
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def step(phase, stride=2, lift=2):
    """Foot offset (dx, dz) in whole pixels: planted and sliding back, then lifted
    and swung forward."""
    phase %= 1.0
    if phase < 0.5:
        return round(stride - 4 * stride * phase), 0
    u = (phase - 0.5) / 0.5
    return round(-stride + 2 * stride * u), round(lift * math.sin(math.pi * u))


def pose(rig, mats, palette, state, i):
    hull, head, tube, bit, tail = (rig[k] for k in ('hull', 'head_grp', 'tube_grp', 'bit', 'tail'))
    cr.restore(rig['rest'])
    cr.lids(rig['eyes'], 1)
    for e in rig['eyes']:
        e.data.materials[0] = mats['lamp']
    rig['lens'].data.materials[0] = mats['flash']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide([rig['wreck']], True)
    rc.pose_fire(rig['flash'], 0)
    cr.reset_fx(rig['fx'])
    rc.set_burnt(mats, palette, False, hues=HUES)

    def spin(steps):
        bit.rotation_euler.x = math.radians(22.5 * steps)      # half a facet per step

    def limb(obj, dx, dz):
        obj.location.x += px(dx)
        obj.location.z += px(dz)

    if state == 'idle':
        hull.location.z += px((0, 0, -1, -1, -1, 0)[i])
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        spin(i // 2)                                           # the bit turns over lazily
        tail.rotation_euler.y = math.radians((0, 4, 8, 8, 4, 0)[i])
        if i == 4:
            cr.lids(rig['eyes'], 0.15)                         # blink

    elif state == 'move':
        # Diagonal pairs: near arm with far hind leg, then the other two.
        n = 6
        for side in ('near', 'far'):
            off = 0 if side == 'near' else 0.5
            limb(rig['arms'][side], *step(i / n + off, stride=3))
            limb(rig['hinds'][side], *step(i / n + off + 0.5))
        hull.location.z += px((0, 1, 0, 0, 1, 0)[i])
        head.location.z += px((0, 0, 1, 0, 0, 1)[i])
        tail.rotation_euler.y = math.radians((-6, -3, 3, 6, 3, -3)[i])
        spin(i)

    elif state == 'charge':
        # Hunkers down and revs: the bit spins flat out and the eyes narrow.
        spin(i * 3 + 1)
        hull.location.x += px((-1, -2)[i])
        hull.location.z += px(-1)
        tube.location.x += px((-1, -2)[i])
        for side in ('near', 'far'):
            limb(rig['arms'][side], -2, 0)
        tail.rotation_euler.y = math.radians((10, 14)[i])
        cr.lids(rig['eyes'], 0.5)

    elif state == 'fire':
        spin(i * 3)
        tube.location.x += px((-5, -4, -2, -1, 0)[i])
        hull.location.x += px((-2, -1, -1, 0, 0)[i])
        head.location.x += px((-1, -1, 0, 0, 0)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])
        tail.rotation_euler.y = math.radians((-8, -4, 0, 0, 0)[i])

    elif state == 'hurt':
        hull.location.x += px((-2, 1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        cr.lids(rig['eyes'], (0.3, 0.3, 0.7)[i])
        tail.rotation_euler.y = math.radians((16, 6, 0)[i])
        for side in ('near', 'far'):
            limb(rig['arms'][side], (-1, 0, 0)[i], (1, 0, 0)[i])

    elif state == 'death':
        # The shell slumps on to its belly, the bit snaps off, the lamp goes out.
        dz = (1, 0, -2, -3, -4, -4, -4)[i]
        cr.pose_death_fx(rig['fx'], i, fire_at=((-11, 24 + dz), (6, 20 + dz)), smoke_at=(-6, 34))
        if i >= 2:
            t = i - 2
            hull.location.z += px(dz)
            rc.set_burnt(mats, palette, True, hues=HUES)
            for e in rig['eyes']:
                e.data.materials[0] = mats['ink']
            rig['lens'].data.materials[0] = mats['ink']
            rc.hide(rig['layers']['barrel'], True)
            rc.hide([rig['wreck']], False)
            head.rotation_euler.y = math.radians((4, 10, 16, 18, 18)[t])
            head.location.z += px((0, -1, -1, -2, -2)[t])
            for leg in list(rig['arms'].values()) + list(rig['hinds'].values()):
                leg.scale = (1.15, 1, 0.6)
            tail.rotation_euler.y = math.radians((-4, -8, -10, -10, -10)[t])
            rig['wreck'].location = (px((17, 19, 20, 20, 20)[t]), px(-13), px((9, 5, 3.4, 3.2, 3.2)[t]))
            rig['wreck'].rotation_euler = (0, math.radians((10, 24, 32, 36, 36)[t]), 0)


if __name__ == '__main__':
    rc.run_mobile(
        name='delver', canvas=(92, 68), anchor=(46, 63), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cr.STATES, part_groups=PART_GROUPS,
        materials=('orange', 'amber', 'steel', 'rubber', 'smoke', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
