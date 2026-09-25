"""
Shared build for the chibi bipeds, mechs and humanoids alike: fat boots on stub legs, a round torso, a big
dome head with a visor band and two eyes, and an arm for a gun. A mobile script passes a
`spec` dict and gets `build` and `pose` functions back for rc.run_mobile:

    spec = {
        'hue': 'blue',                   # ramp for torso, head and legs
        'visor': 'amber',                # ramp for the visor band
        'pivot': (14, 16),               # barrel pivot: px ahead of, px above the anchor
        'barrel_length': 8,
        'flash': 5.5,                    # muzzle flash size
        'head_dx': 0, 'hinge': 3.3,      # optional: slide the head back, shrink the hinge
        'eye': 'eye', 'eye_r': 2.5,      # optional: flat used for the eyes (white by default), and their radius
        'extras': fn(mats, rig, add),    # horns, packs, rings; add(obj, to='chassis'|'head')
        'barrel': fn(mats, pivot_w, add),  # the gun; add(obj, recoils=True|False)
        'extras_pose': fn(rig, mats, state, i),   # optional, runs after the common pose
    }

Name extras with the prefixes pack_, chest_ or top_ so they fall into the part groups
below; name gun parts arm_, muzzle_ or blade_. All sizes are sprite pixels at 1x.
"""
import math

import bpy
from mathutils import Vector

import parts
import render_common as rc
from render_common import px

NEAR_Y = -11
BOOT_Y = 6
HIP_Z = 12
STAND = {'near': 5, 'far': -6}
# The boots' bevelled heels round off ~3/4 px above their soles, so a boot at z 0 leaves the
# anchor row empty; every boot sits this much lower (px) to put its sole on the ground row.
BOOT_SINK = -0.5
HEAD_C = (1, 0, 31)
HEAD_R = (12, 10.5, 11)

