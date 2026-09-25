"""
Vortex (`jd`, atlas `vortex`): the chibi mech's coil-gun slug and its two pulling shots.

The mech is blue with violet coils, a glowing vortex on its chest (vanes winding out of a
bright core) and a gyro ring with two lamp orbs round its back. The shots borrow those:

- `vortexSlug` (Slug, plain impact): a blunt blue slug with a violet coil ring round its
  waist and a cyan charge glowing at the tail. Not the Armor's olive shell.
- `vortexShell` (Vortex, pull): the chest vortex set loose: a violet orb with a lamp
  core and three vanes winding out of it, spinning (a pinwheel reads as "swirl").
- `vortexCore` (Singularity, pull): the gyro ring round a black hole: a dark core with a
  violet rim inside a tilted, spinning glowing ring carrying the two lamp orbs.
"""
import math

import bpy
from mathutils import Matrix

from projectile_kit import GLOW, W, ball, extra_ramp, lathe, mat, projectile, torus, tube

# The mech's blue a step lighter: at 14 px the palette ramp's navy shadow swallowed the slug.
extra_ramp('slugBlue', ['#2f62a3', '#4a86cc', '#7ab4ea', '#c4e6ff'])


def round_nose(x0, x1, r, steps=6):
    """Quarter ellipse: full radius at x0, closing to a point at x1."""
    pts = []
    for k in range(steps + 1):
        a = (math.pi / 2) * k / steps
        pts.append((x0 + (x1 - x0) * math.sin(a), r * math.cos(a) if k < steps else 0.0))
    return pts


def axial_ring(name, x, R, r, material, group):
    """A ring round the flight axis at x (the kit's torus faces the camera: turn it)."""
    o = torus(name, (x, 0), R, r, material, group=group)
    bpy.context.view_layer.update()
    pivot = W(x, 0, 0)
    o.matrix_world = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(90), 4, 'Z')
                      @ Matrix.Translation(-pivot)) @ o.matrix_world
    return o


def vane(name, phase_deg, r0, r1, sweep_deg, w0, w1, material, group, steps=7, d=0.0):
    """One arm of a vortex: a tapering tube winding out from radius r0 to r1."""
    pts, radii = [], []
    for k in range(steps + 1):
        t = k / steps
        a = math.radians(phase_deg + sweep_deg * t)
        r = r0 + (r1 - r0) * t
        pts.append((r * math.cos(a), r * math.sin(a), d))
        radii.append(w0 + (w1 - w0) * t)
    return tube(name, pts, radii, material, group=group)


@projectile('vortexSlug', (14, 14), anim=2, frame_ticks=3,
            materials=('slugBlue', 'violet', 'cyan', 'flash'))
def vortex_slug(a):
    glow = 1.0 if a == 0 else 0.7
    return [
        lathe('body', [(-3.6, 1.9), (-3.6, 2.4), (1.0, 2.4)] + round_nose(1.0, 4.2, 2.4), mat('slugBlue'), group=1),
        axial_ring('coil', -1.3, 2.6, 0.8, mat('violet'), group=1),
        ball('charge', (-4.4, 0), 1.5 * glow, mat('cyan'), squash=(1.2, 1, 1), group=GLOW),
        ball('charge_core', (-4.0, 0), 0.7 * glow, mat('flash'), d=1.0, group=GLOW + 1),
    ]


@projectile('vortexShell', (17, 17), mode='spin', frames=6, spin_deg=120, frame_ticks=2,
            materials=('violet', 'blue', 'lamp', 'flash'))
def vortex_shell(a):
    objs = [
        ball('orb', (0, 0), 3.0, mat('violet'), group=1),
        ball('core', (0, 0), 1.7, mat('lamp'), d=2.0, group=GLOW),
        ball('core_hot', (-0.3, 0.3), 0.8, mat('flash'), d=3.2, group=GLOW + 1),
    ]
    for k in range(3):
        objs.append(vane(f'vane{k}', 120 * k, 2.4, 6.6, 140, 1.0, 0.45, mat('violet'), group=1))
    return objs


@projectile('vortexCore', (25, 25), mode='spin', frames=8, spin_deg=180, frame_ticks=2,
            materials=('violet', 'plate', 'lamp', 'flash', 'rune'))
def vortex_core(a):
    ring = torus('ring', (0, 0), 9.2, 1.2, mat('violet'), tilt=50, group=2)
    ring_glow = torus('ring_glow', (0, 0), 9.2, 0.5, mat('rune'), d=0.9, tilt=50, group=GLOW + 2)
    # The two lamp orbs ride the ring at its ends, where the ellipse is widest.
    return [
        ball('hole', (0, 0), 4.0, mat('plate'), group=1),
        torus('rim', (0, 0), 4.0, 0.8, mat('violet'), d=0.6, group=3),
        ring, ring_glow,
        ball('orb_a', (9.2, 0), 2.2, mat('lamp'), group=GLOW),
        ball('orb_b', (-9.2, 0), 2.2, mat('lamp'), group=GLOW),
        ball('orb_a_hot', (8.9, 0.5), 1.0, mat('flash'), d=1.4, group=GLOW + 1),
        ball('orb_b_hot', (-9.5, 0.5), 1.0, mat('flash'), d=1.4, group=GLOW + 1),
    ]
