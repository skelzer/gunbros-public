"""
Triclops (`trico`): it shoots its own third eye. Everything is a chibi eyeball in the
mobile's colours: white sclera, the big amber iris and ink pupil of the forehead eye,
the bone ring it sits in, and a little gore (red veins, a dangling optic nerve).

- `eyeBall`: s1 Eye Shot. A bloodshot eyeball trailing a stub of nerve, tumbling; the
  iris rolls round the ball as it spins.
- `eyeShard`: s2 Orbit, three of them circling a shared centre. A smaller eye that
  looks where it flies (aim), dragging a long wriggling nerve tail like a tadpole, so
  the three read as a ring of little comets.
- `eyeGiant`: ss Cyclops. A huge eyeball set in a bone socket ring with a teal lid
  over the top, veins all over and a torn nerve bundle behind, tumbling.
"""
import math

import bpy
from mathutils import Matrix

from projectile_kit import GLOW, W, ball, mat, projectile, torus, tube

# Veins and nerves: a meaty red that sits between crimson and pink.
from projectile_kit import extra_ramp

extra_ramp('trico_flesh', ['#6e1a2c', '#b8344a', '#ee6f7c', '#ffb0b0'])
# A sclera brighter than the neutral white ramp, so the eyes pop off a pale sky.
extra_ramp('trico_sclera', ['#98a3b3', '#dfe6ee', '#ffffff', '#ffffff'])
# The forehead eye's burning amber, as a ramp so the iris keeps some shape.
extra_ramp('trico_iris', ['#c46a12', '#f7a824', '#ffcf4d', '#ffe89a'])

SCLERA = ('trico_sclera', 'trico_iris', 'ink', 'flash', 'trico_flesh')


def yaw(obj, deg):
    """Swing an object about the vertical screen axis through the origin: +deg carries a
    part on the camera side of the ball round towards +x (the flight direction)."""
    bpy.context.view_layer.update()
    obj.matrix_world = Matrix.Rotation(math.radians(deg), 4, 'Z') @ obj.matrix_world
    return obj


def sph(r, lon, lat):
    """A point on a ball of radius r: lon 0 faces the camera, 90 faces +x; lat up."""
    lo, la = math.radians(lon), math.radians(lat)
    return (r * math.cos(la) * math.sin(lo), r * math.sin(la), r * math.cos(la) * math.cos(lo))


def vein(name, r, path, width, group):
    """A vein lying on the ball, from a list of (lon, lat) points."""
    return tube(name, [sph(r + width * 0.3, lo, la) for lo, la in path], width, mat('trico_flesh'),
                group=group, resolution=2)


def iris(prefix, r, ir, look, lift=0.0, ring=None):
    """Iris, pupil and a glint on the camera side of a ball of radius r, then swung `look`
    degrees towards the flight and tipped `lift` degrees up."""
    parts = [
        ball(f'{prefix}_iris', (0, 0), ir, mat('trico_iris'), d=r - ir * 0.35, squash=(1, 1, 0.5), group=3),
        ball(f'{prefix}_pupil', (0, 0), ir * 0.55, mat('ink'), d=r + ir * 0.05, squash=(1, 1, 0.6), group=4),
    ]
    if ring:
        parts.append(torus(f'{prefix}_ring', (0, 0), ir + ring * 0.9, ring, mat('bone'), d=r - ring * 1.4, group=6))
    for o in parts:
        o.rotation_mode = 'XYZ'
        # Tip up about the horizontal screen axis first, then swing round.
        bpy.context.view_layer.update()
        o.matrix_world = Matrix.Rotation(math.radians(-lift), 4, 'X') @ o.matrix_world
        yaw(o, look)
    return parts


