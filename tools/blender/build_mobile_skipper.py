"""
Bouncy larva (roster id `grub`): model, poses, layered renders.

    blender --background --python build_mobile_skipper.py -- --out work/skipper --scale 4

A skipper caterpillar: an oversized round head on a pinched neck with a collar, and a
plump lime body that tapers back and curls up at the end into a springy tail it hops
on. The body follows one curved spine; each segment is its own short tube, fat in the
middle and pinched at both ends, so the outline notches between segments. Cream belly
bands and orange spiracles ride on each segment, stubby prolegs plant it on the
ground and three little dark true legs sit under the neck. The face: huge wet eyes
under an arched brow, knobbed antennae that curve forward, a blushed cheek and a pink
spout of a mouth. It spits, so there is no gun to show: the `barrel` layer holds only
the gob, which leaves the mouth along the aim on `fire`.
"""
import math
import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import creature as cr  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (10, 12)
BARREL_LENGTH = 8
NEAR_Y = -12

# The spine: (x, z, radius) from the neck back to the base of the tail.
SPINE = ((3.5, 10.2, 5.6), (-0.5, 9.8, 7.8), (-6, 9.4, 8.6), (-13, 9.0, 8.1), (-20, 9.0, 7.1),
         (-26, 9.8, 5.8), (-30, 11.6, 4.5))
SEG_X = ((2, -4.5), (-4.5, -11), (-11, -17.5), (-17.5, -23.5), (-23.5, -29))   # front to back
HOP = (0, 3, 5, 3, 0, 0)

PART_GROUPS = (
    ('tail', 1), ('sega', 2), ('segb', 3), ('belly', 4), ('spot', 5), ('leg', 6), ('collar', 7),
    ('head', 8), ('cheek', 9), ('mouth', 10), ('lip', 11), ('brow', 12), ('eye', 13), ('pupil', 14),
    ('antenna', 15), ('knob', 16), ('smoke', 17), ('boom', 18), ('fire', 19),
    ('gob', 10),
)


def spine(x):
    """(z, radius) of the spine at x, linear between the SPINE points."""
    pts = SPINE
    if x >= pts[0][0]:
        return pts[0][1:]
    for a, b in zip(pts, pts[1:]):
        if b[0] <= x <= a[0]:
            t = (a[0] - x) / (a[0] - b[0])
            return a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t
    return pts[-1][1:]


def intersect(obj, name, size, centre, mat):
    box = rc.add_box(f'cut_{name}', tuple(px(s) for s in size), tuple(px(c) for c in centre), mat)
    mod = obj.modifiers.new('Keep', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, obj)
    return obj


def segment(k, x0, x1, mats):
    """One body segment: a short tube along the spine, pinched at its ends, with a belly
    band, a spiracle and (on the middle ones) a proleg. Origin on the ground below it."""
    xm = (x0 + x1) / 2
    zm, rm = spine(xm)
    ends = []
    for x in (x0 + 0.6, x1 - 0.6):
        z, r = spine(x)
        ends.append((x, z, r))
    pts = [(ends[0][0], 0, ends[0][1]), (xm, 0, zm), (ends[1][0], 0, ends[1][1])]
    radii = (ends[0][2] * 0.8, rm * 1.02, ends[1][2] * 0.8)
    tag = 'sega' if k % 2 == 0 else 'segb'
    seg = wy.tube(f'{tag}_{k}', pts, radii, mats['skin'], resolution=8)
    belly = wy.tube(f'belly_{k}', pts, [r + 0.35 for r in radii], mats['bone'], resolution=8)
    intersect(belly, f'belly_{k}', (x0 - x1 + 2, 30, 10), (xm, 0, zm - rm * 0.38 - 5), mats['bone'])
    spot = cr.blob(f'spot_{k}', (xm - 0.3, -rm * 0.93, zm - rm * 0.05), (1.3, 0.8, 1.6), mats['flame'], 10, 6)
    parts = [seg, belly, spot]
    if 1 <= k <= 3:
        top = zm - rm + 2.5
        leg = wy.tube(f'leg_{k}', [(xm, -3.6, top), (xm + 0.2, -4, 1.0)], (2.8, 2.2), mats['skin'])
        parts.append(leg)
    rc.set_origin(seg, (px(xm), 0, 0))
    for o in parts[1:]:
        rc.parent_keep(o, seg)
    return seg, parts


