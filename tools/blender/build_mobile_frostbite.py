"""
Frost golem (roster id `ice`): model, poses, layered renders.

    blender --background --python build_mobile_frostbite.py -- --out work/frostbite --scale 4

A hunched, knuckle-walking ape of ice seen from the side: a faceted barrel chest
tilted forward over short dark-ice legs, a ridge of hexagonal crystals growing out of
its back like a glacier's crest (frosted white points), and a low head slung in front of the shoulders with
a heavy brow over one big googly eye and an underbite jaw with two icicle tusks. The
far arm knuckles on the ground; the near arm is clenched in a dark ice gauntlet from
which a long white crystal lance juts forward. Gauntlet and lance are the
`barrel` layer. A violet rune smoulders in the flank and flares while it charges.

Everything is low-poly and flat shaded so the toon ramp falls into facets; limbs are
bezier tubes with a coarse bevel (octagonal, flat shaded), crystals are custom bmesh
prisms with a pointed tip.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import creature as cr  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (6, 17)
BARREL_LENGTH = 19
NEAR_Y = -14
GUN_Y = -12
HUES = ('ice', 'boot', 'white')
NEAR_FOOT_DROP = 1.2

# Glow groups are shared across layers by number: the barrel flash shares `fire`'s.
PART_GROUPS = (
    ('legfar', 1), ('armfar', 2), ('crystala', 3), ('crystalb', 4), ('body', 5), ('belly', 6),
    ('legnear', 7), ('rune', 8), ('jaw', 9), ('tusk', 10), ('head', 11), ('brow', 12),
    ('socket', 13), ('eye', 14), ('pupil', 15), ('armnear', 16), ('frost', 17),
    ('smoke', 18), ('boom', 19), ('fire', 20),
    ('cuff', 21), ('spike', 22), ('shardlet', 23), ('horn', 24), ('tip', 25), ('flash', 20),
)


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def limb(name, pts, radii, material):
    """A bezier tube with a coarse bevel, flat shaded: a faceted ice limb."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(1)
    cu.bevel_resolution = 1
    cu.resolution_u = 3
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
    return rc.finish(obj, material, smooth=False)


