"""
Sunset Chasm (`pit`): a desert canyon at sunset (DESIGN §8.1).

Two red sandstone mesas face each other across a chasm that goes all the way down: a
mobile that falls in is gone. Left to right: a low desert floor with a cattle skeleton
and a saguaro, the left mesa's lower tier, its tier wall, the left mesa top with a
balanced-rock hoodoo, the chasm with a rope-and-plank bridge slung across it, a cliff
dwelling of adobe houses tucked into an alcove in the right mesa's chasm wall, the right
mesa top with a tall saguaro, its lower tier, and a slope down to the desert floor with
bleached bones. The rock is layered: red beds, hard orange and cream beds that stand
proud of the chasm walls as ledges, and dark purple rock in the depths. Buried in it: a
dinosaur skull, a clay pot, pebbles and boulders.

The tactical idea: both teams start on high ground with nothing between them but air,
so a duel is a straight artillery exchange across the gap, and every shot that falls
short digs into the rim and makes the edge you stand on smaller. The bridge is the
temptation: it is standable and walkable (under a mobile's step everywhere), so you can
drive out onto it for a better angle, but it is a few planks thick, one shot drops it
and whoever is on it into the chasm. It is also far too thin to spawn on (spawnGen asks
for 12 px of rock under the feet). The dwelling's houses soak up low shots at the right
wall under the rim; its recess is paint on solid rock, so the rim above stays the
ground those columns spawn on.

Spawn slots on 1900 px (margin 190): 2 seats search from 570 and 1330, 4 seats from
380, 760, 1140 and 1520, 8 seats every 190 px from 285. Shelves: the left lower tier
(240-440), the left mesa (495-830; the hoodoo stands at 676, between the 2- and 4-seat
shelves), the right mesa (1100-1430; the saguaro stands at 1225) and the right lower
tier (1476-1640).

Sequence of passes and what each changed: tools/blender/iterations/maps/pit/.
"""
import math

import map_kit as K

