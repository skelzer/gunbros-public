"""
Frozen Peaks (`glacier`): an arctic glacier under an aurora (DESIGN §8.1). Copied from
`hills.py`, the reference.

Left to right: a low ledge with an igloo, a snowman and penguins under a thin natural
ice arch, a shelf, an ice wall up to the high left shelf, whose end runs on as an
overhang over the valley (an explorer's tent sheltering under it); the valley floor
with the central ice spire standing out of it and an ice-fishing hole at its far end;
the high right shelf, which also ends in an overhang, over a lower shelf; then a snowy
slope with pines and a snowed-in cabin up to the right edge. Under the
snow: a glacier in cross-section, layers of blue ice and white firn, rocks and a
mammoth frozen into it, over dark bedrock.

The tactical idea: the two high shelves (where a duel starts) each end in an overhang,
and a seat that walks out onto one for a better angle can have it shot away from under
it, into the valley. The spire stands 300 px out of the valley and blocks every flat
shot across the middle, so the valley seats of a 2v2 duel over it in high lobs. (A
bridge from the spire to the right shelf was tried and dropped: it sealed the valley
under it into a pocket and roofed the seat below.)

Spawn slots (constants.spawn.marginFraction 0.1 on 1800 px): 2 seats search from x =
540 and 1260 (jitter +-43), 4 seats from 360, 720, 1080 and 1440 (jitter +-22), 8
seats every 180 px from 270. Shelves: the left shelf (325-395), the high left shelf
(470-600), the valley floor either side of the spire (640-780 and 975-1135), the high
right shelf (1190-1320) and the lower right shelf (1395-1490). The overhangs are over
air, so nobody spawns on one: a spawn stands on the top of the lowest solid run in its
column, which there is the floor under it.

Sequence of passes and what each changed: tools/blender/iterations/maps/glacier/.
"""
import math

import map_kit as K

