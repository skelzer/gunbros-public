"""
Crystal Hollow (`cave`): a painted cavern (DESIGN §8.1), remade from the procedural
cave. Copied from `hills.py`; read that one first.

A mine cut into a crystal cave. Left to right: a timbered tunnel mouth with a broken
support and a mine track running out of it, a raised left terrace, a gentle step down to
a second shelf, a tall stalagmite with a fang hanging over it, the sunken middle of the
hall (a mine cart full of ore on the track, the big crystal outcrop dead centre under a
long stalactite), a second fang and stalagmite, the right shelves, and the right tunnel
mouth. A rock ceiling hangs over all of it, low enough that the camera always shows it
(the camera stops at height - viewHeight = 300 on a desktop, and the underside sits at
370 to 400), with stalactites, hanging crystal clusters, lanterns on chains and a few
bats. Under the floor: a flowstone band, a dark shale band, a crystal vein, ore
nuggets, a geode, a lost miner and an ammonite.

The tactical idea: the roof takes the lob away. A shot that climbs more than about 250
px bursts in the ceiling, so the match is played in flat, direct shots through the
"windows" between the fangs hanging from the roof and the stalagmites and crystals
growing from the floor. Every one of them can be shot away, so the lines of fire open
up as the match goes on; the crystal outcrop in the middle is the big one.

Spawn slots (1800 px wide, 10 % margins): 2 seats from 540 and 1260, 4 from 360, 720,
1080 and 1440, 8 every 180 px from 270. Shelves: A 280-400 (y 651), B 490-605 (y 667),
C 690-760 (y 701), D 1040-1118 (y 700), E 1210-1318 (y 665), F 1400-1485 (y 648). No
stalactite tip comes within 130 px of a shelf, and nothing stands on one.

Sequence of passes: tools/blender/iterations/maps/cave/.
"""
import math

import map_kit as K

