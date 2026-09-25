"""
Mage (atlas `sorcerer`): arcane energy in the sorcerer's violet, cut like the crystal on
his staff, with the gold of his robe's trim and stars.

- `arcaneBolt` (S1 Arcane Bolt): a faceted violet crystal dart with a lilac glowing
  heart and two tiny sparks orbiting it.
- `weaveBolt` (S2 Weave): twin violet orbs with lilac cores side by side across the
  flight line, tied by a thin gold braid behind; they swap sides as it flickers.
- `shieldBreaker` (SS Shield Break): a heavy spinning rune star, a glowing core in a
  gold ring with four violet crystal spikes, the thing that shatters shields.
"""
import math

from projectile_kit import GLOW, W, ball, extra_ramp, lathe, mat, projectile, torus, tube

# The violet ramp's own highlight, as a flat glow (palette.json's `rune` is the ramp's
# light step and would melt into it).
extra_ramp('lilac', ['#d8c4ff'] * 4)


def shift(obj, d):
    obj.location = obj.location + W(0, 0, d)
    return obj


def crystal(name, x0, x1, xm, r, material, group, seg=4, roll_deg=45.0):
    """A stretched bipyramid along the flight axis: tail point x0, girdle at xm, nose x1."""
    o = lathe(name, [(x0, 0.0), (xm, r), (x1, 0.0)], material, seg=seg, group=group, smooth=False)
    o.rotation_euler = (math.radians(roll_deg), 0, 0)
    return o


@projectile('arcaneBolt', (14, 14), anim=2, frame_ticks=4,
            materials=('violet', 'lilac', 'flash'))
def arcane_bolt(a):
    objs = [
        crystal('dart', -5.6, 5.6, 1.2, 2.8, mat('violet'), 1, seg=4, roll_deg=30),
        shift(ball('heart', (1.0, 0.0), 1.4, mat('lilac'), squash=(2.4, 1, 0.5), group=GLOW), 3.4),
    ]
    # Two star sparks orbiting the dart, swapping above and below each frame.
    for i, s in enumerate((1, -1)):
        f = 1 if a == 0 else -1
        x, y = (0.6, 3.7 * s * f) if i == 0 else (-3.0, 2.8 * s * f)
        objs.append(shift(ball(f'spark{i}', (x, y), 1.2, mat('flash'), group=3), 3.0))
    return objs


@projectile('weaveBolt', (16, 16), anim=2, frame_ticks=4,
            materials=('violet', 'amber', 'lilac', 'flash'))
def weave_bolt(a):
    """
    Twin orbs side by side across the flight line, tied by a thin gold braid that
    crosses once behind them. The two swap sides every frame: the braid turning.
    """
    objs = []
    f = 1 if a == 0 else -1
    for i, s in enumerate((1, -1)):
        side = s * f
        # The near orb (lower on screen in frame 0) sits a touch forward and bigger.
        near = side < 0
        x = 2.2 if near else 1.6
        r = 2.5 if near else 2.2
        d = 1.2 if near else -1.2
        y = 3.2 * side
        objs.append(shift(ball(f'orb{i}', (x, y), r, mat('violet'), group=1 + i), d))
        objs.append(shift(ball(f'core{i}', (x + 0.3, y + 0.2), r * 0.62, mat('lilac'), squash=(1, 1, 0.5),
                               group=GLOW), d + r + 0.4))
        objs.append(shift(ball(f'hot{i}', (x + 0.5, y + 0.5), 0.55, mat('flash'), group=GLOW + 1), d + r + 1.2))
    # Gold braid: each strand leaves one orb, crosses the flight line and fades behind.
    for i, s in enumerate((1, -1)):
        side = s * f
        pts, radii = [], []
        n = 10
        for k in range(n + 1):
            t = k / n
            x = 0.4 - 5.4 * t
            y = 2.8 * side * math.cos(math.pi * t * 1.15) * (1 - 0.35 * t)
            dd = 0.9 * side * math.sin(math.pi * t) - 0.5
            pts.append((x, y, dd))
            radii.append(0.35 * (1 - t) + 0.3)
        objs.append(tube(f'strand{i}', pts, radii, mat('amber'), group=4 + i))
    return objs


@projectile('shieldBreaker', (26, 26), mode='spin', frames=6, spin_deg=90.0, frame_ticks=3,
            materials=('violet', 'amber', 'lilac', 'flash'))
def shield_breaker(a):
    objs = [
        ball('core', (0, 0), 4.2, mat('violet'), group=1),
        torus('ring', (0, 0), 5.3, 1.0, mat('amber'), d=0.0, tilt=0.0, group=3),
        shift(ball('glow', (0, 0), 3.0, mat('lilac'), squash=(1, 1, 0.4), group=GLOW), 4.6),
        shift(ball('hot', (-0.6, 0.6), 1.5, mat('flash'), squash=(1, 1, 0.4), group=GLOW + 1), 5.6),
    ]
    for k in range(4):
        ang = 45 + 90 * k
        c = crystal(f'spike{k}', 3.4, 11.6, 5.6, 2.0, mat('violet'), 2, seg=4, roll_deg=0)
        c.rotation_euler = (0, math.radians(-ang), 0)
        objs.append(c)
    return objs
