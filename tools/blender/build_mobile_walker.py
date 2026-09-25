"""
Missile pod walker (the roster's `bigfoot`): procedural model, poses, layered renders.

    blender --background --python build_mobile_walker.py -- --out work/walker --scale 4

A chicken walker on big feet. An amber cockpit shaped from its side profile (a raked
nose over a chin, a steel roof plate, a wrap-round canopy with two eyes on the near
side), a steel hip block with hydraulic hoses, two reverse-knee legs (armoured thigh,
steel shin with a piston) standing on oversized three-toed feet with heel spurs,
and a missile box hung off the near flank on an arm. The box is the gun: the `barrel`
layer is the pod, modelled horizontal with four red warheads showing at the front,
and the client turns it to the aim angle.

The legs are posed with two-bone inverse kinematics from hip and foot positions, and
the feet only ever move in whole pixels, so the walk stays crisp at sprite size.
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
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

# Contract with the simulation (packages/shared, bigfoot sprite): pivot 6 px ahead of
# and 20 px above the anchor, muzzle 16 px along the pod.
PIVOT_DX = 6
PIVOT_UP = 20
BARREL_LENGTH = 16

NEAR_Y = -13.5           # near edge of the near foot: the ground contact row
LEG_Y = 8                # legs and feet sit this far either side of the centre line
POD_Y = -15
HIP_Z = 29
ANKLE_Z = 7
THIGH = 13
SHIN = 13
STAND = {'near': -5, 'far': 8}   # foot x at rest; staggered so both legs read

STATES = {
    'idle': (4, 10, True),
    'move': (8, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 5, False),
    'hurt': (3, 5, False),
    'death': (7, 6, False),
}

# Glow groups are matched by number across layers: the barrel's flash shares the
# body's fire number so no solid part loses its lines.
PART_GROUPS = (
    ('foot_far', 1), ('toe_far', 2), ('leg_far', 3), ('hose', 4), ('pelvis', 5),
    ('leg_near', 6), ('piston', 7), ('knee', 8), ('foot_near', 9), ('toe_near', 10),
    ('hull', 11), ('panel', 12), ('visor', 13), ('eye', 14), ('pupil', 15),
    ('roof', 16), ('stack', 17), ('beacon', 18), ('arm', 19), ('lamp', 20),
    ('wreck', 21), ('smoke', 22), ('boom', 23), ('fire', 24),
    ('hinge', 1), ('pod_box', 2), ('pod_face', 3), ('pod_tube', 4), ('pod_head', 5), ('pod_band', 6),
    ('pod_fin', 7), ('flash', 24),
)


# --------------------------------------------------------------------------
# Geometry helpers
# --------------------------------------------------------------------------

def prism(name, profile, y0, y1, material, bevel=0.0, segments=3, smooth=False):
    """A side-view profile [(x, z), ...] in pixels extruded across y from y0 to y1."""
    bm = bmesh.new()
    front = [bm.verts.new((px(x), px(y0), px(z))) for x, z in profile]
    back = [bm.verts.new((px(x), px(y1), px(z))) for x, z in profile]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(profile)
    for k in range(n):
        a, b = k, (k + 1) % n
        bm.faces.new((front[a], front[b], back[b], back[a]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    rc.finish(obj, material, smooth=smooth)
    if smooth:
        for poly in obj.data.polygons:
            poly.use_smooth = True
    return obj


def grow(profile, d):
    """Push a convex profile outwards from its centroid by d pixels."""
    cx = sum(p[0] for p in profile) / len(profile)
    cz = sum(p[1] for p in profile) / len(profile)
    out = []
    for x, z in profile:
        vx, vz = x - cx, z - cz
        n = math.hypot(vx, vz) or 1
        out.append((x + vx / n * d, z + vz / n * d))
    return out


def intersect(obj, size, centre):
    box = rc.add_box(f'cut_{obj.name}', tuple(px(s) for s in size), tuple(px(c) for c in centre), obj.active_material)
    mod = obj.modifiers.new('Keep', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, obj)
    return obj


def tube(name, pts, radii, material):
    """A bezier tube through `pts` (pixels) with a per-point radius, as a mesh."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(1)
    cu.bevel_resolution = 3
    cu.resolution_u = 6
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
    return rc.finish(obj, material, smooth=True)


