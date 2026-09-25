"""
Sapper (`raon`, atlas `sapper`): the mine layer's demolition charge, the two mine
delivery pods and the walking mines they leave on the ground.

The Sapper is an orange hull with a hazard-striped skirt and a hopper heaped with fat
disc mines: dark bodies, a steel rim, red pressure caps. Everything here is one of
those discs, or the charge its launcher tube spits:

- `sapperCharge` (Charge): a stubby orange demolition canister, flat black end caps,
  a hazard-yellow band and a fizzing fuse at the tail. Not the Armor's olive shell.
- `minePod` (Mine Drop): one of the hopper's disc mines, legs folded, tumbling face-on:
  dark disc, orange rim, red pressure cap, four steel claws folded round it.
- `minePodHeavy` (Siege Mine): the big one, a studded steel rim with six spikes, a
  hazard band and a bigger cap, tumbling.
- `mine`, `mineHeavy`: the same discs unfolded and standing on crab legs on the ground,
  the pressure cap's lamp blinking. Loop, drawn with the canvas bottom on the ground.
"""
import math

import bpy
from mathutils import Matrix

from projectile_kit import GLOW, W, ball, cone, lathe, mat, projectile, rod, torus


def axial_ring(name, x, R, r, material, group):
    """A ring round the flight axis at x (the kit's torus faces the camera: turn it)."""
    o = torus(name, (x, 0), R, r, material, group=group)
    bpy.context.view_layer.update()
    pivot = W(x, 0, 0)
    o.matrix_world = (Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(90), 4, 'Z')
                      @ Matrix.Translation(-pivot)) @ o.matrix_world
    return o


def disc(name, centre, r, depth, material, d=0.0, group=1, seg=24, bevel=0.35):
    """A fat disc facing the camera: a flat cylinder with softened edges, `depth` px thick."""
    cx, cy = centre
    # A lathe about x, turned so its axis points at the camera.
    prof = [(-depth / 2, r - bevel), (-depth / 2 + bevel, r), (depth / 2 - bevel, r), (depth / 2, r - bevel)]
    o = lathe(name, prof, material, seg=seg, group=group)
    bpy.context.view_layer.update()
    o.matrix_world = Matrix.Translation(W(cx, cy, d)) @ Matrix.Rotation(math.radians(90), 4, 'Z') @ o.matrix_world
    return o


# --------------------------------------------------------------------------
# The charge
# --------------------------------------------------------------------------

@projectile('sapperCharge', (13, 13), anim=2, frame_ticks=3,
            materials=('orange', 'rubber', 'lamp', 'flame', 'flash'))
def sapper_charge(a):
    fizz = 1.0 if a == 0 else 0.6
    return [
        lathe('can', [(-2.6, 2.3), (2.4, 2.3)], mat('orange'), group=1),
        lathe('band', [(-0.7, 2.45), (0.7, 2.45)], mat('lamp'), group=1),
        lathe('cap_tail', [(-3.4, 1.8), (-3.4, 2.4), (-2.6, 2.4)], mat('rubber'), group=2),
        lathe('cap_nose', [(2.4, 2.4), (3.4, 2.4), (3.9, 1.6), (3.9, 0.0)], mat('rubber'), group=3),
        rod('fuse', (-3.4, 0), (-4.2, 0.4), 0.35, mat('rubber'), group=2),
        ball('spark', (-4.5, 0.6), 1.45 * fizz, mat('flame'), group=GLOW),
        ball('spark_core', (-4.4, 0.7), 0.8 * fizz, mat('flash'), d=1.0, group=GLOW + 1),
    ]


# --------------------------------------------------------------------------
# Pods: the disc mines, legs folded, tumbling face-on
# --------------------------------------------------------------------------

@projectile('minePod', (17, 17), mode='spin', frames=4, spin_deg=90, frame_ticks=3,
            materials=('rubber', 'orange', 'accent', 'steel'))