def crystal(name, base, radius, length, tilt_deg, material, sides=6, shoulder=0.62, twist=0.0, lean_y=0.0,
            tip=None):
    """A hexagonal ice prism with a pointed tip, growing from `base` (x, y, z) along its
    local z, tilted `tilt_deg` about y (positive leans it back). Origin at the base.
    With a `tip` material the point is a separate child object (`tip_<name>`) in that
    material, so it gets its own part group: frosted white points on ice prisms."""
    if tip is not None:
        body = _frustum(name, radius, length * shoulder, sides, twist, 0.9, None, material)
        point = _frustum('tip_' + name, radius * 1.04, length * (1 - shoulder), sides, twist, None, 0, tip)
        point.location.z = px(length * shoulder - 0.02)
        body.location = tuple(px(c) for c in base)
        body.rotation_euler = (math.radians(lean_y), math.radians(-tilt_deg), 0)
        point.parent = body                               # rides in the prism's own frame
        return body
    bm = bmesh.new()
    rings = []
    for z, r in ((0.0, radius * 0.9), (length * shoulder, radius)):
        ring = []
        for k in range(sides):
            a = 2 * math.pi * k / sides + math.radians(twist)
            ring.append(bm.verts.new((px(r * math.cos(a)), px(r * math.sin(a)), px(z))))
        rings.append(ring)
    apex = bm.verts.new((0, 0, px(length)))
    a, b = rings
    for k in range(sides):
        n = (k + 1) % sides
        bm.faces.new((a[k], a[n], b[n], b[k]))
        bm.faces.new((b[k], b[n], apex))
    bm.faces.new(list(reversed(a)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = tuple(px(c) for c in base)
    obj.rotation_euler = (math.radians(lean_y), math.radians(-tilt_deg), 0)
    return rc.finish(obj, material, smooth=False)


def _frustum(name, radius, height, sides, twist, bottom, top, material):
    """A hexagonal frustum along local z from 0 to `height`; `bottom` and `top` scale the
    radius at each end (None: full radius, closed flat; 0: a point)."""
    bm = bmesh.new()
    ends = []
    for z, k in ((0.0, bottom), (height, top)):
        k = 1.0 if k is None else k
        if k == 0:
            ends.append([bm.verts.new((0, 0, px(z)))])
            continue
        ends.append([bm.verts.new((px(radius * k * math.cos(2 * math.pi * j / sides + math.radians(twist))),
                                   px(radius * k * math.sin(2 * math.pi * j / sides + math.radians(twist))), px(z)))
                     for j in range(sides)])
    a, b = ends
    for j in range(sides):
        n = (j + 1) % sides
        bm.faces.new((a[j], a[n], b[0]) if len(b) == 1 else (a[j], a[n], b[n], b[j]))
    bm.faces.new(list(reversed(a)))
    if len(b) > 1:
        bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=False)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build_leg(side, y, mats, root, drop=0.0):
    """A rigid leg hanging from the hip; `drop` (px) reaches the foot further down, the
    hip stays put."""
    tag = 'legnear' if side == 'near' else 'legfar'
    hip = rc.add_empty(f'hip_{side}', (px(-9), px(y), px(17)))
    thigh = limb(f'{tag}_thigh', [(-10, y, 18), (-7, y, 11 - drop / 2), (-8, y, 5 - drop)], (5.6, 4.6, 4.0),
                 mats['boot'])
    foot = cr.facet(f'{tag}_foot', (-6, y, 3.2 - drop), (7, 4.6, 3.4), mats['boot'])
    for o in (thigh, foot):
        rc.parent_keep(o, hip)
    rc.parent_keep(hip, root)
    return hip, [thigh, foot]


def build(mats, proj):
    body_layer, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))

    legs, leg_parts = {}, {}
    # The near foot sinks 1.2 px on to the ground row; the far one as much again plus
    # what the camera tilt lifts it by, so both plant on the same row.
    for side, y in (('far', 7), ('near', -8)):
        drop = NEAR_FOOT_DROP - (parts.plant_z(y, -8) if side == 'far' else 0)
        legs[side], leg_parts[side] = build_leg(side, y, mats, root, drop)

    beast = rc.add_empty('beast', (px(-4), 0, px(14)))
    rc.parent_keep(beast, root)

    # Torso: a hunched barrel, high and wide at the shoulders, tipped forward, with a
    # paler belly slab.
    torso = cr.facet('body_torso', (-5, 0, 26), (15, 11.5, 12.5), mats['ice'], subdivisions=2)
    torso.rotation_euler = (0, math.radians(-24), 0)
    shoulder = cr.facet('body_shoulder', (4, 0, 32), (10, 12, 9), mats['ice'], subdivisions=1)
    shoulder.rotation_euler = (0, math.radians(-15), 0)
    belly = cr.facet('belly', (3, -1, 21), (8, 10, 7.5), mats['ice'], subdivisions=1)
    belly.rotation_euler = (0, math.radians(-30), 0)

    # The glacier crest: crystals out of the back, tallest over the shoulders.
    crest = []
    spec = (((6, 2, 38), 3.2, 12, -5), ((0, 0, 39), 4.0, 18, 10), ((-7, 2, 37), 3.6, 15, 28),
            ((-13, 0, 33), 3.0, 11, 45), ((-18, 1, 27), 2.4, 8, 62), ((3, 3, 37), 2.4, 10, -20),
            ((-10, 3, 36), 2.6, 12, 18))
    for k, (at, r, h, tilt) in enumerate(spec):
        crest.append(crystal(f'crystal{"ab"[k % 2]}_{k}', at, r, h, tilt, mats['ice'], twist=15 * k,
                             lean_y=(0, 0, 0, 0, 0, 12, 14)[k], shoulder=0.5, tip=mats['white']))
    tips = [c.children[0] for c in crest]
    rune = rc.add_box('rune', (px(1.2), px(0.8), px(6)), (px(-10), px(-12.4), px(25)), mats['rune'])
    rune.rotation_euler = (0, math.radians(35), 0)
    rune2 = rc.add_box('rune_b', (px(1.2), px(0.8), px(4)), (px(-7.5), px(-12.4), px(23.5)), mats['rune'])
    rune2.rotation_euler = (0, math.radians(-40), 0)

    # Head, slung low in front of the shoulders.
    head_grp = rc.add_empty('head_grp', (px(12), 0, px(29)))
    skull = cr.facet('head', (19, 0, 32), (10, 8.2, 8.6), mats['ice'], subdivisions=2)
    brow = rc.add_box('brow', (px(12), px(15), px(2.4)), (px(21), 0, px(39.2)), mats['ice'], bevel=px(0.9), segments=1)
    brow.rotation_euler = (0, math.radians(10), 0)
    horns = [crystal(f'horn_{k}', (15 - 3 * k, y, 39.5), 2.2, 11 - 2 * k, 55 + 10 * k, mats['ice'], twist=30,
                     shoulder=0.5, tip=mats['white'])
             for k, y in enumerate((-2.5, 2.5))]
    jaw = cr.facet('jaw', (24, 0, 25), (9, 7, 4), mats['boot'], subdivisions=1)
    rc.set_origin(jaw, (px(15), 0, px(27)))
    tusks = [cr.cone(f'tusk_{k}', 1.8, 0, 7, (x, -5.6, 29.8), mats['eye'], vertices=5, flat=True, tilt_deg=t)
             for k, (x, t) in enumerate(((31, -14), (26.5, -6)))]
    for t in tusks:
        rc.parent_keep(t, jaw)
    # One big googly eye in a dark socket, the first thing you see. (A far eye peeking
    # round the front of the face was tried: it gets clipped by the snout into a C.)
    sockets, eyes, pupils = [], [], []
    for tag, (x, y, z), r, look in (('0', (21, -8.4, 33.2), 4.7, 1.5),):
        sockets.append(rc.add_cylinder(f'socket_{tag}', px(r + 1.1), px(0.8), (px(x), px(y + 0.5), px(z)), mats['ink'],
                                       vertices=16, smooth=False))
        e, objs = cr.eye(tag, (x, y, z), r, mats, look=look, pupil_r=r * 0.45)
        eyes.append(e)
        pupils += objs[1:]
    horn_tips = [h.children[0] for h in horns]
    head_parts = [skull, brow, jaw] + sockets + eyes + pupils + horns + horn_tips + tusks
    for o in [skull, brow, jaw] + sockets + eyes + horns:
        rc.parent_keep(o, head_grp)

    # Far arm: knuckles on the ground ahead of the chest.
    arm_far = rc.add_empty('shoulder_far', (px(4), px(9), px(31)))
    # The knuckles sit as low as the camera tilt lifts them, so they plant on the ground
    # row with the feet.
    kz = parts.plant_z(10, -8)
    far_parts = [limb('armfar_upper', [(4, 9, 32), (9, 9.5, 22), (12, 10, 12 + kz / 2)], (4.8, 4.0, 3.4), mats['ice']),
                 limb('armfar_fore', [(12, 10, 13 + kz / 2), (14, 10, 4 + kz)], (4.0, 3.2), mats['boot']),
                 cr.facet('armfar_fist', (15, 10, 1.8 + kz), (4.6, 4, 3.4), mats['boot'])]
    for o in far_parts:
        rc.parent_keep(o, arm_far)

    # Near arm: shoulder down and forward to the gauntlet at the pivot.
    arm_near = rc.add_empty('shoulder_near', (px(4), px(-11), px(31)))
    near_parts = [limb('armnear_upper', [(3, -11, 33), (-1, -11.5, 25)], (6.0, 5.0), mats['ice']),
                  limb('armnear_fore', [(-1, -11.5, 25), (0, -11.8, 21), (4, -12, 17)], (4.6, 4.0, 3.6), mats['boot'])]
    for o in near_parts:
        rc.parent_keep(o, arm_near)

    for o in [torso, shoulder, belly, rune, rune2, head_grp, arm_far, arm_near] + crest:
        rc.parent_keep(o, beast)

    twinkle = rc.add_box('flash_twinkle', (px(2.4), px(0.8), px(2.4)), (px(0), px(-6), px(52)), mats['flash'])
    twinkle.rotation_euler = (0, math.radians(45), 0)
    rc.parent_keep(twinkle, beast)

    body_layer.extend(leg_parts['far'] + far_parts + crest + tips + [torso, shoulder, belly] + leg_parts['near']
                      + [rune, rune2] + head_parts + near_parts + [twinkle])
    rig.update(beast=beast, head=head_grp, jaw=jaw, eyes=eyes, sockets=sockets, legs=legs, arm_far=arm_far, arm_near=arm_near,
               crest=crest, runes=[rune, rune2], twinkle=twinkle)

    # --- the frost lance: barrel layer ---------------------------------------------
    pivot_z = proj.z_for_height(PIVOT[1], world_y=px(GUN_Y)) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT[0]), px(GUN_Y), px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, beast)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    rc.parent_keep(tube_grp, pivot)
    cuff = cr.facet('cuff', (PIVOT[0] + 0.5, GUN_Y - 1, pivot_z), (7, 5.4, 6.4), mats['boot'])
    lance = crystal('spike', (PIVOT[0] + 3, GUN_Y - 2, pivot_z), 3.8, BARREL_LENGTH - 2, -90, mats['white'], twist=0,
                    shoulder=0.55)
    lets = [crystal(f'shardlet_{k}', (PIVOT[0] + 3, GUN_Y - 2.5, pivot_z + dz), 1.7, 8, t, mats['white'])
            for k, (dz, t) in enumerate(((4, -50), (-4, -130)))]
    rc.parent_keep(cuff, pivot)
    for o in [lance] + lets:
        rc.parent_keep(o, tube_grp)
    barrel.extend([cuff, lance] + lets)
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH + 4), px(-6), 0)), 6, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp)

    rig['fx'] = cr.death_fx(mats, root, body_layer, (2, 28), 16, y=-18, fires=(5.6,))
    rig['layers'] = {'body': body_layer, 'barrel': barrel}
    rig['rest'] = cr.snapshot([beast, head_grp, jaw, arm_far, arm_near, tube_grp, twinkle, torso, shoulder]
                              + list(legs.values()) + crest + eyes + sockets)
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def step(phase, stride=3, lift=3):
    phase %= 1.0
    if phase < 0.5:
        return round(stride - 4 * stride * phase), 0
    u = (phase - 0.5) / 0.5
    return round(-stride + 2 * stride * u), round(lift * math.sin(math.pi * u))


