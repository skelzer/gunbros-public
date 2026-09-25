"""
Fire-breathing wyvern (roster id `dragon`): model, poses, layered renders.

    blender --background --python build_mobile_wyvern.py -- --out work/wyvern --scale 4

A chibi crimson dragon that stands up on its haunches: a pear-shaped body with a
segmented cream belly, thick digitigrade hind legs and little clawed arms, an amber
bat wing on each side (membrane stretched between finger bones with a scalloped
trailing edge, the far one peeking over the back), a long tapered tail that curls up
into a spade, and a short S neck up to a wedge head: a cranium with a brow ridge
over a gold slit eye, a muzzle with nostrils, swept-back curved horns, cheek frills
and a jaw that drops open on a dark maw with fangs.

Tails, necks, limbs and horns are bezier curves with a tapered bevel rather than
chains of blobs; the wings are a fan mesh built from the finger layout, cupped between
the fingers so the toon ramp shades each panel. The mouth is the gun and there is
nothing to model for it, so the `barrel` layer holds only the flame: a glow in the
jaws while it charges and a jet on `fire`, turned to the aim by the client.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import creature as cr  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (24, 35)
BARREL_LENGTH = 6
NEAR_Y = -13
LEG_YS = {'far': 8, 'near': -8.5}

# Glow groups are shared across layers by number, so the barrel's flash takes the same
# number as the body's fire and nothing solid loses its part lines.
PART_GROUPS = (
    ('wingfar', 1), ('legfar', 2), ('tail', 3), ('spike', 4), ('body', 5), ('bellya', 6), ('bellyb', 7),
    ('legnear', 8), ('claw', 9), ('arm', 10), ('maw', 11), ('jaw', 12), ('head', 13), ('snout', 14),
    ('brow', 15), ('fang', 16), ('horn', 17), ('frill', 18), ('eye', 19), ('pupil', 20), ('wing', 21),
    ('wbone', 22), ('puff', 23), ('smoke', 24), ('boom', 25), ('fire', 26),
    ('glow', 23), ('flash', 26),
)
HUES = ('crimson', 'orange', 'amber', 'bone')


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def tube(name, pts, radii, material, squash=1.0, resolution=6):
    """A smooth bezier tube through `pts` whose thickness follows `radii`; the tip can
    taper to a point. `squash` flattens it across y. Converted to a mesh."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(1)
    cu.bevel_resolution = 4
    cu.resolution_u = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(pts) - 1)
    for bp, p, r in zip(sp.bezier_points, pts, radii):
        bp.co = Vector(tuple(px(c) for c in p))
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
        bp.radius = r
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = name
    if squash != 1.0:
        c = sum((v.co for v in obj.data.vertices), Vector()) / len(obj.data.vertices)
        for v in obj.data.vertices:
            v.co.y = c.y + (v.co.y - c.y) * squash
    return rc.finish(obj, material, smooth=True)


def membrane(name, root, outline, y, material, bulge=1.6, rings=4, cols=4):
    """
    A wing membrane fanned out from `root` (x, z) over the `outline` points, lying in
    the plane at depth `y`. Every fan panel is a small grid pushed towards the camera
    in its middle, so each panel between two fingers reads as a cupped sail.
    """
    bm = bmesh.new()
    rx, rz = root
    for a, b in zip(outline, outline[1:]):
        grid = []
        for r in range(rings + 1):
            row = []
            for c in range(cols + 1):
                t, u = r / rings, c / cols
                x = rx + t * ((a[0] - rx) * (1 - u) + (b[0] - rx) * u)
                z = rz + t * ((a[1] - rz) * (1 - u) + (b[1] - rz) * u)
                dy = -bulge * math.sin(math.pi * u) * math.sin(math.pi * min(t, 0.999) * 0.9)
                row.append(bm.verts.new((px(x), px(y + dy), px(z))))
            grid.append(row)
        for r in range(rings):
            for c in range(cols):
                bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=px(0.05))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(0.9)
    mod.offset = 0
    return rc.finish(obj, material, smooth=True)


