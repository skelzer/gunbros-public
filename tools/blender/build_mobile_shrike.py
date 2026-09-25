"""
Raptor-headed drone walker (the roster's `kalsiddon`): model, poses, layered renders.

    blender --background --python build_mobile_shrike.py -- --out work/shrike --scale 4

A mechanical shrike, the butcher bird: a steel blue bird body with an armoured steel
breast cut into plates, folded wings of four long primaries under a covert plate
swept back along the flank (the far one peeks over the back), a long three feather tail
as counterweight, and an S neck up to a gold raptor head with the shrike's dark bandit
mask, a glowing cyan eye under a scowling brow, a hooked steel beak with a lower
mandible that opens to screech, and three red crest blades swept back like horns.
Two reverse-jointed legs with drumstick thighs, steel shins and taloned feet, a little
cyan drone perched on the back, and a three tube rocket pod slung under the chest. The
pod is the `barrel` layer, modelled horizontal.

Wings, tail, neck, beak, crest, limbs and toes use the wyvern's helpers (bezier tubes
with tapered bevels, fan membranes, sliced plates). Legs use parts.two_bone_ik with the
knee bending backwards; feet move in whole pixels. All sizes are sprite pixels at 1x.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import creature as cr  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

# Contract with the simulation (packages/shared, kalsiddon sprite): pivot 15 px ahead of
# and 25 px above the anchor, muzzle 12 px along the pod.
PIVOT_DX = 15
PIVOT_UP = 25
BARREL_LENGTH = 12

NEAR_Y = -11
LEG_Y = 6.5
HIP = (1, 22)            # x, z of both hips at rest; low, so the knees fold well back
ANKLE_Z = 4
THIGH = 11.0
SHIN = 12.5
STAND = {'near': 6, 'far': -3}
TOE_REACH = 11.3         # pad origin to the tip of the long front talon
HEEL_UP = 2.5            # the rear foot at rest rolls on to its talons, heel this far up

STATES = {
    'idle': (6, 10, True),
    'move': (8, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 5, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}

# First prefix match wins. Glow groups are matched by number across layers, so the
# barrel's flash shares 21 with the body's fire.
PART_GROUPS = (
    ('wingfar', 1), ('footfar', 2), ('legfar', 3), ('tailb', 4), ('taila', 5), ('torso', 6),
    ('platea', 7), ('plateb', 8), ('quill', 9), ('neck', 10), ('jaw', 11), ('head', 12), ('brow', 13),
    ('beak', 14), ('mask', 15), ('eye', 16), ('smoke', 17), ('crest', 18), ('footnear', 19),
    ('legnear', 20), ('fire', 21), ('boom', 22), ('wing', 23), ('covert', 24), ('drone', 25), ('wreck', 26),
    ('hinge', 1), ('pod_tube_a', 2), ('pod_tube_b', 3), ('pod_tip', 4), ('pod_band', 5), ('flash', 21),
)
HUES = ('blue', 'amber')


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build_leg(side, y, mats, root, body):
    """Thigh and shin are tubes along +X from their origin, ready for parts.aim. The
    foot is a pad with two forward talons and a hallux, origin on the ground."""
    tag = 'legnear' if side == 'near' else 'legfar'
    ftag = 'footnear' if side == 'near' else 'footfar'
    thigh = wy.tube(f'{tag}_thigh', [(0, 0, 0), (5, 0, 0), (THIGH, 0, 0)], (4.2, 3.6, 2.3), mats['blue'])
    shin = wy.tube(f'{tag}_shin', [(0, 0, 0), (6, 0, 0), (SHIN, 0, 0)], (2.1, 1.6, 1.8), mats['steel'])
    knee = rc.add_sphere(f'{tag}_knee', px(2.9), (0, 0, 0), mats['steel'], segments=14, rings=7)
    pad = cr.blob(f'{ftag}_pad', (0, 0, 2.4), (3.0, 2.4, 2.4), mats['steel'], 16, 8)
    toes = [
        wy.tube(f'{ftag}_toe_0', [(0, -1.2, 2.2), (4.5, -1.2, 1.6), (8, -1.2, 1.4)], (1.9, 1.5, 1.2), mats['steel']),
        wy.tube(f'{ftag}_toe_1', [(0, 1.2, 2.4), (3.5, 1.2, 2.0), (6, 1.2, 1.6)], (1.7, 1.3, 1.1), mats['steel']),
        wy.tube(f'{ftag}_claw_0', [(7.5, -1.2, 1.8), (10, -1.2, 1.6), (11.3, -1.2, 0.2)], (1.2, 0.8, 0.1), mats['amber']),
        wy.tube(f'{ftag}_claw_1', [(5.5, 1.2, 2.0), (7.8, 1.2, 1.8), (8.8, 1.2, 0.4)], (1.1, 0.7, 0.1), mats['amber']),
        wy.tube(f'{ftag}_hallux', [(-1, 0, 2.2), (-4, 0, 1.6), (-5.6, 0, 0.3)], (1.3, 0.9, 0.1), mats['amber']),
    ]
    for t in toes:
        rc.parent_keep(t, pad)
    for o in (pad, thigh, shin, knee):
        rc.parent_keep(o, root)
    body.extend([pad, thigh, shin, knee] + toes)
    return {'y': y, 'foot': pad, 'thigh': thigh, 'shin': shin, 'knee': knee}


def build_wing(side, y, mats, parent):
    """
    A folded bird wing hinged at the shoulder: four long primaries swept back along the
    flank, each a flat tapered tube in alternating part groups so the id pass draws a
    clean line between feathers, under a covert plate that hides their roots. In the
    wing's own (x, z), relative to the shoulder.
    """
    near = side == 'near'
    sx, sz = (4, 37)
    feathers = (
        ([(0, 1), (-10, 1.5), (-19, -2)], (2.4, 2.6, 0.5)),
        ([(0, -1.5), (-8.5, -2.8), (-16, -6.5)], (2.4, 2.5, 0.5)),
        ([(0, -4), (-6, -5.8), (-12, -10)], (2.3, 2.3, 0.5)),
        ([(0, -6), (-4, -7.8), (-8.5, -12)], (2.0, 2.0, 0.5)),
    )
    out = []
    for k, (pts, rad) in enumerate(feathers):
        tag = ('wing' if k % 2 == 0 else 'quill') if near else 'wingfar'
        fy = y - 0.5 * k
        out.append(wy.tube(f'{tag}_f{side}{k}', [(sx + a, fy, sz + b) for a, b in pts], rad, mats['blue'], squash=0.3))
    covert = [(2.5, 2.5), (-5, 3.6), (-10, 2.2), (-8, -2), (-3, -5.5), (2, -5), (2.5, 2.5)]
    cov = wy.membrane('covert' if near else 'wingfar_covert', (sx - 3, sz - 1), [(sx + a, sz + b) for a, b in covert],
                      y - 2.4, mats['blue'], bulge=0.15)
    out.append(cov)
    hinge = rc.add_empty(f'shoulder_{side}', (px(sx), px(y), px(sz)))
    for o in out:
        rc.parent_keep(o, hinge)
    rc.parent_keep(hinge, parent)
    return hinge, out


def build_shrike(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (px(HIP[0]), 0, px(HIP[1])))     # turns about the hips
    rc.parent_keep(chassis, root)

    legs = {'far': build_leg('far', LEG_Y, mats, root, body), 'near': build_leg('near', -LEG_Y, mats, root, body)}
    rig['legs'] = legs

    # --- body: an egg of a chest, a rump tapering into the tail, an armoured breast ------
    chest = cr.blob('torso_chest', (5, 0, 30.5), (8.5, 7.8, 8.2), mats['blue'], 32, 16)
    chest.rotation_euler = (0, math.radians(-15), 0)
    rump = wy.tube('torso_rump', [(3, 0, 31), (-6, 0, 31.5), (-12.5, 0, 30)], (7.6, 6.4, 3.6), mats['blue'], squash=0.95)
    breast = wy.sliced('breast', (7, -1.5, 28.5), (6, 7.2, 7.4), -35,
                       [(-6.3, 2.9), (-3.4, 2.9), (-0.5, 2.9), (2.4, 2.9), (5.3, 2.9)],
                       mats['steel'], ('platea', 'plateb'))
    neck = wy.tube('neck', [(4, 0, 33), (9, 0, 38.5), (12, 0, 43)], (5.2, 4.2, 3.8), mats['blue'], squash=0.95)
    strut = rc.add_box('platea_strut', (px(8), px(4), px(3.4)), (px(11.5), 0, px(25.5)), mats['steel'], bevel=px(0.8))

    # Tail: three long flat feathers fanned behind the rump, on a hinge so it can flick.
    tail_grp = rc.add_empty('tail_grp', (px(-10), 0, px(30)))
    tail = [
        wy.tube('taila_0', [(-9, 1.6, 32), (-18, 1.6, 32.5), (-28, 1.6, 32.5)], (2.0, 2.3, 1.1), mats['blue'], squash=0.35),
        wy.tube('tailb_1', [(-9, 0, 31), (-19, 0, 29.5), (-32, 0, 28.5)], (2.3, 2.7, 1.3), mats['blue'], squash=0.35),
        wy.tube('taila_2', [(-9, -1.6, 30), (-18, -1.6, 27.5), (-27, -1.6, 24)], (2.2, 2.5, 1.2), mats['blue'], squash=0.35),
    ]
    for t in tail:
        rc.parent_keep(t, tail_grp)
    tail_grp.rotation_euler = (0, math.radians(-11), 0)   # held low, clear of the wing tips

    far_wing, far_parts = build_wing('far', 9.5, mats, chassis)
    near_wing, near_parts = build_wing('near', -9.5, mats, chassis)
    rig['wings'] = {'far': far_wing, 'near': near_wing}

    # --- head: gold, wedge shaped, with a bandit mask and a hooked beak -------------------
    head_grp = rc.add_empty('head_grp', (px(10), 0, px(40)))
    hc = (14.5, 0, 46.5)
    hr = (7.6, 6.3, 6.8)
    cranium = cr.blob('head', hc, hr, mats['amber'], 32, 16)
    cranium.rotation_euler = (0, math.radians(8), 0)
    cheek = cr.blob('head_cheek', (17, 0, 44), (5, 5, 3.6), mats['amber'], 16, 8)
    mask = cr.band('mask', hc, hr, 0.35, (13, 9, 2.6), (17, -5, 46.4), mats['ink'], tilt_deg=12)
    mask.rotation_euler = (0, math.radians(8), 0)
    eye = rc.add_cylinder('eye', px(2.3), px(0.8), (px(17), px(-6.5), px(46.6)), mats['cyan'], vertices=16, smooth=False)
    pupil = rc.add_box('eye_pupil', (px(1.2), px(0.8), px(2.8)), (px(17.7), px(-7.0), px(46.4)), mats['ink'])
    rc.parent_keep(pupil, eye)
    brow = wy.tube('brow', [(11.5, -4.4, 49.6), (16, -5.2, 50), (20, -4.2, 48.3)], (1.6, 1.8, 0.9), mats['amber'])
    beak = wy.tube('beak', [(18.5, 0, 47.3), (23.5, 0, 46.6), (26.8, 0, 44.4), (27.3, 0, 41.4)],
                   (3.5, 2.7, 1.5, 0.25), mats['steel'], squash=0.7)
    jaw = wy.tube('jaw', [(18, 0, 43.2), (22.5, 0, 42.6), (24.8, 0, 43.2)], (2.2, 1.5, 0.4), mats['steel'], squash=0.7)
    rc.set_origin(jaw, (px(18), 0, px(43.5)))          # hinges at the back of the bill
    crest = [wy.tube(f'crest_{k}', pts, rad, mats['accent']) for k, (pts, rad) in enumerate((
        ([(13, -1.3, 51.5), (8, -1.3, 55), (1.5, -1.3, 55.5)], (2.0, 1.3, 0.15)),
        ([(10.5, 0.4, 51.2), (5, 0.4, 53.2), (-1.5, 0.4, 51.8)], (1.8, 1.1, 0.15)),
        ([(8.5, 1.8, 49.8), (3.5, 1.8, 50), (-2.5, 1.8, 47.8)], (1.6, 1.0, 0.15)),
    ))]
    head_parts = [cranium, cheek, mask, eye, brow, beak, jaw] + crest
    for o in head_parts:
        rc.parent_keep(o, head_grp)

    # --- drone perched on the back --------------------------------------------------------
    dc = Vector((px(-6), px(-5), px(42.5)))
    drone = rc.add_sphere('drone', px(1), dc, mats['steel'], scale=(4.2, 3.4, 1.6), segments=16, rings=8)
    dome = rc.add_sphere('drone_dome', px(2.1), dc + Vector((px(0.5), 0, px(1.2))), mats['cyan'], segments=12, rings=6)
    rotors = [rc.add_cylinder(f'drone_rotor_{k}', px(2.3), px(0.6), dc + Vector((px(dx), 0, px(2.2))), mats['steel'],
                              axis='Z', vertices=12) for k, dx in enumerate((-4, 4))]
    for o in [dome] + rotors:
        rc.parent_keep(o, drone)
    rig['drone'] = drone

    for o in [chest, rump, neck, strut, tail_grp, head_grp, drone] + breast:
        rc.parent_keep(o, chassis)
    body.extend(far_parts + tail + [rump, chest] + breast + [neck, strut] + head_parts + [pupil]
                + [drone, dome] + rotors + near_parts)
    rig.update(chassis=chassis, head_grp=head_grp, jaw=jaw, eye=eye, tail_grp=tail_grp)

    # --- the pod: barrel layer ----------------------------------------------------------
    pivot_z = proj.z_for_height(PIVOT_UP) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT_DX), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    hinge = rc.add_sphere('hinge', px(3.2), pivot_w, mats['steel'], segments=14, rings=8)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    pod, tips = [], []
    for k, (dy, dz, tag) in enumerate(((2.3, -2.1, 'b'), (0, 2.0, 'b'), (-2.3, -2.1, 'a'))):
        c = pivot_w + Vector((px(BARREL_LENGTH / 2 - 2), px(dy), px(dz)))
        pod.append(rc.add_cylinder(f'pod_tube_{tag}{k}', px(2.4), px(BARREL_LENGTH + 1), c, mats['steel'], axis='X', vertices=16))
        tip = cr.cone(f'pod_tip_{k}', 1.8, 0.3, 3.0, (PIVOT_DX + BARREL_LENGTH - 0.5, dy, 0), mats['amber'], axis='X', vertices=12)
        tip.location.z = pivot_w.z + px(dz)
        tips.append(tip)
    pod.append(rc.add_box('pod_band_1', (px(2.2), px(10), px(9.8)), pivot_w + Vector((px(5), 0, 0)), mats['accent'], bevel=px(0.6)))
    pod.append(rc.add_box('pod_band_0', (px(2.0), px(9.6), px(9.4)), pivot_w + Vector((px(-2.5), 0, 0)), mats['steel'], bevel=px(0.6)))
    for o in pod + tips:
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    rc.parent_keep(hinge, pivot)
    barrel.extend([hinge] + pod + tips)
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH + 4.5), px(-8), 0)), 6, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp, tips=tips)

    # --- death props (body layer) ---------------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-14), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    wreck = rc.add_cylinder('wreck_pod', px(4.2), px(BARREL_LENGTH + 1), (0, px(-13), 0), mats['steel'], axis='X', vertices=16)
    for o in smoke + [wreck]:
        o.visible_shadow = False
        rc.parent_keep(o, root)
        body.append(o)
    rig['boom'] = rc.add_fire('boom', mats, (px(3), px(-15), px(31)), 15, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(-3), px(-14), px(20)), 5.6, root)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(8), px(-14), px(14)), 4.0, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])
    rig.update(smoke=smoke, wreck=wreck)

    rig['layers'] = {'body': body, 'barrel': barrel}
    rig['rest'] = cr.snapshot([chassis, head_grp, jaw, eye, tail_grp, tube_grp, drone, far_wing, near_wing, wreck] + tips)
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def pose_leg(leg, hip, foot_x, foot_z, heel=0.0):
    """Pose one leg with its foot pad at (foot_x, foot_z). `heel` rolls the foot on to its
    talons: the pad pitches forward about the talon tips, which stay at foot_z, and the
    heel comes up that many pixels. The ankle target follows the rolled pad."""
    y = leg['y']
    roll = math.asin(heel / TOE_REACH) if heel else 0.0
    ankle = (foot_x + ANKLE_Z * math.sin(roll), foot_z + heel + ANKLE_Z * math.cos(roll))
    knee = parts.two_bone_ik(hip, ankle, THIGH, SHIN, knee='back')
    leg['foot'].location = (px(foot_x), px(y), px(foot_z + heel))
    leg['foot'].rotation_euler = (0, roll, 0)
    leg['knee'].location = (px(knee[0]), px(y), px(knee[1]))
    parts.aim(leg['thigh'], hip, knee, y)
    parts.aim(leg['shin'], knee, ankle, y)


def pose(rig, mats, palette, state, i):
    chassis, head, jaw, eye = rig['chassis'], rig['head_grp'], rig['jaw'], rig['eye']
    tube, drone, tail = rig['tube_grp'], rig['drone'], rig['tail_grp']
    cr.restore(rig['rest'])
    eye.data.materials[0] = mats['cyan']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide([drone], False)
    rc.hide(rig['smoke'], True)
    rc.hide([rig['wreck']], True)
    for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.set_burnt(mats, palette, False, hues=HUES)

    feet = {side: (x, 0) for side, x in STAND.items()}
    dx = dz = 0

    def flex(deg, far=None):
        rig['wings']['near'].rotation_euler.y += math.radians(deg)
        rig['wings']['far'].rotation_euler.y += math.radians(deg if far is None else far)

    def screech(deg):
        jaw.rotation_euler.y = math.radians(deg)          # positive drops the lower bill

    def flick(deg):
        tail.rotation_euler.y += math.radians(deg)        # positive raises the tail

    def squint(k):
        eye.scale = (1, 1, k)

    flex(0, 8)                                             # the far wing rides high enough to show

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, -1)[i])
        flex((0, 0, 5, 5, 5, 0)[i])                        # wings lift as it breathes in
        flick((0, 0, -6, -6, 0, 0)[i])
        drone.location.z += px((0, 1, 1, 0, 0, 0)[i])      # the drone hops on its perch
        if i == 4:
            squint(0.2)                                    # blink

    elif state == 'move':
        n = STATES['move'][0]
        feet = {'near': parts.walk_foot(i / n, 6, 4), 'far': parts.walk_foot(i / n + 0.5, 6, 4)}
        dz = (-1, 0, 0, 0)[i % 4]
        head.location.x += px((0, 1, 1, 0)[i % 4])         # the head bobs forward like a bird's
        flex((0, 4, 4, 0)[i % 4])
        flick((6, 0, -6, 0)[i % 4])

    elif state == 'charge':
        # Held while the player charges: wings flare, it crouches and screeches.
        dz = (-2, -3)[i]
        head.location.x += px(-1)
        tube.location.x += px((-2, -3)[i])
        flex((16, 11)[i])
        flick((14, 10)[i])
        screech((20, 26)[i])
        drone.location.z += px((2, 0)[i])
        squint(0.55)

    elif state == 'fire':
        tube.location.x += px((-4, -3, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, 0, 0, 0)[i])
        flex((12, 8, 4, 0, 0)[i])
        flick((-10, -6, 0, 0, 0)[i])
        screech((28, 20, 8, 0, 0)[i])
        rc.hide(rig['tips'], i < 3)                        # the rockets have left, then reload
        rc.hide([drone], i < 4)                            # the drone has just left its perch
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        dz = (1, -1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        flex((14, 6, 0)[i])
        flick((16, 6, 0)[i])
        screech((18, 8, 0)[i])
        squint((0.3, 0.3, 0.7)[i])

    elif state == 'death':
        # Flash, fireball, the pod is blown off forwards, the bird legs fold under it
        # and it goes down beak first with one wing sticking up.
        t = i - 2
        if i == 0:
            dz = 1
            rc.pose_fire(rig['boom'], 0.42)
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.set_burnt(mats, palette, True, hues=HUES)
            eye.data.materials[0] = mats['ink']            # lights out
            rc.hide(rig['layers']['barrel'], True)
            rc.hide([drone], True)
            rc.hide([rig['wreck']], False)
            dz = (1, -5, -11, -13, -13)[t]
            dx = (-1, 0, 2, 3, 3)[t]
            chassis.rotation_euler.y = math.radians((-6, 6, 20, 26, 26)[t])
            head.rotation_euler.y = math.radians((0, 12, 30, 38, 38)[t])
            screech((10, 20, 26, 26, 26)[t])
            flick((10, 16, 4, 0, 0)[t])
            rig['wings']['near'].rotation_euler.y += math.radians((20, 35, 48, 52, 52)[t])
            rig['wings']['far'].rotation_euler.y += math.radians((10, -6, -14, -16, -16)[t])
            rig['wreck'].location = (px((19, 24, 27, 28, 28)[t]), px(-13), px((24, 20, 8, 4.4, 4.4)[t]))
            rig['wreck'].rotation_euler = (0, math.radians((-30, -80, -150, -180, -180)[t]), 0)
            rc.pose_fire(rig['boom'], (0.78, 0.4, 0, 0, 0)[t])
            rc.pose_fire(rig['fire_a'], (0.6, 1.0, 1.1, 0.9, 1.0)[t], lean_deg=(0, -8, 7, -6, 5)[t], at=(-4 + dx, 33 + dz))
            rc.pose_fire(rig['fire_b'], (0, 0.6, 0.95, 1.0, 0.8)[t], lean_deg=(0, 6, -8, 7, -5)[t], at=(10 + dx, 24 + dz * 0.8))
            rc.hide(rig['smoke'], t < 2)
            for s, (sx, sz, k) in zip(rig['smoke'], ((-8, 36, 0.9), (-12, 43, 0.6))):
                grow = k * (0, 0, 0.8, 1.0, 0.9)[t]
                s.location = (px(sx), px(-14), px(sz + (0, 0, 0, 2, 3)[t]))
                s.scale = (grow, grow, grow)

    chassis.location.x += px(dx)
    chassis.location.z += px(dz)
    # The far (rear) foot sits deeper, so the tilted camera draws it higher: sink it back
    # on to the ground row. At rest it stands on its talons with the heel up (a toe-off).
    plant = parts.plant_z(rig['legs']['far']['y'], rig['legs']['near']['y'])
    for side, leg in rig['legs'].items():
        fx, fz = feet[side]
        far = side == 'far'
        heel = HEEL_UP if far and state != 'move' else 0.0
        pose_leg(leg, (HIP[0] + dx, HIP[1] + dz), fx, fz + (plant if far else 0), heel)


if __name__ == '__main__':
    rc.run_mobile(
        name='shrike', canvas=(80, 68), anchor=(36, 65), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('blue', 'amber', 'steel', 'accent', 'smoke', 'cyan', 'ink', 'lamp', 'flame', 'flash'),
        build=build_shrike, pose=pose)
