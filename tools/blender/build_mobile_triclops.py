"""
Three-horned beast (roster id `trico`): model, poses, layered renders.

    blender --background --python build_mobile_triclops.py -- --out work/triclops --scale 4

A chibi triceratops: a heavy teal barrel of a body cut into armour bands over a bone
belly, four pillar legs with bone toenails, a tapered tail, and a big head in front: a
skull with a hooked bone beak and lower jaw, a short nose horn, two long brow horns
sweeping forward and a wide frill fanned back over the neck, rimmed in bone and spiked.
One small eye sits under a brow ridge; on the forehead, in a bone ring, burns the big
amber third eye, which is the gun. There is no barrel to model, so the `barrel` layer
is just that eye's pupil, set ahead of the pivot: the client turns the layer to the aim
and the eye looks where it shoots. The layer is hidden when the lid closes.

The tail and horns are bezier tubes, the frill a fan mesh and the body sliced plates,
from the wyvern's helpers.
"""
import math
import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import creature as cr  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (9, 35)
BARREL_LENGTH = 12
NEAR_Y = -14
EYE_Y = -13.4
# (x, y, size): rear legs are the bigger pillars.
LEGS = {'near_front': (3, -8, 0.85), 'near_rear': (-16, -8, 1.0), 'far_front': (5, 8, 0.85), 'far_rear': (-14, 8, 1.0)}

# Prefixes match in order, so no prefix may start another one listed after it.
PART_GROUPS = (
    ('leg_far', 1), ('tail', 2), ('frill', 3), ('rim', 4), ('spike', 5), ('back', 6), ('body', 7),
    ('belly', 8), ('leg_near', 9), ('nail', 10), ('jaw', 11), ('head', 12), ('snout', 13), ('beak', 14),
    ('nose', 15), ('horn', 16), ('brow', 17), ('ring', 18), ('socket', 19), ('eye', 20), ('iris', 21),
    ('pupil', 22), ('smoke', 23), ('boom', 24), ('fire', 25),
    ('gaze', 1), ('flash', 25),
)
HUES = ('shell', 'bone')
NEAR_FOOT_DROP = 1.0


def build_leg(name, lx, ly, s, mats):
    """Thigh, pillar shin and round foot with two toenails on the camera side. Origin at
    the hip so the step moves it as one. The shin reaches down far enough to plant the
    foot on the ground row: the far feet further, by what the camera tilt lifts them."""
    side = 'near' if ly < 0 else 'far'
    tag = f'leg_{side}_{name}'
    fz = -NEAR_FOOT_DROP + (parts.plant_z(ly, LEGS['near_front'][1]) if side == 'far' else 0)
    thigh = cr.blob(f'{tag}_thigh', (lx - 0.5, ly, 10.5 * s + 1), (6.5 * s, 5 * s, 7 * s), mats['shell'], 20, 10)
    shin = wy.tube(f'{tag}_shin', [(lx, ly, 9 * s), (lx + 0.5, ly, 3 + fz)], (4.8 * s, 4.4 * s), mats['shell'])
    foot = cr.blob(f'{tag}_foot', (lx + 1, ly, 2.2 + fz), (5.4 * s, 4.6 * s, 2.3), mats['shell'], 16, 8)
    ny = 'nail' if side == 'near' else 'leg_far_nail'
    nails = [cr.blob(f'{ny}_{name}_{k}', (lx + 1 + dx * s, ly - 3.6 * s, 1.7 + fz), (1.5, 1.0, 1.5), mats['bone'], 8, 6)
             for k, dx in enumerate((1.2, 4.4))]
    leg = rc.add_empty(tag, (px(lx), px(ly), px(12)))
    for o in [thigh, shin, foot] + nails:
        rc.parent_keep(o, leg)
    return leg, [thigh, shin, foot] + nails


