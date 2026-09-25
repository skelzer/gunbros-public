"""
Storm caller mech (the roster's `lightning`): a chibi mech with its own copy of the
chibi_mech.py build and poses, so the head, the gun and the pack can be reshaped.

    blender --background --python build_mobile_tempest.py -- --out work/tempest --scale 4

A violet dome head crowned by a yellow lightning bolt fin, a copper ringed electrode
ear behind the visor and a stern brow over the eyes. On its back a proper Tesla
coil: a tapered steel column wound with a copper helix, a toroid top load and a
charged cyan ball that throws yellow arcs. The chest carries a round steel plate with a bolt
on it, and the gun is a forked emitter, two curved copper prongs on a coiled stem with
an arc crackling between them. The gun pivot sits at face height, so the face moves
up and back out of its way (see the playbook).

Profiles (the bolts) are extruded polygons, the coil winding and the gun prongs are bezier
tubes (`tube` from the wyvern script), the arcs are poly curves with a round bevel.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import chibi_mech as cm  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

BARREL_LENGTH = 6
PIVOT = (7, 31)
HUE, VISOR = 'violet', 'glass'
HUES = (HUE, VISOR, 'orange')
BOOT_Y, HIP_Z = cm.BOOT_Y, cm.HIP_Z
STAND = cm.STAND
HX, HZ = -5, 33                       # head centre: back and up, off the gun
HEAD_R = (11.5, 10, 10.5)
EYE_Z = 35.5
PACK = (-20, 1)                       # Tesla coil (x, y)

# Glow groups match by number across layers: the gun's flash shares 21 with the body's fire.
PART_GROUPS = (
    ('boot_far', 1), ('leg_far', 2), ('pack_far', 3), ('pack_coil', 4), ('pack', 5), ('boot_near', 6),
    ('leg_near', 7), ('torso', 8), ('chest', 9), ('bolt', 10), ('ear_far', 11), ('head', 12), ('visor', 13),
    ('eye', 14), ('brow', 15), ('ear', 16), ('crest', 17), ('zap', 18),
    ('smoke', 19), ('boom', 20), ('fire', 21),
    ('hinge', 1), ('arm', 2), ('muzzle', 3), ('coil', 4), ('tip', 5), ('flash', 21),
)


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

BOLT = ((-0.12, 0.5), (0.3, 0.5), (0.06, 0.1), (0.32, 0.1), (-0.22, -0.5), (-0.02, -0.04), (-0.3, -0.04))


def slab(name, pts, y, depth, material, bevel=0.35):
    """A flat polygon (x, z) extruded `depth` pixels along y, centred on `y`."""
    bm = bmesh.new()
    verts = [bm.verts.new((px(x), px(y - depth / 2), px(z))) for x, z in pts]
    face = bm.faces.new(verts)
    bmesh.ops.recalc_face_normals(bm, faces=[face])
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, px(depth), 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if bevel:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = px(bevel)
        mod.segments = 1
        mod.limit_method = 'ANGLE'
    return rc.finish(obj, material)


def bolt(name, centre, height, y, depth, material, tilt_deg=0.0, flip=False):
    """The lightning bolt glyph, `height` pixels tall, turned `tilt_deg` in the side plane."""
    t = math.radians(tilt_deg)
    pts = []
    for bx, bz in BOLT:
        bx = -bx if flip else bx
        x, z = bx * height, bz * height
        pts.append((centre[0] + x * math.cos(t) + z * math.sin(t), centre[1] - x * math.sin(t) + z * math.cos(t)))
    if flip:
        pts.reverse()
    return slab(name, pts, y, depth, material)


def zap(name, pts, r, material):
    """A jagged electric arc: a poly curve through `pts` with a round bevel."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(r)
    cu.bevel_resolution = 2
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, c in zip(sp.points, pts):
        p.co = (px(c[0]), px(c[1]), px(c[2]), 1)
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = name
    obj.visible_shadow = False
    return rc.finish(obj, material)