M = K.define(
    'cave',
    size=(1800, 900),
    # The void behind the plates: near black at the roof, a violet haze at floor level.
    sky=['#0b0a18', '#14112a', '#1e1a3b', '#2a2450'],
    outline='#0e0b16',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
# Terrain budget 48: 10 ramps + outline + lamp = 42.
M.ramp('rock', ['#3d3654', '#5b5476', '#7f789c', '#aca6c8'], mottle=('rockdark', 18, 0.22))
M.ramp('rockdark', ['#221e33', '#322c48', '#453f5f', '#5d5679'])
M.ramp('flow', ['#6e5e58', '#9a887a', '#c6b39c', '#eadbc2'])
M.ramp('crystal', ['#1d6a96', '#32a4cf', '#6fdcef', '#d6fbff'])
M.ramp('amethyst', ['#55287f', '#8743bd', '#b977e6', '#eec6ff'])
M.ramp('glowrock', ['#34507a', '#46709c', '#5f96bd', '#8ec3dc'])
M.ramp('wood', ['#3a2416', '#5e3c22', '#8a5a32', '#b8844e'])
M.ramp('iron', ['#2c2e37', '#4b4f5b', '#737886', '#a7adba'])
M.ramp('ore', ['#7a4c12', '#b77c1e', '#e8b33a', '#fff09a'])
M.ramp('moss', ['#1d5648', '#2c8766', '#58cc98', '#b4ffd0'])
M.flat('lamp', '#ffd35a')

LIP = 6          # radius of the flowstone lip along the floor; the walking surface is FLOOR - LIP

FLOOR_POINTS = [
    (-20, 700), (40, 700), (110, 698),                    # left tunnel
    (160, 690), (205, 674), (250, 658),                   # ramp up into the hall
    (280, 652), (330, 650), (400, 651),                   # shelf A (4 seats, 360)
    (430, 655), (462, 662),                               # gentle step down
    (490, 666), (545, 667), (605, 665),                   # shelf B (2 seats, 540)
    (640, 673), (672, 689),                               # down past the west stalagmite
    (692, 699), (722, 702), (760, 701),                   # shelf C (4 seats, 720)
    (792, 706), (835, 712), (905, 717), (975, 712),       # the sunken middle
    (1012, 706), (1042, 701), (1080, 700), (1118, 699),   # shelf D (4 seats, 1080)
    (1142, 690), (1172, 677), (1198, 668),
    (1212, 665), (1262, 664), (1318, 666),                # shelf E (2 seats, 1260)
    (1346, 660), (1376, 652),
    (1402, 648), (1440, 647), (1486, 648),                # shelf F (4 seats, 1440)
    (1520, 656), (1562, 670), (1610, 686), (1660, 694),   # down to
    (1720, 698), (1820, 698),                             # the right tunnel
]

CEIL_POINTS = [
    (-20, 578), (50, 576), (115, 566),                    # left tunnel roof
    (160, 520), (205, 452), (255, 408), (300, 390),
    (370, 378), (450, 384), (540, 370), (640, 388), (720, 374), (810, 392), (905, 402),
    (1000, 390), (1085, 374), (1180, 386), (1262, 370), (1350, 382), (1440, 376),
    (1505, 396), (1555, 432), (1600, 488), (1645, 544),
    (1690, 566), (1750, 572), (1820, 574),                # right tunnel roof
]


def floor():
    return K.smooth(FLOOR_POINTS, step=3.0)


def ceil():
    return K.smooth(CEIL_POINTS, step=3.0)


def ground_y(x):
    """The walking surface at column x (the top of the flowstone lip)."""
    return K.height_at(floor(), x) - LIP


def roof_y(x):
    return K.height_at(ceil(), x)


@M.terrain
def terrain(k):
    mat = k.mat
    fl = floor()
    ce = ceil()
    r = K.rng(1)

    # --- the floor: body, strata, bedrock ---------------------------------------
    K.ground('slab', fl, mat('rock'), 1, depth=90)
    K.stratum('flowband', fl, 16, 12, mat('flow'), 2, follow=1.0, seed=2, pinch=0.35, min_cover=12)
    K.stratum('shale', fl, 60, 34, mat('rockdark'), 3, follow=0.55, datum=700, dip=0.02, seed=3, pinch=0.35,
              min_cover=44)
    K.stratum('vein', fl, 118, 7, mat('glowrock'), 4, follow=0.4, datum=700, dip=-0.03, seed=4, pinch=0.6,
              min_cover=96)
    K.stratum('flow2', fl, 150, 16, mat('flow'), 2, follow=0.3, datum=700, dip=0.025, seed=5, pinch=0.5,
              min_cover=130)
    w_deep = K.wobble(7, 14, 260)
    deep = [(x, max(y + 175, 880 + w_deep(x))) for x, y in fl]
    K.ground('bedrock', deep, mat('rockdark'), 5, depth=40, d_front=2.5)

    # --- the ceiling: a slab from above the map down to the underside -------------
    K.prism('roof', [(-30, -30), (1830, -30)] + list(reversed(ce)), -90, 0, mat('rock'), 1)
    # Bands in the roof run along the underside, a pixel proud like the strata below.
    for i, (a, b, m, g, seed) in enumerate(((10, 22, 'flow', 2, 11), (44, 78, 'rockdark', 3, 12),
                                             (120, 128, 'glowrock', 4, 13), (170, 200, 'rockdark', 3, 14),
                                             (250, 262, 'flow', 2, 15))):
        wa, wb = K.wobble(seed, 7, 210), K.wobble(seed + 50, 6, 170)
        upper = [(x, y - b - wa(x)) for x, y in ce]
        lower = [(x, y - a - wb(x)) for x, y in ce]
        # Pinch the thin ones into lenses: drop stretches where the band closes up.
        runs, run = [], []
        wp = K.wobble(seed + 90, 1.0, 380)
        for (ux, uy), (_, ly) in zip(upper, lower):
            if (b - a) > 20 or wp(ux) > -0.25:
                run.append(((ux, uy), (ux, ly)))
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
        for j, rr in enumerate(runs):
            if len(rr) > 3:
                K.band(f'roofband{i}_{j}', [u for u, _ in rr], [l_ for _, l_ in rr], -30, 1.5, mat(m), g)

    # Pebbles and ore in both slabs; big boulders locked into the bedrock.
    for i in range(150):
        x = r.uniform(0, k.width)
        below = r.uniform(26, 240)
        y = K.height_at(fl, x) + below
        m = 'ore' if r.random() < 0.12 else 'rockdark' if r.random() < 0.5 else 'flow'
        K.rock(f'pebble{i}', x, y, r.uniform(3, 6) + below / 90, mat(m), 6, d=2.5, seed=100 + i,
               squash=(1.2, 0.5, 0.85))
    for i in range(110):
        x = r.uniform(0, k.width)
        above = r.uniform(24, 360)
        y = K.height_at(ce, x) - above
        if y < -10:
            continue
        m = 'ore' if r.random() < 0.1 else 'rockdark' if r.random() < 0.5 else 'flow'
        K.rock(f'roofpebble{i}', x, y, r.uniform(3, 7), mat(m), 6, d=2.5, seed=300 + i, squash=(1.2, 0.5, 0.85))
    for i in range(24):
        x = r.uniform(0, k.width)
        y = K.height_at(deep, x) + r.uniform(12, 60)
        K.rock(f'boulder{i}', x, y, r.uniform(9, 18), mat('rock'), 6, d=3.5, seed=500 + i, squash=(1.3, 0.45, 0.9))

    flow_edge(k, fl)
    roof_edge(k, ce)
    track(k)
    fangs(k)
    outcrop(k)
    mine_cart(k, 826)
    supports(k)
    lanterns(k)
    bats(k)
    buried(k)
    shrooms(k)
    stores(k)


def flow_edge(k, fl):
    """
    The floor's walkable top: a rounded flowstone lip (walkable by construction, like
    map_kit.grass_edge) with a skirt that hangs over the rock in drips, patches of
    glowing moss on its face and 2 to 3 px knobs on the silhouette.
    """
    mat = k.mat
    r = K.rng(8)
    K.tube('lip', [(x, y, 1.0) for x, y in fl], LIP, mat('flow'), 8, resolution=3)
    hem = [(x, y + 7 + 7 * abs(math.sin(x * math.pi / 17)) ** 3 + 4 * abs(math.sin(x * math.pi / 41)))
           for x, y in fl]
    K.band('skirt', K.offset(fl, 1), hem, -8, 2.0, mat('flow'), 8)
    x = fl[0][0] + 6
    while x < fl[-1][0] - 6:
        y = K.height_at(fl, x)
        if abs(K.slope_at(fl, x)) < 1.0 and r.random() < 0.35:
            K.blob(f'knob{int(x)}', x, y - LIP + 0.5, r.uniform(2.5, 4), r.uniform(1.5, K.WALK_BUMP_PX), mat('flow'), 9,
                   d=0, segments=10, rings=5)
        if r.random() < 0.22:
            mx = x + r.uniform(-4, 4)
            my = K.height_at(fl, mx) + r.uniform(4, 9)
            K.blob(f'moss{int(x)}', mx, my, r.uniform(4, 8), r.uniform(2, 3.5), mat('moss'), 9, d=LIP + 2,
                   segments=12, rings=6)
        if r.random() < 0.16:
            cx_ = x + r.uniform(-4, 4)
            K.crystal(f'lipshard{int(x)}', cx_, K.height_at(fl, cx_) + 9, r.uniform(7, 10), 2.2, r.uniform(-35, 35),
                      mat('crystal' if r.random() < 0.6 else 'amethyst'), 9, d=LIP + 3, spin=r.uniform(0, 60))
        elif r.random() < 0.2:
            px_ = x + r.uniform(-4, 4)
            K.rock(f'lippebble{int(x)}', px_, K.height_at(fl, px_) + r.uniform(4, 9), r.uniform(2.5, 3.5), mat('rock'), 9,
                   d=LIP + 2, seed=int(x) * 3, squash=(1.2, 0.6, 0.8))
        x += r.uniform(8, 15)


def roof_edge(k, ce):
    """The underside of the roof: a rounded rim, and small drips hanging all along it."""
    mat = k.mat
    r = K.rng(9)
    K.tube('rim', [(x, y, 1.0) for x, y in ce], 5, mat('rock'), 8, resolution=3)
    x = ce[0][0] + 10
    i = 0
    while x < ce[-1][0] - 10:
        y = K.height_at(ce, x)
        K.spire(f'drip{i}', x, y + 2, r.uniform(8, 30), r.uniform(3.5, 7), mat('rock' if i % 3 else 'flow'),
                9 + i % 2, d=r.uniform(-2, 3), seed=1000 + i, segments=7, rings=2)
        x += r.uniform(18, 42)
        i += 1


def track(k):
    """A mine track: sleepers flush with the floor, a rail 2 px proud of it (walkable)."""
    mat = k.mat
    fl = floor()
    for j, (x0, x1) in enumerate(((0, 262), (640, 1150), (1545, 1800))):
        x = x0 + 4
        while x < x1 - 4:
            y = K.height_at(fl, x)
            s = K.slope_at(fl, x, 8)
            a = math.atan(s)
            ca, sa = math.cos(a), math.sin(a)
            poly = [(x - 5 * ca + dy * -sa, y - 5 * sa + dy * ca) for dy in (-LIP + 1,)] + \
                   [(x + 5 * ca + dy * -sa, y + 5 * sa + dy * ca) for dy in (-LIP + 1,)] + \
                   [(x + 5 * ca + dy * -sa, y + 5 * sa + dy * ca) for dy in (3,)] + \
                   [(x - 5 * ca + dy * -sa, y - 5 * sa + dy * ca) for dy in (3,)]
            K.prism(f'sleeper{j}_{int(x)}', poly, -4, LIP + 3, mat('wood'), 10 + (int(x) // 16) % 2, bevel=0.8)
            x += 16
        rail = [(x, y - LIP - 0.5, LIP + 2) for x, y in K.clip(fl, x0, x1)]
        K.tube(f'rail{j}', rail, 1.7, mat('iron'), 12, resolution=1)


def fangs(k):
    """
    The teeth of the hall: long stalactites from the roof and stalagmites from the
    floor. The big pairs stand between the shelves, never over one (130 px clear over
    every shelf), so they make windows for a direct shot rather than walls.
    """
    mat = k.mat
    r = K.rng(12)
    # (x, length, radius), hanging from the roof.
    for i, (x, length, rad) in enumerate(((300, 62, 14), (455, 138, 24), (525, 44, 11), (640, 150, 27),
                                          (770, 70, 15), (905, 112, 22), (1000, 58, 13), (1160, 140, 25),
                                          (1335, 104, 20), (1530, 90, 18), (1600, 50, 13), (345, 34, 9),
                                          (590, 40, 10), (860, 36, 10), (1230, 40, 11), (1400, 36, 10))):
        y = roof_y(x)
        K.spire(f'tite{i}', x, y + 2, length, rad, mat('rock'), 13 + i % 2, d=r.uniform(-3, 4), seed=60 + i,
                segments=8, rings=4, bulge=0.2)
        # A flowstone tip on the lower half: the drip end, pale against the rock.
        K.spire(f'tite{i}_tip', x, y + 2 + length * 0.42, length * 0.58, rad * 0.64, mat('flow'), 15,
                d=r.uniform(4, 8), seed=80 + i, segments=8, rings=2, bulge=0.1)
    # (x, height, radius), standing on the floor.
    for i, (x, h, rad) in enumerate(((195, 40, 14), (442, 34, 14), (652, 58, 20), (671, 28, 11), (1154, 50, 18),
                                     (1170, 26, 10), (1352, 30, 12), (1600, 38, 14), (1622, 22, 9))):
        y = ground_y(x) + 6
        K.spire(f'mite{i}', x, y, h + 6, rad, mat('rock'), 16 + i % 2, d=r.uniform(-2, 4), hanging=False,
                seed=160 + i, segments=8, rings=3, bulge=0.2)
        K.spire(f'mite{i}_cap', x, y - h * 0.45, h * 0.55 + 1, rad * 0.62, mat('flow'), 18, d=r.uniform(4, 8),
                hanging=False, seed=180 + i, segments=8, rings=2, bulge=0.1)


def glow(name, x, y, rx, ry, k):
    """Rock lit by a crystal: a pale patch sunk into the face behind a cluster."""
    K.blob(name, x, y, rx, ry, k.mat('glowrock'), 7, d=-rx * 0.55, rd=rx * 0.6, segments=20, rings=10)


def outcrop(k):
    """
    The crystals. The big outcrop in the middle of the hall, clusters hanging from the
    roof, and smaller ones growing out of the slopes and the walls. All terrain.
    """
    mat = k.mat
    cx = 905
    g = ground_y(cx)
    # The mound the outcrop grows from.
    for i, (dx, dy, rr) in enumerate(((0, -8, 24), (-26, -2, 16), (24, -2, 17), (-12, -20, 13), (14, -18, 12))):
        K.rock(f'mound{i}', cx + dx, g + dy, rr, mat('rock'), 19 + i % 2, d=6, seed=600 + i, squash=(1.2, 0.8, 0.8))
    K.crystal_cluster('outcrop_a', cx - 4, g - 18, 66, mat('amethyst'), 21, d=12, angle=-6, spread=100, count=5,
                      seed=7, materials=[mat('amethyst'), mat('crystal')])
    K.crystal_cluster('outcrop_b', cx + 22, g - 10, 36, mat('crystal'), 22, d=18, angle=38, spread=50, count=3,
                      seed=8)
    K.crystal_cluster('outcrop_c', cx - 30, g - 8, 30, mat('crystal'), 22, d=16, angle=-44, spread=40, count=3,
                      seed=9)
    # Clusters hanging from the roof.
    for i, (x, size, m) in enumerate(((382, 40, 'crystal'), (765, 46, 'amethyst'), (1215, 44, 'crystal'),
                                      (1472, 38, 'amethyst'), (120, 30, 'crystal'), (1700, 30, 'amethyst'))):
        y = roof_y(x) - 2
        K.crystal_cluster(f'roofcrystal{i}', x, y, size, mat(m), 21 + i % 2, d=8, angle=180, spread=80, count=4,
                          seed=20 + i)
    # Clusters growing out of the floor where nobody stands: slopes and stalagmite feet.
    for i, (x, size, ang, m) in enumerate(((232, 26, -30, 'amethyst'), (628, 28, -20, 'crystal'),
                                           (1188, 30, 25, 'amethyst'), (1535, 26, 30, 'crystal'),
                                           (1575, 20, 10, 'amethyst'))):
        y = ground_y(x) + 4
        glow(f'floorglow{i}', x, y + size * 0.5, size * 0.9, size * 0.45, k)
        K.crystal_cluster(f'floorcrystal{i}', x, y, size, mat(m), 21 + i % 2, d=10, angle=ang, spread=60, count=3,
                          seed=40 + i)
    # Big clusters bursting out of the tunnel walls, half buried in the rock.
    for i, (x, dy, size, ang, m) in enumerate(((222, 30, 44, -50, 'amethyst'), (1548, 26, 46, 48, 'crystal'))):
        y = ground_y(x) + dy
        glow(f'wallglow{i}', x, y, size * 0.9, size * 0.7, k)
        K.crystal_cluster(f'wallcrystal{i}', x, y, size, mat(m), 21 + i % 2, d=6, angle=ang, spread=90, count=5,
                          seed=60 + i, materials=[mat(m), mat('crystal' if m == 'amethyst' else 'amethyst')])
    # Crystals caught in the rock: in the floor's cross-section and in the roof.
    r = K.rng(33)
    for i in range(16):
        x = 60 + i * 110 + r.uniform(-30, 30)
        y = K.height_at(floor(), x) + r.uniform(60, 190)
        size = r.uniform(12, 22)
        glow(f'seamglow{i}', x, y, size * 1.1, size * 0.8, k)
        K.crystal_cluster(f'seam{i}', x, y + size * 0.3, size, mat('crystal' if i % 2 else 'amethyst'), 11, d=2,
                          angle=r.uniform(-40, 40), spread=70, count=3, seed=70 + i)
    for i in range(12):
        x = 100 + i * 145 + r.uniform(-30, 30)
        y = roof_y(x) - r.uniform(40, 200)
        size = r.uniform(12, 20)
        glow(f'roofseamglow{i}', x, y, size * 1.1, size * 0.8, k)
        K.crystal_cluster(f'roofseam{i}', x, y - size * 0.3, size, mat('amethyst' if i % 2 else 'crystal'), 11, d=2,
                          angle=180 + r.uniform(-40, 40), spread=70, count=3, seed=90 + i)


def mine_cart(k, cx):
    """An ore cart on the track, heaped with ore and crystals: cover in the sunken middle."""
    mat = k.mat
    g = ground_y(cx) - 1
    K.prism('cart_body', [(cx - 28, g - 36), (cx + 28, g - 36), (cx + 22, g - 9), (cx - 22, g - 9)], -12, 16,
            mat('iron'), 23, bevel=1.5)
    K.box('cart_rim', cx - 31, g - 40, cx + 31, g - 34, -14, 18, mat('iron'), 24, bevel=1.2)
    for i, bx in enumerate((cx - 14, cx + 11)):
        K.box(f'cart_rib{i}', bx, g - 34, bx + 4, g - 10, 16, 18, mat('wood'), 25)
    K.box('cart_band', cx - 25, g - 24, cx + 25, g - 20, 16, 18, mat('wood'), 25)
    for i, wx in enumerate((cx - 14, cx + 14)):
        K.log(f'cart_wheel{i}', wx, g - 7, 7.5, 10, 20, mat('iron'), 24)
        K.log(f'cart_hub{i}', wx, g - 7, 2.5, 20, 22, mat('ore'), 25)
    # The load: ore lumps and a few crystals poking out.
    r = K.rng(44)
    for i in range(7):
        K.rock(f'cart_ore{i}', cx - 20 + i * 6.5 + r.uniform(-2, 2), g - 42 - r.uniform(0, 6), r.uniform(6, 8.5),
               mat('ore' if i % 3 else 'rockdark'), 26, d=4, seed=450 + i, squash=(1.1, 0.8, 0.8))
    K.crystal_cluster('cart_crystal', cx + 6, g - 44, 20, mat('crystal'), 25, d=10, angle=10, spread=60, count=3,
                      seed=46)


def supports(k):
    """
    Mine timbers at the two tunnel mouths: a cap beam under the roof with a knee brace
    into the wall and a post snapped off half way down (a whole post would wall the
    tunnel off from the hall), and the lost half lying on the tunnel floor.
    """
    mat = k.mat
    for side, (x0, x1, post, fallen) in enumerate(((-10, 122, 112, (46, 86)), (1680, 1810, 1700, (1726, 1766)))):
        y = max(roof_y(x) for x in range(int(max(0, x0)), int(min(1799, x1)), 6)) + 4
        top_edge = [(x, min(y - 12, roof_y(x) - 6)) for x in range(int(x0), int(x1) + 1, 6)]
        K.prism(f'cap{side}', top_edge + [(top_edge[-1][0], y), (top_edge[0][0], y)], -10, 14, mat('wood'), 10,
                bevel=1.5)
        for j, bx in enumerate(range(int(x0) + 20, int(x1) - 10, 34)):
            K.box(f'cap{side}_plank{j}', bx, y - 13, bx + 3, y - 1, 14, 15, mat('wood'), 11)
        # The standing stump of the post, hanging from the cap, ending in a splinter.
        top, bot = y, y + 44
        K.prism(f'post{side}', [(post - 6, top - 2), (post + 6, top - 2), (post + 6, bot - 4), (post + 3, bot + 2),
                                (post, bot - 6), (post - 3, bot + 1), (post - 6, bot - 6)], -6, 12, mat('wood'),
                11, bevel=1.0)
        # Knee brace from the cap into the tunnel wall side.
        bx = x1 - 20 if side == 0 else x0 + 20
        K.prism(f'brace{side}', [(bx - 4, y), (bx + 4, y), (bx + (26 if side == 0 else -26) + 4, y - 30),
                                 (bx + (26 if side == 0 else -26) - 4, y - 30)], -4, 10, mat('wood'), 12)
        # The fallen half, lying across the track.
        fx0, fx1 = fallen
        gy0, gy1 = ground_y(fx0), ground_y(fx1)
        K.prism(f'fallen{side}', [(fx0, gy0 - 1), (fx1, gy1 - 16), (fx1 + 3, gy1 - 7), (fx0 + 2, gy0 + 6)], -2, 14,
                mat('wood'), 12, bevel=1.0)


def lanterns(k):
    """Oil lamps hung from the roof on chains: warm light against all that blue."""
    mat = k.mat
    for i, (x, drop) in enumerate(((282, 70), (722, 96), (1080, 92), (1560, 52))):
        top = roof_y(x) - 4
        y = top + drop
        for j in range(int(drop // 7)):
            K.blob(f'lamp{i}_link{j}', x, top + 4 + j * 7, 2.2, 3.4, mat('iron'), 12 + j % 2, d=6, segments=8, rings=4)
        K.box(f'lamp{i}_cap', x - 8, y - 4, x + 8, y + 1, 2, 12, mat('iron'), 23, bevel=1.0)
        K.box(f'lamp{i}_glass', x - 6, y + 1, x + 6, y + 15, 4, 10, mat('lamp'), 26)
        K.box(f'lamp{i}_base', x - 8, y + 15, x + 8, y + 19, 2, 12, mat('iron'), 23, bevel=1.0)
        for j, bx in enumerate((x - 7, x + 5)):
            K.box(f'lamp{i}_bar{j}', bx, y + 1, bx + 2, y + 15, 10, 11, mat('iron'), 24)


def bats(k):
    """Three chibi bats asleep on the roof, wings wrapped round them."""
    mat = k.mat
    for i, x in enumerate((560, 1030, 1290)):
        top = roof_y(x) - 2
        K.tube(f'bat{i}_feet', [(x - 2, top, 4), (x, top + 5, 4), (x + 2, top, 4)], 1.5, mat('rockdark'), 12,
               resolution=1)
        body_y = top + 15
        K.blob(f'bat{i}_body', x, body_y, 8, 11, mat('rockdark'), 24, d=6)
        K.prism(f'bat{i}_wingl', [(x - 3, top + 5), (x - 13, top + 9), (x - 11, top + 17), (x - 13, top + 24),
                                  (x - 4, top + 27)], 8, 14, mat('rockdark'), 25, bevel=1.0)
        K.prism(f'bat{i}_wingr', [(x + 3, top + 5), (x + 13, top + 9), (x + 11, top + 17), (x + 13, top + 24),
                                  (x + 4, top + 27)], 8, 14, mat('rockdark'), 25, bevel=1.0)
        # Upside down: ears at the bottom, a sleepy face just above them.
        for s in (-1, 1):
            K.prism(f'bat{i}_ear{s}', [(x + s * 2, top + 24), (x + s * 7, top + 24), (x + s * 6, top + 31)], 6, 12,
                    mat('rockdark'), 24)
        K.box(f'bat{i}_eyes', x - 4, top + 19, x + 4, top + 21, 14, 16, mat('lamp'), 26)


def buried(k):
    """The floor's secrets: a lost miner with his pick, a geode, an ammonite, a gold seam."""
    mat = k.mat
    fl = floor()
    # The miner, lying under shelf B: a big chibi skull under a yellow helmet with a lamp.
    bx, by = 520, K.height_at(fl, 520) + 96
    K.blob('miner_skull', bx, by, 13, 11, mat('flow'), 12, d=4, rd=8)
    K.blob('miner_jaw', bx + 4, by + 9, 8, 4.5, mat('flow'), 12, d=4, rd=6)
    K.blob('miner_eye', bx + 4, by - 1, 3.5, 4, mat('rockdark'), 13, d=11, segments=10, rings=5)
    K.blob('miner_helmet', bx - 2, by - 8, 15, 9, mat('ore'), 14, d=5, rd=10)
    K.box('miner_brim', bx - 18, by - 5, bx + 13, by - 2, -4, 14, mat('ore'), 14)
    K.box('miner_lamp', bx + 8, by - 14, bx + 14, by - 7, 12, 16, mat('lamp'), 15)
    K.tube('miner_spine', [(bx - 12, by + 4, 4), (bx - 38, by + 8, 4), (bx - 66, by + 5, 4)], 3.0, mat('flow'), 12,
           resolution=1)
    for j in range(4):
        rx = bx - 22 - j * 10
        K.tube(f'miner_rib{j}', [(rx + 2, by - 5, 4), (rx - 3, by + 6, 4), (rx, by + 18, 4)], 2.4, mat('flow'), 12,
               resolution=1)
    # His pick, dropped beside him.
    px, py = bx + 40, by + 4
    K.tube('pick_handle', [(px - 16, py + 16, 6), (px + 12, py - 14, 6)], 2.4, mat('wood'), 13, resolution=1)
    K.prism('pick_head', [(px + 1, py - 20), (px + 12, py - 18), (px + 26, py - 6), (px + 13, py - 13),
                          (px + 4, py - 12), (px - 6, py - 6), (px - 2, py - 16)], 4, 10, mat('iron'), 14, bevel=0.8)
    # A geode under the middle: a dark rind and amethyst points all round the inside.
    gx, gy = 960, K.height_at(fl, 960) + 122
    K.blob('geode_rind', gx, gy, 32, 25, mat('rockdark'), 12, d=-6, rd=14)
    K.blob('geode_inner', gx, gy, 24, 17, mat('glowrock'), 13, d=-2, rd=8)
    for j in range(10):
        a = math.tau * j / 10
        K.crystal(f'geode_pt{j}', gx + math.cos(a) * 24, gy + math.sin(a) * 17, 13, 3.2,
                  math.degrees(math.atan2(-math.cos(a), math.sin(a))),
                  mat('amethyst'), 14, d=4, spin=j * 17)
    # An ammonite in the lower flowstone band under the right shelves.
    ax, ay = 1390, K.height_at(fl, 1390) + 160
    pts = [(ax + math.cos(t) * (3 + t * 2.1), ay + math.sin(t) * (3 + t * 2.1), 4) for t in [i * 0.35 for i in range(28)]]
    K.tube('ammonite', pts, 2.6, mat('flow'), 12, resolution=1)
    # A gold seam: a string of nuggets along a crack under the left terrace.
    r = K.rng(55)
    for j in range(12):
        x = 300 + j * 9 + r.uniform(-2, 2)
        y = K.height_at(fl, x) + 150 + j * 3.5 + r.uniform(-3, 3)
        K.rock(f'gold{j}', x, y, r.uniform(4, 6.5), mat('ore'), 13, d=2.5, seed=800 + j, squash=(1.1, 0.5, 0.9))
    # A second lode, in the roof above the right shelves.
    for j in range(10):
        x = 1360 + j * 10 + r.uniform(-2, 2)
        y = roof_y(x) - 60 - j * 3 + r.uniform(-3, 3)
        K.rock(f'roofgold{j}', x, y, r.uniform(4, 6.5), mat('ore'), 13, d=2.5, seed=820 + j, squash=(1.1, 0.5, 0.9))


def stores(k):
    """Miners' clutter in the tunnels: crates, a barrel, an ore heap, tools, a sign."""
    mat = k.mat
    # Left tunnel: two crates and a barrel (kept low: the tunnel roof is close).
    for i, (x, w, lift) in enumerate(((30, 30, 0), (62, 26, 0))):
        g = ground_y(x + w / 2) + 2 - lift
        K.box(f'crate{i}', x, g - w + 2, x + w, g, -8, 14, mat('wood'), 19 + i % 2, bevel=1.5)
        K.prism(f'crate{i}_x', [(x + 3, g - 5), (x + 7, g - 2), (x + w - 3, g - w + 7), (x + w - 7, g - w + 4)], 14, 16,
                mat('wood'), 21)
        K.box(f'crate{i}_band', x, g - w + 2, x + w, g - w + 6, 14, 16, mat('iron'), 22)
    bx = 150
    g = ground_y(bx) + 2
    K.lathe('barrel', bx, 4, [(9, g - 28), (11.5, g - 22), (12.5, g - 14), (11.5, g - 6), (9, g)], mat('wood'), 23,
            segments=14)
    for j, yy in enumerate((g - 23, g - 7)):
        K.lathe(f'barrel_hoop{j}', bx, 4, [(11.9, yy), (12.9, yy + 2), (12.9, yy + 3.5), (11.9, yy + 5)], mat('iron'),
                24, segments=14)
    # Right tunnel: a heap of ore with a shovel stuck in it, and a pick leaning on the wall.
    r = K.rng(66)
    hx = 1760
    g = ground_y(hx)
    for i in range(9):
        K.rock(f'heap{i}', hx + r.uniform(-24, 24) * (1 - i / 12), g - 4 - i * 2.2, r.uniform(7, 10),
               mat('ore' if i % 3 == 0 else 'rockdark' if i % 3 == 1 else 'rock'), 19 + i % 2, d=4, seed=860 + i,
               squash=(1.2, 0.8, 0.8))
    K.tube('shovel_shaft', [(hx + 4, g - 20, 12), (hx + 16, g - 58, 12)], 2.2, mat('wood'), 21, resolution=1)
    K.prism('shovel_blade', [(hx - 2, g - 22), (hx + 8, g - 26), (hx + 10, g - 14), (hx + 2, g - 6), (hx - 4, g - 12)],
            8, 14, mat('iron'), 22, bevel=0.8)
    # A sign on the slope below shelf F: a board with a crossed-picks mark.
    sx = 1508
    g = ground_y(sx) + 4
    K.box('sign_post', sx - 2.5, g - 50, sx + 2.5, g + 6, 6, 11, mat('wood'), 19, bevel=0.8)
    K.prism('sign_board', [(sx - 18, g - 30), (sx + 18, g - 30), (sx + 18, g - 48), (sx, g - 60), (sx - 18, g - 48)],
            11, 15, mat('wood'), 20, bevel=1.2)
    for s_ in (-1, 1):
        K.prism(f'sign_pick{s_}', [(sx - 10 * s_, g - 50), (sx - 7 * s_, g - 51), (sx + 10 * s_, g - 35),
                                   (sx + 7 * s_, g - 34)], 15, 16, mat('iron'), 22)


def shrooms(k):
    """Glowing mushrooms where nobody stands: on slopes and round stalagmite feet."""
    mat = k.mat
    for i, (x, h, rr) in enumerate(((175, 11, 9), (188, 7, 6), (455, 8, 7), (628, 12, 10), (1140, 10, 9),
                                    (1182, 7, 6), (1365, 9, 8), (1585, 12, 10), (1630, 7, 6))):
        g = ground_y(x) + 3
        K.cylinder(f'shroom{i}_stem', x, g - h, g + 3, rr * 0.33, mat('flow'), 24, d=12, vertices=8)
        K.blob(f'shroom{i}_cap', x, g - h, rr, rr * 0.6, mat('moss'), 25, d=12, segments=12, rings=6)
        K.blob(f'shroom{i}_dot', x - rr * 0.3, g - h - rr * 0.35, 1.6, 1.4, mat('flow'), 26, d=12 + rr * 0.8,
               segments=6, rings=3)


# ---------------------------------------------------------------------------------
# Plates, far to near. The camera over this map almost always sits at its lowest
# (oy = 300 on a desktop), so a plate is laid out for that camera: `Y(P, y)` is the
# plate row drawn behind map row y there. The roof of every plate runs from its top row
# down, so no plate edge ever shows when the camera follows a shell up.
# ---------------------------------------------------------------------------------

def Y(P, y):
    return (y - 300) + 300 * P.parallax


def cave_layer(P, name, roof, floor_, mats, groups, seed, tite=(30, 90), mite=(20, 60), tite_every=(40, 90),
               mite_every=(50, 110), d=0):
    """A roof and a floor for a plate, with spires hanging from one and standing on the other."""
    r = K.rng(seed)
    roof_pts = K.smooth([(x, Y(P, y)) for x, y in roof], 4)
    floor_pts = K.smooth([(x, Y(P, y)) for x, y in floor_], 4)
    K.prism(f'{name}_roof', [(-20, -20), (P.width + 20, -20)] + list(reversed(roof_pts)), d - 40, d, mats[0],
            groups[0], bevel=3)
    K.ground(f'{name}_floor', floor_pts, mats[0], groups[0], depth=40, bottom=P.height + 10, d_front=d, bevel=3)
    x = r.uniform(-10, 30)
    i = 0
    while x < P.width + 20:
        K.spire(f'{name}_tite{i}', x, K.height_at(roof_pts, x) + 2, r.uniform(*tite), r.uniform(6, 16), mats[1],
                groups[1] + i % 2, d=d + 4, seed=seed * 100 + i, segments=7, rings=3)
        x += r.uniform(*tite_every)
        i += 1
    x = r.uniform(-10, 30)
    while x < P.width + 20:
        K.spire(f'{name}_mite{i}', x, K.height_at(floor_pts, x) + 3, r.uniform(*mite), r.uniform(6, 15), mats[1],
                groups[1] + i % 2, d=d + 4, hanging=False, seed=seed * 100 + i, segments=7, rings=3)
        x += r.uniform(*mite_every)
        i += 1
    return roof_pts, floor_pts


M.ramp('far', ['#1a1830', '#201d38', '#262241', '#2e294c'])
M.ramp('farglow', ['#28415f', '#2f5170', '#386382', '#457794'])


@M.plate('depths', parallax=0.12, outline='#141225')
def depths(P):
    """The far end of the cavern: huge columns fading into the dark, a few faint glints."""
    mat = P.spec.mat
    r = K.rng(71)
    xs = range(-40, P.width + 120, 40)
    roof = [(x, 432 + 26 * math.sin(x / 50)) for x in xs]
    floor_ = [(x, 640 - 16 * math.sin(x / 38 + 1)) for x in xs]
    roof_pts, floor_pts = cave_layer(P, 'd', roof, floor_, (mat('far'), mat('far')), (1, 2), 3, tite=(20, 60),
                                     mite=(14, 40))
    # Columns: a stalactite and a stalagmite grown together.
    for i, x in enumerate(range(40, P.width, 150)):
        x += r.uniform(-30, 30)
        top, bot = K.height_at(roof_pts, x), K.height_at(floor_pts, x)
        w = r.uniform(12, 20)
        K.lathe(f'col{i}', x, -10, [(w * 1.6, top - 4), (w * 0.8, top + (bot - top) * 0.3), (w * 0.55, (top + bot) / 2),
                                    (w * 0.8, bot - (bot - top) * 0.3), (w * 1.7, bot + 4)], mat('far'), 3,
                segments=9, smooth_shade=False)
    for i in range(14):
        x = r.uniform(0, P.width)
        y = r.choice((K.height_at(roof_pts, x) + 4, K.height_at(floor_pts, x) - 2))
        K.crystal(f'glint{i}', x, y, r.uniform(8, 14), 2.5, 180 if y < P.height / 2 else r.uniform(-30, 30),
                  mat('farglow'), 4, d=4)


M.ramp('hall', ['#1e1b36', '#27223f', '#312b4d', '#3d365d'])
M.ramp('hallglow', ['#23577a', '#2e7196', '#4893b4', '#7cc0d6'])
M.ramp('hallame', ['#3d2660', '#50327d', '#6a479c', '#8f6cbd'])


@M.plate('hall', parallax=0.26, outline='#17142a')
def hall(P):
    """The hall behind the playfield: a fringe of stalactites, stalagmites and glowing clusters."""
    mat = P.spec.mat
    r = K.rng(81)
    xs = range(-40, P.width + 120, 30)
    roof = [(x, 408 + 28 * math.sin(x / 60 + 2) + 12 * math.sin(x / 23)) for x in xs]
    floor_ = [(x, 628 - 20 * math.sin(x / 50) - 9 * math.sin(x / 19 + 1)) for x in xs]
    roof_pts, floor_pts = cave_layer(P, 'h', roof, floor_, (mat('hall'), mat('hall')), (1, 2), 5, tite=(30, 80),
                                     mite=(20, 60), tite_every=(30, 70), mite_every=(40, 90))
    for i in range(9):
        x = 40 + i * P.width / 9 + r.uniform(-20, 20)
        up = i % 2 == 0
        y = K.height_at(roof_pts, x) - 2 if up else K.height_at(floor_pts, x) + 3
        K.crystal_cluster(f'cl{i}', x, y, r.uniform(18, 30), mat('hallglow' if i % 3 else 'hallame'), 4,
                          d=6, angle=180 if up else r.uniform(-20, 20), spread=70, count=3, seed=90 + i)


M.ramp('ledge', ['#1b1830', '#241f3b', '#2e2848', '#3a3357'])
M.ramp('water', ['#10283c', '#163650', '#1f4a66', '#2f6a86'])
M.ramp('shroomfar', ['#23574a', '#2e7560', '#45a07e', '#86d6ac'])


@M.plate('pool', parallax=0.44, outline='#120f20')
def pool(P):
    """An underground lake at floor level: still water, rock islands, glowing mushrooms."""
    mat = P.spec.mat
    r = K.rng(91)
    xs = range(-40, P.width + 120, 30)
    roof = [(x, 398 + 24 * math.sin(x / 90) + 10 * math.sin(x / 31 + 1)) for x in xs]
    floor_ = [(x, 700) for x in xs]
    roof_pts, _ = cave_layer(P, 'p', roof, floor_, (mat('ledge'), mat('ledge')), (1, 2), 7, tite=(26, 70),
                             mite=(0.5, 1), tite_every=(28, 60), mite_every=(4000, 5000))
    # The water: a flat sheet at map row 622, with lighter ripple strips on it.
    wy = Y(P, 622)
    K.box('water', -20, wy, P.width + 20, P.height + 20, -20, 0, mat('water'), 3)
    for i in range(40):
        x = r.uniform(0, P.width)
        yy = wy + r.uniform(3, 60)
        K.box(f'ripple{i}', x, yy, x + r.uniform(10, 34), yy + 1.5, 0, 2, mat('water'), 4)
    # Rock islands and stalagmites standing in it, and mushrooms on the shores.
    x = r.uniform(0, 60)
    i = 0
    while x < P.width:
        w = r.uniform(30, 70)
        h = r.uniform(10, 26)
        K.prism(f'isle{i}', [(x - w, wy + 2), (x - w * 0.6, wy - h * 0.7), (x - w * 0.1, wy - h), (x + w * 0.5, wy - h * 0.8),
                             (x + w, wy + 2)], -6, 6, mat('ledge'), 5, bevel=2)
        K.spire(f'isle{i}_mite', x, wy - h + 4, r.uniform(20, 60), r.uniform(7, 13), mat('ledge'), 6, d=8,
                hanging=False, seed=300 + i, segments=7, rings=3)
        for j in range(r.choice((1, 2, 3))):
            mx = x + r.uniform(-w * 0.6, w * 0.6)
            my = wy - h * 0.6
            K.cylinder(f'isle{i}_stem{j}', mx, my - 6, my + 2, 1.6, mat('ledge'), 7, d=10, vertices=6)
            K.blob(f'isle{i}_cap{j}', mx, my - 6, r.uniform(4, 7), 3, mat('shroomfar'), 8, d=12, segments=10, rings=5)
        x += r.uniform(110, 220)
        i += 1


M.ramp('timber', ['#1c130d', '#2b1d14', '#3c2a1c', '#513925'])
M.ramp('near', ['#141120', '#1a1628', '#221d32', '#2b253e'])
M.ramp('nearglow', ['#5a4a22', '#7a6428', '#a0842e', '#d6b048'])


@M.plate('mine', parallax=0.66, outline='#0a0810')
def mine(P):
    """Just behind the playfield: mine timbers, scaffolding and ladders against the rock."""
    mat = P.spec.mat
    r = K.rng(101)
    xs = range(-40, P.width + 120, 30)
    roof = [(x, 396 + 18 * math.sin(x / 80 + 4)) for x in xs]
    floor_ = [(x, 662 - 12 * math.sin(x / 60)) for x in xs]
    roof_pts, floor_pts = cave_layer(P, 'm', roof, floor_, (mat('near'), mat('near')), (1, 2), 9, tite=(20, 60),
                                     mite=(14, 40), tite_every=(40, 90), mite_every=(60, 140))
    # Timber, now and then: a full set (two posts and a cap) propping the roof, or a
    # gallery (a platform on stilts with a rail and a ladder), each with a lamp.
    x = r.uniform(40, 120)
    i = 0
    while x < P.width:
        top = K.height_at(roof_pts, x) + 4
        bot = K.height_at(floor_pts, x) + 6
        span = r.uniform(60, 90)
        if i % 2 == 0:
            K.box(f'cap{i}', x - 8, top, x + span + 8, top + 9, -4, 4, mat('timber'), 3, bevel=1)
            for j, px_ in enumerate((x, x + span)):
                K.box(f'post{i}_{j}', px_ - 3.5, top + 8, px_ + 3.5, bot, -4, 4, mat('timber'), 4, bevel=1)
            for s_, px_ in ((1, x), (-1, x + span)):
                K.prism(f'knee{i}_{s_}', [(px_, top + 26), (px_, top + 18), (px_ + s_ * 18, top + 9),
                                         (px_ + s_ * 26, top + 9)], -3, 3, mat('timber'), 5)
            lx = x + span * 0.5
            K.box(f'lamp{i}', lx - 3, top + 14, lx + 3, top + 22, 4, 8, mat('nearglow'), 7)
        else:
            deck = bot - r.uniform(60, 90)
            K.box(f'deck{i}', x - 14, deck, x + span + 14, deck + 6, -4, 4, mat('timber'), 3, bevel=1)
            for j, px_ in enumerate((x - 6, x + span * 0.5, x + span + 6)):
                K.box(f'stilt{i}_{j}', px_ - 3, deck + 5, px_ + 3, bot, -6, 2, mat('timber'), 4, bevel=1)
            K.box(f'rail{i}', x - 14, deck - 16, x + span + 14, deck - 13, -2, 4, mat('timber'), 5)
            for px_ in (x - 12, x + span * 0.5, x + span + 12):
                K.box(f'railpost{i}_{int(px_)}', px_ - 1.5, deck - 16, px_ + 1.5, deck, -2, 4, mat('timber'), 5)
            lx = x + span + 24
            for j in (-6, 6):
                K.box(f'ladder{i}_{j}', lx + j - 1.5, deck - 4, lx + j + 1.5, bot, 0, 3, mat('timber'), 5)
            for yy in range(int(deck), int(bot), 10):
                K.box(f'rung{i}_{yy}', lx - 6, yy, lx + 6, yy + 2, 0, 3, mat('timber'), 6)
            K.box(f'lamp{i}', x + 6, deck - 10, x + 13, deck - 1, 4, 8, mat('nearglow'), 7)
        x += span + r.uniform(170, 320)
        i += 1