def build_frill(mats, parent):
    """A shield fanned out from behind the skull, leaning back over the neck, with a
    bone rim and triangular spikes pointing outwards along it."""
    cx, cz, rx, rz, lean = -3.0, 38.5, 12.5, 14.5, math.radians(-22)
    pts, dirs = [], []
    for k in range(13):
        a = math.radians(35 + k * (250 - 35) / 12)
        lx, lz = rx * math.cos(a), rz * math.sin(a)
        x = cx + lx * math.cos(lean) + lz * math.sin(lean)
        z = cz - lx * math.sin(lean) + lz * math.cos(lean)
        pts.append((x, z))
        dirs.append((x - cx, z - cz))
    plate = wy.membrane('frill', (5, 33), pts, 3.5, mats['shell'], bulge=0.5, rings=3, cols=2)
    rim = wy.tube('rim', [(x, 2, z) for x, z in pts], (1.5,) * len(pts), mats['bone'])
    spikes = []
    for k in range(1, 12, 2):
        (x, z), (dx, dz) = pts[k], dirs[k]
        n = math.hypot(dx, dz)
        at = (x + dx / n * 2.2, 2, z + dz / n * 2.2)
        spikes.append(cr.cone(f'spike_{k}', 1.9, 0.1, 4.2, at, mats['bone'], vertices=4, flat=True,
                              tilt_deg=math.degrees(math.atan2(dx, dz))))
    for o in [plate, rim] + spikes:
        o.visible_shadow = False          # it sits behind the skull and would drown the face in shadow
        rc.parent_keep(o, parent)
    return [plate, rim] + spikes


