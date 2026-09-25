"""
Cloudbreak Isles (`islands`): floating islands in a bright sky, with lethal gaps
between them (DESIGN §8.1). Copied from `hills.py`, the reference.

Left to right: the left home isle (a knoll with a great sky tree on its far end, a
spawn shelf, a broken column and a second shelf), a low stepping stone, the central
crag (a tall spire of rock with a ruined shrine arch on its crown), a higher stepping
stone, and the right home isle (a shelf, a toppled stone head, a second shelf and a
blossom grove on its end). Every isle hangs a rock keel with drips, crystals and roots
under it; there is nothing below but the cloud sea.

The tactical idea: two home isles facing each other across a chain of three stones at
staggered heights. The central crag stands 100 to 200 px proud of everything around it
and blocks every flat shot across the middle, so a duel is played in lobs over it;
every rim is a drop into the clouds, so a shot that carves away the ground at an
enemy's feet near an edge can drop them out of the match.

Spawn slots (constants.spawn.marginFraction 0.1 on 1900 px): 2 seats search from x =
570 and 1330, 4 seats from 380, 760, 1140 and 1520 (jitter about +-23), 8 seats every
190 px from 285. The 2- and 4-seat slots each have a flat shelf wider than the jitter
plus half a footprint each side: the left shelf (330-430), the left inner shelf
(530-610), the low stone (722-800), the high stone (1100-1180), the right inner shelf
(1290-1370) and the right shelf (1480-1560). The crag's crown (885-945) is left clear
for the eighth-seat rooms. Every column over an isle is solid from its top to the tip
of its keel, with nothing hanging free underneath it: a spawn stands on the top of the
*lowest* solid run in its column, so a loose root under a shelf would hide the shelf.

Sequence of passes and what each changed: tools/blender/iterations/maps/islands/.
"""
import math

import map_kit as K

