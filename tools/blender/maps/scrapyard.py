"""
Rust Yard (`scrapyard`): a painted junkyard (DESIGN §8.1). Copied from `hills.py`; read
that one first.

A scrapyard at the edge of a factory city under a smoggy orange sky. Left to right: a
scrap mountain with an old crane on top and tyres down its flank, the low left shelf, a
wrecked tank on the rise, the middle-left shelf, a girder tower, the high left shelf,
then the chasm, bridged by the hull of a crashed airship lying across it, nose buried
in the left bank and tail fin sticking out of the right one, then the high right shelf,
a heap of crates, barrels and pipes, the middle-right shelf, a crane tower with a car
hanging from its magnet, the low right shelf and a second scrap mountain with a
smokestack. Under it all: packed rusty earth over slag, full of buried junk (gears,
pipes, tyres, a robot's head, a car door, an anchor).

The tactical idea: the chasm splits the yard and the airship hull is the only bridge.
Its skin is a single plate of riveted brass, 7 px thick: it takes a mobile's weight and
stops a shell once, and then it has a hole in it. Walk across, or blow the bridge out
from under whoever is on it; below it is a drop off the map. The girder towers are
lattices: most shells burst on them, some slip between the members. Nobody spawns inside
the hull (its bottom skin is thinner than `spawnGen.minThicknessPx`); a full room of 8 may
put a seat on its back, the riskiest perch on the map.

Spawn slots (1900 px wide, 10 % margins): 2 seats from 570 and 1330, 4 from 380, 760,
1140 and 1520, 8 every 190 px from 285. Shelves: L4a 345-418 (y 780), L2 520-628 (y
745), L4b 735-805 (y 712), R4a 1100-1196 (y 712), R2 1285-1392 (y 745), R4b 1495-1560
(y 780). Obstacles stand only between them.

Sequence of passes: tools/blender/iterations/maps/scrapyard/.
"""
import math

import map_kit as K

M = K.define(
    'scrapyard',
    size=(1900, 1050),
    # Smog: a bruised maroon overhead down to a hot, hazy yellow at the horizon.
    sky=['#4e3238', '#8a4a3a', '#c9773f', '#f0b865'],
    outline='#1a110e',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
# Terrain budget 48: 10 ramps + outline + lamp = 42.
M.ramp('dirt', ['#3e2a22', '#5e4034', '#83604a', '#a8826a'], mottle=('slag', 15, 0.28))
M.ramp('slag', ['#28242a', '#3b363c', '#554e54', '#716a6e'])
M.ramp('rust', ['#6a2e16', '#9a4a22', '#c86e34', '#eba062'])
M.ramp('steel', ['#2e3844', '#4a5868', '#71839a', '#a6b8cc'])
M.ramp('rubber', ['#1c1a1d', '#2c292d', '#433f44', '#5f5a60'])
M.ramp('army', ['#2e4428', '#48653a', '#6c8c4e', '#9cb86e'])
M.ramp('brass', ['#5e4018', '#8c6526', '#bb8f38', '#e8c466'])
M.ramp('wood', ['#4a2e1a', '#6e4a2a', '#95683a', '#bf8f52'])
M.ramp('paint', ['#6a1c1e', '#a02c26', '#d04a34', '#f07e5a'])
M.ramp('canvas', ['#7a6a58', '#a8967c', '#d0bd9c', '#f0e2c4'])
M.flat('lamp', '#ffd35a')

LIP = 5          # radius of the packed-earth lip; the profile is the walking surface
GAP = (855, 1045)
HULL = (952, 704, 150, 66)   # centre x, centre y, half length, half height

LEFT_POINTS = [
    (-20, 590), (40, 588), (110, 596),                    # left scrap mountain (crane)
    (160, 622), (205, 660), (250, 700), (295, 742), (325, 770),
    (345, 778), (380, 780), (432, 779),                   # L4a (4 seats, 380)
    (458, 771), (484, 758), (504, 749),                   # the rise (tyres)
    (520, 746), (570, 745), (628, 746),                   # L2 (2 seats, 570)
    (655, 737), (690, 722), (715, 714),                   # the rise (wrecked tank)
    (735, 712), (770, 712), (805, 711),                   # L4b (4 seats, 760)
    (830, 709), (855, 707),                               # onto the hull's nose
]
RIGHT_POINTS = [
    (1045, 707), (1072, 710), (1100, 712),                # off the hull's tail
    (1150, 712), (1196, 713),                             # R4a (4 seats, 1140)
    (1220, 724), (1248, 737), (1268, 744),                # down past the junk heap
    (1285, 746), (1330, 745), (1392, 746),                # R2 (2 seats, 1330)
    (1420, 756), (1450, 768), (1478, 777),                # down past the crane tower
    (1495, 780), (1520, 781), (1560, 780),                # R4b (4 seats, 1520)
    (1588, 771), (1612, 764), (1652, 762), (1676, 744),   # a ledge (8 seats)
    (1700, 704), (1740, 660),
    (1790, 620), (1850, 602), (1880, 590), (1920, 548),   # right scrap mountain (smokestack)
]


def left():
    return K.smooth(LEFT_POINTS, step=3.0)


def right():
    return K.smooth(RIGHT_POINTS, step=3.0)


def ground_y(x):
    """The walking surface at column x (off the gap)."""
    return K.height_at(left() if x < 950 else right(), x)


def wall(x, seed, down=1):
    """A ragged chasm wall from the lip at column x down past the bottom of the map."""
    r = K.rng(seed)
    pts = []
    y = 712
    while y < 1080:
        pts.append((x + down * r.uniform(-7, 7), y))
        y += r.uniform(22, 40)
    pts.append((x, 1080))
    return pts


def beam(name, p0, p1, w, material, group, d0=-3.0, d1=3.0, bevel=0.0):
    """A straight bar of width `w` from p0 to p1: a girder member, a strut, a jib."""
    (x0, y0), (x1, y1) = p0, p1
    L = math.hypot(x1 - x0, y1 - y0) or 1.0
    nx, ny = -(y1 - y0) / L * w / 2, (x1 - x0) / L * w / 2
    return K.prism(name, [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)], d0, d1,
                   material, group, bevel=bevel)