def build(mats, proj):
    body_layer, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))

    legs, near_parts, far_parts = {}, [], []
    for name, (lx, ly, s) in LEGS.items():
        leg, parts = build_leg(name, lx, ly, s, mats)
        rc.parent_keep(leg, root)
        legs[name] = leg
        (near_parts if ly < 0 else far_parts).extend(parts)
    rig['legs'] = legs

    beast = rc.add_empty('beast', (px(-4), 0, px(10)))
    rc.parent_keep(beast, root)
    # A barrel body cut across its length into armour bands, the rump a little higher.
    bands = wy.sliced('hide', (-7, 0, 17.5), (11, 12, 19.5), -96,
                      [(-15, 9), (-6.6, 7.8), (0.8, 7), (7.6, 6.6), (14.8, 7.8)], mats['shell'], ('back', 'body'))
    belly = cr.band('belly', (-7, 0, 17.5), (19.5, 12, 11), 0.2, (30, 16, 6.5), (-6, -8, 9.5), mats['bone'])
    tail = wy.tube('tail', [(-22, 0, 18), (-32, 0, 14), (-40, -0.5, 11.5), (-46, -1, 12.5)], (6.2, 4.2, 2.4, 0.3), mats['shell'])
    rc.set_origin(tail, (px(-22), 0, px(18)))

    head_grp = rc.add_empty('head_grp', (px(2), 0, px(26)))
    frill = build_frill(mats, head_grp)
    skull = cr.blob('head', (11, 0, 30), (10, 9, 8.5), mats['shell'], 32, 16)
    snout = wy.tube('snout', [(16, 0, 30), (23, 0, 27.5), (27, 0, 25)], (6.4, 5.0, 3.8), mats['shell'], squash=0.9)
    beak = wy.tube('beak', [(25.5, 0, 28), (30, 0, 26), (31.5, 0, 21.5)], (3.6, 2.6, 0.4), mats['bone'], squash=0.8)
    jaw = wy.tube('jaw', [(12, 0, 23.5), (20, 0, 21.5), (25, 0, 21)], (4.6, 3.4, 2.4), mats['shell'], squash=0.9)
    lower_beak = wy.tube('beak_low', [(24, 0, 21.4), (28.8, 0, 21.4)], (2.4, 0.5), mats['bone'], squash=0.8)
    rc.set_origin(jaw, (px(12), 0, px(24)))            # hinges at the back of the mouth
    rc.parent_keep(lower_beak, jaw)
    nose = cr.cone('nose_horn', 2.9, 0.1, 8, (23, -1, 33.5), mats['bone'], vertices=8, tilt_deg=28)
    horns = [wy.tube('horn_near', [(8, -6, 38), (12, -6.5, 43), (20, -7, 46.5), (29.5, -7, 46.5)], (3.0, 2.2, 1.3, 0.15), mats['bone']),
             wy.tube('horn_far', [(5, 6, 39), (8.5, 6.5, 45.5), (15.5, 7, 50), (24, 7, 51.5)], (2.8, 2.0, 1.2, 0.15), mats['bone'])]
    for h in horns:
        h.visible_shadow = False
    brow = cr.blob('brow', (19.5, -7.5, 35.2), (3.6, 2.2, 1.5), mats['shell'], 16, 8)
    brow.rotation_euler = (0, math.radians(-14), 0)
    small, face = [], []
    e, objs = cr.eye('s0', (19.8, -8.4, 32.2), 2.1, mats, look=0.7)
    small.append(e)
    face += objs
    pivot_z = proj.z_for_height(PIVOT[1], world_y=px(EYE_Y)) * rc.PX_PER_UNIT
    ring = rc.add_cylinder('ring_big', px(8.2), px(0.8), (px(PIVOT[0]), px(EYE_Y + 1.2), px(pivot_z)), mats['bone'], vertices=24, smooth=False)
    socket = rc.add_cylinder('socket_big', px(7.2), px(0.8), (px(PIVOT[0]), px(EYE_Y + 0.6), px(pivot_z)), mats['ink'], vertices=20, smooth=False)
    big = rc.add_cylinder('eye_big', px(6.4), px(0.8), (px(PIVOT[0]), px(EYE_Y), px(pivot_z)), mats['eye'], vertices=20, smooth=False)
    iris = rc.add_cylinder('iris_big', px(4.9), px(0.8), (px(PIVOT[0]), px(EYE_Y - 0.5), px(pivot_z)), mats['lamp'], vertices=16, smooth=False)
    rc.parent_keep(iris, big)
    face += [ring, socket, big, iris]
    for o in face + [brow]:
        o.visible_shadow = False          # discs standing proud of the skull would shade the whole face
    for o in [skull, snout, beak, jaw, nose, brow, ring, socket, big] + horns + small:
        rc.parent_keep(o, head_grp)
    for o in bands + [belly, tail, head_grp]:
        rc.parent_keep(o, beast)
    body_layer.extend(far_parts + [tail] + frill + bands + [belly] + near_parts
                      + [jaw, lower_beak, skull, snout, beak, nose, brow] + horns + face)
    rig.update(beast=beast, head_grp=head_grp, jaw=jaw, tail=tail, small=small, big=big, iris=iris)

    # --- the gaze: barrel layer -------------------------------------------------
    pivot_w = Vector((px(PIVOT[0]), px(EYE_Y - 1.0), px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, head_grp)
    gaze = rc.add_cylinder('gaze', px(2.5), px(0.8), pivot_w + Vector((px(2.3), 0, 0)), mats['ink'], vertices=12, smooth=False)
    rc.parent_keep(gaze, pivot)
    barrel.append(gaze)
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH), px(-4), 0)), 6.5, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig['pivot'] = pivot

    rig['fx'] = cr.death_fx(mats, root, body_layer, (4, 30), 16, y=-18, fires=(5.6, 4.2))
    rig['layers'] = {'body': body_layer, 'barrel': barrel}
    rig['rest'] = cr.snapshot([beast, head_grp, jaw, tail, big] + list(legs.values()))
    return rig


def step(phase, stride=4, lift=3):
    phase %= 1.0
    if phase < 0.5:
        return round(stride - 4 * stride * phase), 0
    u = (phase - 0.5) / 0.5
    return round(-stride + 2 * stride * u), round(lift * math.sin(math.pi * u))