def mine_pod(a):
    objs = [
        disc('body', (0, 0), 4.2, 2.6, mat('rubber'), group=1),
        torus('rim', (0, 0), 4.6, 0.9, mat('orange'), d=0.4, group=2),
        disc('cap', (0, 0), 1.8, 1.4, mat('accent'), d=1.6, group=3),
    ]
    # The four crab legs folded flat against the rim: claws that show the tumble.
    for k in range(4):
        t = math.radians(45 + 90 * k)
        c, s = math.cos(t), math.sin(t)
        objs.append(rod(f'leg{k}', (3.6 * c, 3.6 * s), (6.0 * c, 6.0 * s), 0.9, mat('steel'), d=-0.6, group=4))
        objs.append(rod(f'claw{k}', (6.0 * c, 6.0 * s), (5.7 * c - 2.0 * s, 5.7 * s + 2.0 * c), 0.8,
                        mat('steel'), d=-0.6, group=4))
    return objs


@projectile('minePodHeavy', (21, 21), mode='spin', frames=6, spin_deg=60, frame_ticks=3,
            materials=('rubber', 'orange', 'accent', 'steel', 'lamp'))
def mine_pod_heavy(a):
    objs = [
        disc('body', (0, 0), 5.8, 3.2, mat('rubber'), group=1),
        torus('rim', (0, 0), 6.1, 1.1, mat('steel'), d=0.4, group=2),
        torus('hazard', (0, 0), 3.9, 0.7, mat('lamp'), d=1.5, group=4),
        disc('cap', (0, 0), 2.4, 1.6, mat('accent'), d=2.0, group=3),
    ]
    for k in range(6):
        t = math.radians(90 + 60 * k)
        c, s = math.cos(t), math.sin(t)
        objs.append(cone(f'spike{k}', (6.2 * c, 6.2 * s), (9.0 * c, 9.0 * s), 1.4, mat('steel'), group=5))
    return objs


# --------------------------------------------------------------------------
# Walking mines: a disc on crab legs, seen from the side, feet on the canvas bottom
# --------------------------------------------------------------------------

def stand(o, cy):
    """Stand a lathe (built about x) up on the vertical axis through (0, cy)."""
    bpy.context.view_layer.update()
    o.matrix_world = Matrix.Translation(W(0, cy, 0)) @ Matrix.Rotation(math.radians(-90), 4, 'Y') @ o.matrix_world
    return o


def walker_mine(a, h, R, dome, leg_r, heavy=False):
    """
    The mine standing: a disc skirt (the hopper mine's rim) under a dark dome, a red
    pressure cap with a lamp on it, four crab legs splayed out to the ground. `a` 0..3:
    the lamp is lit on 0 and 1 (outlined yellow, not glow, so it holds against the sky),
    dark red on 2 and 3; the body sinks a hair on 1 and 3 so a still mine breathes.
    """
    ground = -h / 2 + 1.0          # 1 px of outline under the feet, on the canvas bottom
    bob = -0.3 if a in (1, 3) else 0.0
    base = ground + (2.6 if heavy else 2.0) + bob
    lit = a in (0, 1)
    objs = []
    # Crab legs, the near pair in front of the skirt, the far pair behind it.
    for side in (-1, 1):
        for d in (1.8, -1.8):
            hip = (side * R * 0.55, base + 0.6)
            knee = (side * (R + 1.0), base + (1.6 if heavy else 1.2))
            foot = (side * (R + (2.0 if heavy else 1.6)), ground + leg_r + 0.1)
            objs.append(rod(f'thigh{side}{d}', hip, knee, leg_r, mat('steel'), d=d, group=5))
            objs.append(rod(f'shin{side}{d}', knee, foot, leg_r, mat('steel'), d=d, group=5))
    skirt = lathe('skirt', [(-0.3, R - 0.5), (0.0, R), (1.5, R), (1.8, R - 0.6)],
                  mat('steel' if heavy else 'orange'), group=2)
    objs.append(stand(skirt, base))
    top = base + 1.6
    prof = [(0.0, R - 0.5)]
    for k in range(1, 7):
        t = k / 6
        prof.append((dome * math.sin(t * math.pi / 2), (R - 0.5) * math.cos(t * math.pi / 2) if k < 6 else 0.0))
    objs.append(stand(lathe('dome', prof, mat('rubber'), group=1), top))
    cap_r = 1.9 if heavy else 1.5
    cap_y = top + dome - 0.5
    objs.append(stand(lathe('cap', [(0.0, cap_r), (0.9, cap_r), (1.2, cap_r * 0.6), (1.2, 0.0)],
                            mat('accent'), group=3), cap_y))
    lamp_y = cap_y + 1.2 + (1.0 if heavy else 0.8)
    if lit:
        objs.append(ball('lamp', (0, lamp_y), 1.35 if heavy else 1.15, mat('lamp'), group=8))
    else:
        objs.append(ball('lamp_off', (0, lamp_y - 0.1), 1.25 if heavy else 1.05, mat('crimson'), group=8))
    return objs