def gear(name, x, y, r, teeth, material, group, d0=-4.0, d1=4.0, hub=None):
    """A cog seen face on: a toothed disc, with a darker hub boss if `hub` is a material."""
    pts = []
    for i in range(teeth * 4):
        a = math.tau * i / (teeth * 4)
        rr = r if (i % 4) in (1, 2) else r * 0.8
        pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
    objs = [K.prism(name, pts, d0, d1, material, group, bevel=0.8)]
    if hub is not None:
        objs.append(K.log(f'{name}_hub', x, y, r * 0.35, d1, d1 + 2, hub, group + 1))
    return objs


def lattice(name, x, y_foot, y_top, width, material, group, d=0.0, bay=26.0, member=4.0):
    """
    A girder tower: two legs tapering from `width` at the foot, X braces in every bay
    and a strut on each bay line. The gaps between the members are air, so a shell can
    slip through as often as it bursts on one.
    """
    objs = []
    top_w = width * 0.6
    def leg_x(side, y):
        t = (y_foot - y) / max(1.0, y_foot - y_top)
        return x + side * (width + (top_w - width) * t) / 2
    for side in (-1, 1):
        objs.append(beam(f'{name}_leg{side}', (leg_x(side, y_foot + 6), y_foot + 6), (leg_x(side, y_top), y_top),
                         member + 1, material, group, d - 3, d + 3))
    y = y_foot
    i = 0
    while y - bay > y_top - 1:
        y2 = y - bay
        a0, b0 = leg_x(-1, y), leg_x(1, y)
        a1, b1 = leg_x(-1, y2), leg_x(1, y2)
        objs.append(beam(f'{name}_x{i}a', (a0, y), (b1, y2), member - 1, material, group + 1, d - 2, d + 2))
        objs.append(beam(f'{name}_x{i}b', (b0, y), (a1, y2), member - 1, material, group + 1, d - 2, d + 2))
        objs.append(beam(f'{name}_h{i}', (a1, y2), (b1, y2), member, material, group, d - 2.5, d + 2.5))
        y = y2
        i += 1
    return objs


@M.terrain
def terrain(k):
    mat = k.mat
    L_, R_ = left(), right()
    r = K.rng(1)

    # --- the two banks: body, strata, bedrock --------------------------------------
    for side, prof, w in (('l', L_, wall(GAP[0], 3)), ('r', R_, wall(GAP[1], 4))):
        if side == 'l':
            poly = list(prof) + w + [(-20, 1080)]
            inner = K.clip(prof, -20, GAP[0] - 10)
        else:
            poly = list(prof) + [(1920, 1080)] + list(reversed(w))
            inner = K.clip(prof, GAP[1] + 10, 1920)
        K.prism(f'bank_{side}', poly, -90, 0, mat('dirt'), 1)
        K.stratum(f'crust_{side}', inner, 14, 12, mat('rust'), 2, follow=1.0, seed=2 + (side == 'r'), pinch=0.4,
                  min_cover=12)
        K.stratum(f'slagband_{side}', inner, 70, 30, mat('slag'), 3, follow=0.55, datum=760, dip=0.02,
                  seed=5 + (side == 'r'), pinch=0.35, min_cover=50)
        K.stratum(f'rustband_{side}', inner, 150, 14, mat('rust'), 4, follow=0.35, datum=760, dip=-0.03,
                  seed=7 + (side == 'r'), pinch=0.5, min_cover=120)
        w_deep = K.wobble(9 + (side == 'r'), 14, 280)
        deep = [(x, max(y + 200, 960 + w_deep(x))) for x, y in prof]
        if side == 'l':
            deep = [(x, y) for x, y in deep if x < GAP[0] - 6]
        else:
            deep = [(x, y) for x, y in deep if x > GAP[1] + 6]
        K.ground(f'bedrock_{side}', deep, mat('slag'), 5, depth=40, d_front=2.5)

    # Gravel and bolts through the earth, slag lumps below.
    for i in range(170):
        x = r.uniform(0, k.width)
        if GAP[0] - 12 < x < GAP[1] + 12:
            continue
        below = r.uniform(24, 280)
        y = ground_y(x) + below
        m = 'rust' if r.random() < 0.25 else 'slag' if r.random() < 0.6 else 'steel'
        K.rock(f'pebble{i}', x, y, r.uniform(3, 6) + below / 100, mat(m), 6, d=2.5, seed=100 + i,
               squash=(1.2, 0.5, 0.85))

    lip(k, L_, 'l')
    lip(k, R_, 'r')
    hull(k)
    buried(k)
    tank(k, 664)
    towers(k)
    junk(k)
    mountains(k)


def lip(k, prof, side):
    """The walkable top: a rounded lip of packed rusty earth, a skirt of gravel, bolts in it."""
    mat = k.mat
    r = K.rng(20 + (side == 'r'))
    pts = [(x, y + LIP) for x, y in prof]
    K.tube(f'lip_{side}', [(x, y, 1.0) for x, y in pts], LIP, mat('dirt'), 8, resolution=3)
    hem = [(x, y + 8 + 5 * abs(math.sin(x * math.pi / 15)) ** 2) for x, y in pts]
    K.band(f'skirt_{side}', K.offset(pts, 1), hem, -8, 2.0, mat('dirt'), 8)
    x = pts[0][0] + 5
    while x < pts[-1][0] - 5:
        if GAP[0] - 4 < x < GAP[1] + 4:
            x += 10
            continue
        y = K.height_at(pts, x)
        if abs(K.slope_at(pts, x)) < 1.0 and r.random() < 0.3:
            K.blob(f'grit_{side}{int(x)}', x, y - LIP + 0.5, r.uniform(2.5, 4), r.uniform(1.5, K.WALK_BUMP_PX), mat('slag'),
                   9, d=0, segments=8, rings=4)
        # Junk poking out of the front of the lip, never above the silhouette: sheets,
        # pipe ends, cogs, nuts, rust chips. This is what makes the ground a scrap heap.
        roll = r.random()
        name = f'{side}{int(x)}'
        if roll < 0.12:
            K.log(f'nut_{name}', x + r.uniform(-3, 3), y + r.uniform(5, 9), r.uniform(2.2, 3.2), LIP + 1, LIP + 4,
                  mat('steel'), 9, vertices=6)
        elif roll < 0.22:
            K.rock(f'chip_{name}', x, y + r.uniform(4, 9), r.uniform(2.5, 3.6), mat('rust'), 9, d=LIP + 2,
                   seed=int(x) * 7, squash=(1.3, 0.5, 0.7))
        elif roll < 0.34:
            w, h = r.uniform(5, 9), r.uniform(3, 5)
            a = r.uniform(-0.5, 0.5)
            ca, sa = math.cos(a), math.sin(a)
            cy_ = y + 4 + h
            quad = [(x + u * ca - v * sa, cy_ + u * sa + v * ca) for u, v in ((-w, -h), (w, -h), (w, h), (-w, h))]
            K.prism(f'sheet_{name}', quad, LIP, LIP + 3, mat(r.choice(('steel', 'rust', 'army', 'paint'))), 9, bevel=0.8)
        elif roll < 0.42:
            py_ = y + r.uniform(7, 10)
            K.log(f'pipeend_{name}', x, py_, 4.5, LIP, LIP + 5, mat('steel'), 9)
            K.log(f'pipebore_{name}', x, py_, 2.2, LIP + 5, LIP + 6, mat('rubber'), 9)
        elif roll < 0.48:
            gear(f'cog_{name}', x, y + 9, 6, 6, mat('rust'), 9, d0=LIP, d1=LIP + 3)
        x += r.uniform(7, 13)


