"""
Orbital (roster `asate`, atlas `orbital`): designator probes that paint a target for the
satellite's beam (`satellite`).

The orbital is a white lander under a blue dish with a gold feed horn, so its shots are
little satellites: a white faceted bus wrapped in gold foil, blue solar panels spread
above and below it, and a red designator lens in the nose that blinks like the
lander's mast beacon. Both are symmetric about the flight axis, so they read the same
flying either way, and they sit on the painted mark pointing right until the beam comes.

- `painter` (Painter, Tri-Beam): the small probe, a panel wing each side.
- `painterHeavy` (Orbital Lance): the big uplink probe, twin panel wings each side, a
  blue dish on its nose with a red-hot lance charge burning at the feed.
"""
from projectile_kit import GLOW, ball, lathe, mat, prism, projectile, rod


def bus(k, r=1.9):
    """The probe body: a faceted white bus, a gold foil skirt and a gold feed-horn tail."""
    return [
        lathe('bus', [(-2.2 * k, r * k), (1.6 * k, r * k)], mat('white'), seg=8, smooth=False, group=1),
        lathe('foil', [(-3.6 * k, 1.4 * k), (-2.2 * k, 1.9 * k)], mat('amber'), seg=8, smooth=False, group=2),
        lathe('nose', [(1.6 * k, r * k), (2.6 * k, 1.2 * k)], mat('steel'), seg=8, smooth=False, group=3),
    ]


def panel(name, x0, x1, y0, y1, material, group):
    """A flat solar panel in the picture plane, faced towards the camera, cell lines by a strut."""
    return prism(name, [(x0, y0), (x1, y0), (x1, y1), (x0, y1)], 0.8, material, front=-0.2, bevel=0.2,
                 group=group)


def lens(x, r, on):
    return [
        ball('lens', (x, 0), r, mat('crimson'), group=4),
        ball('lens_glint', (x + r * 0.3, r * 0.2), r * (0.6 if on else 0.35), mat('pink'), d=r * 0.8,
             group=GLOW),
    ]


@projectile('painter', (14, 14), anim=2, frame_ticks=6,
            materials=('white', 'amber', 'steel', 'blue', 'crimson', 'pink'))
def painter(a):
    on = a == 0
    return [
        *bus(1.0),
        rod('strut', (-1.1, -4.6), (-1.1, 4.6), 0.35, mat('steel'), d=-0.4, group=5),
        panel('panel_up', -2.3, 0.1, 2.3, 4.9, mat('blue'), 6),
        panel('panel_dn', -2.3, 0.1, -4.9, -2.3, mat('blue'), 6),
        *lens(3.3, 1.35, on),
    ]


def dish(x, r, depth):
    """A shallow bowl on the nose, open forward: a solidified lathe cup."""
    prof = [(x - depth - 0.6, 0.0), (x - depth * 0.5, r * 0.62), (x, r), (x + 0.1, r - 0.7),
            (x - depth * 0.5 + 0.3, r * 0.5 - 0.3), (x - depth + 0.3, 0.0)]
    return lathe('dish', prof, mat('ice'), group=7)


@projectile('painterHeavy', (24, 24), anim=3, frame_ticks=3,
            materials=('white', 'amber', 'steel', 'blue', 'ice', 'pink', 'flash'))
def painter_heavy(a):
    charge = (1.6, 1.25, 1.45)[a]
    return [
        *bus(1.35, r=2.0),
        rod('strut', (-2.2, -8.2), (-2.2, 8.2), 0.45, mat('steel'), d=-0.4, group=5),
        panel('panel_up_a', -4.4, -2.5, 3.2, 8.0, mat('blue'), 6),
        panel('panel_up_b', -1.9, 0.0, 3.2, 8.0, mat('blue'), 8),
        panel('panel_dn_a', -4.4, -2.5, -8.0, -3.2, mat('blue'), 6),
        panel('panel_dn_b', -1.9, 0.0, -8.0, -3.2, mat('blue'), 8),
        rod('mast', (3.2, 0), (5.4, 0), 0.6, mat('amber'), group=2),
        dish(8.0, 5.0, 2.6),
        ball('charge', (8.8, 0), charge, mat('pink'), d=1.0, group=GLOW),
        ball('charge_core', (8.8, 0), charge * 0.55, mat('flash'), d=1.8, group=GLOW + 1),
    ]
