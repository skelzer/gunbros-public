"""
Four-legged uplink lander (roster id `asate`): model, poses, layered renders.

    blender --background --python build_mobile_orbital.py -- --out work/orbital --scale 4

A little lunar lander that walks: a faceted gold-foil descent stage with an engine
bell under it, a white faceted cabin on top with a dark visor holding two lamp eyes,
four splayed lander legs (a strut out to a high knee, a leg down to a dished footpad)
that step in diagonal pairs with two-bone IK, a solar array trailing off the back and
a beacon on a whip mast. A parabolic dish rides on a pedestal above the cabin, its bowl
turned three quarters towards the camera and tipped at the sky. The gold feed horn at
the hub of the dish is the `barrel` layer, so it turns to the aim while the dish stays.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_mobile_wyvern as wy  # noqa: E402
import creature as cr  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

PIVOT = (4, 40)
BARREL_LENGTH = 17
NEAR_Y = -12
HULL_Z = 10
THIGH, SHIN, ANKLE = 11, 15, 2.2
# name: (hip x, depth y, rest foot x). Far legs sit a little wider so they peek out.
LEGS = {'near_front': (9, -10.5, 21), 'near_rear': (-9, -10.5, -20),
        'far_front': (10, 10.5, 24), 'far_rear': (-10, 10.5, -23)}
HIP_Z = 15
# Rest height of the pads (px): the near pad's front rim comes down on the ground row,
# the far pads sink by what the camera tilt lifts them, so all four plant on one row.
PAD_Z = 1.0
HUES = ('white', 'ice', 'amber')

# Glow groups are matched by number across layers: the barrel's flash shares the
# body's fire number so no solid part loses its lines. First prefix match wins.
PART_GROUPS = (
    ('legfar', 1), ('padfar', 2), ('solar_a', 3), ('solar_b', 4), ('solar', 5), ('nozzle', 6),
    ('foil', 7), ('deck', 8), ('cabin', 9), ('visor', 10), ('eye', 11), ('mast', 12), ('beacon', 13),
    ('yoke', 14), ('dish', 15), ('rim', 16), ('legnear', 17), ('padnear', 18),
    ('smoke', 19), ('boom', 20), ('fire', 21),
    ('hinge', 22), ('guide', 23), ('horn', 24), ('lens', 25), ('flash', 21),
)


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------

def prism(name, r_bottom, r_top, depth, centre, material, squash=0.75):
    """An octagonal frustum standing on z, turned so one flat faces the camera, flat
    shaded so the toon ramp puts each facet on its own value step."""
    o = cr.cone(name, r_bottom, r_top, depth, centre, material, vertices=8, flat=True)
    o.rotation_euler = (0, 0, math.radians(22.5))
    o.scale = (1, squash, 1)
    bpy.context.view_layer.objects.active = o
    for other in bpy.context.selected_objects:
        other.select_set(False)
    o.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    return o


def dish_mesh(name, radius, depth, material, segments=28, rings=6):
    """A parabolic bowl opening along +x, vertex at the origin, solidified so the
    inside is a real surface with its own normals (a bare cone renders inside out)."""
    bm = bmesh.new()
    centre = bm.verts.new((0, 0, 0))
    grid = []
    for k in range(1, rings + 1):
        t = k / rings
        row = []
        for s in range(segments):
            a = 2 * math.pi * s / segments
            row.append(bm.verts.new((px(depth * t * t), px(radius * t * math.cos(a)), px(radius * t * math.sin(a)))))
        grid.append(row)
    for s in range(segments):
        bm.faces.new((centre, grid[0][s], grid[0][(s + 1) % segments]))
    for k in range(rings - 1):
        for s in range(segments):
            n = (s + 1) % segments
            bm.faces.new((grid[k][s], grid[k + 1][s], grid[k + 1][n], grid[k][n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(1.0)
    mod.offset = 0
    return rc.finish(obj, material, smooth=True)


def torus(name, major, minor, location, material, axis='X'):
    bpy.ops.mesh.primitive_torus_add(major_radius=px(major), minor_radius=px(minor), major_segments=28,
                                     minor_segments=8, location=location)
    obj = bpy.context.active_object
    obj.name = name
    if axis == 'X':
        obj.rotation_euler = (0, math.pi / 2, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return rc.finish(obj, material, smooth=True)


def rod(name, length, radii, material):
    """A tapered tube lying along +x from its origin, for parts.aim to lay out."""
    return wy.tube(name, [(0, 0, 0), (length / 2, 0, 0), (length, 0, 0)], radii, material)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))

    # Legs: two tapered rods and a knee ball, laid out by IK every frame; a dished pad.
    legs = {}
    for name, (hx, y, fx) in LEGS.items():
        side = 'near' if y < 0 else 'far'
        thigh = rod(f'leg{side}_thigh_{name}', THIGH, (1.5, 1.3, 1.2), mats['steel'])
        shin = rod(f'leg{side}_shin_{name}', SHIN, (1.9, 1.5, 1.1), mats['white'])
        knee = rc.add_sphere(f'leg{side}_knee_{name}', px(2.1), (0, 0, 0), mats['steel'], segments=12, rings=8)
        pad = cr.cone(f'pad{side}_{name}', 4.4, 2.2, 2.0, (0, 0, 0), mats['steel'], vertices=16)
        foot = rc.add_sphere(f'pad{side}_ball_{name}', px(1.6), (0, 0, px(1.6)), mats['steel'], segments=10, rings=6)
        rc.parent_keep(foot, pad)
        for o in (thigh, shin, knee, pad):
            rc.parent_keep(o, root)
        fz = PAD_Z + (parts.plant_z(y, LEGS['near_front'][1]) if side == 'far' else 0)
        legs[name] = {'hip': (hx, HIP_Z), 'y': y, 'foot': (fx, fz), 'thigh': thigh, 'shin': shin, 'knee': knee,
                      'pad': pad, 'bend': 'front' if hx > 0 else 'back'}
        body.extend((thigh, shin, knee, pad, foot))
    rig['legs'] = legs

    hull = rc.add_empty('hull', (0, 0, px(HULL_Z)))
    rc.parent_keep(hull, root)

    # Descent stage: gold foil octagon with an engine bell under it.
    foil = prism('foil_stage', 14, 13, 9, (0, 0, 13), mats['amber'])
    deck = prism('deck_ring', 14.6, 14.6, 1.4, (0, 0, 17.8), mats['steel'])
    skirt = prism('deck_skirt', 13.6, 13.6, 1.0, (0, 0, 8.9), mats['steel'])
    nozzle = cr.cone('nozzle', 4.2, 2.4, 3.2, (0, 0, 7), mats['steel'], vertices=14)
    # Cabin: a white faceted frustum set forward, a visor across its face with two lamps.
    cabin = prism('cabin', 11.5, 9, 10, (2, 0, 22.8), mats['white'], squash=0.8)
    visor = rc.add_box('visor', (px(10), px(2.4), px(5.2)), (px(5.5), px(-7.9), px(22.6)), mats['ink'], bevel=px(0.8))
    visor.rotation_euler = (math.radians(-9), 0, 0)
    eyes = [rc.add_cylinder(f'eye_{k}', px(1.7), px(0.8), (px(3.2 + k * 5), px(-9.2), px(22.8)), mats['flash'], axis='Y', vertices=12, smooth=False)
            for k in range(2)]
    # Beacon on a whip mast at the back of the cabin.
    mast = wy.tube('mast', [(-6, 2, 27), (-8, 2, 33), (-9.5, 2, 37)], (0.9, 0.8, 0.7), mats['steel'])
    beacon = rc.add_sphere('beacon', px(2.0), (px(-9.5), px(2), px(38.2)), mats['accent'], segments=10, rings=6)

    # Solar array trailing off the back: cells in two alternating groups so the part
    # lines draw the grid, on a steel frame and an arm into the cabin.
    solar = rc.add_empty('solar_grp', (px(-11), px(5), px(22)))
    arm = wy.tube('solar_strut', [(-8, 5, 21), (-12, 5, 22), (-15, 5, 23.5)], (1.4, 1.2, 1.2), mats['steel'])
    frame = rc.add_box('solar_frame', (px(21), px(0.8), px(10.6)), (px(-25.5), px(5.6), px(25.5)), mats['steel'])
    cells = []
    for c in range(4):
        for r in range(2):
            tag = 'solar_a' if (c + r) % 2 == 0 else 'solar_b'
            cells.append(rc.add_box(f'{tag}_{c}{r}', (px(5), px(0.8), px(5)), (px(-17.5 - 5 * c), px(5), px(23 + 5 * r)), mats['ice']))
    for o in [arm, frame] + cells:
        rc.parent_keep(o, solar)

    # The dish on a pedestal and gimbal, hub at the barrel pivot.
    pivot_w = Vector((px(PIVOT[0]), 0, px(proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT)))
    yoke = wy.tube('yoke_post', [(1, 0, 27), (1, 0, 31), (1.5, 0, 34)], (2.6, 2.0, 1.8), mats['steel'])
    yoke_top = rc.add_box('yoke_fork', (px(5), px(5), px(2.4)), (px(1.5), 0, px(34.5)), mats['steel'], bevel=px(0.8))
    dish_grp = rc.add_empty('dish_grp', pivot_w)
    dish = dish_mesh('dish', 11.5, 4.2, mats['ice'])
    dish.location = pivot_w + Vector((px(-2.4), 0, 0))
    rim = torus('rim', 11.6, 0.9, pivot_w + Vector((px(-2.4 + 4.2), 0, 0)), mats['steel'])
    hub = rc.add_cylinder('rim_hub', px(2.8), px(2.4), pivot_w + Vector((px(-3.2), 0, 0)), mats['steel'], axis='X', vertices=14)
    for o in (dish, rim, hub):
        rc.parent_keep(o, dish_grp)
    # Bowl turned 50 degrees towards the camera and tipped 18 degrees at the sky.
    dish_grp.rotation_euler = (0, math.radians(-18), math.radians(-50))

    hull_parts = [foil, deck, skirt, nozzle, cabin, visor, mast, beacon, solar, yoke, yoke_top, dish_grp] + eyes
    for o in hull_parts:
        rc.parent_keep(o, hull)
    body.extend([foil, deck, skirt, nozzle, cabin, visor, mast, beacon, arm, frame, yoke, yoke_top, dish, rim, hub]
                + cells + eyes)
    rig.update(hull=hull, dish_grp=dish_grp, eyes=eyes, beacon=beacon, solar=solar, rim=rim)

    # --- the feed horn: barrel layer ----------------------------------------------
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, hull)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    hinge = rc.add_sphere('hinge', px(2.6), pivot_w, mats['steel'], segments=12, rings=8)
    guide = rc.add_cylinder('guide', px(1.7), px(6), pivot_w + Vector((px(3), 0, 0)), mats['steel'], axis='X', vertices=12)
    collar = rc.add_cylinder('guide_collar', px(2.5), px(1.6), pivot_w + Vector((px(5.6), 0, 0)), mats['steel'], axis='X', vertices=12)
    horn = cr.cone('horn', 2.2, 4.3, BARREL_LENGTH - 7.6, (0, 0, 0), mats['amber'], axis='X', vertices=16)
    horn.location = pivot_w + Vector((px(6.2 + (BARREL_LENGTH - 7.6) / 2), 0, 0))
    horn_band = rc.add_cylinder('horn_band', px(4.6), px(1.4), pivot_w + Vector((px(BARREL_LENGTH - 1.2), 0, 0)), mats['amber'], axis='X', vertices=16)
    lens = rc.add_cylinder('lens', px(3.3), px(1.0), pivot_w + Vector((px(BARREL_LENGTH - 0.4), 0, 0)), mats['flash'], axis='X', vertices=14, smooth=False)
    for o in (guide, collar, horn, horn_band, lens):
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    rc.parent_keep(hinge, pivot)
    barrel.extend([hinge, guide, collar, horn, horn_band, lens])
    rig['flash'] = rc.add_fire('flash', mats, pivot_w + Vector((px(BARREL_LENGTH + 4), px(-7), 0)), 6, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp)

    rig['fx'] = cr.death_fx(mats, root, body, (0, 30), 16, y=-16, fires=(5.4, 4.2))
    rig['layers'] = {'body': body, 'barrel': barrel}
    rig['rest'] = cr.snapshot([hull, dish_grp, tube_grp, solar, beacon] + eyes)
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def pose_legs(rig, off=(0, 0), feet=None, splay=0):
    """IK every leg from its hip (moved with the hull by `off`) to its foot, offset by
    `feet[name]` (dx, dz); `splay` pushes all feet outwards."""
    feet = feet or {}
    for name, leg in rig['legs'].items():
        y = leg['y']
        hip = (leg['hip'][0] + off[0], leg['hip'][1] + off[1])
        dx, dz = feet.get(name, (0, 0))
        fx = leg['foot'][0] + dx + (splay if leg['hip'][0] > 0 else -splay)
        fz = leg['foot'][1] + dz
        ankle = (fx, fz + ANKLE)
        knee = parts.two_bone_ik(hip, ankle, THIGH, SHIN, knee=leg['bend'])
        parts.aim(leg['thigh'], hip, knee, y)
        parts.aim(leg['shin'], knee, ankle, y)
        leg['knee'].location = (px(knee[0]), px(y), px(knee[1]))
        leg['pad'].location = (px(fx), px(y), px(fz + 1.0))


def pose(rig, mats, palette, state, i):
    hull, dish, tube, solar = rig['hull'], rig['dish_grp'], rig['tube_grp'], rig['solar']
    cr.restore(rig['rest'])
    for e in rig['eyes']:
        e.data.materials[0] = mats['flash']
    rig['beacon'].data.materials[0] = mats['accent']
    rig['rim'].data.materials[0] = mats['steel']
    rc.hide(rig['layers']['barrel'], False)
    rc.pose_fire(rig['flash'], 0)
    cr.reset_fx(rig['fx'])
    rc.set_burnt(mats, palette, False, hues=HUES)

    def lamps(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    def shift(dx=0, dz=0):
        hull.location.x += px(dx)
        hull.location.z += px(dz)
        return dx, dz

    off, feet, splay = (0, 0), {}, 0

    if state == 'idle':
        off = shift(dz=(0, 0, -1, -1, -1, 0)[i])
        solar.rotation_euler.y = math.radians((0, -4, -8, -8, -4, 0)[i])
        if i >= 3:
            rig['beacon'].data.materials[0] = mats['steel']
        if i == 4:
            lamps(0.2)

    elif state == 'move':
        n = 6
        for name in rig['legs']:
            diagonal = name in ('near_front', 'far_rear')
            feet[name] = parts.walk_foot(i / n + (0 if diagonal else 0.5), stride=4, lift=3)
        off = shift(dz=(0, 1, 0, 0, 1, 0)[i])
        solar.rotation_euler.y = math.radians((0, 8, 4, 0, 8, 4)[i])

    elif state == 'charge':
        off = shift(dz=(-1, -2)[i])
        splay = (1, 1)[i]
        tube.location.x += px((-2, -3)[i])
        lamps(0.5)
        rig['rim'].data.materials[0] = mats[('amber', 'lamp')[i]]   # the rim powers up
        if i == 1:
            rig['beacon'].data.materials[0] = mats['steel']

    elif state == 'fire':
        tube.location.x += px((-6, -5, -3, -1, 0)[i])
        off = shift(dx=(-2, -1, -1, 0, 0)[i])
        lamps((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])
        if i < 2:
            rig['rim'].data.materials[0] = mats['lamp']
        solar.rotation_euler.y = math.radians((10, 6, 0, 0, 0)[i])

    elif state == 'hurt':
        off = shift(dx=(-2, 1, 0)[i], dz=(1, 0, 0)[i])
        dish.rotation_euler.y += math.radians((-12, 5, 0)[i])
        solar.rotation_euler.y = math.radians((-14, 6, 0)[i])
        lamps((0.3, 0.3, 0.7)[i])

    elif state == 'death':
        # The legs buckle outwards, the dish tears off its pedestal and tumbles away
        # over the front, the solar array droops and the lander burns.
        dz = (1, 0, -3, -6, -8, -8, -8)[i]
        cr.pose_death_fx(rig['fx'], i, fire_at=((-6, 26 + dz), (8, 22 + dz)), smoke_at=(-4, 38 + dz))
        if i >= 2:
            t = i - 2
            rc.set_burnt(mats, palette, True, hues=HUES)
            for e in rig['eyes']:
                e.data.materials[0] = mats['ink']
            rig['beacon'].data.materials[0] = mats['steel']
            rc.hide(rig['layers']['barrel'], True)
            off = shift(dz=dz)
            splay = (2, 4, 6, 7, 7)[t]
            dish.location.x += px((6, 14, 20, 24, 24)[t])
            dish.location.z += px((2, -6, -20, -30, -30)[t] - dz)
            dish.rotation_euler.y += math.radians((25, 60, 100, 120, 120)[t])
            solar.rotation_euler.y = math.radians((-10, -22, -30, -34, -34)[t])
        else:
            off = shift(dz=dz)

    pose_legs(rig, off, feet, splay)


if __name__ == '__main__':
    rc.run_mobile(
        name='orbital', canvas=(96, 88), anchor=(46, 83), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cr.STATES, part_groups=PART_GROUPS,
        materials=('white', 'ice', 'amber', 'steel', 'accent', 'smoke', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