def hull(k):
    """
    The airship: a cigar of riveted brass wedged into the chasm, its belly down between
    the walls and its back standing 80 px over the banks. The nose and tail sit on the
    banks and are solid bulkheads; the middle, over the drop, is a 6 px skin round air
    with the ribs showing and canvas still hanging in most bays. The bottom skin is torn
    open in places (so the inside is never sealed) and is thinner than
    `spawnGen.minThicknessPx` even with its outline, and nothing hangs from it, so no
    column over the chasm can be spawned on.
    """
    mat = k.mat
    cx, cy, a, b = HULL
    skin = 6
    n = 120
    x_nose, x_tail = GAP[0] + 12, GAP[1] - 8

    def ell(ax, bx, t):
        return (cx + ax * math.cos(t), cy + bx * math.sin(t))

    def arc(ax, bx, t0, t1, steps):
        return [ell(ax, bx, t0 + (t1 - t0) * i / steps) for i in range(steps + 1)]

    def t_at(x, top):
        """Parameter on the outer ellipse at column x, on the top (pi..2pi) or bottom half."""
        c = max(-1.0, min(1.0, (x - cx) / a))
        base = math.acos(c)
        return 2 * math.pi - base if top else base

    # Nose and tail: solid ends, from the tip to a bulkhead over each lip.
    for name, x0, x1 in (('nose', cx - a - 1, x_nose), ('tail', x_tail, cx + a + 1)):
        if name == 'nose':
            poly = arc(a, b, t_at(x1, True), math.pi, 20) + arc(a, b, math.pi, t_at(x1, False), 20)
        else:
            poly = arc(a, b, t_at(x0, True), 2 * math.pi, 20) + arc(a, b, 0, t_at(x0, False), 20)
        K.prism(f'hull_{name}', poly, -16, 16, mat('brass'), 10, bevel=2)
    # Top skin over the chasm (between the bulkheads) and the torn bottom skin.
    t0, t1 = t_at(x_nose, True), t_at(x_tail, True)
    K.prism('hull_top', arc(a, b, t0, t1, n) + arc(a - skin, b - skin, t1, t0, n), -16, 16, mat('brass'), 10,
            bevel=1.2)
    tb0, tb1 = t_at(x_tail, False), t_at(x_nose, False)
    tears = ((0.30, 0.40), (0.62, 0.70))
    edges = [0.0]
    for u0, u1 in tears:
        edges += [u0, u1]
    edges.append(1.0)
    for i in range(0, len(edges), 2):
        u0, u1 = edges[i], edges[i + 1]
        s0, s1 = tb0 + (tb1 - tb0) * u0, tb0 + (tb1 - tb0) * u1
        K.prism(f'hull_bottom{i}', arc(a, b, s0, s1, 30) + arc(a - skin, b - skin, s1, s0, 30), -16, 16, mat('brass'),
                10, bevel=1.2)
    # Bulkhead rims, seams, rivets.
    for name, x in (('nb', x_nose), ('tb', x_tail)):
        yt, yb = ell(a, b, t_at(x, True))[1], ell(a, b, t_at(x, False))[1]
        K.box(f'hull_{name}', x - 3, yt + 1, x + 3, yb - 1, 16, 18, mat('brass'), 11)
    for j in range(26):
        t = math.pi * (1.04 + 0.92 * j / 25)
        x, y = ell(a - 3, b - 3, t)
        K.blob(f'hull_rivet{j}', x, y, 1.6, 1.6, mat('steel'), 12, d=17, segments=6, rings=3)
    # Plating lines on the solid ends.
    for name, xs in (('nose', range(int(cx - a + 16), int(x_nose) - 4, 16)), ('tail', range(int(x_tail) + 14, int(cx + a) - 8, 16))):
        for i, x in enumerate(xs):
            yt, yb = ell(a, b, t_at(x, True))[1], ell(a, b, t_at(x, False))[1]
            K.box(f'hull_{name}_plate{i}', x - 1, yt + 3, x + 1, yb - 3, 16, 17, mat('brass'), 11)
    # Ribs over the chasm, hanging from the top skin, not reaching the bottom one; canvas
    # still hangs in most bays, torn off ragged above the belly.
    r = K.rng(29)
    xs = list(range(int(x_nose) + 22, int(x_tail) - 6, 26))
    for i, x in enumerate(xs):
        yt = ell(a - skin, b - skin, t_at(x, True))[1] - 1
        yb = ell(a - skin, b - skin, t_at(x, False))[1] + 1
        K.box(f'rib{i}', x - 2, yt, x + 2, yt + (yb - yt) * 0.66, -12, 6, mat('steel'), 13)
    # Two stringers along the frame, tied to the ribs.
    for j, f in enumerate((0.34, 0.6)):
        pts = []
        for x in range(int(x_nose) + 4, int(x_tail) - 3, 6):
            yt = ell(a - skin, b - skin, t_at(x, True))[1]
            yb = ell(a - skin, b - skin, t_at(x, False))[1]
            pts.append((x, yt + (yb - yt) * f * 0.66 / 0.66 * 0.62 + (0 if j == 0 else 4), 2))
        K.tube(f'stringer{j}', pts, 1.6, mat('steel'), 14, resolution=1)
    bays = [x_nose + 2] + xs + [x_tail - 2]
    for i in range(len(bays) - 1):
        if r.random() > 0.72:
            continue
        x0, x1 = bays[i] + 2, bays[i + 1] - 2
        upper, lower = [], []
        for j in range(8):
            xx = x0 + (x1 - x0) * j / 7
            yt = ell(a - skin, b - skin, t_at(xx, True))[1]
            yb = ell(a - skin, b - skin, t_at(xx, False))[1]
            upper.append((xx, yt + 1))
            lower.append((xx, yt + (yb - yt) * r.uniform(0.35, 0.72) + (4 if j % 2 else -3)))
        K.band(f'panel{i}', upper, lower, -15, -9, mat('canvas'), 12)
    # A keel girder along the inside of the top skin.
    kt0, kt1 = t_at(x_nose + 6, True), t_at(x_tail - 6, True)
    K.tube('hull_keel', [(x, y, -4) for x, y in arc(a - skin - 5, b - skin - 5, kt0, kt1, 40)], 2.2, mat('steel'), 14,
           resolution=1)
    # The nose: a crumpled dent and a row of lit portholes; the tail: a fin up and the
    # stub of a propeller shaft.
    K.blob('hull_dent', cx - a + 26, cy - 22, 11, 9, mat('brass'), 15, d=15, rd=6)
    for i, (x, dy) in enumerate(((cx - a + 30, 6), (cx - a + 52, 2), (cx - a + 74, 0))):
        K.log(f'porthole{i}', x, cy + dy, 6, 16, 18, mat('steel'), 16)
        K.log(f'porthole{i}_glass', x, cy + dy, 3.5, 18, 19, mat('lamp'), 17)
    fx = cx + a - 40
    ft = ell(a, b, t_at(fx, True))[1]
    K.prism('hull_fin', [(fx - 30, ft + 12), (fx + 22, ft + 16), (fx + 30, ft - 22), (fx + 12, ft - 27)], -6, 8,
            mat('paint'), 15, bevel=1.5)
    K.box('hull_fin_band', fx + 10, ft - 16, fx + 28, ft - 10, 8, 10, mat('canvas'), 16)
    K.log('hull_shaft', cx + a - 2, cy, 5, -4, 6, mat('steel'), 16)


