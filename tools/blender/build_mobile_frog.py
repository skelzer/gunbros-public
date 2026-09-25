"""
Fat spitting frog (the roster's `jfrog`): model, poses, layered renders.

    blender --background --python build_mobile_frog.py -- --out work/frog --scale 4

A squat toad sitting up on its haunches, built for the side view: an egg-shaped body
tilted nose-up, a broad flat head whose lower jaw is its own piece (so the id pass
draws the long frog smile, and the jaw really drops when it spits), a pale throat
sac that swells, two big bulging eye domes on top of the head (the far one peeking
over the near one), each with a pale face, gold iris, black pupil and glint, a pale ridge running down the back, and the frog's signature Z-folded
hind leg: a fat banded thigh, the shin tucked back under it and a long foot along the
ground with padded toes. Stubby arms prop the front up on splayed, padded fingers.

The limbs and ridge are bezier tubes with tapered bevels (`tube` from the wyvern
build); the mouth is a boolean cut of the head; the jaw is the same head shell cut to what
lies below the lip line, so it can drop open.

The mouth is the gun and a frog has no barrel to show, so the `barrel` layer is empty
except on `fire`, when it holds the slime gob: the client turns that layer to the aim
angle, so the gob leaves the gaping mouth in the right direction.

Everything that carries the pivot moves in whole pixels. Squash and stretch is done by
scaling the body blobs about the ground, never the group that holds the pivot.
All sizes are sprite pixels at 1x.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import creature as cr  # noqa: E402
import render_common as rc  # noqa: E402
from parts import plant_z  # noqa: E402
from render_common import px  # noqa: E402

# Contract with the simulation (packages/shared, jfrog sprite): pivot 17 px ahead of and
# 19 px above the anchor, muzzle 9 px out from the mouth.
PIVOT_DX = 17
PIVOT_UP = 19
BARREL_LENGTH = 9

NEAR_Y = -15
# Near limbs sink this far (px) to sit on the ground row; far limbs further, by what the
# camera tilt lifts them (plant_z), so all four plant on one row.
NEAR_HIND_Y, NEAR_ARM_Y = -10.5, -8
HIND_DROP, ARM_DROP = 0.5, 1.35
MOUTH_Z = 16.5          # the lip line at the snout
HEAD_C = (8, 0, 19)
HEAD_R = (11.5, 11, 8.2)

STATES = {
    'idle': (8, 9, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (6, 6, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}

PART_GROUPS = (
    ('limb_far', 1), ('body', 2), ('ridge', 3), ('belly', 4), ('throat', 5), ('maw', 6), ('tongue', 7),
    ('jaw', 8), ('limb_near', 9), ('domefar', 10), ('pad', 11), ('arm', 12), ('dome', 13), ('eye', 14),
    ('iris', 15), ('pupil', 16), ('glint', 17), ('gob', 18), ('smoke', 19), ('boom', 20), ('fire', 21),
)
HUES = ('paint', 'bone', 'shell', 'skin')


def blob(name, centre, radii, material, segments=24, rings=12):
    return cr.blob(name, centre, radii, material, segments, rings)


def cut(obj, box_size, box_centre, tilt_deg, op):
    """Boolean `obj` against a box: 'INTERSECT' keeps what is inside, 'DIFFERENCE' removes it."""
    box = rc.add_box('cut_' + obj.name, tuple(px(s) for s in box_size), tuple(px(c) for c in box_centre), obj.data.materials[0])
    box.rotation_euler = (0, math.radians(tilt_deg), 0)
    mod = obj.modifiers.new('Cut', 'BOOLEAN')
    mod.operation = op
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, obj)
    return obj


def toes(tag, root, tips, y, mats, radius=0.9, pad=1.25):
    """Thin fingers from `root` (x, z) to each tip (x, dy, z), each ending in a round pad."""
    out = []
    for k, (tx, dy, tz) in enumerate(tips):
        out.append(wy.tube(f'{tag}_toe_{k}', [(root[0], y, root[1]), (tx, y + dy, tz)], (radius, radius * 0.7), mats['paint']))
        out.append(blob(f'{"pad" if tag.startswith("limb_near") or tag.startswith("arm") else tag}_pad_{k}',
                        (tx + 0.3, y + dy, tz), (pad * 1.2, pad, pad * 0.9), mats['skin'], 10, 6))
    return out


def build_hind(side, y, mats, parent):
    """The folded hind leg, hinged at the hip: thigh forward along the flank, shin tucked
    back under it, a long foot forward along the ground. Returns (hip, parts, foot).
    The shin and foot sit `fz` lower to plant on the ground row (see HIND_DROP)."""
    tag = f'limb_{side}'
    near = side == 'near'
    fz = -HIND_DROP + plant_z(y, NEAR_HIND_Y)
    thigh = blob(f'{tag}_thigh', (-8, y, 8.5), (9.5, 5.2, 6.4), mats['paint'], 32, 16)
    thigh.rotation_euler = (0, math.radians(-14), 0)
    shin = wy.tube(f'{tag}_shin', [(0, y - 0.8, 4.2 + fz / 2), (-7, y - 1, 2.8 + fz), (-14, y - 0.8, 2.8 + fz)],
                   (3.4, 3.0, 2.6), mats['paint'])
    parts = [thigh, shin]
    foot = rc.add_empty(f'foot_{side}', (px(-15), px(y), px(1.5 + fz)))
    sole = wy.tube(f'{tag}_foot', [(-16, y - 1, 2.2 + fz), (-8, y - 1.2, 1.4 + fz), (-1, y - 1.2, 1.1 + fz)],
                   (2.4, 1.6, 1.1), mats['paint'], squash=0.8)
    digits = toes(tag, (-1.5, 1.1 + fz), ((5, -1.6, 0.9 + fz), (4, 0.2, 1.4 + fz), (6.2, 1.8, 0.9 + fz)), y - 1.2, mats)
    for o in [sole] + digits:
        rc.parent_keep(o, foot)
    hip = rc.add_empty(f'hip_{side}', (px(-10), px(y), px(10)))
    for o in parts:
        rc.parent_keep(o, hip)
    rc.parent_keep(foot, hip)
    rc.parent_keep(hip, parent)
    return hip, parts + [sole] + digits, foot


def build_arm(side, y, mats, parent):
    """A stubby arm propping the front up; it reaches `fz` lower to plant the fingers on
    the ground row (see ARM_DROP)."""
    tag = 'arm' if side == 'near' else 'limb_far_arm'
    fz = -ARM_DROP + plant_z(y, NEAR_ARM_Y)
    upper = wy.tube(f'{tag}_upper', [(9.5, y, 11), (11.5, y - 0.5, 6.5 + fz / 2), (12.5, y - 0.8, 2.2 + fz)],
                    (3.0, 2.3, 1.9), mats['paint'])
    fingers = toes(tag, (13, 1.3 + fz), ((16.5, -1.8, 0.9 + fz), (17.3, 0, 1.1 + fz), (15.5, 1.8, 0.9 + fz)), y - 0.8,
                   mats, radius=0.8, pad=1.1)
    shoulder = rc.add_empty(f'shoulder_{side}', (px(9.5), px(y), px(11)))
    for o in [upper] + fingers:
        rc.parent_keep(o, shoulder)
    rc.parent_keep(shoulder, parent)
    return shoulder, [upper] + fingers


def build_eye(k, centre, mats, dome_r=(6.2, 6, 5.8), disc_r=4.8, tag='dome'):
    """A big bulging eye dome on top of the head with a face towards the camera: a pale
    disc, a gold iris looking forward, a black pupil and a white glint. Returns the dome
    and the disc (squint by scaling the disc in z)."""
    ex, ey, ez = centre
    dome = blob(f'{tag}_{k}', centre, dome_r, mats['paint'], 32, 16)
    fy = ey - dome_r[1] * 0.93
    sclera = rc.add_cylinder(f'eye_{k}', px(disc_r), px(0.8), (px(ex + 1.6), px(fy), px(ez + 0.3)), mats['eye'], vertices=20, smooth=False)
    iris = rc.add_cylinder(f'iris_{k}', px(disc_r * 0.7), px(0.8), (px(ex + 2.5), px(fy - 0.4), px(ez + 0.1)), mats['lamp'], vertices=16, smooth=False)
    pupil = rc.add_cylinder(f'pupil_{k}', px(disc_r * 0.36), px(0.8), (px(ex + 3.1), px(fy - 0.8), px(ez)), mats['ink'], vertices=12, smooth=False)
    pupil.scale = (1.3, 1, 1)
    glint = blob(f'glint_{k}', (ex + 1.4, fy - 1.2, ez + 1.4), (0.9, 0.5, 0.9), mats['flash'], 8, 4)
    for o in (iris, pupil, glint):
        rc.parent_keep(o, sclera)
    return dome, sclera, [dome, sclera, iris, pupil, glint]


def brighten(mat, steps):
    """Move a toon material's ramp thresholds so more of the lit side lands on the light
    step (a lighter, cuter frog) without new colours."""
    for node in mat.node_tree.nodes:
        if node.type == 'VALTORGB':
            for el, pos in zip(node.color_ramp.elements, steps):
                el.position = pos


def build_frog(mats, proj):
    brighten(mats['paint'], (0.0, 0.07, 0.42, 0.9))
    brighten(mats['bone'], (0.0, 0.03, 0.5, 0.9))
    body_layer, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    frog = rc.add_empty('frog', (px(-1), 0, px(15)))     # everything; flips about its middle
    rc.parent_keep(frog, root)

    # --- the mass: egg body tilted nose-up, broad head, pale belly --------------------
    body = blob('body', (-5, 0, 12.5), (15, 12, 11), mats['paint'], 32, 16)
    body.rotation_euler = (0, math.radians(-16), 0)
    head = blob('body_head', HEAD_C, HEAD_R, mats['paint'], 32, 16)
    cut(head, (40, 40, 20), (HEAD_C[0], 0, MOUTH_Z - 10), -4, 'DIFFERENCE')
    snout = blob('body_snout', (15.5, 0, 18.4), (5.6, 7.6, 3.8), mats['paint'], 24, 12)
    cut(snout, (40, 40, 20), (HEAD_C[0], 0, MOUTH_Z - 10), -4, 'DIFFERENCE')
    belly = blob('belly', (4, -2.5, 8.5), (10.5, 10, 7.4), mats['bone'], 32, 16)
    belly.rotation_euler = (0, math.radians(-28), 0)
    # Lower jaw: the head shell below the lip line, hinged at the back of the mouth.
    jaw = blob('jaw', (HEAD_C[0] + 0.3, 0, HEAD_C[2] - 0.2), (HEAD_R[0] - 0.3, HEAD_R[1] - 0.4, HEAD_R[2]), mats['paint'], 32, 16)
    rc.set_origin(jaw, (px(0), 0, px(MOUTH_Z + 0.5)))
    cut(jaw, (40, 40, 20), (HEAD_C[0], 0, MOUTH_Z - 10), -4, 'INTERSECT')
    chin = blob('throat', (11.5, -2.5, 13.2), (7.2, 8.6, 3.2), mats['bone'], 24, 12)
    rc.set_origin(chin, (px(6), px(-2), px(14)))
    maw = blob('maw', (12.5, -1.5, MOUTH_Z - 0.2), (8, 10, 2.4), mats['ink'], 24, 12)      # shown when it gapes
    # The long frog smile: a thin dark lip line from under the eye round the snout,
    # tucked up at the back corner.
    lip = wy.tube('maw_lip', [(0.5, -8.8, 18.6), (3, -10.2, 17.2), (9, -10.8, 16.7), (15, -9.2, 16.7),
                              (19.2, -5.4, 17.0), (21, -1, 17.2)], (0.45, 0.5, 0.5, 0.5, 0.45, 0.4), mats['ink'])
    tongue = blob('tongue', (12.5, -2, MOUTH_Z - 2.4), (6, 9.6, 1.8), mats['accent'], 16, 8)
    rc.parent_keep(tongue, jaw)
    rc.parent_keep(chin, jaw)
    squashy = [body, belly]
    for o in squashy:
        rc.set_origin(o, (px(-1), o.location.y, 0))          # squash and stretch about the ground

    # A pale ridge down each side of the back, from behind the eye to the rump.
    ridge = wy.tube('ridge', [(2, -8.2, 24.2), (-6, -9.6, 22.2), (-14, -9.4, 17.5), (-19.5, -6.8, 11)],
                    (1.5, 1.4, 1.2, 0.5), mats['skin'])
    spots = [blob(f'ridge_spot_{k}', c, r, mats['shell'], 12, 6) for k, (c, r) in enumerate((
        ((-8, -10.4, 19.6), (1.4, 1.2, 1.2)), ((-14, -9.4, 13.5), (1.2, 1.2, 1.1))))]
    rig.update(jaw=jaw, chin=chin, maw=maw, squashy=squashy)

    # --- limbs ------------------------------------------------------------------------
    hips, feet, limb_parts = {}, {}, {}
    for side, y in (('far', 10.5), ('near', NEAR_HIND_Y)):
        hip, parts, foot = build_hind(side, y, mats, frog)
        hips[side], feet[side], limb_parts[side] = hip, foot, parts
    arms, arm_parts = {}, {}
    for side, y in (('far', 7), ('near', NEAR_ARM_Y)):
        arms[side], arm_parts[side] = build_arm(side, y, mats, frog)

    # --- eyes ---------------------------------------------------------------------------
    # Two big domes on top of the head, the far one peeking up over the near one.
    near_dome, near_eye, near_parts = build_eye(0, (6, -4.5, 28), mats)
    far_dome, far_eye, far_parts = build_eye(1, (12.5, 4, 30), mats, dome_r=(5.4, 5.4, 5.2), disc_r=4.2, tag='domefar')
    rig['eyes'] = [near_eye, far_eye]

    for o in [body, head, snout, lip, belly, jaw, maw, ridge, near_dome, far_dome, near_eye, far_eye] + spots:
        rc.parent_keep(o, frog)
    body_layer.extend(far_parts + limb_parts['far'] + arm_parts['far'] + [body, belly, ridge] + spots
                      + [maw, tongue, jaw, chin, head, snout, lip] + limb_parts['near'] + arm_parts['near'] + near_parts)
    rig.update(frog=frog, hips=hips, feet=feet, arms=arms, tongue=tongue)

    # --- the spit: barrel layer -------------------------------------------------------
    pivot_z = proj.z_for_height(PIVOT_UP) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT_DX), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, frog)
    gob = rc.add_sphere('gob', px(1), pivot_w + Vector((px(BARREL_LENGTH + 2), 0, 0)), mats['skin'], scale=(3.8, 3.2, 3.3), segments=12, rings=8)
    tail = rc.add_sphere('gob_tail', px(1), pivot_w + Vector((px(BARREL_LENGTH - 2.5), 0, px(-0.4))), mats['skin'], scale=(2.6, 2, 1.7), segments=10, rings=6)
    rc.parent_keep(tail, gob)
    rc.parent_keep(gob, pivot)
    barrel.extend((gob, tail))
    rig['pivot'], rig['gob'] = pivot, gob

    # --- death props --------------------------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-17), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    for o in smoke:
        o.visible_shadow = False
        rc.parent_keep(o, root)
        body_layer.append(o)
    rig['boom'] = rc.add_fire('boom', mats, (px(2), px(-18), px(18)), 13, root, tall=1)
    body_layer.extend(rig['boom'])
    rig['smoke'] = smoke

    rig['layers'] = {'body': body_layer, 'barrel': barrel}
    rig['rest'] = cr.snapshot([frog, gob, jaw, chin, tongue, near_eye, far_eye] + squashy
                              + list(hips.values()) + list(feet.values()) + list(arms.values()))
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    frog, gob, jaw, chin = rig['frog'], rig['gob'], rig['jaw'], rig['chin']
    cr.restore(rig['rest'])
    rc.hide(rig['layers']['barrel'], False)
    rc.hide([gob], True)
    rc.hide(rig['smoke'], True)
    rc.hide([rig['maw'], rig['tongue']], True)
    rc.pose_fire(rig['boom'], 0)
    rc.set_burnt(mats, palette, False, hues=HUES)

    def lids(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    def squash(k):
        for o in rig['squashy']:
            o.scale = (1 + (1 - k) * 0.6, 1, k)

    def gape(deg):
        jaw.rotation_euler.y = math.radians(deg)          # positive drops the jaw
        rc.hide([rig['maw'], rig['tongue']], deg < 6)

    def puff(k):
        chin.scale = (k, k, k)

    if state == 'idle':
        puff((1.0, 1.0, 1.12, 1.25, 1.25, 1.12, 1.0, 1.0)[i])       # the throat sac fills and empties
        if i == 6:
            lids(0.12)                                                 # blink

    elif state == 'move':
        # One hop: crouch, leap, hang, fall, land, recover. The hind legs kick out
        # behind on the leap and the arms reach forward for the landing.
        frog.location.z += px((0, 3, 6, 4, 0, 0)[i])
        frog.location.x += px((0, 0, 1, 1, 0, 0)[i])
        squash((0.9, 1.06, 1.0, 1.0, 0.86, 0.95)[i])
        kick = (0, 1, 1, 0.5, 0, 0)[i]
        for hip in rig['hips'].values():
            hip.rotation_euler.y = math.radians(28 * kick)
        for foot in rig['feet'].values():
            foot.rotation_euler.y = math.radians(-30 * kick)
            foot.location.x -= px(round(7 * kick))            # the long feet kick out behind
            foot.location.z -= px(round(2 * kick))
        for arm in rig['arms'].values():
            arm.rotation_euler.y = math.radians((0, 0, -25, -30, -10, 0)[i])
        if i == 4:
            lids(0.5)

    elif state == 'charge':
        # Held for as long as the player charges: eyes screwed shut, throat blown up,
        # the whole frog squashed down with the effort.
        lids(0.3)
        puff((1.35, 1.5)[i])
        squash((0.95, 0.92)[i])

    elif state == 'fire':
        gape((26, 30, 20, 10, 4, 0)[i])
        lids((0.3, 0.3, 0.3, 0.45, 0.7, 1)[i])
        frog.location.x += px((-1, -2, -1, 0, 0, 0)[i])
        squash((1.08, 1.03, 0.96, 0.98, 1.0, 1.0)[i])
        puff((0.6, 0.7, 0.8, 0.9, 1, 1)[i])
        if i < 2:
            rc.hide([gob], False)
            gob.location.x += px((0, 6)[i])
            gob.scale = ((1.0, 0.75)[i],) * 3

    elif state == 'hurt':
        gape((18, 12, 0)[i])
        lids((0.25, 0.25, 0.6)[i])
        frog.location.x += px((-2, 1, 0)[i])
        squash((0.9, 1.04, 1.0)[i])

    elif state == 'death':
        # It swells, pops, and ends up the way cartoon frogs do: on its back, legs in
        # the air, a wisp of smoke coming off the belly.
        t = i - 2
        if i == 0:
            lids(1.25)
            squash(1.08)
            puff(1.3)
            rc.pose_fire(rig['boom'], 0.4)
        elif i == 1:
            lids(1.25)
            squash(1.14)
            puff(1.5)
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.hide(rig['layers']['barrel'], True)             # no charring: it is a frog, not a tank
            gape(24)
            lids(0.12)
            for hip in rig['hips'].values():
                hip.rotation_euler.y = math.radians((10, 25, 35, 40, 40)[t])
            frog.rotation_euler.y = math.radians((-35, -95, -150, -188, -180)[t])
            frog.location.z += px((8, 12, 8, 4, 5)[t])              # comes to rest on its eye domes
            frog.location.x += px((-2, -5, -7, -8, -8)[t])
            rc.pose_fire(rig['boom'], (0.6, 0.25, 0, 0, 0)[t])
            rc.hide(rig['smoke'], t < 3)
            for s, (sx, sz, k) in zip(rig['smoke'], ((-8, 40, 0.8), (-11, 46, 0.55))):
                grow = k * (0, 0, 0, 0.9, 1.0)[t]
                s.location = (px(sx), px(-17), px(sz + (0, 0, 0, 0, 2)[t]))
                s.scale = (grow, grow, grow)


if __name__ == '__main__':
    rc.run_mobile(
        name='frog', canvas=(88, 68), anchor=(44, 65), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('paint', 'bone', 'eye', 'shell', 'skin', 'accent', 'smoke', 'ink', 'lamp', 'flame', 'flash'),
        build=build_frog, pose=pose)