def cap(obj, centre, tilt):
    """Keep the part of `obj` inside a big box centred at `centre` (px) and tipped `tilt`
    degrees, and bake it: a live boolean would not turn with the piece."""
    import render_common as rc
    from render_common import px
    box = rc.add_box(obj.name + '_box', (px(12), px(30), px(30)), W(*centre), obj.data.materials[0])
    box.rotation_euler = (0, math.radians(tilt), 0)
    mod = obj.modifiers.new('Cap', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(box, do_unlink=True)
    return obj


@projectile('eyeBall', (14, 14), mode='spin', frames=8, spin_deg=360.0, frame_ticks=3, materials=SCLERA)
def eye_ball(a):
    r = 4.3
    objs = [ball('sclera', (0, 0), r, mat('trico_sclera'), group=1)]
    objs += iris('e', r, 2.6, 30, lift=12)
    objs.append(ball('glint', sph(r + 0.3, 30, 38)[:2], 0.6, mat('flash'), d=sph(r, 30, 38)[2] + 0.3, group=GLOW))
    objs.append(vein('v0', r, [(-40, -20), (-70, -5), (-95, 10)], 0.5, 5))
    objs.append(vein('v1', r, [(-20, 45), (-60, 40), (-100, 30)], 0.5, 5))
    # The torn optic nerve out of the back of the ball.
    objs.append(tube('nerve', [(-3.6, -0.4, 0), (-4.5, -1.0, 0), (-4.7, -2.0, 0)], [1.1, 0.9, 0.6],
                     mat('trico_flesh'), group=7))
    return objs


@projectile('eyeShard', (14, 14), anim=2, frame_ticks=4, materials=SCLERA)
def eye_shard(a):
    r = 3.2
    cx = 1.6
    objs = [ball('sclera', (0, 0), r, mat('trico_sclera'), group=1)]
    objs += iris('e', r, 2.0, 38)
    objs.append(ball('glint', (0.2, 1.8), 0.55, mat('flash'), d=2.4, group=GLOW))
    for o in objs:
        o.location.x += cx / 10.0
    # A wriggling nerve tail, whipping the other way on the second frame.
    s = 1 if a == 0 else -1
    objs.append(tube('tail', [(cx - 2.6, 0, 0), (cx - 4.0, 0.8 * s, 0), (cx - 5.4, -0.4 * s, 0),
                              (cx - 6.6, -1.0 * s, 0)], [1.3, 1.0, 0.7, 0.35], mat('trico_flesh'), group=7))
    objs.append(vein('v0', r, [(-60, 20), (-95, 0)], 0.45, 5))
    for o in objs[-1:]:
        o.location.x += cx / 10.0
    return objs


@projectile('eyeGiant', (26, 26), mode='spin', frames=8, spin_deg=360.0, frame_ticks=3,
            materials=SCLERA + ('bone', 'shell'))
def eye_giant(a):
    r = 8.4
    objs = [ball('sclera', (0, 0), r, mat('trico_sclera'), group=1)]
    objs += iris('e', r, 4.2, 38, lift=6, ring=1.0)
    objs.append(ball('glint', sph(r + 0.4, 18, 36)[:2], 1.1, mat('flash'), d=sph(r, 18, 36)[2] + 0.6, group=GLOW))
    # A teal lid clamped over the back of the ball, like a scrap of the triclops' hide.
    lid = ball('lid', (0, 0), r + 0.7, mat('shell'), group=8)
    objs.append(cap(lid, (-10.5, 2.0), 30))
    for k, path in enumerate(([(-15, -30), (-40, -45), (-75, -40)],
                              [(-10, 55), (-35, 40), (-50, 60)],
                              [(80, -30), (100, -45), (125, -40)],
                              [(95, 40), (115, 25)])):
        objs.append(vein(f'v{k}', r, path, 0.55, 5))
    # The torn nerve bundle: two stringy ends hanging out of the back.
    objs.append(tube('nerve0', [(-7.6, -2.0, 0), (-9.0, -3.2, 0), (-9.8, -4.6, 0)], [1.6, 1.2, 0.7],
                     mat('trico_flesh'), group=7))
    objs.append(tube('nerve1', [(-6.6, -4.4, 1.0), (-7.4, -6.4, 1.0), (-6.8, -8.2, 1.0)], [1.2, 0.9, 0.5],
                     mat('trico_flesh'), group=9))
    return objs
