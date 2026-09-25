"""
The map kit: painted maps (DESIGN §8.1) modelled as geometry and rendered through the
same toon and pixel pipeline as the mobiles, the UI kit and the projectiles.

    uv run tools/blender/make_maps.py hills

A map is one module in `maps/`, `maps/<id>.py`, which calls `define(...)` and then
registers a terrain builder and three to five plate builders on what it gets back. This
file is the toolbox those modules import; `build_maps.py` renders them and
`pack_maps.py` turns the renders into the committed assets.

Space. Everything is in *canvas pixels*: x to the right, y **down** (the map's own
convention, so a profile written here is a profile in the game), and depth `d` towards
the camera. The terrain canvas is the map, one canvas pixel per map pixel; a plate's
canvas is its own image (`Plate.size`), and `P.at(x, y)` converts a map point into the
plate point drawn behind it. The camera looks square at the picture plane (no tilt: a
map is a side view and its silhouette *is* its collision) and the key light is the
mobiles' one, top left and in front, so everything in the game is lit alike.

What the light does to a slab square to the camera, which is most of a map:

- a face turned to the camera lands in the ramp's **mid** step,
- a face turned up (a lip, a ledge, the top of a stratum) lands in **light**,
- a rounded edge turned towards the top left reaches **highlight**,
- a face turned down or away, and anything in a cast shadow, lands in **shadow**.

So texture is geometry: a stratum is a band a pixel or two proud of the slab (its top
edge catches the light, the id pass draws a line under it), a stone is a faceted rock
half sunk into the face, grass is a rounded tube along the lip. A ramp can also be
*mottled* (`MapSpec.ramp(..., mottle=...)`): a noise picks, per spot, between the ramp
and a second one, which breaks a big face into patches without a single new colour.

Rules of thumb (the README's "Maps" section has the long version):

- Everything that renders is terrain: it is in the mask, it stops shells and it can be
  blown away. Model props as things you would want to shoot at, not as decals.
- Thin things vanish or turn into noise. Keep a feature at least 3 px across (a sail,
  a fence rail, a root), and put its edges on whole pixels when it is that thin.
- **Walkable ground is smooth.** Mobiles probe three columns of their footprint and
  treat anything more than `maxStep` above their feet as a wall; the smallest
  `maxStep` in the roster is 4. So on any surface meant to be walked, nothing may
  stick up more than `WALK_BUMP_PX` (3 px): tufts, flowers and pebbles go on the front
  face of the lip (`grass_edge` does this), not on top of it. Anything taller that sits
  on walkable ground is an *obstacle* (a fence, a bush, a rock) and should be meant as
  one: few, chunky, and away from the spawn shelves. The playability suite walks an
  armor both ways from every spawn and fails on a surface that snags it.
- Tufts, twigs and blades must be at least 2 px wide. A 1 px spike is a collision
  hazard (a shell bursts on it) and reads as dirt on the lens.
- Groups decide the dark part lines: two objects in different groups get a line where
  they meet, drawn on the lower-numbered one in its own shadow colour. Keep the slab
  and its strata low (1 to 6), texture above them, props above that.
- Nothing may be random at render time: use `rng(seed)` so a map renders the same
  every time. The render, not the seed, is the source of truth for the mask.
- **Buried things cast no shadow.** Anything lying in the cut face (a fossil, a pebble
  in a stratum, a cart in its drift, a stratum band) would throw a dark wedge onto the
  slab behind it. `build_maps.py` runs `settle_shadows` on every terrain after the
  builder, which turns off the cast shadow of each object whose outline is surrounded by
  the terrain's body (`BODY_BACK_PX`: slabs and strata reach that far back). Nothing to
  do in a module: model the slab deep, the props in front of it, and it follows. Only
  what pokes into the air (or stands on something that does) casts. `cast_shadow(obj,
  on)` overrides one object when the rule reads wrong.
"""
import math
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import render_common as rc
from render_common import px

LIGHT_DIR = rc.LIGHT_DIR
# View the plates are laid out for (DESIGN §8.1, client viewSize.ts): the width is fixed,
# the height runs from 360 to 600 and the plate is sized for the tallest.
VIEW_W = 800
VIEW_H = 600

# Tallest bump allowed on walkable ground: one less than the smallest mobile maxStep.
WALK_BUMP_PX = 3

MAPS = {}


def rng(seed):
    """The only source of variety a module may use: seeded, so a map renders the same."""
    return random.Random(seed)


# --------------------------------------------------------------------------
# Declaring a map
# --------------------------------------------------------------------------

class Plate:
    """One backdrop layer. `build(P)` models it in the plate's own canvas pixels."""

    def __init__(self, spec, name, parallax, build, outline, drift, fill_above):
        assert 0 < parallax < 1, f'{name}: a plate sits between the sky (0) and the map (1)'
        self.spec = spec
        self.name = name
        self.parallax = parallax
        self.build = build
        self.outline = outline
        self.drift = drift
        self.fill_above = fill_above
        w, h = spec.size
        # Big enough to cover an 800 x 600 view at every camera position (DESIGN §8.1);
        # shorter views need less, never more.
        self.size = (math.ceil(VIEW_W + (w - VIEW_W) * parallax), math.ceil(VIEW_H + (h - VIEW_H) * parallax))

    # The one conversion a plate builder needs.
    def at(self, x, y):
        """
        The plate point that is drawn behind map point (x, y) when the camera is centred
        on it. Plates move slower than the map, so this is exact only there; lay a plate
        out with it and it will sit where you meant it through the likely camera range.
        """
        p = self.parallax
        return (x * p + (VIEW_W / 2) * (1 - p), y * p + (VIEW_H / 2) * (1 - p))

    def ax(self, x):
        return self.at(x, 0)[0]

    def ay(self, y):
        return self.at(0, y)[1]

    @property
    def width(self):
        return self.size[0]

    @property
    def height(self):
        return self.size[1]


