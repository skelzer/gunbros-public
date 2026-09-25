"""
Rolling Hills (`hills`): the reference painted map (DESIGN §8.1). Copy this file.

A green valley between two hills on a sunny day. Left to right: a windmill and
haystacks on a low shelf at the edge, a terrace and the left plateau (signpost, two
pines on its shoulder), a mid-left shelf, the valley with a boulder outcrop on its left
wall, a cottage on its own ledge seated on a dry-stone wall, the ledge's back wall up to
the right shelf, and the right peak with three oaks and mushrooms. Under it all, a
cross-section of draped topsoil, clay and stone layers that thin, dip and break, with
pockets, pebbles, boulders across the layers, roots, a skeleton, a chest and an
ammonite, over mottled bedrock.

The tactical idea: two high grounds of about the same height (the left plateau and the
right shelf, where a duel starts) with a valley between them, so a 1v1 is played in lobs
over the valley, and the cottage, the pines and the oaks are cover that can be shot
away. The windmill's sails catch high lobs from the left.

The layout serves the spawn slots (constants.spawn.marginFraction 0.1 on 1800 px): 2
seats search from x = 540 and 1260, 4 seats from 360, 720, 1080 and 1440, 8 seats every
180 px from 270. Each 2- and 4-seat slot has a flat shelf under it wider than the
slot's jitter (about +-22 px for 4 seats) plus half a footprint (13 px) on both sides:
the terrace (345-385), the plateau (450-600), the mid-left shelf (748-826), the valley
floor (955-1086) and the right shelf (1290-1470). Nothing that stands up from the
ground (trees, bushes, the woodpile, the haystacks) is put on one of them. The
playability suite (packages/shared/test/mapPlayability.ts) is what checks all this.

Sequence of passes and what each changed: tools/blender/iterations/maps/hills/.
"""
import math

import map_kit as K