STATES = {
    'idle': (6, 10, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 6, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}

PART_GROUPS = (
    ('boot_far', 1), ('leg_far', 2), ('pack', 3), ('boot_near', 4), ('leg_near', 5), ('torso', 6),
    ('chest', 7), ('head', 8), ('visor', 9), ('eye', 10), ('top', 11),
    ('smoke', 19), ('boom', 20), ('fire', 21),
    ('hinge', 1), ('arm', 2), ('muzzle', 3), ('blade', 4), ('flash', 21),
)

CANVAS = (88, 78)
ANCHOR = (46, 70)


def add_cone(name, r_bottom, r_top, depth, location, material, axis='Z', vertices=12):
    rot = {'X': (0, math.pi / 2, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r_bottom, radius2=r_top, depth=depth, location=location, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return rc.finish(obj, material, smooth=True)


def add_ring(name, major, minor, location, material, facing='Y'):
    """A torus; `facing` is the axis its hole looks along."""
    rot = {'Y': (math.pi / 2, 0, 0), 'X': (0, math.pi / 2, 0), 'Z': (0, 0, 0)}[facing]
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=20, minor_segments=8,
                                     location=location, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return rc.finish(obj, material, smooth=True)


def make(spec):
    """Returns (build, pose) closed over `spec`."""

    def build(mats, proj):
        body, barrel = [], []
        rig = {'spec': spec}
        hue = mats[spec['hue']]
        root = rc.add_empty('root', (0, 0, 0))
        chassis = rc.add_empty('chassis', (0, 0, px(HIP_Z)))
        rc.parent_keep(chassis, root)

        # --- boots and legs ---------------------------------------------------
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

        # --- torso and head -----------------------------------------------------
        torso = rc.add_sphere('torso', px(1), (0, 0, px(18)), hue, scale=(13, 10, 8.5), segments=24, rings=12)
        hx = HEAD_C[0] + spec.get('head_dx', 0)      # slide the head back when the gun sits at face height
        head_grp = rc.add_empty('head_grp', (px(hx), 0, px(HEAD_C[2])))
        head_c = (px(hx), 0, px(HEAD_C[2]))
        head = rc.add_sphere('head', px(1), head_c, hue, scale=HEAD_R, segments=32, rings=16)
        visor = rc.add_sphere('visor', px(1), head_c, mats[spec['visor']], scale=tuple(r + 0.7 for r in HEAD_R), segments=32, rings=16)
        band = rc.add_box('cut_visor_band', (px(18), px(13), px(7.6)), (px(hx + 5.5), px(-6.5), px(30.6)), mats[spec['visor']])
        mod = visor.modifiers.new('Band', 'BOOLEAN')
        mod.operation = 'INTERSECT'
        mod.object = band
        band.hide_render = True
        band.hide_viewport = True
        rc.parent_keep(band, visor)
        eyes = [rc.add_cylinder(f'eye_{k}', px(spec.get('eye_r', 2.5)), px(0.8), (px(hx + ex), px(-11.6), px(30.6)), mats[spec.get('eye', 'eye')], vertices=12, smooth=False)
                for k, ex in enumerate((1.5, 8.0))]
        for o in [head, visor] + eyes:
            rc.parent_keep(o, head_grp)
        body.extend([torso, head, visor] + eyes)
        rig.update(chassis=chassis, head_grp=head_grp, eyes=eyes, torso=torso)

        def add_extra(obj, to='chassis'):
            rc.parent_keep(obj, head_grp if to == 'head' else chassis)
            body.append(obj)
            for child in obj.children_recursive:
                if not child.name.startswith('cut_'):
                    body.append(child)
            return obj

        spec['extras'](mats, rig, add_extra)
        rc.parent_keep(torso, chassis)
        rc.parent_keep(head_grp, chassis)

        # --- the gun: barrel layer ---------------------------------------------------
        dx, up = spec['pivot']
        pivot_z = proj.z_for_height(up) * rc.PX_PER_UNIT
        pivot_w = Vector((px(dx), 0, px(pivot_z)))
        pivot = rc.add_empty('barrel_pivot', pivot_w)
        rc.parent_keep(pivot, chassis)
        tube_grp = rc.add_empty('tube_grp', pivot_w)
        rc.parent_keep(tube_grp, pivot)
        hinge = rc.add_sphere('hinge', px(spec.get('hinge', 3.3)), pivot_w, mats['steel'], segments=14, rings=8)
        rc.parent_keep(hinge, pivot)
        barrel.append(hinge)

        def add_gun(obj, recoils=True):
            rc.parent_keep(obj, tube_grp if recoils else pivot)
            barrel.append(obj)
            return obj

        spec['barrel'](mats, pivot_w, add_gun, rig)
        muzzle = pivot_w + Vector((px(spec['barrel_length'] + spec['flash'] * 0.7), px(-8), 0))
        rig['flash'] = rc.add_fire('flash', mats, muzzle, spec['flash'], pivot, tall=1)
        barrel.extend(rig['flash'])
        rig.update(pivot=pivot, tube_grp=tube_grp)

        # --- death props ------------------------------------------------------------------
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
        movers = [chassis, head_grp, tube_grp] + list(rig.get('movers', []))
        rig['rest'] = {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in movers}
        return rig

    def pose(rig, mats, palette, state, i):
        chassis, head, tube = rig['chassis'], rig['head_grp'], rig['tube_grp']
        for name, (loc, rot, scale) in rig['rest'].items():
            o = bpy.data.objects[name]
            o.location, o.rotation_euler, o.scale = loc.copy(), rot.copy(), scale.copy()
        for e in rig['eyes']:
            e.scale = (1, 1, 1)
            e.data.materials[0] = mats[spec.get('eye', 'eye')]
        rc.hide(rig['layers']['barrel'], False)
        rc.hide(rig['smoke'], True)
        for fire in (rig['flash'], rig['boom'], rig['fire_a'], rig['fire_b']):
            rc.pose_fire(fire, 0)
        hues = (spec['hue'], spec['visor']) + tuple(spec.get('burn', ()))
        rc.set_burnt(mats, palette, False, hues=hues)

        feet = {side: (x, 0) for side, x in STAND.items()}
        dx = dz = 0

        def lids(k):
            for e in rig['eyes']:
                e.scale = (1, 1, k)

        if state == 'idle':
            dz = (0, 0, -1, -1, -1, 0)[i]
            head.location.z += px((0, 0, 0, -1, -1, 0)[i])      # the head settles a frame late
            if i == 4:
                lids(0.15)

        elif state == 'move':
            n = STATES['move'][0]
            feet = {'near': parts.walk_foot(i / n, 3, 3), 'far': parts.walk_foot(i / n + 0.5, 3, 3)}
            feet = {side: (x + STAND[side] // 2, z) for side, (x, z) in feet.items()}
            dz = (-1, 0, 0)[i % 3]
            head.location.z += px((0, -1, 0)[i % 3])

        elif state == 'charge':
            dz = (-1, -2)[i]
            tube.location.x += px((-2, -3)[i])
            head.location.x += px((0, -1)[i])
            lids(0.5)

        elif state == 'fire':
            tube.location.x += px((-3, -3, -2, -1, 0)[i])
            dx = (-2, -2, -1, 0, 0)[i]
            head.location.x += px((-1, -1, -1, 0, 0)[i])
            lids((0.4, 0.4, 0.7, 1, 1)[i])
            rc.pose_fire(rig['flash'], (1.0, 0.55, 0, 0, 0)[i])

        elif state == 'hurt':
            dx = (-2, 1, 0)[i]
            head.location.x += px((-2, -1, 0)[i])
            head.location.z += px((1, 0, 0)[i])
            lids((0.3, 0.3, 0.7)[i])

        elif state == 'death':
            # Flash, fireball, the big head is blown off backwards and rolls to rest in
            # front of the boots; the torso sags between them and burns from the neck.
            t = i - 2
            if i == 0:
                dz = 1
                rc.pose_fire(rig['boom'], 0.42)
            elif i == 1:
                rc.pose_fire(rig['boom'], 1.0)
            else:
                rc.set_burnt(mats, palette, True, hues=hues)
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
            fz += parts.plant_z(leg['y'], rig['legs']['near']['y']) + BOOT_SINK   # soles on the ground row; the far one sinks for the tilt
            leg['boot'].location = (px(fx), px(leg['y']), px(fz))
            parts.aim(leg['leg'], (dx + (1 if side == 'near' else -1), HIP_Z + dz + 1), (fx, fz + 5), leg['y'])
        if spec.get('extras_pose'):
            spec['extras_pose'](rig, mats, state, i)

    return build, pose