M = K.define(
    'glacier',
    size=(1800, 1100),
    sky=['#0a1430', '#15305c', '#1e5474', '#2f8088'],
    outline='#0e1424',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
M.ramp('snow', ['#8aa2c6', '#c2d3ea', '#e6effa', '#ffffff'])
M.ramp('ice', ['#3a78aa', '#5a9fcc', '#8ccbea', '#c6eefc'])
M.ramp('deepice', ['#1f4878', '#2e6496', '#4686b6', '#6aa8d0'], mottle=('ice', 18, 0.2))
M.ramp('rock', ['#3c4252', '#586072', '#7c8598', '#a6aebe'])
M.ramp('bedrock', ['#232734', '#353b4b', '#4b5365', '#677084'], mottle=('rock', 16, 0.25))
M.ramp('bark', ['#3a2618', '#5c3c24', '#7e5634', '#a07448'])
M.ramp('pine', ['#113834', '#1b5246', '#2a6e56', '#46906e'])
M.ramp('wood', ['#5a3420', '#80502e', '#a8703e', '#c89058'])
M.ramp('red', ['#7a1e24', '#b4302e', '#e0503c', '#ff8a6a'])
M.flat('lamp', '#ffd070')

# The base ground line, left to right: the *lower* surfaces. The overhangs are slabs on
# top of it (OVERHANGS), and the spire stands on it.
PROFILE_POINTS = [
    (-20, 700), (40, 697), (110, 693), (180, 690), (236, 688),     # igloo ledge
    (264, 678), (284, 660), (300, 645),                            # step up
    (325, 641), (360, 640), (395, 640),                            # left shelf (4-seat 360)
    (412, 636), (424, 620), (434, 596), (444, 574), (458, 563),    # ice wall
    (476, 560), (540, 560), (590, 560),                            # high left shelf (2-seat 540)
    (598, 562), (602, 600), (604, 650), (608, 690), (618, 706),    # cliff under the overhang
    (640, 710), (720, 711), (790, 709),                            # valley left (4-seat 720)
    (880, 706), (975, 702),                                        # under the spire
    (1045, 700), (1080, 700), (1120, 699),                         # valley right (4-seat 1080)
    (1138, 696), (1152, 684), (1162, 656), (1168, 620), (1174, 592),
    (1184, 578), (1200, 575), (1260, 575), (1298, 575),            # high right shelf (2-seat 1260)
    (1305, 579), (1308, 600), (1310, 628), (1315, 646), (1330, 652),  # cliff under the overhang
    (1400, 651), (1440, 650), (1486, 650),                         # lower right shelf (4-seat 1440)
    (1510, 645), (1536, 632), (1566, 614), (1604, 603),            # slope up
    (1640, 600), (1680, 598), (1704, 590),                         # cabin
    (1722, 570), (1740, 540), (1758, 512), (1780, 498), (1830, 492),
]

# Overhangs: (top line, underside back into the cliff). The top continues its shelf.
OVERHANGS = {
    'left': dict(top=[(586, 560), (620, 560), (650, 561), (672, 563), (682, 567)],
                 tip=[(688, 574), (689, 584), (684, 594)],
                 under=[(670, 601), (650, 604), (628, 607), (610, 606), (600, 602), (596, 590)]),
    'right': dict(top=[(1294, 575), (1318, 575), (1336, 576), (1346, 579)],
                  tip=[(1352, 585), (1353, 595), (1347, 602)],
                  under=[(1334, 606), (1320, 607), (1310, 600), (1302, 586)]),
}

SPIRE = dict(x=886, base=706, height=214, half=78)


def profile():
    return K.smooth(PROFILE_POINTS, step=3.0)


def overhang_poly(o):
    return o['top'] + o['tip'] + o['under']


def surface_segments():
    """
    The lines the snow lies on, which are the lines mobiles walk on: the base profile
    where nothing is over it, each shelf running on along its overhang's top.
    """
    ground = profile()
    left, right = OVERHANGS['left'], OVERHANGS['right']
    seg1 = [p for p in ground if p[0] < 586] + K.smooth(left['top'], 3.0)[1:] + left['tip'][:2]
    seg2 = [p for p in ground if 616 <= p[0] <= 1146]
    seg3 = [p for p in ground if 1146 < p[0] < 1294] + K.smooth(right['top'], 3.0)[1:] + right['tip'][:2]
    seg4 = [p for p in ground if p[0] >= 1318]
    return [seg1, seg2, seg3, seg4]


def snow_edge(k, name, line, groups, radius=8.0, hem=14.0, seed=0):
    """
    A snow cap along a surface line, walkable by construction like the grass edge: a
    rounded lip whose top is the walking surface, a skirt hanging `hem` px over the ice
    with a lumpy hem, and icicles hanging off the hem on the front (never on top).
    """
    mat = k.mat
    g_lip, g_icicle = groups
    r = K.rng(seed)
    K.tube(f'{name}_lip', [(x, y, 1.0) for x, y in line], radius, mat('snow'), g_lip, resolution=3)
    hem_line = [(x, y + hem + 5 * abs(math.sin(x * math.pi / 19)) + 3 * math.sin(x / 7.0)) for x, y in line]
    K.band(f'{name}_skirt', K.offset(line, 1), hem_line, -8, 2.5, mat('snow'), g_lip)
    x = line[0][0] + 6
    while x < line[-1][0] - 6:
        if abs(K.slope_at(line, x, 5)) < 0.9:
            y = K.height_at(hem_line, x)
            L = r.uniform(5, 15)
            w = r.uniform(3, 5)
            K.prism(f'{name}_icicle{int(x)}', [(x - w / 2, y - 4), (x + w / 2, y - 4), (x + 0.6, y + L), (x - 0.6, y + L)],
                    2.0, 5.0, mat('ice'), g_icicle)
        x += r.uniform(7, 18)


@M.terrain
def terrain(k):
    mat = k.mat
    ground = profile()
    r = K.rng(1)

    # The glacier: ice from the surface down, layered with deep blue ice and white firn
    # that follow the surface loosely (a glacier flows over its bed), over bedrock.
    K.ground('slab', ground, mat('ice'), 1, depth=90)
    layers = ((22, 16, 'deepice', 0.8), (52, 7, 'snow', 0.7), (70, 22, 'deepice', 0.6), (104, 6, 'snow', 0.5),
              (122, 28, 'deepice', 0.45), (164, 8, 'snow', 0.35), (186, 34, 'deepice', 0.3),
              (238, 9, 'snow', 0.2), (262, 30, 'deepice', 0.15), (310, 7, 'snow', 0.1))
    for i, (lvl, th, m, follow) in enumerate(layers):
        K.stratum(f'layer{i}', ground, lvl, th, mat(m), 2 + i % 3, follow=follow, datum=640, dip=0.02 * (-1) ** i,
                  seed=10 + i, pinch=0.25, min_cover=lvl * 0.6 + 6)
    w_deep = K.wobble(7, 22, 260)
    deep = [(x, max(y + 230, 0.3 * (y + 300) + 0.7 * (640 + 300 + 0.04 * (x - 900)) + w_deep(x))) for x, y in ground]
    K.ground('bedrock', deep, mat('bedrock'), 5, depth=40, d_front=2.5)
    for i in range(40):
        x = r.uniform(0, k.width)
        y = K.height_at(deep, x) + r.uniform(20, 260)
        if y > k.height + 10:
            continue
        K.rock(f'bedboulder{i}', x, y, r.uniform(9, 20), mat('rock'), 6, d=3.5, seed=400 + i, squash=(1.3, 0.45, 0.9))
    # Rocks frozen into the ice, and air bubbles.
    for i in range(70):
        x = r.uniform(0, k.width)
        top = K.height_at(ground, x)
        y = r.uniform(top + 30, K.height_at(deep, x) - 12)
        if y < top + 24:
            continue
        K.rock(f'frozen{i}', x, y, r.uniform(4, 10), mat('rock'), 6, d=2.5, seed=100 + i, squash=(1.2, 0.5, 0.85))
    for i in range(90):
        x = r.uniform(0, k.width)
        top = K.height_at(ground, x)
        y = r.uniform(top + 28, K.height_at(deep, x) - 8)
        if y < top + 24:
            continue
        rr_ = r.uniform(1.6, 3.2)
        K.blob(f'bubble{i}', x, y, rr_, rr_, mat('ice'), 7, d=3, segments=10, rings=5)

    overhangs(k)
    spire(k)
    ice_arch(k)
    for i, seg in enumerate(surface_segments()):
        snow_edge(k, f'snow{i}', seg, (8, 9), seed=20 + i)
    # Snow drifts piled against the foot of each wall, where nobody stands.
    for i, (dx, dy, rx, ry) in enumerate(((436, 606, 14, 10), (1160, 676, 12, 12), (1720, 578, 14, 12))):
        K.blob(f'drift{i}', dx, dy, rx, ry, mat('snow'), 8, d=4)
    igloo(k, 150)
    snowman(k, 64)
    penguins(k)
    fishing_hole(k, 1134)
    tent(k, 636)
    signpost(k, 1508)
    icefall(k)
    cabin(k, 1650)
    pines(k)
    frozen_things(k)


def overhangs(k):
    """Ice slabs running on from the two high shelves over the air, icicles under them."""
    mat = k.mat
    r = K.rng(5)
    for name, o in OVERHANGS.items():
        poly = overhang_poly(o)
        K.prism(f'over_{name}', poly, -80, 0, mat('ice'), 1, bevel=1.5)
        # One band of deep ice through it, so the slab reads as the same glacier.
        top = K.smooth(o['top'], 3.0)
        x0, x1 = top[0][0], o['tip'][0][0] - 6
        K.band(f'over_{name}_band', [(x, K.height_at(top, x) + 18) for x in range(int(x0), int(x1), 4)],
               [(x, K.height_at(top, x) + 28 + 3 * math.sin(x / 9)) for x in range(int(x0), int(x1), 4)],
               -30, 1.5, mat('deepice'), 3)
        # Icicles under the slab: blunt at the tip so no column gets a loose sliver.
        under = o['under']
        xs = sorted(p[0] for p in under)
        x = xs[0] + 8
        while x < o['tip'][-1][0] - 2:
            y = K.height_at(sorted(under), x)
            L = r.uniform(10, 30)
            w = r.uniform(5, 9)
            K.prism(f'over_{name}_icicle{int(x)}', [(x - w / 2, y - 6), (x + w / 2, y - 6), (x + 1.5, y + L),
                                                     (x - 1.5, y + L)], -20, 3, mat('ice'), 4, bevel=0.8)
            x += r.uniform(8, 15)


def spire(k):
    """
    The central spire: a faceted ice crystal 330 px tall with shards round its foot, a
    snow cap and a climber's flag on the tip. Pointed, so no seat can start on it.
    """
    mat = k.mat
    sx, base, h, half = SPIRE['x'], SPIRE['base'], SPIRE['height'], SPIRE['half']
    # Set back in depth so the part of the cone under the valley floor stays behind the
    # glacier's face: the spire rises out of the ice rather than being cut into it.
    K.mountain('spire', sx, base, h, half, mat('ice'), 10, snow=(mat('snow'), 11), snow_line=0.12, d=-78, seed=7,
               facets=7, jitter=0.06)
    # Crystals branching off its flanks.
    for i, (bx, by, L, ang, w) in enumerate(((850, 640, 56, 130, 20), (924, 652, 50, 48, 18), (868, 586, 36, 116, 12))):
        a = math.radians(ang)
        c, s_ = math.cos(a), -math.sin(a)
        nx, ny = -s_, c
        poly = [(bx + nx * w / 2, by + ny * w / 2), (bx + c * L * 0.8 + nx * w / 2, by + s_ * L * 0.8 + ny * w / 2),
                (bx + c * L, by + s_ * L), (bx + c * L * 0.8 - nx * w / 2, by + s_ * L * 0.8 - ny * w / 2),
                (bx - nx * w / 2, by - ny * w / 2)]
        K.prism(f'branch{i}', poly, -20, 10, mat('ice'), 13 + i % 2, bevel=2.0)
        K.prism(f'branch{i}_facet', [(bx, by), (bx + c * L * 0.8 + nx * w * 0.35, by + s_ * L * 0.8 + ny * w * 0.35),
                                     (bx + c * L * 0.95, by + s_ * L * 0.95)], 10, 12, mat('ice'), 15)
    # Shards leaning out of its foot.
    for i, (dx, hh, hw, lean) in enumerate(((-66, 84, 24, -12), (-44, 120, 26, -6), (54, 104, 26, 10),
                                            (76, 70, 20, 14))):
        x = sx + dx
        poly = [(x - hw, base + 4), (x + hw, base + 4), (x + lean + 5, base - hh + 10), (x + lean, base - hh),
                (x + lean - 5, base - hh + 12)]
        K.prism(f'shard{i}', poly, -30, 14 + i * 2, mat('ice'), 12 + i % 2, bevel=2.0)
        # A lighter facet down one face of each shard.
        K.prism(f'shard{i}_facet', [(x - hw * 0.2, base - 4), (x + hw * 0.3, base - 4), (x + lean + 1, base - hh + 16)],
                14 + i * 2, 16 + i * 2, mat('ice'), 14)
    # Dark ice veins in the spire.
    for i, (y0, y1, dx) in enumerate(((base - 30, base - 110, -8), (base - 70, base - 160, 10))):
        K.tube(f'vein{i}', [(sx + dx, y0, 30), (sx + dx * 0.5 + 6, (y0 + y1) / 2, 30), (sx + dx * 0.2, y1, 30)], 2.4,
               mat('deepice'), 15, taper=0.4, resolution=1)
    # The flag.
    tip = base - h
    K.box('flag_pole', sx - 1.5, tip - 24, sx + 1.5, tip + 16, 20, 24, mat('wood'), 16)
    K.prism('flag', [(sx + 1.5, tip - 23), (sx + 22, tip - 19), (sx + 18, tip - 14), (sx + 23, tip - 9),
                     (sx + 1.5, tip - 10)], 21, 23, mat('red'), 17)


def ice_arch(k):
    """
    A thin natural arch of ice standing on the igloo ledge, the igloo sheltering under
    it. Open at both ends, so the ground under it is never a sealed pocket, and 150 px
    over the ledge, so it is cover from a lob rather than a lid on anyone.
    """
    mat = k.mat
    ground = profile()
    x0, x1 = 14, 252
    apex = 520
    n = 44
    outer, inner = [], []
    for i in range(n + 1):
        t = i / n
        x = x0 + (x1 - x0) * t
        gy = K.height_at(ground, x) + 6
        # A catenary-ish arch: thick legs, thin crown, the crown a little right of centre.
        u = math.sin(math.pi * t ** 0.9)
        top = gy - (gy - apex) * u ** 0.55
        th = 17 + 26 * (1 - u) ** 2
        outer.append((x, top))
        inner.append((x, min(gy, top + th)))
    # Built from one quad per step, not one polygon: a U this deep is too concave for a
    # single face to fill reliably. Same group, so no part lines between the quads.
    for i in range(n):
        quad = [outer[i], outer[i + 1], inner[i + 1], inner[i]]
        if quad[3][1] - quad[0][1] < 1 and quad[2][1] - quad[1][1] < 1:
            continue
        K.prism(f'arch{i}', quad, -24, 8, mat('ice'), 12)
    # Feet: drifts of snow and ice heaped round where the arch meets the ledge.
    for i, fx in enumerate((x0 + 10, x1 - 10)):
        gy = K.height_at(ground, fx) + 2
        K.blob(f'arch_foot{i}', fx, gy - 6, 22, 12, mat('ice'), 12, d=-4, rd=14)
        K.blob(f'arch_footsnow{i}', fx + 4, gy - 4, 18, 8, mat('snow'), 8, d=4)
    K.band('arch_vein', [(x, y + 5) for x, y in outer[4:-4]], [(x, y + 9) for x, y in outer[4:-4]], 8, 9,
           mat('deepice'), 13)
    K.tube('arch_snow', [(x, y - 2, 4) for x, y in outer[3:-3]], 4.5, mat('snow'), 8, resolution=2)
    r = K.rng(9)
    for i, (x, y) in enumerate(inner[8:-8:2]):
        if r.random() < 0.7:
            L = r.uniform(6, 14)
            K.prism(f'arch_icicle{i}', [(x - 3, y - 4), (x + 3, y - 4), (x + 1.4, y + L), (x - 1.4, y + L)], -6, 4,
                    mat('ice'), 13)


def igloo(k, x):
    """A snow-block igloo with an entrance tunnel, a warm glow inside: all of it breaks."""
    mat = k.mat
    g = K.height_at(profile(), x) - 6
    R = 40
    rows = 6
    for i in range(rows):
        a0 = math.pi / 2 * i / rows
        a1 = math.pi / 2 * (i + 1) / rows
        prof = [(R * math.cos(a1), g - R * math.sin(a1)), (R * math.cos(a0), g - R * math.sin(a0))]
        if i == rows - 1:
            prof = [(0.0, g - R - 1)] + prof[1:]
        K.lathe(f'igloo_row{i}', x, -10, prof, mat('snow'), 10 + i % 2, segments=16, smooth_shade=True)
    K.box('igloo_tunnel', x + 20, g - 26, x + 54, g + 2, 10, 30, mat('snow'), 12, bevel=6)
    K.box('igloo_door', x + 42, g - 18, x + 56, g + 1, 30, 32, mat('bark'), 13, bevel=2)
    K.box('igloo_glow', x + 45, g - 14, x + 53, g - 2, 32, 33, mat('lamp'), 14)
    # Block seams on the tunnel.
    for i, bx in enumerate((x + 30, x + 42)):
        K.box(f'igloo_seam{i}', bx, g - 25, bx + 1.5, g, 30, 31, mat('snow'), 13)


def snowman(k, x):
    """A snowman with a scarf and a carrot nose, on the igloo ledge. Target practice."""
    mat = k.mat
    g = K.height_at(profile(), x) - 6
    K.blob('sm_base', x, g - 12, 15, 13, mat('snow'), 15, d=6)
    K.blob('sm_body', x, g - 32, 11, 10, mat('snow'), 16, d=8)
    K.blob('sm_head', x, g - 48, 8.5, 8, mat('snow'), 15, d=10)
    K.prism('sm_scarf', [(x - 10, g - 42), (x + 10, g - 42), (x + 10, g - 38), (x + 4, g - 38), (x + 6, g - 26),
                         (x + 1, g - 26), (x - 1, g - 38), (x - 10, g - 38)], 16, 22, mat('red'), 17)
    K.prism('sm_nose', [(x + 5, g - 50), (x + 16, g - 47), (x + 5, g - 45)], 16, 20, mat('wood'), 18)
    for i, ex in enumerate((x - 3, x + 3)):
        K.box(f'sm_eye{i}', ex - 1, g - 53, ex + 1, g - 51, 18, 19, mat('bedrock'), 18)
    K.box('sm_hat', x - 6, g - 66, x + 6, g - 55, 4, 16, mat('bedrock'), 18, bevel=1)
    K.box('sm_brim', x - 9, g - 57, x + 9, g - 54, 2, 18, mat('bedrock'), 18, bevel=0.8)
    for i, side in enumerate((-1, 1)):
        K.tube(f'sm_arm{i}', [(x + side * 9, g - 34, 12), (x + side * 22, g - 42, 12), (x + side * 26, g - 50, 12)],
               1.6, mat('bark'), 19, resolution=1)


def penguins(k):
    """Three chibi penguins by the snowman: black backs, white fronts, orange beaks."""
    mat = k.mat
    ground = profile()
    for i, (x, h) in enumerate(((104, 20), (118, 16), (254, 18))):
        g = K.height_at(ground, x) - 6
        K.blob(f'peng{i}_body', x, g - h * 0.5, h * 0.42, h * 0.55, mat('bedrock'), 23, d=10)
        K.blob(f'peng{i}_belly', x + h * 0.08, g - h * 0.45, h * 0.28, h * 0.4, mat('snow'), 24, d=16)
        K.blob(f'peng{i}_eye', x + h * 0.12, g - h * 0.86, 1.6, 1.6, mat('snow'), 24, d=17, segments=8, rings=4)
        K.prism(f'peng{i}_beak', [(x + h * 0.3, g - h * 0.82), (x + h * 0.62, g - h * 0.76),
                                  (x + h * 0.3, g - h * 0.7)], 12, 16, mat('red'), 25)
        K.box(f'peng{i}_feet', x - 4, g - 2, x + 5, g + 1, 8, 16, mat('red'), 25)


def fishing_hole(k, x):
    """An ice-fishing hole at the foot of the right cliff: a rod, a line, a bucket."""
    mat = k.mat
    g = K.height_at(profile(), x) - 7
    K.blob('hole', x - 4, g + 2, 10, 3, mat('water'), 26, d=6, rd=4)
    K.tube('rod', [(x + 4, g + 1, 12), (x + 10, g - 18, 12), (x + 18, g - 30, 12)], 1.5, mat('wood'), 16, resolution=1)
    K.tube('rod_line', [(x + 18, g - 30, 13), (x + 6, g - 12, 13), (x - 2, g, 13)], 1.0, mat('snow'), 17,
           resolution=1)
    K.lathe('bucket', x - 12, 8, [(5, g - 11), (6, g - 6), (5, g)], mat('red'), 18, segments=10)
    K.blob('bucket_fish', x - 12, g - 12, 4, 2, mat('ice'), 19, d=14, segments=8, rings=4)


def tent(k, x):
    """An explorer's tent pitched under the left overhang, out of the wind."""
    mat = k.mat
    g = K.height_at(profile(), x) - 6
    K.prism('tent', [(x - 22, g + 2), (x + 22, g + 2), (x + 3, g - 30), (x - 1, g - 30)], -10, 14, mat('red'), 15, bevel=1.2)
    K.prism('tent_door', [(x - 6, g + 2), (x + 8, g + 2), (x + 1.5, g - 18)], 14, 16, mat('bedrock'), 16)
    K.box('tent_pole', x - 0.8, g - 36, x + 2.2, g - 28, 0, 6, mat('wood'), 16)
    K.blob('tent_snow', x + 1, g - 26, 8, 3, mat('snow'), 17, d=10)
    # Crates and a lantern beside it.
    K.box('crate', x + 24, g - 14, x + 38, g + 2, -2, 14, mat('wood'), 18, bevel=1.2)
    K.box('crate_lid', x + 23, g - 16, x + 39, g - 12, -3, 15, mat('snow'), 19)
    K.box('lantern', x - 32, g - 12, x - 26, g - 2, 6, 12, mat('lamp'), 20)
    K.box('lantern_top', x - 33, g - 15, x - 25, g - 12, 6, 12, mat('rock'), 19)


def signpost(k, x):
    """A snowed-over signpost pointing up the slope to the cabin."""
    mat = k.mat
    g = K.height_at(profile(), x) - 6
    K.box('sign_post', x - 2.5, g - 42, x + 2.5, g + 6, 8, 13, mat('wood'), 16, bevel=0.8)
    K.prism('sign_board', [(x - 16, g - 40), (x + 14, g - 40), (x + 22, g - 33), (x + 14, g - 26), (x - 16, g - 26)],
            13, 17, mat('wood'), 18)
    K.blob('sign_snow', x + 2, g - 41, 18, 3.2, mat('snow'), 17, d=15)
    K.blob('sign_cap', x, g - 43, 4.5, 3, mat('snow'), 17, d=11)


def icefall(k):
    """A frozen waterfall hanging down the high right shelf's cliff into the valley."""
    mat = k.mat
    ground = profile()
    r = K.rng(71)
    for i in range(6):
        x = 1154 + i * 5 + r.uniform(-1, 1)
        top = K.height_at(ground, x) - 2
        bottom = 690 + r.uniform(-4, 6)
        if bottom - top < 10:
            continue
        w = r.uniform(4, 6)
        K.prism(f'icefall{i}', [(x - w / 2, top), (x + w / 2, top), (x + w / 2 - 0.5, bottom), (x, bottom + 4),
                                (x - w / 2 + 0.5, bottom)], 6 + i % 2, 10 + i % 2, mat('ice'), 13 + i % 2)


def cabin(k, x):
    """A log cabin up to its sills in snow, a snow-laden roof, a lit window, smoke-free."""
    mat = k.mat
    g = K.height_at(profile(), x) - 4
    w, h = 96, 52
    x0, x1 = x - w / 2, x + w / 2
    # Stone footing down into the slope.
    base = [(xx, K.height_at(profile(), xx) + 18) for xx in range(int(x0 - 10), int(x1 + 12), 4)]
    K.prism('cabin_footing', [(x0 - 10, g - 4), (x1 + 10, g - 4)] + list(reversed(base)), -16, 26, mat('rock'), 10,
            bevel=2)
    # Log walls: one log per row, alternating groups so the seams draw.
    rows = 6
    for i in range(rows):
        y0 = g - 6 - (i + 1) * (h / rows)
        K.box(f'cabin_log{i}', x0, y0, x1, y0 + h / rows + 0.5, -8, 26, mat('wood'), 11 + i % 2, bevel=2.5)
    for i, lx in enumerate((x0 + 3, x1 - 3)):
        for j in range(rows):
            y0 = g - 6 - (j + 0.5) * (h / rows)
            K.log(f'cabin_end{i}_{j}', lx, y0, h / rows * 0.55, 20, 28, mat('wood'), 13)
    K.roof('cabin_roof', x0, x1, g - 6 - h, g - 6 - h - 46, -14, 32, mat('wood'), 14, overhang=12, thickness=7)
    K.roof('cabin_roofsnow', x0 + 2, x1 - 2, g - 12 - h, g - 12 - h - 44, -12, 36, mat('snow'), 15, overhang=12,
           thickness=8)
    K.box('cabin_chimney', x1 - 30, g - 6 - h - 58, x1 - 16, g - 6 - h - 18, -4, 14, mat('rock'), 16, bevel=1.5)
    K.blob('cabin_chimney_snow', x1 - 23, g - 6 - h - 58, 9, 4, mat('snow'), 15, d=6)
    K.box('cabin_door', x + 10, g - 42, x + 30, g - 6, 26, 31, mat('red'), 18, bevel=1.5)
    K.box('cabin_window', x - 34, g - 44, x - 12, g - 26, 26, 30, mat('lamp'), 18)
    K.box('cabin_window_bar', x - 24, g - 44, x - 22, g - 26, 30, 31, mat('wood'), 16)
    K.box('cabin_sill', x - 37, g - 26, x - 9, g - 22, 26, 33, mat('snow'), 15)
    # Snow banked against the front.
    K.blob('cabin_bank_l', x0 + 8, g - 4, 22, 9, mat('snow'), 15, d=30)
    K.blob('cabin_bank_r', x1 - 4, g - 2, 18, 7, mat('snow'), 15, d=30)
    # A sled leaning by the door.
    K.prism('cabin_sled', [(x1 + 8, g - 4), (x1 + 16, g - 4), (x1 + 26, g - 40), (x1 + 20, g - 42)], 18, 24,
            mat('red'), 17, bevel=1)


def snowy_pine(k, name, x, gy, height, width, d=4.0, tiers=3):
    """A pine with snow sitting on each tier."""
    mat = k.mat
    K.pine(name, x, gy, height, width, (mat('bark'), mat('pine')), (19, 20), d=d, tiers=tiers)
    for t in range(tiers):
        kk = t / max(1, tiers - 1)
        base = gy - height * (0.18 + 0.27 * kk)
        h = height * (0.5 - 0.1 * kk)
        w = width * (0.5 - 0.13 * kk)
        K.lathe(f'{name}_snow{t}', x, d, [(0.0, base - h - 1), (w * 0.3, base - h * 0.62), (w * 0.62, base - h * 0.32),
                                         (w * 0.5, base - h * 0.26)], mat('snow'), 22, segments=9, smooth_shade=False)


def pines(k):
    ground = profile()
    r = K.rng(33)
    for i, (x, h, w) in enumerate(((22, 96, 44), (66, 74, 36), (1552, 70, 34), (1586, 92, 42), (1718, 104, 46),
                                   (1756, 84, 40), (1790, 110, 48))):
        snowy_pine(k, f'pine{i}', x, K.height_at(ground, x) + 5, h, w, d=4 + r.uniform(-2, 2))


def frozen_things(k):
    """What the ice holds: a mammoth, a fish, an old pickaxe, a lost boot."""
    mat = k.mat
    ground = profile()
    # A woolly mammoth frozen in the ice under the high left shelf: a chibi one, all
    # head and fur, with curled tusks and its trunk up.
    mx, my = 512, K.height_at(ground, 512) + 150
    for i, (lx, lw) in enumerate(((mx - 58, 9), (mx - 36, 9), (mx - 12, 10))):
        K.box(f'mam_leg{i}', lx - lw / 2, my + 14, lx + lw / 2, my + 38, -4, 8, mat('bark'), 11, bevel=2.5)
    K.blob('mam_body', mx - 34, my + 4, 40, 27, mat('wood'), 12, d=-2, rd=16)
    # A shaggy fringe along the belly: overlapping tufts in the darker fur.
    for i in range(7):
        fx = mx - 66 + i * 10
        K.blob(f'mam_fringe{i}', fx, my + 24 - abs(i - 3) * 1.5, 7, 6, mat('bark'), 13, d=8, segments=10, rings=5)
    K.blob('mam_hump', mx - 20, my - 18, 20, 12, mat('bark'), 13, d=4, rd=12)
    K.blob('mam_head', mx + 4, my - 8, 23, 22, mat('wood'), 14, d=6, rd=15)
    K.blob('mam_ear', mx - 10, my - 6, 9, 12, mat('bark'), 15, d=16, rd=4)
    K.blob('mam_eye', mx + 11, my - 12, 3, 3.4, mat('bedrock'), 16, d=20, segments=8, rings=4)
    K.tube('mam_trunk', [(mx + 20, my - 2, 14), (mx + 28, my + 14, 14), (mx + 36, my + 22, 14), (mx + 44, my + 16, 14),
                         (mx + 46, my + 8, 14)], 4.6, mat('wood'), 15, taper=0.5, resolution=2)
    K.tube('mam_tusk', [(mx + 12, my + 8, 18), (mx + 24, my + 22, 18), (mx + 40, my + 26, 18), (mx + 50, my + 14, 18),
                        (mx + 48, my + 4, 18)], 3.3, mat('snow'), 17, taper=0.45, resolution=2)
    # A fish under the valley.
    fx, fy = 1010, K.height_at(ground, 1010) + 92
    K.blob('fish_body', fx, fy, 14, 7, mat('red'), 12, d=4, rd=5)
    K.prism('fish_tail', [(fx - 12, fy), (fx - 24, fy - 8), (fx - 22, fy), (fx - 24, fy + 8)], 0, 8, mat('red'), 13)
    K.blob('fish_eye', fx + 8, fy - 2, 1.8, 1.8, mat('bedrock'), 14, d=9, segments=8, rings=4)
    # A pickaxe in the ice under the lower right shelf.
    px_, py_ = 1440, K.height_at(ground, 1440) + 110
    K.prism('pick_handle', [(px_ - 20, py_ + 16), (px_ - 16, py_ + 19), (px_ + 14, py_ - 12), (px_ + 10, py_ - 15)], 0, 8,
            mat('wood'), 12)
    K.tube('pick_head', [(px_ - 2, py_ - 22, 6), (px_ + 12, py_ - 14, 6), (px_ + 24, py_ - 2, 6)], 3.0, mat('rock'), 13,
           taper=0.5, resolution=1)


# ---------------------------------------------------------------------------------
# Plates, far to near.
# ---------------------------------------------------------------------------------

M.ramp('peakfar', ['#2f3c64', '#38466f', '#43517a', '#4f5d86'])
M.ramp('snowfar', ['#5e6e96', '#6a7aa0', '#7886aa', '#8693b4'])


@M.plate('peaks', parallax=0.12, outline='#28345a')
def peaks(P):
    """The far range, big and pale under the aurora."""
    mat = P.spec.mat
    r = K.rng(11)
    base = P.ay(760)
    x = -80
    i = 0
    while x < P.width + 140:
        h = r.uniform(120, 190)
        K.mountain(f'peak{i}', x, base, h, h * r.uniform(0.8, 1.1), mat('peakfar'), 1 + i % 2,
                   snow=(mat('snowfar'), 3), snow_line=0.45, d=-i * 3, seed=20 + i, facets=7)
        x += r.uniform(120, 190)
        i += 1
    K.box('foot', -10, base, P.width + 10, P.height + 10, -80, -60, mat('peakfar'), 1)


M.ramp('seaice', ['#4c6490', '#5a74a0', '#6c86b0', '#8098c0'])
M.ramp('berg', ['#6a86b4', '#809cc6', '#9ab4d6', '#b6cce4'])
M.ramp('water', ['#16284a', '#1c3258', '#243e66', '#2e4a74'])


@M.plate('sea', parallax=0.26, outline='#2a3a60')
def sea(P):
    """The frozen sea: a plain of pack ice with leads of dark water and icebergs in it."""
    mat = P.spec.mat
    r = K.rng(21)
    horizon = P.ay(650)
    K.box('ice', -20, horizon, P.width + 20, P.height + 20, -60, -40, mat('seaice'), 1)
    # Leads: dark water cracks across the plain, wider nearer.
    for i in range(5):
        y = horizon + 10 + i * 16 + r.uniform(-3, 3)
        x = r.uniform(-60, P.width * 0.6)
        L = r.uniform(160, 420)
        th = 1.5 + i * 0.8
        K.box(f'lead{i}', x, y, x + L, y + th, -39, -38, mat('water'), 2)
    # Tabular icebergs standing in the pack: flat tops catch the light.
    x = -10
    i = 0
    while x < P.width + 60:
        w = r.uniform(26, 70)
        hh = r.uniform(10, 26)
        by = horizon + r.uniform(4, 34)
        ty = by - hh
        poly = [(x - w / 2, by), (x - w / 2 + 2, ty + 4), (x - w / 2 + 7, ty), (x + w * 0.2, ty + r.uniform(-3, 2)),
                (x + w / 2 - 5, ty + 2), (x + w / 2, ty + 7), (x + w / 2 + 3, by)]
        K.prism(f'berg{i}', poly, -20, -4 + i % 3, mat('berg'), 3 + i % 2, bevel=2.0)
        K.box(f'berg{i}_line', x - w / 2 + 2, by - 2, x + w / 2 + 2, by + 1, -3, -2, mat('water'), 2)
        x += r.uniform(70, 170)
        i += 1


M.ramp('hillsnow', ['#5a6e98', '#6a80a8', '#7e94ba', '#94a8c8'])
M.ramp('forest', ['#1b3440', '#223f4a', '#2c4c54', '#385a5e'])


@M.plate('hills', parallax=0.44, outline='#27354f')
def hills(P):
    """Snowy hills with a dark pine forest along their feet."""
    mat = P.spec.mat
    r = K.rng(31)
    pts = []
    x = -60
    while x < P.width + 160:
        pts.append((x, P.ay(770) - 36 * math.sin(x / 150 + 0.4) - 20 * math.sin(x / 57) - 18))
        x += 50
    ridge = K.smooth(pts, 4)
    K.ground('hills', ridge, mat('hillsnow'), 1, depth=40, bottom=P.height + 10, bevel=5)
    forest = [(fx, K.height_at(ridge, fx) + 40 + 8 * math.sin(fx / 40)) for fx in range(-20, P.width + 40, 20)]
    fx = -10
    j = 0
    while fx < P.width + 20:
        gy = K.height_at(forest, fx)
        K.pine(f'pine{j}', fx, gy + 6, r.uniform(34, 58), r.uniform(16, 24), (mat('forest'), mat('forest')), (3, 4),
               d=30, tiers=3)
        fx += r.uniform(8, 15)
        j += 1
    K.ground('forest_floor', forest, mat('forest'), 5, depth=20, d_front=34)


M.ramp('drift', ['#3a4c74', '#465a84', '#556a94', '#667ca4'])
M.ramp('pinenear', ['#0f2430', '#16303a', '#1e3c44', '#284a50'])


@M.plate('near', parallax=0.66, outline='#141e30')
def near(P):
    """Drifts and a few big pines just behind the playfield, dark and quiet."""
    mat = P.spec.mat
    r = K.rng(41)
    base = P.ay(730)
    pts = [(x, base + 12 * math.sin(x / 80) + 7 * math.sin(x / 31)) for x in range(-40, P.width + 60, 30)]
    line = K.smooth(pts, 4)
    K.ground('drift', line, mat('drift'), 1, depth=30, bottom=P.height + 10, bevel=6)
    x = -20
    i = 0
    while x < P.width + 30:
        gy = K.height_at(line, x) + 10
        K.pine(f'pine{i}', x, gy, r.uniform(80, 130), r.uniform(36, 50), (mat('pinenear'), mat('pinenear')), (2, 3),
               d=0, tiers=3)
        x += r.uniform(60, 150)
        i += 1
