"""
Deepshell (`turtle`, atlas `turtle`): clear blue water, fired from the brass cannon.

- `waterBall` (S1 Water Ball, S2 Tide Split): a flying water drop, round head and a
  tapering tail that points back along the flight, with a white glint.
- `pressureShell` (SS Bubble Burst): a glass pressure vessel full of water, caged in the
  cannon's brass, with a valve at the tail and bubbles inside, straining on its fuse.
- `bubble` (the twelve bubbles the burst throws out): a small pale soap bubble with a
  big glint, wobbling as it drifts.
"""
import math

from projectile_kit import GLOW, ball, lathe, mat, projectile, torus


def arc(cx, r, x0, x1, steps):
    """Lathe points of a circle of radius r centred on the axis at cx, from x0 to x1."""
    pts = []
    for k in range(steps + 1):
        x = x0 + (x1 - x0) * k / steps
        pts.append((x, max(0.0, r * r - (x - cx) ** 2) ** 0.5))
    return pts


@projectile('waterBall', (14, 14), anim=2, frame_ticks=5, materials=('glass', 'eye'))
def water_ball(a):
    # The head breathes a little between the two frames: water, not a solid.
    r = 3.6 if a == 0 else 3.3
    stretch = 1.0 if a == 0 else 1.12
    head = arc(0.9, r, 0.9 - r * 0.2, 0.9 + r, 6)
    tail = [(-5.4 * stretch, 0.0), (-4.0 * stretch, 0.8), (-2.5 * stretch, 1.8), (-1.0, 2.9)]
    return [
        lathe('drop', tail + head, mat('glass'), group=1),
        ball('glint', (1.7, 1.5), 0.9, mat('eye'), d=r + 0.1, group=GLOW),
    ]


@projectile('pressureShell', (22, 22), materials=('glass', 'blue', 'amber', 'eye'))
def pressure_shell(a):
    body = arc(-1.0, 4.5, -5.0, 3.2, 8)[1:-1]
    body = [(-5.0, 2.4)] + body + [(3.2, 2.4)]
    return [
        lathe('vessel', body, mat('glass'), group=1),
        lathe('cap', [(2.8, 3.2), (4.2, 3.0), (5.4, 2.3), (6.4, 1.2), (6.9, 0.0)], mat('amber'), group=3),
        lathe('base', [(-6.2, 2.6), (-4.6, 3.3)], mat('amber'), group=4),
        lathe('valve', [(-8.0, 1.1), (-6.2, 1.1)], mat('amber'), group=5),
        lathe('wheel', [(-8.4, 2.1), (-7.7, 2.1)], mat('amber'), group=6),
        ball('bub_a', (-2.8, -1.3), 1.2, mat('blue'), d=3.7, group=10),
        ball('bub_b', (0.3, 0.9), 0.9, mat('blue'), d=4.2, group=11),
        ball('glint', (-1.4, 2.6), 0.9, mat('eye'), d=3.8, group=GLOW),
    ]


@projectile('bubble', (10, 10), mode='loop', frames=4, frame_ticks=6, materials=('glass', 'eye'))
def bubble(a):
    # Round, small and nearly all light: a soap bubble, with a crescent glint.
    t = 2 * math.pi * a / 4
    sx, sy = 1 + 0.1 * math.cos(t), 1 - 0.1 * math.cos(t)
    return [
        ball('skin', (0, 0), 3.1, mat('glass'), squash=(sx, sy, 0.7), group=1),
        ball('glint', (-1.2 * sx, 1.2 * sy), 1.1, mat('eye'), d=1.9, squash=(1.1, 0.8, 1), group=GLOW),
        ball('glint2', (1.5 * sx, -1.3 * sy), 0.6, mat('eye'), d=1.9, group=GLOW + 1),
    ]