def helix(name, centre, radius, z0, z1, turns, r, material):
    """A copper winding round a vertical column."""
    n = int(turns * 10)
    pts, radii = [], []
    for k in range(n + 1):
        a = 2 * math.pi * turns * k / n
        pts.append((centre[0] + radius * math.cos(a), centre[1] - radius * math.sin(a), z0 + (z1 - z0) * k / n))
        radii.append(r)
    return wy.tube(name, pts, radii, material, resolution=3)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build(mats, proj):
    body, barrel = [], []
    rig = {}
    hue = mats[HUE]
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
    rc.parent_keep(chassis, root)

    # --- boots and legs (as chibi_mech) ------------------------------------------
    legs = {}
    for side, y in (('far', BOOT_Y), ('near', -BOOT_Y)):
        boot = rc.add_box(f'boot_{side}', (px(14), px(8), px(7)), (px(1.5), px(y), px(3.5)), mats['rubber'], bevel=px(2.0))
        cap = rc.add_box(f'boot_{side}_cap', (px(5), px(8.7), px(4.2)), (px(7), px(y), px(2.7)), mats['steel'], bevel=px(1.0))
        rc.set_origin(boot, (0, px(y), 0))
        rc.parent_keep(cap, boot)
        leg = rc.add_cylinder(f'leg_{side}', px(2.8), px(8), (px(4), 0, 0), hue, axis='X', vertices=12)
        rc.set_origin(leg, (0, 0, 0))
        for o in (boot, leg):
            rc.parent_keep(o, root)
        body.extend((boot, cap, leg))
        legs[side] = {'boot': boot, 'leg': leg, 'y': y}
    rig['legs'] = legs

    # --- torso and chest ----------------------------------------------------------
    torso = rc.add_sphere('torso', px(1), (0, 0, px(18)), hue, scale=(13, 10, 8.5), segments=24, rings=12)
    plate = rc.add_cylinder('chest_plate', px(5), px(1.4), (px(2.5), px(-9.2), px(17.5)), mats['steel'], vertices=20)
    emblem = bolt('bolt_chest', (2.5, 17.5), 7.5, -10.2, 1.0, mats['lamp'])
    for o in (torso, plate, emblem):
        rc.parent_keep(o, chassis)
    body.extend((torso, plate, emblem))

    # --- head -----------------------------------------------------------------------
    head_grp = rc.add_empty('head_grp', (px(HX), 0, px(HZ)))
    head_c = (px(HX), 0, px(HZ))
    head = rc.add_sphere('head', px(1), head_c, hue, scale=HEAD_R, segments=32, rings=16)
    visor = rc.add_sphere('visor', px(1), head_c, mats[VISOR], scale=tuple(r + 0.7 for r in HEAD_R), segments=32, rings=16)
    band = rc.add_box('cut_visor_band', (px(18), px(13), px(7.2)), (px(HX + 7), px(-6.5), px(EYE_Z)), mats[VISOR])
    mod = visor.modifiers.new('Band', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = band
    band.hide_render = band.hide_viewport = True
    rc.parent_keep(band, visor)
    eyes = [rc.add_cylinder(f'eye_{k}', px(2.4), px(0.8), (px(HX + ex), px(-11.2), px(EYE_Z)), mats['eye'], vertices=12, smooth=False)
            for k, ex in enumerate((2.0, 8.0))]
    # A stern brow: violet wedges that clip the top of each eye, sloping down to the front.
    brows = []
    for k, ex in enumerate((2.0, 8.0)):
        b = rc.add_box(f'brow_{k}', (px(5.4), px(1.2), px(1.3)), (px(HX + ex + 0.2), px(-12.0), px(EYE_Z + 2.9)), hue, bevel=px(0.3))
        b.rotation_euler = (0, math.radians(-12), 0)
        brows.append(b)
    # Crest: a lightning bolt fin standing on the dome, leaning back.
    crest = bolt('crest', (HX + 1, HZ + HEAD_R[2] + 3.5), 12, 0, 2.6, mats['lamp'], tilt_deg=-12)
    # Electrode ear: a steel boss behind the visor with a copper ring round it.
    ears = [rc.add_cylinder('ear_boss', px(2.9), px(2.0), (px(HX - 5), px(-HEAD_R[1] + 0.6), px(EYE_Z - 1)), mats['steel'], vertices=16),
            cm.add_ring('ear_ring', px(3.1), px(0.8), (px(HX - 5), px(-HEAD_R[1] + 0.2), px(EYE_Z - 1)), mats['orange'])]
    for o in [head, visor, crest] + eyes + brows + ears:
        rc.parent_keep(o, head_grp)
    body.extend([head, visor, crest] + eyes + brows + ears)
    rig.update(chassis=chassis, head_grp=head_grp, eyes=eyes, torso=torso)

    # --- Tesla coil pack ------------------------------------------------------------
    cx, cy = PACK
    strap = rc.add_box('pack_strap', (px(8), px(6), px(10)), (px(-13), px(cy), px(24)), mats['steel'], bevel=px(1.2))
    base = rc.add_cylinder('pack_base', px(4.6), px(3), (px(cx), px(cy), px(18.5)), mats['steel'], axis='Z', vertices=16)
    column = cm.add_cone('pack_far_column', px(3.3), px(2.2), px(22), (px(cx), px(cy), px(31)), mats['steel'], vertices=14)
    winding = helix('pack_coil', (cx, cy), 3.4, 22, 38, 5, 0.75, mats['orange'])
    toroid = cm.add_ring('pack_toroid', px(4.6), px(1.9), (px(cx), px(cy), px(43)), mats['steel'], facing='Z')
    ball = rc.add_sphere('pack_ball', px(3.3), (px(cx), px(cy), px(46.5)), mats['cyan'], segments=16, rings=8)
    pack = [strap, base, column, winding, toroid, ball]
    # Arcs off the top load, one showing at a time.
    zaps = [zap('zap_0', [(cx - 2, cy - 3, 48), (cx - 5, cy - 3, 50), (cx - 4, cy - 3, 52.5), (cx - 8, cy - 3, 55)], 0.95, mats['lamp']),
            zap('zap_1', [(cx + 2, cy - 3, 48.5), (cx + 3, cy - 3, 51.5), (cx + 1, cy - 3, 53.5), (cx + 4, cy - 3, 57)], 0.95, mats['lamp']),
            zap('zap_2', [(cx - 5, cy - 4, 44), (cx - 8, cy - 4, 46), (cx - 8.5, cy - 4, 49), (cx - 11.5, cy - 4, 50)], 0.95, mats['lamp'])]
    for o in pack + zaps:
        rc.parent_keep(o, chassis)
    body.extend(pack + zaps)
    rig.update(ball=ball, zaps=zaps)

    rc.parent_keep(head_grp, chassis)

    # --- the gun: barrel layer ----------------------------------------------------------
    dx, up = PIVOT
    pivot_w = Vector((px(dx), 0, px(proj.z_for_height(up) * rc.PX_PER_UNIT)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    rc.parent_keep(tube_grp, pivot)
    hinge = rc.add_sphere('hinge', px(2.6), pivot_w, mats['steel'], segments=14, rings=8)
    rc.parent_keep(hinge, pivot)
    barrel.append(hinge)
    px0, pz0 = dx, pivot_w.z / px(1)
    gun = [rc.add_box('arm_stem', (px(4), px(3.6), px(4.4)), pivot_w + Vector((px(1.6), 0, 0)), mats['steel'], bevel=px(0.8)),
           cm.add_ring('coil_0', px(2.0), px(0.7), pivot_w + Vector((px(2.2), 0, 0)), mats['orange'], facing='X')]
    for k, s in enumerate((1, -1)):
        gun.append(wy.tube(f'muzzle_prong_{k}', [(px0 + 3, -0.3, pz0 + s * 1.2), (px0 + 5, -0.3, pz0 + s * 3.4),
                                                 (px0 + BARREL_LENGTH + 1.5, -0.3, pz0 + s * 2.6)], (1.3, 1.1, 0.8), mats['orange']))
        gun.append(rc.add_sphere(f'tip_{k}', px(1.3), pivot_w + Vector((px(BARREL_LENGTH + 1.6), px(-0.3), px(s * 2.5))), mats['steel'], segments=10, rings=6))
    arc = zap('flash_arc', [(px0 + BARREL_LENGTH + 1.4, -1.5, pz0 + 2), (px0 + BARREL_LENGTH - 0.4, -1.5, pz0 + 0.6),
                            (px0 + BARREL_LENGTH + 1.8, -1.5, pz0 - 0.6), (px0 + BARREL_LENGTH + 0.4, -1.5, pz0 - 2)], 0.8, mats['lamp'])
    for o in gun + [arc]:
        rc.parent_keep(o, tube_grp)
    barrel.extend(gun + [arc])
    muzzle = pivot_w + Vector((px(BARREL_LENGTH + 6.5 * 0.7), px(-8), 0))
    rig['flash'] = rc.add_fire('flash', mats, muzzle, 6.5, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp, arc=arc)

    # --- death props (as chibi_mech) ----------------------------------------------------
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
    movers = [chassis, head_grp, tube_grp, ball]
    rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in movers}
    return rig


# --------------------------------------------------------------------------
# Poses (chibi_mech's, plus the coil and the arcs)
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    chassis, head, tube = rig['chassis'], rig['head_grp'], rig['tube_grp']
    for name, (loc, rot, scale) in rig['rest'].items():
        o = bpy.data.objects[name]
        o.location, o.rotation_euler, o.scale = loc.copy(), rot.copy(), scale.copy()
    for e in rig['eyes']:
        e.scale = (1, 1, 1)
        e.data.materials[0] = mats['eye']
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['smoke'], True)
    for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.set_burnt(mats, palette, False, hues=HUES)

    feet = {side: (x, 0) for side, x in STAND.items()}
    dx = dz = 0
    zap_on = None                      # index of the arc thrown off the coil, if any
    arc_on = False

    def lids(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        if i == 4:
            lids(0.15)
        zap_on = {1: 0, 2: 2}.get(i)
        arc_on = i in (1, 2)
        rig['ball'].scale = ((1, 1, 1.12, 1.12, 1, 1)[i],) * 3

    elif state == 'move':
        n = cm.STATES['move'][0]
        feet = {'near': parts.walk_foot(i / n, 3, 3), 'far': parts.walk_foot(i / n + 0.5, 3, 3)}
        feet = {side: (x + STAND[side] // 2, z) for side, (x, z) in feet.items()}
        dz = (-1, 0, 0)[i % 3]
        head.location.z += px((0, -1, 0)[i % 3])
        zap_on = {3: 1}.get(i)

    elif state == 'charge':
        dz = (-1, -2)[i]
        tube.location.x += px((-2, -3)[i])
        head.location.x += px((0, -1)[i])
        lids(0.5)
        rig['ball'].scale = ((1.25, 1.45)[i],) * 3       # the coil builds up
        zap_on = (0, 1)[i]
        arc_on = True

    elif state == 'fire':
        tube.location.x += px((-3, -3, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        lids((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])
        zap_on = {2: 2}.get(i)

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        lids((0.3, 0.3, 0.7)[i])
        zap_on = {0: 2, 1: 0}.get(i)                    # it shorts out

    elif state == 'death':
        t = i - 2
        if i == 0:
            dz = 1
            rc.pose_fire(rig['boom'], 0.42)
            zap_on = 1
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
        fz += parts.plant_z(leg['y'], rig['legs']['near']['y']) + cm.BOOT_SINK   # soles on the ground row; the far one sinks for the tilt
        leg['boot'].location = (px(fx), px(leg['y']), px(fz))
        parts.aim(leg['leg'], (dx + (1 if side == 'near' else -1), HIP_Z + dz + 1), (fx, fz + 5), leg['y'])

    live = not (state == 'death' and i >= 2)
    for k, z in enumerate(rig['zaps']):
        rc.hide([z], zap_on != k)
    rc.hide([rig['arc']], not (live and arc_on))
    rig['ball'].data.materials[0] = mats['cyan'] if live else mats['ink']


if __name__ == '__main__':
    rc.run_mobile(
        name='tempest', canvas=cm.CANVAS, anchor=cm.ANCHOR, near_y=px(cm.NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cm.STATES, part_groups=PART_GROUPS,
        materials=('violet', 'glass', 'orange', 'steel', 'rubber', 'smoke', 'eye', 'ink', 'lamp', 'flame', 'flash', 'cyan'),
        build=build, pose=pose)
