"""
Magma Forge (`forge`): a volcanic island over a lava sea (DESIGN §8.1).

A slab of basalt floats on a lava sea on three pillars, with a tall volcano in the
middle of it. Left to right: the left cliff over the lava, a terrace with an iron forge
and its brick chimney built into a basalt bluff, the left plain (a charred tree), an
obsidian outcrop, the left foot shelf, the volcano (a glowing crater at the top, its
conduit running down through the rock to a magma chamber and on into the sea), the
right foot shelf, a sulphur fumarole, the right plain, an ore cart, and a causeway of
hexagonal basalt columns stepping down to the right cliff. In cross-section: draped
tuff and scoria beds, columnar basalt, obsidian lenses, glowing lava seams branching
off the conduit, and arches under the slab where the lava sea shows through.

The tactical idea: the volcano is a wall 250 px high between the two halves, so every
duel is played in lobs over the peak (or by digging a tunnel through it, which the
conduit makes tempting and slow). Its flanks are too steep to climb. The chimney and
the forge catch high lobs on the left, the causeway's columns give the right cover
that breaks one column at a time.

Spawn slots on 1800 px (margin 180): 2 seats search from 540 and 1260, 4 seats from
360, 720, 1080 and 1440, 8 seats every 180 px from 270. Shelves: the left plain
(300-600), the left foot shelf (680-758), the right foot shelf (1040-1118), the right
plain (1190-1330) and the causeway's platform (1398-1480). The forge, the tree, the
obsidian, the fumarole and the cart stand between them.

Sequence of passes and what each changed: tools/blender/iterations/maps/forge/.
"""
import math

import bmesh

import map_kit as K