def limb(name, length, width, thick_a, thick_b, y, material, bevel=1.2):
    """A tapered plate running along +X from its origin: thick_a at the root, thick_b at the end."""
    obj = prism(name, [(-1.5, -thick_a / 2), (length + 1, -thick_b / 2), (length + 1, thick_b / 2), (-1.5, thick_a / 2)],
                -width / 2, width / 2, material, bevel=px(bevel), segments=2)
    obj.location = (0, px(y), 0)
    return obj


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def build_leg(side, y, mats, root, body):
    """Reverse-knee leg on a big three-toed foot. The foot's origin is the ankle."""
    leg = {'y': y}
    near = side == 'near'
    # Foot: a steel sole with a raked instep, amber toe caps, a heel spur.
    sole = prism(f'foot_{side}', [(-6, 0), (7, 0), (8, 3.5), (2, 7.5), (-3, 7.5), (-6, 4)],
                 y - 5, y + 5, mats['steel'], bevel=px(1.6))
    toes = []
    for k, (dy, reach, h) in enumerate(((-3.2, 16, 5.2), (0, 17.5, 5.6), (3.2, 15, 5.0))):
        t = prism(f'toe_{side}_{k}', [(5, 0), (reach - 1.5, 0), (reach, 1.8), (reach - 2, h), (5, h)],
                  y + dy - 1.5, y + dy + 1.5, mats['amber'], bevel=px(1.2), segments=2)
        toes.append(t)
    spur = prism(f'toe_{side}_spur', [(-6, 0.5), (-12, 0), (-11, 2.2), (-5, 5)], y - 1.6, y + 1.6, mats['amber'],
                 bevel=px(0.8), segments=2)
    ankle = rc.add_sphere(f'knee_{side}_ankle', px(3.6), (0, px(y), px(ANKLE_Z)), mats['steel'], segments=14, rings=7)
    foot = rc.add_empty(f'ankle_{side}', (0, px(y), 0))
    for o in [sole, spur, ankle] + toes:
        rc.parent_keep(o, foot)
    leg['foot'] = foot
    tag = f'leg_{side}'
    leg['thigh'] = limb(f'{tag}_thigh', THIGH, 7, 10, 5.5, y, mats['amber'])
    leg['shin'] = limb(f'{tag}_shin', SHIN, 5, 4.2, 3.6, y, mats['steel'], bevel=1.0)
    piston = rc.add_cylinder(f'piston_{side}', px(1.1), px(SHIN * 0.7), (px(SHIN * 0.45), px(y - 3), px(1.6)),
                             mats['steel'], axis='X', vertices=10)
    rc.parent_keep(piston, leg['shin'])
    leg['knee'] = rc.add_sphere(f'knee_{side}', px(4.2), (0, px(y), 0), mats['steel'], segments=14, rings=7)
    cap = cr.cone(f'knee_{side}_cap', 3.2, 0.6, 5, (-2.5, y, 0), mats['amber'], axis='X', vertices=10)
    cap.rotation_euler = (0, math.radians(180), 0)
    rc.parent_keep(cap, leg['knee'])
    leg['hip'] = rc.add_sphere(f'pelvis_hip_{side}', px(4.4), (0, px(y), 0), mats['steel'], segments=14, rings=7)
    for o in (foot, leg['thigh'], leg['shin'], leg['knee'], leg['hip']):
        rc.parent_keep(o, root)
    body.extend([sole, spur, ankle, piston, cap, leg['thigh'], leg['shin'], leg['knee'], leg['hip']] + toes)
    if not near:
        # the far leg's parts stay in far groups so the near leg draws its lines over them
        for o in (piston, cap, ankle, leg['knee']):
            o.name = f'leg_far_{o.name}'
    return leg


