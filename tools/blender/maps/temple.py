"""
Jungle Temple (`temple`): a stepped ziggurat overgrown by the jungle (DESIGN §8.1).

Left to right: a giant kapok on the far left with plank buttress roots, shelf fungi
and lianas, a mossy stela and a half-buried idol head on the jungle floor, then the
ziggurat: three talud-tablero tiers of carved limestone (framed friezes of shields and
glyph panels over battered block bases, two sealed doorways, two calendar stones) on a
foundation cut open in the soil, a grand stair up the middle between balustrades that
end in feathered serpent heads, and on top the sanctuary, a Puuc-style gateway block
with a corbel-vaulted gallery clean through it, braziers at its mouths and a roof comb
crowned by a big carved mask. The right end of the ziggurat has collapsed: tier 2
breaks off in a ragged diagonal and tier 1 is a heap of fallen blocks with a toppled
idol head on it. A strangler fig, its roots braided round the host trunk, closes the
right flank. Under it all, red jungle soil full of roots over clay, limestone and
bedrock, with a lost explorer, a burial urn spilling gold, a jade mask, a golden
figurine and a fossil fish.

A gallery through a block is, in a side view, a slab with air all along under it: the
sanctuary reads as a gateway lintel, not a building, and that is the price of a tunnel
that is open at both ends (the playability suite forbids sealed pockets).

The tactical idea: height against cover. The upper terraces (the third tier either
side of the sanctuary) see the whole map but stand in the open; the lower steps and
the jungle floor sit behind the tier walls, which stop flat shots; and the gallery is
the one covered place on the map and a sightline: a shell fired flat through it
crosses from one upper terrace to the other, and a mobile parked inside is safe from
lobs until the roof is blown off. The sanctuary block itself, 110 px of stone and a
roof comb, is what every other shot has to go over.

Spawn slots (constants.spawn.marginFraction 0.1 on 1900 px, usable 1520): 2 seats
search from x = 570 and 1330 (jitter +-46), 4 seats from 380, 760, 1140 and 1520 (+-23),
8 seats every 190 px from 285 (+-11). Shelves, left to right: the jungle floor (y 760,
x 230-440; 4-seat), tier 1 (708, 440-510), tier 2 (655, 510-665; 2-seat), tier 3 (600,
665-815; 4-seat), [the sanctuary, 815-1085: the gallery floor is the lowest surface in
those columns and has 62-90 px of air, so nobody spawns on or in it], tier 3 (600,
1085-1235; 4-seat), tier 2 (655, 1235-1362; 2-seat), the rubble (a wall) and the jungle
floor (760, 1490-1730; 4-seat). Trees, idols, the stela and the rubble stand off them.
Nothing tall may stand on the rubble: a tree there (pass 3) stopped every lob the right
floor's seat had towards the temple. A full room of 8 may put a seat on the fallen
head's crown, which the spawn rules accept.

Sequence of passes and what each changed: tools/blender/iterations/maps/temple/.
"""
import math

import map_kit as K

M = K.define(
    'temple',
    size=(1900, 1050),
    # A humid morning: teal overhead, a pale green haze on the horizon.
    sky=['#2f86a8', '#62b0bc', '#a4d4c4', '#e4efc6'],
    outline='#16130f',
)

# --- palette: shadow, mid, light, highlight -------------------------------------
# Terrain budget 48 colours: 11 ramps + outline + 2 flats = 47.
M.ramp('moss', ['#2b5a22', '#4a8a2c', '#7dbd3e', '#bfe56a'])
M.ramp('leaves', ['#123c2a', '#1d5f37', '#2f8744', '#5cb356'])
M.ramp('lichen', ['#3c4c3e', '#5b7056', '#84977a', '#adbf9a'])
M.ramp('stone', ['#4b4a44', '#78776a', '#a6a490', '#d4d0b6'], mottle=('lichen', 12, 0.32))
M.ramp('clay', ['#6a3a1e', '#95562a', '#bf7a36', '#dea052'])
M.ramp('soil', ['#46241a', '#6c3624', '#914e32', '#b56a44'], mottle=('clay', 14, 0.28))
M.ramp('bark', ['#34241a', '#57402c', '#7e5e40', '#a8845a'])
M.ramp('gold', ['#7a4a10', '#c08a1c', '#eec040', '#fff08a'])
M.ramp('jade', ['#0f4a44', '#1e7a66', '#3caa84', '#88e0b0'])
M.ramp('bedrock', ['#2c2a30', '#433e47', '#5c5661', '#7a737e'], mottle=('lichen', 18, 0.25))
M.ramp('bone', ['#8a7a64', '#c9b99c', '#ece0c4', '#fff9ec'])
M.flat('bloom', '#ff4d6d')
M.flat('glow', '#ffe45e')

W_, H_ = M.size

# The jungle floor, left to right. The temple stands on it; the flanks rise into the
# mounds the two giant trees grow from.
FLOOR = 760
PROFILE_POINTS = [
    (-20, 690), (30, 694), (90, 704), (150, 728),          # the kapok's mound
    (200, 752), (240, 759), (300, 760), (380, 760),        # left floor (4-seat)
    (440, 760), (700, 761), (1200, 760), (1480, 760),      # under the temple
    (1560, 760), (1640, 760), (1710, 758),                 # right floor (4-seat)
    (1750, 750), (1800, 732), (1850, 706), (1890, 676), (1925, 660),    # the fig's mound
]

# The ziggurat: (x0, x1, top) per tier, and the depth of its front face. Lower tiers
# stand in front of the upper ones, as on a real stepped pyramid.
T0 = (410, 1505, FLOOR + 3, 852, 3)      # buried foundation: x0, x1, top, bottom, front d
T1 = (440, 1395, 708, 7)                 # x0, x1, top, front d (its right end fell: the rubble)
T2 = (510, 1395, 655, 4)
T3 = (665, 1235, 600, 1)
SANCT = (815, 1085, 452)                 # the sanctuary block: x0, x1, roof
GALLERY_FLOOR = 600
STAIR = (904, 996)                       # the grand stair up the front, between its balustrades
T2_BREAK = 1362                          # where tier 2's broken end starts


def profile():
    return K.smooth(PROFILE_POINTS, step=3.0)


def gallery_ceiling():
    """The gallery's ceiling, left to right: low at the mouths, corbelled up to a vault."""
    x0, x1, _ = SANCT
    steps = [(0, 540), (30, 528), (52, 516), (74, 504)]
    left = []
    for i, (dx, y) in enumerate(steps):
        if i:
            left.append((x0 + dx, steps[i - 1][1]))
        left.append((x0 + dx, y))
    right = [(x0 + x1 - x, y) for x, y in reversed(left)]
    return [(x0, 538)] + left[1:] + right[:-1] + [(x1, 538)]


# ---------------------------------------------------------------------------------
# Helpers for this map: dressed stone, vines, idol heads, giant trees
# ---------------------------------------------------------------------------------

def masonry(k, name, x0, x1, y0, y1, d, seed, groups=(9, 10), row_h=13.0, skip=None, broken=0.05,
            material='stone', lean=0.0, width=(20, 34)):
    """
    Dressed blocks over a face from (x0, y0) to (x1, y1) whose front is at depth `d`
    at the top and `d + lean` at the bottom (a talud leans back, lean > 0): running
    bond, each block a bevelled box a pixel and a half proud of the face, so the gaps
    and part lines draw the courses. `skip(x, y)` leaves a block out (a panel goes
    there); `broken` is the share of blocks missing or sunk, which shows the core.
    """
    mat = k.mat
    r = K.rng(seed)
    y = y0
    row = 0

    def face_d(yy):
        return d + lean * (yy - y0) / max(1.0, y1 - y0)
    while y < y1 - 3:
        h = min(row_h, y1 - y)
        x = x0 - (r.uniform(4, 14) if row % 2 else 0)
        col = 0
        while x < x1:
            w = r.uniform(*width)
            a, b = max(x0, x), min(x1, x + w)
            cx, cy = (a + b) / 2, y + h / 2
            if b - a > 5 and not (skip and skip(cx, cy)):
                roll = r.random()
                if roll > broken:
                    sink = 0.0 if roll > broken * 3 else -1.2
                    ya, yb = y + 0.8, y + h - 0.8
                    K.leaning_box(f'{name}_{row}_{col}', a + 0.8, b - 0.8, ya, yb, face_d(ya) + 1.8 + sink,
                                  face_d(yb) + 1.8 + sink, min(face_d(ya), face_d(yb)) - 3, mat(material),
                                  groups[(row + col) % 2], bevel=1.3)
            x += w
            col += 1
        y += h
        row += 1