def tank(k, x, sc=0.68):
    """
    A wrecked chibi tank on the rise between L2 and L4b, gun drooping downhill, a hole
    blown in its side. Kept small (`sc`) so both shelves beside it keep room to drive.
    """
    mat = k.mat
    g0, g1 = ground_y(x - 34 * sc), ground_y(x + 34 * sc)
    ang = math.atan2(g1 - g0, 68 * sc)
    ca, sa = math.cos(ang), math.sin(ang)
    gx, gy = x, (g0 + g1) / 2 + 4

    def P(u, v):
        u, v = u * sc, v * sc
        return (gx + u * ca - v * sa, gy + u * sa + v * ca)

    K.prism('tank_track', [P(-38, 0), P(38, 0), P(42, -8), P(36, -16), P(-36, -16), P(-42, -8)], -14, 14,
            mat('rubber'), 20, bevel=2)
    for i in range(5):
        wx, wy = P(-28 + i * 14, -8)
        K.log(f'tank_wheel{i}', wx, wy, 5.5 * sc, 14, 16, mat('steel'), 21)
    K.prism('tank_hull', [P(-36, -14), P(34, -14), P(40, -24), P(30, -34), P(-30, -34), P(-38, -24)], -12, 12,
            mat('army'), 22, bevel=2)
    tx, ty = P(-4, -38)
    K.blob('tank_turret', tx, ty, 20 * sc, 13 * sc, mat('army'), 23, d=4, rd=14 * sc)
    K.blob('tank_hatch', tx - 4 * sc, ty - 12 * sc, 7 * sc, 3, mat('army'), 24, d=4)
    K.tube('tank_barrel', [(tx - 16 * sc, ty - 2, 8), (tx - 32 * sc, ty + 2, 8), (tx - 42 * sc, ty + 10 * sc, 8)],
           3.5 * sc + 0.5, mat('steel'), 24, resolution=2)
    K.box('tank_star', tx - 2, ty - 3, tx + 5, ty + 3, 16, 18, mat('canvas'), 25)
    hx, hy = P(18, -24)
    K.blob('tank_rust', hx, hy, 10 * sc, 6 * sc, mat('rust'), 25, d=10)
    hx, hy = P(-18, -24)
    K.log('tank_hole', hx, hy, 5 * sc, 12, 14, mat('rubber'), 25)