M = K.define(
    'pit',
    size=(1900, 1050),
    sky=['#2a1a41', '#5a2c5a', '#a3485c', '#dc6e4c', '#f5ab5e', '#ffd790'],
    outline='#1e1016',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
# Terrain budget 48 colours: 11 ramps + outline + 2 flats = 47.
M.ramp('sand', ['#8a4f2c', '#c07a42', '#e6a860', '#fbd48a'])
M.ramp('orange', ['#7c3a20', '#b35a2c', '#d9803e', '#f2a95c'])
M.ramp('red', ['#5e2220', '#8a3526', '#b24c30', '#d46a40'], mottle=('orange', 20, 0.14))
M.ramp('cream', ['#8c5c46', '#c28c68', '#e2b88c', '#f6dcb2'])
M.ramp('deep', ['#2e1826', '#46222e', '#61303a', '#7e4248'], mottle=('stone', 24, 0.1))
M.ramp('stone', ['#4a3440', '#6c5058', '#927076', '#b89494'])
M.ramp('wood', ['#3a2016', '#5e3824', '#865434', '#ae7a4c'])
M.ramp('bone', ['#9a8672', '#cdbfa2', '#ebe0c4', '#fffaea'])
M.ramp('adobe', ['#7e4632', '#b06c48', '#d49466', '#eebc88'])
M.ramp('cactus', ['#2a4630', '#3c6a3c', '#5a9048', '#8ab860'])
M.ramp('rope', ['#6a4c2a', '#9c7a48', '#c4a468', '#e6cc90'])
M.flat('fruit', '#ec5a78')
M.flat('dark', '#2a1216')

W_MAP, H_MAP = 1900, 1050
BOTTOM = H_MAP + 30

# The beds, top to bottom: (top, bottom, material, how far the bed stands out of a
# chasm wall; negative is a soft bed the wall is cut back into). Red beds are the slab
# itself; the others are drawn over it.
LAYERS = [
    (526, 544, 'cream', 5),
    (544, 588, 'red', -2),
    (588, 602, 'orange', 3),
    (602, 648, 'red', -3),
    (648, 668, 'orange', 2),
    (668, 686, 'cream', 4),
    (686, 736, 'red', -2),
    (736, 756, 'orange', 3),
    (756, 806, 'red', -3),
    (806, 822, 'cream', 3),
    (822, BOTTOM + 10, 'deep', 0),
]


def hardness(y):
    for top, bottom, _m, h in LAYERS:
        if top <= y < bottom:
            return h
    return 0


_jag_l = K.wobble(61, 2.2, 40)
_jag_r = K.wobble(62, 2.2, 40)

LEFT_RIM_Y = 522
RIGHT_RIM_Y = 505
# The cliff dwelling: a recess painted into the right wall above a hard ledge. The
# recess is solid rock in the mask (only its paint is dark), so the rim over it stays
# the lowest ground in those columns and nothing about spawning changes.
ALC_FRONT = 1026
ALC_BACK = 1136
ALC_TOP = 594
ALC_FLOOR = 680
LEDGE_FRONT = 1012
LEDGE_BOTTOM = 700


def wall_l(y):
    """Right edge of the left mesa (the chasm's left wall) at row y."""
    return 832 - 0.045 * (y - LEFT_RIM_Y) + hardness(y) + _jag_l(y)


def wall_r(y):
    """Left edge of the right mesa at row y: the rim face, the ledge, the undercut wall."""
    if y < ALC_FLOOR:
        return ALC_FRONT - hardness(y) * 0.6 + _jag_r(y) * 0.5
    if y < LEDGE_BOTTOM:
        return LEDGE_FRONT + (y - ALC_FLOOR) * 0.5
    base = 1052 + 0.045 * (y - LEDGE_BOTTOM) - hardness(y) + _jag_r(y)
    ramp = min(1.0, (y - LEDGE_BOTTOM) / 16)
    return (LEDGE_FRONT + 10) * (1 - ramp) + base * ramp


def wall_trace(fn, y0, y1, step=2.0):
    pts = []
    y = y0
    while y < y1:
        pts.append((fn(y), y))
        y += step
    pts.append((fn(y1), y1))
    return pts


LEFT_POINTS = [
    (-20, 702), (40, 700), (100, 698), (140, 694),               # desert floor, far left
    (160, 684), (176, 660), (190, 630), (204, 612), (222, 605),  # climb
    (240, 604), (330, 603), (420, 605), (438, 603),              # lower tier (4 seats: 380)
    (452, 586), (464, 556), (476, 532), (490, 522),              # tier wall
    (500, 521), (570, 520), (640, 519), (700, 520),              # left mesa (2 seats: 570)
    (760, 521), (800, 522), (wall_l(LEFT_RIM_Y), LEFT_RIM_Y),     # (4 seats: 760), rim
]
RIGHT_POINTS = [
    (wall_r(RIGHT_RIM_Y), RIGHT_RIM_Y), (1060, 505), (1140, 504),  # rim (4 seats: 1140)
    (1220, 505), (1330, 504), (1400, 505), (1424, 507),            # right mesa (2 seats: 1330)
    (1438, 522), (1450, 550), (1462, 578), (1476, 590),            # tier wall
    (1500, 591), (1560, 592), (1630, 593),                         # lower tier (4 seats: 1520)
    (1668, 606), (1712, 634), (1770, 664), (1830, 682), (1920, 690),
]


def left_profile():
    return K.smooth(LEFT_POINTS, step=3.0)


def right_profile():
    return K.smooth(RIGHT_POINTS, step=3.0)


def surface_at(x):
    if x <= wall_l(LEFT_RIM_Y) + 1:
        return K.height_at(left_profile(), x)
    if x >= wall_r(RIGHT_RIM_Y) - 1:
        return K.height_at(right_profile(), x)
    return None


def crust(name, profile, material, groups, radius=5.0, hem=10.0, seed=0, stones=None):
    """
    The sandy top of a mesa, walkable by construction: a rounded lip (the walking
    surface), a skirt with a ragged hem over the rock, and pebbles set into the lip's
    front below its top so nothing stands up on the silhouette.
    """
    g_lip, g_peb = groups
    r = K.rng(seed)
    K.tube(f'{name}_lip', [(x, y, 1.0) for x, y in profile], radius, material, g_lip, resolution=3)
    hem_line = [(x, y + hem + 4 * abs(math.sin(x * math.pi / 17)) + 3 * math.sin(x / 7.3)) for x, y in profile]
    K.band(f'{name}_skirt', K.offset(profile, 1), hem_line, -8, 2.5, material, g_lip)
    if stones:
        x = profile[0][0] + 6
        while x < profile[-1][0] - 6:
            y = K.height_at(profile, x)
            K.rock(f'{name}_peb{int(x)}', x, y + r.uniform(2, 6), r.uniform(1.8, 3.0), stones, g_peb,
                   d=radius + 2.5, seed=int(x) + seed, squash=(1.3, 0.5, 0.8))
            x += r.uniform(9, 22)
    return K.offset(profile, -radius)


FAULTS = [
    # (x at y = 600, lean px per px of depth, throw: how far the beds on its outer side dropped)
    (262, 0.32, 11, -1),
    (1566, -0.3, 9, 1),
]


def fault_throw(x, y):
    """How far the beds at (x, y) have been dropped by the faults on the mesas' outer ends."""
    dy = 0.0
    for fx, lean, throw, side in FAULTS:
        at = fx + lean * (y - 600)
        if (side < 0 and x < at) or (side > 0 and x > at):
            dy += throw
    return dy


def bed_shift(x, y):
    """
    Where a bed at nominal row y actually is in column x: the whole pile dips gently
    away from the chasm (it was lifted there), and the faults drop the outer ends.
    Zero at the chasm walls, so the ledges they stand out as stay where the wall is.
    """
    dist = max(0.0, abs(x - 926) - 130)
    return 0.022 * dist + fault_throw(x, y)


# Beds that thin to nothing and come back (index into LAYERS): lenses of harder rock.
PINCHED = {2, 4, 7}


def beds(piece, profile, wall_fn, x_far, side):
    """
    The coloured beds of one mesa: horizontal bands cut by its surface (a bed never
    comes closer than a few px under the ground) and ending exactly on its chasm wall.
    `side` is -1 for the left mesa (wall on its right), +1 for the right one.
    """
    for i, (top, bottom, m, _h) in enumerate(LAYERS):
        if m == 'red':
            continue
        w_t = K.wobble(300 + i, 4.5, 220)
        w_b = K.wobble(320 + i, 5.0, 170)
        w_p = K.wobble(340 + i, 1.0, 260)

        def w_top(x, top=top, w_t=w_t):
            return w_t(x) + bed_shift(x, top)

        def w_bot(x, top=top, bottom=bottom, w_t=w_t, w_b=w_b, w_p=w_p, i=i):
            th = bottom - top + w_b(x) - w_t(x)
            if i in PINCHED:
                th *= max(0.0, min(1.3, 0.55 + 0.9 * w_p(x)))
            return w_t(x) + bed_shift(x, top) + th - (bottom - top)
        # The wall end of the band follows the wall from its top to its bottom.
        y_top_wall = top + w_top(wall_fn(top))
        y_bot_wall = min(bottom + w_bot(wall_fn(bottom)), BOTTOM)
        x_wall_top = wall_fn(y_top_wall)
        x_wall_bot = wall_fn(y_bot_wall)
        xs = []
        if side < 0:
            x = x_far
            end = min(x_wall_top, x_wall_bot) - 1
            while x < end:
                xs.append(x)
                x += 4
        else:
            x = max(x_wall_top, x_wall_bot) + 1
            x = math.ceil(x / 4) * 4
            while x < x_far:
                xs.append(x)
                x += 4
            xs.append(x_far)
        runs, run = [], []
        for x in xs:
            s = K.height_at(profile, x)
            t = max(top + w_top(x), s + 12)
            b = min(bottom + w_bot(x), BOTTOM)
            if b - t >= 2:
                run.append((x, t, b))
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
        g = 2 + i % 3
        for j, rr in enumerate(runs):
            if len(rr) < 2:
                continue
            upper = [(x, t) for x, t, _ in rr]
            lower = [(x, b) for x, _, b in rr]
            touches_wall = (side < 0 and rr is runs[-1] and rr[-1][0] >= xs[-1] - 1) or \
                           (side > 0 and rr is runs[0] and rr[0][0] <= xs[0] + 1)
            if touches_wall and side < 0:
                poly = upper + wall_trace(wall_fn, upper[-1][1], lower[-1][1]) + list(reversed(lower))
            elif touches_wall:
                poly = wall_trace(wall_fn, upper[0][1], lower[0][1]) + lower + list(reversed(upper))
            else:
                poly = upper + list(reversed(lower))
            K.prism(f'{piece}_bed{i}_{j}', poly, -30, 1.5 + 0.08 * i, M.mat(m), g)


@M.terrain
def terrain(k):
    mat = k.mat
    lp, rp = left_profile(), right_profile()
    r = K.rng(1)

    # The two mesas: surface, chasm wall, map bottom.
    left_wall = wall_trace(wall_l, LEFT_RIM_Y + 1, BOTTOM)
    K.prism('left_slab', lp + left_wall + [(-20, BOTTOM)], -90, 0, mat('red'), 1)
    right_wall = list(reversed(wall_trace(wall_r, RIGHT_RIM_Y + 1, BOTTOM)))
    K.prism('right_slab', [(wall_r(BOTTOM), BOTTOM)] + right_wall[1:] + rp + [(1920, BOTTOM)], -90, 0,
            mat('red'), 1)
    beds('left', lp, wall_l, -20, -1)
    beds('right', rp, wall_r, 1920, 1)
    # Lenses of harder rock caught in the red beds, so no bed runs the whole way.
    for i, (lx0, lx1, ly, th, m) in enumerate(((250, 420, 632, 12, 'orange'), (520, 760, 572, 10, 'cream'),
                                               (560, 790, 716, 13, 'cream'), (60, 300, 784, 12, 'orange'),
                                               (1180, 1400, 624, 12, 'cream'), (1480, 1650, 652, 10, 'orange'),
                                               (1250, 1500, 708, 13, 'orange'), (1600, 1860, 788, 12, 'cream'),
                                               (360, 700, 846, 16, 'red'), (1150, 1550, 870, 18, 'red'))):
        w_l = K.wobble(700 + i, 2.0, 90)
        up, lo = [], []
        x = lx0
        while x <= lx1:
            t = (x - lx0) / (lx1 - lx0)
            half = th / 2 * math.sin(math.pi * t) ** 0.7
            sh = bed_shift(x, ly)
            up.append((x, ly - half + w_l(x) + sh))
            lo.append((x, ly + half + w_l(x) * 0.5 + sh))
            x += 4
        K.prism(f'lens{i}', up + list(reversed(lo)), -30, 1.8, mat(m), 5)

    # Cross-bedding in the thick red beds: sets of curved foresets, the dunes this
    # sandstone was before it was rock, each set cut off at its top by the next.
    rx = K.rng(55)
    for i, (bx, by) in enumerate(((120, 760), (380, 668), (600, 612), (720, 780), (1150, 700), (1290, 572),
                                  (1420, 768), (1700, 720), (520, 792), (1600, 628))):
        by += bed_shift(bx, by)
        n = rx.choice((4, 5, 6))
        lean = rx.choice((-1, 1))
        for j in range(n):
            x0 = bx + j * 7 * lean
            pts = [(x0 + lean * t * 20 + lean * t * t * 8, by - 14 + t * 28, 2.0) for t in (0, 0.35, 0.7, 1.0)]
            K.tube(f'xbed{i}_{j}', pts, 1.0, mat('orange'), 9, resolution=1, faceted=True)
    # The faults themselves: a crushed seam of darker rock along each.
    for i, (fx, lean, _throw, _side) in enumerate(FAULTS):
        prof = lp if fx < 900 else rp
        y0 = K.height_at(prof, fx) + 14
        pts = [(fx + lean * (y - 600) + rx.uniform(-1.5, 1.5), y, 2.2) for y in range(int(y0), 880, 10)]
        K.tube(f'fault{i}', pts, 1.6, mat('deep'), 9, resolution=1, faceted=True)

    # Pebbles and boulders in the beds, dark rocks in the depths.
    for i in range(170):
        x = r.uniform(0, W_MAP)
        s = surface_at(x)
        if s is None:
            continue
        y = s + r.uniform(18, 420)
        if x < 1000 and x > wall_l(y) - 6:
            continue
        if x > 900 and x < wall_r(y) + 6:
            continue
        size = r.uniform(2.5, 5) + (y - s) / 110
        K.rock(f'pebble{i}', x, y, size, mat('stone'), 6, d=2.5, seed=100 + i, squash=(1.3, 0.5, 0.8))
    for i in range(26):
        x = r.uniform(0, W_MAP)
        y = r.uniform(830, 1040)
        if wall_l(y) - 22 < x < wall_r(y) + 22:
            continue
        K.rock(f'boulder{i}', x, y, r.uniform(10, 22), mat('stone'), 6, d=3.5, seed=400 + i,
               squash=(1.3, 0.45, 0.9))

    # Joints: cracks running down the chasm cliffs, where the next slab will fall.
    for i, (fn, off, y0, y1) in enumerate(((wall_l, -16, 548, 700), (wall_l, -44, 610, 790), (wall_l, -24, 720, 820),
                                          (wall_r, 22, 720, 810), (wall_r, 58, 560, 640), (wall_r, 40, 740, 830))):
        rj = K.rng(900 + i)
        pts = []
        y = y0
        while y <= y1:
            pts.append((fn(y) + off + rj.uniform(-3, 3), y, 2.2))
            y += rj.uniform(10, 18)
        K.tube(f'joint{i}', pts, 1.2, mat('deep'), 9, taper=0.5, resolution=1, faceted=True)

    # The sandy tops.
    stones = mat('stone')
    crust('lcrust', lp, mat('sand'), (7, 8), seed=5, stones=stones)
    crust('rcrust', rp, mat('sand'), (7, 8), seed=6, stones=stones)

    bridge(k)
    dwelling(k)
    hoodoo(k, 676)
    cacti(k)
    bones(k)
    buried(k)


def bridge(k):
    """
    A rope-and-plank bridge across the chasm: planks on two ropes, sagging a little,
    tied off to stakes driven into each rim's face. Four px of plank on the rope, so it
    is walkable and never a spawn, and one missing plank to make it rickety.
    """
    mat = k.mat
    x0 = wall_l(LEFT_RIM_Y) - 3
    x1 = wall_r(RIGHT_RIM_Y) + 3
    y0 = LEFT_RIM_Y - 5 + 1       # the lip's walking surface, a px lower
    y1 = RIGHT_RIM_Y - 5 + 1
    sag = 15

    def deck(x):
        t = (x - x0) / (x1 - x0)
        return y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)

    pts = []
    x = x0
    while x <= x1:
        pts.append((x, deck(x) + 6.2, 3))
        x += 6
    pts.append((x1, deck(x1) + 6.2, 3))
    K.tube('bridge_rope', pts, 1.6, mat('rope'), 17, resolution=2)
    n = int((x1 - x0 - 8) // 10)
    step = (x1 - x0 - 8) / n
    r = K.rng(8)
    for i in range(n):
        a = x0 + 4 + i * step
        yy = round(deck(a + step / 2))
        # Rickety: planks of odd widths, a few sitting a px low or skewed.
        w = step - r.choice((1.0, 1.0, 2.0))
        drop = r.choice((0, 0, 0, 1))
        K.prism(f'bridge_plank{i}', [(a, yy + drop), (a + w, yy + drop + r.choice((0, 0, 1))),
                                     (a + w, yy + 6), (a, yy + 6)], -8, 10, mat('wood'), 15 + i % 2, bevel=0.8)
    # Stakes in the rim faces and the rope ends tied round them.
    for side, (sx, sy) in enumerate(((x0 - 9, y0 + 12), (x1 + 9, y1 + 12))):
        K.box(f'bridge_stake{side}', sx - 3.5, sy - 8, sx + 3.5, sy + 20, 4, 12, mat('wood'), 18, bevel=1)
        end = (x0, deck(x0) + 6.2) if side == 0 else (x1, deck(x1) + 6.2)
        K.tube(f'bridge_tie{side}', [(end[0], end[1], 12), (sx, sy - 2, 13)], 1.6, mat('rope'), 17, resolution=2)
        K.tube(f'bridge_wrap{side}', [(sx - 4.5, sy - 3, 13), (sx + 4.5, sy - 1, 13)], 1.6, mat('rope'), 17,
               resolution=2)


def dwelling(k):
    """Adobe houses in a recess under the right rim, the way the old cliff towns sit."""
    mat = k.mat
    f = ALC_FLOOR
    x0, x1 = ALC_FRONT + 4, ALC_BACK
    # The recess: an arch of shadowed rock in front of the beds.
    arch = [(x0, f + 2)]
    for i in range(15):
        t = i / 14
        arch.append((x0 + (x1 - x0) * t, ALC_TOP + 8 - 26 * math.sin(math.pi * t) + 12 * t))
    arch.append((x1, f + 2))
    K.prism('dw_recess', arch, -10, 2.2, mat('deep'), 9, bevel=1)
    # Its arch is a hard cream brow, lit on top.
    brow = [(x, y - 5) for x, y in arch[1:-1]]
    K.band('dw_brow', brow, arch[1:-1], -8, 3.2, mat('cream'), 11)
    # The ledge's floor: a trodden sandy strip on the hard bed.
    K.box('dw_floor', LEDGE_FRONT + 2, f - 2, x1, f + 4, -8, 8, mat('sand'), 19, bevel=1)
    # Back house, tall, against the back of the recess; front house lower; a round tower.
    K.box('dw_house_b', 1092, 612, 1134, f, -2, 8, mat('adobe'), 20, bevel=1.2)
    K.box('dw_house_b_top', 1100, 600, 1126, 613, -2, 7, mat('adobe'), 21, bevel=1)
    K.box('dw_house_a', 1046, 634, 1096, f, 2, 14, mat('adobe'), 21, bevel=1.2)
    K.box('dw_house_a_top', 1052, 622, 1080, 635, 3, 12, mat('adobe'), 20, bevel=1)
    K.lathe('dw_tower', 1036, 18, [(11, 638), (12, 645), (12.5, f)], mat('adobe'), 22, segments=16)
    # T-shaped doors and windows.
    K.prism('dw_door_a', [(1064, f), (1064, 660), (1060, 660), (1060, 652), (1080, 652), (1080, 660), (1076, 660),
                          (1076, f)], 14, 15, mat('dark'), 23)
    K.box('dw_door_b', 1106, 624, 1118, 640, 8, 9, mat('dark'), 23)
    K.box('dw_win_b', 1112, 652, 1122, 660, 8, 9, mat('dark'), 23)
    K.box('dw_win_a', 1086, 644, 1092, 650, 14, 15, mat('dark'), 23)
    K.box('dw_win_t', 1031, 652, 1039, 660, 30, 31, mat('dark'), 23)
    K.box('dw_win_t2', 1060, 626, 1066, 631, 12, 13, mat('dark'), 23)
    # Roof beams poking out of the walls, seen end on.
    for i, bx in enumerate((1050, 1060, 1070, 1080, 1090)):
        K.log(f'dw_viga{i}', bx, 637, 2.0, 12, 17, mat('wood'), 24)
    for i, bx in enumerate((1098, 1110, 1122)):
        K.log(f'dw_vigab{i}', bx, 616, 2.0, 6, 11, mat('wood'), 24)
    # A ladder up to the front roof, and pots on the ledge lip.
    for j, (lx0, lx1) in enumerate(((1022, 1040), (1029, 1047))):
        K.tube(f'dw_ladder{j}', [(lx0, f, 32), (lx1, 626, 32)], 1.4, mat('wood'), 24, resolution=1)
    for j in range(5):
        t = 0.14 + j * 0.18
        K.tube(f'dw_rung{j}', [(1022 + 18 * t, f - 54 * t, 32), (1029 + 18 * t, f - 54 * t, 32)], 1.2,
               mat('wood'), 24, resolution=1)
    for j, (px_, h) in enumerate(((1100, 10), (1110, 7), (1018, 8))):
        K.lathe(f'dw_pot{j}', px_, 20, [(2.5, f - h), (4, f - h * 0.7), (5, f - h * 0.35), (3, f)], mat('cream'),
                25, segments=10)
    # Roots hanging off the ledge into the chasm.
    for j, (hx, ln) in enumerate(((1020, 26), (1032, 18))):
        K.tube(f'dw_root{j}', [(hx, LEDGE_BOTTOM - 2, 2), (hx - 3, LEDGE_BOTTOM + ln * 0.5, 2),
                               (hx + 1, LEDGE_BOTTOM + ln, 2)], 1.6, mat('wood'), 24, taper=0.5, resolution=1)


def hoodoo(k, x):
    """A balanced rock: a soft red pillar under a hard cream cap, on the left mesa."""
    mat = k.mat
    g = K.height_at(left_profile(), x) - 4
    top = g - 70
    K.prism('hoodoo_pillar', [(x - 15, g + 6), (x - 11, g - 14), (x - 8, g - 30), (x - 10, top + 8), (x - 6, top),
                              (x + 7, top), (x + 11, top + 10), (x + 8, g - 26), (x + 12, g - 12), (x + 16, g + 6)],
             -10, 8, mat('red'), 10, bevel=2)
    for i, (yy, m) in enumerate(((g - 24, 'orange'), (g - 50, 'cream'))):
        K.band(f'hoodoo_band{i}', [(x - 13, yy), (x + 13, yy)], [(x - 13, yy + 6), (x + 13, yy + 6)], -6, 9.5,
               mat(m), 11)
    K.rock('hoodoo_cap', x + 3, top - 13, 27, mat('cream'), 12, d=0, seed=91, squash=(1.2, 0.8, 0.62), jitter=0.12)
    # Scree at its foot.
    for i, (dx, rr) in enumerate(((-22, 5), (-28, 3.5), (21, 4.5), (27, 3))):
        K.rock(f'hoodoo_scree{i}', x + dx, K.height_at(left_profile(), x + dx) - 3, rr, mat('stone'), 13, d=6,
               seed=95 + i, squash=(1.2, 0.8, 0.7))


def saguaro(name, x, g, h, arms, d=4.0):
    """A chibi saguaro: a fat round-topped trunk and elbowed arms, a flower on top."""
    mat = M.mat
    rt = 7.5
    K.tube(f'{name}_trunk', [(x, g + 6, d), (x, g - h * 0.5, d), (x, g - h + rt, d)], rt, mat('cactus'), 14)
    K.blob(f'{name}_crown', x, g - h + rt, rt, rt, mat('cactus'), 14, d=d)
    for i, (side, at, up) in enumerate(arms):
        ay = g - h * at
        ex = x + side * 17
        K.tube(f'{name}_arm{i}', [(x, ay, d - 1), (ex - side * 4, ay + 1, d - 1), (ex, ay - 6, d - 1),
                                  (ex, ay - up, d - 1)], 5, mat('cactus'), 15)
        K.blob(f'{name}_armtip{i}', ex, ay - up, 5, 5, mat('cactus'), 15, d=d - 1)
    # Ribs: thin dark lines are part lines; a few pale spines read as texture.
    for j in range(3):
        K.tube(f'{name}_rib{j}', [(x - 3 + j * 3, g - 2, d + rt - 1), (x - 3 + j * 3, g - h + rt + 2, d + rt - 1)], 0.9,
               mat('cactus'), 16, resolution=1)
    K.blob(f'{name}_flower', x + 1, g - h - 1, 3, 2.5, mat('fruit'), 17, d=d + 3, segments=10, rings=5)


def cacti(k):
    mat = k.mat
    lp, rp = left_profile(), right_profile()
    saguaro('sag_r', 1226, K.height_at(rp, 1226) - 3, 74, ((-1, 0.45, 22), (1, 0.62, 16)))
    saguaro('sag_l', 70, K.height_at(lp, 70) - 3, 58, ((1, 0.5, 18),))
    saguaro('sag_rr', 1740, K.height_at(rp, 1740) - 3, 52, ((-1, 0.55, 14),), d=2)
    # Prickly pears: flat pads, on slopes and edges nobody spawns on.
    for i, (px_, prof) in enumerate(((196, lp), (1258, rp), (1690, rp), (462, lp))):
        g = K.height_at(prof, px_) - 3
        for j, (dx, dy, rx, ry) in enumerate(((0, -7, 7, 8), (-7, -16, 5.5, 6.5), (6, -17, 5, 6))):
            K.blob(f'pear{i}_{j}', px_ + dx, g + dy, rx, ry, mat('cactus'), 14 + j % 2, d=6, rd=2.5)
        K.blob(f'pear{i}_fruit', px_ - 7, g - 23, 2.2, 2.2, mat('fruit'), 17, d=9, segments=8, rings=4)
    # Barrel cacti at the foot of the tier walls.
    for i, (bx, prof) in enumerate(((1470, rp), (212, lp), (1800, rp))):
        g = K.height_at(prof, bx) - 2
        K.blob(f'barrel{i}', bx, g - 6, 7, 8, mat('cactus'), 14, d=5)
        K.blob(f'barrel{i}_f', bx, g - 14, 2.4, 2, mat('fruit'), 17, d=8, segments=8, rings=4)


def cow_skull(name, x, y, s=1.0, d=6.0, flip=1):
    mat = M.mat
    K.blob(f'{name}_head', x, y, 7 * s, 9 * s, mat('bone'), 19, d=d, rd=5 * s)
    K.blob(f'{name}_snout', x + 1 * flip * s, y + 8 * s, 4.5 * s, 4 * s, mat('bone'), 19, d=d + 1, rd=4 * s)
    for side in (-1, 1):
        K.tube(f'{name}_horn{side}', [(x + side * 5 * s, y - 5 * s, d), (x + side * 14 * s, y - 7 * s, d),
                                      (x + side * 18 * s, y - 14 * s, d)], 2.3 * s, mat('bone'), 20, taper=0.4,
               resolution=2)
        K.blob(f'{name}_eye{side}', x + side * 3 * s, y - 1 * s, 2 * s, 2.4 * s, mat('dark'), 21, d=d + 5 * s,
               segments=8, rings=4)


def bones(k):
    """Bleached bones on the desert: a cattle skeleton on the left, skulls on the right slope."""
    mat = k.mat
    lp, rp = left_profile(), right_profile()
    # A ribcage half sunk in the sand on the far-left floor.
    bx = 118
    g = K.height_at(lp, bx) - 2
    K.tube('rib_spine', [(bx - 26, g - 12, 4), (bx, g - 16, 4), (bx + 22, g - 11, 4)], 2.2, mat('bone'), 19,
           resolution=1)
    for j in range(5):
        rx = bx - 20 + j * 9
        K.tube(f'rib{j}', [(rx, g - 14, 5), (rx + 5, g - 7, 5), (rx + 3, g + 2, 5)], 1.7, mat('bone'), 20,
               resolution=1)
    cow_skull('skull_l', bx + 34, g - 6, 0.9, flip=1)
    cow_skull('skull_r', 1706, K.height_at(rp, 1706) - 8, 1.0, flip=-1)
    # A bone on the slope, and a skull on the left tier's front edge.
    K.tube('bone_long', [(1780, K.height_at(rp, 1780) - 2, 6), (1800, K.height_at(rp, 1800) - 4, 6)], 2, mat('bone'),
           19, resolution=1)
    for sx in (1780, 1800):
        K.blob(f'bone_knob{sx}', sx, K.height_at(rp, sx) - 3 - (2 if sx == 1800 else 0), 3, 3, mat('bone'), 19, d=6)


def buried(k):
    """What the cross-section gives away: a dinosaur skull, a clay pot, a buried wheel."""
    mat = k.mat
    lp = left_profile()
    # A chibi T-rex skull in the left mesa, under the tier.
    sx, sy = 330, 700
    K.blob('dino_skull', sx, sy, 30, 17, mat('bone'), 12, d=3, rd=10)
    K.blob('dino_snout', sx + 30, sy + 4, 18, 11, mat('bone'), 12, d=3, rd=8)
    K.blob('dino_jaw', sx + 20, sy + 17, 26, 6, mat('bone'), 13, d=3, rd=6)
    K.blob('dino_eye', sx - 6, sy - 3, 6, 7, mat('dark'), 14, d=12, segments=12, rings=6)
    K.blob('dino_nose', sx + 38, sy - 2, 2.5, 2, mat('dark'), 14, d=12, segments=8, rings=4)
    for i in range(6):
        tx = sx + 10 + i * 7
        K.prism(f'dino_tooth{i}', [(tx - 2, sy + 11), (tx + 2, sy + 11), (tx, sy + 17)], 8, 11, mat('bone'), 15)
    for i in range(5):
        K.blob(f'dino_vert{i}', sx - 38 - i * 13, sy + 6 + i * 3, 5.5, 4.5, mat('bone'), 12 + i % 2, d=3)
    # A painted clay pot in the right mesa.
    px_, py = 1600, 720
    K.lathe('pot', px_, 0, [(5, py - 16), (8, py - 12), (13, py - 4), (12, py + 6), (7, py + 12)], mat('adobe'), 12,
            segments=16)
    K.lathe('pot_band', px_, 0, [(12.6, py - 3), (13.1, py + 1)], mat('cream'), 13, segments=16)
    # A wagon wheel in the right mesa's lower beds.
    wx, wy = 1330, 780
    pts = [(wx + 16 * math.cos(math.radians(a)), wy + 16 * math.sin(math.radians(a)), 3) for a in range(0, 361, 20)]
    K.tube('wheel', pts, 2.2, mat('wood'), 12, resolution=1)
    for a in range(0, 180, 45):
        c, s = math.cos(math.radians(a)), math.sin(math.radians(a))
        K.tube(f'wheel_spoke{a}', [(wx - 15 * c, wy - 15 * s, 3), (wx + 15 * c, wy + 15 * s, 3)], 1.4, mat('wood'), 13,
               resolution=1)
    K.blob('wheel_hub', wx, wy, 3.5, 3.5, mat('wood'), 14, d=5)
    # A petrified log in the left mesa's beds, seen end on and along.
    K.tube('petrified', [(560, 648, 3), (640, 652, 3), (700, 646, 3)], 7, mat('stone'), 12, resolution=2)
    K.log('petrified_end', 700, 646, 7, 3, 12, mat('cream'), 13)
    for i, (gx, gy) in enumerate(((1480, 760), (220, 700))):
        K.blob(f'geode{i}', gx, gy, 12, 10, mat('cream'), 12, d=2)
        K.blob(f'geode{i}_in', gx + 1, gy + 1, 8, 6.5, mat('deep'), 13, d=7)
        for j in range(5):
            a = j / 5 * math.tau
            K.rock(f'geode{i}_xt{j}', gx + 1 + math.cos(a) * 4, gy + 1 + math.sin(a) * 3, 2.4, mat('bone'), 14, d=9,
                   seed=60 + j, squash=(0.8, 0.6, 1.2))
    # An old mine drift in the right mesa: a dark gallery shored with timber sets and a
    # cart left on its rails (painted on solid rock: the mask does not change).
    tx0, tx1, ty0, ty1 = 1500, 1650, 640, 664
    K.prism('mine_drift', [(tx0, ty1), (tx0, ty0 + 3), (tx0 + 3, ty0), (tx1 - 3, ty0), (tx1, ty0 + 3), (tx1, ty1)], -6,
            2.4, mat('dark'), 20)
    for i, sx in enumerate(range(tx0 + 4, tx1, 34)):
        K.box(f'mine_post{i}a', sx, ty0, sx + 4, ty1, 2.4, 7, mat('wood'), 21, bevel=0.6)
        K.box(f'mine_cap{i}', sx - 2, ty0 - 2, sx + 16, ty0 + 3, 2.4, 8, mat('wood'), 22, bevel=0.6)
        K.box(f'mine_post{i}b', sx + 12, ty0, sx + 16, ty1, 2.4, 7, mat('wood'), 21, bevel=0.6)
    K.box('mine_rail', tx0, ty1 - 3, tx1, ty1 - 1, 2.4, 5, mat('stone'), 23)
    cx = 1574
    K.prism('mine_cart', [(cx - 12, ty1 - 16), (cx + 12, ty1 - 16), (cx + 9, ty1 - 5), (cx - 9, ty1 - 5)], 2.4, 9,
            mat('stone'), 24, bevel=0.8)
    for wx in (cx - 6, cx + 6):
        K.log(f'mine_wheel{wx}', wx, ty1 - 4, 2.6, 5, 10, mat('dark'), 25)
    K.rock('mine_ore', cx, ty1 - 17, 6, mat('sand'), 25, d=6, seed=77, squash=(1.3, 0.8, 0.6))
    del lp


# ---------------------------------------------------------------------------------
# Plates, far to near.
# ---------------------------------------------------------------------------------

def butte(name, x, base, w, h, mat, group, band_mat=None, band_group=None, d=0.0, talus=0.5, bands=3, seed=0,
          cap=None):
    """
    A flat-topped butte for the backdrops: talus slopes, a cliff, a caprock lip, and a
    few beds across its face a px proud so the light draws them.
    """
    r = K.rng(seed)
    tw = w * talus
    cliff = base - h * 0.4
    hw = w / 2
    left = [(x - hw - tw, base + 4), (x - hw - tw * 0.4, cliff + h * 0.2), (x - hw, cliff),
            (x - hw + 3, base - h + 6), (x - hw + 1, base - h)]
    right = [(x + hw - 1, base - h), (x + hw - 3, base - h + 6), (x + hw, cliff),
             (x + hw + tw * 0.4, cliff + h * 0.2), (x + hw + tw, base + 4)]
    K.prism(name, left + right, d - 20, d, mat, group, bevel=2)
    if cap:
        K.box(f'{name}_cap', x - hw - 2, base - h - 2, x + hw + 2, base - h + 5, d - 18, d + 1.5, cap, group + 1,
              bevel=1.5)
    if band_mat:
        for i in range(bands):
            y = base - h + 12 + (h * 0.6 - 12) * (i + 0.5) / bands + r.uniform(-3, 3)
            th = r.uniform(3, 6)
            K.box(f'{name}_band{i}', x - hw + 1.5, y, x + hw - 1.5, y + th, d - 18, d + 1, band_mat,
                  band_group or group + 1)


M.ramp('far_rock', ['#b0708a', '#bb7c94', '#c6899d', '#d096a6'])
M.ramp('far_band', ['#bd8098', '#c68ca0', '#d098aa', '#d9a4b2'])


@M.plate('far', parallax=0.12, outline='#9a5f7c')
def far(P):
    """The distant buttes: pale, pink with the sunset, low contrast, big."""
    mat = P.spec.mat
    r = K.rng(11)
    base = P.ay(760)
    x = 20
    i = 0
    while x < P.width + 120:
        w = r.uniform(60, 150)
        h = r.uniform(50, 100)
        butte(f'butte{i}', x, base, w, h, mat('far_rock'), 1 + (i % 2) * 2, mat('far_band'), 2, d=-i * 3, seed=30 + i,
              bands=2)
        x += w + r.uniform(60, 180)
        i += 1
    K.box('floor', -10, base, P.width + 10, P.height + 10, -80, -60, mat('far_rock'), 5)


M.ramp('mid_rock', ['#7c3e56', '#8c4a60', '#9e566a', '#b06474'])
M.ramp('mid_band', ['#94506a', '#a45c72', '#b46a7c', '#c47a86'])


@M.plate('mid', parallax=0.28, outline='#5a2a42')
def mid(P):
    """Nearer mesas and a stone arch, redder and darker, with their beds showing."""
    mat = P.spec.mat
    r = K.rng(21)
    base = P.ay(760)
    x = -30
    i = 0
    while x < P.width + 100:
        w = r.uniform(120, 260)
        h = r.uniform(60, 120)
        butte(f'mesa{i}', x + w / 2, base, w, h, mat('mid_rock'), 1 + (i % 2) * 3, mat('mid_band'), 2, d=-i * 2,
              seed=60 + i, bands=3, talus=0.3, cap=mat('mid_band'))
        x += w + r.uniform(90, 220)
        i += 1
    # An arch, standing free on the plain.
    ax = P.ax(1180)
    K.prism('arch', [(ax - 60, base + 4), (ax - 52, base - 70), (ax - 30, base - 96), (ax + 30, base - 98),
                     (ax + 54, base - 76), (ax + 62, base + 4), (ax + 40, base + 4), (ax + 36, base - 50),
                     (ax + 20, base - 66), (ax - 18, base - 66), (ax - 36, base - 48), (ax - 40, base + 4)],
             -20, 0, mat('mid_rock'), 6, bevel=2)
    K.box('arch_band', ax - 58, base - 88, ax + 58, base - 82, -18, 1, mat('mid_band'), 7)
    K.box('plain', -10, base, P.width + 10, P.height + 10, -80, -60, mat('mid_rock'), 8)


M.ramp('near_rock', ['#3e1a2c', '#4c2234', '#5c2c3e', '#6e3848'])


@M.plate('near', parallax=0.52, outline='#26101c')
def near(P):
    """The canyon's far side just behind the playfield: spires and hoodoos in shadow."""
    mat = P.spec.mat
    r = K.rng(31)
    base = P.ay(640)
    pts = [(x, base + 18 * math.sin(x / 110) + 8 * math.sin(x / 41)) for x in range(-40, P.width + 60, 24)]
    line = K.smooth(pts, 4)
    K.ground('rim', line, mat('near_rock'), 1, depth=30, bottom=P.height + 10, bevel=4)
    for i in range(3):
        K.band(f'bed{i}', K.offset(line, 30 + i * 40), K.offset(line, 36 + i * 40), -10, 3, mat('near_rock'), 2 + i % 2)
    x = -10
    i = 0
    while x < P.width + 30:
        gy = K.height_at(line, x) + 6
        kind = r.random()
        if kind < 0.45:
            h = r.uniform(40, 90)
            w = r.uniform(12, 20)
            K.prism(f'spire{i}', [(x - w, gy), (x - w * 0.6, gy - h * 0.6), (x - w * 0.4, gy - h), (x + w * 0.3, gy - h),
                                  (x + w * 0.5, gy - h * 0.55), (x + w, gy)], -8, 6, mat('near_rock'), 3 + i % 2,
                     bevel=1.5)
            K.rock(f'spire_cap{i}', x - w * 0.05, gy - h - 4, w * 0.7, mat('near_rock'), 5, d=4, seed=500 + i,
                   squash=(1.2, 0.7, 0.6))
        else:
            butte(f'block{i}', x, gy, r.uniform(40, 90), r.uniform(20, 44), mat('near_rock'), 3 + i % 2,
                  d=2, seed=520 + i, talus=0.3, bands=0)
        x += r.uniform(40, 110)
        i += 1


M.ramp('gorge_rock', ['#381a2c', '#44223a', '#522a42', '#60344c'])
M.ramp('gorge_lit', ['#6a3448', '#7c3e50', '#8e4a58', '#a05862'])
M.ramp('gorge_deep', ['#221426', '#2a1a2e', '#322036', '#3c283e'])
M.ramp('river', ['#343e6c', '#465688', '#5c72a2', '#86a0c8'])


@M.plate('gorge', parallax=0.75, outline='#1c0c18')
def gorge(P):
    """
    The inside of the chasm, seen only through it: its far walls stepping down in
    ledges into the dark, and a thread of river at the bottom. Nothing here reaches
    above the rims, so the plate never shows over the mesas.
    """
    mat = P.spec.mat
    cx, _ = P.at(926, 0)
    top = P.ay(548)
    floor = P.ay(1030)
    r = K.rng(41)
    # Left and right inner walls, each a stack of ledges stepping in toward the river.
    for side in (-1, 1):
        pts = [(cx + side * 260, top)]
        x = cx + side * 110
        y = top
        i = 0
        ledges = []
        while y < floor:
            pts.append((x, y))
            y += r.uniform(40, 70)
            pts.append((x - side * r.uniform(2, 6), y))
            nx = x - side * r.uniform(8, 16)
            ledges.append((x, nx, y))
            x = nx
            i += 1
        pts.append((cx + side * 10, floor))
        pts.append((cx + side * 10, P.height + 10))
        pts.append((cx + side * 260, P.height + 10))
        K.prism(f'wall{side}', pts, -20, 0, mat('gorge_rock'), 1 if side < 0 else 2, bevel=2)
        # The last of the sunset catching each ledge's lip, fading with depth.
        for j, (lx0, lx1, ly) in enumerate(ledges):
            if ly > floor - 120:
                break
            K.box(f'lip{side}_{j}', min(lx0, lx1) - 2, ly - 1, max(lx0, lx1) + 2, ly + 3, 0.5, 3, mat('gorge_lit'),
                  8 + j % 2)
        for j in range(5):
            y = top + 40 + j * (floor - top - 60) / 5
            K.box(f'bed{side}_{j}', min(cx + side * 250, cx + side * 60), y, max(cx + side * 250, cx + side * 60),
                  y + 4, -18, 1.2, mat('gorge_rock'), 3 + (j + (side > 0)) % 2)
    # Deeper is darker: a shadowed skirt over the bottom third.
    K.box('shade', cx - 262, floor - 150, cx + 262, P.height + 10, 2, 4, mat('gorge_deep'), 5)
    K.box('river', cx - 16, floor - 4, cx + 16, floor + 5, 5, 8, mat('river'), 6, bevel=1.5)
    K.box('floor', cx - 262, floor + 5, cx + 262, P.height + 10, 4, 6, mat('gorge_deep'), 7)