def vine(k, name, x, y, length, seed, d=8.0, leafy=0.7, bloom=0.12, sway=6.0):
    """A liana hanging from (x, y): a wiggling stem with leaves either side, some flowers."""
    mat = k.mat
    r = K.rng(seed)
    n = max(3, int(length / 7))
    ph = r.uniform(0, math.tau)
    pts = [(x + sway * math.sin(ph + t * 2.4) * t, y + length * t, d) for t in [i / n for i in range(n + 1)]]
    K.tube(f'{name}_stem', pts, 1.7, mat('leaves'), 14, taper=0.7, resolution=1)
    for i, (px_, py, _) in enumerate(pts[1:], 1):
        side = -1 if i % 2 else 1
        if r.random() < leafy:
            K.blob(f'{name}_leaf{i}', px_ + side * 3.2, py - 1, 3.4, 2.4, mat('leaves'), 15, d=d + 1, rd=2,
                   segments=8, rings=4)
        if r.random() < bloom:
            K.blob(f'{name}_bloom{i}', px_ - side * 2.5, py + 1, 2.2, 2.2, mat('bloom'), 16, d=d + 2, segments=8,
                   rings=4)


def idol_head(k, name, cx, cy, s, d, group, tilt=0.0, eyes='jade', moss=0.0, seed=0):
    """
    A carved stone head, chibi and blunt: helmet, heavy brow, round eyes, a broad nose,
    thick lips and ear spools. `s` is its radius; everything stays inside a circle of
    about 1.1 s round (cx, cy), so its silhouette is one round mass. `tilt` in radians.
    """
    mat = k.mat
    c, sn = math.cos(tilt), math.sin(tilt)

    def at(u, v):
        return (cx + u * c - v * sn, cy + u * sn + v * c)

    K.blob(f'{name}_skull', cx, cy, s, s * 0.95, mat('stone'), group, d=d, rd=s * 0.8)
    hx, hy = at(0, -s * 0.52)
    K.blob(f'{name}_helm', hx, hy, s * 1.02, s * 0.5, mat('stone'), group + 1, d=d + s * 0.08, rd=s * 0.82)
    bx, by = at(0, -s * 0.16)
    K.blob(f'{name}_brow', bx, by, s * 0.78, s * 0.14, mat('stone'), group + 1, d=d + s * 0.72, rd=s * 0.2)
    for side in (-1, 1):
        ex, ey = at(side * s * 0.36, s * 0.04)
        K.blob(f'{name}_eye{side}', ex, ey, s * 0.17, s * 0.15, mat(eyes), group + 2, d=d + s * 0.74, rd=s * 0.1,
               segments=12, rings=6)
        ox_, oy_ = at(side * s * 0.98, s * 0.12)
        K.blob(f'{name}_ear{side}', ox_, oy_, s * 0.2, s * 0.24, mat('jade'), group + 2, d=d + s * 0.1, rd=s * 0.2,
               segments=12, rings=6)
    nx, ny = at(0, s * 0.26)
    K.blob(f'{name}_nose', nx, ny, s * 0.24, s * 0.2, mat('stone'), group + 1, d=d + s * 0.8, rd=s * 0.22)
    mx, my = at(0, s * 0.58)
    K.blob(f'{name}_lips', mx, my, s * 0.42, s * 0.13, mat('stone'), group + 1, d=d + s * 0.66, rd=s * 0.2)
    if moss > 0:
        r = K.rng(seed)
        for i in range(int(6 * moss) + 2):
            a = r.uniform(-2.6, -0.6)
            u, v = math.cos(a) * s * 0.9, math.sin(a) * s * 0.9
            px_, py = at(u, v)
            moss_clump(k, f'{name}_moss{i}', px_, py, s * r.uniform(0.4, 0.6), d + s * 0.55, group + 3,
                       seed=seed * 10 + i)


def moss_clump(k, name, x, y, w, d, group, seed=0):
    """
    A lumpy cushion of moss about `w` px wide centred on (x, y): a flat dark mat with
    small bumps of different sizes on top, so it reads as moss and not as one shiny
    pill (a lone ellipsoid takes a highlight and an outline and looks like a capsule).
    """
    mat = k.mat
    r = K.rng(seed)
    K.blob(f'{name}_mat', x, y + 1, w * 0.55, max(2.5, w * 0.16), mat('moss'), group, d=d - 1, rd=3, segments=12,
           rings=6)
    n = max(3, int(w / 4))
    for i in range(n):
        bx = x - w * 0.45 + w * 0.9 * (i + 0.5) / n + r.uniform(-1, 1)
        br = r.uniform(2.2, 3.6)
        K.blob(f'{name}_b{i}', bx, y - br * 0.4 + r.uniform(-1, 1), br, br * 0.8, mat('moss'), group, d=d + r.uniform(0, 1),
               rd=2, segments=8, rings=4)


def giant_tree(k, name, x, ground_y, trunk_r, side, seed, strangler=False):
    """
    A jungle giant on a flank: a trunk that leaves the top of the map, plank buttress
    roots fanning out over the floor, bark ridges, a crown of big lobes up top and
    lianas hanging from it. `side` is -1 on the left edge, 1 on the right (the crown
    and the lianas lean in over the map).
    """
    mat = k.mat
    r = K.rng(seed)
    top = -60
    lean = -side * 26
    trunk = [(x, ground_y + 20, -6), (x + lean * 0.3, ground_y - 200, -6), (x + lean * 0.8, 250, -6),
             (x + lean, top, -6)]
    K.tube(f'{name}_trunk', trunk, trunk_r, mat('bark'), 19, taper=0.72, resolution=4)
    # Bark ridges: thin tubes up the trunk's face, inside its silhouette.
    for i, u in enumerate((-0.55, -0.2, 0.15, 0.5)):
        pts = [(tx + u * trunk_r * (1 - 0.28 * j / 3) + math.sin(j * 1.7 + i) * 2, ty, trunk_r * 0.72 - 6)
               for j, (tx, ty, _) in enumerate(trunk)]
        K.tube(f'{name}_ridge{i}', pts, 2.4, mat('bark'), 20, taper=0.7, resolution=1)
    if strangler:
        # A strangler fig: roots braided round the host trunk from the crown down.
        for i in range(5):
            pts = []
            for j in range(14):
                t = j / 13
                tx, ty = x + lean * (1 - t) * 0.9, top + (ground_y + 10 - top) * t
                pts.append((tx + math.sin(t * 9 + i * 1.3) * trunk_r * (0.55 + 0.35 * t), ty,
                            trunk_r * 0.5 + (i % 2) * 4))
            K.tube(f'{name}_strand{i}', pts, 4.5 + 2.5 * (i % 2), mat('bark'), 20 + i % 2, taper=1.4, resolution=2)
    # Buttress roots: thin plank fins, a concave curve from high on the trunk down to
    # the floor. Seen square on, each is a triangle with a sagging hypotenuse.
    for i, (dirn, reach, height, dd) in enumerate(((-1, 1.9, 2.4, -2), (1, 2.3, 2.9, 2), (-1, 3.2, 1.7, 5),
                                                  (1, 3.5, 1.5, -4), (1, 1.6, 3.4, 8), (-1, 1.3, 3.0, 9))):
        top_y = ground_y - trunk_r * height
        foot = x + dirn * trunk_r * reach
        pts = [(x + dirn * trunk_r * 0.2, top_y - 4)]
        for j in range(1, 10):
            t = j / 10
            # A concave sweep: steep from the trunk, flattening onto the floor.
            px_ = x + dirn * (trunk_r * 0.6 + (trunk_r * reach - trunk_r * 0.6) * t)
            py = top_y + (ground_y - top_y) * (1 - (1 - t) ** 2.2)
            pts.append((px_, py))
        pts += [(foot, ground_y + 4), (foot - dirn * 6, ground_y + 22), (x, ground_y + 26)]
        K.prism(f'{name}_fin{i}', pts, dd - 4, dd + 4, mat('bark'), 19 + i % 2, bevel=2.0)
        # A lit ridge along the top edge of the fin.
        K.tube(f'{name}_finlip{i}', [(px_, py - 1.5, dd + 3.5) for px_, py in pts[1:9]], 2.0, mat('bark'), 20 - i % 2,
               resolution=1)
    # The crown: big overlapping lobes at the top of the map.
    cx = x + lean * 0.9 + side * -60
    for i in range(16):
        lx = cx + r.uniform(-190, 190)
        ly = r.uniform(-20, 170) + abs(lx - cx) * 0.25
        lr = r.uniform(44, 70)
        K.blob(f'{name}_crown{i}', lx, ly, lr, lr * 0.78, mat('leaves'), 21 + i % 2, d=r.uniform(-20, 20), rd=lr * 0.7)
    # Lianas: loops hanging from the crown towards the trunk, over the flank only.
    for i in range(2):
        a0 = (x + lean * 0.9 + side * -(70 + 60 * i), 200 + 20 * i)
        a1 = (x + lean * 0.6 + side * trunk_r * 0.3, 300 + 50 * i)
        sag = 50 + 30 * i
        pts = []
        for j in range(11):
            t = j / 10
            px_ = a0[0] + (a1[0] - a0[0]) * t
            py = a0[1] + (a1[1] - a0[1]) * t + sag * math.sin(math.pi * t)
            pts.append((px_, py, 12 + i))
        K.tube(f'{name}_liana{i}', pts, 2.4, mat('bark'), 24, resolution=1)
        for j, (px_, py, _) in enumerate(pts[1:-1]):
            K.blob(f'{name}_lianaleaf{i}_{j}', px_ + 3, py + 2, 4, 2.6, mat('leaves'), 25, d=16 + i, rd=2,
                   segments=8, rings=4)
    if not strangler:
        # Shelf fungi stepping up the trunk's lit side, in clay orange.
        for i, (fy, fr) in enumerate(((ground_y - 70, 13), (ground_y - 92, 10), (ground_y - 230, 11))):
            t = (ground_y + 20 - fy) / (ground_y + 20 - top)
            edge = x + lean * t * 0.8 - trunk_r * (1 - 0.28 * t) * 0.96
            K.blob(f'{name}_fungus{i}', edge + 2, fy, fr, fr * 0.36, mat('clay'), 23, d=trunk_r * 0.4, rd=fr * 0.7,
                   segments=14, rings=6)
    # Epiphytes on the trunk: little leaf rosettes, inside the silhouette.
    for i in range(5):
        ey = ground_y - 140 - i * 90
        ex = x + lean * (1 - ey / ground_y) * 0.4 + r.uniform(-0.4, 0.4) * trunk_r
        for j in range(4):
            a = -math.pi / 2 + (j - 1.5) * 0.55
            K.blob(f'{name}_epi{i}_{j}', ex + math.cos(a) * 7, ey + math.sin(a) * 5, 7, 3, mat('moss'), 23,
                   d=trunk_r * 0.8, rd=3, segments=8, rings=4)