def towers(k):
    """
    Two girder towers, both out on the mountain slopes where they frame the yard without
    shielding a shelf (a tall prop next to a shelf is a wall that seat cannot lob over):
    a water tower on the left flank, and a crane on the right one whose jib reaches back
    over the slope with a car hanging from its magnet.
    """
    mat = k.mat
    # Left: a lattice with a riveted water tank on top.
    x = 250
    foot = ground_y(x) + 6
    top = foot - 190
    lattice('wt', x, foot, top, 40, mat('steel'), 10)
    K.lathe('wt_tank', x, 0, [(0, top - 70), (18, top - 66), (30, top - 54), (32, top - 40), (32, top - 12),
                              (26, top)], mat('rust'), 12, segments=16)
    for i, y in enumerate((top - 44, top - 24)):
        K.lathe(f'wt_band{i}', x, 0, [(32.4, y), (33.2, y + 1.5), (33.2, y + 3), (32.4, y + 4.5)], mat('steel'), 13,
                segments=16)
    K.box('wt_ladder', x + 20, top - 70, x + 24, foot - 20, 32, 34, mat('steel'), 14)
    K.box('wt_sign', x - 22, top - 34, x + 6, top - 18, 32, 36, mat('canvas'), 15, bevel=1)
    K.box('wt_sign_mark', x - 16, top - 29, x, top - 23, 36, 37, mat('paint'), 16)
    # Right: the crane.
    cx = 1692
    foot = ground_y(cx) + 6
    top = foot - 170
    lattice('cr', cx, foot, top, 36, mat('rust'), 17)
    K.box('cr_cab', cx - 18, top - 30, cx + 22, top, -8, 10, mat('paint'), 19, bevel=1.5)
    K.box('cr_window', cx - 2, top - 24, cx + 14, top - 12, 10, 12, mat('lamp'), 20)
    K.box('cr_roof', cx - 22, top - 36, cx + 26, top - 30, -10, 12, mat('steel'), 20, bevel=1)
    # The jib: a lattice lying on its side, from the cab back over the slope.
    jx0, jx1, jy = 1584, cx - 16, top - 20
    for s_ in (-1, 1):
        beam(f'cr_chord{s_}', (jx0, jy + s_ * 3), (jx1, jy + s_ * 8), 4, mat('rust'), 17)
    xx = jx0
    i = 0
    while xx < jx1 - 12:
        t0, t1 = (xx - jx0) / (jx1 - jx0), (xx + 18 - jx0) / (jx1 - jx0)
        h0, h1 = 3 + 5 * t0, 3 + 5 * t1
        beam(f'cr_web{i}', (xx, jy - h0), (xx + 18, jy + h1), 3, mat('rust'), 18)
        xx += 18
        i += 1
    beam('cr_back', (cx + 20, top - 20), (cx + 60, top - 12), 5, mat('rust'), 17)
    K.box('cr_weight', cx + 52, top - 22, cx + 76, top - 2, -6, 8, mat('slag'), 19, bevel=1.5)
    # Cable, magnet and a car in its grip, over the slope below the crane.
    mx = 1604
    K.box('cr_cable', mx - 1.5, jy + 4, mx + 1.5, jy + 60, -1, 3, mat('steel'), 20)
    K.lathe('cr_magnet', mx, 0, [(6, jy + 56), (20, jy + 62), (22, jy + 72), (22, jy + 76)], mat('steel'), 21,
            segments=14)
    car(k, 'hung', mx, jy + 118, mat('paint'), tilt=-0.08)


def car(k, name, x, y_bottom, body, tilt=0.0, upside=False):
    """A boxy chibi car: body, cabin, windows, two wheels; `upside` flips it on its roof."""
    mat = k.mat
    s = -1 if upside else 1
    ca, sa = math.cos(tilt), math.sin(tilt)

    def P(u, v):
        v = v * s
        return (x + u * ca - v * sa, y_bottom + u * sa + v * ca)

    K.prism(f'{name}_body', [P(-36, -8), P(36, -8), P(38, -20), P(30, -26), P(-30, -26), P(-38, -18)], -10, 12, body,
            22, bevel=2)
    K.prism(f'{name}_cab', [P(-20, -25), P(18, -25), P(12, -42), P(-14, -42)], -8, 10, body, 23, bevel=2)
    K.prism(f'{name}_glass', [P(-15, -28), P(13, -28), P(9, -39), P(-11, -39)], 10, 12, mat('steel'), 24)
    for i, u in enumerate((-22, 22)):
        wx, wy = P(u, -8)
        K.log(f'{name}_wheel{i}', wx, wy, 8, 10, 14, mat('rubber'), 25)
        K.log(f'{name}_hub{i}', wx, wy, 3, 14, 16, mat('steel'), 26)
    lx, ly = P(34, -18)
    K.box(f'{name}_lamp', lx - 3, ly - 2, lx + 3, ly + 2, 12, 14, mat('lamp'), 26)


def junk(k):
    """Obstacles between the shelves: the crate and barrel heap, tyres, pipes, a sign."""
    mat = k.mat
    r = K.rng(41)
    # The heap between R4a and R2.
    hx = 1244
    g = ground_y(hx)
    K.box('crate0', hx - 30, g - 26, hx - 2, g + 4, -8, 12, mat('wood'), 20, bevel=1.5)
    K.box('crate1', hx - 4, g - 16, hx + 22, g + 6, -8, 12, mat('wood'), 21, bevel=1.5)
    K.box('crate2', hx - 22, g - 50, hx + 2, g - 26, -6, 12, mat('wood'), 21, bevel=1.5)
    for i, (bx0, by0, w) in enumerate(((hx - 30, g - 26, 28), (hx - 4, g - 16, 26), (hx - 22, g - 50, 24))):
        K.prism(f'crate{i}_x', [(bx0 + 3, by0 + w - 6), (bx0 + 7, by0 + w - 3), (bx0 + w - 3, by0 + 6),
                                (bx0 + w - 7, by0 + 3)], 12, 14, mat('wood'), 22)
    K.log('pipe0', hx + 8, g - 30, 7, -20, 16, mat('steel'), 24)
    K.log('pipe0_bore', hx + 8, g - 30, 4, 16, 17, mat('rubber'), 25)
    beam('pipe1', (hx - 28, g - 6), (hx + 14, g - 38), 9, mat('rust'), 23, -6, 10, bevel=1.5)
    # A car on its roof between R2 and R4b.
    car(k, 'wreck', 1440, ground_y(1440) - 40, mat('army'), tilt=0.05, upside=True)
    # Tyres stacked on the rise past L4a and loose on the right slope.
    for i, (tx, dy) in enumerate(((466, 0), (490, 2), (478, -18))):
        g = ground_y(tx) + 4 + dy
        K.log(f'tyre{i}', tx, g - 11, 13, -6, 10, mat('rubber'), 20 + i % 2, vertices=16)
        K.log(f'tyre{i}_rim', tx, g - 11, 6, 10, 12, mat('steel'), 22)
    # Pipes sticking out of the slopes (not the shelves).
    for i, (px_, ang, L_) in enumerate(((300, -40, 34), (1586, 40, 22), (1262, -20, 20))):
        g = ground_y(px_) + 8
        a = math.radians(ang)
        beam(f'stub{i}', (px_, g), (px_ + math.sin(a) * L_, g - math.cos(a) * L_), 8, mat('steel'), 24, -4, 8, bevel=1.5)
    # A sign on a post at the bottom of the left mountain: SCRAP, as a red board with bars.
    sx = 305
    g = ground_y(sx) + 4
    K.box('sign_post', sx - 2.5, g - 56, sx + 2.5, g + 6, 6, 11, mat('wood'), 19, bevel=0.8)
    K.box('sign_board', sx - 22, g - 60, sx + 16, g - 38, 11, 15, mat('paint'), 20, bevel=1.2)
    for j in range(4):
        K.box(f'sign_bar{j}', sx - 17 + j * 8, g - 55, sx - 12 + j * 8, g - 43, 15, 16, mat('canvas'), 21)
    # A few gear wheels and a car door leaning on slopes.
    for i, (gx, rr, teeth) in enumerate(((270, 16, 8), (1724, 14, 7))):
        g = ground_y(gx) + 2
        gear(f'slopegear{i}', gx, g - rr * 0.7, rr, teeth, mat('rust'), 23, hub=mat('steel'))


