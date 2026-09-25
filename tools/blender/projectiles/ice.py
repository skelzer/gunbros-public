"""
Frostbite (`ice`, atlas `frostbite`): faceted crystal, flat shaded so the toon ramp falls
into facets, in the frostbite's own ice blue with white points and its dark boot blue at
the base (a pale body needs something dark under it or it floats).

- `frostShard` (S1 Frost Shard): a hexagonal crystal dart with a white point.
- `glacierShell` (S2 Glacier Shell): a heavy shell hewn from ice: a boot-blue base, a thick
  hexagonal body, a long white faceted nose.
- `icicle` (SS Shatter): a long white icicle, the frostbite's own crystal lance, with a
  crown of crystals splayed back from its dark root and the brow rune pulsing on its side
  (the fuse).
- `iceShard` (the shards Shatter throws): a small white three-sided sliver.
"""
from projectile_kit import GLOW, W, lathe, mat, projectile, roll, turn


def crystal(name, profile, material, group, sides=6, rolled=30.0):
    """A flat-shaded crystal about the flight axis, rolled so a facet faces the camera."""
    return roll(lathe(name, profile, material, seg=sides, group=group, smooth=False), rolled)


def spur(name, at, length, r, deg, material, group, sides=5):
    """A small crystal growing out of `at`, pointing `deg` degrees counter-clockwise from +x."""
    o = crystal(name, [(0, r), (length * 0.55, r * 0.9), (length, 0)], material, group, sides=sides, rolled=18)
    o.location = o.location + W(*at)
    return turn(o, deg, *at)


@projectile('frostShard', (13, 13), materials=('ice', 'white'))
def frost_shard(a):
    return [
        crystal('body', [(-5.0, 0.0), (-2.6, 1.9), (0.4, 1.9)], mat('ice'), 1),
        crystal('tip', [(0.4, 1.9), (5.2, 0.0)], mat('white'), 2),
    ]


@projectile('glacierShell', (18, 18), materials=('ice', 'white', 'boot'))
def glacier_shell(a):
    return [
        crystal('base', [(-6.6, 2.2), (-6.6, 3.2), (-4.8, 3.9)], mat('boot'), 1, sides=6),
        crystal('body', [(-4.8, 4.0), (-0.4, 4.0)], mat('ice'), 2, sides=6),
        crystal('nose', [(-0.4, 4.0), (2.8, 3.0), (7.6, 0.0)], mat('white'), 3, sides=6),
    ]


@projectile('icicle', (26, 26), anim=2, frame_ticks=6, materials=('ice', 'white', 'boot', 'rune'))
def icicle(a):
    objs = [
        crystal('root', [(-8.4, 0.0), (-8.4, 2.4), (-6.6, 4.0)], mat('boot'), 1, sides=6),
        crystal('shaft', [(-6.6, 4.1), (-3.0, 3.8)], mat('ice'), 2),
        crystal('lance', [(-3.0, 3.8), (3.0, 2.4), (11.2, 0.0)], mat('white'), 3),
    ]
    # The crown: crystals round the root, splayed back like the frostbite's crest.
    for k, (deg, y) in enumerate(((145, 2.6), (215, -2.6))):
        objs.append(spur(f'crown{k}', (-6.4, y), 4.2, 1.4, deg, mat('ice'), 5 + k))
    # The rune gem the frostbite wears on its brow, pulsing: the fuse.
    r = 1.6 if a == 0 else 1.1
    gem = crystal('rune', [(-4.6 - r, 0.0), (-4.6, r), (-4.6 + r, 0.0)], mat('rune'), GLOW, sides=4, rolled=45)
    gem.location = gem.location + W(0, 0, 4.0)
    objs.append(gem)
    return objs


@projectile('iceShard', (10, 10), materials=('white', 'ice'))
def ice_shard(a):
    return [
        crystal('sliver', [(-3.6, 0.0), (-2.0, 1.4), (3.8, 0.0)], mat('white'), 1, sides=3, rolled=0),
        crystal('edge', [(-3.2, 0.0), (-2.2, 0.8), (-0.6, 0.0)], mat('ice'), 2, sides=3, rolled=180),
    ]