# ---------------------------------------------------------------------------------
# Terrain
# ---------------------------------------------------------------------------------

@M.terrain
def terrain(k):
    mat = k.mat
    ground = profile()
    r = K.rng(1)

    # The body and the strata. The soil drapes over the floor; clay and limestone lie
    # nearly level below it, broken into lenses.
    K.ground('slab', ground, mat('soil'), 1, depth=90)
    K.stratum('topsoil', ground, 6, 20, mat('soil'), 2, follow=1.0, seed=2, pinch=0.0, min_cover=6)
    K.stratum('clay', ground, 118, 40, mat('clay'), 3, follow=0.4, datum=FLOOR, dip=0.02, seed=3, pinch=0.35,
              min_cover=100)
    K.stratum('lime', ground, 180, 44, mat('stone'), 4, follow=0.2, datum=FLOOR, dip=-0.03, seed=4, pinch=0.45,
              min_cover=150)
    for i, (px0, px1, lvl, th, m) in enumerate(((60, 330, 70, 22, 'clay'), (1560, 1850, 80, 24, 'clay'),
                                               (180, 420, 170, 26, 'stone'), (1480, 1720, 160, 22, 'stone'))):
        K.stratum(f'pocket{i}', ground, lvl, th, mat(m), 3 if m == 'clay' else 4, follow=0.9, seed=20 + i, pinch=0.0,
                  x0=px0, x1=px1, min_cover=40)
    w_deep = K.wobble(7, 16, 280)
    deep = [(x, max(y + 190, 0.25 * (y + 290) + 0.75 * (FLOOR + 270 - 0.04 * (x - 950)) + w_deep(x)))
            for x, y in ground]
    K.ground('bedrock', deep, mat('bedrock'), 5, depth=40, d_front=2.5)

    # Pebbles in the soil and boulders in the bedrock.
    for i in range(130):
        x = r.uniform(0, k.width)
        below = r.uniform(30, 260)
        y = K.height_at(ground, x) + below
        if T0[0] - 10 < x < T0[1] + 10 and y < T0[3] + 8:
            continue
        K.rock(f'pebble{i}', x, y, r.uniform(3, 6) + below / 90, mat('stone'), 6, d=2.5, seed=100 + i,
               squash=(1.2, 0.5, 0.85))
    for i in range(40):
        x = r.uniform(0, k.width)
        y = K.height_at(deep, x) + r.uniform(20, 280)
        if y > k.height + 10:
            continue
        K.rock(f'boulder{i}', x, y, r.uniform(9, 22), mat('stone'), 6, d=3.5, seed=400 + i, squash=(1.3, 0.45, 0.9))

    # Roots everywhere in the jungle soil: short ones under the floor, and the giants'
    # roots diving deep from the flanks.
    for i in range(46):
        x = r.uniform(10, k.width - 10)
        if T0[0] - 5 < x < T0[1] + 5:
            continue
        y0 = K.height_at(ground, x) + 10
        length = r.uniform(18, 46)
        drift = r.uniform(-12, 12)
        pts = [(x + drift * t * t + math.sin(t * 5 + i) * 2.5, y0 + length * t, 3.0) for t in (0, 0.33, 0.66, 1.0)]
        K.tube(f'root{i}', pts, 2.2, mat('bark'), 7, taper=0.45, resolution=2)
    for i, (x, dirn, length, rad) in enumerate(((70, 1, 260, 7), (140, 1, 210, 5.5), (30, -1, 160, 5),
                                               (1830, -1, 250, 7), (1760, -1, 200, 5.5), (1880, 1, 150, 5))):
        y0 = K.height_at(ground, x) + 8
        pts = [(x + dirn * (length * 0.55) * (t ** 1.6) + math.sin(t * 6 + i) * 6, y0 + length * t, 3.0)
               for t in [j / 8 for j in range(9)]]
        K.tube(f'bigroot{i}', pts, rad, mat('bark'), 7, taper=0.3, resolution=2)

    ziggurat(k)
    sanctuary(k)
    rubble(k)

    # The jungle floor's mossy edge, walkable by construction, left bare where the
    # temple and the trees stand on it.
    for i, (a, b) in enumerate(((-20, 443), (1482, 1925))):
        K.grass_edge(f'grass{i}', K.clip(ground, a, b), mat('moss'), (8, 12), radius=8, hem=13, seed=5 + i,
                     flowers_mats=[mat('bloom'), mat('glow'), mat('bone')])
    for x in range(10, k.width - 10, 15):
        if abs(K.slope_at(ground, x, span=10)) > 0.55 and K.rng(x).random() < 0.7:
            K.tuft(f'tuft{x}', x, K.height_at(ground, x) - 6, mat('moss'), 12, r=K.rng(x), size=1.4, d=3)

    giant_tree(k, 'kapok', 72, K.height_at(ground, 72) + 4, 40, -1, 50)
    giant_tree(k, 'fig', 1852, K.height_at(ground, 1852) + 4, 36, 1, 60, strangler=True)
    jungle_floor(k)
    buried(k)


def tier_top(k, name, x0, x1, top, d, seed, moss_runs):
    """A tier's coping and the moss on it: walkable, the moss never over 1 px proud."""
    mat = k.mat
    K.box(f'{name}_coping', x0, top, x1, top + 7, d - 6, d + 3.5, mat('stone'), 11, bevel=2.2)
    for i, (a, b) in enumerate(moss_runs):
        line = [(x, top + 4) for x in range(int(a), int(b) + 1, 4)]
        K.grass_edge(f'{name}_moss{i}', line, mat('moss'), (12, 13), radius=5, hem=12, seed=seed + i,
                     flowers_mats=[mat('bloom'), mat('glow')])


def tier_face(k, name, i, a, b, t, d, below, seed):
    """
    One tier's front, Mesoamerican talud-tablero: under the coping a *tablero*, an
    upright framed frieze whose recess sits in the frame's shadow, with carved panels
    and round shields in it; under that a *talud*, a battered base of dressed blocks
    leaning back, which the light picks out a step lighter. Three values per tier, the
    rhythm that makes a stepped pyramid read at 1x.
    """
    mat = k.mat
    r = K.rng(seed)
    h = below - t
    tab0, tab1 = t + 7, t + 7 + round((h - 7) * 0.56)
    # The talud: a leaning slab with blocks on it.
    K.leaning_box(f'{name}_talud', a, b, tab1, below, d, d + 7, d - 20, mat('stone'), 8)
    masonry(k, f'{name}_tb', a + 1, b - 1, tab1 + 1, below, d, seed=seed + 1, row_h=(below - tab1 - 1) / 2,
            broken=0.07, lean=7, width=(26, 44), groups=(9, 10))
    # The tablero: a recess of darker, lichen-grown stone, then the frame proud of it.
    K.box(f'{name}_recess', a, tab0, b, tab1, d - 2, d + 0.5, mat('lichen'), 9)
    K.box(f'{name}_rail_hi', a, tab0, b, tab0 + 4, d, d + 4, mat('stone'), 11, bevel=1.2)
    K.box(f'{name}_rail_lo', a, tab1 - 4, b, tab1, d, d + 4, mat('stone'), 11, bevel=1.2)
    posts = [a] + [p for p in range(int(a) + 110, int(b) - 60, 118)] + [b - 6]
    for j, px_ in enumerate(posts):
        K.box(f'{name}_post{j}', px_, tab0, px_ + 6, tab1, d, d + 4, mat('stone'), 12, bevel=1.2)
    for j, (p0, p1) in enumerate(zip(posts, posts[1:])):
        mid = (p0 + p1 + 6) / 2
        kind = (j + i) % 3
        if kind == 0:
            glyph_panel(k, f'{name}_panel{j}', mid - 24, mid + 24, tab0 + 5, tab1 - 5, d, seed=seed + 10 + j)
        # Round shields along the recess, jade-bossed now and then.
        for q in range(-2, 3):
            sx = mid + q * 22
            if kind == 0 and abs(q) < 2:
                continue
            if sx < p0 + 12 or sx > p1 - 6:
                continue
            K.log(f'{name}_shield{j}_{q}', sx, (tab0 + tab1) / 2, (tab1 - tab0) * 0.27, d - 1, d + 2.4,
                  mat('stone'), 10 + (q % 2), vertices=14)
            if r.random() < 0.25:
                K.log(f'{name}_boss{j}_{q}', sx, (tab0 + tab1) / 2, 2.2, d + 2, d + 3.4, mat('jade'), 13, vertices=8)


