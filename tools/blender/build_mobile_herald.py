"""
Hooded herald (roster id `aduka`): a chibi humanoid on the chibi_mech body plan.

    blender --background --python build_mobile_herald.py -- --out work/herald --scale 4

A herald calls the strike down from the sky, so it carries a long brass clarion with a
swallowtail banner hanging from it (the `barrel` layer). It wears a winged hood, the
messenger's mark: gold feathered wings sweep up and back from the crown, over a dark face
opening ringed in gold with two glowing eyes, and a dagged shoulder mantle. Under it a
coat skirt with a gold hem, a red cloak that wraps the back and swings, and curled-toe
shoes.

The build is chibi_mech.make() copied and changed: the hood needs its own head (an oval
face opening instead of the visor band), and the barrel flash takes the body fire's
glow group number instead of a solid part's.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chibi_mech as cm  # noqa: E402
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

BARREL_LENGTH = 20
PIVOT = (3, 18)
GUN_Y = -9
HIP_Z, BOOT_Y, STAND = cm.HIP_Z, cm.BOOT_Y, cm.STAND
HEAD_C = (0, 0, 31)
HEAD_R = (12, 10.5, 11.5)
HUES = ('blue', 'amber', 'accent')

# Wing outlines (x, z) from the root at the back of the crown, scaled by WING_K: the
# long quills sweep back in five feather tips, the coverts sit over their roots in
# their own part group so a line separates the two rows.
WING_K = 1.0
WING_QUILLS = ((1, -1), (1.5, 3), (-1, 7), (-5, 9.5), (-10, 10.8), (-17, 10.5), (-10.5, 7.2), (-17.5, 5.8),
               (-10.5, 3.8), (-16, 1.5), (-9, 0.8), (-12, -2), (-5, -1.5))
WING_COVERTS = ((1, -1), (1.5, 3), (-1, 6.5), (-5, 8.2), (-8.5, 7.5), (-6.5, 5), (-8.5, 3), (-5.5, 1.2), (-4, -1.5))

# Glow groups match by number across layers: the clarion's flash shares the body
# fire's 21, so no solid part loses its lines.
PART_GROUPS = (
    ('boot_far', 1), ('leg_far', 2), ('pack', 3), ('boot_near', 4), ('leg_near', 5), ('torso', 6),
    ('chest', 7), ('mantle', 8), ('head', 10), ('rim', 11), ('face', 12), ('eye', 13),
    ('wingfar', 14), ('wingc', 15), ('wing', 9),
    ('smoke', 19), ('boom', 20), ('fire', 21),
    ('hinge', 16), ('arm', 17), ('bell', 18), ('banner', 22), ('crest', 23), ('glove', 24), ('flash', 21),
)


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def tube(name, pts, radii, material, squash=1.0, resolution=6):
    """A smooth bezier tube through `pts` whose thickness follows `radii` (copied from
    the wyvern). `squash` flattens it across y."""
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


def plate(name, outline, y, material, thick=0.8):
    """A flat polygon in the x-z plane at depth `y`, given solid thickness."""
    bm = bmesh.new()
    verts = [bm.verts.new((px(x), px(y), px(z))) for x, z in outline]
    bm.faces.new(verts)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(thick)
    mod.offset = 0
    return rc.finish(obj, material, smooth=False)


def shell_patch(name, centre, radii, cut_centre, cut_radii, material):
    """The part of an ellipsoid inside another ellipsoid: a patch that sits on a
    slightly smaller body like a face opening or a trim."""
    shell = rc.add_sphere(name, px(1), centre, material, scale=radii, segments=32, rings=16)
    cut = rc.add_sphere(f'cut_{name}', px(1), cut_centre, material, scale=cut_radii, segments=24, rings=12)
    mod = shell.modifiers.new('Patch', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = cut
    cut.hide_render = True
    cut.hide_viewport = True
    rc.parent_keep(cut, shell)
    return shell


def dagged_cone(name, r_bottom, r_top, depth, location, material, dags, drop, vertices=48, keep=None):
    """An open cone whose bottom rim hangs in `dags` points, `drop` px long. `keep(angle)`
    decides which part of the ring survives (a cloak only wraps the back). Solidified."""
    bm = bmesh.new()
    rows = 4
    grid = []
    for r in range(rows + 1):
        t = r / rows
        row = []
        for k in range(vertices):
            a = 2 * math.pi * k / vertices
            rad = r_bottom + (r_top - r_bottom) * t
            z = -depth / 2 + depth * t
            if r == 0:
                z -= drop * abs(math.sin(a * dags / 2))
            row.append(bm.verts.new((px(rad * math.cos(a)), px(rad * math.sin(a)), px(z))))
        grid.append(row)
    for r in range(rows):
        for k in range(vertices):
            k2 = (k + 1) % vertices
            a = 2 * math.pi * (k + 0.5) / vertices
            if keep and not keep(a):
                continue
            bm.faces.new((grid[r][k], grid[r][k2], grid[r + 1][k2], grid[r + 1][k]))
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(1.0)
    mod.offset = 1
    return rc.finish(obj, material, smooth=True)


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build(mats, proj):
    body, barrel = [], []
    rig = {}
    hue = mats['blue']
    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
    rc.parent_keep(chassis, root)

    # --- shoes with curled toes, stub legs -------------------------------------------
    legs = {}
    for side, y in (('far', BOOT_Y), ('near', -BOOT_Y)):
        boot = rc.add_box(f'boot_{side}', (px(13), px(7.5), px(6.5)), (px(0.5), px(y), px(3.25)), mats['rubber'], bevel=px(2.2))
        toe = tube(f'boot_{side}_toe', [(4, y, 2.6), (8.5, y, 2.4), (11, y, 4.2), (10, y, 6.2)], (3.2, 2.5, 1.4, 0.7), mats['rubber'])
        cuff = rc.add_cylinder(f'boot_{side}_cuff', px(3.6), px(1.8), (px(-1.5), px(y), px(6.6)), mats['amber'], axis='Z', vertices=14)
        rc.set_origin(boot, (0, px(y), 0))
        for o in (toe, cuff):
            rc.parent_keep(o, boot)
        leg = rc.add_cylinder(f'leg_{side}', px(2.6), px(8), (px(4), 0, 0), hue, axis='X', vertices=12)
        rc.set_origin(leg, (0, 0, 0))
        for o in (boot, leg):
            rc.parent_keep(o, root)
        body.extend((boot, toe, cuff, leg))
        legs[side] = {'boot': boot, 'leg': leg, 'y': y}
    rig['legs'] = legs

    # --- body: coat skirt, cloak, mantle ------------------------------------------------
    torso = rc.add_sphere('torso', px(1), (0, 0, px(18)), hue, scale=(12, 9.5, 8.5), segments=24, rings=12)
    coat = cm.add_cone('chest_coat', px(12.5), px(8.5), px(10), (0, 0, px(13)), hue, vertices=32)
    hem = rc.add_cylinder('rim_hem', px(12.9), px(1.8), (0, 0, px(8.6)), mats['amber'], axis='Z', vertices=32)
    mantle = dagged_cone('mantle', 12.6, 7.5, 7, (0, 0, px(23.5)), hue, dags=10, drop=2.2)
    # The cloak wraps only the back, hinged at the shoulders so it can swing.
    cloak = dagged_cone('pack_cloak', 13.5, 8.5, 20, (0, 0, px(-10)), mats['accent'], dags=8, drop=1.6,
                        keep=lambda a: math.cos(a) < -0.35)
    rc.set_origin(cloak, (0, 0, 0))
    cloak.location = (px(-2), 0, px(23))
    for o in (torso, coat, hem, mantle, cloak):
        rc.parent_keep(o, chassis)
    body.extend([cloak, torso, coat, hem, mantle])

    # --- the hooded head ------------------------------------------------------------------
    hx, hz = HEAD_C[0], HEAD_C[2]
    head_grp = rc.add_empty('head_grp', (px(hx), 0, px(hz)))
    head_c = (px(hx), 0, px(hz))
    head = rc.add_sphere('head', px(1), head_c, hue, scale=HEAD_R, segments=32, rings=16)
    fc = (px(hx + 6), px(-9), px(hz - 1))                          # the face looks forward and at us
    rim = shell_patch('rim_face', head_c, tuple(r + 0.5 for r in HEAD_R), fc, (9.5, 9, 7.2), mats['amber'])
    face = shell_patch('face', head_c, tuple(r + 0.9 for r in HEAD_R), fc, (8, 8, 5.8), mats['ink'])
    eyes = [rc.add_cylinder(f'eye_{k}', px(2.1), px(0.8), (px(hx + ex), px(-11.9), px(hz - 0.6)), mats['cyan'], vertices=12, smooth=False)
            for k, ex in enumerate((3.0, 8.6))]
    # Winged hood, the messenger's mark: a gold feathered wing on each side of the
    # crown sweeping up and back, the far one peeking over the top.
    wings = []
    for side, y, (ox, oz) in (('far', 11.8, (2.5, 2.5)), ('near', -11.8, (0.0, 0.0))):
        wr = (hx - 5 + ox, hz + 5.5 + oz)
        grp = rc.add_empty(f'wing_{side}_root', (px(wr[0]), px(y), px(wr[1])))
        tag = 'wingfar' if side == 'far' else 'wing'
        for part, outline, dy in (('_quills', WING_QUILLS, 0.0), ('c_coverts', WING_COVERTS, -0.9 if side == 'near' else 0.9)):
            o = plate(tag + part, [(wr[0] + x * WING_K, wr[1] + z * WING_K) for x, z in outline], y + dy, mats['amber'], thick=0.9)
            o.visible_shadow = False
            rc.parent_keep(o, grp)
            body.append(o)
        grp.rotation_euler.x = math.radians(-16)   # tipped up to catch the light
        rc.parent_keep(grp, head_grp)
        wings.append(grp)
    for o in [head, rim, face] + eyes:
        rc.parent_keep(o, head_grp)
    body.extend([head, rim, face] + eyes)
    rc.parent_keep(torso, chassis)
    rc.parent_keep(head_grp, chassis)
    rig.update(chassis=chassis, head_grp=head_grp, eyes=eyes, cloak=cloak, wings=wings)

    # --- the clarion: barrel layer ---------------------------------------------------------
    pivot_z = proj.z_for_height(PIVOT[1]) * rc.PX_PER_UNIT
    pivot_w = Vector((px(PIVOT[0]), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    rc.parent_keep(tube_grp, pivot)
    hinge = rc.add_sphere('hinge', px(1.2), pivot_w, mats['steel'], segments=12, rings=6)
    rc.parent_keep(hinge, pivot)
    barrel.append(hinge)

    P = (PIVOT[0], GUN_Y, pivot_z)

    def at(x, y=0.0, z=0.0):
        return (P[0] + x, P[1] + y, P[2] + z)

    gun = [
        tube('arm_pipe', [at(-5), at(6), at(14)], (1.3, 1.2, 1.3), mats['amber']),
        rc.add_cylinder('crest_mouth', px(1.9), px(1.6), Vector(tuple(px(c) for c in at(-5.5))), mats['amber'], axis='X', vertices=12),
        rc.add_sphere('crest_knop', px(2.0), Vector(tuple(px(c) for c in at(6))), mats['amber'], segments=12, rings=8),
        tube('bell', [at(13), at(16), at(18.5), at(BARREL_LENGTH + 0.5)], (1.4, 1.9, 3.0, 4.8), mats['amber'], resolution=8),
        rc.add_cylinder('face_bell_mouth', px(3.9), px(0.6), Vector(tuple(px(c) for c in at(BARREL_LENGTH + 1.0))), mats['ink'], axis='X', vertices=16, smooth=False),
    ]
    # Swallowtail banner hanging under the pipe, with a gold roundel.
    bx0, bx1, top, bot = 0.5, 11.5, -0.8, -9.5
    tails = [(bx1, bot), (bx1 - 2.75, bot + 2.4), (bx1 - 5.5, bot), (bx1 - 8.25, bot + 2.4), (bx0, bot)]
    banner = plate('banner', [(P[0] + bx0, P[2] + top), (P[0] + bx1, P[2] + top)]
                   + [(P[0] + x, P[2] + z) for x, z in tails], P[1] + 1.2, mats['accent'], thick=0.9)
    roundel = rc.add_cylinder('crest_roundel', px(2.2), px(0.6), Vector(tuple(px(c) for c in at(bx0 + 5.5, 0.6, -4.6))), mats['amber'], vertices=14, smooth=False)
    gloves = [rc.add_sphere(f'glove_{k}', px(1), Vector(tuple(px(c) for c in at(gx, -1.5, -0.6))), mats['steel'], scale=(2.4, 2.0, 2.4), segments=12, rings=8)
              for k, gx in enumerate((-2.5, 14.8))]
    for o in gun + [banner, roundel] + gloves:
        rc.parent_keep(o, tube_grp)
        barrel.append(o)
    muzzle = pivot_w + Vector((px(BARREL_LENGTH + 4), px(GUN_Y - 1), 0))
    rig['flash'] = rc.add_fire('flash', mats, muzzle, 4.8, pivot, tall=1)
    barrel.extend(rig['flash'])
    rig.update(pivot=pivot, tube_grp=tube_grp)

    # --- death props -----------------------------------------------------------------------
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
    movers = [chassis, head_grp, tube_grp, cloak] + wings
    rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in movers}
    return rig


# --------------------------------------------------------------------------
# Poses (chibi_mech's, plus the cloak and the wings)
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    chassis, head, tube_g = rig['chassis'], rig['head_grp'], rig['tube_grp']
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
    swing = flop = 0

    def lids(k):
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    if state == 'idle':
        dz = (0, 0, -1, -1, -1, 0)[i]
        head.location.z += px((0, 0, 0, -1, -1, 0)[i])
        swing = (0, 0, 5, 10, 5, 0)[i]
        flop = (0, 0, 8, 14, 8, 0)[i]                    # the wings stretch
        if i == 4:
            lids(0.15)

    elif state == 'move':
        n = cm.STATES['move'][0]
        feet = {'near': parts.walk_foot(i / n, 3, 3), 'far': parts.walk_foot(i / n + 0.5, 3, 3)}
        feet = {side: (x + STAND[side] // 2, z) for side, (x, z) in feet.items()}
        dz = (-1, 0, 0)[i % 3]
        head.location.z += px((0, -1, 0)[i % 3])
        swing = (8, 14, 18, 14, 8, 4)[i]                 # the cloak streams out behind a stride
        flop = (-6, -12, -6, -6, -12, -6)[i]             # swept back by the wind of the walk

    elif state == 'charge':
        # Draws breath: leans back, clarion hauled in, cloak lifts and eyes narrow.
        dz = (-1, -2)[i]
        tube_g.location.x += px((-2, -3)[i])
        tube_g.location.z += px((1, 2)[i])               # the clarion comes up to sound
        head.location.x += px((-1, -2)[i])
        lids(0.5)
        swing, flop = (24, 34)[i], (22, 32)[i]           # cloak billows, wings flare

    elif state == 'fire':
        tube_g.location.x += px((-3, -3, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        head.location.x += px((-1, -1, -1, 0, 0)[i])
        lids((0.4, 0.4, 0.7, 1, 1)[i])
        rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])
        swing = (26, 20, 12, 4, 0)[i]
        flop = (-22, -14, -6, 0, 0)[i]

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        head.location.x += px((-2, -1, 0)[i])
        head.location.z += px((1, 0, 0)[i])
        lids((0.3, 0.3, 0.7)[i])
        swing = (22, 8, 0)[i]
        flop = (-20, 10, 0)[i]

    elif state == 'death':
        # Flash, fireball, the hood is blown off backwards and rolls to rest in front of
        # the shoes; the body sags and burns from the neck, the cloak drops over it.
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
            swing = (30, 20, 0, -10, -10)[t]
            flop = (-20, -30, -40, -40, -40)[t]
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
    rig['cloak'].rotation_euler.y += math.radians(swing)
    for w in rig['wings']:
        w.rotation_euler.y += math.radians(flop)      # positive spreads the wings up and forward
    for side, leg in rig['legs'].items():
        fx, fz = feet[side]
        fz += parts.plant_z(leg['y'], rig['legs']['near']['y']) + cm.BOOT_SINK   # soles on the ground row; the far one sinks for the tilt
        leg['boot'].location = (px(fx), px(leg['y']), px(fz))
        parts.aim(leg['leg'], (dx + (1 if side == 'near' else -1), HIP_Z + dz + 1), (fx, fz + 5), leg['y'])


if __name__ == '__main__':
    rc.run_mobile(
        name='herald', canvas=cm.CANVAS, anchor=cm.ANCHOR, near_y=px(cm.NEAR_Y),
        barrel_length=BARREL_LENGTH, states=cm.STATES, part_groups=PART_GROUPS,
        materials=('blue', 'rubber', 'steel', 'amber', 'accent', 'smoke', 'cyan', 'ink', 'lamp', 'flame', 'flash'),
        build=build, pose=pose)
