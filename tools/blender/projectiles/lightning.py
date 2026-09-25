"""
Lightning (atlas `tempest`): the tempest's shots are seeds that mark the ground for the
bolt the sky sends down (the bolt itself is a beam effect, not a sprite). They share the
mobile's tesla kit: steel, copper windings, a cyan charge crackling off them.

- `boltSeed` (S1 Bolt, S2 Slant Bolt): a steel dart wound with two copper coils, a
  glowing cyan electrode at the nose and sparks flickering off it.
- `boltSeedHeavy` (SS Thunderhead): a small storm cloud, dark and heavy, with cyan
  lightning crackling through it and out of its belly. Clouds have no nose, so it is
  a `loop`: it churns and flashes in place.
"""
import math

from projectile_kit import GLOW, W, ball, lathe, mat, projectile, tube


def shift(obj, d):
    obj.location = obj.location + W(0, 0, d)
    return obj


def zigzag(name, pts, r, material, group, d):
    return tube(name, [(x, y, d) for x, y in pts], r, material, group=group, smooth=False, resolution=1)


@projectile('boltSeed', (14, 14), anim=2, frame_ticks=3,
            materials=('steel', 'orange', 'cyan', 'flash'))
def bolt_seed(a):
    objs = [
        # Steel tail cap and a copper-wound body, the tempest's tesla coil in little.
        lathe('cap', [(-4.8, 0.0), (-4.8, 1.3), (-4.0, 1.9), (-3.2, 1.9)], mat('steel'), group=1),
        lathe('coil', [(-3.2, 2.0), (0.8, 2.0), (1.2, 1.5)], mat('orange'), group=2),
        lathe('band', [(-1.5, 2.25), (-0.9, 2.25)], mat('steel'), group=3),
        # Steel electrode ball at the nose, charged cyan on its face.
        ball('bulb', (2.7, 0.0), 2.0, mat('steel'), group=4),
        shift(ball('charge', (2.9, 0.0), 1.1, mat('cyan'), squash=(1, 1, 0.5), group=GLOW), 2.0),
    ]
    # A spark jumping off the electrode, flipping side each frame.
    s = 1 if a == 0 else -1
    objs.append(zigzag('arc', [(3.0, 1.6 * s), (2.2, 2.9 * s), (3.4, 3.4 * s), (2.6, 4.4 * s)], 0.45,
                       mat('cyan'), 5, 2.5))
    return objs


@projectile('boltSeedHeavy', (26, 24), mode='loop', frames=4, frame_ticks=4,
            materials=('smoke', 'rubber', 'cyan', 'flash'))
def bolt_seed_heavy(a):
    K = 1.15
    ph = a * math.pi / 2
    objs = []
    # Cloud: a flat-bottomed heap of puffs, lighter on top, dark underneath.
    puffs = [(-5.2, 0.6, 3.4), (-1.4, 2.6, 4.4), (3.2, 1.6, 3.8), (6.0, -0.4, 2.8), (0.8, -0.8, 4.0), (-4.0, -1.8, 3.0)]
    for i, (x, y, r) in enumerate(puffs):
        wob = 0.35 * math.sin(ph + i * 1.7)
        objs.append(ball(f'puff{i}', (K * x, K * (y + wob) + 1.0), K * (r + 0.15 * math.cos(ph + i)), mat('smoke'), squash=(1, 0.9, 0.8),
                         group=1))
    objs.append(ball('belly', (0.4, -1.8), 4.8, mat('rubber'), squash=(2.0, 0.6, 0.6), group=2))
    # Lightning: a crackle inside the cloud, and a fork out of its belly on alternate frames.
    inner = [[(-4.0, 1.4), (-1.6, -0.2), (0.4, 1.6), (3.0, -0.4)],
             [(-3.2, -0.4), (-0.8, 1.8), (1.2, 0.0), (3.8, 1.8)],
             [(-4.4, 0.4), (-2.0, 2.0), (0.6, 0.2), (2.4, 2.2)],
             [(-2.8, 1.8), (-0.4, -0.2), (1.8, 1.8), (4.2, 0.2)]][a]
    inner = [(K * x, K * y + 1.0) for x, y in inner]
    objs.append(zigzag('crackle', inner, 0.7, mat('cyan'), GLOW, 5.2))
    fork = [[(1.0, -3.0), (-0.6, -5.6), (1.6, -7.0), (-0.2, -10.2)],
            None,
            [(-2.0, -3.0), (-0.4, -5.4), (-2.6, -7.2), (-1.0, -10.2)],
            None][a]
    if fork:
        objs.append(zigzag('fork', fork, 0.75, mat('cyan'), 3, 4.0))
        objs.append(zigzag('fork_hot', fork, 0.3, mat('flash'), GLOW + 1, 5.0))
    else:
        objs.append(shift(ball('glint', (2.0 - a, 0.6), 1.0, mat('flash'), group=GLOW + 1), 5.5))
    return objs