def ziggurat(k):
    """The three tiers on their buried foundation, each dressed and draped."""
    mat = k.mat
    r = K.rng(8)
    x0, x1, top, bottom, d0 = T0
    # The foundation: two buried steps of darker, lichen-grown stone, roots down them.
    # The soil has got in between the blocks, so the core is soil and the gaps show it.
    K.box('t0_core', x0 + 22, top, x1 - 22, top + 44, d0 - 60, d0, mat('soil'), 8)
    K.box('t0_core2', x0, top + 44, x1, bottom, d0 - 60, d0, mat('soil'), 8)
    masonry(k, 't0a', x0 + 23, x1 - 23, top + 1, top + 44, d0, seed=80, row_h=22, broken=0.2, material='lichen',
            width=(26, 60))
    masonry(k, 't0b', x0 + 1, x1 - 1, top + 45, bottom - 1, d0, seed=79, row_h=22, broken=0.28, material='lichen',
            width=(26, 60))
    for i in range(16):
        x = r.uniform(x0 + 30, x1 - 30)
        y0 = FLOOR + 4
        length = r.uniform(30, 80)
        drift = r.uniform(-16, 16)
        pts = [(x + drift * t * t + math.sin(t * 4 + i) * 3, y0 + length * t, d0 + 4) for t in (0, 0.3, 0.6, 1.0)]
        K.tube(f'foundroot{i}', pts, 2.6, mat('bark'), 16, taper=0.4, resolution=2)
    # (name, x0, x1, top, front d, bottom of the band that shows)
    tiers = [('t1', *T1, FLOOR), ('t2', *T2, T1[2]), ('t3', *T3, T2[2])]
    for i, (name, a, b, t, d, below) in enumerate(tiers):
        # The core runs down into the foundation; only the band above the next lower
        # tier's top is seen, and that is what gets dressed.
        if name == 't2':
            # Its right end broke off: the top corner is gone in a ragged diagonal.
            poly = [(a, t + 3), (T2_BREAK, t + 3), (T2_BREAK + 10, t + 12), (b - 6, t + 20), (b, t + 34), (b, FLOOR + 4),
                    (a, FLOOR + 4)]
            K.prism(f'{name}_core', poly, d - 70, d, mat('stone'), 8, bevel=1.5)
        else:
            K.box(f'{name}_core', a, t + 3, b, FLOOR + 4, d - 70, d, mat('stone'), 8, bevel=1.5)
        tier_face(k, name, i, a, T2_BREAK if name == 't2' else b, t, d, below, seed=81 + 20 * i)
    tier_top(k, 't1', T1[0], T1[1], T1[2], T1[3], 30, ((T1[0] + 4, 500), (620, 700), (1010, 1080), (1240, T1[1] - 4)))
    tier_top(k, 't2', T2[0], T2_BREAK, T2[2], T2[3], 33, ((T2[0] + 3, 600), (700, 760), (1050, 1130), (1250, T2_BREAK - 4)))
    tier_top(k, 't3', T3[0], T3[1], T3[2], T3[3], 36, ((T3[0] + 3, 790), (1110, T3[1] - 3)))
    # Serpent heads at the foot of the balustrades, carved on the lowest tier's face.
    staircase(k)
    # Two sealed doorways in the lowest tier and two calendar stones: the big shapes
    # that break the frieze's rhythm, one pair either side of the stair.
    for i, dx in enumerate((606, 1296)):
        doorway(k, f'door{i}', dx, T1[2] + 12, FLOOR, T1[3])
    for i, (cx, cy, rr, d) in enumerate(((742, T2[2] + 27, 21, T2[3]), (1160, T3[2] + 28, 20, T3[3]))):
        calendar_stone(k, f'calendar{i}', cx, cy, rr, d + 4)
    # Vines down the faces, in curtains: from each tier's lip, inside its silhouette,
    # ending above the ledge below (they hang over the face, not through the next step).
    for i in range(16):
        _, a, b, t, d, below = r.choice(tiers)
        x = r.uniform(a + 14, (T2_BREAK if _ == 't2' else b) - 24)
        if STAIR[0] - 30 < x < STAIR[1] + 12:
            continue
        for j in range(r.choice((1, 2, 3))):
            vine(k, f'vine{i}_{j}', x + j * 7, t + 5, min(r.uniform(24, 60), below - t - 8), seed=500 + 7 * i + j,
                 d=d + 8, sway=r.uniform(2, 5))


def doorway(k, name, x, top, bottom, d):
    """A sealed doorway: dark stone fill under a heavy lintel, jambs either side."""
    mat = k.mat
    w = 30
    K.box(f'{name}_fill', x - w / 2, top + 6, x + w / 2, bottom, d + 1, d + 5, mat('bedrock'), 16)
    for side in (-1, 1):
        K.box(f'{name}_jamb{side}', x + side * (w / 2 + 3) - 4, top + 4, x + side * (w / 2 + 3) + 4, bottom, d + 1,
              d + 8, mat('stone'), 17, bevel=1.2)
    K.box(f'{name}_lintel', x - w / 2 - 9, top - 2, x + w / 2 + 9, top + 7, d + 1, d + 9, mat('stone'), 18, bevel=1.5)
    K.log(f'{name}_glyph', x, top + 2.5, 3, d + 9, d + 10.5, mat('jade'), 19, vertices=10)


def calendar_stone(k, name, x, y, r, d):
    """A round carved stone: a rim, a ring of studs, a face in the middle."""
    mat = k.mat
    K.log(f'{name}_disc', x, y, r, d - 4, d + 2, mat('stone'), 16, vertices=24)
    K.log(f'{name}_ring', x, y, r * 0.72, d + 2, d + 3.2, mat('stone'), 17, vertices=24)
    for i in range(10):
        a = math.tau * i / 10
        K.log(f'{name}_stud{i}', x + math.cos(a) * r * 0.86, y + math.sin(a) * r * 0.86, 1.8, d + 2, d + 3.5,
              mat('stone'), 18, vertices=8)
    K.log(f'{name}_face', x, y, r * 0.4, d + 3.2, d + 4.6, mat('stone'), 18, vertices=16)
    for side in (-1, 1):
        K.log(f'{name}_eye{side}', x + side * r * 0.15, y - r * 0.08, 1.8, d + 4.6, d + 5.4, mat('jade'), 19,
              vertices=8)


def staircase(k):
    """
    The grand stair up the middle of the front, from the jungle floor to the gallery's
    floor: treads that step out towards the camera as they come down, so each one's
    nose catches the light, between two sloping balustrades that end in feathered
    serpent heads on the floor. It is all inside the tiers' silhouette: a face, not a
    path, but the vertical that stops the tiers reading as stripes.
    """
    mat = k.mat
    x0, x1 = STAIR
    top, bottom = T3[2], FLOOR
    n = 20
    rise = (bottom - top) / n
    for i in range(n):
        y = top + i * rise
        d = T3[3] + 3 + 16 * (i + 1) / n
        K.box(f'stair{i}', x0, y, x1, y + rise + 0.5, d - 12, d, mat('stone'), 9 + i % 2, bevel=1.1)
    for i, (a, b) in enumerate(((x0 - 14, x0), (x1, x1 + 14))):
        # Flush with the gallery floor at the top: the stair heads into the gallery,
        # and anything standing proud there would be a kerb in the tunnel.
        K.leaning_box(f'balus{i}', a, b, top + 1, bottom, T3[3] + 6, T3[3] + 24, T3[3] - 20, mat('stone'), 11,
                      bevel=1.5)
        K.box(f'balus{i}_cap', a - 1, top + 1, b + 1, top + 8, T3[3] - 2, T3[3] + 9, mat('stone'), 12, bevel=1.5)
    vine(k, 'balus_vine0', x0 - 7, top + 2, 70, seed=851, d=T3[3] + 26, sway=3)
    vine(k, 'balus_vine1', x1 + 7, top + 30, 50, seed=852, d=T3[3] + 26, sway=3)
    for i, sx in enumerate((x0 - 20, x1 + 20)):
        serpent(k, f'snake{i}', sx, bottom - 15, T3[3] + 22, -1 if i == 0 else 1)