def pose(rig, mats, palette, state, i):
    beast, head, jaw, tube, twinkle = (rig[k] for k in ('beast', 'head', 'jaw', 'tube_grp', 'twinkle'))
    cr.restore(rig['rest'])

    def lid(k):
        """Squint: the whites narrow and their dark sockets with them, down to a slit."""
        for e, sk in zip(rig['eyes'], rig['sockets']):
            e.scale = (1, 1, k)
            sk.scale = (1, 1, max(0.45, min(1.0, k * 1.3)))

    lid(1)
    for r in rig['runes']:
        r.data.materials[0] = mats['rune']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide([twinkle], True)
    rc.pose_fire(rig['flash'], 0)
    cr.reset_fx(rig['fx'])
    rc.set_burnt(mats, palette, False, hues=HUES)

    def gape(deg):
        jaw.rotation_euler.y = math.radians(deg)          # positive drops the jaw

    if state == 'idle':
        beast.location.z += px((0, 0, -1, -1, -1, 0)[i])
        rig['arm_far'].location.z -= px((0, 0, -1, -1, -1, 0)[i])      # the knuckles stay planted
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        if i in (1, 4):                                    # a glint runs up the crest
            rc.hide([twinkle], False)
            twinkle.location.x += px((0, 0, 0, 0, -10)[i])
            twinkle.location.z += px((0, 0, 0, 0, -6)[i])
        if i == 3:
            lid(0.15)

    elif state == 'move':
        # A knuckle-walk: legs alternate, the far fist swings forward and plants, and
        # the whole body rolls from shoulder to hip.
        n = 6
        for side, leg in rig['legs'].items():
            dx, dz = step(i / n + (0 if side == 'near' else 0.5))
            leg.location.x += px(dx)
            leg.location.z += px(dz)
        dx, dz = step(i / n + 0.25, stride=3, lift=3)
        rig['arm_far'].location.x += px(dx)
        rig['arm_far'].location.z += px(dz - (0, 1, 0, 0, 1, 0)[i])   # lift from the ground, not the bob
        beast.location.z += px((0, 1, 0, 0, 1, 0)[i])
        head.location.z += px((0, 0, -1, 0, 0, -1)[i])

    elif state == 'charge':
        # Crouches, hauls the lance back, the jaw drops and the rune flares.
        beast.location.z += px((-1, -2)[i])
        rig['arm_far'].location.z -= px((-1, -2)[i])
        tube.location.x += px((-3, -4)[i])
        head.location.x += px((-1, -1)[i])
        gape((10, 16)[i])
        lid(0.5)
        for r in rig['runes']:
            r.data.materials[0] = mats['flash']
        for k, c in enumerate(rig['crest']):                # the crest bristles
            c.location.z += px((0, 1)[(i + k) % 2])

    elif state == 'fire':
        tube.location.x += px((-6, -5, -3, -1, 0)[i])
        beast.location.x += px((-2, -1, -1, 0, 0)[i])
        head.location.x += px((-1, -1, 0, 0, 0)[i])
        gape((20, 14, 6, 0, 0)[i])
        lid((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        beast.location.x += px((-2, 1, 0)[i])
        head.location.z += px((2, 1, 0)[i])
        head.rotation_euler.y = math.radians((-14, -6, 0)[i])
        gape((14, 6, 0)[i])
        lid((0.25, 0.25, 0.65)[i])

    elif state == 'death':
        # The rune goes dark, the crest shatters off and the golem slumps forward.
        cr.pose_death_fx(rig['fx'], i, fire_at=((-4, 24),), smoke_at=(4, 36))
        if i >= 2:
            t = i - 2
            rc.set_burnt(mats, palette, True, hues=HUES)
            for r in rig['runes']:
                r.data.materials[0] = mats['ink']
            lid(0.12)
            rc.hide(rig['layers']['barrel'], True)
            beast.location.z += px((-1, -3, -5, -6, -6)[t])
            rig['arm_far'].rotation_euler.y = math.radians((-10, -25, -40, -45, -45)[t])
            rig['arm_near'].rotation_euler.y = math.radians((-10, -25, -40, -45, -45)[t])
            head.location.z += px((-1, -2, -3, -4, -4)[t])
            gape((10, 18, 22, 24, 24)[t])
            for leg in rig['legs'].values():
                leg.scale = (1.2, 1, (0.85, 0.7, 0.55, 0.5, 0.5)[t])
            for k, c in enumerate(rig['crest']):
                side = (1, 0.2, -0.5, -0.8, -0.9, 0.6, -0.3)[k]
                land = 10 - rig['rest'][c.name][0].z / px(1)          # down to the ground
                c.location.x += px(side * (3, 8, 12, 14, 14)[t])
                c.location.z += px((5, 3, 0.45 * land, land, land)[t])
                c.rotation_euler.y += math.radians(side * (30, 70, 100, 120, 120)[t])

if __name__ == '__main__':
    rc.run_mobile(
        name='frostbite', canvas=(100, 84), anchor=(46, 79), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cr.STATES, part_groups=PART_GROUPS,
        materials=('ice', 'boot', 'white', 'smoke', 'eye', 'ink', 'rune', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