M = K.define(
    'hills',
    size=(1800, 1000),
    # Code-drawn sky, top to bottom; the TypeScript map file reads it from the
    # generated masks/hills.ts, so the game and the thumbnail agree.
    sky=['#3f86c4', '#6fb1e3', '#a6d8f4', '#dff1f8'],
    outline='#1b1612',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
# Terrain budget 48 colours: 11 ramps + outline + lamp = 46.
M.ramp('grass', ['#2f6a2a', '#4e9a33', '#7cc84a', '#b9ec6e'])
M.ramp('topsoil', ['#43291a', '#65402a', '#86593a', '#a87450'])
M.ramp('dirt', ['#5a3a22', '#7d5530', '#a0713f', '#c69558'], mottle=('clay', 13, 0.3))
M.ramp('clay', ['#6b3f22', '#9a5b2e', '#c07a3c', '#e0a060'])
M.ramp('stone', ['#3e4250', '#5f6574', '#8a90a0', '#b8bfcc'])
M.ramp('bark', ['#3a2416', '#5c3a22', '#7e5432', '#a4744a'])
M.ramp('leaves', ['#1f5a32', '#2f7d3c', '#4fa94a', '#8fd66a'])
M.ramp('roof', ['#6a1e1e', '#a3322a', '#d4553a', '#f08a5a'])
M.ramp('plaster', ['#8a7a66', '#cbbba0', '#efe3c8', '#fffaf0'])
M.ramp('bedrock', ['#302b33', '#4a4350', '#655d6c', '#857c8c'], mottle=('stone', 16, 0.3))
M.ramp('hay', ['#8a5a1c', '#c08a2e', '#e6b64a', '#f8e08a'])
M.flat('lamp', '#ffd35a')

# The ground line, control points left to right (the smooth curve goes through them).
PROFILE_POINTS = [
    (-20, 612), (40, 606), (110, 600), (190, 602),        # windmill shelf, far left
    (250, 588), (292, 566), (322, 550),                   # climb
    (345, 546), (385, 545),                               # terrace (4-seat spawn)
    (408, 530), (426, 510), (448, 501),                   # climb
    (480, 500), (540, 498), (600, 502),                   # left plateau (2-seat spawn)
    (650, 530), (690, 578), (722, 614),                   # down to
    (748, 627), (790, 630), (826, 633),                   # the mid-left shelf (4-seat spawn)
    (856, 666), (897, 714), (955, 736), (1015, 740),      # valley floor
    (1060, 739), (1086, 734), (1106, 712), (1116, 682),   # climb
    (1122, 662), (1165, 658), (1212, 660),                # cottage ledge
    (1232, 626), (1246, 566), (1262, 522), (1290, 506),   # the ledge's back wall
    (1340, 502), (1410, 500), (1470, 499),                # right shelf (2- and 4-seat spawns)
    (1496, 488), (1522, 466), (1560, 444),                # climb
    (1610, 434), (1665, 442),                             # right peak (trees)
    (1715, 474), (1765, 520), (1825, 548),
]


def profile():
    return K.smooth(PROFILE_POINTS, step=3.0)


@M.terrain
def terrain(k):
    mat = k.mat
    ground = profile()
    r = K.rng(1)

    # The body, then the strata over it, a pixel or two proud so each top edge catches
    # the light and the id pass draws a line under it. The soil drapes over the hills;
    # the rock below it is closer to level and the hills are cut through it, so the
    # layers thicken, thin, dip and break the way real ones do (map_kit.stratum).
    K.ground('slab', ground, mat('dirt'), 1, depth=90)
    K.stratum('topsoil', ground, 8, 26, mat('topsoil'), 2, follow=1.0, seed=2, pinch=0.0, min_cover=8)
    K.stratum('clay', ground, 74, 44, mat('clay'), 3, follow=0.6, datum=600, dip=0.03, seed=3, pinch=0.3,
              min_cover=44)
    K.stratum('stone', ground, 170, 46, mat('stone'), 4, follow=0.35, datum=600, dip=-0.045, seed=4, pinch=0.4,
              min_cover=90)
    # Pockets: lenses of clay and of stone caught in the dirt.
    for i, (px0, px1, lvl, th, m) in enumerate(((160, 330, 150, 26, 'stone'), (560, 700, 60, 18, 'clay'),
                                               (1250, 1420, 110, 30, 'stone'), (1560, 1740, 70, 20, 'clay'))):
        K.stratum(f'pocket{i}', ground, lvl, th, mat(m), 3 if m == 'clay' else 4, follow=0.9, seed=20 + i, pinch=0.0,
                  x0=px0, x1=px1, min_cover=40)
    w_deep = K.wobble(7, 18, 300)
    deep = [(x, max(y + 150, 0.3 * (y + 270) + 0.7 * (600 + 270 - 0.05 * (x - 900)) + w_deep(x)))
            for x, y in ground]
    K.ground('bedrock', deep, mat('bedrock'), 5, depth=40, d_front=2.5)
    # Boulders that sit across the layers rather than in them.
    for i, (bx, below, br) in enumerate(((300, 128, 20), (640, 190, 24), (860, 96, 16), (1180, 140, 22),
                                          (1480, 200, 26), (1660, 118, 18))):
        K.rock(f'cross{i}', bx, K.height_at(ground, bx) + below, br, mat('stone'), 6, d=3.5, seed=700 + i,
               squash=(1.3, 0.5, 0.9))

    # Pebbles sunk into the soil, and big boulders locked into the bedrock.
    for i in range(150):
        x = r.uniform(0, k.width)
        below = r.uniform(40, 250)
        y = K.height_at(ground, x) + below
        size = r.uniform(3, 6) + below / 80
        K.rock(f'pebble{i}', x, y, size, mat('stone'), 6, d=2.5, seed=100 + i, squash=(1.2, 0.5, 0.85))
    for i in range(46):
        x = r.uniform(0, k.width)
        y = K.height_at(deep, x) + r.uniform(20, 300)
        if y > k.height + 10:
            continue
        K.rock(f'boulder{i}', x, y, r.uniform(9, 22), mat('stone'), 6, d=3.5, seed=400 + i, squash=(1.3, 0.45, 0.9))

    # Roots hanging from the grass into the topsoil.
    for i in range(38):
        x = r.uniform(20, k.width - 20)
        y0 = K.height_at(ground, x) + 12
        length = r.uniform(16, 40)
        drift = r.uniform(-10, 10)
        pts = [(x + drift * t * t + math.sin(t * 5 + i) * 2.5, y0 + length * t, 3.0) for t in (0, 0.33, 0.66, 1.0)]
        K.tube(f'root{i}', pts, 2.1, mat('bark'), 7, taper=0.45, resolution=2)

    # The grass edge: walkable on top by construction (see map_kit.grass_edge).
    K.grass_edge('grass', ground, mat('grass'), (8, 9), radius=9, hem=14, seed=5,
                 flowers_mats=[mat('lamp'), mat('plaster'), mat('roof')], x_skip=((80, 165), (1100, 1225)))
    # Tall tufts only where nobody can stand: faces steeper than a mobile can climb
    # (about 1 in 2 here; the spawn rules refuse anything past 13 px over 26).
    for x in range(20, k.width - 20, 17):
        if abs(K.slope_at(ground, x, span=10)) > 0.8 and K.rng(x).random() < 0.6:
            K.tuft(f'tuft{x}', x, K.height_at(ground, x) - 7, mat('grass'), 9, r=K.rng(x), size=1.3, d=3)

    windmill(k, 122)
    cottage(k, 1160)
    outcrop(k)
    farmyard(k)
    buried(k)
    for i, (tx, h, crown) in enumerate(((1585, 92, 46), (1668, 112, 54), (1745, 80, 40))):
        K.tree(f'tree{i}', tx, K.height_at(ground, tx) + 3, h, crown, (mat('bark'), mat('leaves')), (19, 20),
               d=4, seed=40 + i, lean=r.uniform(-5, 5), lobes=8)
    # Pines on the left hill's shoulder: a pointed top is no place to start a match,
    # where a round crown near a spawn slot would be (its top is flat enough to pass).
    for i, (tx, h, w) in enumerate(((676, 96, 44), (703, 74, 34))):
        K.pine(f'pine{i}', tx, K.height_at(ground, tx) + 4, h, w, (mat('bark'), mat('leaves')), (19, 20), d=4)
    # A few bushes: obstacles a mobile has to blow away or climb round, so kept off the
    # spawn shelves.
    for i, bx in enumerate((262, 872)):
        by = K.height_at(ground, bx) - 4
        K.blob(f'bush{i}_a', bx, by - 9, 20, 15, mat('leaves'), 21, d=6)
        K.blob(f'bush{i}_b', bx + 15, by - 6, 14, 11, mat('leaves'), 21, d=10)
        K.blob(f'bush{i}_c', bx - 14, by - 4, 11, 8, mat('leaves'), 21, d=9)


def windmill(k, x):
    """A stone tower mill with a red cap and four lattice sails; all of it can be shot."""
    mat = k.mat
    g = K.height_at(profile(), x) + 8
    top = g - 150
    K.lathe('mill_base', x, 0, [(40, g - 16), (42, g - 8), (42, g + 6)], mat('stone'), 10, segments=14)
    K.lathe('mill_tower', x, 0, [(25, top), (28, top + 40), (33, top + 100), (38, g - 12)], mat('plaster'), 11,
            segments=18)
    K.lathe('mill_band', x, 0, [(30, top + 58), (31, top + 64)], mat('bark'), 16, segments=18)
    K.lathe('mill_cap', x, 0, [(0, top - 34), (16, top - 28), (30, top - 10), (33, top + 4)], mat('roof'), 12,
            segments=18)
    K.box('mill_door', x - 11, g - 38, x + 11, g - 6, 30, 42, mat('bark'), 18, bevel=2)
    K.box('mill_window', x - 8, top + 22, x + 8, top + 42, 26, 36, mat('lamp'), 18)
    K.box('mill_window2', x - 7, top + 78, x + 7, top + 94, 30, 38, mat('lamp'), 18)
    hub = (x + 4, top + 2)
    K.blob('mill_hub', hub[0], hub[1], 9, 9, mat('bark'), 13, d=40)
    for i in range(4):
        a = math.radians(24 + 90 * i)
        c, s = math.cos(a), math.sin(a)
        L = 104

        def pt(u, v):
            return (hub[0] + c * u - s * v, hub[1] - s * u - c * v)

        K.tube(f'mill_spar{i}', [(*pt(4, 0), 40), (*pt(L, 0), 40)], 3.0, mat('bark'), 13, resolution=2)
        sail = [pt(18, 4), pt(L - 2, 4), pt(L - 2, 24), pt(22, 21)]
        K.prism(f'mill_sail{i}', sail, 35, 38, mat('plaster'), 14)
        for j, u in enumerate((40, 61, 82)):
            K.tube(f'mill_rib{i}_{j}', [(*pt(u, 3), 40), (*pt(u, 24), 40)], 1.6, mat('bark'), 13, resolution=1)


def cottage(k, x):
    """A timber-framed cottage on a dry-stone wall, with a chimney, a lit window and a woodpile."""
    mat = k.mat
    g = K.height_at(profile(), x) - 2
    w, h = 104, 62
    x0, x1 = x - w / 2, x + w / 2
    # Seated into the slope: a dry-stone retaining wall from the footing down into the
    # ground, so the valley side of the house stands on stone and not on air.
    wall_top = g - 8
    base = [(xx, K.height_at(profile(), xx) + 22) for xx in range(int(x0 - 16), int(x1 + 10), 4)]
    K.prism('house_wall', [(x0 - 16, wall_top + 4), (x0 - 10, wall_top), (x1 + 8, wall_top)] +
            list(reversed(base)), -18, 30, mat('stone'), 10, bevel=2)
    rr = K.rng(77)
    row = 0
    yy = wall_top + 2
    while yy < max(b for _, b in base) - 6:
        xx = x0 - 12 + (7 if row % 2 else 0)
        while xx < x1 + 6:
            if yy < K.height_at(profile(), xx) + 8:
                K.rock(f'house_stone{row}_{int(xx)}', xx + rr.uniform(-1.5, 1.5), yy + 5, rr.uniform(6.5, 8),
                       mat('stone'), 10 + (row + int(xx // 14)) % 2, d=31, seed=900 + row * 50 + int(xx),
                       squash=(1.25, 0.35, 0.8), jitter=0.12)
            xx += 14
        yy += 11
        row += 1
    # Grass and a bush tucked round its foot, where it meets the slope.
    for i, (bx, by) in enumerate(((x0 - 6, K.height_at(profile(), x0 - 6) - 10), (x1 + 2, g - 4))):
        K.blob(f'house_bush{i}_a', bx, by - 6, 14, 11, mat('leaves'), 21, d=34)
        K.blob(f'house_bush{i}_b', bx + 11, by - 2, 10, 8, mat('leaves'), 21, d=38)
    for tx in (x0 - 8, x0 + 20, x0 + 48, x1 - 20):
        K.tuft(f'house_tuft{int(tx)}', tx, g - 7, mat('grass'), 9, r=K.rng(int(tx)), size=1.2, d=33)
    K.box('house_walls', x0, g - h, x1, g - 8, -10, 28, mat('plaster'), 15, bevel=1.5)
    for i, bx in enumerate((x0, x1 - 6, x - 3)):
        K.box(f'house_post{i}', bx, g - h, bx + 6, g - 8, 28, 31, mat('bark'), 16)
    K.box('house_beam', x0, g - h + 22, x1, g - h + 27, 28, 31, mat('bark'), 16)
    K.prism('house_brace', [(x0 + 6, g - h + 27), (x0 + 10, g - h + 27), (x - 3, g - 12), (x - 7, g - 12)], 28, 31,
            mat('bark'), 16)
    K.roof('house_roof', x0, x1, g - h, g - h - 52, -16, 34, mat('roof'), 17, overhang=12, thickness=8)
    K.box('house_chimney', x1 - 30, g - h - 62, x1 - 14, g - h - 18, -4, 14, mat('stone'), 16, bevel=1.5)
    K.box('house_door', x + 14, g - 44, x + 34, g - 8, 29, 34, mat('bark'), 18, bevel=1.5)
    K.box('house_window', x - 38, g - 46, x - 16, g - 28, 29, 33, mat('lamp'), 18)
    K.box('house_window_bar', x - 28, g - 46, x - 26, g - 28, 33, 34, mat('bark'), 16)
    K.box('house_sill', x - 41, g - 28, x - 13, g - 24, 29, 36, mat('bark'), 16)
    # A woodpile between the house and the ledge's back wall: logs seen end on.
    for i, (lx, ly) in enumerate(((x1 + 8, g - 6), (x1 + 17, g - 6), (x1 + 12.5, g - 14))):
        K.log(f'house_log{i}', lx, ly, 5, 4, 28, mat('bark'), 16 + i % 2)
        K.log(f'house_logend{i}', lx, ly, 3, 28, 29, mat('plaster'), 18)


def farmyard(k):
    """
    The small things that make it a place: haystacks by the mill, a signpost on the lip
    of the plateau, mushrooms under the trees on the peak. All of it is terrain, and all
    of it stands where nobody spawns (map_kit's walkability rule).
    """
    mat = k.mat
    ground = profile()
    for i, (hx, rx, ry) in enumerate(((210, 28, 22), (242, 19, 15))):
        g = K.height_at(ground, hx) - 6
        K.blob(f'hay{i}', hx, g - ry * 0.7, rx, ry, mat('hay'), 23, d=12, rd=rx * 0.8)
        K.tube(f'hay{i}_band', [(hx - rx * 0.95, g - ry * 0.55, 12 + rx * 0.2), (hx + rx * 0.95, g - ry * 0.55, 12 + rx * 0.2)],
               1.6, mat('bark'), 16, resolution=1)
    sx = 628
    g = K.height_at(ground, sx) - 6
    K.box('sign_post', sx - 2.5, g - 44, sx + 2.5, g + 8, 10, 15, mat('bark'), 16, bevel=0.8)
    K.prism('sign_board', [(sx - 20, g - 42), (sx + 14, g - 42), (sx + 22, g - 35), (sx + 14, g - 28), (sx - 20, g - 28)],
            15, 19, mat('plaster'), 22)
    K.box('sign_letters', sx - 14, g - 37, sx + 10, g - 33, 19, 20, mat('bark'), 16)
    for i, (mx, h, r_) in enumerate(((1612, 12, 11), (1628, 8, 8), (1700, 11, 10), (1715, 7, 7))):
        g = K.height_at(ground, mx) - 6
        K.cylinder(f'mush{i}_stem', mx, g - h, g + 2, r_ * 0.35, mat('plaster'), 24, d=14, vertices=8)
        K.blob(f'mush{i}_cap', mx, g - h, r_, r_ * 0.6, mat('roof'), 25, d=14, segments=12, rings=6)
        K.blob(f'mush{i}_dot', mx - r_ * 0.3, g - h - r_ * 0.35, 1.6, 1.4, mat('plaster'), 26, d=14 + r_ * 0.8,
               segments=6, rings=3)


def buried(k):
    """What the cross-section gives away: old bones, a lost chest, a snail shell in stone."""
    mat = k.mat
    ground = profile()
    # A skeleton lying in the clay under the left plateau: a big chibi skull, a spine
    # and ribs, chunky enough to read at 1x.
    bx, by = 470, K.height_at(ground, 470) + 86
    K.blob('bone_skull', bx, by, 15, 13, mat('plaster'), 12, d=4, rd=9)
    K.blob('bone_jaw', bx + 5, by + 10, 9, 5, mat('plaster'), 12, d=4, rd=6)
    K.blob('bone_eye', bx + 5, by - 2, 4, 4.5, mat('bark'), 13, d=12, segments=10, rings=5)
    K.tube('bone_spine', [(bx - 14, by + 4, 4), (bx - 40, by + 9, 4), (bx - 72, by + 6, 4)], 3.2, mat('plaster'), 12,
           resolution=1)
    for j in range(4):
        rx = bx - 24 - j * 11
        K.tube(f'bone_rib{j}', [(rx + 2, by - 6, 4), (rx - 3, by + 6, 4), (rx, by + 20, 4)], 2.6, mat('plaster'), 12,
               resolution=1)
    # A treasure chest caught in the stone band under the right shelf.
    cx, cy = 1372, K.height_at(ground, 1372) + 172
    K.box('chest_body', cx - 16, cy - 8, cx + 16, cy + 10, -4, 10, mat('bark'), 12, bevel=1.5)
    K.prism('chest_lid', [(cx - 16, cy - 8), (cx - 14, cy - 16), (cx + 14, cy - 16), (cx + 16, cy - 8)], -4, 10,
            mat('bark'), 13, bevel=1.2)
    K.box('chest_band', cx - 2, cy - 16, cx + 2, cy + 10, 10, 11, mat('hay'), 14)
    K.box('chest_lock', cx - 3.5, cy - 9, cx + 3.5, cy - 3, 11, 12, mat('lamp'), 15)
    # An ammonite in the bedrock under the valley.
    ax, ay = 1004, K.height_at(ground, 1004) + 300
    pts = [(ax + math.cos(t) * (3 + t * 2.2), ay + math.sin(t) * (3 + t * 2.2), 4) for t in
           [i * 0.35 for i in range(28)]]
    K.tube('ammonite', pts, 2.6, mat('clay'), 12, resolution=1)


def outcrop(k):
    """A pile of boulders in the valley bottom: cover for whoever walks down there."""
    mat = k.mat
    base_x = 912
    g = K.height_at(profile(), base_x)
    for i, (dx, dy, r_) in enumerate(((0, -18, 28), (-32, -6, 19), (28, -6, 18), (8, -44, 17), (-14, -34, 14),
                                      (44, -2, 11))):
        K.rock(f'outcrop{i}', base_x + dx, g + dy, r_, mat('stone'), 10 + i % 2, d=10, seed=300 + i,
               squash=(1.1, 0.8, 0.9), detail=1)


# ---------------------------------------------------------------------------------
# Plates, far to near. Each is modelled in its own canvas (P.size) and `P.at(x, y)`
# places a thing behind map point (x, y).
# ---------------------------------------------------------------------------------

M.ramp('peakfar', ['#6a79a6', '#7382ae', '#7f8eb7', '#8f9dc2'])
M.ramp('snowfar', ['#98a7c9', '#a9b7d5', '#bac6df', '#c9d3e8'])


@M.plate('far', parallax=0.14, outline='#5d6b96')
def far(P):
    """The distant snowy range: pale, low contrast, big."""
    mat = P.spec.mat
    r = K.rng(11)
    base = P.ay(790)
    x = -60
    i = 0
    while x < P.width + 120:
        h = r.uniform(95, 150)
        K.mountain(f'peak{i}', x, base, h, h * r.uniform(1.1, 1.4), mat('peakfar'), 1 + i % 2,
                   snow=(mat('snowfar'), 3), snow_line=0.2, d=-i * 3, seed=20 + i, facets=7)
        x += r.uniform(140, 210)
        i += 1
    K.box('foot', -10, base, P.width + 10, P.height + 10, -80, -60, mat('peakfar'), 1)


M.ramp('peak', ['#435679', '#506589', '#5f7598', '#7086a8'])
M.ramp('snow', ['#8fa0c0', '#a8b7d2', '#c2cee2', '#d8e1ee'])
M.ramp('pinefar', ['#2d4a4f', '#3b5f5c', '#4f7a68', '#6a9676'])


@M.plate('range', parallax=0.26, outline='#39496b')
def range_(P):
    """The nearer mountains, darker and bluer, with pine forest up their feet."""
    mat = P.spec.mat
    r = K.rng(15)
    base = P.ay(780)
    x = 40
    i = 0
    while x < P.width + 100:
        h = r.uniform(80, 125)
        K.mountain(f'peak{i}', x, base, h, h * r.uniform(1.1, 1.4), mat('peak'), 1 + i % 2,
                   snow=(mat('snow'), 3), snow_line=0.18, d=-i * 3, seed=60 + i, facets=7)
        x += r.uniform(160, 260)
        i += 1
    forest = [(fx, base - 18 + 10 * math.sin(fx / 60)) for fx in range(-20, P.width + 40, 20)]
    K.ground('forest_floor', forest, mat('pinefar'), 4, depth=20, d_front=30)
    fx = -10
    j = 0
    while fx < P.width + 20:
        K.pine(f'pine{j}', fx, K.height_at(forest, fx) + 6, r.uniform(26, 44), r.uniform(14, 20),
               (mat('pinefar'), mat('pinefar')), (5, 6), d=40, tiers=2)
        fx += r.uniform(9, 16)
        j += 1


M.ramp('hillfar', ['#3f6f4c', '#528a55', '#6fa864', '#94c67a'])
M.ramp('housefar', ['#8c7e70', '#b8aa94', '#d8cdb4', '#efe6d0'])
M.ramp('rooffar', ['#7a3a36', '#a24d40', '#c46a50', '#dc8c68'])


@M.plate('mid', parallax=0.42, outline='#2f4a3a')
def mid(P):
    """Rolling farmland with a village and a church on the crest."""
    mat = P.spec.mat
    r = K.rng(21)
    pts = []
    x = -60
    while x < P.width + 160:
        pts.append((x, P.ay(640) - 44 * math.sin(x / 170 + 1.2) - 26 * math.sin(x / 71) - 10))
        x += 60
    ridge = K.smooth(pts, 4)
    K.ground('hills', ridge, mat('hillfar'), 1, depth=40, bottom=P.height + 10, bevel=5)
    # Field strips on the slopes, a shade apart, like ploughed rows.
    for i in range(3):
        K.band(f'field{i}', K.offset(ridge, 18 + i * 26), K.offset(ridge, 28 + i * 26), -10, 4, mat('hillfar'), 2)
    for i, hx in enumerate((228, 262, 296, 332, 790, 826, 866, 902, 1090, 1124)):
        gy = K.height_at(ridge, hx) + 6
        w = r.uniform(20, 28)
        h = r.uniform(15, 22)
        K.box(f'house{i}', hx - w / 2, gy - h, hx + w / 2, gy, -6, 8, mat('housefar'), 3, bevel=1)
        K.roof(f'roof{i}', hx - w / 2, hx + w / 2, gy - h, gy - h - w * 0.55, -8, 10, mat('rooffar'), 4, overhang=3,
               thickness=3)
    # The church: a nave with a pitched roof and a bell tower with a spire.
    cx = 846
    gy = K.height_at(ridge, cx) + 6
    K.box('nave', cx - 4, gy - 24, cx + 30, gy, -6, 10, mat('housefar'), 3, bevel=1)
    K.roof('nave_roof', cx - 4, cx + 30, gy - 24, gy - 40, -8, 12, mat('rooffar'), 4, overhang=3, thickness=3)
    K.box('tower', cx - 16, gy - 52, cx - 2, gy, -4, 14, mat('housefar'), 3, bevel=1)
    K.roof('spire', cx - 16, cx - 2, gy - 52, gy - 84, -6, 16, mat('rooffar'), 4, overhang=2, thickness=3)
    for i in range(34):
        tx = r.uniform(0, P.width)
        gy = K.height_at(ridge, tx) + 4
        K.blob(f'tree{i}', tx, gy - 11, r.uniform(9, 14), r.uniform(11, 16), mat('leaves'), 5, d=12)


@M.plate('near', parallax=0.64, outline='#16301f')
def near(P):
    """The tree line just behind the playfield: round oaks and a few pines on a hedge."""
    mat = P.spec.mat
    r = K.rng(31)
    base = P.ay(706)
    pts = [(x, base + 14 * math.sin(x / 90) + 8 * math.sin(x / 37)) for x in range(-40, P.width + 60, 30)]
    line = K.smooth(pts, 4)
    K.ground('hedge', line, mat('leaves'), 1, depth=30, bottom=P.height + 10, bevel=6)
    x = -20
    i = 0
    while x < P.width + 30:
        gy = K.height_at(line, x) + 12
        if r.random() < 0.3:
            K.pine(f'pine{i}', x, gy, r.uniform(70, 110), r.uniform(34, 46), (mat('bark'), mat('leaves')), (2, 3),
                   d=0, tiers=3)
        else:
            K.tree(f'tree{i}', x, gy, r.uniform(40, 70), r.uniform(28, 40), (mat('bark'), mat('leaves')), (2, 3),
                   d=0, seed=500 + i, lobes=7)
        x += r.uniform(38, 90)
        i += 1