def glyph_panel(k, name, x0, x1, y0, y1, d, seed):
    """A sunk panel with a carved glyph: a frame, a round cartouche, two dots and bars."""
    mat = k.mat
    r = K.rng(seed)
    K.box(f'{name}_frame', x0, y0, x1, y1, d - 3, d + 2.5, mat('stone'), 10, bevel=1.5)
    K.box(f'{name}_sink', x0 + 3, y0 + 3, x1 - 3, y1 - 3, d - 3, d + 1.0, mat('stone'), 9)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    rr = min(x1 - x0, y1 - y0) * 0.32
    K.blob(f'{name}_cart', cx, cy, rr, rr * 0.9, mat('stone'), 11, d=d + 1, rd=2.5)
    K.blob(f'{name}_eye', cx - rr * 0.3, cy - rr * 0.15, rr * 0.25, rr * 0.25, mat('jade' if r.random() < 0.4 else 'stone'),
           12, d=d + 3.2, rd=1.2, segments=10, rings=5)
    for i in range(2):
        K.box(f'{name}_bar{i}', x0 + 6, y1 - 8 - i * 5 + 0.5, x1 - 6, y1 - 5 - i * 5, d, d + 3, mat('stone'), 12,
              bevel=0.8)


def serpent(k, name, x, y, d, facing):
    """
    A feathered serpent's head at the foot of a balustrade, looking out along the floor:
    a round skull, a long blunt snout over an open jaw with fangs, a jade eye under a
    heavy brow, and a crest of jade feathers swept back and up.
    """
    mat = k.mat
    f = facing
    K.blob(f'{name}_skull', x, y - 2, 16, 13, mat('stone'), 12, d=d + 4, rd=10)
    K.prism(f'{name}_snout', [(x + 4 * f, y - 12), (x + 26 * f, y - 9), (x + 32 * f, y - 4), (x + 31 * f, y + 3),
                              (x + 4 * f, y + 3)], d + 2, d + 12, mat('stone'), 13, bevel=2)
    K.box(f'{name}_mouth', min(x + 6 * f, x + 28 * f), y + 3, max(x + 6 * f, x + 28 * f), y + 6, d + 3, d + 10,
          mat('bedrock'), 14)
    K.prism(f'{name}_jaw', [(x + 2 * f, y + 6), (x + 26 * f, y + 6), (x + 24 * f, y + 12), (x + 2 * f, y + 13)],
            d + 2, d + 11, mat('stone'), 13, bevel=1.5)
    for j, fx in enumerate((x + 22 * f, x + 14 * f)):
        K.prism(f'{name}_fang{j}', [(fx - 2, y + 3), (fx + 2, y + 3), (fx, y + 9)], d + 10, d + 12, mat('bone'), 15)
    K.blob(f'{name}_brow', x + 6 * f, y - 11, 8, 3.5, mat('stone'), 14, d=d + 13, rd=3)
    K.blob(f'{name}_eye', x + 7 * f, y - 6, 3.6, 3.4, mat('jade'), 15, d=d + 13, rd=2, segments=10, rings=5)
    K.blob(f'{name}_nostril', x + 27 * f, y - 5, 2.2, 1.8, mat('bedrock'), 15, d=d + 12.5, rd=1, segments=8, rings=4)
    for j in range(4):
        # Feathers from the back of the skull, swept back and curling up.
        bx, by = x - 6 * f, y - 10 + j * 5
        K.tube(f'{name}_plume{j}', [(bx, by, d + 8), (bx - (10 + 2 * j) * f, by - 6 - j, d + 8),
                                    (bx - (16 + 3 * j) * f, by - 16 - 2 * j, d + 8)], 3.0, mat('jade'), 16 + j % 2,
               taper=0.35, resolution=1)


