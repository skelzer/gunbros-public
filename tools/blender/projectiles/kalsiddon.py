"""
Shrike (`kalsiddon`, atlas `shrike`): the butcher bird's rounds. Blue armour, amber beak,
steel pods with red stripes and a red crest, like the mobile.

- `talon`: s1 Talon, a fast flat round. A hooked amber claw on a blue sabot, the shrike's
  own talon thrown at the target, with a spark at the tail.
- `clusterPod`: s2 Cluster Pod (`split`). A steel pod with the barrel's red stripes and a
  blue nose; four amber bomblets peek out of its open tail, so it reads as "full of
  little bombs" before it comes apart.
- `clusterPodFragment`: one of those bomblets once the pod splits. A small amber ball
  with a red cap and a steel fin cross, tumbling.
- `lance`: ss Siege Lance, a heavy `impact` round. A long faceted steel spearhead with a
  barbed collar, blue shaft, red and amber crest feathers as fletching and a flickering
  exhaust: the biggest thing the bird throws.
"""
from projectile_kit import GLOW, ball, lathe, mat, prism, projectile, roll


def ogive(x0, x1, r, steps=5):
    pts = []
    for k in range(steps + 1):
        t = k / steps
        pts.append((x0 + (x1 - x0) * t, r * (1 - t * t) ** 0.5 if k < steps else 0.0))
    return pts


@projectile('talon', (14, 14), anim=2, frame_ticks=3,
            materials=('blue', 'amber', 'steel', 'lamp', 'flash'))
def talon(a):
    # The claw: a thick hooked blade, curving down to its point, seen from the side.
    claw = [(-2.2, 2.2), (0.4, 2.9), (2.4, 2.6), (4.0, 1.5), (4.9, -0.2), (5.0, -2.4),
            (4.0, -1.2), (2.8, -0.6), (1.0, -1.0), (-2.2, -1.4)]
    flick = 1.0 if a == 0 else 0.7
    return [
        lathe('sabot', [(-4.2, 1.2), (-4.2, 1.9), (-1.0, 2.1), (-0.4, 1.6)], mat('blue'), group=1),
        lathe('ring', [(-3.2, 2.2), (-2.4, 2.2)], mat('steel'), group=3),
        prism('claw', claw, 2.6, mat('amber'), bevel=0.5, group=2),
        ball('spark', (-4.9, 0), 1.2 * flick, mat('lamp'), squash=(1.3, 1, 1), group=GLOW),
        ball('spark_core', (-4.7, 0), 0.7 * flick, mat('flash'), d=1.0, group=GLOW + 1),
    ]


@projectile('clusterPod', (18, 18), materials=('steel', 'blue', 'crimson', 'amber', 'rubber'))
def cluster_pod(a):
    objs = [
        lathe('pod', [(-4.4, 2.6), (-4.4, 3.1), (2.4, 3.1)], mat('steel'), group=1),
        lathe('nose', ogive(2.4, 7.0, 3.1, steps=6), mat('blue'), group=2),
        lathe('stripe0', [(-3.0, 3.35), (-2.1, 3.35)], mat('crimson'), group=3),
        lathe('stripe1', [(0.4, 3.35), (1.3, 3.35)], mat('crimson'), group=3),
        lathe('mouth', [(-5.0, 2.9), (-4.4, 2.9)], mat('rubber'), group=5),
    ]
    # Four bomblets packed in the open tail, poking out past the rim.
    for k, (y, d) in enumerate(((1.35, 0.6), (-1.35, 0.6), (0.0, 1.8), (0.0, -1.8))):
        objs.append(ball(f'bomb{k}', (-5.6, y), 1.5, mat('amber'), d=d, group=6 + (k % 2)))
    return objs


@projectile('clusterPodFragment', (11, 11), mode='spin', frames=4, spin_deg=360.0, frame_ticks=3,
            materials=('amber', 'crimson', 'steel'))
def cluster_fragment(a):
    fins = []
    for k in range(3):
        f = prism(f'fin{k}', [(-0.6, 0.4), (-0.6, -0.4), (-3.4, -1.9), (-3.4, 1.9)], 0.8, mat('steel'),
                  bevel=0.2, group=3)
        roll(f, 120 * k)
        fins.append(f)
    return [
        ball('bomb', (0.4, 0), 2.2, mat('amber'), squash=(1.05, 1, 1), group=1),
        ball('cap', (2.0, 0), 1.3, mat('crimson'), group=2),
        *fins,
    ]


@projectile('lance', (28, 28), anim=2, frame_ticks=3,
            materials=('steel', 'blue', 'crimson', 'amber', 'rubber', 'flame', 'lamp'))
def lance(a):
    flare = 1.0 if a == 0 else 0.72
    objs = [
        lathe('shaft', [(-9.6, 1.5), (-9.6, 2.0), (2.0, 2.0)], mat('blue'), group=1),
        lathe('grip0', [(-3.4, 2.3), (-2.4, 2.3)], mat('crimson'), group=5),
        lathe('collar', [(1.4, 2.5), (1.4, 3.0), (3.0, 3.0), (3.0, 2.4)], mat('amber'), group=3),
        # The spearhead: six flat facets so the toon light breaks it into bright planes.
        lathe('head', [(3.0, 2.4), (4.2, 3.8), (7.5, 2.4), (12.2, 0.0)], mat('steel'), seg=6, smooth=False,
              group=2),
        lathe('nozzle', [(-10.6, 1.7), (-9.6, 1.4)], mat('rubber'), group=6),
        ball('exhaust', (-11.3, 0), 1.6 * flare, mat('flame'), squash=(1.3, 1, 1), group=GLOW),
        ball('exhaust_core', (-10.9, 0), 0.9 * flare, mat('lamp'), d=1.0, group=GLOW + 1),
    ]
    # Crest feathers as fletching: long swept vanes, red outside, amber tips.
    for k in range(3):
        vane = prism(f'vane{k}', [(-9.0, 1.2), (-4.6, 1.2), (-6.4, 3.4), (-9.4, 4.9), (-10.2, 4.4)], 0.9,
                     mat('crimson'), bevel=0.3, group=4)
        tip = prism(f'vtip{k}', [(-9.4, 3.2), (-8.2, 3.5), (-9.4, 4.9), (-10.3, 4.5)], 1.1, mat('amber'),
                    bevel=0.2, group=7)
        roll(vane, 120 * k + 90)
        roll(tip, 120 * k + 90)
        objs += [vane, tip]
    return objs