def mountains(k):
    """The two scrap mountains at the edges: an old crane on the left, a smokestack on the right."""
    mat = k.mat
    r = K.rng(51)
    # Left: crushed cars stacked into the mountain, and a crane cab with its jib up.
    for i, (x, dy, m) in enumerate(((20, 0, 'steel'), (62, 2, 'paint'), (40, -26, 'army'), (140, 20, 'steel'))):
        g = ground_y(x) + 14 + dy
        K.box(f'cube{i}', x - 22, g - 22, x + 22, g + 4, -10, 10, mat(m), 20 + i % 2, bevel=2)
        for j in range(3):
            K.box(f'cube{i}_crease{j}', x - 20, g - 17 + j * 7, x + 20, g - 15 + j * 7, 10, 11, mat(m), 22)
    cx = 88
    g = ground_y(cx) - 6
    K.box('lcrane_base', cx - 18, g - 6, cx + 18, g + 10, -8, 10, mat('slag'), 23, bevel=1.5)
    K.box('lcrane_cab', cx - 16, g - 36, cx + 14, g - 6, -8, 10, mat('rust'), 24, bevel=1.5)
    K.box('lcrane_window', cx - 10, g - 30, cx + 4, g - 20, 10, 12, mat('lamp'), 25)
    xs = [cx + 10 + i * 20 for i in range(8)]
    for s in (-1, 1):
        beam(f'lcrane_chord{s}', (cx + 8, g - 30 + s * 6), (cx + 90, g - 110 + s * 3), 4, mat('rust'), 23)
    for i in range(7):
        t0, t1 = i / 7, (i + 1) / 7
        p0 = (cx + 8 + 82 * t0, g - 30 - 80 * t0 - 6)
        p1 = (cx + 8 + 82 * t1, g - 30 - 80 * t1 + 6)
        beam(f'lcrane_web{i}', p0, p1, 3, mat('rust'), 24)
    K.box('lcrane_hookline', cx + 86, g - 108, cx + 89, g - 60, -1, 3, mat('steel'), 25)
    K.prism('lcrane_hook', [(cx + 81, g - 62), (cx + 93, g - 62), (cx + 93, g - 50), (cx + 87, g - 44),
                            (cx + 80, g - 50), (cx + 85, g - 52), (cx + 87, g - 57)], -2, 4, mat('steel'), 26)
    # Right: a brick smokestack on a boiler, and a pile of junk at its foot.
    sx = 1830
    g = ground_y(sx) + 8
    K.box('boiler', sx - 46, g - 40, sx + 40, g + 6, -10, 10, mat('rust'), 20, bevel=2)
    for i in range(4):
        K.box(f'boiler_band{i}', sx - 40 + i * 22, g - 40, sx - 36 + i * 22, g + 4, 10, 12, mat('steel'), 21)
    # A pitched tin roof over it, which the stack comes up through.
    K.roof('boiler_roof', sx - 46, sx + 40, g - 40, g - 70, -12, 12, mat('steel'), 21, overhang=6, thickness=5)
    K.lathe('stack', sx - 6, 0, [(13, 380), (15, 400), (17, g - 30)], mat('paint'), 22, segments=14)
    for i, y in enumerate((392, 440, 490, 540)):
        K.lathe(f'stack_band{i}', sx - 6, 0, [(16, y), (17.5, y + 2), (17.5, y + 6), (16, y + 8)], mat('slag'), 23,
                segments=14)
    K.lathe('stack_lip', sx - 6, 0, [(14, 372), (19, 376), (19, 384), (14, 386)], mat('slag'), 23, segments=14)
    # A pointed spark cap on legs over the mouth (and nobody's perch).
    for dx in (-10, 8):
        K.box(f'stack_leg{dx}', sx - 6 + dx, 358, sx - 4 + dx, 373, -2, 2, mat('slag'), 24)
    K.lathe('stack_cap', sx - 6, 0, [(0, 336), (12, 350), (22, 360), (20, 362)], mat('steel'), 24, segments=12,
            smooth_shade=False)
    # Junk on the mountain slopes: panels, a fridge-sized box, a drum.
    for i in range(24):
        right_ = r.random() < 0.4
        x = r.uniform(1712, 1770) if right_ else r.uniform(130, 318)
        g = ground_y(x) + 6
        kind = r.random() * (0.6 if right_ else 1.0)
        if kind < 0.6:
            w, h = r.uniform(12, 24), r.uniform(8, 16)
            # Never level: a flat-topped panel on a slope is a spawn site nobody wants.
            ang = r.choice((-1, 1)) * r.uniform(0.35, 0.7)
            ca, sa = math.cos(ang), math.sin(ang)
            pts = [(x + u * ca - v * sa, g + u * sa + v * ca) for u, v in ((-w, 0), (w, 0), (w, -h), (-w, -h))]
            K.prism(f'panel{i}', pts, -6, 6 + i % 3, mat(r.choice(('steel', 'rust', 'army', 'paint'))), 20 + i % 3,
                    bevel=1)
        elif kind < 0.8:
            K.log(f'slopetyre{i}', x, g - 9, 11, -4, 8, mat('rubber'), 20 + i % 2, vertices=14)
            K.log(f'slopetyre{i}_rim', x, g - 9, 5, 8, 10, mat('steel'), 22)
        else:
            gear(f'slopecog{i}', x, g - 8, r.uniform(9, 13), r.choice((6, 7, 8)), mat('rust'), 23, hub=mat('slag'))


