"""
The projectile kit: every shell, missile, blob and blade a mobile fires, modelled and
rendered through the same toon pipeline as the mobiles and the UI kit.

    blender --background --factory-startup --python build_projectiles.py -- --out work/projectiles

This module is the toolbox the per-mobile modules in `projectiles/` import. Each module
registers its pieces with `@projectile(...)`; `build_projectiles.py` renders them and
`pack_projectiles.py` reduces and packs them into one atlas the client draws from.

Coordinates are sprite pixels at 1x with the origin at the projectile's position (the
centre of the canvas): x forward along the flight, y *up* on screen, and depth `d`
towards the camera. A piece is built pointing right (+x), whatever its mode; the
harness turns it. The camera looks square at the picture plane (no tilt: a shell is
seen from every side as it turns) and the key light stays fixed at the top left, so a
shell diving at the ground is still lit from above.

Modes, and how the client picks a frame:

- `aim`: `dirs` directions, frame k points k * 360 / dirs degrees counter-clockwise from
  right. The client takes the one nearest the velocity. Crisp pixels at every angle and
  a light that never flips, where rotating one sprite on the canvas would smear both.
  `anim` > 1 renders that many frames per direction (a flame that flickers).
- `spin`: `frames` frames turning clockwise by `spin_deg` in all; the client plays them
  by age, backwards when the shot flies left, so a boulder rolls the way it travels.
  Use `spin_deg=360 / symmetry` for a shape with rotational symmetry (a three-armed
  blade needs only 120 degrees).
- `loop`: `frames` frames the build animates itself (a wobbling blob, a blinking mine).
  Drawn as is, no turning.

Rules of thumb (the mobiles' README has the long version):

- A projectile is small. 8 to 14 px across for an ordinary shot, up to ~20 for a heavy
  one, ~28 for a special. Its *read* is one silhouette and two or three colours.
- Group numbers decide the dark part lines: parts in different groups get a line where
  they meet. Groups >= GLOW (20) glow: no outline, no part lines (flames, cores, sparks).
- Keep the silhouette 1 px inside the canvas on every side, turned or not, so the
  outline fits: an `aim` piece's longest half-length must be < size / 2 - 1.
- Canvases of `aim` and `spin` pieces must be square.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import render_common as rc
from render_common import px

GLOW = 20

# Towards the key light: top left and in front, as for the mobiles.
LIGHT_DIR = rc.LIGHT_DIR

PIECES = []
# Extra ramps a module adds beside palette.json: name -> four hex colours, dark to light.
EXTRA_RAMPS = {}
MATS = {}
PALETTE = {}


def projectile(key, size, mode='aim', dirs=16, anim=1, frames=1, spin_deg=360.0, frame_ticks=4,
               materials=()):
    """
    Register a piece under the sim's sprite key. `size` is (w, h) in px. `materials` names
    the palette.json ramps and flats (and EXTRA_RAMPS) the piece uses; they are its whole
    palette. The decorated function is `build(a)` with `a` the animation frame index
    (always 0 for a one-frame piece) and returns the list of objects.
    """
    assert mode in ('aim', 'spin', 'loop'), mode
    if mode in ('aim', 'spin'):
        assert size[0] == size[1], f'{key}: {mode} pieces need a square canvas'

    def register(fn):
        PIECES.append({
            'key': key, 'size': tuple(size), 'mode': mode,
            'dirs': dirs if mode == 'aim' else 1,
            'anim': anim if mode == 'aim' else frames,
            'spinDeg': spin_deg if mode == 'spin' else 0.0,
            'frameTicks': frame_ticks, 'materials': tuple(materials), 'build': fn,
            'module': fn.__module__,
        })
        return fn
    return register


def extra_ramp(name, colours):
    """A ramp not in palette.json, four hex colours from shadow to highlight."""
    assert len(colours) == 4, name
    EXTRA_RAMPS[name] = list(colours)


def mat(name):
    return MATS[name]


# --------------------------------------------------------------------------
# Space
# --------------------------------------------------------------------------

def W(x, y, d=0.0):
    """Piece pixel (x forward, y up, d towards the camera) to a world point."""
    return Vector((px(x), -px(d), px(y)))


def tag(obj, group):
    obj['group'] = group
    return obj


def _mesh_object(name, bm, material, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    return rc.finish(obj, material, smooth=smooth)


def turn(obj, deg, cx=0.0, cy=0.0):
    """Rotate in the picture plane about (cx, cy), counter-clockwise on screen."""
    pivot = W(cx, cy, 0)
    m = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(-deg), 4, 'Y') @ Matrix.Translation(-pivot)
    bpy.context.view_layer.update()
    obj.matrix_world = m @ obj.matrix_world
    return obj


def turn_all(objs, deg, cx=0.0, cy=0.0):
    for o in objs:
        turn(o, deg, cx, cy)
    return objs


def roll(obj, deg):
    """Rotate about the piece's own flight axis (x through the origin): shows another side."""
    bpy.context.view_layer.update()
    obj.matrix_world = Matrix.Rotation(math.radians(deg), 4, 'X') @ obj.matrix_world
    return obj


# --------------------------------------------------------------------------
# Shapes
# --------------------------------------------------------------------------

