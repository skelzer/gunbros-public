"""
Herald (roster `aduka`, atlas `herald`): the messenger's signal and targeting rounds.

The herald fires from a brass clarion hung with a red swallowtail banner, under a hood
with gold wings, so its rounds are brass and blue with red banners and gold wings.

- `flare` (Signal Shot): a stubby blue signal cartridge with a brass cap and band, its
  tail burning with a flickering red-gold signal star.
- `beacon` (Thor Call): a brass targeting dart with a spear-point finial, towing a red
  swallowtail banner that snaps in the wind (symmetric about the flight axis, so it
  reads the same flying left or right).
- `beaconBarrage` (Thor Barrage): the same dart grown, with the herald's gold wings
  swept back from it, a longer banner and a crackling storm light at the point.
"""
from projectile_kit import GLOW, ball, extra_ramp, lathe, mat, prism, projectile

# Polished brass: palette amber's shadow is a brown that swallows a thin round at 1x.
extra_ramp('brass', ['#c47a24', '#e89a2a', '#f7c948', '#fff0a0'])


def ogive(x0, x1, r, steps=5):
    pts = []
    for k in range(steps + 1):
        t = k / steps
        pts.append((x0 + (x1 - x0) * t, r * (1 - t * t) ** 0.5 if k < steps else 0.0))
    return pts


def banner(name, x0, x1, h, tail, wave, material, group):
    """A swallowtail streamer from x0 (its hoist, height 2h) back to two tails at x1."""
    notch = x1 + (x0 - x1) * 0.35
    pts = [(x0, -h), (x0, h), (x1 + 0.6, tail + wave), (x1, tail + wave * 0.5),
           (notch, 0.0), (x1, -tail + wave * 0.5), (x1 + 0.6, -tail + wave)]
    # Front to back the outline must run one way round: flip to keep it simple.
    return prism(name, list(reversed(pts)), 1.0, material, bevel=0.25, group=group)


@projectile('flare', (14, 14), anim=2, frame_ticks=3,
            materials=('blue', 'brass', 'pink', 'flash'))
def flare(a):
    burn = 1.0 if a == 0 else 0.8
    return [
        lathe('body', [(-2.8, 2.0), (-2.8, 2.3), (1.4, 2.3)], mat('blue'), group=1),
        lathe('band', [(-2.5, 2.55), (-1.6, 2.55)], mat('brass'), group=2),
        lathe('cap', ogive(1.4, 5.3, 2.3, steps=6), mat('brass'), group=3),
        ball('signal', (-3.9, 0), 1.9 * burn, mat('pink'), squash=(1.0, 1, 1), group=GLOW),
        ball('signal_core', (-3.6, 0), 1.1 * burn, mat('flash'), d=1.2, group=GLOW + 1),
    ]


def dart(k, body='brass'):
    """Brass round with a blue band and a leaf-shaped silver spearhead, pointing right."""
    return [
        lathe('body', [(-2.6 * k, 1.5 * k), (-2.6 * k, 2.1 * k), (1.6 * k, 2.1 * k)], mat(body), group=1),
        lathe('band', [(-1.3 * k, 2.35 * k), (-0.4 * k, 2.35 * k)], mat('blue' if body != 'blue' else 'brass'),
              group=2),
        lathe('socket', [(1.6 * k, 1.5 * k), (2.4 * k, 1.0 * k)], mat('brass'), group=2),
        lathe('point', [(2.4 * k, 1.0 * k), (3.3 * k, 2.0 * k), (6.8 * k, 0.0)],
              mat('white'), seg=4, smooth=False, group=3),
    ]


@projectile('beacon', (20, 20), anim=2, frame_ticks=4,
            materials=('brass', 'blue', 'white', 'accent'))
def beacon(a):
    wave = 0.6 if a == 0 else -0.6
    return [
        *dart(1.0),
        banner('banner', -2.2, -7.6, 1.4, 3.2, wave, mat('accent'), 4),
    ]


def wing(name, sign, x0, span, material, group):
    """A gold wing swept back from the hull to a long quill tip, above (+1) or below (-1)."""
    s = sign
    pts = [(x0, 1.0 * s), (x0 - 2.6, span * 0.7 * s), (x0 - 6.4, span * s), (x0 - 5.6, span * 0.7 * s),
           (x0 - 7.6, span * 0.55 * s), (x0 - 6.0, 1.0 * s)]
    if s < 0:
        pts = list(reversed(pts))
    return prism(name, pts, 1.2, material, front=-0.3, bevel=0.3, group=group)


@projectile('beaconBarrage', (26, 26), anim=2, frame_ticks=3,
            materials=('brass', 'blue', 'white', 'accent', 'cyan', 'flash'))
def beacon_barrage(a):
    wave = 0.7 if a == 0 else -0.7
    spark = 1.7 if a == 0 else 1.25
    return [
        *dart(1.35, body='blue'),
        wing('wing_up', 1, 1.6, 6.4, mat('brass'), 5),
        wing('wing_dn', -1, 1.6, 6.4, mat('brass'), 5),
        banner('banner', -3.0, -11.0, 1.4, 2.6, wave, mat('accent'), 4),
        ball('storm', (9.2, 0), spark, mat('cyan'), d=1.5, group=GLOW),
        ball('storm_core', (9.2, 0), spark * 0.55, mat('flash'), d=2.2, group=GLOW + 1),
    ]