def buried(k):
    """What the cross-section gives away: gears, pipes, tyres, a robot's head, an anchor."""
    mat = k.mat
    r = K.rng(61)
    # Gears.
    for i, (x, below, rr, teeth) in enumerate(((150, 120, 22, 10), (420, 180, 16, 8), (700, 110, 26, 11),
                                               (1180, 150, 20, 9), (1420, 230, 28, 12), (1700, 140, 18, 8))):
        gear(f'gear{i}', x, ground_y(x) + below, rr, teeth, mat('rust' if i % 2 else 'steel'), 11, d0=-6, d1=2,
             hub=mat('slag'))
    # Pipes running through the earth, and a buried tyre or two.
    for i, (x0, x1, below, rad) in enumerate(((60, 330, 210, 5), (520, 800, 240, 6), (1120, 1380, 90, 5),
                                              (1560, 1880, 250, 6))):
        pts = [(x, ground_y(x) + below + 8 * math.sin(x / 40), 1) for x in range(x0, x1 + 1, 20)]
        K.tube(f'pipe{i}', pts, rad, mat('steel' if i % 2 else 'rust'), 12, resolution=2)
    for i, (x, below) in enumerate(((560, 120), (1300, 200), (1820, 110))):
        K.log(f'deadtyre{i}', x, ground_y(x) + below, 13, -4, 2, mat('rubber'), 12, vertices=16)
        K.log(f'deadtyre{i}_rim', x, ground_y(x) + below, 6, 2, 3, mat('slag'), 13)
    # A robot's head: a big chibi box with an antenna and one eye still lit.
    rx, ry = 980 + 330, ground_y(1310) + 136
    K.box('robot_head', rx - 26, ry - 20, rx + 26, ry + 20, -6, 6, mat('steel'), 13, bevel=3)
    K.log('robot_eye', rx - 10, ry - 2, 7, 6, 8, mat('slag'), 14)
    K.log('robot_eye_lit', rx - 10, ry - 2, 3.5, 8, 9, mat('lamp'), 15)
    K.log('robot_eye2', rx + 12, ry - 2, 7, 6, 8, mat('slag'), 14)
    K.box('robot_mouth', rx - 12, ry + 9, rx + 14, ry + 14, 6, 8, mat('slag'), 14)
    K.tube('robot_antenna', [(rx + 18, ry - 20, 0), (rx + 26, ry - 38, 0)], 1.8, mat('steel'), 13, resolution=1)
    K.blob('robot_tip', rx + 26, ry - 40, 4, 4, mat('paint'), 14, d=0)
    # An anchor, from some ship that never flew, under the left bank.
    ax, ay = 590, ground_y(590) + 190
    K.box('anchor_shank', ax - 3, ay - 34, ax + 3, ay + 16, -3, 3, mat('slag'), 13, bevel=1)
    K.tube('anchor_arm', [(ax - 22, ay + 2, 0), (ax - 14, ay + 16, 0), (ax, ay + 20, 0), (ax + 14, ay + 16, 0),
                          (ax + 22, ay + 2, 0)], 3, mat('slag'), 13, resolution=1)
    K.tube('anchor_ring', [(ax + 6 * math.cos(t), ay - 40 + 6 * math.sin(t), 0) for t in
                           [i * math.tau / 12 for i in range(13)]], 1.8, mat('slag'), 14, resolution=1)
    # A car door on its side in the right bank.
    dx, dy = 1520, ground_y(1520) + 170
    K.prism('door', [(dx - 26, dy - 12), (dx + 22, dy - 16), (dx + 26, dy + 12), (dx - 24, dy + 14)], -3, 3,
            mat('army'), 13, bevel=1.5)
    K.prism('door_glass', [(dx - 18, dy - 9), (dx + 6, dy - 11), (dx + 8, dy - 1), (dx - 16, dy)], 3, 4, mat('steel'),
            14)
    # Junk sticking out of the chasm walls: pipe ends and beams.
    for i, (x, y, s) in enumerate(((GAP[0] + 2, 800, 1), (GAP[0] - 2, 900, 1), (GAP[1] - 2, 830, -1),
                                   (GAP[1] + 2, 960, -1))):
        beam(f'wallbeam{i}', (x - s * 20, y), (x + s * 16, y + 4), 8, mat('rust' if i % 2 else 'steel'), 14, -6, 8,
             bevel=1)
    for i in range(40):
        x = r.uniform(0, k.width)
        if GAP[0] - 20 < x < GAP[1] + 20:
            continue
        y = ground_y(x) + r.uniform(30, 260)
        K.log(f'bolt{i}', x, y, r.uniform(2.5, 4), 1, 3, mat('steel'), 12, vertices=6)


# ---------------------------------------------------------------------------------
# Plates, far to near. The camera over this map sits between oy = 380 and 450 on a
# desktop; `P.ay` is exact at the view's centre row (map y 680 to 750).
# ---------------------------------------------------------------------------------

M.ramp('cityfar', ['#9a6252', '#a46b58', '#ae755e', '#b98066'])
M.flat('winfar', '#e8b070')