def pose(rig, mats, palette, state, i):
    beast, head, jaw, tail, big = rig['beast'], rig['head_grp'], rig['jaw'], rig['tail'], rig['big']
    cr.restore(rig['rest'])
    cr.lids(rig['small'], 1)
    rig['iris'].data.materials[0] = mats['lamp']
    rc.hide(rig['layers']['barrel'], False)
    rc.pose_fire(rig['flash'], 0)
    cr.reset_fx(rig['fx'])
    rc.set_burnt(mats, palette, False, hues=HUES)

    def shut(k):
        """All the lids at once. The pupil lives on the barrel layer, so a closed big
        eye means hiding that layer too."""
        cr.lids(rig['small'], k)
        big.scale = (1, 1, k)
        if k < 0.5:
            rc.hide(rig['layers']['barrel'], True)

    def bellow(deg):
        jaw.rotation_euler.y = math.radians(deg)       # positive drops the jaw

    if state == 'idle':
        beast.location.z += px((0, 0, -1, -1, -1, 0)[i])
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        tail.rotation_euler.y += math.radians((0, 6, 10, 6, 0, -4)[i])
        if i == 4:
            shut(0.12)

    elif state == 'move':
        n = 6
        for name, leg in rig['legs'].items():
            diagonal = name in ('near_front', 'far_rear')
            dx, dz = step(i / n + (0 if diagonal else 0.5))
            leg.location.x += px(dx)
            leg.location.z += px(dz)
        beast.location.z += px((0, -1, 0, 0, -1, 0)[i])
        head.location.z += px((0, 0, -1, 0, 0, -1)[i])
        tail.rotation_euler.y += math.radians((-8, -4, 4, 8, 4, -4)[i])

    elif state == 'charge':
        # Head down, horns levelled, the third eye burning white.
        beast.location.x += px(-1)
        head.location.z += px((-2, -3)[i])
        head.location.x += px((1, 1)[i])
        head.rotation_euler.y = math.radians((6, 9)[i])
        big.scale = ((1.1, 1.18)[i],) * 3
        rig['iris'].data.materials[0] = mats['flash']
        cr.lids(rig['small'], 0.4)
        tail.rotation_euler.y += math.radians((-10, -14)[i])

    elif state == 'fire':
        beast.location.x += px((-2, -2, -1, 0, 0)[i])
        head.location.x += px((2, 2, 1, 0, 0)[i])
        head.rotation_euler.y = math.radians((-8, -5, -2, 0, 0)[i])
        bellow((14, 10, 4, 0, 0)[i])
        big.scale = ((1.2, 1.1, 1, 1, 1)[i],) * 3
        rig['iris'].data.materials[0] = mats['flash'] if i < 2 else mats['lamp']
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        beast.location.x += px((-2, 1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        bellow((12, 6, 0)[i])
        shut((0.15, 0.15, 0.7)[i])

    elif state == 'death':
        # The third eye blows; the legs give way and it sinks on to its belly, head down.
        dz = (1, 0, -3, -6, -8, -8, -8)[i]
        cr.pose_death_fx(rig['fx'], i, fire_at=((-10, 28 + dz), (6, 22 + dz)), smoke_at=(-6, 42 + dz))
        if i >= 2:
            t = i - 2
            rc.set_burnt(mats, palette, True, hues=HUES)
            rig['iris'].data.materials[0] = mats['ink']
            shut(0.12)
            big.scale = (1, 1, 1)
            rc.hide(rig['layers']['barrel'], True)
            beast.location.z += px(dz)
            for leg in rig['legs'].values():
                leg.scale = (1.3, 1, (0.75, 0.55, 0.4, 0.35, 0.35)[t])
            head.location.z += px((0, -1, -2, -3, -3)[t])
            head.rotation_euler.y = math.radians((4, 8, 12, 14, 14)[t])
            bellow((8, 14, 18, 18, 18)[t])
            tail.rotation_euler.y += math.radians((10, 18, 24, 26, 26)[t])


if __name__ == '__main__':
    rc.run_mobile(
        name='triclops', canvas=(108, 84), anchor=(56, 79), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cr.STATES, part_groups=PART_GROUPS,
        materials=('shell', 'bone', 'smoke', 'eye', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