class MapSpec:
    def __init__(self, map_id, size, sky, outline):
        w, h = size
        assert 1600 <= w <= 2000 and 900 <= h <= 1200, f'{map_id}: map size {size} outside 1600-2000 x 900-1200'
        self.id = map_id
        self.size = (w, h)
        self.sky = list(sky)
        self.outline = outline
        self.ramps = {}
        self.flats = {}
        self.mottles = {}
        self.terrain_build = None
        self.plates = []
        self._mats = {}

    @property
    def width(self):
        return self.size[0]

    @property
    def height(self):
        return self.size[1]

    # --- colours ----------------------------------------------------------

    def ramp(self, name, colours, mottle=None):
        """
        A toon ramp, shadow to highlight, four hex colours. `mottle=(other, scale_px,
        coverage)` breaks the ramp's faces into patches of `other` (another declared
        ramp): `scale_px` is the size of a patch, `coverage` the share of the face it
        takes (0 to 1). Both ramps count towards the colour budget; nothing else does.
        """
        assert len(colours) == 4, name
        self.ramps[name] = [c.lower() for c in colours]
        if mottle:
            self.mottles[name] = mottle
        return name

    def flat(self, name, colour):
        """One unlit colour: a lit window, a lamp."""
        self.flats[name] = colour.lower()
        return name

    # --- builders ---------------------------------------------------------

    def terrain(self, fn):
        """Decorator: `fn(k)` models the terrain; `k` is this spec."""
        self.terrain_build = fn
        return fn

    def plate(self, name, parallax, outline=None, drift=0.0, fill_above=None):
        """
        Decorator: `fn(P)` models one plate in its own canvas pixels (`P.size`). Plates
        stack in the order the TypeScript map file lists them, not this one. `outline`
        is the plate's outline colour; distant plates look best with a dark tone of
        their own rather than the near-black the terrain uses (aerial perspective).
        """
        def register(fn):
            if any(p.name == name for p in self.plates):
                raise SystemExit(f'{self.id}: plate {name} registered twice')
            self.plates.append(Plate(self, name, parallax, fn, outline, drift, fill_above))
            return fn
        return register

    # --- materials --------------------------------------------------------

    def mat(self, name):
        """The material for a declared ramp or flat, built on first use."""
        if name in self._mats:
            return self._mats[name]
        if name in self.ramps:
            m = rc.toon_material(name, self.ramps[name])
            if name in self.mottles:
                other, scale_px, coverage = self.mottles[name]
                _add_mottle(m, self.ramps[other], scale_px, coverage)
        elif name in self.flats:
            m = rc.flat_material(name, self.flats[name])
        else:
            raise SystemExit(f'{self.id}: material {name} is not declared (ramp() or flat())')
        m['map_material'] = name
        self._mats[name] = m
        return m

    def reset_materials(self):
        self._mats = {}

    def used_materials(self, objs):
        names = set()
        for o in objs:
            if o.type != 'MESH' or not o.data.materials:
                continue
            name = o.data.materials[0].get('map_material')
            if name is None:
                raise SystemExit(f'{self.id}: {o.name} has a material the kit did not make')
            names.add(name)
            if name in self.mottles:
                names.add(self.mottles[name][0])
        return sorted(names)


def define(map_id, size, sky, outline='#1a1410'):
    """
    Declare a map. `size` is the map in px (1600-2000 x 900-1200), `sky` the colours of
    its code-drawn sky gradient top to bottom (written into the generated TypeScript, so
    the game and the thumbnail share them), `outline` the terrain's 1 px outline.
    """
    if map_id in MAPS:
        raise SystemExit(f'map {map_id} defined twice')
    spec = MapSpec(map_id, size, sky, outline)
    MAPS[map_id] = spec
    return spec


def _add_mottle(mat, other_ramp, scale_px, coverage):
    """
    Choose, per point, between the material's ramp and `other_ramp` by thresholding a
    noise on the object's own coordinates. Both are constant ramps driven by the same
    light, so the result is still only palette colours and still lit top left.
    """
    nt = mat.node_tree
    ramp_a = next(n for n in nt.nodes if n.type == 'VALTORGB')
    to_rgb = next(n for n in nt.nodes if n.type == 'SHADERTORGB')
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    ramp_b = nt.nodes.new('ShaderNodeValToRGB')
    ramp_b.color_ramp.interpolation = 'CONSTANT'
    els = ramp_b.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    for i, hex_colour in enumerate(other_ramp):
        el = els[0] if i == 0 else els.new(rc.RAMP_STEPS[i])
        el.position = rc.RAMP_STEPS[i]
        el.color = rc.hex_to_linear(hex_colour)
    nt.links.new(to_rgb.outputs['Color'], ramp_b.inputs['Fac'])

    coords = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = rc.PX_PER_UNIT / max(1.0, scale_px)
    noise.inputs['Detail'].default_value = 1.0
    if 'Roughness' in noise.inputs:
        noise.inputs['Roughness'].default_value = 0.4
    nt.links.new(coords.outputs['Object'], noise.inputs['Vector'])
    step = nt.nodes.new('ShaderNodeMath')
    step.operation = 'GREATER_THAN'
    # Noise sits around 0.5 with a spread of roughly +-0.2: map coverage onto that.
    step.inputs[1].default_value = 0.5 + 0.2 * (1 - 2 * coverage)
    nt.links.new(noise.outputs['Fac'], step.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MIX'
    nt.links.new(step.outputs['Value'], mix.inputs['Factor'])
    nt.links.new(ramp_a.outputs['Color'], mix.inputs['A'])
    nt.links.new(ramp_b.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], out.inputs['Surface'])