def build(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))

    segs, seg_parts = [], []
    for k, (x0, x1) in enumerate(SEG_X):
        seg, parts = segment(k, x0, x1, mats)
        rc.parent_keep(seg, root)
        segs.append(seg)
        seg_parts.append(parts)

    # The springy tail: curls up from the last segment, a hopper's pogo stick.
    tail = wy.tube('tail', [(-27, 0, 10.8), (-32.5, 0, 13.5), (-35, 0, 18), (-33.5, 0, 22.5), (-30.8, 0, 23.6)],
                   (4.4, 3.3, 2.3, 1.5, 0.6), mats['skin'], resolution=8)
    rc.set_origin(tail, (px(-28), 0, px(11)))
    rc.parent_keep(tail, segs[-1])

    # True legs: three dark little hooks under the neck segment.
    true_legs = []
    for j, x in enumerate((0.8, -1.6)):
        lg = wy.tube(f'leg_true_{j}', [(x, -3.8, 4.2), (x + 0.4, -4.4, 1.6), (x + 1.6, -4.4, 0.6)],
                     (1.0, 0.8, 0.3), mats['ink'])
        rc.parent_keep(lg, segs[0])
        true_legs.append(lg)

    # Head: a big round capsule on a pinched neck, with a collar band behind it.
    collar = wy.tube('collar', [(3.8, 0, 10.4), (1.0, 0, 10.1)], (7.2, 7.8), mats['accent'])
    head = cr.blob('head', (12.2, 0, 14.2), (10.4, 10.2, 11.2), mats['skin'], 32, 16)
    rc.set_origin(head, (px(12), 0, 0))
    face = []
    eyes = []
    for tag, c, r in (('0', (9, -9.8, 17), 4.4), ('1', (16.4, -8.6, 17.4), 3.8)):
        e, objs = cr.eye(tag, c, r, mats, look=1.3)
        eyes.append(e)
        face += objs
    brow = wy.tube('brow', [(4.6, -10.2, 21.4), (9, -11, 23.4), (14, -10.4, 23.2), (20, -8.2, 21.0)],
                   (0.8, 1.35, 1.2, 0.7), mats['ink'])
    cheek = cr.blob('cheek', (6.4, -10.2, 10.4), (2.3, 0.8, 1.7), mats['pink'], 12, 6)
    # A puckered spout: a short tapered tube out of the face, dark at the tip.
    mouth = wy.tube('mouth', [(19.4, -3.5, 10.4), (21.8, -3.5, 9.9), (23.6, -3.5, 9.8)], (2.8, 2.5, 2.2), mats['accent'])
    lip = cr.blob('lip', (23.8, -4.2, 9.8), (0.9, 1.4, 1.5), mats['ink'], 10, 6)
    antennae = []
    for k, (ax, ay, tip) in enumerate(((7, -2.5, (11, 34)), (14, -3, (20, 32)))):
        a = wy.tube(f'antenna_{k}', [(ax, ay, 22), (ax - 1, ay, 28), ((ax + tip[0]) / 2, ay, tip[1] - 0.8), (tip[0], ay, tip[1])],
                    (1.1, 0.9, 0.8, 0.7), mats['skin'])
        knob = cr.blob(f'knob_{k}', (tip[0] + 0.6, ay, tip[1] + 0.2), (2.3, 2.3, 2.3), mats['accent'], 12, 8)
        rc.set_origin(a, (px(ax), px(ay), px(22)))
        rc.parent_keep(knob, a)
        antennae.append(a)
        body.extend((a, knob))
    for o in [brow, cheek, mouth, lip] + eyes + antennae:
        rc.parent_keep(o, head)
    rc.parent_keep(collar, segs[0])
    rc.parent_keep(head, root)
    for parts in reversed(seg_parts):
        body.extend(parts)
    body.extend([tail, collar, head, brow, cheek, mouth, lip] + true_legs + face)
    rig.update(root=root, segs=segs, head=head, eyes=eyes, antennae=antennae, tail=tail)

    pivot_w = Vector((px(PIVOT[0]), 0, px(proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, head)
    gob = rc.add_sphere('gob', px(1), pivot_w + Vector((px(BARREL_LENGTH + 5), px(-6), 0)), mats['skin'], scale=(3.6, 3, 3.1), segments=12, rings=8)
    gtail = rc.add_sphere('gob_tail', px(1), pivot_w + Vector((px(BARREL_LENGTH + 0.5), px(-6), px(-0.4))), mats['skin'], scale=(2.5, 2, 1.6), segments=10, rings=6)
    rc.parent_keep(gtail, gob)
    rc.parent_keep(gob, pivot)
    barrel.extend((gob, gtail))
    rig.update(pivot=pivot, gob=gob)

    rig['fx'] = cr.death_fx(mats, root, body, (6, 14), 9, y=-15)
    rig['layers'] = {'body': body, 'barrel': barrel}
    rig['rest'] = cr.snapshot([head, gob, tail] + segs + antennae)
    return rig


def pose(rig, mats, palette, state, i):
    head, segs, eyes, gob, tail = rig['head'], rig['segs'], rig['eyes'], rig['gob'], rig['tail']
    cr.restore(rig['rest'])
    cr.lids(eyes, 1)
    rc.hide(rig['layers']['barrel'], False)
    rc.hide([gob], True)
    cr.reset_fx(rig['fx'])

    def wave(deg):
        for k, a in enumerate(rig['antennae']):
            a.rotation_euler.y += math.radians(deg * (1 if k == 0 else -0.7))

    def flick(deg):
        tail.rotation_euler.y = math.radians(deg)          # positive curls it forward over the back

    if state == 'idle':
        for k, s in enumerate(segs):                        # a breath runs down the body
            s.scale = (1, 1, 1.06 if (i + k) % 6 in (2, 3) else 1.0)
        wave((0, 6, 12, 6, 0, -6)[i])
        flick((0, 0, 10, 14, 10, 0)[i])
        if i == 4:
            cr.lids(eyes, 0.12)

    elif state == 'move':
        # It skips: the tail kicks down, the head leaps, each segment follows a frame late.
        head.location.z += px(HOP[i])
        head.scale = (1, 1, (0.9, 1.05, 1, 1, 0.86, 0.95)[i])
        for k, s in enumerate(segs):
            s.location.z += px(HOP[(i - k - 1) % 6])
        flick((-18, -6, 12, 20, 6, -10)[i])
        wave((0, -14, -20, -10, 12, 4)[i])

    elif state == 'charge':
        cr.lids(eyes, 0.25)
        head.scale = ((1.1, 1.15)[i], 1, (0.94, 0.9)[i])    # cheeks full
        for k, s in enumerate(segs):
            s.scale = (1, 1, (0.95, 1.05)[(i + k) % 2])
        flick((24, 30)[i])
        wave((-18, -24)[i])

    elif state == 'fire':
        cr.lids(eyes, (0.25, 0.25, 0.5, 1, 1)[i])
        head.location.x += px((-2, -2, -1, 0, 0)[i])
        head.scale = ((0.92, 0.96, 1, 1, 1)[i], 1, 1)
        flick((-14, -8, 0, 0, 0)[i])
        wave((20, 12, 4, 0, 0)[i])
        if i < 2:
            rc.hide([gob], False)
            gob.location.x += px((0, 6)[i])
            gob.scale = ((1.0, 0.75)[i],) * 3

    elif state == 'hurt':
        cr.lids(eyes, (0.15, 0.15, 0.6)[i])
        head.location.x += px((-2, 1, 0)[i])
        for k, s in enumerate(segs):
            s.location.z += px((2, 0, 0)[i] if k % 2 == 0 else 0)
        flick((30, 10, 0)[i])
        wave((-25, 10, 0)[i])

    elif state == 'death':
        # No fire for a grub: a pop, and it deflates segment by segment, tail and antennae down.
        cr.pose_death_fx(rig['fx'], i, smoke_at=(4, 20) if i >= 4 else None)
        if i >= 1:
            cr.lids(eyes, 0.12)
        if i >= 2:
            t = i - 2
            rc.hide(rig['layers']['barrel'], True)
            head.scale = (1.06, 1, (0.85, 0.7, 0.6, 0.55, 0.55)[t])
            for k, s in enumerate(segs):
                flat = (0.9, 0.7, 0.52, 0.42, 0.4)[max(0, min(4, t - k + 1))]
                s.scale = (1.08, 1, flat)
            flick((-20, -40, -60, -70, -70)[t])
            wave((30, 55, 75, 85, 85)[t])


if __name__ == '__main__':
    rc.run_mobile(
        name='skipper', canvas=(92, 64), anchor=(54, 60), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cr.STATES, part_groups=PART_GROUPS,
        materials=('skin', 'bone', 'accent', 'smoke', 'eye', 'ink', 'pink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
