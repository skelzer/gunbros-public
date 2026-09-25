"""
Heavy tank mobile (roster id `armor`): procedural model, poses and layered renders.

    blender --background --python build_mobile_tank.py -- --out work/tank --scale 4

Builds everything from an empty scene, saves `tank.blend` next to the renders for
inspection, then renders every animation frame twice: a `body` layer (treads, hull,
turret) and a `barrel` layer (mantlet, gun, muzzle flash). The client rotates the
barrel layer to the aim angle, so the barrel is always modelled horizontal.

All sizes below are sprite pixels at 1x (see render_common.px). A chibi heavy tank:
a welded hull with a steep wedge nose and spare track links on the glacis, bolted
armour skirts over the top of the tracks (only the lower halves of four road wheels
show), and a round dome turret with a big glass visor and two cartoon eyes that blink
and squint, a cupola and an aerial flying a pennant. The gun comes out of a drum
mantlet (a disc from the side, so it looks the same at every aim) and carries a fume
extractor and a box muzzle brake. Armour is convex hulls of lofted rings, flat
shaded with chamfered edges, so the toon ramp falls into plates.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import parts  # noqa: E402
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

# --------------------------------------------------------------------------
# Contract with the simulation (packages/shared, armor sprite): the pivot sits
# 5 px ahead of and 29 px above the anchor, the muzzle 20 px along the barrel.
# The shell spawns there, so the art has to agree with it.
# --------------------------------------------------------------------------
PIVOT_DX = 5
PIVOT_UP = 29
BARREL_LENGTH = 20

HALF_WIDTH = 13          # near edge of the near tread, in y
TREAD_W = 5
TREAD_R = 6.5            # radius of the tread's end arcs
TREAD_A = 15.5           # x of the arc centres
CLEATS = 16
WHEELS = 4

# Part groups for the id pass, by object name prefix, first match wins. Where two groups
# meet, the line between them is drawn on the one with the lower number. Glow groups are
# matched by number across layers: the barrel's flash shares the body's fire number.
PART_GROUPS = (
    ('tread', 1), ('cleat', 1), ('wheel', 2), ('hub', 2), ('hole', 2),
    ('hull', 3), ('exhaust', 5), ('lamp', 6), ('link', 7),
    ('skirtb', 9), ('skirt', 8), ('stripe', 10),
    ('turret', 11), ('visor', 13), ('eye_', 18), ('pupil', 24), ('cupola', 14), ('hatch', 15), ('mast', 16), ('flag', 17),
    ('wreck', 4), ('smoke', 19), ('boom', 25), ('fire', 26),
    ('mantlet', 20), ('tube', 21), ('bore', 21), ('sleeve', 22), ('brake', 23), ('flash', 26),
)


STATES = {
    # name: (frames, ticks per frame at 60 ticks a second, loops)
    'idle': (4, 9, True),
    'move': (6, 5, True),
    'charge': (2, 7, True),
    'fire': (5, 5, False),
    'hurt': (3, 5, False),
    'death': (7, 6, False),
}


# --------------------------------------------------------------------------
# Geometry helpers (sprite pixels)
# --------------------------------------------------------------------------

def hull_mesh(name, pts, material, bevel=0.8):
    """The convex hull of `pts` (x, y, z in pixels) as a flat shaded armour block with
    chamfered edges: cast turrets, welded hulls and skirt plates."""
    bm = bmesh.new()
    verts = [bm.verts.new(tuple(px(c) for c in p)) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=verts)
    junk = [v for v in res['geom_interior'] + res['geom_unused'] if isinstance(v, bmesh.types.BMVert)]
    if junk:
        bmesh.ops.delete(bm, geom=junk, context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = px(bevel)
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(25)
    return rc.finish(obj, material, smooth=False)


def rings(spec):
    """Loft rings for hull_mesh: (z, x_back, x_front, half_width) -> corner points."""
    out = []
    for z, x0, x1, hw in spec:
        out += [(x0, -hw, z), (x1, -hw, z), (x0, hw, z), (x1, hw, z)]
    return out


def prism(profile, y0, y1):
    """A side profile (x, z) extruded across y0..y1."""
    return [(x, y, z) for x, z in profile for y in (y0, y1)]


def clip_x(profile, xa, xb):
    """Clip a convex (x, z) polygon to the slab xa <= x <= xb."""
    def cut(poly, keep, xc):
        out = []
        for k, p in enumerate(poly):
            q = poly[(k + 1) % len(poly)]
            if keep(p):
                out.append(p)
            if keep(p) != keep(q):
                t = (xc - p[0]) / (q[0] - p[0])
                out.append((xc, p[1] + t * (q[1] - p[1])))
        return out
    poly = cut(profile, lambda p: p[0] >= xa, xa)
    return cut(poly, lambda p: p[0] <= xb, xb)


def band_of(name, source_rings, grow, box_size, box_at, material):
    """A band of a lofted block, a hair proud of it: the block grown by `grow`,
    intersected with a box."""
    obj = hull_mesh(name, rings([(z, x0 - grow, x1 + grow, hw + grow) for z, x0, x1, hw in source_rings]),
                    material, bevel=1.1)
    box = rc.add_box(f'cut_{name}', tuple(px(v) for v in box_size), tuple(px(v) for v in box_at), material)
    mod = obj.modifiers.new('Band', 'BOOLEAN')
    mod.operation = 'INTERSECT'
    mod.object = box
    box.hide_render = box.hide_viewport = True
    rc.parent_keep(box, obj)
    return obj


def stack(name, x, y, z0, z1, r, material):
    """A vertical exhaust stack with a flared cap. Returns (stack, cap)."""
    s = rc.add_cylinder(name, px(r), px(z1 - z0), (px(x), px(y), px((z0 + z1) / 2)), material, axis='Z', vertices=10)
    cap = rc.add_cylinder(name + '_cap', px(r + 0.6), px(1.2), (px(x), px(y), px(z1)), material, axis='Z', vertices=10)
    rc.parent_keep(cap, s)
    return s, cap


def pennant(name, at, length, height, material):
    """A swallow-tailed pennant flying back from `at`, a thin solidified plate."""
    x, y, z = at
    pts = [(0, 0), (-length, -height * 0.2), (-length * 0.7, -height * 0.5), (-length, -height * 0.8), (0, -height)]
    bm = bmesh.new()
    vs = [bm.verts.new((px(x + a), px(y), px(z + b))) for a, b in pts]
    bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    mod = obj.modifiers.new('Thick', 'SOLIDIFY')
    mod.thickness = px(0.6)
    return rc.finish(obj, material)


# --------------------------------------------------------------------------
# Geometry
# --------------------------------------------------------------------------

def build_tank(mats, proj):
    """Returns the rig: named objects the poses drive, and the two render layers."""
    pivot_z = proj.z_for_height(PIVOT_UP) * rc.PX_PER_UNIT

    body, barrel = [], []
    rig = {'proj': proj}

    root = rc.add_empty('root', (0, 0, 0))
    chassis = rc.add_empty('chassis', (0, 0, 0))      # hull + turret, bobs on the treads
    rc.parent_keep(chassis, root)

    # --- treads: five road wheels, the top run hidden under armour skirts ----
    rig['tracks'] = parts.build_tracks(mats, root, body, TREAD_A, TREAD_R, HALF_WIDTH,
                                       width=TREAD_W, cleats=CLEATS, wheels=WHEELS, hub='paint')
    # The two bolt holes per wheel only read as noise once the skirts cut the wheels in
    # half; drop them.
    for o in [o for o in body if o.name.startswith('hole')]:
        body.remove(o)
        bpy.data.objects.remove(o)

    # --- hull: a welded box with a steep wedge nose and a sloped tail ---------
    hull_profile = [(-20, 11), (-22.5, 14.5), (-17.5, 20), (7, 20), (23.5, 15), (22, 11)]
    hull = hull_mesh('hull', prism(hull_profile, -9, 9), mats['paint'], bevel=1.0)
    rig['hull'] = hull
    # Spare track links bolted to the glacis, a headlight under a hood at its foot.
    links = []
    for k in range(3):
        x = 10.5 + k * 3.9
        z = 20 - (x - 7) * 5 / 16.5 + 0.5
        ln = rc.add_box(f'link_{k}', (px(3.0), px(12), px(1.4)), (px(x), px(-1), px(z)), mats['rubber'], bevel=px(0.3))
        ln.rotation_euler = (0, math.radians(17), 0)
        links.append(ln)
    lamp = rc.add_cylinder('lamp', px(1.7), px(1.6), (px(20.3), px(-8.8), px(15.6)), mats['lamp'], vertices=12)
    hood = rc.add_box('exhaust_hood', (px(3.8), px(2.6), px(1.0)), (px(20.0), px(-9.0), px(17.6)), mats['steel'])
    # Twin exhaust stacks up the sloped back plate.
    stacks = [stack(f'exhaust_{k}', x, y, 13, top, 1.4, mats['steel'])
              for k, (x, y, top) in enumerate(((-22.3, -5, 22), (-21.8, 3, 21)))]
    for o in links + [lamp, hood] + [s for s, _ in stacks]:
        rc.parent_keep(o, hull)
    rc.parent_keep(hull, chassis)
    body.extend([hull, lamp, hood] + links + [o for pair in stacks for o in pair])

    # --- armour skirts: four panels over the top of the near track ----------
    # A gently arched top edge and sloped ends, so the four plates are not one slab.
    top = [(x, 15.6 + 1.8 * math.sin(math.pi * (x + 21) / 37)) for x in (-21, -15, -9, -3, 3, 9, 16)]
    skirt_profile = [(-21.5, 10.8), (-23, 13.5)] + top + [(22.5, 12.6), (21.5, 10.8)]
    cuts = (-23, -11.5, 0, 11.5, 22.5)
    for k in range(4):
        prof = clip_x(skirt_profile, cuts[k], cuts[k + 1])
        name = ('skirtb' if k % 2 else 'skirt') + f'_{k}'
        # Leaned in at the top so the plates catch the light a step above the hull side.
        pts = [(x, y + (z - 10.8) * 0.28, z) for x, y, z in prism(prof, -HALF_WIDTH - 1.4, -HALF_WIDTH - 0.2)]
        s = hull_mesh(name, pts, mats['paint'], bevel=0.45)
        rc.parent_keep(s, hull)
        body.append(s)

    # --- turret: a big round dome with a glass visor and two cartoon eyes -------
    turret_grp = rc.add_empty('turret_grp', (px(-6), 0, px(20)))
    rc.parent_keep(turret_grp, chassis)
    dc, dr = (-5, 0, 20.5), (14, 9.8, 14)             # dome centre and radii
    turret = rc.add_sphere('turret', px(1), tuple(px(v) for v in dc), mats['paint'], scale=dr, segments=32, rings=16)
    under = rc.add_box('cut_under', (px(40), px(40), px(20)), (px(dc[0]), 0, px(19.5 - 10)), mats['paint'])
    rc.boolean_cut(turret, under)
    rc.parent_keep(under, turret)

    def dome_band(name, grow, size, at, material):
        o = rc.add_sphere(name, px(1), tuple(px(v) for v in dc), material,
                          scale=tuple(r + grow for r in dr), segments=32, rings=16)
        box = rc.add_box(f'cut_{name}', tuple(px(v) for v in size), tuple(px(v) for v in at), material)
        mod = o.modifiers.new('Band', 'BOOLEAN')
        mod.operation = 'INTERSECT'
        mod.object = box
        box.hide_render = box.hide_viewport = True
        rc.parent_keep(box, o)
        return o

    visor = dome_band('visor', 0.5, (19, 12, 7.4), (-5.5, -7, 29.0), mats['glass'])

    def surface_y(x, z):
        k = 1 - ((x - dc[0]) / dr[0]) ** 2 - ((z - dc[2]) / dr[2]) ** 2
        return -dr[1] * math.sqrt(max(k, 0.0))

    # The eyes: white discs facing the camera with dark pupils looking forward. Each
    # sits on its own hinge so it can blink and squint with a z scale.
    eyes, eye_parts = [], []
    for k, x in enumerate((-10.4, -3.6)):
        z = 29.0
        y = surface_y(x, z) - 1.0
        hinge = rc.add_empty(f'eye_hinge_{k}', (px(x), px(y), px(z)))
        white = rc.add_cylinder(f'eye_{k}', px(3.1), px(1.0), (px(x), px(y), px(z)), mats['eye'], axis='Y', vertices=20, smooth=False)
        pupil = rc.add_cylinder(f'pupil_{k}', px(1.8), px(0.6), (px(x + 1.0), px(y - 0.7), px(z - 0.3)), mats['ink'], axis='Y', vertices=12, smooth=False)
        for o in (white, pupil):
            rc.parent_keep(o, hinge)
        rc.parent_keep(hinge, turret_grp)
        eyes.append(hinge)
        eye_parts += [white, pupil]
    rig['eyes'] = eyes

    cupola = rc.add_cylinder('cupola', px(3.6), px(3.0), (px(-12), px(1), px(33.4)), mats['steel'], axis='Z', vertices=16)
    hatch = rc.add_sphere('hatch', px(3.0), (px(-12), px(1), px(34.9)), mats['accent'], scale=(1, 1, 0.5), segments=16, rings=8)
    mast = rc.add_cylinder('mast', px(0.6), px(16), (px(-16.5), px(3), px(34)), mats['steel'], axis='Z', vertices=6)
    rc.set_origin(mast, (px(-16.5), px(3), px(27)))
    flag = pennant('flag', (-16.5, 3, 41.5), 7, 3.6, mats['accent'])
    rc.parent_keep(flag, mast)
    rig['mast'] = mast
    for o in (turret, visor, cupola, hatch, mast):
        rc.parent_keep(o, turret_grp)
    body.extend([turret, visor, cupola, hatch, mast, flag] + eye_parts)
    rig['turret_grp'] = turret_grp

    # --- barrel layer ---------------------------------------------------
    # The mantlet is a drum across the turret face: a disc from the side at every aim.
    pivot_w = Vector((px(PIVOT_DX), 0, px(pivot_z)))
    pivot = rc.add_empty('barrel_pivot', pivot_w)
    rc.parent_keep(pivot, turret_grp)
    mantlet = rc.add_cylinder('mantlet', px(4.3), px(11), pivot_w + Vector((0, px(-1), 0)), mats['steel'], axis='Y', vertices=24)
    mb = mantlet.modifiers.new('Bevel', 'BEVEL')
    mb.width = px(1.2)
    mb.segments = 2
    mb.limit_method = 'ANGLE'
    tube_grp = rc.add_empty('tube_grp', pivot_w)
    L = BARREL_LENGTH

    def along(x):
        return pivot_w + Vector((px(x), px(-1), 0))

    tube = rc.add_cylinder('tube', px(2.2), px(L - 4), along((L - 4) / 2 + 3), mats['steel'], axis='X', vertices=16)
    sleeve = rc.add_cylinder('sleeve', px(3.1), px(5.0), along(10.5), mats['paint'], axis='X', vertices=16)
    brake = rc.add_box('brake', (px(4.6), px(6.0), px(6.6)), along(L - 2.3), mats['steel'], bevel=px(0.9))
    bore = rc.add_cylinder('bore', px(1.4), px(0.6), along(L + 0.1), mats['rubber'], axis='X', vertices=12, smooth=False)
    for o in (tube, sleeve, brake, bore):
        rc.parent_keep(o, tube_grp)
    rc.parent_keep(tube_grp, pivot)
    rc.parent_keep(mantlet, pivot)
    barrel.extend((mantlet, tube, sleeve, brake, bore))
    rig['pivot'] = pivot
    rig['tube_grp'] = tube_grp

    # Muzzle flash: unlit blobs, on the barrel layer so they rotate with the aim.
    muzzle_w = pivot_w + Vector((px(BARREL_LENGTH), 0, 0))
    flash_outer = rc.add_sphere('flash_outer', px(1), muzzle_w + Vector((px(5), 0, 0)), mats['flame'], scale=(7, 5, 5), segments=12, rings=6)
    flash_core = rc.add_sphere('flash_core', px(1), muzzle_w + Vector((px(4), px(-3), 0)), mats['flash'], scale=(4.6, 3, 3), segments=12, rings=6)
    for o in (flash_outer, flash_core):
        rc.parent_keep(o, pivot)
        o.visible_shadow = False
        barrel.append(o)
    rig['flash'] = (flash_outer, flash_core)

    # --- death props (body layer) ----------------------------------------
    smoke = [rc.add_sphere(f'smoke_{i}', px(1), (0, px(-12), 0), mats['smoke'], scale=(5, 3, 4.4), segments=12, rings=6)
             for i in range(2)]
    wreck_barrel = rc.add_cylinder('wreck_barrel', px(2.2), px(BARREL_LENGTH), (0, 0, 0), mats['steel'], axis='X', vertices=16)
    wreck_brake = rc.add_box('wreck_brake', (px(4.6), px(6.0), px(6.6)), (px(BARREL_LENGTH / 2 - 1.5), 0, 0), mats['steel'], bevel=px(0.7))
    rc.parent_keep(wreck_brake, wreck_barrel)
    bits = [rc.add_box(f'wreck_bit_{k}', (px(3.4), px(3), px(2.6)), (0, px(-12), 0), mats[m], bevel=px(0.5))
            for k, m in enumerate(('paint', 'steel', 'paint'))]
    for o in [wreck_barrel] + smoke + bits:
        rc.parent_keep(o, root)
    body.extend([wreck_barrel, wreck_brake] + smoke + bits)
    rig['boom'] = rc.add_fire('boom', mats, (px(-6), px(-15), px(27)), 15, root, tall=1)
    rig['fire_a'] = rc.add_fire('fire_a', mats, (px(-4), px(-16), px(20)), 6.5, root)
    rig['fire_b'] = rc.add_fire('fire_b', mats, (px(10), px(-16), px(17)), 4.2, root)
    body.extend(rig['boom'] + rig['fire_a'] + rig['fire_b'])
    for o in smoke:
        o.visible_shadow = False
    rig['smoke'] = smoke
    rig['bits'] = bits
    rig['lamp'] = lamp
    rig['wreck'] = [wreck_barrel, wreck_brake]
    rig['wreck_barrel'] = wreck_barrel
    rig['chassis'] = chassis
    rig['layers'] = {'body': body, 'barrel': barrel}
    bpy.context.view_layer.update()
    rig['rest'] = {o.name: o.location.copy() for o in (chassis, turret_grp, tube_grp)}
    return rig


# --------------------------------------------------------------------------
# Poses. Everything that carries the barrel moves in whole pixels and never rotates,
# so the barrel layer stays crisp and registered; only the hull and loose parts rock.
# --------------------------------------------------------------------------

def pose(rig, mats, palette, state, i):
    chassis, hull, turret = rig['chassis'], rig['hull'], rig['turret_grp']
    tube, mast = rig['tube_grp'], rig['mast']
    rest = rig['rest']

    # Rest pose. Deltas below are added to it, in pixels.
    for o in (chassis, turret, tube):
        o.location = rest[o.name].copy()
    hull.rotation_euler = (0, 0, 0)
    turret.rotation_euler = (0, 0, 0)
    mast.rotation_euler = (0, 0, 0)
    parts.pose_tracks(rig['tracks'], 0)
    rc.hide(rig['flash'], True)
    for fire in (rig['boom'], rig['fire_a'], rig['fire_b']):
        rc.pose_fire(fire, 0)
    rc.hide(rig['bits'], True)
    rc.hide([rig['lamp']], False)
    rc.hide(rig['smoke'], True)
    rc.hide(rig['wreck'], True)
    rc.hide(rig['layers']['barrel'], False)
    rc.hide(rig['flash'], True)
    rc.set_burnt(mats, palette, False, hues=('paint',))

    def eyes(k):
        """Eye opening: 1 open, about 0.5 a squint, 0.15 shut."""
        for e in rig['eyes']:
            e.scale = (1, 1, k)

    eyes(1)

    if state == 'idle':
        chassis.location.z += px((0, -1, -1, 0)[i])
        if i == 2:
            eyes(0.15)                                   # a blink
        mast.rotation_euler.y = math.radians((0, 8, 0, -8)[i])

    elif state == 'move':
        n = STATES['move'][0]
        parts.pose_tracks(rig['tracks'], i / n)
        chassis.location.z += px((0, -1, -1, 0, -1, -1)[i])
        turret.location.z -= px((0, -1, -1, 0, -1, -1)[i])
        turret.location.z += px((0, 0, -1, 0, 0, -1)[i])   # the turret lags the hull by a frame
        mast.rotation_euler.y = math.radians((-10, -5, 5, 10, 5, -5)[i])

    elif state == 'charge':
        # Held while the player charges: the gun hauls back, the hull squats, the mast shakes.
        tube.location.x += px((-3, -2)[i])
        chassis.location.z += px(-1)
        turret.location.x += px((0, -1)[i])
        mast.rotation_euler.y = math.radians((-14, 10)[i])
        eyes(0.5)

    elif state == 'fire':
        tube.location.x += px((-6, -5, -3, -1, 0)[i])
        chassis.location.x += px((-2, -2, -1, 0, 0)[i])
        turret.location.x += px((-1, 0, 0, 0, 0)[i])
        chassis.location.z += px((0, -1, 0, 0, 0)[i])
        mast.rotation_euler.y = math.radians((-16, -10, 6, 3, 0)[i])
        if i < 2:
            eyes(0.5)
            rc.hide(rig['flash'], False)
            k = (1.0, 0.55)[i]
            rig['flash'][0].scale = (k, k, k)
            rig['flash'][1].scale = (k, k, k)

    elif state == 'hurt':
        chassis.location.x += px((-2, 1, 0)[i])
        chassis.location.z += px((1, 0, 0)[i])
        turret.location.x += px((-1, 1, 0)[i])
        mast.rotation_euler.y = math.radians((-18, 12, -4)[i])
        eyes((0.3, 0.3, 0.7)[i])

    elif state == 'death':
        # Flash, fireball, then the turret is thrown back off its ring and the hull
        # burns: green stays green, fire carries the colour, the outline changes.
        t = i - 2
        if i == 0:
            chassis.location.z += px(1)
            rc.pose_fire(rig['boom'], 0.42)
        elif i == 1:
            rc.pose_fire(rig['boom'], 1.0)
        else:
            rc.set_burnt(mats, palette, True, hues=('paint',))
            eyes(0.15)
            rc.hide([rig['lamp']], True)
            rc.hide(rig['layers']['barrel'], True)
            rc.hide(rig['wreck'], False)
            lift = (10, 14, 8, 2, 2)[t]
            back = (-2, -4, -6, -7, -7)[t]
            roll = (-18, -38, -34, -28, -28)[t]
            turret.location = rest[turret.name] + Vector((px(back), 0, px(lift)))
            turret.rotation_euler.y = math.radians(roll)
            mast.rotation_euler.y = math.radians((20, 40, 45, 45, 45)[t])   # bent over, stays on the canvas
            chassis.location.z += px((-1, -2, -2, -3, -3)[t])
            # The gun drops onto the glacis.
            rig['wreck_barrel'].location = (px((13, 15, 16, 16, 16)[t]), px(-2), px((27, 23, 21, 20, 20)[t]))
            rig['wreck_barrel'].rotation_euler = (0, math.radians((8, 18, 22, 24, 24)[t]), 0)
            rc.pose_fire(rig['boom'], (0.78, 0.4, 0, 0, 0)[t])
            rc.pose_fire(rig['fire_a'], (0.6, 1.0, 1.1, 0.9, 1.0)[t], lean_deg=(0, -8, 7, -6, 5)[t])
            rc.pose_fire(rig['fire_b'], (0, 0.6, 0.95, 1.0, 0.8)[t], lean_deg=(0, 6, -8, 7, -5)[t])
            rc.hide(rig['bits'], False)
            for bit, (x0, vx, vz) in zip(rig['bits'], ((-8, -5, 8), (4, 6, 9), (0, 2.5, 12))):
                tt = t + 1
                bit.location.x = px(x0 + vx * min(tt, 4))
                bit.location.z = px(max(1.3, 24 + vz * tt - 2.4 * tt * tt))
                bit.rotation_euler = (0, math.radians(50 * tt if bit.location.z > px(1.4) else 0), 0)
            rc.hide(rig['smoke'], t < 1)
            for s, (sx, sz, k) in zip(rig['smoke'], ((-7, 38, 1.0), (-11, 45, 0.7))):
                rise = (0, 0, 3, 6, 8)[t]
                grow = k * (0, 0.7, 1.0, 1.0, 0.9)[t]
                s.location = (px(sx - rise * 0.5), px(-12), px(sz + rise * 0.6))
                s.scale = (grow, grow, grow)


if __name__ == '__main__':
    rc.run_mobile(
        name='tank', canvas=(80, 64), anchor=(40, 61), near_y=px(-HALF_WIDTH),
        barrel_length=BARREL_LENGTH, states=STATES, part_groups=PART_GROUPS,
        materials=('paint', 'steel', 'rubber', 'accent', 'glass', 'char', 'smoke', 'lamp', 'flame', 'flash', 'eye', 'ink'),
        build=build_tank, pose=pose)