def sliced(name, centre, radii, tilt_deg, slabs, material, groups):
    """An ellipsoid cut into plates across its long axis: each slab (offset along the
    axis, thickness) becomes its own object, alternating between `groups`, so the id
    pass draws a line between neighbouring plates."""
    plates = []
    t = math.radians(tilt_deg)
    axis = Vector((-math.sin(t), 0, math.cos(t)))        # the ellipsoid's tilted z axis
    for k, (off, thick) in enumerate(slabs):
        shell = cr.blob(f'{groups[k % 2]}_{k}', centre, radii, material, 32, 16)
        shell.rotation_euler = (0, t, 0)
        c = Vector(tuple(px(v) for v in centre)) + axis * px(off)
        box = rc.add_box(f'cut_{name}_{k}', (px(40), px(40), px(thick)), c, material)
        box.rotation_euler = (0, t, 0)
        mod = shell.modifiers.new('Slab', 'BOOLEAN')
        mod.operation = 'INTERSECT'
        mod.object = box
        box.hide_render = True
        box.hide_viewport = True
        rc.parent_keep(box, shell)
        plates.append(shell)
    return plates


def spike(name, at, size, tilt_deg, material):
    return cr.cone(name, size * 0.55, 0.15, size * 1.6, at, material, vertices=4, flat=True, tilt_deg=tilt_deg)


def claws(tag, at, material, n=3, size=1.2, spread=2.0, tilt_deg=0.0):
    x, y, z = at
    out = []
    for k in range(n):
        c = cr.cone(f'claw_{tag}_{k}', size, 0, size * 2.6, (x, y + (k - (n - 1) / 2) * spread, z), material, axis='X', vertices=6)
        c.rotation_euler = (0, math.radians(tilt_deg), 0)
        out.append(c)
    return out


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build_leg(side, y, mats, root):
    """Thigh, shin and foot of one hind leg, origin at the hip. Returns (leg, parts)."""
    tag = 'legnear' if side == 'near' else 'legfar'
    thigh = cr.blob(f'{tag}_thigh', (-5, y, 12), (8, 4.5, 9.5), mats['crimson'], 24, 12)
    thigh.rotation_euler = (0, math.radians(-18), 0)
    shin = tube(f'{tag}_shin', [(-8, y, 7), (-6, y, 3.5), (-2, y, 2.4)], (3.4, 2.8, 2.6), mats['crimson'])
    foot = cr.blob(f'{tag}_foot', (1, y, 2.3), (5.5, 3.6, 2.3), mats['crimson'], 16, 8)
    toes = claws(f'{side}_foot', (6.4, y, 1.8), mats['bone'], size=1.1, spread=2.1)
    leg = rc.add_empty(f'hip_{side}', (px(-5), px(y), px(15)))
    for o in [thigh, shin, foot] + toes:
        rc.parent_keep(o, leg)
    rc.parent_keep(leg, root)
    return leg, [thigh, shin, foot] + toes, foot


def build_wing(side, y, mats, parent):
    """
    Bat wing hinged at the shoulder. In the wing's own (x, z), relative to the shoulder:
    the arm runs up to the elbow and on to the wrist, three fingers fan backwards from
    the wrist, and the membrane runs between them with a scalloped trailing edge back
    to the flank. Returns the hinge empty and its parts.
    """
    tag = 'wing' if side == 'near' else 'wingfar'
    bone_tag = 'wbone' if side == 'near' else 'wingfar_bone'
    sx, sz = (-6, 27)
    elbow, wrist = (-4, 10), (-7, 19)
    tips = [(-25, 14), (-28, 3), (-19, -4)]
    flank = (-8, -5)

    def w(p):
        return (sx + p[0], sz + p[1])

    def scallop(a, b, k=0.3):
        m = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        return (m[0] + (wrist[0] - m[0]) * k, m[1] + (wrist[1] - m[1]) * k)

    edge = [elbow, (0, 0), flank, scallop(flank, tips[2], 0.22), tips[2], scallop(tips[2], tips[1]),
            tips[1], scallop(tips[1], tips[0]), tips[0]]
    sail = membrane(f'{tag}_sail', w(wrist), [w(p) for p in edge], y, mats['orange'], bulge=0.8)
    bones = [tube(f'{bone_tag}_arm', [(sx, y - 0.6, sz), (sx + elbow[0], y - 0.8, sz + elbow[1]),
                                      (sx + wrist[0], y - 0.8, sz + wrist[1])], (2.0, 1.6, 1.4), mats['crimson'])]
    for k, tip in enumerate(tips):
        bones.append(tube(f'{bone_tag}_finger_{k}', [(sx + wrist[0], y - 0.8, sz + wrist[1]),
                                                     (sx + tip[0], y - 0.8, sz + tip[1])], (1.2, 0.35), mats['crimson']))
    talon = cr.cone(f'{"claw" if side == "near" else "wingfar"}_talon', 1.4, 0, 4.4,
                    (sx + wrist[0] + 1.5, y - 1, sz + wrist[1] + 1.5), mats['bone'], axis='X')
    talon.rotation_euler = (0, math.radians(-40), 0)
    hinge = rc.add_empty(f'shoulder_{side}', (px(sx), px(y), px(sz)))
    for o in [sail, talon] + bones:
        rc.parent_keep(o, hinge)
    rc.parent_keep(hinge, parent)
    return hinge, [sail] + bones + [talon]