def build_walker(mats, proj):
    body, barrel = [], []
    rig = {}
    root = rc.add_empty('root', (0, 0, 0))
    # The chassis turns about the hips, so a death pitch folds it over the legs.
    chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
    rc.parent_keep(chassis, root)

    rig['legs'] = {
        'far': build_leg('far', LEG_Y, mats, root, body),
        'near': build_leg('near', -LEG_Y, mats, root, body),
    }

    # --- hips ---------------------------------------------------------------
    pelvis = prism('pelvis', [(-10, 25), (8, 25), (10, 29), (8, 33), (-10, 33), (-12, 29)], -7, 7, mats['rubber'],
                   bevel=px(1.4))
    hoses = []

    # --- the cockpit: side profile with a raked nose -------------------------
    hull_prof = [(-15, 33), (6, 32), (21, 38), (21.5, 41.5), (9, 51), (-13, 52), (-17, 48), (-17, 37)]
    hull = prism('hull', hull_prof, -10, 10, mats['amber'], bevel=px(3.2), segments=3)
    # canopy: a glass skin a little proud of the hull, kept only across the near front
    visor = prism('visor', grow(hull_prof, 0.6), -10.6, 10.6, mats['glass'], bevel=px(3.4), segments=3)
    intersect(visor, (20, 12, 8), (13, -7, 43.5))
    # a raised armour panel on the near flank behind the canopy, with a hazard stripe
    # a vent grille of three steel slats on the flank behind the canopy
    panel = prism('panel', [(-14, 37), (-3, 37), (-3, 46), (-14, 46)], -10.9, -9.4, mats['steel'], bevel=px(0.8), segments=2)
    stripe = [prism(f'hull_slat_{k}', [(-13, z), (-4, z), (-4, z + 1.4), (-13, z + 1.4)], -11.6, -10.6, mats['rubber'])
              for k, z in enumerate((38.5, 41, 43.5))]
    roof = prism('roof', [(-15, 50), (4, 50), (7, 52.5), (5, 54.5), (-13, 55), (-16, 52.5)], -8.5, 8.5, mats['steel'],
                 bevel=px(1.0), segments=2)
    chin = prism('roof_chin', [(4, 31), (14, 33.5), (20, 37), (14, 38), (4, 36)], -9.5, 9.5, mats['steel'], bevel=px(1.0), segments=2)
    lamp = rc.add_cylinder('lamp', px(1.4), px(1.2), (px(17), px(-9.2), px(36.2)), mats['lamp'], axis='Y',
                           vertices=10, smooth=False)

    eyes = []
    for k, ex in enumerate((4.5, 10.5)):
        eye = rc.add_cylinder(f'eye_{k}', px(2.7), px(0.8), (px(ex), px(-11.2), px(42.5)), mats['eye'], vertices=12, smooth=False)
        pupil = rc.add_cylinder(f'pupil_{k}', px(1.2), px(0.8), (px(ex + 0.9), px(-11.7), px(42.3)), mats['rubber'],
                                vertices=8, smooth=False)
        rc.parent_keep(pupil, eye)
        eyes.append(eye)
        body.extend((eye, pupil))
    rig['eyes'] = eyes

    stacks = [tube('stack_0', [(-12, 3, 52), (-13, 3, 57), (-16, 3, 59)], (1.9, 1.8, 1.7), mats['steel'])]
    beacon_mast = rc.add_cylinder('beacon_mast', px(0.7), px(5), (px(-3), px(-5), px(56.5)), mats['steel'], axis='Z', vertices=8)
    beacon = rc.add_sphere('beacon', px(1.9), (px(-3), px(-5), px(59.5)), mats['accent'], segments=12, rings=6)
    rig['beacon'] = beacon

    # --- the pod arm, from the hip block out to the hinge ---------------------
    pivot_z = proj.z_for_height(PIVOT_UP, world_y=px(POD_Y)) * rc.PX_PER_UNIT
    arm = tube('arm', [(PIVOT_DX - 3, -7, 31), (PIVOT_DX - 1, -11, pivot_z + 4), (PIVOT_DX, POD_Y + 2.5, pivot_z)],
               (2.0, 1.8, 1.8), mats['steel'])

    chassis_parts = stripe + [pelvis, hull, visor, panel, roof, chin, lamp, beacon_mast, beacon, arm] + hoses + stacks + eyes
    for o in chassis_parts:
        rc.parent_keep(o, chassis)
    body.extend(stripe + [pelvis, hull, visor, panel, roof, chin, lamp, beacon_mast, beacon, arm] + hoses + stacks)
    rig['chassis'] = chassis

    # --- the pod: barrel layer ---------------------------------------------
    pivot_w = Vector((px(PIVOT_DX), px(POD_Y), px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, chassis)
    hinge = rc.add_cylinder('hinge', px(3.2), px(2), pivot_w + Vector((0, px(-5.5), 0)), mats['steel'], axis='Y', vertices=16)
    hub = rc.add_cylinder('hinge_hub', px(1.4), px(1), pivot_w + Vector((0, px(-6.8), 0)), mats['rubber'], axis='Y',
                          vertices=10, smooth=False)
    tube_grp = rc.add_empty('tube_grp', pivot_w)

    def at(x, y, z):
        return pivot_w + Vector((px(x), px(y), px(z)))

    L = BARREL_LENGTH
    pod = []
    # armoured box, chamfered at the back, with the tubes' faceplate at the front
    box = prism('pod_box', [(-6, -5.2), (L - 4, -5.2), (L - 4, 5.2), (-3, 5.2), (-6, 2.5)], -5, 5, mats['amber'],
                bevel=px(1.2), segments=2)
    box.location = pivot_w.copy()
    face = prism('pod_face', [(L - 4.5, -5.6), (L - 3, -5.6), (L - 3, 5.6), (L - 4.5, 5.6)], -5.4, 5.4, mats['steel'],
                 bevel=px(0.8), segments=2)
    face.location = pivot_w.copy()
    band = prism('pod_band', [(1, -5.6), (3.4, -5.6), (3.4, 5.6), (1, 5.6)], -5.4, 5.4, mats['accent'],
                 bevel=px(0.6), segments=2)
    band.location = pivot_w.copy()
    fin = prism('pod_fin', [(4, 5), (10, 5), (9, 7), (5, 7)], -2.5, 2.5, mats['steel'], bevel=px(0.5), segments=2)
    fin.location = pivot_w.copy()
    pod += [box, face, band, fin]
    for dy in (-2.4, 2.4):
        for dz in (-2.4, 2.4):
            k = len(pod)
            pod.append(rc.add_cylinder(f'pod_tube_{k}', px(2.3), px(1.2), at(L - 2.6, dy * 1.05, dz * 1.05), mats['rubber'],
                                       axis='X', vertices=12))
            # a blunt rounded warhead poking out of each tube
            head = rc.add_sphere(f'pod_head_{k}', px(1), at(L - 1.6, dy * 1.05, dz * 1.05), mats['accent'],
                                 scale=(3.0, 2.0, 2.0), segments=16, rings=8)
            pod.append(head)
    for o in pod:
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    rc.parent_keep(hinge, pivot)
    rc.parent_keep(hub, pivot)
    barrel.extend([hinge, hub] + pod)

    muzzle_w = at(L, 0, 0)
    flashes = []
    for k, dz in enumerate((2.6, -2.4)):
        outer = rc.add_sphere(f'flash_outer_{k}', px(1), muzzle_w + Vector((px(4.5 + k), px(-1), px(dz))), mats['flame'], scale=(7, 3, 4.4), segments=12, rings=6)
        core = rc.add_sphere(f'flash_core_{k}', px(1), muzzle_w + Vector((px(3.8 + k), px(-4), px(dz))), mats['flash'], scale=(4.4, 2, 2.6), segments=12, rings=6)
        flashes += [outer, core]
    for o in flashes:
        rc.parent_keep(o, pivot)
        barrel.append(o)
    rig['flash'] = flashes
    rig['pivot'] = pivot
    rig['tube_grp'] = tube_grp
    rig['heads'] = [o for o in pod if o.name.startswith('pod_head')]

    # --- death props (body layer) -------------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-17), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    wreck = prism('wreck_pod', [(-6, -4.5), (9, -4.5), (9, 4.5), (-3, 5.5), (-6, 3)], -4.8, 4.8, mats['amber'],
                  bevel=px(1.2), segments=2)
    bits = [rc.add_box(f'wreck_bit_{k}', (px(3.4), px(3), px(2.6)), (0, px(-16), 0), mats[m], bevel=px(0.5))
            for k, m in enumerate(('amber', 'steel', 'accent'))]
    for o in [wreck] + smoke + bits:
        rc.parent_keep(o, root)
        body.append(o)
    rig['boom'] = rc.add_fire('boom', mats, (px(-2), px(-18), px(42)), 16, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(-6), px(-16), px(52)), 5.2, root, tall=1.6)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(7), px(-16), px(30)), 4.0, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])
    for o in smoke:
        o.visible_shadow = False
    rig['smoke'] = smoke
    rig['bits'] = bits
    rig['wreck'] = wreck

    rig['layers'] = {'body': body, 'barrel': barrel}
    bpy.context.view_layer.update()
    rig['rest'] = {o.name: o.location.copy() for o in (chassis, tube_grp)}
    return rig