def lathe(name, profile, material, seg=24, group=1, smooth=True, cy=0.0):
    """
    A surface of revolution about the flight axis: `profile` is (x px, radius px) from
    tail to nose. A radius of 0 closes the end to a point; otherwise the ends are capped
    flat. The body of every shell, missile, bolt and drill.
    """
    bm = bmesh.new()
    loops = []
    for x, r in profile:
        if r <= 1e-6:
            loops.append([bm.verts.new(W(x, cy, 0))])
            continue
        loops.append([bm.verts.new(W(x, cy + r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg)))
                      for k in range(seg)])
    for a, b in zip(loops, loops[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(b) == 1:
            for i in range(seg):
                bm.faces.new([a[i], a[(i + 1) % seg], b[0]])
        elif len(a) == 1:
            for i in range(seg):
                bm.faces.new([a[0], b[(i + 1) % seg], b[i]])
        else:
            for i in range(seg):
                j = (i + 1) % seg
                bm.faces.new([a[i], a[j], b[j], b[i]])
    for end in (loops[0], loops[-1]):
        if len(end) > 1:
            bm.faces.new(end)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return tag(_mesh_object(name, bm, material, smooth=smooth), group)


def ball(name, centre, r, material, d=0.0, squash=(1, 1, 1), group=2, segments=24, rings=12):
    """A sphere of radius `r` px at (x, y), `squash` scales x, y and depth."""
    cx, cy = centre
    o = rc.add_sphere(name, px(r), W(cx, cy, d), material, scale=(squash[0], squash[2], squash[1]),
                      segments=segments, rings=rings)
    return tag(o, group)


def rod(name, a, b, r, material, d=0.0, group=1, vertices=16, smooth=True):
    """A cylinder from point `a` to `b` in the picture plane, radius `r` px."""
    (ax, ay), (bx, by) = a, b
    length = math.hypot(bx - ax, by - ay)
    o = rc.add_cylinder(name, px(r), px(length), W((ax + bx) / 2, (ay + by) / 2, d), material, axis='X',
                        vertices=vertices, smooth=smooth)
    turn(o, math.degrees(math.atan2(by - ay, bx - ax)), (ax + bx) / 2, (ay + by) / 2)
    return tag(o, group)


def prism(name, pts, depth, material, front=None, bevel=0.6, group=1, smooth=False):
    """
    A flat outline in the picture plane, (x, y) points, `depth` px thick and centred on
    d = 0 unless `front` gives its near face. Fins, blades, feathers, wings.
    """
    near = depth / 2 if front is None else front
    bm = bmesh.new()
    verts = [bm.verts.new(W(x, y, near)) for x, y in pts]
    face = bm.faces.new(verts)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [g for g in ext['geom'] if isinstance(g, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=Vector((0, px(depth), 0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _mesh_object(name, bm, material, smooth=smooth)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = px(bevel)
        mod.segments = 1
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(30)
    return tag(obj, group)


def torus(name, centre, R, r, material, d=0.0, tilt=0.0, group=1):
    """A ring facing the camera, tipped back `tilt` degrees about the x axis."""
    cx, cy = centre
    bpy.ops.mesh.primitive_torus_add(major_radius=px(R), minor_radius=px(r), major_segments=40,
                                     minor_segments=12, location=W(cx, cy, d),
                                     rotation=(math.radians(90 - tilt), 0, 0))
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return tag(rc.finish(o, material, smooth=True), group)


def tube(name, pts, radii, material, group=1, smooth=True, resolution=3):
    """
    A tube along (x, y, d) points with a radius per point (a number for all): tails,
    tentacles, flame tongues, horns. Bezier-free; add points for curves.
    """
    if isinstance(radii, (int, float)):
        radii = [radii] * len(pts)
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(1.0)
    cu.bevel_resolution = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, (x, y, d), r in zip(sp.points, pts, radii):
        p.co = tuple(W(x, y, d)) + (1.0,)
        p.radius = r
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = name
    return tag(rc.finish(obj, material, smooth=smooth), group)


def cone(name, base, tip, r, material, d=0.0, group=1, vertices=16):
    """A cone from a circular base at `base` to a point at `tip`, in the picture plane."""
    (bx, by), (tx, ty) = base, tip
    length = math.hypot(tx - bx, ty - by)
    o = lathe(name, [(0, r), (length, 0)], material, seg=vertices, group=group)
    o.location = W(bx, by, d)
    turn(o, math.degrees(math.atan2(ty - by, tx - bx)), bx, by)
    return o


def fins(prefix, x0, x1, r, span, material, count=4, depth=0.8, group=1, sweep=0.0):
    """
    Tail fins around the flight axis: `count` blades from x0 to x1 standing `span` px out
    from radius `r`, each rolled round the axis. Seen from the side, the top and bottom
    blades are the silhouette and the one facing the camera shows as a plate.
    """
    objs = []
    for k in range(count):
        pts = [(x0, r * 0.5), (x1, r * 0.5), (x1 - sweep, r + span * 0.35), (x0 - sweep, r + span)]
        o = prism(f'{prefix}{k}', pts, depth, material, bevel=0.3, group=group)
        roll(o, 360 * k / count + 45)
        objs.append(o)
    return objs