def sanctuary(k):
    """
    The gateway on top: a block of carved stone with a corbel-vaulted gallery clean
    through it (the one covered place on the map), a frieze of drums and frets, and a
    roof comb crowned by the temple's big mask.
    """
    mat = k.mat
    x0, x1, roof = SANCT
    ceiling = gallery_ceiling()
    body = [(x0, roof), (x1, roof)] + list(reversed(ceiling))
    K.prism('sanct_body', body, -70, -1, mat('stone'), 8, bevel=1.5)
    # The floor of the gallery: tier 3 runs through it (T3 spans the sanctuary). A worn
    # threshold at each mouth.
    for i, (a, b) in enumerate(((x0 - 6, x0 + 20), (x1 - 20, x1 + 6))):
        K.box(f'sanct_sill{i}', a, GALLERY_FLOOR - 1, b, GALLERY_FLOOR + 6, T3[3] - 4, T3[3] + 4, mat('stone'), 11,
              bevel=1.5)
    # Jambs: the corbel steps are dressed blocks, one per course, proud of the body.
    for (cx, cy), (nx, ny) in zip(ceiling, ceiling[1:]):
        if cy == ny and abs(nx - cx) < 60:
            K.box(f'sanct_corbel{int(cx)}', min(cx, nx) + 0.8, cy - 8, max(cx, nx) - 0.8, cy - 0.5, -2, 3, mat('stone'),
                  9 + int(cx) % 2, bevel=1.2)
    # The facade, Puuc style: a cornice, an upper frieze of step-frets between two
    # mouldings with a rain-god mask at each end, and a lower wall of drums
    # (colonnettes) down to the lintel, which the vault cuts at the centre.
    K.box('sanct_cornice', x0 - 4, roof, x1 + 4, roof + 9, -2, 7, mat('stone'), 10, bevel=2)
    K.box('sanct_mould_hi', x0 - 1, roof + 12, x1 + 1, roof + 18, 0, 5, mat('stone'), 11, bevel=1.5)
    K.box('sanct_mould_mid', x0 - 1, roof + 46, x1 + 1, roof + 52, 0, 5, mat('stone'), 11, bevel=1.5)
    for i, (a, b) in enumerate(((x0, x0 + 26), (x1 - 26, x1))):
        K.box(f'sanct_lintel{i}', a, 530, b, 538, 0, 5, mat('stone'), 11, bevel=1.5)
    fx = x0 + 34
    i = 0
    while fx < x1 - 44:
        # A step-fret: a stepped Z in relief, alternating with a plain block.
        y0, y1 = roof + 21, roof + 44
        if i % 2 == 0:
            K.prism(f'sanct_fret{i}', [(fx, y1), (fx, y0 + 8), (fx + 8, y0 + 8), (fx + 8, y0), (fx + 26, y0),
                                       (fx + 26, y0 + 6), (fx + 14, y0 + 6), (fx + 14, y0 + 14), (fx + 6, y0 + 14),
                                       (fx + 6, y1)], 0, 4, mat('stone'), 12, bevel=0.8)
        else:
            K.box(f'sanct_x{i}', fx + 3, y0 + 3, fx + 23, y1 - 3, 0, 3, mat('stone'), 13, bevel=1)
            K.log(f'sanct_xboss{i}', fx + 13, (y0 + y1) / 2, 4, 3, 5, mat('jade'), 14, vertices=10)
        fx += 30
        i += 1
    for i, mx in enumerate((x0 + 16, x1 - 16)):
        # Rain-god masks stacked on the corners: a brow, two eyes, a curled snout.
        K.box(f'chaac{i}_brow', mx - 13, roof + 21, mx + 13, roof + 27, 2, 7, mat('stone'), 12, bevel=1)
        for side in (-1, 1):
            K.blob(f'chaac{i}_eye{side}', mx + side * 6, roof + 31, 4, 3.4, mat('stone'), 13, d=7, rd=2, segments=10,
                   rings=5)
            K.blob(f'chaac{i}_pupil{side}', mx + side * 6, roof + 31, 1.8, 1.8, mat('jade'), 14, d=9, rd=1,
                   segments=8, rings=4)
        K.tube(f'chaac{i}_snout', [(mx, roof + 33, 8), (mx, roof + 40, 9), (mx + (4 if i else -4), roof + 43, 9)], 3,
               mat('stone'), 12, resolution=1)
    # A brazier at each mouth, still burning: gold bowls with a flame, the warm spots
    # that pull the eye to the gallery.
    for i, bx in enumerate((x0 + 14, x1 - 14)):
        K.lathe(f'brazier{i}', bx, 8, [(3, 527), (9, 521), (8, 518)], mat('gold'), 15, segments=12)
        K.blob(f'brazier{i}_flame', bx, 512, 5.5, 7.5, mat('glow'), 16, d=10, rd=3, segments=12, rings=6)
        K.blob(f'brazier{i}_core', bx, 515, 2.5, 3.5, mat('bone'), 17, d=14, rd=2, segments=8, rings=4)
    x = x0 + 30
    i = 0
    while x < x1 - 36:
        ceil_y = K.height_at(ceiling, x + 4)
        y_lo = min(529, ceil_y - 2)
        if y_lo - (roof + 54) > 6:
            K.cylinder(f'sanct_drum{i}', x + 4, roof + 54, y_lo, 3.4, mat('stone'), 12 + i % 2, d=2, vertices=10)
            for q in range(int((y_lo - roof - 54) // 9)):
                K.box(f'sanct_band{i}_{q}', x, roof + 58 + q * 9, x + 8, roof + 60 + q * 9, 4, 6, mat('stone'), 13)
        x += 11
        i += 1
    # Vines from the cornice over the frieze, stopping above the gallery.
    r = K.rng(12)
    for i in range(7):
        vx = r.uniform(x0 + 10, x1 - 10)
        length = K.height_at(ceiling, vx) - roof - 14
        vine(k, f'sanct_vine{i}', vx, roof + 4, max(10, length * r.uniform(0.5, 0.95)), seed=600 + i, d=9, sway=3)
    roof_comb(k)


def roof_comb(k):
    """The crest over the sanctuary: stepped, pierced by nothing, with the big mask."""
    mat = k.mat
    x0, x1, roof = SANCT
    cx = (x0 + x1) / 2
    # Stepped outline, a pointed cap at the top so the crest is no place to stand.
    steps = [(78, 0), (70, 22), (60, 44), (48, 66), (34, 84)]
    left = []
    for i, (half, h) in enumerate(steps):
        left.append((cx - half, roof - h))
        if i + 1 < len(steps):
            left.append((cx - half, roof - steps[i + 1][1]))
    left.append((cx - 20, roof - 96))
    right = [(2 * cx - x, y) for x, y in reversed(left)]
    poly = left + [(cx, roof - 112)] + right
    K.prism('comb_body', poly, -40, -4, mat('stone'), 8, bevel=1.5)
    for i, (half, h) in enumerate(steps[:-1]):
        K.box(f'comb_ledge{i}', cx - half, roof - h - 5, cx + half, roof - h, -4, 1, mat('stone'), 10 + i % 2, bevel=1.2)
    masonry(k, 'comb', cx - 76, cx + 76, roof - 20, roof, -4, seed=90, row_h=10, broken=0.0, groups=(9, 10))
    # The mask, big and chibi, with glowing eyes.
    idol_head(k, 'mask', cx, roof - 48, 30, -12, 15, eyes='glow', moss=0.5, seed=91)
    # A headdress of jade plumes fanned over it, inside the crest's outline.
    for i in range(5):
        a = math.radians(-150 + i * 30)
        px_, py = cx + math.cos(a) * 36, roof - 60 + math.sin(a) * 30
        K.blob(f'comb_plume{i}', px_, py, 10, 5, mat('jade'), 19 + i % 2, d=12, rd=4)
    K.blob('comb_gem', cx, roof - 88, 6, 6, mat('gold'), 21, d=12, rd=4, segments=12, rings=6)


def rubble(k):
    """
    The collapsed right corner: tier 2's end broke and tier 1 is gone below it, so
    fallen blocks and a toppled idol head slope down to the floor, and a strangler fig
    has grown out of the heap, its roots poured over the stone. A wall, not a path,
    and cover for whoever starts on the right floor.
    """
    mat = k.mat
    r = K.rng(14)
    # A heap under the blocks, so the slope reads solid.
    heap = [(1386, 684), (1400, 690), (1430, 708), (1460, 730), (1482, 750), (1494, 766), (1386, 790)]
    K.prism('rubble_heap', heap, -30, 6, mat('lichen'), 3, bevel=3)
    blocks = [(1396, 694, 26, 16, 0.25), (1414, 712, 30, 16, -0.3), (1400, 726, 24, 18, 0.1),
              (1446, 726, 26, 15, 0.45), (1428, 742, 32, 16, -0.12), (1466, 748, 24, 14, 0.35),
              (1452, 756, 28, 13, 0.05), (1480, 758, 16, 10, -0.4), (1410, 752, 26, 14, 0.2)]
    for i, (bx, by, bw, bh, a) in enumerate(blocks):
        c, s = math.cos(a), math.sin(a)
        corners = [(-bw / 2, -bh / 2), (bw / 2, -bh / 2), (bw / 2, bh / 2), (-bw / 2, bh / 2)]
        poly = [(bx + u * c - v * s, by + u * s + v * c) for u, v in corners]
        K.prism(f'rubble{i}', poly, -8 + r.uniform(-3, 3), 9 + r.uniform(0, 6), mat('stone'), 9 + i % 2, bevel=2.2)
        if i % 3 == 1:
            # A carved face on some of them: the frieze they fell from.
            K.log(f'rubble{i}_shield', bx, by, bh * 0.3, 14, 17, mat('stone'), 11, vertices=12)
    # Slumped blocks at the broken end of tier 2, out of true.
    for i, (bx, by, a) in enumerate(((1378, 664, 0.3), (1390, 676, -0.25))):
        c, s = math.cos(a), math.sin(a)
        poly = [(bx + u * c - v * s, by + u * s + v * c) for u, v in ((-12, -7), (12, -7), (12, 7), (-12, 7))]
        K.prism(f'slump{i}', poly, -2, 10, mat('stone'), 10 + i % 2, bevel=1.8)
    # The toppled head, on its side against the heap, moss on its crown.
    idol_head(k, 'fallen', 1426, 700, 27, 26, 15, tilt=-0.45, moss=1.0, seed=15)
    # Moss mats and ferns tucked low against tier 2's broken end. Nothing tall here:
    # this heap is what the right floor's seat lobs over, and a tree on it stopped
    # every shot (pass 3).
    for i, (mx_, my_, mr) in enumerate(((1402, 687, 22), (1446, 716, 18), (1398, 742, 18), (1474, 746, 14))):
        moss_clump(k, f'rubble_moss{i}', mx_, my_, mr, 22, 13, seed=40 + i)
    fern(k, 'rubble_fern', 1392, 742, 0.7, seed=830)
    for i in range(4):
        vine(k, f'rubble_vine{i}', r.uniform(1402, 1440), r.uniform(690, 704), r.uniform(18, 30), seed=700 + i, d=24,
             sway=3)


def jungle_floor(k):
    """
    What grows on the floor and what was left there: a carved stela and a half-buried
    idol head by the kapok, ferns and elephant-ear leaves round the trees' feet. All
    of it stands off the spawn shelves.
    """
    mat = k.mat
    ground = profile()
    # The stela: a tall slab with a rounded top and carved bands, leaning a little.
    sx = 222
    g = K.height_at(ground, sx)
    K.prism('stela', [(sx - 13, g + 10), (sx - 14, g - 60), (sx - 9, g - 70), (sx + 5, g - 72), (sx + 12, g - 64),
                      (sx + 13, g + 10)], -6, 6, mat('stone'), 10, bevel=2)
    for j in range(4):
        K.box(f'stela_band{j}', sx - 10, g - 58 + j * 14, sx + 10, g - 50 + j * 14, 6, 8, mat('stone'), 11 + j % 2,
              bevel=0.8)
    K.blob('stela_eye', sx - 2, g - 51, 3, 3, mat('jade'), 13, d=9, segments=10, rings=5)
    vine(k, 'stela_vine', sx + 8, g - 66, 50, seed=801, d=10, sway=4)
    # A small idol head sunk to the chin in the floor under the kapok.
    idol_head(k, 'buriedhead', 160, K.height_at(ground, 160) - 6, 20, 12, 15, tilt=0.18, moss=0.9, seed=16)
    # Ferns and big leaves at the trees' feet: obstacles, on the flanks only.
    for i, (fx, s) in enumerate(((120, 1.0), (190, 0.8), (1790, 0.8), (1884, 0.9))):
        fern(k, f'fern{i}', fx, K.height_at(ground, fx) + 2, s, seed=820 + i)
    for i, (lx, dirn) in enumerate(((22, 1), (1768, -1))):
        g = K.height_at(ground, lx)
        for j, (ang, length) in enumerate(((-100, 40), (-60, 34), (-135, 30))):
            a = math.radians(ang if dirn > 0 else -180 - ang)
            big_leaf(k, f'elephant{i}_{j}', lx, g + 2, length, length * 0.42, a, 16 + j * 2, seed=860 + i * 5 + j)


def big_leaf(k, name, x, y, length, width, angle, d, seed=0, blade='leaves', rib='moss', groups=(13, 14, 15)):
    """
    A big tropical leaf on a stalk from (x, y): a pointed blade (a flat prism, so the
    light splits it into a lit and a shaded half along the midrib), a midrib, a stalk.
    `angle` in radians, canvas convention (y down: -pi/2 points straight up).
    """
    mat = k.mat
    c, s_ = math.cos(angle), math.sin(angle)

    def at(u, v):
        return (x + u * c - v * s_, y + u * s_ + v * c)
    stalk = length * 0.35
    K.tube(f'{name}_stalk', [(*at(0, 0), d), (*at(stalk, 0), d)], 1.8, mat(rib), groups[0], resolution=1)
    half = []
    for j in range(9):
        t = j / 8
        half.append((stalk + length * t, width * 0.5 * math.sin(math.pi * t) ** 0.8 * (1.1 - 0.3 * t)))
    upper = [at(u, -v) for u, v in half]
    lower = [at(u, v) for u, v in reversed(half[1:-1])]
    K.prism(f'{name}_blade', upper + lower, d - 1.5, d + 1.5, mat(blade), groups[1], bevel=1.0)
    K.tube(f'{name}_rib', [(*at(stalk + 2, 0), d + 2), (*at(stalk + length * 0.85, 0), d + 2)], 1.1, mat(rib),
           groups[2], resolution=1)


def fern(k, name, x, y, s, seed):
    """A fern: five arching fronds from one root, each a chain of leaflets."""
    mat = k.mat
    r = K.rng(seed)
    for i in range(5):
        a = math.radians(-160 + i * 35 + r.uniform(-8, 8))
        length = 34 * s * r.uniform(0.8, 1.1)
        pts = []
        for j in range(6):
            t = j / 5
            px_ = x + math.cos(a) * length * t
            py = y + math.sin(a) * length * t + 18 * s * t * t
            pts.append((px_, py, 6 + i))
        K.tube(f'{name}_stem{i}', pts, 1.6, mat('moss'), 12, taper=0.6, resolution=1)
        for j, (px_, py, _) in enumerate(pts[1:-1], 1):
            K.blob(f'{name}_leaf{i}_{j}', px_, py + 1.5, 4.5 * s * (1 - j / 7), 2.6 * s, mat('leaves'), 13 + j % 2,
                   d=7 + i, rd=2, segments=8, rings=4)


def buried(k):
    """What the cut gives away: a lost explorer, a jade mask, gold, a fossil fish."""
    mat = k.mat
    ground = profile()
    # The explorer, lying in the soil under the left floor, pith helmet and all.
    bx, by = 330, FLOOR + 62
    K.blob('bone_skull', bx, by, 11, 10, mat('bone'), 12, d=4, rd=7)
    K.blob('bone_eye', bx + 4, by - 1, 3, 3.4, mat('bark'), 13, d=11, segments=10, rings=5)
    K.blob('bone_jaw', bx + 4, by + 8, 7, 4, mat('bone'), 12, d=4, rd=5)
    K.blob('helmet', bx - 2, by - 9, 15, 7, mat('clay'), 14, d=6, rd=10)
    K.box('helmet_band', bx - 13, by - 7, bx + 11, by - 4, 12, 14, mat('bark'), 15)
    K.tube('bone_spine', [(bx - 10, by + 4, 4), (bx - 36, by + 9, 4), (bx - 64, by + 7, 4)], 2.8, mat('bone'), 12,
           resolution=1)
    for j in range(4):
        rx = bx - 20 - j * 10
        K.tube(f'bone_rib{j}', [(rx + 2, by - 4, 4), (rx - 3, by + 6, 4), (rx, by + 18, 4)], 2.3, mat('bone'), 12,
               resolution=1)
    K.tube('bone_arm', [(bx - 18, by + 10, 5), (bx + 2, by + 22, 5), (bx + 20, by + 18, 5)], 2.4, mat('bone'), 13,
           resolution=1)
    K.box('lantern', bx + 22, by + 8, bx + 32, by + 22, 5, 12, mat('gold'), 14, bevel=1)
    K.box('lantern_glass', bx + 24, by + 11, bx + 30, by + 19, 12, 13, mat('glow'), 15)
    # A burial urn under the foundation, its lid gone, gold spilling out beside it and
    # a jade mask lying where it fell.
    ux, uy = 1010, T0[3] + 48
    K.lathe('urn', ux, 10, [(10, uy - 30), (13, uy - 27), (11, uy - 22), (20, uy - 8), (22, uy + 4), (16, uy + 16),
                             (9, uy + 20)], mat('clay'), 10, segments=18)
    K.lathe('urn_band', ux, 10, [(21.5, uy - 4), (22.6, uy + 1)], mat('gold'), 11, segments=18)
    K.blob('jade_mask', ux + 44, uy + 10, 15, 13, mat('jade'), 12, d=12, rd=6)
    for side in (-1, 1):
        K.blob(f'jade_eye{side}', ux + 44 + side * 5.5, uy + 8, 3.2, 2.2, mat('bone'), 13, d=17, rd=1.5, segments=8,
               rings=4)
    K.blob('jade_mouth', ux + 44, uy + 17, 5.5, 2, mat('bone'), 13, d=17, rd=1.5, segments=8, rings=4)
    r = K.rng(17)
    for i in range(16):
        t = i / 15
        K.log(f'coin{i}', ux + 14 + 22 * t + r.uniform(-3, 3), uy - 18 + 36 * t ** 0.7 + r.uniform(-2, 2), 3.2, 30,
              32 + i * 0.1, mat('gold'), 13 + i % 2, vertices=10)
    # A fossil fish in the bedrock under the right floor.
    fx, fy = 1600, FLOOR + 250
    K.tube('fossil_spine', [(fx - 30, fy, 4), (fx, fy - 3, 4), (fx + 28, fy + 1, 4)], 2.2, mat('bone'), 12,
           resolution=1)
    for j in range(7):
        x = fx - 22 + j * 7
        h = 9 - abs(j - 3) * 1.5
        K.tube(f'fossil_rib{j}', [(x + 2, fy - h, 4), (x, fy + h, 4)], 1.5, mat('bone'), 12, resolution=1)
    K.prism('fossil_tail', [(fx - 30, fy), (fx - 42, fy - 10), (fx - 40, fy), (fx - 42, fy + 10)], 2, 5, mat('bone'),
            12)
    K.blob('fossil_head', fx + 32, fy, 8, 6, mat('bone'), 12, d=4, rd=3)
    # Gold coins scattered in the soil by the rubble, and a golden figurine under it.
    for i in range(8):
        cx_ = 1470 + r.uniform(0, 110)
        cy_ = FLOOR + r.uniform(30, 90)
        K.log(f'soilcoin{i}', cx_, cy_, 3, 4, 6, mat('gold'), 13, vertices=10)
    gx, gy = 1540, FLOOR + 120
    K.blob('figurine_body', gx, gy + 6, 8, 11, mat('gold'), 12, d=5, rd=6)
    K.blob('figurine_head', gx, gy - 9, 7, 6.5, mat('gold'), 12, d=6, rd=5)
    K.blob('figurine_eye', gx + 2.5, gy - 9, 1.8, 1.8, mat('bark'), 13, d=11, segments=8, rings=4)


# ---------------------------------------------------------------------------------
# Plates, far to near.
# ---------------------------------------------------------------------------------

M.ramp('hazefar', ['#80aea4', '#8cb8aa', '#9ac3b1', '#abcfba'])
M.ramp('pyrfar', ['#7ba29e', '#86ada6', '#93b8ad', '#a3c3b6'])
M.ramp('mistfar', ['#b4d7c3', '#bcdcc7', '#c6e2cc', '#d2e8d0'])


@M.plate('far', parallax=0.12, outline='#6f988f')
def far(P):
    """Misty blue-green ridges with a tall stepped pyramid rising out of the haze."""
    mat = P.spec.mat
    r = K.rng(71)
    base = P.ay(880)
    pts = []
    x = -80
    while x < P.width + 160:
        pts.append((x, base - 70 - 38 * math.sin(x / 150 + 0.4) - 20 * math.sin(x / 57)))
        x += 50
    ridge = K.smooth(pts, 4)
    K.ground('ridge', ridge, mat('hazefar'), 1, depth=40, bottom=P.height + 10, bevel=4)
    # The distant pyramid: a steep temple with a shrine on top.
    px_, py = P.ax(1520), base - 60
    for i in range(6):
        half = 70 - i * 10
        K.box(f'pyr{i}', px_ - half, py - 18 * (i + 1), px_ + half, py - 18 * i + 2, -10 + i, 6 - i, mat('pyrfar'), 2,
              bevel=1.5)
    K.box('pyr_shrine', px_ - 12, py - 134, px_ + 12, py - 106, -4, 4, mat('pyrfar'), 3, bevel=1)
    K.box('pyr_comb', px_ - 6, py - 148, px_ + 6, py - 132, -4, 3, mat('pyrfar'), 3)
    # Trees on the ridge, little bumps.
    for i in range(50):
        tx = r.uniform(0, P.width)
        gy = K.height_at(ridge, tx) + 5
        K.blob(f'bump{i}', tx, gy - 6, r.uniform(9, 16), r.uniform(7, 11), mat('hazefar'), 4, d=10)
    # Mist lying in the valleys, in front of the ridge's foot.
    mist = [(x, base - 30 + 10 * math.sin(x / 90) + 6 * math.sin(x / 31)) for x in range(-40, P.width + 60, 20)]
    K.ground('mist', K.smooth(mist, 4), mat('mistfar'), 5, depth=10, d_front=30, bevel=4)


M.ramp('cliff', ['#56807a', '#62908a', '#739f95', '#88b0a2'])
M.ramp('canopyfar', ['#3f7560', '#4a846a', '#5a9474', '#6fa580'])
M.ramp('water', ['#9ccdd0', '#b4dcdc', '#cde9e4', '#e6f5ef'])


@M.plate('falls', parallax=0.24, outline='#3f6660')
def falls(P):
    """Jungle-capped cliffs with waterfalls pouring down them into the mist."""
    mat = P.spec.mat
    r = K.rng(72)
    base = P.ay(850)
    # Mesas: flat-topped cliffs with steep faces, jungle on top.
    # Tepuis: sheer table mountains, each with its own stepped, broken outline.
    mesas = [(-60, 250, 150), (320, 540, 118), (600, 700, 84), (810, 1080, 176), (1180, 1400, 112)]
    for i, (a, b, h) in enumerate(mesas):
        a, b = a * P.width / 1400, b * P.width / 1400
        top = base - h
        notch = r.uniform(0.3, 0.6)
        nx = a + (b - a) * notch
        poly = [(a, base + 60), (a + 10, top + 40), (a + 18, top + 22), (a + 30, top + 8), (a + 44, top + 2),
                (nx - 16, top), (nx - 8, top + 10), (nx + 8, top + 12), (nx + 16, top + 3), (b - 40, top + 1),
                (b - 24, top + 12), (b - 14, top + 26), (b - 6, top + 50), (b, base + 60)]
        K.prism(f'mesa{i}', poly, -20, 0, mat('cliff'), 1 + i % 2, bevel=3)
        # Vertical grooves down the cliff, then ledges across it.
        for j in range(int((b - a) // 26)):
            gx = a + 22 + j * 26 + r.uniform(-4, 4)
            K.box(f'mesa{i}_groove{j}', gx, top + 14 + r.uniform(0, 20), gx + 3, base + 20, 0, 1.5, mat('cliff'), 3)
        # The jungle on top, spilling over the rim in hanging curtains.
        x = a + 30
        while x < b - 20:
            K.blob(f'mesa{i}_tree{int(x)}', x, top - 4, r.uniform(12, 18), r.uniform(9, 13), mat('canopyfar'), 4, d=4)
            if r.random() < 0.5:
                K.box(f'mesa{i}_drape{int(x)}', x - 4, top, x + 4, top + r.uniform(12, 34), 2, 5, mat('canopyfar'), 4,
                      bevel=2)
            x += r.uniform(12, 20)
        # Waterfalls on the two biggest, a thin ribbon on a third.
        if 110 < h < 120:
            wx = b - (b - a) * 0.3
            K.box(f'ribbon{i}', wx - 3, top + 2, wx + 3, base + 20, 4, 8, mat('water'), 5)
            K.blob(f'ribbon{i}_foam', wx, base + 16, 10, 6, mat('water'), 7, d=12)
        if h >= 150:
            wx = (a + b) / 2 + r.uniform(-30, 30)
            K.box(f'fall{i}', wx - 13, top - 2, wx + 13, base + 20, 4, 8, mat('water'), 5)
            K.blob(f'fall{i}_lip', wx, top - 1, 15, 4, mat('water'), 6, d=9, rd=3)
            for j in range(4):
                K.box(f'fall{i}_streak{j}', wx - 10 + j * 6, top + 8 + (j % 2) * 14, wx - 8 + j * 6, base + 10, 8, 9,
                      mat('water'), 6)
            for j in range(5):
                K.blob(f'fall{i}_foam{j}', wx - 24 + j * 12, base + 16 - (j % 2) * 4, 13, 8, mat('water'), 7, d=12)
    # A long jungle band along the foot, broken by the mist over the plunge pools.
    band = [(x, base + 8 + 8 * math.sin(x / 70) + 4 * math.sin(x / 23)) for x in range(-40, P.width + 60, 20)]
    band = K.smooth(band, 4)
    K.ground('jungle', band, mat('canopyfar'), 8, depth=10, d_front=20, bevel=4)
    for i in range(70):
        tx = r.uniform(0, P.width)
        gy = K.height_at(band, tx) + 4
        K.blob(f'crown{i}', tx, gy - 7, r.uniform(10, 16), r.uniform(8, 12), mat('canopyfar'), 9, d=24)


M.ramp('canopy', ['#24573f', '#2f6a48', '#3e7f52', '#56975e'])
M.ramp('trunkmid', ['#4a5446', '#5a6554', '#6c7862', '#808b72'])
M.ramp('ruinmid', ['#6d7c6c', '#7f8e7a', '#93a18a', '#aab49c'])


@M.plate('canopy', parallax=0.4, outline='#1e4432')
def canopy(P):
    """The canopy behind the temple: layered crowns, emergent giants, palms, a ruin."""
    mat = P.spec.mat
    r = K.rng(73)
    base = P.ay(800)
    # Emergent giants first (behind): tall pale trunks under round, clumped crowns.
    for i, ex in enumerate((0.1, 0.36, 0.64, 0.9)):
        x = ex * P.width + r.uniform(-30, 30)
        top = base - r.uniform(140, 180)
        K.tube(f'emtrunk{i}', [(x, base + 40, -20), (x + r.uniform(-4, 4), top + 22, -20)], 7, mat('trunkmid'), 1,
               taper=0.7)
        for side in (-1, 1):
            K.tube(f'embranch{i}_{side}', [(x, top + 30, -20), (x + side * 22, top + 12, -20), (x + side * 40, top + 6, -20)],
                   3, mat('trunkmid'), 1, taper=0.6, resolution=1)
        for j in range(9):
            u = (j - 4) / 4
            K.blob(f'emcrown{i}_{j}', x + u * 52, top + abs(u) * 8 + r.uniform(-3, 3), r.uniform(16, 22),
                   r.uniform(11, 14), mat('canopy'), 2, d=-12 + j)
        K.blob(f'emcore{i}', x, top - 6, 40, 16, mat('canopy'), 2, d=-4)
    # A ruined tower poking out of the trees.
    tx = P.ax(1620)
    K.box('tower', tx - 18, base - 120, tx + 18, base + 10, -12, 4, mat('ruinmid'), 3, bevel=1.5)
    K.box('tower_top', tx - 22, base - 128, tx + 22, base - 118, -12, 6, mat('ruinmid'), 4, bevel=1.5)
    K.box('tower_door', tx - 6, base - 100, tx + 6, base - 84, 4, 5, mat('trunkmid'), 5)
    K.prism('tower_break', [(tx - 22, base - 128), (tx - 8, base - 140), (tx + 4, base - 132), (tx + 22, base - 128)],
            -12, 6, mat('ruinmid'), 4)
    # Two rows of round crowns, the back row higher and paler... same ramp, it's the
    # front row's lit tops and the part lines that separate them.
    for row, (off, rmin, rmax, grp) in enumerate(((-40, 22, 32, 6), (-6, 26, 38, 8))):
        x = -30
        while x < P.width + 40:
            gy = base + off + 12 * math.sin(x / 83 + row) + r.uniform(-6, 6)
            rr = r.uniform(rmin, rmax)
            K.blob(f'row{row}_{int(x)}', x, gy, rr, rr * 0.75, mat('canopy'), grp + (int(x) // 30) % 2, d=row * 20)
            x += rr * r.uniform(1.0, 1.4)
    # Palms along the front.
    for i in range(7):
        x = r.uniform(0, P.width)
        top = base - r.uniform(40, 80)
        lean = r.uniform(-14, 14)
        K.tube(f'palm{i}', [(x, base + 30, 30), (x + lean * 0.5, (base + top) / 2, 30), (x + lean, top, 30)], 3,
               mat('trunkmid'), 10, taper=0.7)
        for j in range(6):
            a = math.radians(-170 + j * 32)
            pts = [(x + lean + math.cos(a) * L, top + math.sin(a) * L * 0.5 + (L / 26) ** 2 * 6, 31)
                   for L in (0, 10, 18, 26)]
            K.tube(f'palm{i}_frond{j}', pts, 2.6, mat('canopy'), 11, taper=0.4, resolution=1)
    K.box('floor', -10, base + 20, P.width + 10, P.height + 10, -40, 40, mat('canopy'), 12)


M.ramp('nearleaf', ['#0f3222', '#164530', '#1f5a3a', '#2e7244'])
M.ramp('neartrunk', ['#2a2a22', '#38382c', '#484638', '#5a5846'])


@M.plate('near', parallax=0.62, outline='#0a1f15')
def near(P):
    """The undergrowth just behind the playfield: dark leaf masses, trunks, big leaves."""
    mat = P.spec.mat
    r = K.rng(74)
    base = P.ay(790)
    line = K.smooth([(x, base + 16 * math.sin(x / 110) + 9 * math.sin(x / 41)) for x in range(-40, P.width + 60, 30)], 4)
    K.ground('bank', line, mat('nearleaf'), 1, depth=30, bottom=P.height + 10, bevel=6)
    # Leaf masses: big clumps along the bank.
    x = -30
    i = 0
    while x < P.width + 40:
        gy = K.height_at(line, x) + 4
        rr = r.uniform(22, 40)
        K.blob(f'clump{i}', x, gy - rr * 0.4, rr, rr * 0.7, mat('nearleaf'), 3 + i % 2, d=4)
        if r.random() < 0.35:
            # A big elephant-ear leaf sticking up out of the clump.
            for j in range(r.choice((2, 3))):
                a = math.radians(r.uniform(-150, -30))
                big_leaf(P.spec, f'ear{i}_{j}', x + r.uniform(-10, 10), gy - rr * 0.5, r.uniform(26, 40),
                         r.uniform(12, 18), a, 12 + j * 2, blade='nearleaf', rib='nearleaf', groups=(5, 6, 7))
        x += rr * r.uniform(1.0, 1.5)
        i += 1
