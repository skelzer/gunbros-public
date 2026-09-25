"""
Gravity engine mech (the roster's `jd`): model, poses, layered renders.

    blender --background --python build_mobile_vortex.py -- --out work/vortex --scale 4

The chibi mech body (boots, stub legs, round torso, dome head with an amber visor) is a
copy of chibi_mech.py's build, changed where the vortex needs it. What makes it a vortex:

- a gyro ring hovering round its back, tilted so the side view shows an open ellipse,
  with two glowing orbs riding it that orbit in idle, on the move and faster on charge;
- a gravity well in the chest: a dark dish in a violet rim with three spiral vanes
  round a bright core, which turns;
- a swept violet crest fin on the dome and a gyro ear on the near side of the head;
- a steel belt that splits the torso into chest and hips;
- a coil cannon: a short tube through a violet coil into a flared emitter bell.

The death implodes the ring before the head is blown off.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402  (bezier `tube`; its main code is guarded)
import chibi_mech as cm  # noqa: E402  (constants and primitives only; the build is copied below)
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

BARREL_LENGTH = 8
PIVOT = (14, 16)
FLASH = 5.5
HUES = ('blue', 'amber', 'violet')

NEAR_Y, BOOT_Y, HIP_Z, STAND = cm.NEAR_Y, cm.BOOT_Y, cm.HIP_Z, cm.STAND
HEAD_C, HEAD_R = cm.HEAD_C, cm.HEAD_R
STATES = cm.STATES

# Prefix match, first wins: chest_vane before chest. The barrel's flash shares its number
# with the body's fire, as glow groups are matched by number across layers.
PART_GROUPS = (
    ('boot_far', 1), ('leg_far', 2), ('pack', 3), ('ring', 4), ('boot_near', 5), ('leg_near', 6),
    ('torso', 7), ('belt', 8), ('chest_vane', 10), ('chest', 9), ('core', 11), ('head', 12), ('visor', 13),
    ('eye', 14), ('top', 15), ('earcap', 17), ('ear', 16), ('orb', 18),
    ('smoke', 19), ('boom', 20), ('fire', 21),
    ('hinge', 1), ('arm', 2), ('coil', 3), ('muzzle', 4), ('bore', 6), ('flash', 21),
)

# The gyro ring: centre (x, z), radius, and the turn about z that opens it towards the camera.
RING_C = (-17, 23)
RING_R = 11
RING_TURN = 50


def ring_point(phi_deg, r=RING_R):
    """World offset (x, y, z) in pixels of a point on the gyro ring at angle phi."""
    a, t = math.radians(phi_deg), math.radians(RING_TURN)
    u = r * math.cos(a)
    return (u * math.sin(t), u * math.cos(t), r * math.sin(a))


def spiral(name, phase_deg, y, centre, material):
    """One vane of the chest vortex: an arc that winds outwards from the core."""
    cx, cz = centre
    pts, radii = [], []
    for k in range(5):
        t = k / 4
        a = math.radians(phase_deg + 115 * t)
        r = 1.6 + 3.0 * t
        pts.append((cx + r * math.cos(a), y, cz + r * math.sin(a)))
        radii.append(0.55 + 0.45 * t)
    return wy.tube(name, pts, radii, material, squash=0.6)


def build(mats, proj):
    body, barrel = [], []
    rig = {}
    hue = mats['blue']
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
    rc.parent_keep(chassis, root)

    def on(obj, parent):
        rc.parent_keep(obj, parent)
        body.append(obj)
        return obj

    # --- boots and legs (as chibi_mech) ---------------------------------------------
    legs = {}
    for side, y in (('far', BOOT_Y), ('near', -BOOT_Y)):
        boot = rc.add_box(f'boot_{side}', (px(14), px(8), px(7)), (px(1.5), px(y), px(3.5)), mats['rubber'], bevel=px(2.0))
        cap = rc.add_box(f'boot_{side}_cap', (px(5), px(8.7), px(4.2)), (px(7), px(y), px(2.7)), mats['steel'], bevel=px(1.0))
        rc.set_origin(boot, (0, px(y), 0))
        rc.parent_keep(cap, boot)
        leg = rc.add_cylinder(f'leg_{side}', px(2.8), px(8), (px(4), 0, 0), hue, axis='X', vertices=12)
        rc.set_origin(leg, (0, 0, 0))
        for o in (boot, leg):
            rc.parent_keep(o, root)
        body.extend((boot, cap, leg))
        legs[side] = {'boot': boot, 'leg': leg, 'y': y}
    rig['legs'] = legs

    # --- torso, belt and the chest vortex -------------------------------------------------
    torso = on(rc.add_sphere('torso', px(1), (0, 0, px(18)), hue, scale=(13, 10, 8.5), segments=24, rings=12), chassis)
    belt = cm.add_ring('belt', px(10.2), px(1.3), (0, 0, px(12.2)), mats['steel'], facing='Z')
    belt.scale = (1.2, 1, 1)
    on(belt, chassis)

    wc = (-1.5, 18.5)
    well = on(rc.add_cylinder('chest_well', px(4.6), px(0.8), (px(wc[0]), px(-9.9), px(wc[1])), mats['ink'], vertices=20, smooth=False), chassis)
    rim = on(cm.add_ring('chest_rim', px(5.2), px(1.25), (px(wc[0]), px(-9.7), px(wc[1])), mats['violet']), chassis)
    spin = rc.add_empty('chest_spin', (px(wc[0]), px(-10.6), px(wc[1])))
    rc.parent_keep(spin, chassis)
    vanes = [on(spiral(f'chest_vane_{k}', 120 * k, -10.5, wc, mats['violet']), spin) for k in range(3)]
    core = on(rc.add_cylinder('core', px(1.7), px(0.8), (px(wc[0]), px(-11.0), px(wc[1])), mats['eye'], vertices=12, smooth=False), chassis)

    # --- the gyro pack: a hub on the back inside a tilted ring with two orbs ---------------
    rx, rz = RING_C
    hub = on(rc.add_cylinder('pack_hub', px(4.4), px(9), (px(-15.5), 0, px(rz)), mats['steel'], vertices=20), chassis)
    hub.modifiers.new('Bevel', 'BEVEL').width = px(1.0)
    strut = on(rc.add_box('pack_strut', (px(8), px(5), px(3.4)), (px(-10.5), 0, px(rz)), mats['steel'], bevel=px(0.8)), chassis)
    lamp = on(rc.add_cylinder('core_pack', px(1.8), px(0.8), (px(-15.5), px(-4.7), px(rz)), mats['lamp'], vertices=12, smooth=False), chassis)
    gyro = rc.add_empty('ring_grp', (px(rx), 0, px(rz)))
    rc.parent_keep(gyro, chassis)
    ring = cm.add_ring('ring_gyro', px(RING_R), px(1.4), (px(rx), 0, px(rz)), mats['violet'], facing='X')
    ring.rotation_euler = (0, 0, math.radians(-RING_TURN))
    on(ring, gyro)
    orbs = [on(rc.add_sphere(f'orb_{k}', px(2.3), (px(rx), 0, px(rz)), mats['lamp'], segments=12, rings=6), gyro)
            for k in range(2)]

    # --- head ------------------------------------------------------------------------
    hx = HEAD_C[0]
    head_grp = rc.add_empty('head_grp', (px(hx), 0, px(HEAD_C[2])))
    head_c = (px(hx), 0, px(HEAD_C[2]))
    head = rc.add_sphere('head', px(1), head_c, hue, scale=HEAD_R, segments=32, rings=16)
    visor = rc.add_sphere('visor', px(1), head_c, mats['amber'], scale=tuple(r + 0.7 for r in HEAD_R), segments=32, rings=16)
    band = rc.add_box('cut_visor_band', (px(18), px(13), px(7.6)), (px(hx + 5.5), px(-6.5), px(30.6)), mats['amber'])
    mod = visor.modifiers.new('Band', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = band
    band.hide_render = True
    band.hide_viewport = True
    rc.parent_keep(band, visor)
    eyes = [rc.add_cylinder(f'eye_{k}', px(2.5), px(0.8), (px(hx + ex), px(-11.6), px(30.6)), mats['eye'], vertices=12, smooth=False)
            for k, ex in enumerate((1.5, 8.0))]
    # A crest fin swept back over the dome, flattened across y.
    fin = wy.tube('top_fin', [(5, 0, 41.2), (-1, 0, 44.8), (-8, 0, 45.2), (-14, 0, 42.0)], (1.6, 2.6, 2.0, 0.3), mats['violet'], squash=0.45)
    # A gyro ear on the near side of the dome, behind the visor.
    ear = rc.add_cylinder('ear', px(3.6), px(2.4), (px(-5), px(-10.2), px(30)), mats['steel'], vertices=18)
    earcap = rc.add_cylinder('earcap', px(1.6), px(0.8), (px(-5), px(-11.6), px(30)), mats['violet'], vertices=12, smooth=False)
    for o in [head, visor, fin, ear, earcap] + eyes:
        on(o, head_grp)
    rc.parent_keep(head_grp, chassis)

    # --- the coil cannon: barrel layer ---------------------------------------------------
    pivot_z = proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT[0]), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    rc.parent_keep(tube_grp, pivot)
    hinge = rc.add_sphere('hinge', px(3.3), pivot_w, mats['steel'], segments=14, rings=8)
    rc.parent_keep(hinge, pivot)
    barrel.append(hinge)

    def gun(obj):
        rc.parent_keep(obj, tube_grp)
        barrel.append(obj)
        return obj

    def at(dx):
        return pivot_w + Vector((px(dx), 0, 0))

    gun(rc.add_cylinder('arm_tube', px(2.4), px(6), at(3), mats['steel'], axis='X', vertices=16))
    gun(cm.add_ring('coil', px(2.8), px(1.0), at(2.6), mats['violet'], facing='X'))
    gun(cm.add_cone('muzzle_bell', px(2.5), px(4.4), px(3.6), at(BARREL_LENGTH - 1.8), mats['steel'], axis='X', vertices=18))
    gun(rc.add_cylinder('bore', px(3.4), px(0.5), at(BARREL_LENGTH), mats['ink'], axis='X', vertices=14, smooth=False))
    muzzle = pivot_w + Vector((px(BARREL_LENGTH + FLASH * 0.7), px(-8), 0))
    rig['flash'] = rc.add_fire('flash', mats, muzzle, FLASH, pivot, tall=1)
    barrel.extend(rig['flash'])

    # --- death props -----------------------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-14), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    for o in smoke:
        o.visible_shadow = False
        on(o, root)
    rig['boom'] = rc.add_fire('boom', mats, (px(1), px(-15), px(24)), 15, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(1), px(-14), px(24)), 5.6, root)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(-8), px(-14), px(16)), 4.0, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])

    rig.update(chassis=chassis, head_grp=head_grp, eyes=eyes, pivot=pivot, tube_grp=tube_grp, smoke=smoke,
               spin=spin, core=core, lamp=lamp, gyro=gyro, ring=ring, orbs=orbs)
    rig['layers'] = {'body': body, 'barrel': barrel}
    bpy.context.view_layer.update()
    movers = [chassis, head_grp, tube_grp, spin, gyro]
    rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in movers}
    return rig


def pose(rig, mats, palette, state, i):
    chassis, head, tube = rig['chassis'], rig['head_grp'], rig['tube_grp']
    for name, (loc, rot, scale) in rig['rest'].items():
        o = bpy.data.objects[name]
        o.location, o.rotation_euler, o.scale = loc.copy(), rot.copy(), scale.copy()
    for e in rig['eyes']:
        e.scale = (1, 1, 1)
        e.data.materials[0] = mats['eye']
    rig['core'].data.materials[0] = mats['eye']
    rig['lamp'].data.materials[0] = mats['lamp']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['smoke'], True)
    rc.hide([rig['ring']] + rig['orbs'], False)
    for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.set_burnt(mats, palette, False, hues=HUES)

    feet = {side: (x, 0) for side, x in STAND.items()}
    dx = dz = 0
    orbit = 0.0              # where the orbs ride on the gyro ring, degrees
    swirl = 0.0              # turn of the chest vanes, degrees (they repeat every 120)

    def lids(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])      # the head settles a frame late
        orbit, swirl = 30 * i, -40 * i
        if i == 4:
            lids(0.15)

    elif state == 'move':
        n = STATES['move'][0]
        feet = {'near': parts.walk_foot(i / n, 3, 3), 'far': parts.walk_foot(i / n + 0.5, 3, 3)}
        feet = {side: (x + STAND[side] // 2, z) for side, (x, z) in feet.items()}
        dz = (-1, 0, 0)[i % 3]
        head.location.z += px((0, -1, 0)[i % 3])
        orbit, swirl = 30 * i, -40 * i

    elif state == 'charge':
        # The engine spins up: the orbs whip round a tighter ring, the core goes white.
        dz = (-1, -2)[i]
        tube.location.x += px((-2, -3)[i])
        head.location.x += px((0, -1)[i])
        lids(0.5)
        orbit, swirl = (45, 135)[i], (0, -60)[i]
        rig['gyro'].scale = (0.9, 0.9, 0.9)
        rig['core'].data.materials[0] = mats['flash']
        rig['lamp'].data.materials[0] = mats['flash']

    elif state == 'fire':
        tube.location.x += px((-3, -3, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        lids((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])
        orbit, swirl = (150, 170, 180, 180, 180)[i], (-80, -100, -120, -120, -120)[i]
        if i < 2:
            rig['core'].data.materials[0] = mats['flash']

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        lids((0.3, 0.3, 0.7)[i])
        orbit = (20, 10, 0)[i]

    elif state == 'death':
        # Flash and the gravity ring implodes into the core; fireball; the big head is
        # blown off backwards and rolls to rest in front of the boots; the torso sags
        # and burns from the neck.
        t = i - 2
        if i == 0:
            dz = 1
            rc.pose_fire(rig['boom'], 0.42)
            rig['gyro'].scale = (0.55, 0.55, 0.55)
            orbit = 90
            rig['core'].data.materials[0] = mats['flash']
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
            rc.hide([rig['ring']] + rig['orbs'], True)
        else:
            rc.hide([rig['ring']] + rig['orbs'], True)
            rc.set_burnt(mats, palette, True, hues=HUES)
            for e in rig['eyes']:
                e.data.materials[0] = mats['ink']
            rig['core'].data.materials[0] = mats['ink']
            rig['lamp'].data.materials[0] = mats['ink']
            rc.hide(rig['layers']['barrel'], True)
            dz = (-1, -3, -4, -4, -4)[t]
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

    # Orbs ride the ring, one on each side of it.
    for k, orb in enumerate(rig['orbs']):
        ox, oy, oz = ring_point(orbit + 180 * k + 60)
        orb.location = (px(RING_C[0] + ox), px(oy), px(RING_C[1] + oz))
    rig['spin'].rotation_euler.y = math.radians(swirl)

    chassis.location.x += px(dx)
    chassis.location.z += px(dz)
    for side, leg in rig['legs'].items():
        fx, fz = feet[side]
        fz += parts.plant_z(leg['y'], rig['legs']['near']['y']) + cm.BOOT_SINK   # soles on the ground row; the far one sinks for the tilt
        leg['boot'].location = (px(fx), px(leg['y']), px(fz))
        parts.aim(leg['leg'], (dx + (1 if side == 'near' else -1), HIP_Z + dz + 1), (fx, fz + 5), leg['y'])


if __name__ == '__main__':
    rc.run_mobile(
        name='vortex', canvas=cm.CANVAS, anchor=cm.ANCHOR, near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('blue', 'amber', 'violet', 'steel', 'rubber', 'smoke', 'eye', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