# --------------------------------------------------------------------------
# Poses
# --------------------------------------------------------------------------

def pose_leg(leg, hip, foot_x, foot_z):
    """Two-bone IK in the XZ plane, knee to the back like a bird. `hip` is (x, z) in pixels."""
    y = leg['y']
    ankle = (foot_x, foot_z + ANKLE_Z)
    knee = parts.two_bone_ik(hip, ankle, THIGH, SHIN, knee='back')
    leg['foot'].location = (px(foot_x), px(y), px(foot_z))
    leg['hip'].location = (px(hip[0]), px(y), px(hip[1]))
    leg['knee'].location = (px(knee[0]), px(y), px(knee[1]))
    parts.aim(leg['thigh'], hip, knee, y)
    parts.aim(leg['shin'], knee, ankle, y)


def walk_foot(phase):
    return parts.walk_foot(phase, stride=6, lift=4)


def pose(rig, mats, palette, state, i):
    chassis, tube = rig['chassis'], rig['tube_grp']
    rest = rig['rest']
    chassis.location = rest[chassis.name].copy()
    chassis.rotation_euler = (0, 0, 0)
    tube.location = rest[tube.name].copy()
    rig['beacon'].data.materials[0] = mats['accent']
    for e in rig['eyes']:
        e.scale = (1, 1, 1)
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['flash'], True)
    for fire in (rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.hide(rig['bits'], True)
    rc.hide(rig['smoke'], True)
    rc.hide([rig['wreck']], True)
    rc.hide(rig['eyes'], False)
    rc.set_burnt(mats, palette, False, hues=('amber',))
    for e in rig['eyes']:
        e.data.materials[0] = mats['eye']

    feet = {side: (x, 0) for side, x in STAND.items()}
    dx = dz = 0

    if state == 'idle':
        dz = (0, -1, -1, 0)[i]
        if i >= 2:
            rig['beacon'].data.materials[0] = mats['rubber']

    elif state == 'move':
        n = STATES['move'][0]
        feet = {'near': walk_foot(i / n), 'far': walk_foot(i / n + 0.5)}
        feet = {s: (1 + fx, fz) for s, (fx, fz) in feet.items()}
        dz = (-1, 0, 0, 0)[i % 4]         # sinks when the feet are furthest apart

    elif state == 'charge':
        # Held while the player charges: knees bend, the pod hauls back, eyes narrow, beacon strobes.
        dz = (-2, -3)[i]
        tube.location.x += px((-2, -3)[i])
        for e in rig['eyes']:
            e.scale = (1, 1, 0.5)
        if i == 1:
            rig['beacon'].data.materials[0] = mats['rubber']

    elif state == 'fire':
        tube.location.x += px((-5, -4, -2, -1, 0)[i])
        dx = (-2, -2, -1, 0, 0)[i]
        dz = (0, -1, -1, 0, 0)[i]
        if i < 2:
            rc.hide(rig['flash'], False)
            k = (1.0, 0.55)[i]
            for f in rig['flash']:
                f.scale = (k, k, k)

    elif state == 'hurt':
        dx = (-2, 1, 0)[i]
        dz = (1, -1, 0)[i]
        for e in rig['eyes']:
            e.scale = (1, 1, (0.35, 0.35, 0.7)[i])

    elif state == 'death':
        # Flash, fireball, the pod is blown off forwards, the legs give way and the
        # cockpit sits down on its own feet, burning from the roof and the torn hinge.
        t = i - 2
        if i == 0:
            dz = 1
            rc.pose_fire(rig['boom'], 0.42)
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.set_burnt(mats, palette, True, hues=('amber',))
            rig['beacon'].data.materials[0] = mats['rubber']
            for e in rig['eyes']:
                e.data.materials[0] = mats['rubber']      # lights out
            rc.hide(rig['layers']['barrel'], True)
            rc.hide([rig['wreck']], False)
            dz = (2, -4, -10, -13, -13)[t]
            dx = (-1, -1, 0, 0, 0)[t]
            pitch = (-5, 2, 8, 10, 10)[t]
            chassis.rotation_euler.y = math.radians(pitch)
            rig['wreck'].location = (px((15, 21, 25, 27, 27)[t]), px(-12), px((22, 20, 9, 5.2, 5.2)[t]))
            rig['wreck'].rotation_euler = (0, math.radians((-25, -70, -140, -180, -180)[t]), 0)
            rc.pose_fire(rig['boom'], (0.78, 0.4, 0, 0, 0)[t])
            roof_z = 54 + dz
            rc.pose_fire(rig['fire_a'], (0.6, 1.0, 1.1, 0.9, 1.0)[t], lean_deg=(0, -8, 7, -6, 5)[t], at=(-6 + dx, roof_z))
            rc.pose_fire(rig['fire_b'], (0, 0.6, 0.95, 1.0, 0.8)[t], lean_deg=(0, 6, -8, 7, -5)[t], at=(7 + dx, 18 + dz * 0.5))
            rc.hide(rig['bits'], False)
            for bit, (x0, vx, vz) in zip(rig['bits'], ((-8, -5, 8), (6, 5, 9), (0, 2.5, 12))):
                tt = t + 1
                bit.location.x = px(x0 + vx * min(tt, 4))
                bit.location.z = px(max(1.3, 38 + vz * tt - 3.2 * tt * tt))
                bit.rotation_euler = (0, math.radians(50 * tt if bit.location.z > px(1.4) else 0), 0)
            rc.hide(rig['smoke'], t < 2)
            for s, (sx, sz, k) in zip(rig['smoke'], ((-10, 52, 0.9), (-14, 57, 0.6))):
                g = k * (0, 0, 0.8, 1.0, 0.9)[t]
                s.location = (px(sx), px(-17), px(sz + (0, 0, 0, 1, 2)[t]))
                s.scale = (g, g, g)

    chassis.location.x += px(dx)
    chassis.location.z += px(dz)
    # The far (front) foot sits deeper, so the tilted camera draws it higher: sink it back
    # on to the ground row, on top of any walk lift.
    plant = parts.plant_z(rig['legs']['far']['y'], rig['legs']['near']['y'])
    for side, leg in rig['legs'].items():
        fx, fz = feet[side]
        pose_leg(leg, (dx, HIP_Z + dz), fx, fz + (plant if side == 'far' else 0))


if __name__ == '__main__':
    rc.run_mobile(
        name='walker', canvas=(84, 72), anchor=(40, 69), near_y=px(NEAR_Y),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('amber', 'steel', 'rubber', 'accent', 'glass', 'char', 'smoke', 'eye', 'lamp', 'flame', 'flash'),
        build=build_walker, pose=pose)