def build(mats, proj):
    body_layer, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))

    # Everything above the feet bobs together.
    beast = rc.add_empty('beast', (px(-4), 0, px(10)))
    rc.parent_keep(beast, root)

    legs, legs_parts, feet = {}, [], {}
    for side, y in LEG_YS.items():
        leg, parts, foot = build_leg(side, y, mats, root)
        legs[side], feet[side] = leg, foot
        legs_parts.append(parts)

    # Body: a round belly with the chest pushed up and forward, tilted like a sitting
    # animal, and a cream belly cut into plates.
    torso = cr.blob('body_torso', (-3, 0, 16.5), (13, 11, 12.5), mats['crimson'], 32, 16)
    torso.rotation_euler = (0, math.radians(-22), 0)
    chest = cr.blob('body_chest', (4, 0, 24), (8.5, 9, 9), mats['crimson'], 24, 12)
    neck = tube('body_neck', [(3, 0, 25), (9, 0, 31), (10, 0, 37)], (7.2, 6.2, 5.6), mats['crimson'], squash=0.95)
    plates = sliced('belly', (3.5, -1.5, 18.5), (9, 9.2, 14.5), -26,
                    [(-11, 3.4), (-7.2, 3.6), (-3.4, 3.6), (0.4, 3.6), (4.2, 3.6), (8, 3.6), (11.8, 3.6)],
                    mats['bone'], ('bellya', 'bellyb'))
    throat = sliced('throat', (11.5, -1, 32), (3.4, 5, 6), -30, [(-2.8, 3), (0.4, 3), (3.4, 3)],
                    mats['bone'], ('bellyb', 'bellya'))

    # Tail in two hinged pieces so it can swish: a thick root on the ground and a tip
    # that curls up into a spade.
    tail = tube('tail_root', [(-12, 0, 10), (-20, -1, 5), (-28, -2, 4)], (6.5, 4.6, 3.6), mats['crimson'])
    rc.set_origin(tail, (px(-12), 0, px(10)))
    tip = tube('tail_tip', [(-27, -2, 4), (-35, -3, 5), (-40, -3.5, 9.5), (-40.5, -3.5, 14)], (3.7, 2.8, 1.9, 1.2), mats['crimson'])
    rc.set_origin(tip, (px(-27), px(-2), px(4)))
    spade = cr.cone('tail_spade', 3.6, 0.2, 6.5, (-40.2, -3.5, 16.5), mats['crimson'], vertices=4, flat=True, tilt_deg=8)
    spade.scale = (1, 0.35, 1)
    rc.parent_keep(spade, tip)
    rc.parent_keep(tip, tail)
    tail_spikes = [spike(f'spike_tail_{k}', p, s, t, mats['amber'])
                   for k, (p, s, t) in enumerate((((-17, 0, 10.5), 2.2, -60), ((-24, -1, 7.5), 1.8, -72)))]
    for s in tail_spikes[:2]:
        rc.parent_keep(s, tail)

    # Dorsal spikes from the back of the head down the neck and back.
    back_spikes = [spike(f'spike_back_{k}', p, s, t, mats['amber'])
                   for k, (p, s, t) in enumerate((((4, 0, 37.5), 2.4, -40), ((0, 0, 33.5), 2.6, -48),
                                                  ((-5.5, 0, 29), 2.7, -55), ((-11, 0, 24), 2.5, -65),
                                                  ((-14.5, 0, 17.5), 2.2, -80)))]

    arms = {}
    arm_parts = []
    for side, y in (('far', 7.5), ('near', -11)):
        tag = 'arm' if side == 'near' else 'legfar_arm'
        a = tube(f'{tag}', [(8, y, 24), (10, y - 0.5, 19), (14, y - 0.8, 18)], (2.6, 2.1, 1.9), mats['crimson'])
        hand = claws(f'{side}_hand', (15.5, y - 0.8, 17.6), mats['bone'], n=2, size=0.9, spread=1.6, tilt_deg=25)
        rc.set_origin(a, (px(8), px(y), px(24)))
        for c in hand:
            rc.parent_keep(c, a)
        arms[side] = a
        arm_parts.append([a] + hand)

    far_wing, far_wing_parts = build_wing('far', 11, mats, beast)
    near_wing, near_wing_parts = build_wing('near', -12, mats, beast)

    # Head: one group that rears back when it roars.
    head_grp = rc.add_empty('head_grp', (px(10), 0, px(36)))
    cranium = cr.blob('head', (13, 0, 41.5), (9.5, 8.6, 8.4), mats['crimson'], 32, 16)
    snout = tube('snout', [(16, 0, 39.5), (22, 0, 38.5), (27, 0, 37.6)], (6.2, 5.0, 4.2), mats['crimson'], squash=0.9)
    nose = cr.blob('snout_nose', (27.5, 0, 38.4), (3.2, 3.6, 3.0), mats['crimson'], 16, 8)
    nostril = cr.blob('pupil_nostril', (28.8, -2.6, 39.8), (1.1, 0.6, 0.8), mats['ink'], 8, 4)
    maw = cr.blob('maw', (20, 0, 35), (7, 4.2, 2.6), mats['ink'], 16, 8)
    jaw = tube('jaw', [(13, 0, 35), (19, 0, 33.4), (26, 0, 34)], (4.0, 3.4, 2.4), mats['crimson'], squash=0.9)
    rc.set_origin(jaw, (px(13), 0, px(36)))            # hinges at the back of the mouth
    chin = sliced('chin', (19.5, -0.5, 32.4), (6.5, 3.4, 1.8), 6, [(-2.8, 2.8), (0.2, 3.2), (3.4, 3.2)],
                  mats['bone'], ('bellya', 'bellyb'))
    for c in chin:
        rc.parent_keep(c, jaw)
    fangs = [cr.cone(f'fang_{k}', 0.9, 0, 2.8, (x, -3.8, 35.4), mats['bone'], vertices=6, flat=True, tilt_deg=180)
             for k, x in enumerate((20.5, 25))]
    low_fang = cr.cone('fang_low', 0.8, 0, 2.4, (23, -3.4, 35.3), mats['bone'], vertices=6, flat=True)
    rc.parent_keep(low_fang, jaw)
    brow = cr.blob('brow', (17, -6, 46), (5.6, 3.2, 2.2), mats['crimson'], 16, 8)
    brow.rotation_euler = (0, math.radians(12), 0)
    horns = [tube(f'horn_{k}', [(8.5, y, 46.5), (4, y * 1.1, 50.5), (-1.5, y * 1.2, 51), (-5.5, y * 1.2, 48.5)],
                  (2.0, 1.4, 0.8, 0.1), mats['amber']) for k, y in enumerate((-4.2, 4.2))]
    frills = [cr.cone(f'frill_{k}', 1.5, 0.1, 5.5, (x, -5.5, z), mats['amber'], vertices=4, flat=True, tilt_deg=t)
              for k, (x, z, t) in enumerate(((6.5, 40, -105), (7.5, 36.5, -118)))]
    eye = rc.add_cylinder('eye', px(3.9), px(0.8), (px(17), px(-8.3), px(42.2)), mats['lamp'], vertices=16, smooth=False)
    pupil = rc.add_box('pupil', (px(1.3), px(0.8), px(5.4)), (px(17.8), px(-8.8), px(42.2)), mats['ink'])
    rc.parent_keep(pupil, eye)
    puff = cr.blob('puff', (31, -4, 42), (2.4, 2, 2.4), mats['smoke'], 10, 6)
    puff.visible_shadow = False
    head_parts = [cranium, snout, nose, nostril, maw, jaw, brow, eye, puff] + fangs + horns + frills
    for o in head_parts:
        rc.parent_keep(o, head_grp)

    for o in [torso, chest, neck, tail, head_grp] + plates + throat + back_spikes + list(arms.values()):
        rc.parent_keep(o, beast)
    for s in tail_spikes[2:]:
        rc.parent_keep(s, beast)

    body_layer.extend(far_wing_parts + legs_parts[0] + arm_parts[0] + [tail, tip, spade] + tail_spikes + back_spikes
                      + [torso, chest, neck] + plates + throat + legs_parts[1] + arm_parts[1]
                      + [maw, jaw, low_fang] + chin + [cranium, snout, nose, nostril, brow, eye, pupil, puff]
                      + fangs + horns + frills + near_wing_parts)
    rig.update(beast=beast, head_grp=head_grp, jaw=jaw, eye=eye, tail=tail, tip=tip, puff=puff,
               legs=legs, feet=feet, arms=arms, wing=near_wing, far_wing=far_wing)

    # --- the breath: barrel layer ----------------------------------------------------
    pivot_w = Vector((px(PIVOT[0]), px(-6), px(proj.z_for_height(PIVOT[1], world_y=px(-6)) * rc.PX_PER_UNIT)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, head_grp)
    glow = rc.add_sphere('glow', px(2.6), pivot_w + Vector((px(1.5), px(-2), 0)), mats['flash'], segments=10, rings=6)
    glow.visible_shadow = False
    rc.parent_keep(glow, pivot)
    barrel.append(glow)
    rig['jet'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH + 6), px(-6), 0)), 8, pivot, tall=1)
    barrel.extend(rig['jet'])
    rig.update(pivot=pivot, glow=glow)

    rig['fx'] = cr.death_fx(mats, root, body_layer, (2, 28), 17, y=-18, fires=(5.6, 4.2))
    rig['layers'] = {'body': body_layer, 'barrel': barrel}
    rig['rest'] = cr.snapshot([beast, head_grp, jaw, eye, tail, tip, near_wing, far_wing, puff]
                              + list(legs.values()) + list(arms.values()) + list(feet.values()))
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def step(phase, stride=3, lift=3):
    """Foot offset (dx, dz) in whole pixels over one stride: planted and sliding back,
    then lifted and swung forward."""
    phase %= 1.0
    if phase < 0.5:
        return round(stride - 4 * stride * phase), 0
    u = (phase - 0.5) / 0.5
    return round(-stride + 2 * stride * u), round(lift * math.sin(math.pi * u))


