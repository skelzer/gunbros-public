"""
Skipper (roster `grub`, atlas `skipper`): slugs that skip along the ground.

The skipper's shots are heavy rolling slugs that bounce off ridges and roll to rest
(`bounce` behaviour), so all three tumble (`spin`) and read as stones, in the lime and
cream of the caterpillar's own segments.

- `slug` (Skip Shot): a flat skipping stone, lime on top and cream underneath like one
  of the grub's body segments, with an orange spiracle dot.
- `slugHeavy` (Double Skip): two such segments pinched together, a peanut whose
  outline notches at the joint the way the grub's body does.
- `boulder` (Boulder): a big faceted rock with a lime moss cap and cracks, heavy and
  rolling.
"""
import random

import bmesh

from projectile_kit import W, _mesh_object, ball, extra_ramp, mat, projectile, tag

# A warm river stone grey for the boulder, between char and smoke.
extra_ramp('grubRock', ['#3b3530', '#6b625a', '#9c9186', '#cfc6b8'])


def pebble(prefix, cx, cy, rx, ry, depth, top, belly, dot, group=1):
    """One grub segment as a stone: a lime ellipsoid with a cream belly cap under it and
    an orange spiracle. A belly slightly grown and cut to the lower part would need a
    boolean; a second, flatter ellipsoid shifted down reads the same at this size."""
    parts = [
        ball(f'{prefix}_top', (cx, cy), 1.0, top, squash=(rx, ry, depth), group=group),
        ball(f'{prefix}_belly', (cx, cy - ry * 0.42), 1.0, belly, d=0.25,
             squash=(rx * 0.86, ry * 0.62, depth * 0.95), group=group + 1),
    ]
    if dot:
        parts.append(ball(f'{prefix}_spot', (cx - rx * 0.1, cy + ry * 0.2), 1.0, dot, d=depth * 0.8,
                          squash=(1.1, 0.9, 0.6), group=group + 2))
    return parts


@projectile('slug', (13, 13), mode='spin', frames=6, spin_deg=360.0, frame_ticks=3,
            materials=('skin', 'bone', 'flame'))
def slug(a):
    return pebble('s', 0, 0, 4.5, 3.0, 3.0, mat('skin'), mat('bone'), mat('flame'))


@projectile('slugHeavy', (17, 17), mode='spin', frames=6, spin_deg=360.0, frame_ticks=3,
            materials=('skin', 'bone', 'flame'))
def slug_heavy(a):
    # Two segments nose to tail, the back one a little smaller, overlapping by a pixel so
    # the outline pinches at the joint.
    return (pebble('f', 2.6, 0, 3.9, 3.6, 3.4, mat('skin'), mat('bone'), mat('flame'), group=1)
            + pebble('b', -3.0, 0, 3.4, 3.2, 3.0, mat('skin'), mat('bone'), mat('flame'), group=4))


def rock(name, r, material, seed, squash=(1, 1, 1), jitter=0.16, subdiv=1):
    """A low-poly boulder: an icosphere with its corners pushed in and out, flat shaded
    so the toon ramp falls into facets."""
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    for v in bm.verts:
        k = 1.0 + rnd.uniform(-jitter, jitter)
        x, y, z = v.co
        v.co = W(x * r * k * squash[0], z * r * k * squash[1], y * r * k * squash[2])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return tag(_mesh_object(name, bm, material, smooth=False), 1)


@projectile('boulder', (25, 25), mode='spin', frames=8, spin_deg=360.0, frame_ticks=3,
            materials=('grubRock', 'skin', 'char'))
def boulder(a):
    body = rock('rock', 9.0, mat('grubRock'), 7, squash=(1.05, 0.95, 0.9), jitter=0.13, subdiv=1)
    # Moss on the crown: the same rock grown a little and kept only above a tilted plane,
    # done by hand: a flattened lime cap on top.
    moss = rock('moss', 6.2, mat('skin'), 11, squash=(1.15, 0.55, 0.95), jitter=0.12, subdiv=1)
    moss.location = W(-1.2, 5.2, 0.8)
    tag(moss, 2)
    # Cracks: two dark chips set into the face.
    chips = [
        ball('crack0', (2.6, -2.5), 1.0, mat('char'), d=7.1, squash=(2.4, 0.7, 1.2), group=3),
        ball('crack1', (-3.8, -4.6), 1.0, mat('char'), d=6.4, squash=(1.5, 0.6, 1.2), group=3),
    ]
    return [body, moss] + chips
