"""
Helpers for the blobby creatures (turtle and frog predate it; grub, delver, frostbite
and triclops use it): blobs, faceted rock, cones, eyes, surface bands, a snapshot and
restore for poses, and the standard death effects timeline.
All sizes are sprite pixels at 1x.
"""
import math

import bpy

import render_common as rc
from render_common import px

STATES = {
    'idle': (6, 10, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 6, False),
    'hurt': (3, 5, False),
    'death': (7, 7, False),
}


def blob(name, centre, radii, material, segments=24, rings=12):
    return rc.add_sphere(name, px(1), tuple(px(c) for c in centre), material, scale=radii, segments=segments, rings=rings)


def facet(name, centre, radii, material, subdivisions=1):
    """A low-poly boulder, flat shaded, so the toon ramp falls into bevelled planes."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=px(1), location=tuple(px(c) for c in centre))
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = radii
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return rc.finish(obj, material, smooth=False)


def cone(name, r_bottom, r_top, depth, centre, material, axis='Z', vertices=12, flat=False, tilt_deg=0.0):
    rot = {'X': (0, math.pi / 2, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=px(r_bottom), radius2=px(r_top), depth=px(depth),
                                    location=tuple(px(c) for c in centre), rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    rc.finish(obj, material, smooth=not flat)
    obj.rotation_euler = (0, math.radians(tilt_deg), 0)
    return obj


def eye(tag, centre, radius, mats, white='eye', pupil='ink', pupil_r=None, look=1.0):
    """A disc facing the camera with a pupil pushed `look` pixels towards the front.
    Returns (eye, [eye, pupil]); squint by scaling the eye in z."""
    x, y, z = centre
    e = rc.add_cylinder(f'eye_{tag}', px(radius), px(0.8), (px(x), px(y), px(z)), mats[white], vertices=16, smooth=False)
    parts = [e]
    if pupil:
        p = rc.add_cylinder(f'pupil_{tag}', px(pupil_r or radius * 0.42), px(0.8), (px(x + look), px(y - 0.5), px(z - 0.2)),
                            mats[pupil], vertices=10, smooth=False)
        rc.parent_keep(p, e)
        parts.append(p)
    return e, parts


def band(name, centre, radii, grow, box_size, box_centre, material, tilt_deg=0.0):
    """A strip lying on an ellipsoid: the ellipsoid grown by `grow`, cut down to a box."""
    shell = blob(name, centre, tuple(r + grow for r in radii), material, 32, 16)
    box = rc.add_box('cut_' + name, tuple(px(s) for s in box_size), tuple(px(c) for c in box_centre), material)
    box.rotation_euler = (0, math.radians(tilt_deg), 0)
    mod = shell.modifiers.new('Band', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = True
    box.hide_viewport = True
    rc.parent_keep(box, shell)
    return shell


def lids(eyes, k):
    for e in eyes:
        e.scale = (1, 1, k)


def snapshot(objs):
    bpy.context.view_layer.update()
    return {o.name: (o.location.copy(), o.rotation_euler.copy(), o.scale.copy()) for o in objs}


def restore(rest):
    for name, (loc, rot, scale) in rest.items():
        o = bpy.data.objects[name]
        o.location, o.rotation_euler, o.scale = loc.copy(), rot.copy(), scale.copy()


def death_fx(mats, root, body, boom_at, boom_size, y=-16, fires=()):
    """Fireball, up to two flame tongues and two smoke puffs, all on the body layer."""
    fx = {'boom': rc.add_fire('boom', mats, (px(boom_at[0]), px(y), px(boom_at[1])), boom_size, root, tall=1), 'fires': [], 'y': y}
    body.extend(fx['boom'])
    for k, size in enumerate(fires):
        f = rc.add_fire(f'fire_{k}', mats, (0, px(y + 1), 0), size, root)
        fx['fires'].append(f)
        body.extend(f)
    fx['smoke'] = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(y + 1), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
                   for i in range(2)]
    for o in fx['smoke']:
        o.visible_shadow = False
        rc.parent_keep(o, root)
        body.append(o)
    return fx


def pose_death_fx(fx, i, fire_at=(), smoke_at=None):
    """Frame `i` of the standard seven frame death: flash, fireball, then (from frame 2)
    flames at `fire_at` [(x, z), ...] and smoke rising from `smoke_at` (x, z)."""
    rc.pose_fire(fx['boom'], (0.42, 1.0, 0.78, 0.4, 0, 0, 0)[i])
    t = i - 2
    grow = ((0.6, 1.0, 1.1, 0.9, 1.0), (0, 0.6, 0.95, 1.0, 0.8))
    lean = ((0, -8, 7, -6, 5), (0, 6, -8, 7, -5))
    for k, f in enumerate(fx['fires']):
        on = t >= 0 and k < len(fire_at)
        rc.pose_fire(f, grow[k][t] if on else 0, lean_deg=lean[k][t] if on else 0, at=fire_at[k] if on else None)
    show = t >= 2 and smoke_at is not None
    rc.hide(fx['smoke'], not show)
    if show:
        for s, (dx, dz, k) in zip(fx['smoke'], ((0, 0, 0.9), (-4, 7, 0.6))):
            g = k * (0, 0, 0.8, 1.0, 0.9)[t]
            s.location = (px(smoke_at[0] + dx), px(fx['y'] + 1), px(smoke_at[1] + dz + (0, 0, 0, 2, 3)[t]))
            s.scale = (g, g, g)


def reset_fx(fx):
    rc.pose_fire(fx['boom'], 0)
    for f in fx['fires']:
        rc.pose_fire(f, 0)
    rc.hide(fx['smoke'], True)
