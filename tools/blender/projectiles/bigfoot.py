"""
Stomper (`bigfoot`, atlas `walker`): the pod rockets its missile box ripples off.

The walker's pod is amber with red warheads peeping out of black tubes, so its rockets
are the opposite of the Armor's long steel `missile` (steel body, crimson ogive, black
cruciform fins): short, fat, amber, a round red nose and a steel ring tail instead of
fins, a hazard-black band round the middle.

- `miniMissile` (Volley, Barrage): the stubby pod rocket, a flicker of exhaust.
- `carpetMissile` (Carpet): the same rocket grown up for the big swing: a longer
  hazard-striped body, a fatter red nose, a steel collar, the ring tail and a hotter flame.
"""
import math

import bpy
from mathutils import Matrix

from projectile_kit import GLOW, W, ball, extra_ramp, lathe, mat, projectile, torus

# The walker's hull amber, lifted a step: at 13 px the palette ramp's brown shadow ate
# the whole body. Shadow, mid, light, highlight.
extra_ramp('podAmber', ['#c47418', '#f0a82c', '#ffd04a', '#fff0a0'])


def round_nose(x0, x1, r, steps=6):
    """Quarter ellipse: full radius at x0, closing to a point at x1."""
    pts = []
    for k in range(steps + 1):
        a = (math.pi / 2) * k / steps
        pts.append((x0 + (x1 - x0) * math.sin(a), r * math.cos(a) if k < steps else 0.0))
    return pts


def ring_tail(name, x, R, r, material, group):
    """A duct ring round the tail, its axis the flight axis (a torus seen edge on)."""
    o = torus(name, (x, 0), R, r, material, tilt=0.0, group=group)
    # The kit's torus faces the camera; turn it about the vertical so its axis is x.
    bpy.context.view_layer.update()
    pivot = W(x, 0, 0)
    o.matrix_world = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(90), 4, 'Z')
                      @ Matrix.Translation(-pivot)) @ o.matrix_world
    return o


@projectile('miniMissile', (13, 13), anim=2, frame_ticks=3,
            materials=('podAmber', 'accent', 'rubber', 'steel', 'flame', 'lamp'))
def mini_missile(a):
    flare = 1.0 if a == 0 else 0.7
    return [
        lathe('body', [(-3.2, 1.7), (-3.2, 2.1), (1.2, 2.1)], mat('podAmber'), group=1),
        lathe('band', [(-1.4, 2.25), (-0.4, 2.25)], mat('rubber'), group=1),
        lathe('nose', round_nose(1.2, 4.3, 2.1), mat('accent'), group=3),
        ring_tail('duct', -3.4, 2.3, 0.55, mat('steel'), group=4),
        ball('exhaust', (-4.4, 0), 1.3 * flare, mat('flame'), squash=(1.1, 1, 1), group=GLOW),
        ball('exhaust_core', (-4.0, 0), 0.8 * flare, mat('lamp'), d=1.0, group=GLOW + 1),
    ]


@projectile('carpetMissile', (19, 19), anim=2, frame_ticks=3,
            materials=('podAmber', 'accent', 'rubber', 'steel', 'flame', 'lamp', 'flash'))
def carpet_missile(a):
    flare = 1.0 if a == 0 else 0.72
    return [
        lathe('body', [(-5.0, 2.1), (-5.0, 2.5), (0.6, 2.5)], mat('podAmber'), group=1),
        lathe('band_a', [(-3.6, 2.65), (-2.7, 2.65)], mat('rubber'), group=1),
        lathe('band_b', [(-1.7, 2.65), (-0.8, 2.65)], mat('rubber'), group=1),
        # A fat high-explosive head, wider than the body: the Carpet's silhouette.
        lathe('collar', [(0.4, 2.6), (1.0, 3.3)], mat('steel'), group=4),
        lathe('nose', [(1.0, 3.3)] + round_nose(1.6, 7.0, 3.3, steps=7), mat('accent'), group=3),
        ring_tail('duct', -5.0, 2.8, 0.6, mat('steel'), group=4),
        ball('exhaust', (-6.2, 0), 1.6 * flare, mat('flame'), squash=(1.3, 1, 1), group=GLOW),
        ball('exhaust_core', (-5.8, 0), 1.0 * flare, mat('flash'), d=1.2, group=GLOW + 1),
    ]
