"""
Armoured knight (roster id `knight`): model, poses, layered renders.

    blender --background --python build_mobile_paladin.py -- --out work/paladin --scale 4

A chibi crusader on the chibi_mech body plan (stub legs, round torso, oversized head),
with its own build copied from chibi_mech.py so every part could be reshaped:

- a flat-topped great helm turned on a lathe profile (flared rim, straight sides, a
  rounded crown) with a narrow dark eye slit lit by two cyan points, a gold cross down
  the face and a gold crest ridge over the crown, and a long red plume (a tapered
  bezier tube) streaming back from the top;
- a steel breastplate under a red tabard with a gold cross, a pauldron of three
  sliced lames, and a steel arm (a tube) reaching down to the sword hand;
- a red kite shield with a gold rim and cross slung on the back, facing the camera;
- steel sabatons with pointed toes on dark mail legs.

The greatsword is the `barrel` layer: pommel and grip at the pivot, a gold crossguard
with curled quillons, and a diamond-section blade whose two flat facets catch the light
differently, tapering to the muzzle, with rune sparks that light up while it charges.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (13, 21)
BARREL_LENGTH = 16
NEAR_Y = -11
BOOT_Y = 6
HIP_Z = 12
STAND = {'near': 5, 'far': -6}
HEAD_C = (1, 0, 31)
CANVAS = (88, 78)
ANCHOR = (46, 70)
FLASH = 5.0

STATES = {
    'idle': (6, 10, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 6, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}

# Glow groups are matched by number across layers: the barrel's flash (and the rune
# sparks) share 21 with the body's fire, so no solid part loses its lines.
PART_GROUPS = (
    ('shieldrim', 1), ('shieldx', 2), ('shield', 3), ('boot_far', 4), ('leg_far', 5), ('sole', 6),
    ('boot_near', 7), ('leg_near', 8), ('torso', 9), ('tabard', 10), ('cross', 11), ('lame_a', 12),
    ('lame_b', 13), ('limb', 14), ('plume', 15), ('head', 16), ('visor', 17), ('face', 18), ('crest', 11),
    ('eye', 19), ('smoke', 20), ('boom', 22), ('fire', 21),
    ('hinge', 1), ('arm', 2), ('pommel', 3), ('guard', 4), ('blade', 5), ('edge', 6), ('flash', 21),
)
HUES = ('steel', 'rubber', 'amber', 'accent')

# The great helm's side profile, (radius, height) about the head centre, bottom to top.
HELM = ((0, -10.4), (9.6, -10.6), (11.4, -9.4), (11.7, -6.5), (11.6, 2.0), (11.2, 5.6), (9.8, 8.4),
        (7.2, 10.2), (3.6, 11.1), (0, 11.4))
HELM_SY = 0.9


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def lathe(name, profile, centre, material, sy=1.0, grow=0.0, segments=32):
    """A solid of revolution about z through `centre` from a (radius, dz) profile,
    squashed across y by `sy`. `grow` pushes every point out along the profile."""
    cx, cy, cz = centre
    bm = bmesh.new()
    rings = []
    for r, dz in profile:
        dz = dz + (grow if dz > 0 else -grow) if r == 0 else dz
        if r == 0:
            rings.append([bm.verts.new((px(cx), px(cy), px(cz + dz)))])
            continue
        r += grow
        rings.append([bm.verts.new((px(cx + r * math.cos(a)), px(cy + r * sy * math.sin(a)), px(cz + dz)))
                      for a in (2 * math.pi * k / segments for k in range(segments))])
    for lo, hi in zip(rings, rings[1:]):
        for k in range(segments):
            k2 = (k + 1) % segments
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[k2], hi[k]))
            elif len(hi) == 1:
                bm.faces.new((lo[k], lo[k2], hi[0]))
            else:
                bm.faces.new((lo[k], lo[k2], hi[k2], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=True)


def clip(obj, size, centre):
    """Keep only the part of `obj` inside a box (sizes and centre in pixels)."""
    box = rc.add_box('cut_' + obj.name, tuple(px(s) for s in size), tuple(px(c) for c in centre), obj.data.materials[0])
    mod = obj.modifiers.new('Clip', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, obj)
    return obj


def plate(name, outline, y, material, bulge=0.0, thick=0.9, centre=None):
    """A flat plate in the x-z plane at depth `y` fanned from `centre` over a closed
    `outline`, optionally domed towards the camera by `bulge` pixels."""
    if centre is None:
        centre = (sum(p[0] for p in outline) / len(outline), sum(p[1] for p in outline) / len(outline))
    obj = wy.membrane(name, centre, list(outline) + [outline[0]], y, material, bulge=bulge, rings=3, cols=2)
    obj.modifiers['Thick'].thickness = px(thick)
    return obj


def blade(name, sections, y, material):
    """A diamond-section blade along +x: `sections` are (x, half height, half thickness)
    in pixels; a zero height closes to a point. Flat shaded so each face is one tone."""
    bm = bmesh.new()
    rings = []
    for x, h, t in sections:
        if h == 0:
            rings.append([bm.verts.new((px(x), px(y), 0))])
        else:
            rings.append([bm.verts.new(v) for v in ((px(x), px(y), px(h)), (px(x), px(y - t), 0),
                                                     (px(x), px(y), px(-h)), (px(x), px(y + t), 0))])
    bm.faces.new(rings[0])
    for lo, hi in zip(rings, rings[1:]):
        for k in range(4):
            k2 = (k + 1) % 4
            if len(hi) == 1:
                bm.faces.new((lo[k], lo[k2], hi[0]))
            else:
                bm.faces.new((lo[k], lo[k2], hi[k2], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=False)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
    rc.parent_keep(chassis, root)

    def add(obj, parent=chassis):
        rc.parent_keep(obj, parent)
        body.append(obj)
        return obj

    # --- sabatons and mail legs ------------------------------------------------------
    legs = {}
    for side, y in (('far', BOOT_Y), ('near', -BOOT_Y)):
        boot = rc.add_box(f'boot_{side}', (px(11), px(7.4), px(6)), (px(0.5), px(y), px(3.6)), mats['steel'], bevel=px(2.0))
        toe = wy.tube(f'boot_{side}_toe', [(4, y, 3.2), (8, y, 2.2), (10.5, y, 1.4)], (3.2, 2.3, 0.6), mats['steel'], squash=0.95)
        sole = rc.add_box(f'sole_{side}', (px(15), px(7), px(1.8)), (px(2.6), px(y), px(0.9)), mats['rubber'], bevel=px(0.6))
        rc.set_origin(boot, (0, px(y), 0))
        for o in (toe, sole):
            rc.parent_keep(o, boot)
        leg = rc.add_cylinder(f'leg_{side}', px(2.8), px(8), (px(4), 0, 0), mats['rubber'], axis='X', vertices=12)
        rc.set_origin(leg, (0, 0, 0))
        for o in (boot, leg):
            rc.parent_keep(o, root)
        body.extend((boot, toe, sole, leg))
        legs[side] = {'boot': boot, 'leg': leg, 'y': y}
    rig['legs'] = legs

    # --- torso, tabard, pauldron, sword arm -----------------------------------------------
    torso = add(rc.add_sphere('torso', px(1), (0, 0, px(18)), mats['steel'], scale=(13, 10, 8.5), segments=24, rings=12))
    hem = [(-3, 17.5), (9, 17.5), (10, 8), (8.4, 3.6), (3, 5.8), (-2.4, 3.6), (-4, 8)]
    tabard = plate('tabard', hem, -10.6, mats['accent'], bulge=0.5, thick=1.0)
    rc.set_origin(tabard, (px(3), px(-10.6), px(17.5)))
    add(tabard)
    for k, (w, h, z) in enumerate(((1.8, 6.6, 8.6), (5.6, 1.8, 9.4))):
        c = rc.add_box(f'cross_tabard_{k}', (px(w), px(0.8), px(h)), (px(3), px(-11.6), px(z)), mats['amber'])
        rc.parent_keep(c, tabard)
        body.append(c)
    lames = wy.sliced('pauldron', (-4.5, -8.5, 22.5), (6.2, 4.4, 5.6), -12,
                      [(2.8, 2.6), (0.2, 2.6), (-2.4, 2.6)], mats['steel'], ('lame_a', 'lame_b'))
    for o in lames:
        add(o)
    pivot_z = proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT
    add(wy.tube('limb_arm', [(-2.5, -9.5, 19), (2, -10.5, 16.5), (7.5, -10.5, pivot_z - 1), (PIVOT[0] - 2, -10, pivot_z)],
                (3.0, 2.5, 2.3, 2.4), mats['rubber']))

    # --- the shield, slung on the back and turned to the camera ----------------------------
    kite = [(-7.2, 9.6), (-3.6, 10.6), (0, 11), (3.6, 10.6), (7.2, 9.6), (7.4, 4), (5.6, -3.5), (2.8, -9.5),
            (0, -13), (-2.8, -9.5), (-5.6, -3.5), (-7.4, 4)]
    sx, sy, sz = -14.5, 6.5, 20
    shield = plate('shield_face', [(sx + x, sz + z) for x, z in kite], sy, mats['accent'], bulge=1.0, thick=1.2,
                   centre=(sx, sz + 2))
    rim = wy.tube('shieldrim', [(sx + x, sy - 0.7, sz + z) for x, z in kite + kite[:1]], [1.0] * (len(kite) + 1),
                  mats['amber'], resolution=3)
    crosses = [rc.add_box('shieldx_v', (px(2.2), px(0.8), px(19)), (px(sx), px(sy - 1.4), px(sz)), mats['amber']),
               rc.add_box('shieldx_h', (px(13), px(0.8), px(2.2)), (px(sx), px(sy - 1.4), px(sz + 4.5)), mats['amber'])]
    for o in [shield, rim] + crosses:
        add(o)

    # --- the great helm ---------------------------------------------------------------
    hx, _, hz = HEAD_C
    head_grp = rc.add_empty('head_grp', (px(hx), 0, px(hz)))
    helm = lathe('head', HELM, HEAD_C, mats['steel'], sy=HELM_SY)
    slit = clip(lathe('visor', HELM, HEAD_C, mats['rubber'], sy=HELM_SY, grow=0.6),
                (18, 13, 4.4), (hx + 5, -6.5, hz - 0.3))
    face = clip(lathe('face_cross', HELM, HEAD_C, mats['amber'], sy=HELM_SY, grow=0.9),
                (2.0, 14, 21), (hx + 2.4, -7, hz - 0.5))
    crest = wy.tube('crest', [(hx + 10.6, 0, hz + 5.5), (hx + 6.5, 0, hz + 10.6), (hx - 1, 0, hz + 12.2),
                              (hx - 8, 0, hz + 9.8)], (1.3, 1.5, 1.5, 1.1), mats['amber'])
    eyes = []
    for k, ex in enumerate((-1.0, 5.8)):
        depth = 11.6 * HELM_SY * math.sqrt(max(0.0, 1 - (ex / 11.8) ** 2)) + 0.9
        eyes.append(rc.add_cylinder(f'eye_{k}', px(1.6), px(0.8), (px(hx + ex), px(-depth), px(hz - 0.3)),
                                    mats['cyan'], vertices=12, smooth=False))
    plume = wy.tube('plume', [(hx - 1, 0, hz + 11), (hx - 4, 0, hz + 16), (hx - 10, 0, hz + 17),
                              (hx - 16, 0, hz + 13), (hx - 19, 0, hz + 6)], (2.6, 3.4, 3.2, 2.2, 0.5), mats['accent'],
                    squash=0.6)
    rc.set_origin(plume, (px(hx - 1), 0, px(hz + 11)))
    for o in [helm, slit, face, crest, plume] + eyes:
        add(o, head_grp)
    rc.parent_keep(head_grp, chassis)
    rig.update(chassis=chassis, head_grp=head_grp, eyes=eyes, plume=plume, tabard=tabard, torso=torso)

    # --- the greatsword: barrel layer ------------------------------------------------------
    pivot_w = Vector((px(PIVOT[0]), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    rc.parent_keep(tube_grp, pivot)
    y = -9.5
    px0, pz = PIVOT[0], pivot_z

    def gun(obj, recoils=True):
        rc.parent_keep(obj, tube_grp if recoils else pivot)
        barrel.append(obj)
        return obj

    hand = rc.add_sphere('hinge', px(3.0), pivot_w + Vector((0, px(y - 0.5), 0)), mats['steel'], scale=(1, 1, 0.9),
                         segments=14, rings=8)
    rc.parent_keep(hand, pivot)
    barrel.append(hand)
    gun(rc.add_cylinder('arm_grip', px(1.2), px(6), pivot_w + Vector((px(-1.5), px(y), 0)), mats['rubber'], axis='X', vertices=8))
    gun(rc.add_sphere('pommel', px(1.9), pivot_w + Vector((px(-4.8), px(y), 0)), mats['amber'], segments=12, rings=6))
    gun(wy.tube('guard', [(px0 + 1.6, y, pz - 5.2), (px0 + 2.8, y, pz - 3), (px0 + 2.6, y, pz),
                          (px0 + 2.8, y, pz + 3), (px0 + 1.6, y, pz + 5.2)], (1.0, 1.2, 1.4, 1.2, 1.0), mats['amber']))
    sword = blade('blade', [(px0 + 2.6, 3.0, 1.2), (px0 + 13, 2.6, 1.1), (px0 + BARREL_LENGTH + 1.5, 0, 0)],
                  0, mats['steel'])
    sword.location = (0, px(y), px(pz))
    gun(sword)
    rig['runes'] = [gun(rc.add_box(f'flash_rune_{k}', (px(1.4), px(0.6), px(1.4)),
                                   pivot_w + Vector((px(5.5 + k * 2.8), px(y - 1.1), 0)), mats['cyan']))
                    for k in range(3)]
    muzzle = pivot_w + Vector((px(BARREL_LENGTH + FLASH * 0.7), px(-8), 0))
    rig['flash'] = rc.add_fire('flash', mats, muzzle, FLASH, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp)

    # --- death props --------------------------------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-14), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    for o in smoke:
        o.visible_shadow = False
        rc.parent_keep(o, root)
        body.append(o)
    rig['boom'] = rc.add_fire('boom', mats, (px(1), px(-15), px(24)), 15, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(1), px(-14), px(24)), 5.6, root)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(-8), px(-14), px(16)), 4.0, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])
    rig['smoke'] = smoke

    rig['layers'] = {'body': body, 'barrel': barrel}
    bpy.context.view_layer.update()
    movers = [chassis, head_grp, tube_grp, plume, tabard]
    rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in movers}
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    chassis, head, tube = rig['chassis'], rig['head_grp'], rig['tube_grp']
    plume, tabard, runes = rig['plume'], rig['tabard'], rig['runes']
    for name, (loc, rot, scale) in rig['rest'].items():
        o = bpy.data.objects[name]
        o.location, o.rotation_euler, o.scale = loc.copy(), rot.copy(), scale.copy()
    for e in rig['eyes']:
        e.scale = (1, 1, 1)
        e.data.materials[0] = mats['cyan']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['smoke'], True)
    for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.set_burnt(mats, palette, False, hues=HUES)

    feet = {side: (x, 0) for side, x in STAND.items()}
    dx = dz = 0
    sway = 0
    lit = 0

    def lids(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])      # the head settles a frame late
        sway = (0, 0, 4, 8, 4, 0)[i]
        lit = (1, 1, 2, 3, 2, 1)[i]
        if i == 4:
            lids(0.15)

    elif state == 'move':
        n = STATES['move'][0]
        feet = {'near': parts.walk_foot(i / n, 3, 3), 'far': parts.walk_foot(i / n + 0.5, 3, 3)}
        feet = {side: (x + STAND[side] // 2, z) for side, (x, z) in feet.items()}
        dz = (-1, 0, 0)[i % 3]
        head.location.z += px((0, -1, 0)[i % 3])
        sway = (-6, -12, -6, 0, 6, 0)[i]
        lit = 1

    elif state == 'charge':
        dz = (-1, -2)[i]
        tube.location.x += px((-2, -3)[i])
        head.location.x += px((0, -1)[i])
        sway = (-10, -16)[i]
        lit = 3                                           # every rune burns while the blade is summoned
        lids(0.5)

    elif state == 'fire':
        tube.location.x += px((-3, -3, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        sway = (-22, -14, -6, 0, 0)[i]
        lit = (3, 3, 2, 1, 1)[i]
        lids((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        sway = (-20, -8, 0)[i]
        lids((0.3, 0.3, 0.7)[i])

    elif state == 'death':
        # Flash, fireball, the great helm is blown off backwards and rolls to rest behind
        # the boots; the headless armour sags and burns from the neck.
        t = i - 2
        if i == 0:
            dz = 1
            rc.pose_fire(rig['boom'], 0.42)
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.set_burnt(mats, palette, True, hues=HUES)
            for e in rig['eyes']:
                e.data.materials[0] = mats['ink']
            rc.hide(rig['layers']['barrel'], True)
            dz = (-1, -3, -4, -4, -4)[t]
            head.location.x += px((-4, -10, -15, -17, -17)[t])
            head.location.y -= px((4, 9, 13, 13, 13)[t])
            head.location.z += px((9, 8, -6, -14, -13)[t]) - px(dz)
            head.rotation_euler.y = math.radians((-25, -70, -115, -150, -146)[t])
            rc.pose_fire(rig['boom'], (0.78, 0.4, 0, 0, 0)[t])
            rc.pose_fire(rig['fire_a'], (0.6, 1.0, 1.1, 0.9, 1.0)[t], lean_deg=(0, -8, 7, -6, 5)[t], at=(2, 24 + dz))
            rc.pose_fire(rig['fire_b'], (0, 0.6, 0.95, 1.0, 0.8)[t], lean_deg=(0, 6, -8, 7, -5)[t], at=(-7, 17 + dz))
            rc.hide(rig['smoke'], t < 2)
            for s, (sx, sz, k) in zip(rig['smoke'], ((5, 36, 0.9), (2, 43, 0.6))):
                grow = k * (0, 0, 0.8, 1.0, 0.9)[t]
                s.location = (px(sx), px(-14), px(sz + (0, 0, 0, 2, 3)[t]))
                s.scale = (grow, grow, grow)

    chassis.location.x += px(dx)
    chassis.location.z += px(dz)
    for side, leg in rig['legs'].items():
        fx, fz = feet[side]
        fz += parts.plant_z(leg['y'], rig['legs']['near']['y'])   # far boot sinks onto the ground row
        leg['boot'].location = (px(fx), px(leg['y']), px(fz))
        parts.aim(leg['leg'], (dx + (1 if side == 'near' else -1), HIP_Z + dz + 1), (fx, fz + 5), leg['y'])
    plume.rotation_euler.y += math.radians(sway)
    tabard.rotation_euler.y += math.radians(-sway * 0.5)
    for k, r in enumerate(runes):
        rc.hide([r], k >= lit or state == 'death')


if __name__ == '__main__':
    rc.run_mobile(
        name='paladin', canvas=CANVAS, anchor=ANCHOR, near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('steel', 'rubber', 'amber', 'accent', 'smoke', 'cyan', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
