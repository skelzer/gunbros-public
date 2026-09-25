"""
Mine layer (the roster's `raon`): procedural model, poses, layered renders.

    blender --background --python build_mobile_sapper.py -- --out work/sapper --scale 4

A combat engineer on tracks. A wedge-fronted orange hull with a hazard-striped side
skirt and a studded mine roller pushed out ahead of the tracks on an arm; behind
it a flared steel hopper heaped with fat disc mines (dark bodies, red pressure caps)
that feeds a drop chute out of the back. The driver is the head: an amber dome wearing
a hard hat with a peak and a miner's headlamp, big eyes behind steel goggles on a
dark strap. The launcher at the front is the gun: a bell-mouthed tube on the `barrel`
layer, modelled horizontal, turned to the aim by the client.

Hull and hopper are extruded side profiles (`prism`), the launcher and the
drop chute are tapered bezier tubes from the wyvern build. Tracks come from parts.py,
the death from the shared kit in render_common.py. All sizes are sprite pixels at 1x.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

# Contract with the simulation (packages/shared, raon sprite): pivot 12 px ahead of and
# 16 px above the anchor, muzzle 14 px along the chute.
PIVOT_DX = 12
PIVOT_UP = 16
BARREL_LENGTH = 14

HALF_WIDTH = 12
TREAD_A = 11.5
TREAD_R = 6

STATES = {
    'idle': (4, 10, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 5, False),
    'hurt': (3, 5, False),
    'death': (7, 6, False),
}

# Prefixes match in order. The barrel's flash shares its number with the body's fire
# (glow groups are matched by number across layers).
PART_GROUPS = (
    ('tread', 1), ('cleat', 1), ('wheel', 2), ('hub', 2), ('hole', 2),
    ('roller', 3), ('stud', 4), ('arm', 5), ('hull', 6), ('hazard', 7), ('stripe', 8),
    ('hopper', 9), ('rim', 10), ('mine', 11), ('knob', 12), ('drop', 13),
    ('head', 14), ('hat', 15), ('brim', 16), ('strap', 17), ('goggle', 18), ('eye', 19), ('pupil', 20),
    ('housing', 21), ('lens', 22), ('wreck', 23), ('smoke', 24), ('boom', 25), ('fire', 26),
    ('collar', 1), ('chute', 2), ('bell', 3), ('bore', 4), ('ring', 5), ('flash', 26),
)
HUES = ('orange', 'amber')


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def prism(name, profile, y0, y1, material, bevel=0.0, segments=2):
    """A side profile, a list of (x, z) round the outline, extruded across y0..y1."""
    n = len(profile)
    bm = bmesh.new()
    a = [bm.verts.new((px(x), px(y0), px(z))) for x, z in profile]
    b = [bm.verts.new((px(x), px(y1), px(z))) for x, z in profile]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = px(bevel)
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    return rc.finish(obj, material, smooth=False)


def arc(cx, cz, r, a0, a1, n=8):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cz + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def dome_band(name, centre, radii, z0, z1, material):
    """The slice z0..z1 of an ellipsoid, as its own object (a hat, a strap)."""
    shell = rc.add_sphere(name, px(1), centre, material, scale=radii, segments=32, rings=16)
    box = rc.add_box(f'cut_{name}', (px(40), px(40), px(z1 - z0)), (centre[0], centre[1], px((z0 + z1) / 2)), material)
    mod = shell.modifiers.new('Band', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, shell)
    return shell


def disc_mine(tag, at, mats, tilt=(0, 0)):
    """A fat landmine: dark disc with a rolled steel rim and a red pressure cap,
    turned face-on to the camera. Origin at its centre."""
    x, y, z = at
    grp = rc.add_empty(f'mine_{tag}', (px(x), px(y), px(z)))
    body = rc.add_cylinder(f'mine_{tag}_body', px(4.4), px(2.6), (px(x), px(y), px(z)), mats['rubber'], vertices=20)
    body.modifiers.new('Bevel', 'BEVEL').width = px(0.8)
    knob = rc.add_cylinder(f'knob_{tag}', px(1.8), px(1.6), (px(x), px(y - 1.6), px(z)), mats['accent'], vertices=10)
    for o in (body, knob):
        rc.parent_keep(o, grp)
    grp.rotation_euler = (math.radians(tilt[0]), math.radians(tilt[1]), 0)
    return grp, [body, knob]


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build_sapper(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, 0))
    rc.parent_keep(chassis, root)

    rig['tracks'] = parts.build_tracks(mats, root, body, TREAD_A, TREAD_R, HALF_WIDTH,
                                       width=5, cleats=12, wheels=3, hub='orange')

    # --- hull: a wedge with a sloped glacis and a raised rear deck -----------------
    hull = prism('hull', [(-17, 9), (17.5, 9), (17.5, 12), (9, 19.5), (-15, 19.5), (-17.5, 17)],
                 -8.5, 8.5, mats['orange'], bevel=1.4, segments=2)
    skirt = prism('hazard_skirt', [(-18, 10.5), (15, 10.5), (13, 15.5), (-18, 15.5)],
                  -12.8, -8.4, mats['rubber'], bevel=0.5)
    stripes = []
    for k in range(6):
        x0 = -16 + k * 5
        stripes.append(prism(f'stripe_{k}', [(x0, 10.9), (x0 + 2.4, 10.9), (x0 + 5.0, 15.1), (x0 + 2.6, 15.1)],
                             -13.2, -12.4, mats['lamp']))
    hull_parts = [hull, skirt] + stripes

    # --- mine roller pushed ahead of the tracks on an arm ----------------------------
    # A studded steel drum that rolls over the ground in front: from the side a toothed
    # wheel, which the tracks' plain road wheels are not.
    rc_x, rc_z, rc_r = 24, 5.9, 4.3
    spin = rc.add_empty('roller_spin', (px(rc_x), px(-9), px(rc_z)))
    drums = [rc.add_cylinder(f'roller_{k}', px(rc_r), px(3.2), (px(rc_x), px(y), px(rc_z)), mats['steel'], vertices=24)
             for k, y in enumerate((-9.5, 6.5))]
    studs = []
    for k in range(6):
        a = math.radians(k * 60 + 30)
        c = (rc_x + (rc_r + 0.6) * math.cos(a), -10.2, rc_z + (rc_r + 0.6) * math.sin(a))
        stud = rc.add_box(f'stud_{k}', (px(2.6), px(2.2), px(2.4)), tuple(px(v) for v in c), mats['rubber'])
        stud.rotation_euler = (0, -a, 0)
        studs.append(stud)
    cap = rc.add_cylinder('arm_cap', px(2.1), px(1.2), (px(rc_x), px(-11.6), px(rc_z)), mats['orange'], vertices=12)
    for o in drums + studs:
        rc.parent_keep(o, spin)
    rc.parent_keep(spin, chassis)
    arm = wy.tube('arm_near', [(7, -11, 12), (15, -11.4, 8.5), (rc_x, -11.4, rc_z)], (1.6, 1.4, 1.3), mats['orange'])
    pin = rc.add_cylinder('arm_pin', px(1.7), px(1.4), (px(7), px(-11.6), px(12)), mats['steel'], vertices=12)
    rig['roller'] = spin
    plough_parts = [arm, pin, cap] + drums + studs

    # --- hopper, heaped with disc mines, and the rear drop chute --------------------
    hopper = prism('hopper', [(-15.5, 18), (-6.5, 18), (-3.5, 29), (-20, 29)], -7, 7, mats['steel'], bevel=0.8)
    rim = prism('rim_hopper', [(-21, 28), (-2.8, 28), (-2.8, 30.2), (-21, 30.2)], -7.6, 7.6, mats['orange'], bevel=0.6)
    ribs = []
    drop = wy.tube('drop_chute', [(-15, 0, 20), (-20, -1, 15), (-23.5, -1, 9)], (2.8, 2.6, 2.4), mats['steel'])
    drop_lip = rc.add_cylinder('drop_lip', px(2.9), px(1.4), (px(-23.7), px(-1), px(8.4)), mats['orange'], axis='Z', vertices=14)
    mines, mine_parts = [], []
    for k, (at, tilt) in enumerate(((( -16.5, -2, 31.8), (-40, 14)), ((-8.5, -3, 32.2), (-44, -12)),
                                    ((-13, 1, 35.8), (-38, 4)))):
        grp, objs = disc_mine(k, at, mats, tilt)
        rc.parent_keep(grp, chassis)
        mines.append(grp)
        mine_parts += objs
    rig['mines'] = mines
    rig['mine_parts'] = mine_parts

    # --- head: amber dome in a hard hat with a headlamp, goggles on a strap ----------
    head_c = Vector((px(4), 0, px(18)))
    head_grp = rc.add_empty('head_grp', head_c)
    head = dome_band('head', head_c, (11.5, 10, 14), 18.5, 27, mats['amber'])
    hat = dome_band('hat', head_c, (12, 10.5, 14.5), 27, 40, mats['amber'])
    brim = rc.add_sphere('brim', px(1), (px(6.5), 0, px(27)), mats['amber'], scale=(14, 11.8, 1.0), segments=32, rings=8)
    strap = dome_band('strap', head_c, (11.9, 10.4, 14.4), 21.4, 24.6, mats['rubber'])
    eyes, face = [], []
    for k, ex in enumerate((2.0, 10.0)):
        goggle = rc.add_cylinder(f'goggle_{k}', px(4.4), px(1.6), (px(ex), px(-9.4), px(23)), mats['steel'], vertices=18)
        eye = rc.add_cylinder(f'eye_{k}', px(3.4), px(0.8), (px(ex), px(-10.4), px(23)), mats['eye'], vertices=16, smooth=False)
        pupil = rc.add_cylinder(f'pupil_{k}', px(1.6), px(0.8), (px(ex + 1.2), px(-10.9), px(22.6)), mats['ink'], vertices=10, smooth=False)
        rc.parent_keep(pupil, eye)
        eyes.append(eye)
        face += [goggle, eye, pupil]
    housing = rc.add_cylinder('housing', px(2.3), px(2.6), (px(13.8), px(-3.5), px(30.2)), mats['steel'], axis='X', vertices=14)
    housing.rotation_euler = (0, math.radians(-15), math.radians(-60))
    lens = rc.add_cylinder('lens', px(1.7), px(0.6), (px(14.5), px(-5.8), px(30.5)), mats['lamp'], axis='X', vertices=12, smooth=False)
    lens.rotation_euler = (0, math.radians(-15), math.radians(-60))
    rig['eyes'] = eyes
    rig['lens'] = lens
    head_parts = [head, hat, brim, strap, housing, lens] + [o for o in face if not o.name.startswith('pupil')]
    for o in head_parts:
        rc.parent_keep(o, head_grp)
    rc.parent_keep(head_grp, chassis)
    rig['head_grp'] = head_grp

    hopper_parts = [hopper, rim] + ribs
    fixed = hull_parts + plough_parts + [drop, drop_lip]
    for o in fixed + hopper_parts:
        if o.parent is None:
            rc.parent_keep(o, chassis)
    body.extend(fixed + hopper_parts + mine_parts + [head, hat, brim, strap, housing, lens] + face)
    rig['hopper'] = hopper_parts
    rig['chassis'] = chassis

    # --- the launcher: barrel layer, a bell-mouthed tube -----------------------------
    pivot_z = proj.z_for_height(PIVOT_UP) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT_DX), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    collar = rc.add_sphere('collar', px(3.8), pivot_w, mats['steel'], segments=16, rings=8)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    L, z = BARREL_LENGTH, pivot_z
    chute = wy.tube('chute', [(PIVOT_DX + 1, 0, z), (PIVOT_DX + 8, 0, z)], (2.8, 2.6), mats['steel'])
    bell = wy.tube('bell', [(PIVOT_DX + 8, 0, z), (PIVOT_DX + 11, 0, z), (PIVOT_DX + L, 0, z)], (2.7, 3.2, 4.4), mats['steel'])
    ring = rc.add_cylinder('ring', px(3.3), px(2.2), pivot_w + Vector((px(5.5), 0, 0)), mats['orange'], axis='X', vertices=16)
    bore = rc.add_cylinder('bore', px(3.4), px(0.6), pivot_w + Vector((px(L - 0.1), 0, 0)), mats['rubber'], axis='X', vertices=14, smooth=False)
    for o in (chute, bell, ring, bore):
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    rc.parent_keep(collar, pivot)
    barrel.extend((collar, chute, bell, ring, bore))
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(L + 3.5), px(-6), 0)), 4.5, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig['pivot'] = pivot
    rig['tube_grp'] = tube_grp

    # --- death props (body layer) -------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-13), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    bits = [rc.add_box(f'wreck_bit_{k}', (px(3.4), px(3), px(2.6)), (0, px(-13), 0), mats[m], bevel=px(0.5))
            for k, m in enumerate(('orange', 'steel', 'amber'))]
    for o in smoke + bits:
        o.visible_shadow = False
        rc.parent_keep(o, root)
        body.append(o)
    rig['boom'] = rc.add_fire('boom', mats, (px(-6), px(-15), px(26)), 16, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(-10), px(-13), px(18)), 6.2, root)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(4), px(-13), px(18)), 4.4, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])
    rig['smoke'] = smoke
    rig['bits'] = bits

    rig['layers'] = {'body': body, 'barrel': barrel}
    bpy.context.view_layer.update()
    rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy())
                   for o in [chassis, head_grp, tube_grp, rig['roller']] + rig['hopper'] + mines}
    return rig


# --------------------------------------------------------------------------
# Poses. Whole pixels for everything that carries the launcher.
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    chassis, head, tube = rig['chassis'], rig['head_grp'], rig['tube_grp']
    for name, (loc, rot) in rig['rest'].items():
        o = bpy.data.objects[name]
        o.location = loc.copy()
        o.rotation_euler = rot.copy()
    parts.pose_tracks(rig['tracks'], 0)
    rig['lens'].data.materials[0] = mats['lamp']
    for e in rig['eyes']:
        e.scale = (1, 1, 1)
        e.data.materials[0] = mats['eye']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['mine_parts'], False)
    rc.hide(rig['bits'], True)
    rc.hide(rig['smoke'], True)
    for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.set_burnt(mats, palette, False, hues=HUES)

    def jiggle(offsets):
        for mine, dz in zip(rig['mines'], offsets):
            mine.location.z += px(dz)

    if state == 'idle':
        chassis.location.z += px((0, -1, -1, 0)[i])
        head.location.z += px((0, 0, -1, -1)[i])          # the head settles a frame late
        if i >= 2:
            rig['lens'].data.materials[0] = mats['steel']  # the headlamp blinks

    elif state == 'move':
        n = STATES['move'][0]
        parts.pose_tracks(rig['tracks'], i / n)
        rig['roller'].rotation_euler.y = math.radians(60 * i / n)   # one stud per loop
        chassis.location.z += px((0, -1, -1, 0, -1, -1)[i])
        head.location.z += px((0, 1, 0, 0, 1, 0)[i])
        jiggle(((0, 1, 0), (1, 0, 1), (0, 0, 1), (1, 0, 0), (0, 1, 1), (0, 0, 0))[i])

    elif state == 'charge':
        # Held while the player charges: the mines rattle in the hopper, the tube hauls back.
        chassis.location.z += px(-1)
        head.location.z += px((0, 1)[i])
        tube.location.x += px((-2, -3)[i])
        jiggle(((2, 0, 1), (0, 2, 0))[i])
        for e in rig['eyes']:
            e.scale = (1, 1, 0.5)
        if i == 1:
            rig['lens'].data.materials[0] = mats['steel']

    elif state == 'fire':
        tube.location.x += px((-4, -3, -2, -1, 0)[i])
        chassis.location.x += px((-1, -1, 0, 0, 0)[i])
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        jiggle(((2, 1, 2), (1, 2, 1), (0, 1, 0), (0, 0, 0), (0, 0, 0))[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        chassis.location.x += px((-2, 1, 0)[i])
        head.location.x += px((-1, 1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        jiggle(((2, 3, 2), (1, 0, 1), (0, 0, 0))[i])
        for e in rig['eyes']:
            e.scale = (1, 1, (0.3, 0.3, 0.65)[i])

    elif state == 'death':
        # The mines cook off: flash, fireball, the head is blown forwards off the hull
        # and rolls to a stop on the ground, the emptied hopper is knocked back.
        t = i - 2
        if i == 0:
            chassis.location.z += px(1)
            rc.pose_fire(rig['boom'], 0.42)
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.set_burnt(mats, palette, True, hues=HUES)
            rig['lens'].data.materials[0] = mats['rubber']
            for e in rig['eyes']:
                e.data.materials[0] = mats['rubber']      # lights out
            rc.hide(rig['layers']['barrel'], True)
            rc.hide(rig['mine_parts'], True)
            chassis.location.z += px((-1, -2, -2, -2, -2)[t])
            head.location.x += px((4, 9, 13, 15, 15)[t])
            head.location.y -= px((4, 9, 14, 14, 14)[t])      # in front of the track, or it lands out of sight
            head.location.z += px((9, 10, 1, -3, -4)[t])
            head.rotation_euler.y = math.radians((25, 60, 85, 100, 96)[t])
            for o in rig['hopper']:
                o.location.x += px((-1, -3, -4, -4, -4)[t])
                o.location.z += px((2, 1, -1, -2, -2)[t])
            rc.pose_fire(rig['boom'], (0.78, 0.4, 0, 0, 0)[t])
            rc.pose_fire(rig['fire_a'], (0.6, 1.0, 1.1, 0.9, 1.0)[t], lean_deg=(0, -8, 7, -6, 5)[t])
            rc.pose_fire(rig['fire_b'], (0, 0.6, 0.95, 1.0, 0.8)[t], lean_deg=(0, 6, -8, 7, -5)[t])
            rc.hide(rig['bits'], False)
            for bit, (x0, vx, vz) in zip(rig['bits'], ((-8, -5, 8), (-2, -2.5, 12), (2, 3, 10))):
                tt = t + 1
                bit.location.x = px(x0 + vx * min(tt, 4))
                bit.location.z = px(max(1.3, 22 + vz * tt - 2.6 * tt * tt))
                bit.rotation_euler = (0, math.radians(50 * tt if bit.location.z > px(1.4) else 0), 0)
            rc.hide(rig['smoke'], t < 1)
            for s, (sx, sz, k) in zip(rig['smoke'], ((-11, 33, 1.0), (-15, 40, 0.7))):
                rise = (0, 0, 3, 6, 8)[t]
                grow = k * (0, 0.7, 1.0, 1.0, 0.9)[t]
                s.location = (px(sx - rise * 0.5), px(-13), px(sz + rise * 0.6))
                s.scale = (grow, grow, grow)


if __name__ == '__main__':
    rc.run_mobile(
        name='sapper', canvas=(84, 68), anchor=(40, 61), near_y=px(-HALF_WIDTH),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('orange', 'amber', 'steel', 'rubber', 'accent', 'char', 'smoke', 'eye', 'lamp', 'flame', 'flash', 'ink'),
        build=build_sapper, pose=pose)
