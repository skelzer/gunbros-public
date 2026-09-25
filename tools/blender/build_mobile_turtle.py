"""
Armoured turtle (the roster's `turtle`): a war tortoise with a brass water cannon.

    blender --background --python build_mobile_turtle.py -- --out work/turtle --scale 4

A high teal carapace laid with real scutes (a row of costal plates on the flank, a row
of vertebral plates over the ridge with blunt armour knobs, a lip of marginal plates),
a cream plastron underneath, a red harness strap over the back, and a riveted steel
turret ring holding a banded brass cannon. Four column legs with bone claws, a short
pointed tail, and a snapping-turtle head on a thick neck: a hooked bone beak and a
steel helmet whose brim sits low over a small fierce eye.

The scutes are not caps stuck on a ball: each one is a heightfield patch on the shell
ellipsoid, laid out in the side view (rows follow the dome, the joints between plates
radiate from the centre) and gently domed, alternating between two part groups per row
so the id pass draws every joint. Legs, neck, tail, beak and cannon are tapered bezier
tubes (`tube` from the wyvern). The cannon is the `barrel` layer, modelled horizontal.
All sizes are sprite pixels at 1x.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import creature as cr  # noqa: E402
import render_common as rc  # noqa: E402
from build_mobile_wyvern import tube  # noqa: E402
from parts import plant_z  # noqa: E402
from render_common import px  # noqa: E402

# Contract with the simulation (packages/shared, turtle sprite): pivot 2 px ahead of and
# 35 px above the anchor, muzzle 23 px along the cannon.
PIVOT_DX = 2
PIVOT_UP = 35
BARREL_LENGTH = 23

NEAR_Y = -13
NEAR_LEG_Y = -8.5
NEAR_FOOT_DROP = 0.6
SHELL_C = (-4, 0, 10)          # the dome is the top half of this ellipsoid
SHELL_R = (18, 13.5, 17)
PLATE_GROW = 0.6               # scutes sit this far proud of the shell

STATES = {
    'idle': (8, 9, True),
    'move': (6, 6, True),
    'charge': (2, 7, True),
    'fire': (5, 5, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}

# Glow groups are matched by number across layers: the barrel's flash shares 26 with
# the body's fire, and nothing solid uses 25 or 26.
PART_GROUPS = (
    ('legfar', 1), ('tail', 2), ('plastron', 3), ('legnear', 4), ('claw', 5), ('neck', 6),
    ('jaw', 7), ('head', 8), ('beak', 9), ('eye', 10), ('pupil', 11), ('mouth', 11), ('glint', 13), ('helmet', 12), ('brim', 13),
    ('shell', 14), ('marga', 15), ('margb', 16), ('costa', 17), ('costb', 18), ('verta', 19),
    ('vertb', 20), ('knob', 21), ('strap', 22), ('mount', 23), ('flag', 24), ('wreck', 23),
    ('smoke', 24), ('boom', 25), ('fire', 26),
    ('hinge', 1), ('cannon', 2), ('band', 3), ('muzzle', 4), ('bore', 5), ('flash', 26),
)


# --------------------------------------------------------------------------
# Shell geometry
# --------------------------------------------------------------------------

def _dome_height(x, grow):
    cx, _, _ = SHELL_C
    a, _, c = (r + grow for r in SHELL_R)
    return c * math.sqrt(max(0.0, 1 - ((x - cx) / a) ** 2))


def _dome_depth(x, z, grow):
    """How far towards the camera (negative y) the grown shell surface lies at (x, z)."""
    cx, _, cz = SHELL_C
    a, b, c = (r + grow for r in SHELL_R)
    return b * math.sqrt(max(0.0, 1 - ((x - cx) / a) ** 2 - ((z - cz) / c) ** 2))


def scute(name, bottom, top, f0, f1, material, bulge=0.45, side=-1, nu=8, nv=6):
    """
    One plate on the shell. `bottom` and `top` are its (x0, x1) at dome fractions `f0`
    and `f1` (0 is the rim, 1 the ridge); its edges run along the dome between them.
    Built as a heightfield on the grown ellipsoid, domed by `bulge` in the middle and
    given a little thickness. `side` -1 is the near half, +1 the far half.
    """
    cz = SHELL_C[2]
    bm = bmesh.new()
    grid = []
    for j in range(nv + 1):
        v = j / nv
        f = f0 + (f1 - f0) * v
        row = []
        for i in range(nu + 1):
            u = i / nu
            xb = bottom[0] + (bottom[1] - bottom[0]) * u
            xt = top[0] + (top[1] - top[0]) * u
            x = xb + (xt - xb) * v
            z = cz + f * _dome_height(x, PLATE_GROW)
            d = _dome_depth(x, z, PLATE_GROW) + bulge * math.sin(math.pi * u) * math.sin(math.pi * v)
            row.append(bm.verts.new((px(x), px(side * d), px(z))))
        grid.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(0.8)
    mod.offset = 1 if side < 0 else -1
    return rc.finish(obj, material, smooth=True)


def pennant(name, root, length, height, y, material):
    bm = bmesh.new()
    x, z = root
    vs = [bm.verts.new((px(x), px(y), px(z))), bm.verts.new((px(x), px(y), px(z - height))),
          bm.verts.new((px(x - length), px(y), px(z - height * 0.35)))]
    bm.faces.new(vs)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(0.8)
    return rc.finish(obj, material)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build_leg(tag, hip, y, mats, root, front):
    """A column leg from the hip down to a round foot with three claws. Origin at the hip.
    The column reaches down far enough to plant the foot on the ground row: the far feet
    further, by what the camera tilt lifts them."""
    hx, hz = hip
    fx = hx + (1.5 if front else 0.5)
    side = 'near' if y < 0 else 'far'
    fz = -NEAR_FOOT_DROP + (plant_z(y, NEAR_LEG_Y) if side == 'far' else 0)
    parts = [
        tube(f'{tag}_limb', [(hx, y, hz), (hx + 0.8, y - 0.3, hz - 5), (fx, y - 0.4, 3 + fz)], (4.6, 3.9, 4.1),
             mats['skin']),
        cr.blob(f'{tag}_foot', (fx + 0.8, y - 0.4, 1.9 + fz), (4.8, 4.2, 1.9), mats['skin'], 16, 8),
    ]
    for k in range(3):
        c = cr.cone(f'claw_{side}_{tag}_{k}', 1.0, 0, 2.4, (fx + 5.2, y - 0.4 + (k - 1) * 2.2, 1.0 + fz),
                    mats['bone'], axis='X', vertices=6)
        c.rotation_euler = (0, math.radians(20), 0)
        parts.append(c)
    leg = rc.add_empty(f'hip_{tag}', (px(hx), px(y), px(hz)))
    for o in parts:
        rc.parent_keep(o, leg)
    rc.parent_keep(leg, root)
    return leg, parts


def build_turtle(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    shell_grp = rc.add_empty('shell_grp', (px(SHELL_C[0]), 0, px(10)))   # shell, mount, cannon
    rc.parent_keep(shell_grp, root)

    # --- legs and tail ------------------------------------------------------------
    legs, far_parts, near_parts = {}, [], []
    for name, (hx, y, front) in {'far_rear': (-13, 8, False), 'far_front': (10, 8, True),
                                 'near_rear': (-15, NEAR_LEG_Y, False), 'near_front': (8, NEAR_LEG_Y, True)}.items():
        tag = ('legfar_' if y > 0 else 'legnear_') + name
        leg, parts = build_leg(tag, (hx, 11), y, mats, root, front)
        legs[name] = leg
        (far_parts if y > 0 else near_parts).extend(parts)
    rig['legs'] = legs
    tail = tube('tail', [(-19, 0, 9), (-25, -1, 7), (-30, -1.5, 4)], (3.2, 2.0, 0.3), mats['skin'], squash=0.8)
    rc.parent_keep(tail, shell_grp)

    # --- head: big, round and friendly, in a little steel helmet -----------------------
    head_grp = rc.add_empty('head_grp', (px(15), 0, px(15)))
    neck = tube('neck', [(5, 0, 12), (11, 0, 13.5), (16, 0, 16)], (5.0, 4.4, 4.2), mats['skin'], squash=0.9)
    cranium = cr.blob('head', (20, 0, 19), (8.2, 6.6, 7.4), mats['skin'], 32, 16)
    jaw = tube('jaw', [(16.5, 0, 14), (22, 0, 13), (27, 0, 14.2)], (3.8, 3.2, 1.6), mats['skin'], squash=0.85)
    beak = tube('beak', [(25.5, 0, 18.4), (29, 0, 17.4), (30.2, 0, 15.4)], (3.4, 2.6, 0.9), mats['bone'], squash=0.8)
    smile = tube('mouth', [(22.6, -6.5, 16.9), (25, -5.3, 15.8), (27.4, -3.6, 16.3)], (0.55, 0.55, 0.45), mats['ink'])
    helmet = cr.band('helmet', (20, 0, 19), (8.2, 6.6, 7.4), 0.8, (18, 16, 4), (19, 0, 26.2), mats['steel'], tilt_deg=6)
    spike = cr.cone('helmet_spike', 1.2, 0.2, 2.8, (18.5, 0, 27.6), mats['steel'], vertices=8, tilt_deg=-15)
    brim = rc.add_box('brim', (px(5), px(1.0), px(1.0)), (px(23.5), px(-6.2), px(24.4)), mats['steel'], bevel=px(0.25))
    brim.rotation_euler = (0, math.radians(-6), 0)
    eye, eye_parts = cr.eye('0', (22.6, -6.9, 19.6), 3.4, mats, pupil_r=1.8, look=1.0)
    glint = rc.add_cylinder('glint_0', px(0.75), px(0.8), (px(24.1), px(-8.2), px(20.6)), mats['eye'], vertices=8, smooth=False)
    rc.parent_keep(glint, eye)
    eye_parts.append(glint)
    face = [neck, cranium, jaw, beak, smile, helmet, spike, brim] + eye_parts
    for o in [neck, cranium, jaw, beak, smile, helmet, spike, brim, eye]:
        rc.parent_keep(o, head_grp)
    rc.parent_keep(head_grp, root)
    rig.update(eyes=[eye], head_grp=head_grp, jaw=jaw)

    # --- shell ----------------------------------------------------------------------
    cx, _, cz = SHELL_C
    shell = cr.blob('shell', SHELL_C, SHELL_R, mats['shell'], 32, 16)
    under = rc.add_box('cut_under', (px(50), px(40), px(20)), (px(cx), 0, px(cz - 10)), mats['shell'])
    rc.boolean_cut(shell, under)
    rc.parent_keep(under, shell)
    plastron = cr.blob('plastron', (cx + 1, 0, cz - 1.2), (SHELL_R[0] - 1, SHELL_R[1] - 1.5, 3.2), mats['bone'], 32, 12)

    # Marginal plates: a lip of the shell around the rim, sliced into alternating slabs.
    lip_edges = (-24, -18, -12.5, -7, -1.5, 4, 9.5, 16)
    marginals = []
    for k, (x0, x1) in enumerate(zip(lip_edges, lip_edges[1:])):
        m = cr.band(f'{("marga", "margb")[k % 2]}_{k}', (cx, 0, cz - 0.2), (SHELL_R[0] + 2.4, SHELL_R[1] + 2.4, 3.2),
                    0, (x1 - x0, 40, 10), ((x0 + x1) / 2, 0, cz), mats['shell'])
        marginals.append(m)

    # Costal plates on the flank, vertebral plates over the ridge (near and far halves),
    # the joints between them fanning out from the centre of the dome.
    lo, hi = cx - SHELL_R[0] - 0.6, cx + SHELL_R[0] + 0.6
    costal_x = (lo, -14, -4.5, 5, hi)
    plates = []
    for k, (x0, x1) in enumerate(zip(costal_x, costal_x[1:])):
        top = tuple(x if x in (lo, hi) else cx + (x - cx) * 0.72 for x in (x0, x1))
        plates.append(scute(f'{("costa", "costb")[k % 2]}_{k}', (x0, x1), top, 0.16, 0.6, mats['shell']))
    vert_x = (lo, -12.5, -3.5, 5.5, hi)
    for k, (x0, x1) in enumerate(zip(vert_x, vert_x[1:])):
        top = tuple(x if x in (lo, hi) else cx + (x - cx) * 0.8 for x in (x0, x1))
        for side in (-1, 1):
            plates.append(scute(f'{("verta", "vertb")[k % 2]}_{k}_{side}', (x0, x1), top, 0.6, 1.0, mats['shell'], side=side))
    knobs = []
    for k, x in enumerate((-17, -9, 10)):
        z = cz + _dome_height(x, PLATE_GROW) - 0.4
        knobs.append(cr.cone(f'knob_{k}', 2.4, 0.3, 4.0, (x, 0, z + 2.2), mats['shell'], vertices=5, flat=True,
                             tilt_deg=math.degrees(math.atan2(-(x - cx) / SHELL_R[0], 1)) * 0.8 - 10))

    # Harness strap over the back, under the turret ring.
    strap = cr.band('strap', SHELL_C, SHELL_R, 2.1, (3.2, 40, 20), (2.6, 0, cz + 10.5), mats['accent'], tilt_deg=-8)

    # --- turret ring and cannon cradle -------------------------------------------------
    pivot_z = proj.z_for_height(PIVOT_UP) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT_DX), 0, px(pivot_z)))
    ring_z = cz + _dome_height(PIVOT_DX - 1, 0) + 0.6
    ring = rc.add_cylinder('mount_ring', px(6.2), px(3.0), (px(PIVOT_DX - 1), 0, px(ring_z)), mats['steel'], axis='Z', vertices=24)
    cheeks = []
    for y in (-3.6, 3.6):
        c = rc.add_box(f'mount_cheek_{y}', (px(6.5), px(1.4), px(pivot_z - ring_z + 1)),
                       (px(PIVOT_DX - 0.5), px(y), px((pivot_z + ring_z) / 2 + 0.5)), mats['steel'], bevel=px(0.5))
        cheeks.append(c)
    mast = rc.add_cylinder('flag_mast', px(0.7), px(11), (px(-15), px(-2), px(28)), mats['steel'], axis='Z', vertices=8)
    flag = pennant('flag', (-15.3, 33.2), 7, 4.4, -2.6, mats['accent'])
    rig['flag'] = flag

    shell_parts = [shell, plastron, strap, ring, mast, flag] + cheeks + marginals + plates + knobs
    for o in shell_parts:
        rc.parent_keep(o, shell_grp)
    rig['shell_grp'] = shell_grp

    body.extend(far_parts + [tail, plastron, shell] + marginals + plates + knobs + [strap, ring] + cheeks
                + [mast, flag] + near_parts + face)

    # --- the cannon: barrel layer -------------------------------------------------------
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, shell_grp)
    px0, pz = PIVOT_DX, pivot_z
    hinge = rc.add_cylinder('hinge', px(1.8), px(9.4), pivot_w, mats['steel'], axis='Y', vertices=16)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    breech = tube('cannon_breech', [(px0 - 8, 0, pz), (px0 - 5, 0, pz), (px0 - 1, 0, pz)], (3.2, 4.0, 3.7), mats['amber'])
    barrel_tube = tube('cannon_tube', [(px0 - 2, 0, pz), (px0 + 9, 0, pz), (px0 + 20, 0, pz)], (3.3, 2.9, 2.6), mats['amber'])
    knob = rc.add_sphere('band_knob', px(1.8), (px(px0 - 9.2), 0, px(pz)), mats['steel'], segments=12, rings=6)
    bands = [rc.add_cylinder(f'band_{k}', px(r), px(w), (px(px0 + x), 0, px(pz)), mats['steel'], axis='X', vertices=20)
             for k, (x, r, w) in enumerate(((-3.2, 4.0, 1.4), (6.5, 3.4, 1.4)))]
    muzzle = cr.cone('muzzle', 2.8, 3.9, 3.6, (px0 + BARREL_LENGTH - 1.8, 0, pz), mats['steel'], axis='X', vertices=20)
    bore = rc.add_cylinder('bore', px(2.3), px(0.6), (px(px0 + BARREL_LENGTH - 0.2), 0, px(pz)), mats['ink'], axis='X',
                           vertices=12, smooth=False)
    for o in [breech, barrel_tube, knob, muzzle, bore] + bands:
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    rc.parent_keep(hinge, pivot)
    barrel.extend([hinge, breech, barrel_tube, knob] + bands + [muzzle, bore])
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH + 5), px(-6), 0)), 6.5, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig['pivot'] = pivot
    rig['tube_grp'] = tube_grp

    # --- death props (body layer) -----------------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-15), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    wreck = rc.add_empty('wreck_grp', (0, px(-15), 0))
    wreck_parts = [rc.add_cylinder('wreck_cannon', px(2.9), px(BARREL_LENGTH + 2), (0, px(-15), 0), mats['amber'], axis='X', vertices=16),
                   rc.add_cylinder('wreck_band', px(3.5), px(1.6), (px(-5), px(-15), 0), mats['steel'], axis='X', vertices=16),
                   rc.add_cylinder('wreck_muzzle', px(3.6), px(3), (px(11.5), px(-15), 0), mats['steel'], axis='X', vertices=16)]
    for o in wreck_parts:
        o.visible_shadow = False
        rc.parent_keep(o, wreck)
    rc.parent_keep(wreck, root)
    for o in smoke:
        o.visible_shadow = False
        rc.parent_keep(o, root)
    body.extend(smoke + wreck_parts)
    rig['boom'] = rc.add_fire('boom', mats, (pivot_w.x + px(4), px(-16), pivot_w.z), 14, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(1), px(-15), px(26)), 5.2, root)
    body.extend(rig['boom'] + rig['fire_a'])
    rig['smoke'] = smoke
    rig['wreck'] = wreck

    rig['face'] = [head_grp]
    rig['tail'] = tail
    rig['layers'] = {'body': body, 'barrel': barrel}
    rig['rest'] = cr.snapshot([shell_grp, head_grp, tube_grp, flag, jaw, eye, wreck] + list(legs.values()))
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def step(phase, stride=3, lift=2):
    """Leg offset (dx, dz) through one step: planted and sliding back, then lifted forwards."""
    phase %= 1.0
    if phase < 0.5:
        return round(stride - 4 * stride * phase), 0
    u = (phase - 0.5) / 0.5
    return round(-stride + 2 * stride * u), round(lift * math.sin(math.pi * u))


def pose(rig, mats, palette, state, i):
    shell, head, tube_grp, flag, jaw = rig['shell_grp'], rig['head_grp'], rig['tube_grp'], rig['flag'], rig['jaw']
    cr.restore(rig['rest'])
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['face'], False)
    rc.hide(list(rig['legs'].values()) + [rig['tail']], False)
    rc.hide(rig['smoke'], True)
    rc.hide([rig['wreck']], True)
    for fire in (rig['flash'], rig['boom'], rig['fire_a']):
        rc.pose_fire(fire, 0)
    rc.set_burnt(mats, palette, False, hues=('shell', 'skin', 'bone', 'amber', 'steel'))

    def squint(k):
        cr.lids(rig['eyes'], k)

    def snap(deg):
        jaw.rotation_euler.y = math.radians(deg)

    if state == 'idle':
        shell.location.z += px((0, 0, -1, -1, -1, -1, 0, 0)[i])      # slow breathing
        head.location.z += px((0, 0, 0, -1, -1, -1, -1, 0)[i])
        flag.location.z += px((0, 0, 0, 0, 1, 1, 1, 1)[i])
        if i == 6:
            squint(0.15)                                             # blink

    elif state == 'move':
        n = STATES['move'][0]
        for name, leg in rig['legs'].items():
            diagonal = name in ('near_front', 'far_rear')
            dx, dz = step(i / n + (0 if diagonal else 0.5))
            leg.location.x += px(dx)
            leg.location.z += px(dz)
        shell.location.z += px((0, -1, 0, 0, -1, 0)[i])
        head.location.z += px((0, 0, -1, 0, 0, -1)[i])
        head.location.x += px((0, 1, 1, 0, 1, 1)[i])
        flag.location.z += px((0, 1, 1, 0, 1, 1)[i])

    elif state == 'charge':
        # Held while the player charges: it ducks behind its shell and braces the cannon.
        shell.location.z += px(-1)
        head.location.x += px((-4, -3)[i])
        head.location.z += px(-1)
        tube_grp.location.x += px((-3, -2)[i])
        flag.location.z += px((0, 1)[i])
        squint(0.45)

    elif state == 'fire':
        tube_grp.location.x += px((-6, -5, -3, -1, 0)[i])
        shell.location.x += px((-2, -1, -1, 0, 0)[i])
        head.location.x += px((-3, -3, -2, -1, 0)[i])
        head.location.z += px((-1, -1, -1, 0, 0)[i])
        squint((0.3, 0.3, 0.6, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        shell.location.x += px((-2, 1, 0)[i])
        shell.location.z += px((1, 0, 0)[i])
        head.location.x += px((-5, -3, -1)[i])
        snap((14, 8, 0)[i])
        squint((0.2, 0.2, 0.6)[i])

    elif state == 'death':
        # The cannon blows, and the turtle does what turtles do: head and legs go in,
        # the shell drops to the ground, rocks and settles under a little smoke.
        t = i - 2
        if i == 0:
            shell.location.z += px(1)
            squint(0.2)
            rc.pose_fire(rig['boom'], 0.42)
        elif i == 1:
            squint(0.2)
            snap(16)
            head.location.x += px(-2)
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.set_burnt(mats, palette, True, hues=('shell', 'bone', 'amber', 'steel'))
            rc.hide(rig['layers']['barrel'], True)
            squint(0.2)
            head.location.x += px((-6, -12, -12, -12, -12)[t])
            rc.hide(rig['face'], t >= 2)
            tuck = (1.0, 0.6, 0, 0, 0)[t]
            for leg in rig['legs'].values():
                leg.scale = (max(tuck, 0.01),) * 3
            rc.hide(list(rig['legs'].values()), tuck == 0)
            rc.hide([rig['tail']], t >= 1)
            drop = (-1, -3, -5, -4, -5)[t]
            shell.location.z += px(drop)
            shell.rotation_euler.y = math.radians((0, 3, 7, -5, 0)[t])
            w = rig['wreck']
            rc.hide([w], False)
            w.location = (px((-8, -14, -16, -16, -16)[t]), px(-15), px((42, 38, 18, 6, 5)[t]))
            w.rotation_euler = (0, math.radians((-40, -100, -150, -172, -176)[t]), 0)
            rc.pose_fire(rig['boom'], (0.75, 0.38, 0, 0, 0)[t])
            rc.pose_fire(rig['fire_a'], (0.5, 0.9, 1.0, 0.85, 0.95)[t], lean_deg=(0, -8, 7, -6, 5)[t], at=(1, 29 + drop))
            rc.hide(rig['smoke'], t < 2)
            for s, (sx, sz, k) in zip(rig['smoke'], ((-3, 36, 0.9), (-7, 43, 0.6))):
                grow = k * (0, 0, 0.8, 1.0, 0.9)[t]
                s.location = (px(sx), px(-15), px(sz + (0, 0, 0, 2, 3)[t]))
                s.scale = (grow, grow, grow)


if __name__ == '__main__':
    rc.run_mobile(
        name='turtle', canvas=(88, 66), anchor=(44, 63), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('shell', 'skin', 'bone', 'amber', 'steel', 'accent', 'smoke', 'eye', 'ink', 'lamp', 'flame', 'flash'),
        build=build_turtle, pose=pose)