# --------------------------------------------------------------------------
# Space
# --------------------------------------------------------------------------

def W(x, y, d=0.0):
    """Canvas pixel (x right, y down, d towards the camera) to a world point."""
    return Vector((px(x), -px(d), -px(y)))


def tag(obj, group):
    """Part group for the id pass (1 to 26)."""
    assert 1 <= group <= 26, group
    obj['group'] = group
    return obj


def _mesh_object(name, bm, material, group, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    rc.finish(obj, material, smooth=smooth)
    return tag(obj, group)


# --------------------------------------------------------------------------
# Profiles: polylines in canvas pixels, left to right
# --------------------------------------------------------------------------

def smooth(points, step=3.0):
    """
    A Catmull-Rom curve through control points `(x, y)`, sampled every `step` px of
    arc. Control points are what a module writes; the dense polyline is what the
    geometry uses. Repeat a point to put a sharp corner in.
    """
    pts = [Vector((x, y)) for x, y in points]
    if len(pts) < 3:
        return [(p.x, p.y) for p in pts]
    out = []
    ext = [pts[0] + (pts[0] - pts[1])] + pts + [pts[-1] + (pts[-1] - pts[-2])]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        n = max(1, int((p2 - p1).length / step))
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            p = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append((p.x, p.y))
    out.append((pts[-1].x, pts[-1].y))
    return out


def height_at(profile, x):
    """y of a left-to-right profile at column x (linear between samples)."""
    if x <= profile[0][0]:
        return profile[0][1]
    for (x0, y0), (x1, y1) in zip(profile, profile[1:]):
        if x0 <= x <= x1:
            return y0 if x1 == x0 else y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return profile[-1][1]


def slope_at(profile, x, span=6.0):
    """Surface slope dy/dx at column x, measured over `span` px."""
    return (height_at(profile, x + span) - height_at(profile, x - span)) / (2 * span)


def wobble(seed, amplitude, wavelength):
    """A smooth deterministic wiggle f(x) in [-amplitude, amplitude]: three sines."""
    r = rng(seed)
    waves = [(r.uniform(0, math.tau), wavelength * k, a) for k, a in ((1.0, 0.6), (0.43, 0.28), (0.19, 0.12))]
    return lambda x: amplitude * sum(a * math.sin(ph + math.tau * x / wl) for ph, wl, a in waves)


def offset(profile, dy, x0=None, x1=None):
    """The profile moved down by `dy(x)` px (a number or a function), optionally clipped."""
    f = dy if callable(dy) else (lambda _x: dy)
    return [(x, y + f(x)) for x, y in profile if (x0 is None or x >= x0) and (x1 is None or x <= x1)]


def clip(profile, x0, x1):
    """The part of a profile between two columns, with exact end points."""
    inner = [(x, y) for x, y in profile if x0 < x < x1]
    return [(x0, height_at(profile, x0))] + inner + [(x1, height_at(profile, x1))]


# --------------------------------------------------------------------------
# Slabs: 2-D polygons extruded towards the camera
# --------------------------------------------------------------------------

def prism(name, poly, d0, d1, material, group, bevel=0.0, smooth_shade=False):
    """
    A polygon (canvas px, any winding, may be concave) extruded from depth `d0` (back)
    to `d1` (front). `bevel` rounds the edges by that many px, which is what gives a
    slab a lit lip on top and a dark one underneath.
    """
    bm = bmesh.new()
    front = [bm.verts.new(W(x, y, d1)) for x, y in poly]
    back = [bm.verts.new(W(x, y, d0)) for x, y in poly]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _mesh_object(name, bm, material, group, smooth=smooth_shade)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = px(bevel)
        mod.segments = 3
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(50)
        mod.harden_normals = False
    return obj


def ground(name, profile, material, group, depth=80.0, bottom=None, d_front=0.0, bevel=0.0):
    """
    The slab under a profile: from the surface down to `bottom` (default: below the
    canvas), `depth` px thick behind `d_front`. The main body of every map.
    """
    bottom = bottom if bottom is not None else _canvas_h() + 20
    poly = list(profile) + [(profile[-1][0], bottom), (profile[0][0], bottom)]
    return prism(name, poly, d_front - depth, d_front, material, group, bevel=bevel)


def band(name, upper, lower, d0, d1, material, group, bevel=0.0):
    """The region between two left-to-right polylines, extruded: a stratum, a path."""
    poly = list(upper) + list(reversed(lower))
    return prism(name, poly, d0, d1, material, group, bevel=bevel)


def _canvas_h():
    return bpy.context.scene.get('canvas_h', 1200)


# --------------------------------------------------------------------------
# Round things
# --------------------------------------------------------------------------

def tube(name, points, radius, material, group, taper=None, resolution=4, faceted=False):
    """
    A tube through `points` = [(x, y, d), ...] with `radius` px, optionally tapering to
    `taper` times the radius at the far end. Roots, branches, rails, a grass lip.
    """
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(radius)
    cu.bevel_resolution = resolution
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, (x, y, d) in enumerate(points):
        v = W(x, y, d)
        k = 1.0 if taper is None else 1.0 + (taper - 1.0) * i / max(1, len(points) - 1)
        sp.points[i].co = (v.x, v.y, v.z, 1.0)
        sp.points[i].radius = k
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = name
    rc.finish(obj, material, smooth=not faceted)
    return tag(obj, group)


def rock(name, x, y, r, material, group, d=0.0, seed=0, squash=(1.0, 0.8, 0.9), jitter=0.22, detail=1):
    """
    A faceted rock centred at (x, y) with radius `r` px, flat shaded so the toon ramp
    falls into facets. `squash` scales (x, depth, height). Sink it into a face (d
    around 0) for a stone in the soil, stand it on the surface for a boulder.
    """
    r_ = rng(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail, radius=1.0)
    for v in bm.verts:
        k = 1.0 + r_.uniform(-jitter, jitter)
        v.co = Vector((v.co.x * k * squash[0], v.co.y * k * squash[1], v.co.z * k * squash[2]))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0),
                     matrix=Matrix.Rotation(r_.uniform(0, math.tau), 3, 'Y'))
    bmesh.ops.scale(bm, vec=(px(r), px(r), px(r)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=W(x, y, d), verts=bm.verts)
    return _mesh_object(name, bm, material, group, smooth=False)


def blob(name, x, y, rx, ry, material, group, d=0.0, rd=None, segments=24, rings=12):
    """A smooth ellipsoid: a bush, a cloud, a canopy lobe. `rd` is its depth radius."""
    rd = rx if rd is None else rd
    o = rc.add_sphere(name, 1.0, W(x, y, d), material, scale=(px(rx), px(rd), px(ry)), segments=segments, rings=rings)
    return tag(o, group)


def box(name, x0, y0, x1, y1, d0, d1, material, group, bevel=0.0):
    """An axis-aligned box between canvas corners (x0, y0) and (x1, y1), depth d0..d1."""
    poly = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return prism(name, poly, d0, d1, material, group, bevel=bevel)


def cylinder(name, x, y_top, y_bottom, r, material, group, d=0.0, vertices=16, smooth_shade=True):
    """A vertical cylinder standing from y_bottom up to y_top (a post, a tower)."""
    h = y_bottom - y_top
    o = rc.add_cylinder(name, px(r), px(h), W(x, (y_top + y_bottom) / 2, d), material, axis='Z',
                        vertices=vertices, smooth=smooth_shade)
    return tag(o, group)


def lathe(name, x, d, profile, material, group, segments=20, smooth_shade=True):
    """
    A vertical surface of revolution about the axis at (x, d): `profile` is [(radius,
    y), ...] from top to bottom in canvas px. Towers, domes, pots, a roof cone.
    """
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        ring = []
        for k in range(segments):
            a = math.tau * k / segments
            ring.append(bm.verts.new(W(x + r * math.cos(a), y, d + r * math.sin(a))))
        rings.append(ring)
    for a_ring, b_ring in zip(rings, rings[1:]):
        for k in range(segments):
            j = (k + 1) % segments
            bm.faces.new((a_ring[k], a_ring[j], b_ring[j], b_ring[k]))
    if profile[0][0] > 0:
        bm.faces.new(rings[0])
    if profile[-1][0] > 0:
        bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_object(name, bm, material, group, smooth=smooth_shade)


def blade(name, x, y, h, w, lean, material, group, d=0.0):
    """
    A grass blade or a leaf spike: a flat tapered wedge rooted at (x, y) and `h` px
    tall, leaning `lean` px sideways at the tip. At least 2 px wide at the root.
    """
    w = max(2.0, w)
    poly = [(x - w / 2, y + 1), (x + w / 2, y + 1), (x + lean + 0.5, y - h), (x + lean - 0.5, y - h)]
    return prism(name, poly, d - 2, d + 2, material, group)


# --------------------------------------------------------------------------
# Props that are terrain
# --------------------------------------------------------------------------

def tuft(name, x, y, material, group, r=None, size=1.0, d=2.0):
    """
    A clump of three to five blades 4 to 8 px tall (times `size`) rooted at (x, y).
    Taller than `WALK_BUMP_PX`: use it where nobody walks (a cliff lip, a slope too
    steep to stand on, a roof) or on the front of a face; `grass_edge` handles the
    walkable top of a profile.
    """
    r = r or rng(int(x * 7 + y))
    objs = []
    count = r.choice((3, 4, 5))
    for i in range(count):
        dx = (i - (count - 1) / 2) * 2.2 * size
        h = r.uniform(4, 8) * size
        lean = dx * r.uniform(0.6, 1.2)
        objs.append(blade(f'{name}_{i}', x + dx, y, h, 2.4 * size, lean, material, group, d=d + r.uniform(-1, 1)))
    return objs


def tree(name, x, ground_y, height, crown, mats, groups, d=6.0, seed=0, lean=0.0, lobes=7):
    """
    A chibi tree: a stubby trunk with a root flare and a crown of overlapping round
    lobes. `mats` = (bark, leaves), `groups` = (trunk group, crown group). `crown` is
    the crown radius in px. Everything in it is terrain: shells burst in the leaves.
    """
    bark, leaves = mats
    g_trunk, g_crown = groups
    r = rng(seed)
    top = ground_y - height
    trunk_r = max(4.0, crown * 0.18)
    objs = [
        tube(f'{name}_trunk', [(x, ground_y + 6, d), (x + lean * 0.4, ground_y - height * 0.5, d),
                               (x + lean, top + crown * 0.3, d)], trunk_r, bark, g_trunk, taper=0.7),
        # Root flare: two short tubes into the ground either side.
        tube(f'{name}_rootl', [(x - trunk_r * 2.4, ground_y + 3, d + 1), (x - trunk_r * 0.4, ground_y - trunk_r * 1.2, d)],
             trunk_r * 0.55, bark, g_trunk, taper=1.6),
        tube(f'{name}_rootr', [(x + trunk_r * 2.2, ground_y + 3, d + 1), (x + trunk_r * 0.4, ground_y - trunk_r * 1.0, d)],
             trunk_r * 0.5, bark, g_trunk, taper=1.6),
    ]
    cx, cy = x + lean, top
    for i in range(lobes):
        a = math.tau * i / lobes + r.uniform(-0.3, 0.3)
        dist = crown * r.uniform(0.45, 0.62)
        lx = cx + math.cos(a) * dist
        ly = cy + math.sin(a) * dist * 0.8
        lr = crown * r.uniform(0.48, 0.62)
        objs.append(blob(f'{name}_lobe{i}', lx, ly, lr, lr * 0.9, leaves, g_crown, d=d + r.uniform(-4, 4), rd=lr * 0.8))
    objs.append(blob(f'{name}_core', cx, cy, crown * 0.75, crown * 0.7, leaves, g_crown, d=d + 2, rd=crown * 0.6))
    return objs


def roof(name, x0, x1, eave_y, ridge_y, d0, d1, material, group, overhang=6.0, thickness=5.0):
    """A pitched roof seen from the gable end: a triangle with an eave overhang."""
    xm = (x0 + x1) / 2
    poly = [(x0 - overhang, eave_y + thickness), (x0 - overhang, eave_y), (xm, ridge_y), (x1 + overhang, eave_y),
            (x1 + overhang, eave_y + thickness), (xm, ridge_y + thickness * 1.6)]
    return prism(name, poly, d0, d1, material, group, bevel=1.5)


def planks(name, x0, x1, y, material, group, d0=-6.0, d1=8.0, thickness=7.0, gap=1.0, width=14.0):
    """
    A row of boards (a bridge deck, a shelf, a fence rail laid flat), each its own
    bevelled box so the gaps read. Groups alternate with `group + 1` for part lines.
    """
    objs = []
    n = max(1, int((x1 - x0) // width))
    step = (x1 - x0) / n
    for i in range(n):
        a = x0 + i * step
        objs.append(box(f'{name}_{i}', a, y, a + step - gap, y + thickness, d0, d1, material, group + (i % 2), bevel=1.2))
    return objs


def mountain(name, x, base_y, height, half_width, material, group, snow=None, snow_line=0.32, d=0.0, seed=0,
             facets=6, jitter=0.12):
    """
    A faceted peak: a low-poly cone with its apex at (x, base_y - height), flat shaded,
    so the toon light splits it into a lit left face and shadowed right faces the way a
    painted mountain is. `snow=(material, group)` caps the top `snow_line` of it with a
    jagged rim. The base goes below `base_y` by a third of the height, so a range of
    them overlapping reads as one mass.
    """
    r = rng(seed)
    apex = W(x + r.uniform(-0.08, 0.08) * half_width, base_y - height, d)
    depth = half_width * 0.55

    def cone(cone_name, rise, radius, mat, grp, rim_jag):
        bm = bmesh.new()
        top = bm.verts.new(apex)
        ring = []
        for k in range(facets):
            a = math.pi * (0.5 + k / facets * 2)
            j = 1.0 + r.uniform(-jitter, jitter)
            rx = math.cos(a) * radius * j
            rd = math.sin(a) * depth * (radius / half_width) * j
            y = base_y - height + rise + r.uniform(-rim_jag, rim_jag)
            ring.append(bm.verts.new(W(x + rx, y, d + rd)))
        for k in range(facets):
            bm.faces.new((top, ring[k], ring[(k + 1) % facets]))
        bm.faces.new(list(reversed(ring)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return _mesh_object(cone_name, bm, mat, grp, smooth=False)

    objs = [cone(name, height * 1.35, half_width * 1.35, material, group, 0)]
    if snow:
        s_mat, s_group = snow
        objs.append(cone(f'{name}_snow', height * snow_line, half_width * snow_line * 1.12, s_mat, s_group,
                         height * 0.04))
    return objs


def pine(name, x, ground_y, height, width, mats, groups, d=0.0, tiers=3):
    """A conifer: a short trunk under `tiers` stacked cones, each narrower than the last."""
    bark, needles = mats
    g_trunk, g_crown = groups
    objs = [cylinder(f'{name}_trunk', x, ground_y - height * 0.3, ground_y + 3, max(2.5, width * 0.1), bark, g_trunk,
                     d=d, vertices=8)]
    for t in range(tiers):
        k = t / max(1, tiers - 1)
        base = ground_y - height * (0.18 + 0.27 * k)
        h = height * (0.5 - 0.1 * k)
        w = width * (0.5 - 0.13 * k)
        objs.append(lathe(f'{name}_tier{t}', x, d, [(0.0, base - h), (w * 0.35, base - h * 0.55), (w, base)],
                          needles, g_crown + (t % 2), segments=9, smooth_shade=False))
    return objs


def flowers(name, x, y, colours, group, r=None, count=3, d=6.0):
    """A few 3 px blossoms on short stalks at (x, y): pure colour accents on the grass."""
    r = r or rng(int(x * 3 + y))
    objs = []
    for i in range(count):
        fx = x + r.uniform(-7, 7)
        fy = y - r.uniform(3, 7)
        objs.append(blob(f'{name}_{i}', fx, fy, 2.0, 2.0, colours[i % len(colours)], group, d=d + r.uniform(-1, 1),
                         segments=8, rings=4))
    return objs


def grass_edge(name, profile, material, groups, radius=9.0, hem=14.0, seed=0, flowers_mats=None, x_skip=()):
    """
    The grassy top of a profile, walkable by construction:

    - a rounded **lip** (a tube of `radius` px along the profile, centre just in front
      of the slab) whose top is the walking surface, lit on top, dark underneath;
    - a **skirt** hanging `hem` px down over the soil with a scalloped hem;
    - **blades** on the front of the lip, rooted at the hem and never reaching the
      silhouette, so the grass reads as grass without a single bump on the ground;
    - **nubs** on the silhouette, 2 to `WALK_BUMP_PX` px tall, for a ragged edge
      against the sky that no mobile trips on;
    - optionally **flowers** (`flowers_mats`, a list of materials) on the lip's face.

    `groups` = (lip and skirt, blades and nubs). `x_skip` is a list of (x0, x1) ranges
    (under a house, a windmill) left bare. Returns the surface the lip makes, which is
    the profile raised by `radius`: stand things on that.
    """
    g_lip, g_blade = groups
    r = rng(seed)
    front = 1.0 + radius
    tube(f'{name}_lip', [(x, y, 1.0) for x, y in profile], radius, material, g_lip, resolution=3)
    hem_line = [(x, y + hem + 6 * abs(math.sin(x * math.pi / 13))) for x, y in profile]
    band(f'{name}_skirt', offset(profile, 1), hem_line, -8, 2.5, material, g_lip)

    def skipped(x):
        return any(a <= x <= b for a, b in x_skip)

    x = profile[0][0] + 4
    end = profile[-1][0] - 4
    while x < end:
        y = height_at(profile, x)
        if not skipped(x):
            # Front blades: from the hem up to 2 px under the top of the lip.
            for b in range(r.choice((2, 3))):
                bx = x + r.uniform(-5, 5)
                by = height_at(profile, bx)
                h = r.uniform(radius * 0.8, radius + hem * 0.6)
                blade(f'{name}_blade{int(x)}_{b}', bx, by + hem * 0.7, h, 2.6, r.uniform(-4, 4), material, g_blade,
                      d=front + 1.5)
            # Silhouette nubs, never taller than a mobile can step over.
            if abs(slope_at(profile, x)) < 1.2 and r.random() < 0.55:
                top = y - radius
                blade(f'{name}_nub{int(x)}', x, top + 1.5, r.uniform(2, WALK_BUMP_PX) + 1.5, 3.0,
                      r.uniform(-1.2, 1.2), material, g_blade, d=0)
            if flowers_mats and r.random() < 0.18:
                fx = x + r.uniform(-4, 4)
                flowers(f'{name}_flower{int(x)}', fx, height_at(profile, fx) + 6, flowers_mats, g_blade,
                        r=rng(int(x) + seed), count=r.choice((1, 2, 3)), d=front + 2)
        x += r.uniform(7, 14)
    return offset(profile, -radius)


def log(name, x, y, r, d0, d1, material, group, vertices=12):
    """A cylinder lying along the depth axis, seen end on: a log, a pipe, a barrel lid."""
    o = rc.add_cylinder(name, px(r), px(d1 - d0), W(x, y, (d0 + d1) / 2), material, axis='Y', vertices=vertices,
                        smooth=True)
    return tag(o, group)


def stratum(name, profile, level, thickness, material, group, follow=0.5, datum=None, dip=0.0, seed=0,
            pinch=0.5, x0=None, x1=None, min_cover=12.0, d0=-30.0, d1=1.5, step=4.0):
    """
    A rock layer in cross-section, the way geology draws one rather than a diagram:

    - its top sits `level` px under a line that blends the surface (`follow` = 1: the
      layer drapes over the hills) with a flat datum at y = `datum`, tilted `dip` px per
      px (`follow` = 0: the layer is level and the hills are cut through it);
    - its thickness wanders by +-45 % and, with `pinch` > 0, thins to nothing in places,
      which breaks the layer into lenses (`pinch` 0 never breaks it, 1 breaks it often);
    - `x0`/`x1` make the whole layer one lens that thins out at both ends (a pocket);
    - it never comes closer than `min_cover` px to the surface: where the ground dips
      below it, the layer is pinched against the soil above, as an eroded one is.

    Returns the list of prisms (one per unbroken stretch).
    """
    w_th = wobble(seed * 7 + 1, 0.45, 150)
    w_pinch = wobble(seed * 7 + 2, 1.0, 420)
    w_top = wobble(seed * 7 + 3, 9.0, 230)
    xs_all = [x for x, _ in profile]
    lo = x0 if x0 is not None else xs_all[0]
    hi = x1 if x1 is not None else xs_all[-1]
    if datum is None:
        datum = sum(y for _, y in profile) / len(profile)
    mid = (lo + hi) / 2
    runs, run = [], []
    x = lo
    while x <= hi + 1e-6:
        s = height_at(profile, x)
        flat = datum + dip * (x - mid)
        top = follow * (s + level) + (1 - follow) * (flat + level) + w_top(x)
        top = max(top, s + min_cover)
        th = thickness * (1 + w_th(x))
        if pinch > 0:
            th *= max(0.0, min(1.0, 0.5 + (1 - pinch) * 0.9 + 0.9 * w_pinch(x)))
        if x0 is not None or x1 is not None:
            t = (x - lo) / max(1.0, hi - lo)
            th *= max(0.0, math.sin(math.pi * t)) ** 0.6
        if th >= 2.0:
            run.append((x, top, top + th))
        elif run:
            runs.append(run)
            run = []
        x += step
    if run:
        runs.append(run)
    objs = []
    for i, r in enumerate(runs):
        if len(r) < 3:
            continue
        upper = [(x, t) for x, t, _ in r]
        lower = [(x, b) for x, _, b in r]
        objs.append(band(f'{name}{i}', upper, lower, d0, d1, material, group))
    return objs


# --------------------------------------------------------------------------
# Shadows: nothing buried casts one (added in M3)
# --------------------------------------------------------------------------

# How far past its own outline an object must be covered by other terrain to count as
# buried. Anything poking out further than this into the air keeps its shadow.
BURIED_MARGIN_PX = 2.0
# Spacing of the points tested around that grown outline.
BURIED_SAMPLE_PX = 2.0
# What counts as the terrain's body: anything reaching this far behind the picture
# plane (d <= -24). Slabs are 40 to 90 deep and strata 30; props stand in front.
BODY_BACK_PX = -24.0
# A prop whose front is no more than this proud of the picture plane lies flush with
# the face (a fault seam, a grass skirt, a vein): the buried test looks through it.
FLUSH_PX = 4.0


def cast_shadow(obj, on):
    """
    Override the buried test (`settle_shadows`) for one object: `True` keeps its cast
    shadow even when it is buried, `False` drops it even when it stands in the air.
    Rarely needed; the automatic rule is the default for a reason.
    """
    obj['cast_shadow'] = bool(on)
    return obj


def _canvas_xy(v):
    return (v.x / px(1.0), -v.z / px(1.0))


def _grown_outline(points, margin, spacing):
    """Points every `spacing` px along the convex hull of `points`, pushed `margin` px out."""
    from mathutils.geometry import convex_hull_2d
    if len(points) < 3:
        return []
    hull = [Vector(points[i]) for i in convex_hull_2d(points)]
    if len(hull) < 3:
        return []
    # convex_hull_2d is counter-clockwise in its own (y up) sense; ours is y down, so
    # decide the outward side from the centroid instead of trusting the winding.
    c = sum(hull, Vector((0.0, 0.0))) / len(hull)
    out = []
    for a, b in zip(hull, hull[1:] + hull[:1]):
        e = b - a
        n = max(1, int(e.length / spacing))
        normal = Vector((e.y, -e.x)).normalized() if e.length > 1e-6 else Vector((0.0, 0.0))
        if normal.dot((a + b) / 2 - c) < 0:
            normal = -normal
        for k in range(n):
            out.append(a + e * (k / n) + normal * margin)
        # The corner itself, pushed out along the direction away from the centre.
        out.append(a + (a - c).normalized() * margin)
    return out


def settle_shadows(objs, depsgraph):
    """
    **Buried objects cast no shadow.** A map is a cross-section: a fossil, a pebble in a
    stratum, a mine cart in its drift or a stratum band lies *in* the cut face, so a
    shadow thrown from it onto the slab behind is a dark wedge no light could make.

    The *body* of the terrain is every object reaching at least `BODY_BACK_PX` behind
    the picture plane: the slabs (`ground`, a deep `prism`), the strata, the bedrock,
    the cave's roof bands. Look square on, as the camera does, at the ring just outside
    an object's outline (grown by `BURIED_MARGIN_PX`): the object is **buried** when
    every point of that ring shows the body, another buried object, or something lying
    flush on the body (front no more than `FLUSH_PX` proud: a fault seam, a skirt). A buried object
    keeps its toon form shading from its normals and loses its cast shadow
    (`visible_shadow = False`). Everything else keeps casting: whatever pokes into the
    air (a tree, a boulder on the lip, the grass lip and its blades) and whatever stands
    on a prop that does (a window on a house wall, a post on a gate).

    It is decided from the geometry after the builder runs, so every map gets it for
    free; `cast_shadow(obj, on)` overrides it for one object. Buried is the largest set
    that satisfies the rule (start from everything, drop what shows air or an unburied
    prop, repeat), so a cluster of things buried together (a skull and its teeth, a
    cart in its drift) stays buried.

    Returns the names of the objects that lost their shadow.
    """
    from mathutils.bvhtree import BVHTree
    unit = px(1.0)
    verts, tris, owner = [], [], []
    hulls, body, fronts = {}, set(), {}
    for i, o in enumerate(objs):
        ev = o.evaluated_get(depsgraph)
        me = ev.to_mesh()
        mw = ev.matrix_world
        world = [mw @ v.co for v in me.vertices]
        hulls[i] = [_canvas_xy(w) for w in world]
        fronts[i] = -min(w.y for w in world) / unit if world else 0.0
        # d = -world.y / unit; the back of the object is its smallest d.
        if world and -max(w.y for w in world) / unit <= BODY_BACK_PX:
            body.add(i)
        base = len(verts)
        verts.extend(world)
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            tris.append(tuple(base + k for k in t.vertices))
            owner.append(i)
        ev.to_mesh_clear()
    if not tris:
        return []
    tree = BVHTree.FromPolygons(verts, tris, all_triangles=True)
    front = -px(4000.0)        # world y of a point well in front of everything
    back = Vector((0.0, 1.0, 0.0))

    # What each object's ring shows (the nearest object at each point), or None when
    # some point shows air. The ring lies outside the object, so it never shows itself.
    step = px(0.01)

    def shown(p):
        """The object that decides ring point p: None for rock or air, else the prop."""
        origin = W(p.x, p.y, 0.0)
        origin.y = front
        while True:
            hit = tree.ray_cast(origin, back)
            if hit[0] is None:
                return 'air'
            k = owner[hit[2]]
            if k in body:
                return None
            if fronts[k] > FLUSH_PX:
                return k
            # A seam flush with the face (a fault, a skirt of grass, a vein): look
            # through it at what it lies on.
            origin = hit[0] + back * step

    shows = {}
    for i, o in enumerate(objs):
        if 'cast_shadow' in o:
            continue
        ring = _grown_outline(hulls[i], BURIED_MARGIN_PX, BURIED_SAMPLE_PX)
        seen = set()
        for p in ring:
            k = shown(p)
            if k == 'air':
                seen = None
                break
            if k is not None:
                seen.add(k)
        if ring and seen is not None:
            shows[i] = seen

    buried = set(shows)
    changed = True
    while changed:
        changed = False
        for i in list(buried):
            if not shows[i] <= buried:
                buried.discard(i)
                changed = True
    for i, o in enumerate(objs):
        if 'cast_shadow' in o:
            o.visible_shadow = bool(o['cast_shadow'])
        else:
            o.visible_shadow = i not in buried
    return [objs[i].name for i in sorted(buried)]


# --------------------------------------------------------------------------
# Crystals and spires (cave, added in M2)
# --------------------------------------------------------------------------

def crystal(name, x, y, length, radius, angle, material, group, d=0.0, sides=6, tip=1.4, spin=0.0):
    """
    One crystal shard: a `sides`-sided prism `length` px long from its root at (x, y),
    ending in a point `tip` radii long, flat shaded so every facet takes one step of the
    ramp. `angle` is in degrees from straight up, positive leaning right (180 hangs it
    straight down). The root sinks a radius into whatever it grows from. `spin` turns
    the prism about its own axis, which changes which facets face the light.
    """
    a = math.radians(angle)
    ax, ay = math.sin(a), -math.cos(a)          # along the shard, canvas y down
    px_, py_ = math.cos(a), math.sin(a)         # across it, in the picture plane

    def at(u, v, w):
        return W(x + u * px_ + v * ax, y + u * py_ + v * ay, d + w)

    bm = bmesh.new()
    base, top = [], []
    shoulder = max(radius, length - radius * tip)
    for k in range(sides):
        t = math.tau * k / sides + math.radians(spin)
        u, w = math.cos(t) * radius, math.sin(t) * radius
        base.append(bm.verts.new(at(u, -radius, w)))
        top.append(bm.verts.new(at(u, shoulder, w)))
    apex = bm.verts.new(at(0, length, 0))
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new((base[k], base[j], top[j], top[k]))
        bm.faces.new((top[k], top[j], apex))
    bm.faces.new(list(reversed(base)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_object(name, bm, material, group, smooth=False)


def crystal_cluster(name, x, y, size, material, group, d=0.0, angle=0.0, spread=70.0, count=5, seed=0,
                    materials=None):
    """
    A fan of `count` shards rooted around (x, y), the biggest in the middle pointing at
    `angle` (degrees from up; 180 hangs the cluster from a ceiling), the others fanned
    `spread` degrees either side and shorter. `materials` (a list) alternates ramps
    between shards, for a two-coloured cluster.
    """
    r = rng(seed)
    mats = materials or [material]
    objs = []
    order = sorted(range(count), key=lambda i: abs(i - (count - 1) / 2))
    for rank, i in enumerate(order):
        t = (i - (count - 1) / 2) / max(1.0, (count - 1) / 2)
        a = angle + t * spread / 2 + r.uniform(-8, 8)
        length = size * (1.0 - 0.45 * abs(t)) * r.uniform(0.8, 1.05)
        rad = max(2.5, size * 0.17 * (1.0 - 0.3 * abs(t)))
        off = t * size * 0.28
        ca, sa = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        objs.append(crystal(f'{name}_{i}', x + off * ca, y + off * sa, length, rad, a, mats[rank % len(mats)],
                            group, d=d + r.uniform(-3, 3) + (4 if rank == 0 else 0), spin=r.uniform(0, 60)))
    return objs


def spire(name, x, y_root, length, radius, material, group, d=0.0, hanging=True, seed=0, segments=8, rings=4,
          bulge=0.18):
    """
    A stalactite (`hanging`, rooted at y_root and pointing down) or a stalagmite
    (pointing up), or an icicle: a faceted cone with a few lumpy rings so it reads as
    dripped stone rather than a traffic cone. The root sinks 6 px into what it grows
    from.
    """
    r = rng(seed)
    sgn = 1 if hanging else -1
    prof = [(radius * 1.1, y_root - sgn * 6)]
    for k in range(1, rings + 1):
        t = k / (rings + 1)
        rad = radius * (1 - t) ** 0.8 * (1 + r.uniform(-bulge, bulge))
        prof.append((max(0.8, rad), y_root + sgn * length * t))
    prof.append((0.0, y_root + sgn * length))
    if not hanging:
        prof = list(reversed(prof))
    return lathe(name, x, d, prof, material, group, segments=segments, smooth_shade=False)


# --------------------------------------------------------------------------
# Leaning faces (temple, added in M2)
# --------------------------------------------------------------------------

def leaning_box(name, x0, x1, y0, y1, d_top, d_bottom, back, material, group, bevel=0.0):
    """
    A box between canvas columns x0..x1 and rows y0..y1 whose front face leans: its top
    edge is at depth `d_top`, its bottom edge at `d_bottom` (towards the camera when
    larger), its back flat at `back`. A front leaning back (d_bottom > d_top) faces up
    as well as out, so the toon light puts it a step lighter than an upright face: a
    talud, a battered wall, a buttress, a sloped dressed block. The silhouette is the
    plain rectangle, so it is as safe as `box` on the mask.
    """
    bm = bmesh.new()
    front = [bm.verts.new(W(x0, y0, d_top)), bm.verts.new(W(x1, y0, d_top)),
             bm.verts.new(W(x1, y1, d_bottom)), bm.verts.new(W(x0, y1, d_bottom))]
    rear = [bm.verts.new(W(x, y, back)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
    bm.faces.new(front)
    bm.faces.new(list(reversed(rear)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((front[i], front[j], rear[j], rear[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = _mesh_object(name, bm, material, group)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = px(bevel)
        mod.segments = 3
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(30)
        mod.harden_normals = False
    return obj