@M.plate('skyline', parallax=0.12, outline='#8a5446')
def skyline(P):
    """The city on the horizon: towers, a dome, blocks, faint lit windows."""
    mat = P.spec.mat
    r = K.rng(71)
    base = P.ay(770)
    x = -20
    i = 0
    while x < P.width + 20:
        w = r.uniform(18, 46)
        h = r.uniform(30, 110) * (1.4 if r.random() < 0.15 else 1)
        K.box(f'block{i}', x, base - h, x + w, base + 40, -20 - i % 3, -10, mat('cityfar'), 1 + i % 2)
        if r.random() < 0.3:
            K.box(f'spire{i}', x + w * 0.4, base - h - r.uniform(10, 26), x + w * 0.6, base - h, -20, -12,
                  mat('cityfar'), 3)
        for j in range(int(h // 14)):
            if r.random() < 0.25:
                wx = x + r.uniform(3, max(4, w - 6))
                K.box(f'win{i}_{j}', wx, base - h + 6 + j * 14, wx + 3, base - h + 9 + j * 14, -9, -8, mat('winfar'), 4)
        x += w + r.uniform(-4, 10)
        i += 1
    dx = P.ax(1250)
    K.blob('dome', dx, base - 60, 46, 40, mat('cityfar'), 5, d=-15)
    K.box('dome_drum', dx - 40, base - 64, dx + 40, base + 10, -24, -14, mat('cityfar'), 6)


M.ramp('factory', ['#6e4440', '#7a4c46', '#86564e', '#946158'])
M.ramp('stackfar', ['#74443e', '#7e4c46', '#88564e', '#926058'])


@M.plate('chimneys', parallax=0.26, outline='#5c3632')
def chimneys(P):
    """Factory halls with sawtooth roofs and tall banded chimneys."""
    mat = P.spec.mat
    r = K.rng(81)
    base = P.ay(760)
    x = -30
    i = 0
    while x < P.width + 30:
        w = r.uniform(90, 170)
        h = r.uniform(34, 60)
        K.box(f'hall{i}', x, base - h, x + w, base + 50, -20, -6, mat('factory'), 1)
        teeth = int(w // 22)
        for j in range(teeth):
            tx = x + j * w / teeth
            K.prism(f'saw{i}_{j}', [(tx, base - h), (tx + w / teeth, base - h), (tx + w / teeth, base - h - 14)], -18,
                    -8, mat('factory'), 2)
        for j in range(1 if r.random() < 0.6 else 0):
            cx = x + r.uniform(0.2, 0.8) * w
            ch = r.uniform(90, 160)
            K.lathe(f'chim{i}_{j}', cx, -8, [(6, base - h - ch), (7.5, base - h - ch + 10), (9, base - h)],
                    mat('stackfar'), 3, segments=10)
            for q in range(2):
                yy = base - h - ch + 18 + q * 30
                K.lathe(f'chimband{i}_{j}_{q}', cx, -8, [(7.4, yy), (8.4, yy + 2), (8.4, yy + 5), (7.4, yy + 7)],
                        mat('factory'), 4, segments=10)
        x += w + r.uniform(20, 70)
        i += 1


M.ramp('gantry', ['#4e3230', '#5a3a36', '#68443e', '#764e46'])
M.ramp('heapmid', ['#553a36', '#60423c', '#6c4b44', '#79554c'])


@M.plate('cranes', parallax=0.44, outline='#3a2422')
def cranes(P):
    """Harbour cranes and gantries over heaps of scrap."""
    mat = P.spec.mat
    r = K.rng(91)
    base = P.ay(750)
    pts = [(x, base - 18 - 16 * abs(math.sin(x / 70 + 1)) - 10 * math.sin(x / 23)) for x in range(-40, P.width + 60, 12)]
    K.ground('heaps', pts, mat('heapmid'), 1, depth=30, bottom=P.height + 10, bevel=3)
    x = r.uniform(40, 120)
    i = 0
    while x < P.width:
        h = r.uniform(150, 220)
        foot = K.height_at(pts, x) + 10
        lattice(f'crane{i}', x, foot, foot - h, 20, mat('gantry'), 2, d=4, bay=22, member=3)
        jl = r.uniform(90, 150) * r.choice((-1, 1))
        beam(f'jib{i}', (x - jl * 0.25, foot - h + 4), (x + jl, foot - h - 6), 5, mat('gantry'), 4, 2, 6)
        K.box(f'cable{i}', x + jl * 0.8 - 1, foot - h, x + jl * 0.8 + 1, foot - h + r.uniform(30, 70), 3, 5,
              mat('gantry'), 5)
        K.box(f'cab{i}', x - 10, foot - h - 2, x + 10, foot - h + 16, 2, 8, mat('gantry'), 5)
        x += r.uniform(240, 380)
        i += 1


M.ramp('heapnear', ['#2e2224', '#382a2c', '#443436', '#503e40'])
M.ramp('heaprust', ['#4a2a22', '#56322a', '#643c32', '#72463a'])


@M.plate('heaps', parallax=0.66, outline='#1e1416')
def heaps(P):
    """Junk heaps just behind the playfield: car bodies, tyres, drums, a chain-link fence."""
    mat = P.spec.mat
    r = K.rng(101)
    base = P.ay(740)
    pts = [(x, base - 10 - 26 * abs(math.sin(x / 110 + 2)) - 8 * math.sin(x / 31)) for x in range(-40, P.width + 60, 12)]
    K.ground('pile', pts, mat('heapnear'), 1, depth=30, bottom=P.height + 10, bevel=3)
    x = r.uniform(0, 40)
    i = 0
    while x < P.width + 20:
        g = K.height_at(pts, x) + 6
        kind = r.random()
        if kind < 0.45:
            w = r.uniform(26, 40)
            K.prism(f'carbody{i}', [(x - w, g), (x + w, g), (x + w * 0.9, g - 14), (x + w * 0.4, g - 16),
                                    (x + w * 0.25, g - 28), (x - w * 0.45, g - 28), (x - w * 0.6, g - 16), (x - w, g - 12)],
                    -4, 4, mat('heaprust' if i % 2 else 'heapnear'), 2, bevel=1.5)
        elif kind < 0.6:
            for j in range(r.choice((1, 2))):
                K.log(f'tyre{i}_{j}', x + j * 3, g - 10 - j * 17, 10, -3, 5, mat('heapnear'), 3, vertices=14)
        elif kind < 0.8:
            K.lathe(f'drum{i}', x, 0, [(8, g - 24), (9, g - 12), (8, g)], mat('heaprust'), 4, segments=10)
        else:
            # A crushed car cube and a panel leaning on it.
            K.box(f'cube{i}', x - 16, g - 22, x + 16, g, -4, 4, mat('heaprust'), 5, bevel=1.5)
            K.box(f'cubecrease{i}', x - 14, g - 13, x + 14, g - 11, 4, 5, mat('heapnear'), 6)
            K.prism(f'lean{i}', [(x + 14, g), (x + 30, g), (x + 22, g - 30), (x + 14, g - 26)], -2, 3,
                    mat('heapnear'), 6, bevel=1)
        x += r.uniform(40, 90)
        i += 1