M = K.define(
    'islands',
    size=(1900, 1100),
    sky=['#2f86dc', '#5eb0ee', '#9ad6f7', '#dcf3fc'],
    outline='#1a1628',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
M.ramp('grass', ['#2b6b3a', '#4ca23e', '#84d04c', '#c4f07a'])
M.ramp('topsoil', ['#4a2e24', '#6e4632', '#946042', '#b8825a'])
M.ramp('rock', ['#554a60', '#7b7086', '#a498ac', '#cdc3d2'])
M.ramp('keel', ['#2c3150', '#434a6c', '#5d6690', '#7d88b0'], mottle=('rock', 15, 0.22))
M.ramp('bark', ['#3e2618', '#62402a', '#87603c', '#ab8456'])
M.ramp('leaves', ['#1d5838', '#2d7b44', '#4ea64e', '#8ad26a'])
M.ramp('blossom', ['#96386a', '#cc628c', '#ee94b4', '#ffd0e2'])
M.ramp('marble', ['#857a6c', '#b8ad9a', '#dfd6c2', '#faf5e8'])
M.ramp('crystal', ['#1d6a98', '#30a4cf', '#6cdaf0', '#cffaff'])
M.flat('glow', '#ffe070')

W, H = 1900, 1100

# --- the isles --------------------------------------------------------------------
# Each: top profile control points (left to right, the rounded rims included), the
# depth of the keel under its middle, where the keel's lowest point sits (0-1 across),
# and a seed.
ISLES = {
    'left': dict(points=[
        (150, 650), (156, 628), (168, 606), (186, 590), (212, 582), (244, 582), (270, 588), (296, 596),
        (330, 600), (380, 600), (430, 600),                        # left shelf (4-seat 380)
        (456, 598), (484, 596), (512, 596),                        # the broken column
        (534, 596), (570, 596), (610, 597),                        # inner shelf (2-seat 570)
        (618, 600), (627, 609), (633, 624), (636, 644),
    ], keel=290, low=0.42, seed=1),
    'stone1': dict(points=[
        (690, 704), (695, 686), (705, 670), (722, 662), (760, 662), (800, 662), (810, 666), (818, 678),
        (822, 698),
    ], keel=150, low=0.55, seed=2),
    'crag': dict(points=[
        (882, 522), (886, 500), (894, 483), (906, 472), (925, 470), (950, 470), (975, 470), (990, 472),
        (1000, 483), (1008, 500), (1012, 522),
    ], keel=330, low=0.5, seed=3),
    'stone2': dict(points=[
        (1072, 624), (1077, 606), (1088, 591), (1104, 586), (1140, 585), (1178, 586), (1186, 592), (1191, 606),
        (1193, 626),
    ], keel=170, low=0.45, seed=4),
    'right': dict(points=[
        (1256, 654), (1259, 636), (1265, 622), (1278, 615), (1300, 614), (1330, 614), (1370, 614),   # inner shelf (1330)
        (1398, 609), (1430, 604), (1458, 601),                                       # the stone head
        (1480, 600), (1520, 600), (1560, 600),                                       # right shelf (1520)
        (1590, 596), (1622, 586), (1660, 578), (1698, 578), (1726, 588), (1746, 606), (1756, 628),
        (1760, 652),
    ], keel=300, low=0.6, seed=5),
}


def top(name):
    return K.smooth(ISLES[name]['points'], step=3.0)


def keel_line(name):
    """The underside of an isle: a lumpy keel, deepest at `low`, a rounded rim at the ends."""
    isle = ISLES[name]
    t_prof = top(name)
    x0, x1 = t_prof[0][0], t_prof[-1][0]
    level = min(y for _, y in t_prof)
    w = K.wobble(isle['seed'] * 13, 14, 90)
    lumps = K.wobble(isle['seed'] * 13 + 5, 7, 34)
    out = []
    n = int((x1 - x0) / 4)
    for i in range(n + 1):
        x = x0 + (x1 - x0) * i / n
        t = (x - x0) / (x1 - x0)
        # Skewed so the deepest point sits at `low`.
        u = t / isle['low'] * 0.5 if t < isle['low'] else 0.5 + (t - isle['low']) / (1 - isle['low']) * 0.5
        shape = math.sin(math.pi * u) ** 1.6
        y = level + 24 + isle['keel'] * shape + (w(x) + lumps(x)) * min(1.0, shape * 3)
        out.append((x, max(y, K.height_at(t_prof, x) + 10)))
    return out


def clipped_band(name, upper_fn, th_fn, floor, x0, x1, material, group, d0=-30.0, d1=1.5, step=4.0, gap=4.0):
    """
    A band between `upper_fn(x)` and `upper_fn(x) + th_fn(x)`, kept `gap` px inside the
    `floor` polyline (an isle's keel): a stratum that never pokes out of the rock it is
    in, since everything rendered is ground. Breaks into runs where it thins out.
    """
    runs, run = [], []
    x = x0
    while x <= x1 + 1e-6:
        a = upper_fn(x)
        b = min(a + th_fn(x), K.height_at(floor, x) - gap)
        if b - a >= 2.5:
            run.append((x, a, b))
        elif run:
            runs.append(run)
            run = []
        x += step
    if run:
        runs.append(run)
    objs = []
    for i, r in enumerate(runs):
        if len(r) < 3:
            continue
        objs.append(K.band(f'{name}{i}', [(x, a) for x, a, _ in r], [(x, b) for x, _, b in r], d0, d1, material,
                           group))
    return objs


def isle(k, name):
    """The body of one isle: rock under a soil cap, strata, the keel, drips, crystals, roots."""
    mat = k.mat
    isle_ = ISLES[name]
    seed = isle_['seed']
    r = K.rng(100 + seed)
    t_prof = top(name)
    keel = keel_line(name)
    x0, x1 = t_prof[0][0], t_prof[-1][0]
    body = list(t_prof) + list(reversed(keel))
    K.prism(f'{name}_body', body, -90, 0, mat('rock'), 1)

    # The keel: the lower part of the isle, in the darker, bluer rock, its top edge a
    # wandering line roughly 70 px under the surface.
    w_k = K.wobble(seed * 17 + 1, 12, 120)
    clipped_band(f'{name}_keel', lambda x: K.height_at(t_prof, x) + 66 + w_k(x), lambda x: 600, keel,
                 x0, x1, mat('keel'), 3, gap=0.0, d1=1.0)
    # The soil cap, then two rock strata in the pale rock, a pixel proud.
    w_s = K.wobble(seed * 17 + 2, 5, 70)
    clipped_band(f'{name}_soil', lambda x: K.height_at(t_prof, x) + 4, lambda x: 20 + w_s(x), keel, x0, x1,
                 mat('topsoil'), 2)
    w_a = K.wobble(seed * 17 + 3, 6, 110)
    w_at = K.wobble(seed * 17 + 4, 0.5, 90)
    clipped_band(f'{name}_band_a', lambda x: K.height_at(t_prof, x) + 36 + w_a(x),
                 lambda x: max(0.0, 12 * (1 + w_at(x)) - 3), keel, x0, x1, mat('rock'), 4, d1=2.0)
    w_b = K.wobble(seed * 17 + 5, 8, 140)
    w_bt = K.wobble(seed * 17 + 6, 0.6, 110)
    clipped_band(f'{name}_band_b', lambda x: K.height_at(t_prof, x) + 104 + w_b(x),
                 lambda x: max(0.0, 16 * (1 + w_bt(x)) - 4), keel, x0, x1, mat('keel'), 4, d1=2.5)

    # Stones in the soil and rock; boulders locked in the keel.
    span = x1 - x0
    for i in range(int(span / 9)):
        x = r.uniform(x0 + 8, x1 - 8)
        yt, yb = K.height_at(t_prof, x) + 26, min(K.height_at(keel, x + dd) for dd in (-8, 0, 8)) - 12
        if yb - yt < 12:
            continue
        y = r.uniform(yt, min(yb, yt + 120))
        size = r.uniform(3, 5.5)
        K.rock(f'{name}_pebble{i}', x, y, size, mat('rock'), 6, d=2.5, seed=seed * 1000 + i,
               squash=(1.2, 0.5, 0.85))
    for i in range(int(span / 60)):
        x = r.uniform(x0 + 20, x1 - 20)
        rad = r.uniform(9, 16)
        yt = K.height_at(t_prof, x) + 80
        yb = min(K.height_at(keel, x + dd) for dd in (-rad * 1.4, 0, rad * 1.4)) - rad - 8
        if yb - yt < 4:
            continue
        K.rock(f'{name}_boulder{i}', x, r.uniform(yt, yb), rad, mat('keel'), 6, d=3.5, seed=seed * 1000 + 500 + i,
               squash=(1.25, 0.45, 0.9))

    # Drips: rock stalactites hanging from the underside, pointing straight down, each
    # welded into the keel so its column stays one solid run.
    xs = []
    x = x0 + r.uniform(10, 24)
    while x < x1 - 10:
        xs.append(x)
        x += r.uniform(14, 30)
    for i, dx in enumerate(xs):
        wd = r.uniform(7, 15)
        a, b = dx - wd / 2, dx + wd / 2
        depth_here = K.height_at(keel, dx) - K.height_at(t_prof, dx)
        length = r.uniform(10, 26) * min(1.0, depth_here / 90)
        if length < 6:
            continue
        # The top edge follows the keel 6 px inside it, so the drip is welded on.
        top_edge = [(a + (b - a) * j / 6, K.height_at(keel, a + (b - a) * j / 6) - 6) for j in range(7)]
        kmax = max(y for _, y in top_edge) + 6
        # A blunt, upright tip: a slanted 1 px point breaks into loose slivers per column.
        tip_y = kmax + length
        K.prism(f'{name}_drip{i}', top_edge + [(b - wd * 0.15, kmax + 2), (dx + 1.6, tip_y), (dx - 1.6, tip_y),
                                               (a + wd * 0.15, kmax + 2)],
                -40, 0, mat('keel'), 5, bevel=1.0)
    # The keel's tip: one long fang under its lowest point.
    lo = max(keel, key=lambda p: p[1])
    fang_top = [(lo[0] - 12 + 4 * j, K.height_at(keel, lo[0] - 12 + 4 * j) - 8) for j in range(7)]
    K.prism(f'{name}_fang', fang_top + [(lo[0] + 5, lo[1] + 14), (lo[0] + 2.5, lo[1] + 36 + seed * 3),
                                        (lo[0] - 1.5, lo[1] + 36 + seed * 3), (lo[0] - 4, lo[1] + 12)],
            -40, 0, mat('keel'), 5, bevel=1.2)

    # Roots hanging from the underside: straight down, thick enough to read, tapering.
    for i in range(max(2, int(span / 70))):
        rx = r.uniform(x0 + span * 0.15, x1 - span * 0.15)
        y0 = min(K.height_at(keel, rx + dd) for dd in (-5, -2.5, 0, 2.5, 5)) - 6
        length = (K.height_at(keel, rx) - y0) + r.uniform(22, 60)
        pts = [(rx, y0 + length * t, 4.0) for t in (0.0, 0.3, 0.6, 1.0)]
        K.tube(f'{name}_root{i}', pts, r.uniform(2.2, 3.0), mat('bark'), 7, taper=0.4, resolution=2)

    # Roots from the grass down into the soil cap, as on the hills.
    for i in range(int(span / 40)):
        x = r.uniform(x0 + 20, x1 - 20)
        y0 = K.height_at(t_prof, x) + 12
        length = r.uniform(14, 34)
        drift = r.uniform(-8, 8)
        pts = [(x + drift * t * t + math.sin(t * 5 + i) * 2.0, y0 + length * t, 3.0) for t in (0, 0.33, 0.66, 1.0)]
        K.tube(f'{name}_soilroot{i}', pts, 2.0, mat('bark'), 7, taper=0.45, resolution=2)

    # Crystals: clusters caught in the keel's face, glowing blue.
    for i in range(max(1, int(span / 160))):
        cx = r.uniform(x0 + span * 0.2, x1 - span * 0.2)
        yt, yb = K.height_at(t_prof, cx) + 90, K.height_at(keel, cx) - 26
        if yb - yt < 10:
            continue
        crystal_cluster(k, f'{name}_crystal{i}', cx, r.uniform(yt, yb), r.uniform(0.8, 1.2), seed * 50 + i, d=3)

    # The grass: walkable on top by construction, blades and vines on the front.
    K.grass_edge(f'{name}_grass', t_prof, mat('grass'), (8, 9), radius=8, hem=12, seed=seed * 7,
                 flowers_mats=[mat('glow'), mat('blossom'), mat('marble')])
    # Grass curtains draping over the rims, where nobody stands.
    for i, (ex, side) in enumerate(((x0 + 5, -1), (x1 - 5, 1))):
        for j in range(3):
            vx = ex - side * j * 5 + r.uniform(-1, 1)
            vy = K.height_at(t_prof, vx) + 4
            L = r.uniform(18, 44) * (1 - j * 0.2)
            K.tube(f'{name}_vine{i}_{j}', [(vx, vy, 6), (vx + side * 1.5, vy + L * 0.5, 7), (vx + side * 1.0, vy + L, 7)],
                   2.2, mat('leaves'), 21, taper=0.5, resolution=2)
            K.blob(f'{name}_vineleaf{i}_{j}', vx + side * 2, vy + L * 0.7, 3.2, 2.4, mat('leaves'), 21, d=9,
                   segments=8, rings=4)
    return t_prof, keel


def crystal_cluster(k, name, x, y, size, seed, d=3.0, down=False):
    """Three to five faceted shards fanned out of a point, with a glowing core."""
    mat = k.mat
    r = K.rng(seed)
    n = r.choice((3, 4, 5))
    for i in range(n):
        a = math.radians(-90 + (i - (n - 1) / 2) * 28 + r.uniform(-8, 8))
        if down:
            a = -a
        L = r.uniform(12, 20) * size * (1.2 if i == n // 2 else 1.0)
        w = r.uniform(4, 6) * size
        c, s = math.cos(a), math.sin(a)
        nx, ny = -s, c
        poly = [(x + nx * w / 2, y + ny * w / 2), (x + c * L * 0.75 + nx * w / 2, y + s * L * 0.75 + ny * w / 2),
                (x + c * L, y + s * L), (x + c * L * 0.75 - nx * w / 2, y + s * L * 0.75 - ny * w / 2),
                (x - nx * w / 2, y - ny * w / 2)]
        K.prism(f'{name}_{i}', poly, d - 3, d + 3 + i % 2, mat('crystal'), 12 + i % 2)
    K.blob(f'{name}_core', x, y, 3 * size, 2.5 * size, mat('glow'), 14, d=d + 4, segments=8, rings=4)


@M.terrain
def terrain(k):
    for name in ISLES:
        isle(k, name)
    sky_tree(k)
    broken_column(k, 494)
    shrine(k)
    stone_head(k, 1428)
    grove(k)
    small_things(k)
    fallen_bridge(k)
    buried(k)


def sky_tree(k):
    """A great gnarled tree on the left isle's knoll, its roots over the rim."""
    mat = k.mat
    t_prof = top('left')
    x = 222
    g = K.height_at(t_prof, x) + 3
    K.tree('bigtree', x, g, 118, 60, (mat('bark'), mat('leaves')), (19, 20), d=4, seed=61, lean=-8, lobes=9)
    # A low bough reaching right, with its own crown: the tree's shelter over the knoll.
    K.tube('bigtree_bough', [(x + 4, g - 58, 4), (x + 34, g - 74, 4), (x + 60, g - 86, 4)], 5.0, mat('bark'), 19,
           taper=0.5)
    for i, (dx, dy, rr_) in enumerate(((64, -92, 20), (78, -84, 15), (52, -102, 16))):
        K.blob(f'bigtree_lobe_r{i}', x + dx, g + dy, rr_, rr_ * 0.85, mat('leaves'), 20, d=8, rd=rr_ * 0.8)
    # Roots arching over the rim and down the isle's side.
    for i, (dx, L) in enumerate(((-24, 50), (-36, 72), (-46, 40))):
        rx = x + dx
        pts = [(x - 6, g - 4, 6), (rx, K.height_at(t_prof, rx) - 2, 6), (rx - 8, K.height_at(t_prof, rx) + L * 0.5, 6),
               (rx - 10, K.height_at(t_prof, rx) + L, 6)]
        K.tube(f'bigtree_root{i}', pts, 3.4 - i * 0.5, mat('bark'), 19, taper=0.5, resolution=2)


def broken_column(k, x):
    """A fluted column snapped off at head height, its fallen drum beside it: cover."""
    mat = k.mat
    g = K.height_at(top('left'), x) - 6
    K.box('col_base', x - 18, g - 10, x + 18, g + 6, -8, 14, mat('marble'), 10, bevel=1.5)
    K.box('col_plinth', x - 15, g - 16, x + 15, g - 9, -6, 12, mat('marble'), 12, bevel=1.2)
    h = 66
    K.prism('col_shaft', [(x - 12, g - 16), (x + 12, g - 16), (x + 12, g - h + 6), (x + 7, g - h - 2), (x + 2, g - h + 8),
                          (x - 3, g - h - 6), (x - 8, g - h + 2), (x - 12, g - h - 1)], -4, 10, mat('marble'), 11,
            bevel=1.2)
    for i, fx in enumerate((x - 7, x, x + 7)):
        K.box(f'col_flute{i}', fx - 1, g - h + 10, fx + 1, g - 19, 10, 11, mat('marble'), 12)
    # Ivy up the shaft.
    K.tube('col_ivy', [(x - 11, g - 12, 12), (x - 4, g - 26, 12), (x - 10, g - 40, 12), (x - 2, g - 54, 12)], 1.8,
           mat('leaves'), 21, resolution=1)
    for i, (dx, dy) in enumerate(((-10, -18), (-4, -30), (-9, -44), (-1, -56), (6, -60))):
        K.blob(f'col_ivyleaf{i}', x + dx, g + dy, 3.4, 2.6, mat('leaves'), 21, d=14, segments=8, rings=4)
    # The drum that came off, lying on its side in the turf.
    dx0 = x - 50
    gd = K.height_at(top('left'), dx0) - 3
    K.box('col_drum', dx0 - 14, gd - 20, dx0 + 14, gd + 2, -6, 12, mat('marble'), 11, bevel=4)
    for i, fy in enumerate((gd - 14, gd - 8)):
        K.box(f'col_drum_flute{i}', dx0 - 11, fy, dx0 + 11, fy + 1.5, 12, 13, mat('marble'), 12)


def shrine(k):
    """
    The ruined shrine on the crag's crown: two pillars and a lintel with a glowing rune,
    the right pillar snapped and the lintel's end sagging on it, a fallen block below.
    There is 66 px of air under the lintel (more than a full room's headroom floor), and
    the left half of the crown is clear for a seat.
    """
    mat = k.mat
    t_prof = top('crag')
    lx, rx = 926, 972
    gl = K.height_at(t_prof, lx) - 5
    gr = K.height_at(t_prof, rx) - 5
    lintel_y = gl - 90
    # Steps the pillars stand on.
    K.box('shr_step', lx - 14, gl - 6, rx + 14, gl + 8, -12, 14, mat('marble'), 10, bevel=1.5)
    K.box('shr_pillar_l', lx - 8, lintel_y + 10, lx + 8, gl - 5, -6, 10, mat('marble'), 11, bevel=1.2)
    K.box('shr_cap_l', lx - 12, lintel_y + 4, lx + 12, lintel_y + 12, -8, 12, mat('marble'), 12, bevel=1.2)
    K.box('shr_base_l', lx - 11, gl - 12, lx + 11, gl - 4, -8, 12, mat('marble'), 12, bevel=1.2)
    # The right pillar, snapped: a jagged top well below the lintel's line.
    K.prism('shr_pillar_r', [(rx - 8, gr - 5), (rx + 8, gr - 5), (rx + 8, lintel_y + 34), (rx + 3, lintel_y + 28),
                             (rx - 1, lintel_y + 36), (rx - 5, lintel_y + 26), (rx - 8, lintel_y + 30)],
            -6, 10, mat('marble'), 11, bevel=1.2)
    K.box('shr_base_r', rx - 11, gr - 12, rx + 11, gr - 4, -8, 12, mat('marble'), 12, bevel=1.2)
    for i, fx in enumerate((lx - 3, lx + 3, rx - 3, rx + 3)):
        top_y = lintel_y + 14 if i < 2 else lintel_y + 38
        K.box(f'shr_flute{i}', fx - 1, top_y, fx + 1, (gl if i < 2 else gr) - 14, 10, 11, mat('marble'), 13)
    # The lintel, held by the left pillar and sagging onto the broken right one.
    K.prism('shr_lintel', [(lx - 18, lintel_y - 10), (lx + 26, lintel_y - 10), (rx + 2, lintel_y + 14),
                           (rx + 14, lintel_y + 24), (rx + 10, lintel_y + 32), (rx - 6, lintel_y + 24),
                           (lx + 22, lintel_y + 4), (lx - 18, lintel_y + 4)], -8, 12, mat('marble'), 12, bevel=1.5)
    K.prism('shr_roof', [(lx - 22, lintel_y - 10), (lx - 14, lintel_y - 20), (lx + 18, lintel_y - 20),
                         (lx + 28, lintel_y - 10)], -10, 14, mat('marble'), 13, bevel=1.5)
    K.box('shr_rune', lx - 4, lintel_y - 6, lx + 4, lintel_y + 1, 12, 14, mat('glow'), 15)
    # Ivy on everything.
    K.tube('shr_ivy', [(lx - 7, gl - 8, 12), (lx - 3, gl - 30, 12), (lx - 7, gl - 50, 12), (lx - 2, lintel_y + 6, 12),
                       (lx + 16, lintel_y + 2, 12)], 1.8, mat('leaves'), 21, resolution=1)
    for i, (dx, dy) in enumerate(((-4, -20), (-6, -42), (-2, -62), (10, -89), (22, -86))):
        K.blob(f'shr_leaf{i}', lx + dx, gl + dy, 3.2, 2.5, mat('leaves'), 21, d=14, segments=8, rings=4)
    # The block that fell off, on the crag's right shoulder.
    bx = 1000
    by = K.height_at(t_prof, bx) - 3
    K.prism('shr_fallen', [(bx - 10, by + 2), (bx + 8, by + 6), (bx + 12, by - 8), (bx - 6, by - 14)], -6, 10,
            mat('marble'), 11, bevel=1.5)


def stone_head(k, x):
    """A toppled chibi stone head on the right isle, between its two shelves: cover."""
    mat = k.mat
    g = K.height_at(top('right'), x) - 4
    # Tilted a little, sunk into the turf.
    a = math.radians(-9)

    def p(u, v):
        return (x + u * math.cos(a) - v * math.sin(a), g + u * math.sin(a) + v * math.cos(a))

    head = [p(-22, 8), p(22, 8), p(24, -30), p(18, -44), p(-16, -46), p(-23, -34)]
    K.prism('head', head, -12, 12, mat('rock'), 10, bevel=2.5)
    K.prism('head_brow', [p(-18, -28), p(20, -28), p(20, -23), p(-18, -23)], 12, 16, mat('rock'), 11, bevel=1.2)
    K.prism('head_nose', [p(-2, -24), p(5, -24), p(8, -8), p(-3, -8)], 12, 18, mat('rock'), 11, bevel=1.5)
    for i, ex in enumerate((-11, 13)):
        K.prism(f'head_eye{i}', [p(ex - 5, -21), p(ex + 5, -21), p(ex + 5, -15), p(ex - 5, -15)], 12, 13,
                mat('keel'), 12)
    K.prism('head_mouth', [p(-8, -4), p(10, -4), p(10, 0), p(-8, 0)], 12, 13, mat('keel'), 12)
    # A moss cap and a crack.
    K.blob('head_moss', *p(0, -44), 20, 6, mat('grass'), 21, d=4, rd=14)
    K.blob('head_moss2', *p(-18, -36), 7, 5, mat('grass'), 21, d=6)
    K.tube('head_crack', [(*p(14, -44), 13), (*p(10, -36), 13), (*p(15, -30), 13)], 1.2, mat('keel'), 12,
           resolution=1)


def grove(k):
    """Blossom trees and a green one on the right isle's end; mushrooms under them."""
    mat = k.mat
    t_prof = top('right')
    for i, (tx, h, crown, m) in enumerate(((1652, 96, 44, 'blossom'), (1712, 78, 36, 'leaves'),
                                           (1742, 60, 26, 'blossom'))):
        K.tree(f'grove{i}', tx, K.height_at(t_prof, tx) + 3, h, crown, (mat('bark'), mat(m)), (19, 20), d=4,
               seed=80 + i, lean=(-4, 3, 6)[i], lobes=8)
    # Fallen petals on the lip, and a blossom tree on the high stone's shoulder.
    s2 = top('stone2')
    K.tree('s2tree', 1084, K.height_at(s2, 1084) + 4, 58, 24, (mat('bark'), mat('blossom')), (19, 20), d=4,
           seed=90, lean=-5, lobes=6)
    for i, (mx, hh, rr_) in enumerate(((1618, 11, 9), (1632, 7, 6), (1690, 9, 8))):
        g = K.height_at(t_prof, mx) - 6
        K.cylinder(f'mush{i}_stem', mx, g - hh, g + 2, rr_ * 0.35, mat('marble'), 24, d=14, vertices=8)
        K.blob(f'mush{i}_cap', mx, g - hh, rr_, rr_ * 0.6, mat('crystal'), 25, d=14, segments=12, rings=6)


def small_things(k):
    """Bushes, a stone lantern, tufts on the rims: the busy detail between the big shapes."""
    mat = k.mat
    # Bushes on shoulders nobody spawns on.
    for i, (name, bx) in enumerate((('left', 300), ('stone1', 700), ('right', 1600), ('crag', 893))):
        t_prof = top(name)
        by = K.height_at(t_prof, bx) - 4
        K.blob(f'bush{i}_a', bx, by - 8, 15, 11, mat('leaves'), 21, d=6)
        K.blob(f'bush{i}_b', bx + 11, by - 5, 10, 8, mat('leaves'), 21, d=10)
        K.blob(f'bush{i}_c', bx - 10, by - 3, 8, 6, mat('leaves'), 21, d=9)
    # A stone lantern on the low stone's right shoulder, lit.
    s1 = top('stone1')
    lx = 812
    g = K.height_at(s1, lx) - 4
    K.box('lantern_base', lx - 6, g - 6, lx + 6, g + 4, -4, 8, mat('marble'), 10, bevel=1)
    K.box('lantern_post', lx - 3, g - 20, lx + 3, g - 6, -2, 6, mat('marble'), 11)
    K.box('lantern_box', lx - 7, g - 32, lx + 7, g - 20, -5, 9, mat('marble'), 10, bevel=1)
    K.box('lantern_light', lx - 4, g - 29, lx + 4, g - 23, 9, 10, mat('glow'), 15)
    K.roof('lantern_roof', lx - 7, lx + 7, g - 32, g - 42, -7, 11, mat('marble'), 12, overhang=4, thickness=3)


def fallen_bridge(k):
    """
    What is left of the rope bridge that once ran from the left isle to the low stone:
    two ropes and a ladder of planks hanging down the left isle's rim. It hangs inside
    the isle's own columns, so it never hides the shelf above it from a spawn.
    """
    mat = k.mat
    t_prof = top('left')
    x = 626
    y0 = K.height_at(t_prof, x) - 2
    K.box('bridge_post', x - 4, y0 - 20, x + 3, y0 + 12, 4, 12, mat('bark'), 16, bevel=1)
    for i, rx in enumerate((x - 8, x + 8)):
        K.tube(f'bridge_rope{i}', [(rx, y0 - 14, 14), (rx + 2, y0 + 40, 14), (rx + 1, y0 + 96, 14)], 1.4,
               mat('topsoil'), 17, resolution=1)
    for j in range(7):
        py = y0 + 8 + j * 13
        K.box(f'bridge_plank{j}', x - 11 + (j % 2), py, x + 12 + (j % 2), py + 6, 13, 16, mat('bark'), 16 + j % 2,
              bevel=1)


def buried(k):
    """What the cross-sections give away: a sky-whale's bones, a lost idol, a sealed urn."""
    mat = k.mat
    # A long spine of some great flying beast in the left isle's keel.
    t_prof = top('left')
    bx, by = 330, K.height_at(t_prof, 330) + 130
    K.blob('bone_skull', bx + 70, by - 2, 16, 11, mat('marble'), 12, d=4, rd=9)
    K.blob('bone_eye', bx + 74, by - 4, 3.5, 3.5, mat('keel'), 13, d=12, segments=10, rings=5)
    K.tube('bone_spine', [(bx + 54, by, 4), (bx + 20, by + 6, 4), (bx - 20, by + 4, 4), (bx - 60, by - 6, 4)], 3.0,
           mat('marble'), 12, resolution=1)
    for j in range(6):
        rx = bx + 40 - j * 14
        K.tube(f'bone_rib{j}', [(rx + 2, by - 6, 4), (rx - 4, by + 8, 4), (rx, by + 22 - j, 4)], 2.4, mat('marble'),
               12, resolution=1)
    # A rune tablet caught in the right isle's rock, still glowing.
    rp = top('right')
    ix, iy = 1560, K.height_at(rp, 1560) + 120
    K.prism('tablet', [(ix - 14, iy + 16), (ix + 14, iy + 16), (ix + 13, iy - 10), (ix + 6, iy - 18), (ix - 6, iy - 18),
                       (ix - 13, iy - 10)], -4, 8, mat('marble'), 12, bevel=1.5)
    for j, (gx0, gy0, gx1, gy1) in enumerate(((-7, -9, 7, -6), (-2, -6, 1, 10), (-7, 3, 7, 6))):
        K.box(f'tablet_rune{j}', ix + gx0, iy + gy0, ix + gx1, iy + gy1, 8, 9, mat('glow'), 13)
    # A sealed urn in the high stone.
    s2 = top('stone2')
    ux, uy = 1150, K.height_at(s2, 1150) + 64
    K.lathe('urn', ux, 0, [(4, uy - 14), (6, uy - 12), (10, uy - 4), (9, uy + 6), (5, uy + 10)], mat('topsoil'), 12,
            segments=12)
    K.box('urn_band', ux - 9, uy - 3, ux + 9, uy, 8, 11, mat('glow'), 13)


# ---------------------------------------------------------------------------------
# Plates, far to near.
# ---------------------------------------------------------------------------------

M.ramp('moon', ['#b4c4e6', '#c3d0ee', '#d3ddf4', '#e4ebfa'])
M.ramp('moonsea', ['#a5b6de', '#b0c0e4', '#bccbea', '#c9d5f0'])


@M.plate('moon', parallax=0.05, outline='#a2b3da')
def moon(P):
    """A big pale day moon, low contrast, far over the right of the map."""
    mat = P.spec.mat
    # Placed in plate pixels: at this parallax the moon barely moves, so it goes high
    # up where the view's sky is, not behind a map point.
    cx, cy = P.ax(1500), 118
    K.blob('disc', cx, cy, 56, 56, mat('moon'), 1, d=0, segments=40, rings=20)
    r = K.rng(3)
    for i, (dx, dy, rr_) in enumerate(((-17, -14, 14), (15, 7, 10), (-3, 22, 8), (24, -20, 6), (-29, 12, 7))):
        K.blob(f'sea{i}', cx + dx, cy + dy, rr_, rr_ * 0.8, mat('moonsea'), 2, d=56 - abs(dx) * 0.4 - 4, rd=3)
    _ = r


M.ramp('isle_far', ['#8a9cc6', '#95a8cf', '#a2b4d8', '#b1c1e0'])
M.ramp('grass_far', ['#86b7ae', '#93c3b2', '#a2cfb8', '#b3dbc0'])
M.ramp('fall_far', ['#c2d8f0', '#d0e3f5', '#e0edf9', '#f0f7fd'])


def mini_isle(P, name, x, y, w, depth, mats, groups, seed, fall=False, trees=None):
    """A small floating isle for a plate: a flat cap, a keel, optionally a waterfall."""
    rock_m, grass_m, fall_m = mats
    g_rock, g_grass, g_fall = groups
    r = K.rng(seed)
    n = 14
    topl = [(x - w / 2 + w * i / n, y + (3 if i in (0, n) else 0) + r.uniform(-1.5, 1.5)) for i in range(n + 1)]
    under = []
    for i in range(n + 1):
        t = i / n
        under.append((x - w / 2 + w * t, y + 6 + depth * math.sin(math.pi * t) ** 1.4 * r.uniform(0.8, 1.1)))
    K.prism(f'{name}_rock', topl + list(reversed(under)), -20, 0, rock_m, g_rock, bevel=1.0)
    K.tube(f'{name}_cap', [(px_, py_ - 1, 1) for px_, py_ in topl], max(2.5, w * 0.035), grass_m, g_grass,
           resolution=2)
    lo = max(under, key=lambda p: p[1])
    K.prism(f'{name}_fang', [(lo[0] - w * 0.06, lo[1] - 4), (lo[0] + w * 0.06, lo[1] - 4),
                             (lo[0], lo[1] + depth * 0.35)], -20, 0, rock_m, g_rock)
    if fall:
        fx = x + w * r.uniform(0.2, 0.38)
        fw = max(4.0, w * 0.07)
        L = depth * 2.2 + r.uniform(20, 50)
        K.prism(f'{name}_fall', [(fx - fw / 2, y - 1), (fx + fw / 2, y - 1), (fx + fw / 2 + 1, y + L),
                                 (fx - fw / 2 - 2, y + L + 6)], 2, 4, fall_m, g_fall)
        K.blob(f'{name}_spray', fx, y + L + 4, fw * 1.4, fw * 0.8, fall_m, g_fall, d=4)
    if trees:
        tree_m, n_trees = trees
        for j in range(n_trees):
            tx = x - w * 0.3 + w * 0.6 * r.random()
            rr_ = r.uniform(0.07, 0.11) * w
            K.blob(f'{name}_tree{j}', tx, y - rr_ * 0.9, rr_, rr_ * 0.95, tree_m, g_grass + 1, d=2)


@M.plate('far', parallax=0.16, outline='#7c8fbc')
def far(P):
    """Distant floating isles: small, pale and blue, two of them pouring waterfalls."""
    mat = P.spec.mat
    r = K.rng(21)
    specs = [(60, 330, 60), (300, 220, 40), (560, 380, 84), (820, 250, 50), (1080, 170, 34), (1300, 360, 76),
             (1560, 240, 46), (1800, 340, 66), (1990, 210, 38)]
    for i, (mx, my, w) in enumerate(specs):
        x, y = P.at(mx, my)
        mini_isle(P, f'isle{i}', x, y, w * 0.9, w * 0.5, (mat('isle_far'), mat('grass_far'), mat('fall_far')),
                  (1, 3, 5), seed=200 + i, fall=i in (2, 5, 7), trees=(mat('grass_far'), r.choice((0, 1, 2))))


M.ramp('cloud', ['#aac8ea', '#c2daf2', '#dbeaf8', '#f4f9fe'])
M.ramp('cloudshade', ['#98b8e0', '#a8c6e8', '#b8d2ee', '#c8def3'])


@M.plate('sea', parallax=0.3, outline='#8fb0da')
def sea(P):
    """The cloud sea under everything: rolling cumulus tops over a flat floor of cloud."""
    mat = P.spec.mat
    r = K.rng(31)
    horizon = P.ay(820)
    K.box('floor', -20, horizon + 30, P.width + 20, P.height + 20, -60, -40, mat('cloudshade'), 1)
    # Three rows of billows, back to front, each lower and bigger than the last.
    for row, (dy, rmin, rmax, dd) in enumerate(((0, 18, 34, -30), (26, 26, 46, -10), (58, 34, 60, 10))):
        x = -30 + r.uniform(0, 30)
        i = 0
        while x < P.width + 40:
            rr_ = r.uniform(rmin, rmax)
            K.blob(f'billow{row}_{i}', x, horizon + dy + r.uniform(-6, 6), rr_ * 1.25, rr_, mat('cloud'), 2 + row,
                   d=dd, rd=rr_ * 0.7, segments=20, rings=10)
            x += rr_ * r.uniform(1.3, 1.9)
            i += 1
    K.box('under', -20, horizon + 70, P.width + 20, P.height + 20, 10, 30, mat('cloud'), 5)


M.ramp('isle_mid', ['#7888b4', '#8595bf', '#95a5ca', '#a8b6d6'])
M.ramp('grass_mid', ['#5d9a86', '#6aa98e', '#7cba98', '#94cca6'])
M.ramp('fall_mid', ['#b6d2ee', '#c8def4', '#dcebf9', '#f2f8fe'])


@M.plate('isles', parallax=0.42, outline='#56628e')
def isles(P):
    """Nearer isles, bigger and bluer than the playfield, with trees, a ruin and falls."""
    mat = P.spec.mat
    r = K.rng(41)
    specs = [(-60, 600, 190, True), (430, 470, 110, False), (800, 640, 150, True), (1180, 420, 90, False),
             (1500, 620, 180, True), (1900, 500, 130, False), (2080, 640, 150, True)]
    for i, (mx, my, w, fall) in enumerate(specs):
        x, y = P.at(mx, my)
        mini_isle(P, f'isle{i}', x, y, w * 0.8, w * 0.42, (mat('isle_mid'), mat('grass_mid'), mat('fall_mid')),
                  (1, 3, 6), seed=300 + i, fall=fall, trees=(mat('grass_mid'), r.choice((1, 2, 3))))
    # A ruined tower on one of them.
    x, y = P.at(1180, 420)
    K.box('tower', x - 7, y - 34, x + 7, y, -6, 6, mat('isle_mid'), 7, bevel=1)
    K.prism('tower_top', [(x - 9, y - 34), (x + 9, y - 34), (x + 9, y - 40), (x + 4, y - 37), (x, y - 42),
                          (x - 5, y - 38), (x - 9, y - 41)], -7, 7, mat('isle_mid'), 7)