M = K.define(
    'forge',
    size=(1800, 1050),
    sky=['#140709', '#2e0e12', '#541816', '#86281a', '#b8421e', '#e0702c'],
    outline='#0c080e',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
# Terrain budget 48 colours: 10 ramps + outline + 3 flats = 44.
M.ramp('basalt', ['#1a1826', '#2a2740', '#3c3858', '#57527a'])
M.ramp('column', ['#221f28', '#35313c', '#4c4754', '#6c6676'])
M.ramp('tuff', ['#56423c', '#7a6052', '#9c806a', '#bea086'])
M.ramp('scoria', ['#4e2420', '#74362a', '#985038', '#b86e4a'])
M.ramp('obsidian', ['#120c1a', '#20182e', '#382a52', '#6a5a96'])
M.ramp('ash', ['#6a605c', '#968a82', '#bcb0a4', '#e4dccc'])
M.ramp('iron', ['#22222a', '#3a3c48', '#5a5e70', '#8a90a4'])
M.ramp('brick', ['#4a1c18', '#742c22', '#9c402c', '#c26048'])
M.ramp('sulphur', ['#6e5e12', '#a6961e', '#d4c83a', '#f2ea84'])
M.ramp('magma', ['#6a1408', '#a82a0c', '#e0541a', '#ff9a30'])
M.flat('hot', '#ffe07a')
M.flat('glow', '#ff9a2a')
M.flat('ember', '#e0481a')

W_MAP, H_MAP = 1800, 1050
BOTTOM = H_MAP + 30
LEFT_EDGE = 70
RIGHT_EDGE = 1722
PEAK_X = 900

PROFILE_POINTS = [
    (LEFT_EDGE, 612), (84, 600), (96, 596),                     # the bluff the forge is built into
    (108, 612), (118, 624), (140, 627), (200, 626), (262, 624),  # forge terrace
    (282, 614), (300, 604), (330, 601),                          # rise
    (380, 600), (450, 601), (540, 599), (600, 600),              # left plain (4: 360, 2: 540)
    (628, 597), (656, 590), (684, 585),                          # obsidian rise
    (720, 584), (758, 584),                                      # left foot shelf (4: 720)
    (776, 570), (792, 540), (806, 500), (822, 456), (840, 414),  # the volcano's left flank
    (856, 382), (868, 358), (878, 342), (884, 335),              # left horn
    (892, 346), (900, 353), (908, 346),                          # the crater
    (916, 335), (922, 342), (934, 360), (948, 388), (964, 424),  # right horn and flank
    (982, 468), (1000, 510), (1016, 546), (1030, 568), (1042, 576),
    (1080, 577), (1118, 578),                                    # right foot shelf (4: 1080)
    (1140, 585), (1166, 594), (1192, 598),                       # fumarole
    (1240, 599), (1300, 600), (1330, 598),                       # right plain (2: 1260)
    (1356, 594), (1384, 589), (1398, 588),                       # ore cart
    (1440, 587), (1480, 587),                                    # causeway platform (4: 1440)
]

# The causeway: columns stepping down to the right cliff (left x, right x, top y).
CAUSEWAY = [(1480, 1504, 596), (1504, 1528, 590), (1528, 1552, 606), (1552, 1576, 614), (1576, 1600, 608),
            (1600, 1624, 626), (1624, 1648, 634), (1648, 1672, 628), (1672, 1698, 646), (1698, RIGHT_EDGE, 660)]


def profile():
    pts = K.smooth(PROFILE_POINTS, step=3.0)
    return [(x, y) for x, y in pts if x <= 1480]


def surface_at(x):
    if x <= 1480:
        return K.height_at(profile(), x)
    for x0, x1, top in CAUSEWAY:
        if x0 <= x < x1:
            return top
    return CAUSEWAY[-1][2]


# The slab's underside: arches over the lava between three pillars that stand in it.
PILLARS = [(262, 336), (846, 956), (1470, 1548)]


def underside():
    w = K.wobble(17, 14, 160)
    pts = []
    x = RIGHT_EDGE
    while x >= LEFT_EDGE:
        y = 930 + w(x) + 16 * math.sin(x / 57)
        for a, b in PILLARS:
            # The pillars flare into the slab above them.
            if a - 40 < x < b + 40:
                t = min(1.0, min(x - (a - 40), (b + 40) - x) / 40)
                y = y + (BOTTOM - y) * t * t
        pts.append((x, min(y, BOTTOM)))
        x -= 6
    return pts


def crust(name, prof, material, groups, radius=5.0, hem=10.0, seed=0, stones=None):
    """The cinder-strewn top of the ground: a rounded lip, a ragged skirt, cinders in its face."""
    g_lip, g_peb = groups
    r = K.rng(seed)
    K.tube(f'{name}_lip', [(x, y, 1.0) for x, y in prof], radius, material, g_lip, resolution=3)
    hem_line = [(x, y + hem + 4 * abs(math.sin(x * math.pi / 15)) + 2 * math.sin(x / 5.3)) for x, y in prof]
    K.band(f'{name}_skirt', K.offset(prof, 1), hem_line, -8, 2.5, material, g_lip)
    if stones:
        x = prof[0][0] + 6
        while x < prof[-1][0] - 6:
            y = K.height_at(prof, x)
            K.rock(f'{name}_peb{int(x)}', x, y + r.uniform(2, 6), r.uniform(1.8, 3.0), stones, g_peb,
                   d=radius + 2.5, seed=int(x) + seed, squash=(1.3, 0.5, 0.8))
            x += r.uniform(8, 18)
    return K.offset(prof, -radius)


def seam(name, pts, width, seed=0):
    """
    A lava seam in the rock: a glowing crack with a dark scorched rim. Painted only:
    the rock around and inside it is as solid as any other (DESIGN §8.1: no hazards).
    """
    mat = M.mat
    K.tube(f'{name}_rim', [(x, y, 2.0) for x, y in pts], width + 1.6, mat('magma'), 11, resolution=1, faceted=True)
    K.tube(f'{name}_hot', [(x, y, 2.0 + width + 1.2) for x, y in pts], max(1.0, width * 0.55), mat('hot'), 12,
           resolution=1, faceted=True)


def hexcol(name, x0, x1, top, bottom, material, group, d=0.0):
    """
    A hexagonal basalt column standing upright, an edge towards the camera, flat shaded:
    the light splits it into a lit left face and a shadowed right one, which is what
    makes a row of them read as columns rather than planks. Its silhouette spans x0-x1.
    """
    r = (x1 - x0) / (2 * math.cos(math.radians(30)))
    cx = (x0 + x1) / 2
    bm = bmesh.new()
    rings = []
    for y in (top, bottom):
        rings.append([bm.verts.new(K.W(cx + r * math.cos(math.radians(30 + 60 * k)), y,
                                       d + r * math.sin(math.radians(30 + 60 * k)))) for k in range(6)])
    for k in range(6):
        j = (k + 1) % 6
        bm.faces.new((rings[0][k], rings[0][j], rings[1][j], rings[1][k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return K._mesh_object(name, bm, material, group, smooth=False)


def crack_path(r, x, y, length, heading, step=9.0, wander=0.5):
    pts = [(x, y)]
    for _ in range(int(length / step)):
        heading += r.uniform(-wander, wander)
        x += math.cos(heading) * step
        y += math.sin(heading) * step
        pts.append((x, y))
    return pts


@M.terrain
def terrain(k):
    mat = k.mat
    prof = profile()
    r = K.rng(1)

    # The slab: surface, causeway steps, right cliff, underside with its pillars, left cliff.
    top = list(prof)
    for x0, x1, t in CAUSEWAY:
        top += [(x0 + 0.01, t), (x1, t)]
    right_cliff = [(RIGHT_EDGE, 700), (RIGHT_EDGE - 6, 780), (RIGHT_EDGE + 2, 860), (RIGHT_EDGE - 4, 920)]
    left_cliff = [(LEFT_EDGE + 4, 900), (LEFT_EDGE - 4, 820), (LEFT_EDGE + 3, 740), (LEFT_EDGE - 2, 660)]
    K.prism('slab', top + right_cliff + underside() + left_cliff, -90, 0, mat('basalt'), 1)

    # The rock under the ground, jointed into blocks that drape with the surface: warm,
    # light tuff at the top, scoria under it, cooling into the dark basalt with depth.
    blocks(k, prof)

    columnar(k)
    conduit(k)

    # Obsidian lenses and cinder in the rock.
    for i, (lx0, lx1, ly, th) in enumerate(((140, 330, 690, 12), (480, 700, 668, 10), (1120, 1330, 684, 12),
                                            (1500, 1700, 720, 12))):
        wl = K.wobble(50 + i, 2.5, 80)
        up, lo = [], []
        x = lx0
        while x <= lx1:
            t = (x - lx0) / (lx1 - lx0)
            half = th / 2 * math.sin(math.pi * t) ** 0.7
            up.append((x, ly - half + wl(x)))
            lo.append((x, ly + half + wl(x) * 0.4))
            x += 4
        K.prism(f'obs_lens{i}', up + list(reversed(lo)), -30, 1.8, mat('obsidian'), 5)
    for i in range(150):
        x = r.uniform(LEFT_EDGE + 10, RIGHT_EDGE - 10)
        s = surface_at(x)
        y = s + r.uniform(16, 330)
        if y > 915:
            continue
        K.rock(f'cinder{i}', x, y, r.uniform(2.5, 5) + (y - s) / 120, mat('ash' if i % 3 else 'scoria'), 8, d=2.5,
               seed=100 + i, squash=(1.3, 0.5, 0.8))

    # Lava seams branching through the rock, the hottest near the conduit.
    rs = K.rng(7)
    for i, (sx, sy, heading, length, width) in enumerate((
            (880, 700, math.pi * 0.95, 190, 2.4), (920, 690, 0.05, 200, 2.4), (870, 790, math.pi * 1.05, 260, 2.0),
            (930, 780, -0.05, 280, 2.0), (640, 740, math.pi * 0.9, 150, 1.6), (1180, 760, 0.2, 160, 1.6),
            (300, 830, math.pi * 1.4, 70, 1.8), (1300, 700, 0.4, 110, 1.8), (200, 720, 0.3, 90, 1.4),
            (430, 690, math.pi + 0.3, 90, 1.4))):
        pts = crack_path(rs, sx, sy, length, heading)
        seam(f'seam{i}', pts, width)
        # One branch off each, thinner.
        j = len(pts) // 2
        seam(f'seam{i}b', crack_path(rs, pts[j][0], pts[j][1], length * 0.4, heading + rs.choice((-0.8, 0.8))),
             max(1.2, width * 0.6))

    crust('crust', prof, mat('ash'), (9, 10), seed=5, stones=mat('scoria'))
    causeway(k)
    forge(k, 180)
    crater(k)
    props(k)


def blocks(k, prof):
    """
    Jointed rock under the crust: columns of irregular blocks that follow the surface
    down, their corners shared so they tile, lighter and warmer near the top and darker
    with depth, every block its own part so the joints draw as lines.
    """
    mat = k.mat
    r = K.rng(14)
    xs = [LEFT_EDGE - 4]
    while xs[-1] < 1484:
        xs.append(min(1484, xs[-1] + r.uniform(22, 42)))
    depths = [8, 34, 64, 98, 136]
    verts = {}
    for i, x in enumerate(xs):
        for j, dd in enumerate(depths):
            jit = 0 if j == 0 else r.uniform(-7, 7)
            xx = x if i in (0, len(xs) - 1) or j == 0 else x + r.uniform(-6, 6)
            verts[(i, j)] = (xx, surface_at(max(LEFT_EDGE, min(1480, xx))) + dd + jit)
    tones = [('tuff', 'tuff', 'tuff'), ('tuff', 'scoria', 'tuff'), ('scoria', 'basalt', 'scoria'),
             ('basalt', 'basalt', 'scoria')]
    for i in range(len(xs) - 1):
        # A column's joints do not line up with its neighbour's: skip one joint at random.
        for j in range(len(depths) - 1):
            a, b = verts[(i, j)], verts[(i + 1, j)]
            c, d = verts[(i + 1, j + 1)], verts[(i, j + 1)]
            top = [a] + [(x, surface_at(x) + depths[j]) for x in range(int(a[0]) + 4, int(b[0]) - 2, 4)] + [b] \
                if j == 0 else [a, b]
            m = r.choice(tones[j])
            K.prism(f'blk{i}_{j}', top + [c, d], -30, 1.2 + 0.1 * j, mat(m), 2 + (i + j) % 3, bevel=1.0)


def columnar(k):
    """
    Columnar basalt: clusters of upright hexagonal columns in the lower rock, each
    cluster's tops at their own level, their feet running into the underside.
    """
    mat = k.mat
    r = K.rng(12)
    under = list(reversed(underside()))
    i = 0
    for cx0, cx1, level in ((LEFT_EDGE + 2, 250, 742), (330, 520, 780), (560, 800, 752), (990, 1200, 770),
                            (1230, 1400, 748)):
        x = cx0
        wt = K.wobble(13 + i, 7, 90)
        while x < cx1:
            w = r.uniform(11, 20)
            t = level + wt(x) + r.uniform(-9, 9)
            # Clusters thin out at their ends.
            edge = min(x - cx0, cx1 - x) / 40
            t += max(0.0, 1 - edge) * 30
            bottom = min(min(K.height_at(under, x + f * w) for f in (0, 0.25, 0.5, 0.75, 1)) - 4, 925)
            if bottom - t > 12 and t > surface_at(x) + 70 and t > surface_at(x + w) + 70:
                hexcol(f'col{i}', x, x + w, t, bottom, mat('column'), 6 + i % 2, d=-w * 0.35)
                K.box(f'col{i}_cap', x + 2, t - 0.5, x + w - 2, t + 2.5, w * 0.3, w * 0.3 + 2, mat('column'), 24 + i % 2)
                jy = t + r.uniform(25, 90)
                if jy < bottom - 8:
                    K.box(f'col{i}_joint', x + 1, jy, x + w - 1, jy + 1.5, w * 0.3, w * 0.3 + 2, mat('column'), 24 + (i + 1) % 2)
            x += w
            i += 1


def conduit(k):
    """The volcano's pipe: a magma chamber in the slab and the conduit up to the crater."""
    mat = k.mat
    w = K.wobble(21, 11, 320)
    pts = [(PEAK_X + w(y) * min(1.0, (y - 360) / 200), y) for y in range(374, 1000, 10)]
    pts.append((PEAK_X, BOTTOM))
    K.tube('conduit_crust', [(x, y, -4) for x, y in pts], 12, mat('obsidian'), 10, resolution=2)
    K.tube('conduit_rim', [(x, y, 2) for x, y in pts], 9, mat('magma'), 11, resolution=2)
    K.tube('conduit_glow', [(x, y, 11.5) for x, y in pts], 5.5, mat('glow'), 12, resolution=2)
    K.tube('conduit_core', [(x, y, 17.5) for x, y in pts[1:]], 2.4, mat('hot'), 13, resolution=1)
    # The chamber, where it swells on its way up.
    cy = 820
    cx = PEAK_X + w(cy)
    rc = K.rng(22)
    wob = [rc.uniform(0, math.tau) for _ in range(3)]

    def lump(scale, jag):
        pts = []
        for i in range(40):
            a = i / 40 * math.tau
            k_ = 1 + 0.16 * math.sin(3 * a + wob[0]) + 0.1 * math.sin(5 * a + wob[1]) + rc.uniform(-jag, jag)
            # Dikes: two fingers of magma pushing out sideways and one up.
            for fa, fl in ((0.15, 0.3), (math.pi - 0.2, 0.28), (-math.pi / 2 - 0.3, 0.25)):
                k_ += fl * max(0.0, math.cos(min(math.pi / 2, abs(math.atan2(math.sin(a - fa), math.cos(a - fa))) / 0.5 * math.pi / 2)))
            pts.append((cx + math.cos(a) * 62 * scale * k_, cy + math.sin(a) * 30 * scale * k_))
        return pts

    K.prism('chamber_crust', lump(1.18, 0.05), -30, -2, mat('obsidian'), 10, bevel=1.5)
    K.prism('chamber_rim', lump(1.0, 0.06), -2, 4, mat('magma'), 11, bevel=1.2)
    K.prism('chamber_glow', lump(0.74, 0.08), 4, 8, mat('glow'), 12)
    for i, (dy, w_, x_) in enumerate(((-6, 30, -14), (4, 22, 8), (12, 12, -4))):
        K.prism(f'chamber_hot{i}', [(cx + x_ - w_ / 2, cy + dy), (cx + x_ + w_ / 2, cy + dy - 1.5),
                                    (cx + x_ + w_ / 2 - 3, cy + dy + 2), (cx + x_ - w_ / 2 + 2, cy + dy + 2.5)],
                 8, 9, mat('hot'), 13)
    # Crust floating in the chamber.
    for i, (dx, dy, rr) in enumerate(((-22, 6, 5), (14, -8, 4), (26, 10, 3.5))):
        K.rock(f'chamber_crust{i}', cx + dx * 1.6, cy + dy, rr * 1.4, mat('basalt'), 14, d=22, seed=30 + i,
               squash=(1.4, 0.4, 0.6))


def crater(k):
    """The crater: lava pooled in the notch at the top, spatter frozen on its rim."""
    mat = k.mat
    K.prism('crater_pool', [(888, 350), (900, 360), (912, 350), (908, 366), (900, 370), (892, 366)], 0, 3, mat('glow'),
            15)
    K.blob('crater_hot', 900, 362, 6, 3.5, mat('hot'), 16, d=5, segments=10, rings=5)
    for i, (x, y) in enumerate(((880, 346), (920, 346), (874, 362), (926, 364))):
        K.rock(f'crater_spatter{i}', x, y + 4, 3.5, mat('obsidian'), 17, d=6, seed=40 + i, squash=(1.2, 0.6, 0.7))
    # Frozen lava tongues down the flanks.
    for i, pts in enumerate((((884, 352), (872, 380), (858, 408), (846, 438)),
                             ((916, 352), (928, 380), (944, 414), (958, 448), (968, 470)))):
        K.tube(f'flow{i}', [(x, y + 5, 4) for x, y in pts], 3.4, mat('magma'), 18, taper=0.5, resolution=2)
        K.tube(f'flow{i}_hot', [(x, y + 5, 7) for x, y in pts[:3]], 1.4, mat('hot'), 19, taper=0.4, resolution=1)


def causeway(k):
    """Hexagonal basalt columns standing side by side, stepping down to the right cliff."""
    mat = k.mat
    under = list(reversed(underside()))
    cols = [(x0, x0 + 20, 587) for x0 in range(1400, 1480, 20)] + CAUSEWAY
    r = K.rng(33)
    for i, (x0, x1, top) in enumerate(cols):
        bottom = min(min(K.height_at(under, x0 + f * (x1 - x0)) for f in (0, 0.5, 1)) - 4, 760 + r.uniform(0, 120))
        hexcol(f'cw{i}', x0, x1, top, bottom, mat('column'), 20 + i % 2, d=-4)
        # The hexagon's top face, a lit cap just proud of the column.
        K.box(f'cw{i}_cap', x0 + 2, top - 0.5, x1 - 2, top + 2.5, 6, 8, mat('column'), 22)
        # A horizontal joint or two, where columns crack across.
        for j in range(r.choice((1, 2))):
            jy = top + r.uniform(30, 140)
            if jy < bottom - 6:
                K.box(f'cw{i}_joint{j}', x0 + 1, jy, x1 - 1, jy + 1.5, 6, 8, mat('column'), 23)


def forge(k, x):
    """
    The iron forge, built into the basalt bluff at the left: a brick furnace with a
    glowing mouth under an iron-clad shed, its chimney standing against the bluff, an
    anvil and a stack of ingots outside. Everything here is terrain.
    """
    mat = k.mat
    g = 622
    # The bluff behind it, cut back to take the building.
    K.prism('bluff', [(LEFT_EDGE - 4, g + 30), (LEFT_EDGE - 4, 596), (86, 568), (104, 560), (118, 572), (120, g + 30)],
            -40, -2, mat('basalt'), 23, bevel=2)
    # Brick furnace, the shed's back wall.
    fx0, fx1, fh = 110, 196, 76
    K.box('furnace', fx0, g - fh, fx1, g, -8, 10, mat('brick'), 13, bevel=1.5)
    for row in range(int(fh / 12)):
        y = g - fh + 2 + row * 12
        for j in range(8):
            bx = fx0 + 2 + j * 12 + (6 if row % 2 else 0)
            if bx + 11 > fx1:
                continue
            K.box(f'brick{row}_{j}', bx, y, bx + 11, y + 11, 10, 11, mat('brick'), 14 + (row + j) % 2, bevel=0.6)
    # Its mouth: an arch of fire, and the coals spilling out.
    mx, mw, mh = 150, 22, 34
    mouth = [(mx - mw, g - 2), (mx - mw, g - mh + mw * 0.7)] + \
        [(mx - mw * math.cos(a), g - mh + mw * 0.7 - mw * 0.8 * math.sin(a)) for a in [i * math.pi / 10 for i in range(11)]] + \
        [(mx + mw, g - 2)]
    K.prism('forge_mouth_rim', [(x + (4 if x > mx else -4) * (x != mx), y - 4 * (y < g - 3)) for x, y in mouth], 10.5,
            11.5, mat('iron'), 18, bevel=0.8)
    K.prism('forge_mouth', mouth, 11.5, 12.5, mat('glow'), 16)
    K.prism('forge_fire', [(mx - 16, g - 2), (mx - 12, g - 20), (mx - 6, g - 12), (mx - 1, g - 30), (mx + 5, g - 14),
                           (mx + 10, g - 24), (mx + 16, g - 2)], 12.5, 13.5, mat('hot'), 17)
    # The iron shed over the front: a post, a sloped roof of plates with rivets.
    K.box('shed_post', 244, g - 58, 251, g, 0, 12, mat('iron'), 18, bevel=1)
    K.prism('shed_roof', [(98, g - 88), (104, g - 95), (260, g - 62), (262, g - 55), (256, g - 55)], -12, 16,
            mat('iron'), 19, bevel=1.2)
    for j in range(8):
        rx = 116 + j * 19
        ry = g - 92 + (rx - 104) * 33 / 156
        K.blob(f'rivet{j}', rx, ry + 1, 1.8, 1.8, mat('iron'), 20, d=17, segments=8, rings=4)
    K.tube('chain', [(226, g - 64, 14), (228, g - 44, 14), (226, g - 30, 14)], 1.3, mat('iron'), 18, resolution=1)
    K.prism('hook', [(222, g - 30), (230, g - 30), (230, g - 24), (226, g - 22), (222, g - 26)], 12, 16, mat('iron'),
            19)
    # The chimney: brick up the bluff, iron bands, a glowing throat.
    cx0, cx1 = 80, 112
    top = g - 224
    K.box('chimney', cx0, top, cx1, g - 80, -20, 4, mat('brick'), 21, bevel=1.5)
    for row in range(int((g - 80 - top) / 12)):
        y = top + 4 + row * 12
        K.box(f'chim_row{row}', cx0 + 1, y, cx1 - 1, y + 1.4, 4, 5, mat('brick'), 22)
    for j, y in enumerate((top + 4, top + 64, top + 124)):
        K.box(f'chim_band{j}', cx0 - 2, y, cx1 + 2, y + 5, -18, 6, mat('iron'), 18, bevel=0.8)
    K.box('chim_cap', cx0 - 4, top - 6, cx1 + 4, top + 1, -18, 6, mat('iron'), 19, bevel=1)
    K.box('chim_throat', cx0 + 5, top - 7, cx1 - 5, top - 5, 6, 7, mat('glow'), 24)
    # Outside: an anvil on a stump, a stack of ingots, a quench trough.
    ax = 206
    K.box('anvil_block', ax - 7, g - 12, ax + 7, g + 2, -2, 10, mat('basalt'), 23, bevel=1)
    K.prism('anvil', [(ax - 16, g - 20), (ax + 10, g - 20), (ax + 14, g - 16), (ax + 6, g - 14), (ax + 5, g - 12),
                      (ax - 5, g - 12), (ax - 8, g - 16)], -2, 10, mat('iron'), 24, bevel=1)
    K.box('ingot_glow', ax - 12, g - 23, ax - 2, g - 20, 4, 8, mat('glow'), 25)
    for j, (ix, iy) in enumerate(((250, g - 4), (258, g - 4), (254, g - 8))):
        K.prism(f'ingot{j}', [(ix - 4, iy + 2), (ix - 3, iy - 2), (ix + 3, iy - 2), (ix + 4, iy + 2)], 0, 8,
                mat('sulphur'), 25)


def props(k):
    mat = k.mat
    prof = profile()
    # A charred tree on the left plain, between the 4- and 2-seat shelves.
    tx = 432
    g = K.height_at(prof, tx) - 3
    K.tube('tree_trunk', [(tx, g + 6, 4), (tx - 2, g - 30, 4), (tx + 4, g - 58, 4)], 5, mat('basalt'), 13, taper=0.5)
    for j, pts in enumerate((((tx - 1, g - 30), (tx - 16, g - 42), (tx - 22, g - 56)),
                             ((tx + 2, g - 44), (tx + 16, g - 52), (tx + 24, g - 50)),
                             ((tx + 4, g - 58), (tx + 2, g - 70)))):
        K.tube(f'tree_branch{j}', [(x, y, 4) for x, y in pts], 2.6, mat('basalt'), 14, taper=0.5, resolution=1)
    for j, (ex, ey) in enumerate(((tx + 1, g - 22), (tx - 2, g - 40))):
        K.box(f'tree_ember{j}', ex - 1.5, ey, ex + 1.5, ey + 5, 9, 10, mat('ember'), 15)
    # Obsidian shards bursting out of the rise before the left foot shelf.
    ox = 640
    g = K.height_at(prof, ox)
    for j, (dx, h, lean, w) in enumerate(((0, 38, -4, 9), (-12, 22, -8, 7), (12, 28, 6, 8), (22, 14, 8, 6))):
        K.prism(f'obs{j}', [(ox + dx - w, g + 4), (ox + dx + lean - 1.5, g - h), (ox + dx + lean + 1.5, g - h + 3),
                            (ox + dx + w, g + 4)], -4 + j, 6 + j, mat('obsidian'), 16 + j % 2, bevel=0.8)
    # A sulphur fumarole on the right: a cone of crust with a yellow rim.
    fx = 1162
    g = K.height_at(prof, fx)
    K.prism('fumarole', [(fx - 22, g + 6), (fx - 8, g - 16), (fx - 3, g - 12), (fx + 3, g - 12), (fx + 8, g - 16),
                         (fx + 22, g + 6)], -6, 6, mat('ash'), 13, bevel=1.5)
    for j, (dx, dy, rr) in enumerate(((-7, -15, 4), (7, -15, 4), (-12, -6, 3.5), (13, -5, 3), (0, -12, 3))):
        K.rock(f'sulphur{j}', fx + dx, g + dy, rr, mat('sulphur'), 14, d=7, seed=60 + j, squash=(1.2, 0.8, 0.7))
    # An ore cart on rails before the causeway, full of glowing ore.
    cx = 1366
    g = K.height_at(prof, cx) - 5
    K.box('rail', cx - 30, g + 2, cx + 30, g + 4, 2, 8, mat('iron'), 18)
    K.prism('cart', [(cx - 16, g - 20), (cx + 16, g - 20), (cx + 12, g - 4), (cx - 12, g - 4)], -2, 10, mat('iron'),
            19, bevel=1)
    K.box('cart_band', cx - 15, g - 16, cx + 15, g - 13, 10, 11, mat('iron'), 20)
    for wx in (cx - 8, cx + 8):
        K.log(f'cart_wheel{wx}', wx, g - 2, 4, 4, 12, mat('basalt'), 21)
    for j, (dx, rr, m) in enumerate(((-8, 5, 'magma'), (0, 6, 'glow'), (8, 5, 'magma'), (-3, 3, 'hot'))):
        K.rock(f'ore{j}', cx + dx, g - 22, rr, mat(m), 22, d=4 + j, seed=70 + j, squash=(1.2, 0.8, 0.8))
    # A brazier on the rise below the forge terrace: an iron bowl of coals on three legs.
    bx = 286
    g = K.height_at(prof, bx) - 3
    for j, dx in enumerate((-9, 0, 9)):
        K.tube(f'brazier_leg{j}', [(bx + dx * 0.5, g - 22, 6 + j), (bx + dx, g + 3, 6 + j)], 1.4, mat('iron'), 18,
               resolution=1)
    K.prism('brazier_bowl', [(bx - 12, g - 26), (bx + 12, g - 26), (bx + 8, g - 18), (bx - 8, g - 18)], 2, 12,
            mat('iron'), 19, bevel=0.8)
    K.prism('brazier_fire', [(bx - 9, g - 26), (bx - 6, g - 34), (bx - 2, g - 29), (bx + 1, g - 40), (bx + 4, g - 30),
                             (bx + 8, g - 35), (bx + 10, g - 26)], 6, 7, mat('glow'), 20)
    K.prism('brazier_core', [(bx - 5, g - 26), (bx - 1, g - 33), (bx + 3, g - 26)], 7, 8, mat('hot'), 21)
    # A war banner on the causeway's last column before the cliff.
    px_, top = 1706, CAUSEWAY[-1][2]
    K.box('banner_pole', px_ - 1.8, top - 70, px_ + 1.8, top + 2, 4, 8, mat('iron'), 18)
    K.blob('banner_knob', px_, top - 71, 3, 3, mat('sulphur'), 19, d=6)
    K.prism('banner', [(px_ + 2, top - 66), (px_ + 26, top - 64), (px_ + 22, top - 55), (px_ + 27, top - 46),
                       (px_ + 2, top - 44)], 3, 7, mat('brick'), 20, bevel=0.6)
    K.prism('banner_mark', [(px_ + 8, top - 60), (px_ + 16, top - 58), (px_ + 12, top - 50)], 7, 8, mat('sulphur'), 21)
    # Glowing cracks just under the crust, where the ground is still cooling.
    rg = K.rng(90)
    for j in range(16):
        cx = rg.uniform(120, 1460)
        if 760 < cx < 1040:
            continue
        y = K.height_at(prof, cx) + rg.uniform(8, 14)
        pts = crack_path(rg, cx, y, rg.uniform(14, 30), rg.choice((0.2, math.pi - 0.2)), step=5, wander=0.7)
        K.tube(f'hotcrack{j}', [(x, yy, 10) for x, yy in pts], 1.1, mat('ember'), 21, resolution=1, faceted=True)
    # Scattered volcanic bombs on the flanks, where nobody stands.
    for j, bx in enumerate((800, 836, 972, 1010)):
        K.rock(f'bomb{j}', bx, K.height_at(prof, bx) - 2, 6, mat('obsidian'), 17, d=6, seed=80 + j,
               squash=(1.1, 0.8, 0.9))


# ---------------------------------------------------------------------------------
# Plates, far to near.
# ---------------------------------------------------------------------------------

M.ramp('far_rock', ['#2e1014', '#431a1c', '#5a2624', '#72342a'])
M.ramp('far_smoke', ['#40181c', '#4c1e20', '#5a2624', '#682e28'])
M.ramp('far_lava', ['#b83a18', '#d45a1e', '#ec8226', '#ffb040'])


@M.plate('far', parallax=0.12, outline='#2a0c10')
def far(P):
    """A distant volcano erupting: a smoke column, lava running down its flanks."""
    mat = P.spec.mat
    base = P.ay(760)
    vx = P.ax(1250)
    # The range it stands in.
    r = K.rng(5)
    x = -40
    i = 0
    while x < P.width + 80:
        if abs(x - vx) > 120:
            h = r.uniform(30, 70)
            K.mountain(f'hill{i}', x, base, h, h * 1.6, mat('far_rock'), 1, d=-40 - i, seed=10 + i, facets=6)
        x += r.uniform(80, 140)
        i += 1
    # The volcano: a cut-off cone.
    K.mountain('volcano', vx, base + 8, 164, 150, mat('far_rock'), 2, d=-10, seed=3, facets=9, jitter=0.06)
    for j, pts in enumerate((((vx - 12, base - 156), (vx - 30, base - 120), (vx - 50, base - 80), (vx - 80, base - 30)),
                             ((vx + 14, base - 154), (vx + 30, base - 110), (vx + 60, base - 60)),
                             ((vx, base - 156), (vx + 4, base - 120), (vx - 6, base - 90)))):
        K.tube(f'lava{j}', [(x, y, 130) for x, y in pts], 3.0, mat('far_lava'), 3, taper=0.5, resolution=1)
    K.blob('vent', vx, base - 154, 8, 4, mat('far_lava'), 4, d=130)
    # The plume: billows piling up and leaning with the wind.
    for j in range(14):
        t = j / 13
        cxp = vx + 30 * t * t * 3 + r.uniform(-10, 10)
        cyp = base - 170 - t * 170
        rr = 20 + 32 * t
        K.blob(f'plume{j}', cxp, cyp, rr, rr * 0.8, mat('far_smoke'), 5 + j % 2, d=-20 + j * 2)
    # Lava bombs arcing out of the vent.
    for j, (dx, dy) in enumerate(((-60, -210), (70, -230), (-110, -170), (120, -190))):
        K.blob(f'bomb{j}', vx + dx, base + dy, 4, 4, mat('far_lava'), 7, d=20)
    K.box('foot', -10, base, P.width + 10, P.height + 10, -80, -60, mat('far_rock'), 8)


M.ramp('fort', ['#1e0c12', '#281218', '#34181e', '#402026'])
M.flat('fort_win', '#e8742a')


@M.plate('mid', parallax=0.3, outline='#14060a')
def mid(P):
    """Fortresses on crags: black towers and walls, a few windows lit by the fires."""
    mat = P.spec.mat
    r = K.rng(21)
    base = P.ay(700)
    pts = [(x, base + 26 * math.sin(x / 150 + 0.7) + 12 * math.sin(x / 53)) for x in range(-40, P.width + 60, 30)]
    line = K.smooth(pts, 4)
    K.ground('crags', line, mat('fort'), 1, depth=40, bottom=P.height + 10, bevel=3)
    # Jagged crags along the ridge.
    x = 0
    i = 0
    while x < P.width:
        g = K.height_at(line, x) + 6
        h = r.uniform(24, 60)
        w = r.uniform(18, 34)
        K.prism(f'crag{i}', [(x - w, g), (x - w * 0.3, g - h), (x + w * 0.1, g - h * 0.8), (x + w * 0.4, g - h * 1.05),
                             (x + w, g)], -10, 4, mat('fort'), 2 + i % 2, bevel=1)
        x += r.uniform(60, 130)
        i += 1
    # Two fortresses.
    for f, fx in enumerate((P.ax(420), P.ax(1450))):
        g = K.height_at(line, fx) - 6
        K.box(f'f{f}_wall', fx - 70, g - 40, fx + 70, g + 10, -6, 6, mat('fort'), 4, bevel=1)
        for j in range(8):
            mx = fx - 68 + j * 18
            K.box(f'f{f}_merlon{j}', mx, g - 47, mx + 9, g - 39, -6, 6, mat('fort'), 4)
        for j, (tx, h, w) in enumerate(((-70, 90, 26), (0, 130, 34), (70, 84, 24))):
            K.box(f'f{f}_tower{j}', fx + tx - w / 2, g - h, fx + tx + w / 2, g, -4, 8, mat('fort'), 5 + j % 2,
                  bevel=1)
            K.roof(f'f{f}_spire{j}', fx + tx - w / 2, fx + tx + w / 2, g - h, g - h - w * 1.1, -6, 10, mat('fort'),
                   7, overhang=3, thickness=3)
            for q in range(2):
                K.box(f'f{f}_win{j}_{q}', fx + tx - 2, g - h + 16 + q * 26, fx + tx + 2, g - h + 23 + q * 26, 8, 9,
                      mat('fort_win'), 8)
        K.box(f'f{f}_gate', fx - 10, g - 20, fx + 10, g + 2, 6, 7, mat('fort_win'), 8)


M.ramp('crag', ['#140a10', '#1c0e14', '#26141a', '#321a1e'])
M.ramp('crag_glow', ['#6a1c10', '#8e2a14', '#b43c1a', '#d8581e'])


@M.plate('near', parallax=0.55, outline='#0a0408')
def near(P):
    """Black basalt crags just behind the island, their cracks lit from the lava below."""
    mat = P.spec.mat
    r = K.rng(31)
    base = P.ay(660)
    pts = [(x, base + 22 * math.sin(x / 95) + 10 * math.sin(x / 37)) for x in range(-40, P.width + 60, 24)]
    line = K.smooth(pts, 4)
    K.ground('rock', line, mat('crag'), 1, depth=30, bottom=P.height + 10, bevel=4)
    x = -10
    i = 0
    while x < P.width + 30:
        g = K.height_at(line, x) + 6
        h = r.uniform(40, 110)
        w = r.uniform(14, 26)
        cols = r.choice((2, 3, 4))
        for c in range(cols):
            cx = x + (c - cols / 2) * w * 0.8
            ch = h * r.uniform(0.6, 1.0)
            K.prism(f'col{i}_{c}', [(cx - w * 0.4, g), (cx - w * 0.4, g - ch + 3), (cx - w * 0.2, g - ch),
                                    (cx + w * 0.2, g - ch), (cx + w * 0.4, g - ch + 3), (cx + w * 0.4, g)],
                     -8 + c, 4 + c, mat('crag'), 2 + (i + c) % 2, bevel=1)
        # A glowing crack down one of them.
        K.tube(f'crack{i}', [(x + r.uniform(-4, 4), g - h * 0.5, 10), (x + r.uniform(-4, 4), g - h * 0.25, 10),
                             (x, g + 10, 10)], 1.4, mat('crag_glow'), 4, resolution=1)
        x += r.uniform(60, 140)
        i += 1


M.ramp('sea', ['#9a2a0e', '#c83e12', '#ec6a1c', '#ffa434'])
M.ramp('sea_crust', ['#2a1210', '#3c1a14', '#50241a', '#66301e'])


@M.plate('lava', parallax=0.88, outline='#5a1206')
def lava(P):
    """The lava sea the island floats on: a crusted, glowing surface, the lava itself below."""
    mat = P.spec.mat
    r = K.rng(41)
    surface = P.ay(978)
    pts = [(x, surface + 4 * math.sin(x / 40) + 3 * math.sin(x / 13)) for x in range(-40, P.width + 60, 8)]
    K.ground('sea', pts, mat('sea'), 1, depth=40, bottom=P.height + 10)
    # Crest highlights and floating crust plates.
    for i in range(int(P.width / 36)):
        x = r.uniform(0, P.width)
        y = K.height_at(pts, x) + r.uniform(4, 40)
        if r.random() < 0.55:
            K.box(f'crest{i}', x, y, x + r.uniform(8, 22), y + 2, 4, 6, mat('sea'), 2 + i % 2)
        else:
            K.rock(f'crust{i}', x, y, r.uniform(5, 11), mat('sea_crust'), 4, d=6, seed=200 + i,
                   squash=(1.6, 0.4, 0.35))
    # Rocks standing out of the sea.
    for i in range(6):
        x = r.uniform(0, P.width)
        g = K.height_at(pts, x)
        h = r.uniform(14, 34)
        K.prism(f'stack{i}', [(x - 10, g + 6), (x - 6, g - h), (x + 5, g - h + 2), (x + 11, g + 6)], -4, 8,
                mat('sea_crust'), 5, bevel=1)
