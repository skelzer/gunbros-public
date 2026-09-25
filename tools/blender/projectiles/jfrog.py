"""
Croaker (`jfrog`, atlas `frog`): the yellow-green slime gob the frog spits, the one its
barrel layer shows on `fire`, in the frog's own `skin` green.

- `slime` (S1 Slime): the gob itself, a lumpy blob with a drip hanging off it, wobbling.
- `creeper` (S2 Creeper): a slug of slime with two goggling eyes that inches along the
  ground: it is alive, it walks.
- `deluge` (SS Deluge): the creeper's big brother, a heaving, scowling mound of slime
  with five gobs riding its back (the five blobs it throws when it goes off).
"""
import math

from projectile_kit import GLOW, ball, mat, projectile


def glint(name, x, y, r, d, group=GLOW):
    return ball(name, (x, y), r, mat('eye'), d=d, group=group)


@projectile('slime', (13, 13), mode='loop', frames=4, frame_ticks=4, materials=('skin', 'paint', 'eye'))
def slime(a):
    t = 2 * math.pi * a / 4
    sx, sy = 1 + 0.1 * math.cos(t), 1 - 0.1 * math.cos(t)
    return [
        ball('gob', (0, 0.6), 3.7, mat('skin'), squash=(sx, sy, 0.9), group=1),
        ball('gob_lump', (-1.7 + 0.3 * math.sin(t), -1.2), 2.2, mat('skin'), d=0.4, group=1),
        ball('drip', (1.0, -3.2 - 0.5 * math.sin(t)), 1.2, mat('paint'), group=2),
        glint('glint', 0.9, 2.1, 1.1, 3.1),
        glint('glint2', -2.6, -0.9, 0.5, 2.2, group=GLOW + 1),
    ]


@projectile('creeper', (18, 16), mode='loop', frames=4, frame_ticks=4,
            materials=('skin', 'paint', 'eye', 'ink'))
def creeper(a):
    # Inching: long and low, then short and tall, the eyes riding the hump.
    t = 2 * math.pi * a / 4
    sx, sy = 1 + 0.12 * math.cos(t), 1 - 0.12 * math.cos(t)
    top = -2.0 + 3.6 * (1 + 0.4 * (sy - 1))
    objs = [
        ball('foot', (0, -3.6), 5.0, mat('paint'), squash=(sx * 1.2, 0.3, 0.8), group=1),
        ball('slug', (0, -2.2), 4.4, mat('skin'), squash=(sx * 1.1, sy * 0.85, 0.8), group=2),
    ]
    for k, ex in enumerate((-1.9, 1.9)):
        ex *= 1 + 0.4 * (sx - 1)
        objs += [
            ball(f'eye{k}', (ex, top + 0.6), 1.9, mat('eye'), d=1.2, group=4 + k),
            ball(f'pupil{k}', (ex + 0.4, top + 0.4), 1.05, mat('ink'), d=2.6, group=6 + k),
        ]
    objs.append(glint('glint', -3.0 * sx, -1.6, 0.6, 3.4))
    return objs


@projectile('deluge', (24, 24), mode='loop', frames=4, frame_ticks=4,
            materials=('skin', 'paint', 'eye', 'ink'))
def deluge(a):
    # The creeper's big brother: a heaving mound of slime with a scowl, five gobs riding
    # its back (the five it throws when it goes off), each swelling in turn.
    t = 2 * math.pi * a / 4
    sx, sy = 1 + 0.08 * math.cos(t), 1 - 0.08 * math.cos(t)
    objs = [
        ball('foot', (0, -4.9), 7.8, mat('paint'), squash=(sx * 1.2, 0.24, 0.8), group=1),
        ball('mound', (0, -2.1), 7.0, mat('skin'), squash=(sx * 1.25, sy * 0.95, 0.8), group=2),
    ]
    for k, (deg, r0) in enumerate(((152, 2.4), (120, 2.6), (90, 2.2), (60, 2.6), (28, 2.4))):
        ang = math.radians(deg)
        r = r0 + 0.4 * math.sin(t + 1.4 * k)
        cx, cy = 7.4 * sx * math.cos(ang), -2.1 + 6.7 * sy * math.sin(ang)
        objs.append(ball(f'gob{k}', (cx, cy), r, mat('skin'), d=-0.5, group=3 + (k % 2)))
        if k in (1, 3):
            objs.append(glint(f'gglint{k}', cx - 0.6, cy + 0.8, 0.6, r - 0.2, group=GLOW + 1))
    top = -2.1 + 5.4 * (1 + 0.5 * (sy - 1))
    for k, ex in enumerate((-2.5, 2.5)):
        ex *= 1 + 0.4 * (sx - 1)
        objs += [
            ball(f'eye{k}', (ex, top), 2.3, mat('eye'), d=3.2, group=6 + k),
            ball(f'pupil{k}', (ex + 0.5, top - 0.4), 1.2, mat('ink'), d=4.9, group=8 + k),
            # A heavy brow slanting down to the middle: the scowl.
            ball(f'brow{k}', (ex * 0.9, top + 1.9 - 0.2), 2.0, mat('skin'), d=3.6,
                 squash=(1.3, 0.55, 1), group=10 + k),
        ]
        objs[-1].rotation_euler[1] = math.radians(18 if k == 0 else -18)
    objs.append(glint('glint', -5.4 * sx, -1.2, 0.8, 4.0))
    return objs
