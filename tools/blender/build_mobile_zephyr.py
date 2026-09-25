"""
Wind skirmisher (the roster's `boomer`): a chibi bird mech.

    blender --background --python build_mobile_zephyr.py -- --out work/zephyr --scale 4

The chibi_mech body (fat boots, stub legs, round torso, big dome head with a goggle
visor) is copied here rather than shared, because the bird needs its own parts in the
middle of it: big eyes with dark pupils on the visor, a hooked amber beak under it, one
smooth plume blown back off the crown, a cream breast, one broad tail feather, a talon at
the toe and heel of each boot, and a folded wing: a single flat plate cut to a smooth
leaf with three rounded feather lobes, leaned back to face the sun so it takes the lit
tone. The gun is a throwing arm holding a boomerang that runs forward over the fist and
hooks down at the muzzle, clear of the beak. The boomerang leaves the hand on `fire` and
is back by the end of it; the wing beats in visible steps while it walks, cocks up on
`charge` and snaps down on the throw.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chibi_mech as cm  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from build_mobile_wyvern import tube  # noqa: E402
from render_common import px  # noqa: E402

BARREL_LENGTH = 14
PIVOT = (5, 22)
FLASH = 4.5
NEAR_Y = cm.NEAR_Y
BOOT_Y = cm.BOOT_Y
HIP_Z = cm.HIP_Z
STAND = cm.STAND
HEAD_C = cm.HEAD_C
HEAD_R = (11.5, 10.5, 10.5)
STATES = cm.STATES
SHOULDER = (-4, -9.8, 21.5)          # the near wing hinges here (x, y, z)

# Later (higher) numbers sit in front: the id pass draws the line on the lower group.
# The barrel's flash shares its number with the body's fire (glow groups match by number).
PART_GROUPS = (
    ('boot_far', 2), ('leg_far', 3), ('tail', 5),
    ('boot_near', 6), ('talon', 7), ('leg_near', 8), ('torso', 9), ('breast', 10),
    ('head', 12), ('crest', 13), ('visor', 14), ('eye', 15), ('beak', 16),
    ('pupil', 17), ('feath', 18),
    ('smoke', 22), ('boom', 23), ('fire', 24),
    ('hinge', 1), ('arm', 2), ('fist', 3), ('blade', 4), ('flash', 24),
)
# The wing's outline around the shoulder (x back is negative, z up), smoothed through
# Catmull-Rom: leading edge up and back to three rounded lobes, then along the bottom.
WING_OUTLINE = ((2, -1), (0, 4), (-5, 8), (-10, 9.5), (-13.5, 7.5), (-11.5, 5), (-15.5, 3.5), (-13, 0.5),
                (-14, -2.5), (-10, -4.5), (-4, -4.5), (0, -3.5))
MATERIALS = ('shell', 'glass', 'bone', 'skin', 'steel', 'rubber', 'smoke', 'eye', 'ink', 'lamp', 'flame', 'flash')


def wing_plate(name, outline, origin, scale, mat, thickness=1.2, steps=5, lean=(0.25, 0.45)):
    """A flat plate in the xz plane at depth y from a closed outline smoothed with Catmull-Rom."""
    ox, oy, oz = origin
    pts = [Vector((x, z)) for x, z in outline]
    n = len(pts)
    ring = []
    for k in range(n):
        p0, p1, p2, p3 = pts[k - 1], pts[k], pts[(k + 1) % n], pts[(k + 2) % n]
        for t in (u / steps for u in range(steps)):
            t2, t3 = t * t, t * t * t
            q = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            ring.append(q)
    bm = bmesh.new()
    # Lean the plate back at the top and the rear so it faces the sun (top left) and
    # takes the lit tone; square to the camera it sat in the shadow tone.
    verts = [bm.verts.new((px(ox + q.x * scale), px(oy + lean[0] * q.x * scale + lean[1] * q.y * scale), px(oz + q.y * scale))) for q in ring]
    bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(thickness)
    mod.offset = 0
    return rc.finish(obj, mat, smooth=False)


def build(mats, proj):
    body, barrel = [], []
    rig = {}
    hue = mats['shell']
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
    rc.parent_keep(chassis, root)

    def keep(obj, parent):
        rc.parent_keep(obj, parent)
        body.append(obj)
        return obj

    # --- boots with talons, and legs -----------------------------------------
    legs = {}
    for side, y in (('far', BOOT_Y), ('near', -BOOT_Y)):
        boot = rc.add_box(f'boot_{side}', (px(13), px(8), px(7)), (px(1), px(y), px(3.5)), mats['rubber'], bevel=px(2.0))
        cap = rc.add_box(f'boot_{side}_cap', (px(4.5), px(8.7), px(4.2)), (px(5.8), px(y), px(2.7)), mats['steel'], bevel=px(1.0))
        rc.set_origin(boot, (0, px(y), 0))
        rc.parent_keep(cap, boot)
        claws = [tube(f'talon_{side}_front', [(7.5, y - 1.5, 3.5), (10.5, y - 1.5, 2.6), (11.8, y - 1.5, 0.0)], (1.6, 1.2, 0.3), mats['bone']),
                 tube(f'talon_{side}_back', [(-4, y - 1.5, 2.5), (-7, y - 1.5, 1.6), (-8.2, y - 1.5, 0.0)], (1.4, 1.0, 0.3), mats['bone'])]
        for c in claws:
            rc.parent_keep(c, boot)
        leg = rc.add_cylinder(f'leg_{side}', px(2.8), px(8), (px(4), 0, 0), hue, axis='X', vertices=12)
        rc.set_origin(leg, (0, 0, 0))
        for o in (boot, leg):
            rc.parent_keep(o, root)
        body.extend([boot, cap, leg] + claws)
        legs[side] = {'boot': boot, 'leg': leg, 'y': y}
    rig['legs'] = legs

    # --- torso: round, with a big cream breast that shows under the arm ----------------
    torso = rc.add_sphere('torso', px(1), (0, 0, px(18)), hue, scale=(12.5, 10, 8.5), segments=24, rings=12)
    breast = rc.add_sphere('breast', px(1), (px(3.5), px(-1.5), px(17.5)), mats['bone'], scale=(9.8, 9.4, 7.8), segments=24, rings=12)
    cut = rc.add_box('cut_breast', (px(20), px(30), px(30)), (px(-10.5), 0, px(17)), mats['bone'])
    rc.boolean_cut(breast, cut)
    rc.parent_keep(cut, breast)
    for o in (torso, breast):
        keep(o, chassis)

    # --- tail: one broad rounded feather, low at the back ---------------------------------
    tail_grp = rc.add_empty('tail_grp', (px(-9), 0, px(15)))
    rc.parent_keep(tail_grp, chassis)
    keep(tube('tail', [(-7, 1, 15), (-14, 1, 12), (-19, 1, 10.5)], (3.4, 3.2, 2.2), hue, squash=0.45), tail_grp)
    rig['tail'] = tail_grp

    # --- head: dome, goggle visor, eyes, hooked beak, swept crest -----------------------
    head_grp = rc.add_empty('head_grp', (px(HEAD_C[0]), 0, px(HEAD_C[2])))
    head_c = (px(HEAD_C[0]), 0, px(HEAD_C[2]))
    head = rc.add_sphere('head', px(1), head_c, hue, scale=HEAD_R, segments=32, rings=16)
    visor = rc.add_sphere('visor', px(1), head_c, mats['glass'], scale=tuple(r + 0.7 for r in HEAD_R), segments=32, rings=16)
    band = rc.add_box('cut_visor_band', (px(18), px(13), px(8.6)), (px(HEAD_C[0] + 5.5), px(-6.5), px(33.6)), mats['glass'])
    mod = visor.modifiers.new('Band', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = band
    band.hide_render = True
    band.hide_viewport = True
    rc.parent_keep(band, visor)
    # Big eyes: white discs with dark pupils looking forward, so they read at 1x.
    eyes = [rc.add_cylinder(f'eye_{k}', px(3.3), px(0.8), (px(HEAD_C[0] + ex), px(-10.4), px(33.6)), mats['eye'], vertices=16, smooth=False)
            for k, ex in enumerate((0.8, 8.2))]
    eyes += [rc.add_cylinder(f'pupil_{k}', px(1.6), px(0.8), (px(HEAD_C[0] + ex + 1.0), px(-11.0), px(33.4)), mats['ink'], vertices=12, smooth=False)
             for k, ex in enumerate((0.8, 8.2))]
    beak = tube('beak_upper', [(9, -2, 31), (15, -2, 31), (19.5, -2, 29.6), (21, -2, 27.4)], (3.2, 2.6, 1.5, 0.4), mats['lamp'], squash=0.8)
    jaw = tube('beak_lower', [(10, -2, 28.2), (14, -2, 27.8), (16, -2, 28.2)], (1.8, 1.3, 0.5), mats['bone'], squash=0.8)
    # One smooth plume blown back off the crown, hugging the dome: the wind in the name.
    crest = [tube('crest', [(1, -2, 40), (-4, -2, 44.5), (-10, -2, 45.5), (-14, -2, 43.5)], (2.8, 2.6, 2.0, 1.3), hue, squash=0.5)]
    for o in [head, visor, beak, jaw] + eyes + crest:
        rc.parent_keep(o, head_grp)
    body.extend([head, visor, beak, jaw] + eyes + crest)
    rig.update(chassis=chassis, head_grp=head_grp, eyes=eyes, crest=crest)

    # --- wings: layered feathers from the shoulder, far pair peeking over the back ------------
    wing = rc.add_empty('wing_grp', (px(SHOULDER[0]), 0, px(SHOULDER[2])))
    rc.parent_keep(wing, chassis)
    sx, sy, sz = SHOULDER
    # A folded wing: one flat plate cut to a smooth leaf with three rounded feather
    # lobes on its trailing edge. Flat, so the toon ramp gives it one clean tone and the
    # lobes alone say "feathers"; tubes and fans here all shaded into stripes.
    keep(wing_plate('feath', WING_OUTLINE, (sx, sy, sz), 0.9, hue), wing)
    rig['wing'] = wing

    rc.parent_keep(torso, chassis)
    rc.parent_keep(head_grp, chassis)

    # --- the gun: a throwing arm and a boomerang (barrel layer) ---------------------------
    pivot_z = proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT[0]), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    rc.parent_keep(tube_grp, pivot)
    hinge = rc.add_sphere('hinge', px(3.4), pivot_w, mats['steel'], segments=14, rings=8)
    rc.parent_keep(hinge, pivot)
    barrel.append(hinge)
    L = BARREL_LENGTH
    wx, wz = pivot_w.x / px(1), pivot_w.z / px(1)
    arm = tube('arm_limb', [(wx, -1.5, wz), (wx + 4.5, -1.5, wz - 0.3), (wx + L - 6, -1.5, wz)], (2.6, 2.3, 2.2), mats['shell'])
    fist = rc.add_sphere('fist', px(2.9), (px(wx + L - 5.5), px(-2), px(wz)), mats['steel'], segments=12, rings=8)
    # Held by one arm: it runs forward over the fist and bends down at the muzzle, so
    # it stays clear of the beak above.
    blade = tube('blade', [(wx + L - 8, -3.5, wz + 1.2), (wx + L - 3, -3.5, wz + 1.2), (wx + L, -3.5, wz - 0.8),
                           (wx + L - 0.6, -3.5, wz - 5), (wx + L - 3, -3.5, wz - 8.5)],
                 (1.4, 2.0, 2.1, 1.7, 0.6), mats['skin'], squash=0.45)
    for o in (arm, fist, blade):
        rc.parent_keep(o, tube_grp)
        barrel.append(o)
    rig['blade'] = [blade]
    muzzle = pivot_w + Vector((px(L + FLASH * 0.7), px(-8), 0))
    rig['flash'] = rc.add_fire('flash', mats, muzzle, FLASH, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp)

    # --- death props --------------------------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-14), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    for o in smoke:
        o.visible_shadow = False
        keep(o, root)
    rig['boom'] = rc.add_fire('boom', mats, (px(1), px(-15), px(24)), 15, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(1), px(-14), px(24)), 5.6, root)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(-8), px(-14), px(16)), 4.0, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])
    rig['smoke'] = smoke

    # The wing, tail and plume cast no shadow: on the round body it read as a dark mass.
    for o in body:
        if o.name.startswith(('feath', 'tail', 'crest')):
            o.visible_shadow = False
    rig['layers'] = {'body': body, 'barrel': barrel}
    bpy.context.view_layer.update()
    movers = [chassis, head_grp, tube_grp, wing, tail_grp] + crest
    rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in movers}
    return rig


def pose(rig, mats, palette, state, i):
    chassis, head, tube_grp = rig['chassis'], rig['head_grp'], rig['tube_grp']
    for name, (loc, rot, scale) in rig['rest'].items():
        o = bpy.data.objects[name]
        o.location, o.rotation_euler, o.scale = loc.copy(), rot.copy(), scale.copy()
    for e in rig['eyes']:
        e.scale = (1, 1, 1)
        e.data.materials[0] = mats['ink' if e.name.startswith('pupil') else 'eye']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['blade'], False)
    rc.hide(rig['smoke'], True)
    for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    hues = ('shell', 'glass', 'skin', 'bone')        # the cream breast burns too
    rc.set_burnt(mats, palette, False, hues=hues)

    feet = {side: (x, 0) for side, x in STAND.items()}
    dx = dz = 0
    flap = tail = 0          # degrees; + raises the wing tips / the tail

    def lids(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        flap = (0, 0, 0, 10, 10, 0)[i]
        tail = (0, 0, 10, 10, 0, 0)[i]
        if i == 4:
            lids(0.15)

    elif state == 'move':
        n = STATES['move'][0]
        feet = {'near': parts.walk_foot(i / n, 3, 3), 'far': parts.walk_foot(i / n + 0.5, 3, 3)}
        feet = {side: (x + STAND[side] // 2, z) for side, (x, z) in feet.items()}
        dz = (-1, 0, 0)[i % 3]
        head.location.z += px((0, -1, 0)[i % 3])
        flap = (0, 12, 24, 12, 0, -10)[i]
        tail = (0, -10, 0, 10, 0, -10)[i]

    elif state == 'charge':
        dz = (-1, -2)[i]
        tube_grp.location.x += px((-2, -3)[i])
        head.location.x += px((0, -1)[i])
        lids(0.5)
        flap = (26, 32)[i]                            # wing cocked high, tail up
        tail = (14, 18)[i]

    elif state == 'fire':
        tube_grp.location.x += px((-3, -3, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        lids((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])
        rc.hide(rig['blade'], i < 4)                   # the boomerang is in the air
        flap = (-14, -10, 0, 0, 0)[i]
        tail = (-10, -6, 0, 0, 0)[i]

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        lids((0.3, 0.3, 0.7)[i])
        flap = (24, 10, 0)[i]
        tail = (16, 6, 0)[i]

    elif state == 'death':
        t = i - 2
        if i == 0:
            dz = 1
            rc.pose_fire(rig['boom'], 0.42)
            flap = 20
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
            flap = 30
        else:
            rc.set_burnt(mats, palette, True, hues=hues)
            for e in rig['eyes']:
                e.data.materials[0] = mats['ink']
            rc.hide(rig['layers']['barrel'], True)
            dz = (-1, -3, -4, -4, -4)[t]
            flap = (30, 10, -20, -34, -34)[t]          # the wing droops over the wreck
            tail = (10, 0, -16, -24, -24)[t]
            head.location.x += px((-4, -10, -15, -17, -17)[t])
            head.location.y -= px((4, 9, 13, 13, 13)[t])
            head.location.z += px((9, 8, -6, -14, -13)[t]) - px(dz)
            head.rotation_euler.y = math.radians((-25, -70, -115, -150, -146)[t])
            rc.pose_fire(rig['boom'], (0.78, 0.4, 0, 0, 0)[t])
            rc.pose_fire(rig['fire_a'], (0.6, 1.0, 1.1, 0.9, 1.0)[t], lean_deg=(0, -8, 7, -6, 5)[t], at=(2, 24 + dz))
            rc.pose_fire(rig['fire_b'], (0, 0.6, 0.95, 1.0, 0.8)[t], lean_deg=(0, 6, -8, 7, -5)[t], at=(-7, 17 + dz))
            rc.hide(rig['smoke'], t < 2)
            for s, (sx, sz, k) in zip(rig['smoke'], ((5, 36, 0.9), (2, 43, 0.6))):
                grow = k * (0, 0, 0.8, 1.0, 0.9)[t]
                s.location = (px(sx), px(-14), px(sz + (0, 0, 0, 2, 3)[t]))
                s.scale = (grow, grow, grow)

    chassis.location.x += px(dx)
    chassis.location.z += px(dz)
    for side, leg in rig['legs'].items():
        fx, fz = feet[side]
        fz += parts.plant_z(leg['y'], rig['legs']['near']['y']) + cm.BOOT_SINK   # soles on the ground row; the far one sinks for the tilt
        leg['boot'].location = (px(fx), px(leg['y']), px(fz))
        parts.aim(leg['leg'], (dx + (1 if side == 'near' else -1), HIP_Z + dz + 1), (fx, fz + 5), leg['y'])
    rig['wing'].rotation_euler.y += math.radians(flap)
    rig['tail'].rotation_euler.y += math.radians(tail)


if __name__ == '__main__':
    rc.run_mobile(
        name='zephyr', canvas=cm.CANVAS, anchor=cm.ANCHOR, near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=MATERIALS, build=build, pose=pose)
