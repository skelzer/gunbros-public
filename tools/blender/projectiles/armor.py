"""
Armor (atlas `tank`): the tank's olive shells and its siege missile.

- `shell`: a short artillery round, olive body, brass driving band, steel ogive.
- `shellHeavy`: the same round fattened, a red stripe on the body and a blunt steel cap.
- `missile`: a long steel rocket with a red warhead, four fins and a flickering exhaust.
"""
from projectile_kit import GLOW, ball, fins, lathe, mat, projectile


def ogive(x0, x1, r, steps=5):
    """Tangent ogive nose from radius r at x0 to a point at x1, as lathe profile points."""
    pts = []
    for k in range(steps + 1):
        t = k / steps
        pts.append((x0 + (x1 - x0) * t, r * (1 - t * t) ** 0.5 if k < steps else 0.0))
    return pts


@projectile('shell', (14, 14), materials=('paint', 'amber', 'steel'))
def shell(a):
    return [
        lathe('body', [(-4.4, 2.1), (-4.4, 2.5), (-0.2, 2.5)], mat('paint'), group=1),
        lathe('band', [(-3.6, 2.8), (-2.6, 2.8)], mat('amber'), group=2),
        lathe('nose', ogive(-0.2, 5.2, 2.5, steps=6), mat('steel'), group=3),
    ]


@projectile('shellHeavy', (18, 18), materials=('paint', 'amber', 'steel', 'crimson'))
def shell_heavy(a):
    return [
        lathe('body', [(-6.0, 2.9), (-6.0, 3.5), (0.0, 3.5)], mat('paint'), group=1),
        lathe('band', [(-5.2, 3.85), (-3.9, 3.85)], mat('amber'), group=2),
        lathe('stripe', [(-1.6, 3.65), (-0.6, 3.65)], mat('crimson'), group=4),
        lathe('nose', ogive(0.0, 7.2, 3.5, steps=7), mat('steel'), group=3),
    ]


@projectile('missile', (26, 26), anim=2, frame_ticks=3,
            materials=('steel', 'crimson', 'rubber', 'flame', 'lamp', 'flash'))
def missile(a):
    flare = 1.0 if a == 0 else 0.75
    return [
        lathe('body', [(-8.4, 1.8), (-8.4, 2.3), (4.0, 2.3)], mat('steel'), group=1),
        lathe('nozzle', [(-9.6, 1.9), (-8.4, 1.5)], mat('rubber'), group=3),
        lathe('warhead', ogive(4.0, 11.0, 2.3, steps=7), mat('crimson'), group=2),
        *fins('fin', -8.2, -4.8, 2.0, 3.2, mat('rubber'), count=4, sweep=1.4, group=4),
        ball('exhaust', (-10.3, 0), 1.7 * flare, mat('flame'), squash=(1.2, 1, 1), group=GLOW),
        ball('exhaust_core', (-9.9, 0), 1.0 * flare, mat('lamp'), d=1.0, group=GLOW + 1),
    ]