def pose(rig, mats, palette, state, i):
    beast, head, jaw, eye, tail, tip = (rig[k] for k in ('beast', 'head_grp', 'jaw', 'eye', 'tail', 'tip'))
    wing, far_wing = rig['wing'], rig['far_wing']
    cr.restore(rig['rest'])
    eye.data.materials[0] = mats['lamp']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide([rig['glow'], rig['puff']], True)
    rc.pose_fire(rig['jet'], 0)
    cr.reset_fx(rig['fx'])
    rc.set_burnt(mats, palette, False, hues=HUES)
    # The far leg sits deeper, so the tilted camera draws its foot higher: sink the whole
    # (rigid) leg back on to the ground row in every state, on top of any step lift.
    rig['legs']['far'].location.z += px(parts.plant_z(LEG_YS['far'], LEG_YS['near']))

    def roar(deg):
        jaw.rotation_euler.y = math.radians(deg)       # positive drops the jaw

    def wings(swing, flap=0.0, far_lag=0.0):
        """`swing` turns the wings in the side plane (positive raises them forward),
        `flap` folds them towards the camera, which foreshortens the membrane."""
        wing.rotation_euler.y = math.radians(-swing)
        wing.rotation_euler.x = math.radians(flap)
        far_wing.rotation_euler.y = math.radians(-(swing - far_lag))
        far_wing.rotation_euler.x = math.radians(-flap)

    def swish(root_deg, tip_deg):
        tail.rotation_euler.y = math.radians(root_deg)
        tip.rotation_euler.y = math.radians(tip_deg)

    if state == 'idle':
        beast.location.z += px((0, 0, -1, -1, -1, 0)[i])
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        wings((0, 0, 4, 8, 4, 0)[i], far_lag=(0, 2, 4, 2, 0, 0)[i])
        swish(0, (0, 6, 12, 12, 6, 0)[i])
        if i in (1, 2):                                   # the nostril smoulders
            rc.hide([rig['puff']], False)
            rig['puff'].location.z += px((0, 3)[i - 1])
            rig['puff'].scale = ((0.7, 1.0)[i - 1],) * 3
        if i == 4:
            eye.scale = (1, 1, 0.15)

    elif state == 'move':
        # A waddle: the legs alternate, the body rocks from foot to foot and the wings
        # beat once per stride for balance.
        n = 6
        for side, leg in rig['legs'].items():
            dx, dz = step(i / n + (0 if side == 'near' else 0.5))
            leg.location.x += px(dx)
            leg.location.z += px(dz)
        beast.location.z += px((0, 1, 0, 0, 1, 0)[i])
        beast.location.x += px((0, 0, 1, 1, 0, 0)[i])
        head.location.z += px((0, 0, 1, 0, 0, 1)[i])
        wings((0, 10, 18, 10, 0, -4)[i], flap=(0, 25, 40, 25, 0, 0)[i], far_lag=4)
        swish((-6, -3, 3, 6, 3, -3)[i], (-10, -4, 6, 12, 6, -4)[i])
        for side, arm in rig['arms'].items():
            arm.rotation_euler.y = math.radians((-12, 0, 12, 12, 0, -12)[(i + (0 if side == 'near' else 3)) % 6])

    elif state == 'charge':
        # Rears back and spreads the wings, jaw open, fire building in the throat.
        head.location.x += px((-2, -3)[i])
        head.location.z += px((1, 2)[i])
        head.rotation_euler.y = math.radians((-8, -12)[i])
        beast.location.x += px((-1, -1)[i])
        roar((16, 22)[i])
        wings((22, 30)[i], far_lag=6)
        swish(4, (14, 22)[i])
        for arm in rig['arms'].values():
            arm.rotation_euler.y = math.radians(-35)
        rc.hide([rig['glow']], False)
        rig['glow'].scale = ((1.0, 1.4)[i],) * 3
        eye.scale = (1, 1, 0.55)

    elif state == 'fire':
        head.location.x += px((2, 2, 1, 0, 0)[i])
        head.rotation_euler.y = math.radians((6, 4, 2, 0, 0)[i])
        roar((28, 24, 14, 4, 0)[i])
        beast.location.x += px((-2, -2, -1, 0, 0)[i])
        wings((-12, -8, 0, 4, 0)[i], flap=(30, 20, 0, 0, 0)[i], far_lag=4)
        swish((-6, -4, 0, 0, 0)[i], (-14, -8, 0, 0, 0)[i])
        rc.pose_fire(rig['jet'], (1.0, 0.7, 0.3, 0, 0)[i])
        for part in rig['jet']:
            part.scale.x *= 1.9                          # a jet, not a ball
        if i == 3:
            rc.hide([rig['puff']], False)

    elif state == 'hurt':
        beast.location.x += px((-2, 1, 0)[i])
        head.rotation_euler.y = math.radians((-16, -8, 0)[i])
        head.location.z += px((2, 1, 0)[i])
        roar((14, 6, 0)[i])
        wings((16, 6, 0)[i], flap=(35, 15, 0)[i])
        swish(8, (20, 8, 0)[i])
        eye.scale = (1, 1, (0.25, 0.25, 0.7)[i])

    elif state == 'death':
        # It topples forward on to its belly, the wings collapse over it, the head
        # comes down last and the last breath is a puff of smoke from the jaws.
        dz = (1, 0, -2, -5, -7, -8, -8)[i]
        cr.pose_death_fx(rig['fx'], i, fire_at=((-10, 26 + dz), (3, 20 + dz)), smoke_at=(-4, 40 + dz))
        if i >= 2:
            t = i - 2
            rc.set_burnt(mats, palette, True, hues=HUES)
            eye.data.materials[0] = mats['ink']
            eye.scale = (1, 1, 0.12)
            rc.hide(rig['layers']['barrel'], True)
            beast.location.z += px(dz)
            beast.rotation_euler.y = math.radians((6, 14, 20, 22, 22)[t])
            for leg in rig['legs'].values():
                leg.scale = (1.25, 1, (0.8, 0.6, 0.45, 0.4, 0.4)[t])
                leg.location.z += px((0, -1, -2, -3, -3)[t])
            head.location.z += px((-1, -3, -5, -6, -6)[t])
            head.location.x += px((1, 2, 3, 3, 3)[t])
            head.rotation_euler.y = math.radians((8, 16, 22, 24, 24)[t])
            roar((10, 16, 20, 22, 22)[t])
            wings((-10, -30, -50, -58, -58)[t], flap=(20, 40, 55, 60, 60)[t], far_lag=-6)
            swish((4, 8, 10, 10, 10)[t], (-10, -20, -28, -30, -30)[t])


if __name__ == '__main__':
    rc.run_mobile(
        name='wyvern', canvas=(112, 84), anchor=(52, 79), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cr.STATES, part_groups=PART_GROUPS,
        materials=('crimson', 'orange', 'amber', 'bone', 'smoke', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
