"""
Delver (roster `nak`, atlas `delver`): the armadillo miner's clay and its drills.

- `clayBall` (Clay Lob): a heavy lump of wet orange clay with grit in it, tumbling.
- `drillShell` (Burrow): the delver's own bit fired off: a steel star-section drill,
  twisted and flat shaded so the toon ramp paints spiral flutes, behind an amber
  collar and an orange armour cap. Two frames turn the bit by half a flute so the
  bands crawl while it flies and bores (`burrow` behaviour).
- `drillHeavy` (Deep Drill): a boring machine. A longer, fatter bit, an orange
  carapace body in overlapping bands like the delver's back, an amber hard hat collar
  with the headlamp, and a hot exhaust glow at the tail. Three frames of spin.
"""
import math
import random

import bmesh
from mathutils import Vector

from projectile_kit import GLOW, W, _mesh_object, ball, extra_ramp, fins, lathe, mat, projectile, tag

# Wet terracotta clay, a step redder and duller than the delver's orange shell.
extra_ramp('nakClay', ['#5a2a16', '#8f4726', '#bf6b3a', '#e39a62'])


def fluted_bit(name, x0, x1, r0, material, flutes=4, turns=0.6, rings=8, depth=0.55, phase=0.0,
               tip_r=0.25, group=1):
    """
    A drill bit along x from x0 to a point at x1 (the delver's own recipe): a star
    section of `flutes` ridges with grooves `depth` of the radius deep, twisted `turns`
    times along its length, flat shaded. `phase` (in flutes) turns it about its axis.
    """
    bm = bmesh.new()
    n = flutes * 2
    grid = []
    for k in range(rings):
        t = k / rings
        r = r0 * (1 - t) + tip_r * t
        row = []
        for j in range(n):
            ang = 2 * math.pi * ((j + 2 * phase) / n + turns * t)
            rr = r * (1.0 if j % 2 == 0 else depth)
            row.append(bm.verts.new(W(x0 + (x1 - x0) * t, rr * math.cos(ang), rr * math.sin(ang))))
        grid.append(row)
    tip = bm.verts.new(W(x1, 0, 0))
    for k in range(rings - 1):
        for j in range(n):
            bm.faces.new((grid[k][j], grid[k][(j + 1) % n], grid[k + 1][(j + 1) % n], grid[k + 1][j]))
    for j in range(n):
        bm.faces.new((grid[-1][j], grid[-1][(j + 1) % n], tip))
    bm.faces.new(list(reversed(grid[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return tag(_mesh_object(name, bm, material, smooth=False), group)


def lump(name, r, material, seed, squash=(1, 1, 1), jitter=0.12, group=1):
    """A soft lumpy ball: a UV sphere with a few smooth bulges, smooth shaded."""
    rnd = random.Random(seed)
    bumps = [(Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized(),
              rnd.uniform(0.5, 1.0)) for _ in range(5)]
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=1.0)
    for v in bm.verts:
        n = v.co.normalized()
        k = 1.0 + sum(jitter * s * max(0.0, n.dot(b)) ** 3 for b, s in bumps)
        x, y, z = v.co
        v.co = W(x * r * k * squash[0], z * r * k * squash[1], y * r * k * squash[2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return tag(_mesh_object(name, bm, material, smooth=True), group)


@projectile('clayBall', (14, 14), mode='spin', frames=4, spin_deg=360.0, frame_ticks=4,
            materials=('nakClay', 'steel', 'amber'))
def clay_ball(a):
    return [
        lump('clay', 3.9, mat('nakClay'), 3, squash=(1.0, 0.95, 1.0), jitter=0.22),
        # Grit pressed into the clay: two steel pebbles and an amber fleck.
        ball('grit0', (1.5, 1.5), 1.0, mat('steel'), d=3.4, squash=(1.5, 1.3, 1.0), group=2),
        ball('grit1', (-2.0, -1.0), 1.0, mat('steel'), d=3.3, squash=(1.3, 1.2, 1.0), group=2),
        ball('grit2', (0.9, -2.2), 1.0, mat('amber'), d=3.4, squash=(1.1, 1.0, 0.9), group=3),
    ]


@projectile('drillShell', (17, 17), anim=2, frame_ticks=2,
            materials=('steel', 'amber', 'orange'))
def drill_shell(a):
    return [
        lathe('cap', [(-6.4, 1.4), (-6.4, 2.2), (-5.2, 2.7), (-4.0, 2.7)], mat('orange'), group=1),
        lathe('collar', [(-4.2, 3.3), (-2.4, 3.3)], mat('amber'), group=2),
        fluted_bit('bit', -2.5, 7.0, 3.4, mat('steel'), flutes=4, turns=0.7, phase=a * 0.5, group=3),
    ]


@projectile('drillHeavy', (27, 27), anim=3, frame_ticks=2,
            materials=('steel', 'amber', 'orange', 'rubber', 'lamp', 'flame'))
def drill_heavy(a):
    objs = [
        # A rubber nozzle and the exhaust glow at the tail.
        lathe('nozzle', [(-10.0, 1.6), (-8.8, 2.2), (-8.6, 2.2)], mat('rubber'), group=1),
        ball('exhaust', (-10.4, 0), 1.9 if a != 1 else 1.5, mat('flame'), squash=(1.2, 1, 1), group=GLOW),
        ball('exhaust_core', (-10.0, 0), 1.1 if a != 1 else 0.8, mat('lamp'), d=1.0, group=GLOW + 1),
    ]
    # Carapace: three overlapping orange bands, alternating groups, each flaring at its
    # front edge so the silhouette steps like the delver's back.
    for k, (x0, x1, r0, r1) in enumerate(((-8.8, -6.0, 3.0, 4.0), (-6.4, -3.6, 3.6, 4.6), (-4.0, -1.4, 4.2, 5.2))):
        objs.append(lathe(f'band{k}', [(x0, r0 * 0.7), (x0, r0), (x1, r1), (x1, r1 * 0.7)], mat('orange'),
                          group=2 + (k % 2)))
    objs += [
        lathe('collar', [(-1.6, 5.4), (0.4, 5.4)], mat('amber'), group=4),
        # The headlamp on the collar, facing the camera.
        ball('lamp', (-0.6, 2.6), 1.2, mat('lamp'), d=5.0, squash=(1, 1, 0.5), group=GLOW + 2),
        # Three steel spade claws swept back off the collar, the delver's digging paws.
        *fins('claw', -4.6, -0.4, 4.4, 3.0, mat('steel'), count=3, depth=1.0, sweep=2.2, group=6),
        fluted_bit('bit', 0.2, 10.6, 4.6, mat('steel'), flutes=5, turns=0.8, rings=10, phase=a / 3,
                   group=5),
    ]
    return objs