@projectile('mine', (17, 13), mode='loop', frames=4, frame_ticks=8,
            materials=('rubber', 'orange', 'accent', 'steel', 'crimson', 'lamp', 'flash'))
def mine(a):
    return walker_mine(a, 13, R=4.4, dome=3.4, leg_r=0.6, heavy=False)


def lamp_on_cap(objs, a, cap_y, cap_r, lamp_r):
    """The red pressure cap and its blinking lamp (lit on frames 0 and 1)."""
    objs.append(stand(lathe('cap', [(0.0, cap_r), (0.9, cap_r), (1.2, cap_r * 0.6), (1.2, 0.0)],
                            mat('accent'), group=3), cap_y))
    lamp_y = cap_y + 1.2 + lamp_r * 0.7
    if a in (0, 1):
        objs.append(ball('lamp', (0, lamp_y), lamp_r, mat('lamp'), group=8))
    else:
        objs.append(ball('lamp_off', (0, lamp_y - 0.1), lamp_r * 0.9, mat('crimson'), group=8))


@projectile('mineHeavy', (21, 19), mode='loop', frames=4, frame_ticks=8,
            materials=('plate', 'orange', 'accent', 'steel', 'crimson', 'lamp'))
def mine_heavy(a):
    """
    The siege mine: not a disc but a horned sea mine, a dark ball with a steel belt and a
    orange belt, four horns and the blinking cap on top, stalking on six crab legs.
    """
    h, R, leg_r = 19, 4.6, 0.8
    ground = -h / 2 + 1.0
    bob = -0.3 if a in (1, 3) else 0.0
    cy = ground + 2.0 + R + bob
    objs = []
    for side in (-1, 1):
        for d, spread in ((2.4, 1.0), (-2.4, 1.0), (0.0, 1.25)):
            hip = (side * R * 0.5, cy - R * 0.6)
            knee = (side * (R + 1.2 * spread), cy - R * 0.35)
            foot = (side * (R + 2.2 * spread), ground + leg_r + 0.1)
            objs.append(rod(f'thigh{side}{d}', hip, knee, leg_r, mat('steel'), d=d, group=5))
            objs.append(rod(f'shin{side}{d}', knee, foot, leg_r, mat('steel'), d=d, group=5))
    objs.append(ball('body', (0, cy), R, mat('plate'), group=1))
    objs.append(stand(lathe('belt', [(-0.8, R + 0.3), (0.8, R + 0.3)], mat('orange'), group=2), cy - 0.3))
    for k, t in enumerate((22, 158, 68, 112)):
        c, s_ = math.cos(math.radians(t)), math.sin(math.radians(t))
        dd = 0.0 if k < 2 else 1.8
        # Hertz horns: stubby steel posts with knobbed ends, fat enough to survive 1x.
        objs.append(rod(f'horn{k}', ((R - 0.8) * c, cy + (R - 0.8) * s_), ((R + 1.4) * c, cy + (R + 1.4) * s_),
                        0.75, mat('steel'), d=dd, group=7))
        objs.append(ball(f'knob{k}', ((R + 1.5) * c, cy + (R + 1.5) * s_), 1.0, mat('steel'), d=dd, group=7))
    lamp_on_cap(objs, a, cy + R - 0.6, 1.8, 1.35)
    return objs
