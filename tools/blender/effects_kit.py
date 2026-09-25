"""
The effects kit: blasts, smoke, hit pops, the death blast, beams, the teleport and the
vortex, as flipbooks rendered through the same toon and pixel pipeline as the mobiles,
the UI kit, the projectiles and the maps.

    blender --background --factory-startup --python build_effects.py -- --out work/effects

This module is the toolbox the modules in `effects/` import. Each module registers its
effects with `@effect(...)`; `build_effects.py` renders every frame and `pack_effects.py`
reduces and packs them into one atlas the client plays by age.

Space: sprite pixels at 1x with the origin at the effect's anchor (the point the client
puts on the event's x, y): x right, y *up*, depth `d` towards the camera. The camera
looks square at the picture plane, like the projectiles' and the maps', and the key
light is the mobiles' (top left, in front), so a fireball is lit like the tank it hits.

An effect is a function of time, not a keyframed scene: `build(i, t, rng)` gets the
frame index, `t` = i / (frames - 1) in [0, 1] and a `random.Random` seeded from the key
*afresh for every frame*, so the same puffs, shards and drops come out of it every frame
and only what the build does with `t` moves them. Draw from the rng in the same order on
every frame (never inside a branch on `t`), or frame 5 gets different puffs from frame 4.

Materials, the three looks an effect is made of:

- `heat(ramp, level, top=None)`: unlit, shaded by how squarely a surface faces the
  camera plus a little of the key light, through a constant ramp: every lobe of a
  metaball fireball gets its own hot heart and a dark rim, the Metal Slug fireball.
  `level` in [0, 1] slides the thresholds (1 white hot, 0 all rim), which is how a
  fireball cools without a new ramp; `top` adds a hotter flat above the ramp. Put heat parts in a glow group (>= GLOW): no outline, their
  dark rim is the edge.
- `toon(name)`: the mobiles' lit toon ramp, for things with a surface (smoke, dust,
  rock, ice, water). Outlined, in the effect's own `outline` colour.
- `flat(name)`: one unlit colour: flashes, sparkles, beam cores. Glow groups.

Ramps are EFFECT_RAMPS below (four colours, shadow to highlight, as palette.json's) or
any palette.json ramp or flat; `effect(materials=...)` lists every one an effect uses and
that list is its whole palette in post-processing.

Rules found while making them (README "Effects" has the long version):

- Shapes are metaballs (`blob`), converted to a mesh every frame so the id pass and
  the toon shader treat them like any other part. Each call is its own family, so two
  blobs never merge unless they are one call.
- Anything thinner than 1.5 px at 1x is lost in the majority vote: sparks, arcs and
  droplets are at least 2 px across.
- A puff that shrinks as it fades reads as pixel art; alpha fading does not exist here.
- Keep the whole effect, every frame, 1 px inside the canvas for the outline; the packer
  warns when a frame touches the edge.
"""
import math
import random
import zlib

import bmesh
import bpy
from mathutils import Vector

import projectile_kit as pk
import render_common as rc
from render_common import px

GLOW = 20
LIGHT_DIR = rc.LIGHT_DIR

EFFECTS = []
MATS = {}
PALETTE = {}

# The colours effects add beside palette.json, shadow to highlight. Built from the
# ramps the code-drawn effects used (clientConstants.effects.blastColors), so a sprite
# blast and the fallback agree on what colour a damage type is.
EFFECT_RAMPS = {
    # Explosive: the fireball, hottest step a pale cream.
    'blast': ['#8c2f1c', '#e2542b', '#ffa832', '#ffe27a'],
    # Fire: redder shadow, the same yellow.
    'flame': ['#7a2414', '#d83a1c', '#ff8a2b', '#ffe27a'],
    # Smoke, cool grey with a blue shadow (it sits on every sky).
    'soot': ['#4a4f5c', '#767d89', '#a3aab3', '#d4d8de'],
    # Dust and thrown ground (impact).
    'dust': ['#6b5238', '#a08058', '#cdb088', '#efdcb4'],
    'rock': ['#2a2118', '#5c4526', '#8a6a3c', '#b08a52'],
    # Energy: plasma, cyan to white.
    'plasma': ['#1f4a7a', '#3f8fd8', '#7fd8ff', '#d8f2ff'],
    # Ice and frost.
    'frost': ['#2a6f96', '#5fb8d8', '#a8e8f7', '#e2fbff'],
    # Water.
    'water': ['#20527f', '#4a8ec4', '#8fc9ef', '#dff2ff'],
    # Teleport and the vortex.
    'warp': ['#3a2470', '#6a45c0', '#a07af0', '#d8c4ff'],
}
EFFECT_FLATS = {
    'hot': '#fff6d8',
    'bright': '#ffffff',
    'yolk': '#ffe27a',
    'ember': '#ff8a2b',
    'spark': '#fff3c4',
    'cyanlite': '#9ad7ff',
    'lilac': '#c08cff',
}


def effect(key, size, anchor, frames, ticks, materials, outline='#171a2b', loop=False, tile=False):
    """
    Register an effect. `size` (w, h) and `anchor` (x, y from the top left) in px at 1x:
    the anchor is drawn on the event's position. `ticks` is ticks per frame at 60 Hz, one
    number or one per frame. `outline` is the colour of the 1 px outline round the lit
    (non-glow) parts. `loop` marks a flipbook that repeats; `tile` one that is tiled
    vertically (a beam segment), so it may run off its top and bottom edges.
    The decorated function is `build(i, t, rng)` and returns the objects of frame i.
    """
    if isinstance(ticks, (int, float)):
        ticks = [int(ticks)] * frames
    assert len(ticks) == frames, f'{key}: {len(ticks)} tick entries for {frames} frames'

    def register(fn):
        EFFECTS.append({
            'key': key, 'size': tuple(size), 'anchor': tuple(anchor), 'frames': frames,
            'ticks': list(ticks), 'materials': tuple(materials), 'outline': outline,
            'loop': loop, 'tile': tile, 'build': fn, 'module': fn.__module__,
        })
        return fn
    return register


def rng_for(key):
    return random.Random(zlib.crc32(key.encode('utf-8')))


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------

def ramp_hex(name):
    if name in EFFECT_RAMPS:
        return EFFECT_RAMPS[name]
    return PALETTE['ramps'][name]


def flat_hex(name):
    if name in EFFECT_FLATS:
        return EFFECT_FLATS[name]
    return PALETTE['flats'][name]


def palette_entry(name):
    """('ramp', [...]) or ('flat', hex) for the packer."""
    if name in EFFECT_RAMPS or name in PALETTE.get('ramps', {}):
        return 'ramp', ramp_hex(name)
    return 'flat', flat_hex(name)


def toon(name):
    key = f'toon:{name}'
    if key not in MATS:
        MATS[key] = rc.toon_material(key, ramp_hex(name))
        MATS[key]['palette'] = name
    return MATS[key]


def flat(name):
    key = f'flat:{name}'
    if key not in MATS:
        MATS[key] = rc.flat_material(key, flat_hex(name))
        MATS[key]['palette'] = name
    return MATS[key]


# Where each colour of a heat ramp starts, at heat 0.5; `heat` slides them all.
HEAT_STEPS = (0.0, 0.30, 0.52, 0.72, 0.88)


def heat(ramp, level, top=None, facing=0.8, light=0.35):
    """
    A glowing material: `ramp` (dark to light) plus an optional hotter `top` flat, chosen
    by facing * `facing` + key light * `light`, the thresholds pushed down as `level`
    rises (more of the surface in the hot steps). One material per (ramp, top, level),
    so every frame can cool at its own rate.
    """
    level = round(max(0.0, min(1.0, level)), 3)
    key = f'heat:{ramp}:{top}:{level}:{facing}:{light}'
    if key in MATS:
        return MATS[key]
    colours = list(ramp_hex(ramp)) + ([flat_hex(top)] if top else [])
    shift = (level - 0.5) * 0.6
    mat = bpy.data.materials.new(key)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    face = nt.nodes.new('ShaderNodeVectorMath')
    face.operation = 'DOT_PRODUCT'
    nt.links.new(geo.outputs['Normal'], face.inputs[0])
    nt.links.new(geo.outputs['Incoming'], face.inputs[1])
    lit = nt.nodes.new('ShaderNodeVectorMath')
    lit.operation = 'DOT_PRODUCT'
    nt.links.new(geo.outputs['Normal'], lit.inputs[0])
    lit.inputs[1].default_value = tuple(LIGHT_DIR)
    # fac = face * facing + (lit * 0.5 + 0.5) * light + shift
    m1 = nt.nodes.new('ShaderNodeMath')
    m1.operation = 'MULTIPLY'
    nt.links.new(face.outputs['Value'], m1.inputs[0])
    m1.inputs[1].default_value = facing
    m2 = nt.nodes.new('ShaderNodeMath')
    m2.operation = 'MULTIPLY_ADD'
    nt.links.new(lit.outputs['Value'], m2.inputs[0])
    m2.inputs[1].default_value = 0.5 * light
    m2.inputs[2].default_value = 0.5 * light + shift
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(m1.outputs['Value'], add.inputs[0])
    nt.links.new(m2.outputs['Value'], add.inputs[1])
    ramp_node = nt.nodes.new('ShaderNodeValToRGB')
    ramp_node.color_ramp.interpolation = 'CONSTANT'
    els = ramp_node.color_ramp.elements
    while len(els) > 1:
        els.remove(els[-1])
    steps = HEAT_STEPS if len(colours) == 5 else (0.0, 0.34, 0.6, 0.82)
    for i, hx in enumerate(colours):
        el = els[0] if i == 0 else els.new(steps[i])
        el.position = steps[i]
        el.color = rc.hex_to_linear(hx)
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(add.outputs['Value'], ramp_node.inputs['Fac'])
    nt.links.new(ramp_node.outputs['Color'], emit.inputs['Color'])
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    MATS[key] = mat
    return mat


def used_palette(objs):
    """Palette names the objects' materials draw from (for the declared-materials check)."""
    names = set()
    for o in objs:
        m = o.data.materials[0]
        if m.name.startswith('heat:'):
            _, ramp, top, *_ = m.name.split(':')
            names.add(ramp)
            if top != 'None':
                names.add(top)
        else:
            names.add(m['palette'])
    return names


# --------------------------------------------------------------------------
# Space and shapes
# --------------------------------------------------------------------------

W = pk.W
tag = pk.tag
turn = pk.turn
tube = pk.tube
lathe = pk.lathe
prism = pk.prism


def lerp(a, b, t):
    return a + (b - a) * t


def clamp01(t):
    return max(0.0, min(1.0, t))


def span(t, a, b):
    """0 before a, 1 after b, linear between: a phase of the timeline."""
    if b <= a:
        return 1.0 if t >= b else 0.0
    return clamp01((t - a) / (b - a))


def ease_out(t, p=2.0):
    return 1.0 - (1.0 - clamp01(t)) ** p


def ease_in(t, p=2.0):
    return clamp01(t) ** p


# A lone metaball of radius R shows a surface of radius about BALL_K * R at the default
# threshold and stiffness; `blob` takes the radius you want to see.
BALL_K = 0.62
MB_THRESHOLD = 0.6


def _link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def blob(name, balls, material, group, smooth=True):
    """
    One metaball surface from `balls`, (x, y, d, r) with r the radius a lone ball would
    show, converted to a smooth mesh. Balls closer than their radii merge into one soft
    mass, which is what makes a fireball boil instead of stacking discs. Balls with
    r < 0.4 are skipped. Returns None when nothing is left.
    """
    balls = [b for b in balls if b[3] >= 0.4]
    if not balls:
        return None
    mb = bpy.data.metaballs.new(name)
    mb.resolution = px(0.18)
    mb.render_resolution = px(0.18)
    mb.threshold = MB_THRESHOLD
    for x, y, d, r in balls:
        el = mb.elements.new(type='BALL')
        el.co = W(x, y, d)
        el.radius = px(r / BALL_K)
        el.stiffness = 2.0
    holder = _link(bpy.data.objects.new(name, mb))
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(holder.evaluated_get(dg))
    bpy.data.objects.remove(holder, do_unlink=True)
    bpy.data.metaballs.remove(mb)
    if len(me.polygons) == 0:
        bpy.data.meshes.remove(me)
        return None
    obj = _link(bpy.data.objects.new(name, me))
    rc.finish(obj, material, smooth=smooth)
    obj.visible_shadow = False
    return tag(obj, group)


def ball(name, x, y, r, material, group, d=0.0, squash=(1.0, 1.0, 1.0), segments=20, rings=10):
    """A plain sphere (a droplet, a bead, a sparkle core), `squash` scales x, y, depth."""
    o = rc.add_sphere(name, px(r), W(x, y, d), material, scale=(squash[0], squash[2], squash[1]),
                      segments=segments, rings=rings)
    o.visible_shadow = False
    return tag(o, group)


def shard(name, base, tip, r, material, group, sides=4, d=0.0, roll=30.0, waist=0.35):
    """
    A faceted crystal from `base` to `tip` (x, y), `r` px thick at its waist, flat shaded
    so the toon ramp falls into facets. Ice bursts, rock splinters, star spikes.
    """
    (bx, by), (tx, ty) = base, tip
    length = math.hypot(tx - bx, ty - by)
    if length < 0.5:
        return None
    o = lathe(name, [(0, r * 0.35), (length * waist, r), (length, 0)], material, seg=sides,
              group=group, smooth=False)
    pk.roll(o, roll)
    o.location = o.location + W(bx, by, d)
    turn(o, math.degrees(math.atan2(ty - by, tx - bx)), bx, by)
    o.visible_shadow = False
    return o


def chunk(name, x, y, r, material, group, rng_seed, d=0.0, spin=0.0):
    """A faceted rock: an icosphere knocked about by a fixed seed, turned by `spin`."""
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=px(r), location=W(x, y, d))
    o = bpy.context.active_object
    o.name = name
    rr = random.Random(rng_seed)
    for v in o.data.vertices:
        v.co *= 0.75 + rr.random() * 0.5
    o.rotation_euler = (rr.random() * 6.28, spin, rr.random() * 6.28)
    rc.finish(o, material, smooth=False)
    o.visible_shadow = False
    return tag(o, group)


def ring(name, x, y, R, r, material, group, d=0.0, tilt=0.0, squash=1.0):
    """A torus facing the camera, tipped back `tilt` degrees, `squash` flattens it in y."""
    if R <= 0.3 or r <= 0.2:
        return None
    o = pk.torus(name, (x, y), R, r, material, d=d, tilt=tilt, group=group)
    o.scale = (1.0, 1.0, squash)
    o.visible_shadow = False
    return o


def disc(name, x, y, r, material, group, d=0.0, verts=24):
    """A flat disc facing the camera: a flash, a sparkle's heart."""
    if r <= 0.3:
        return None
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, radius=px(r), segments=verts)
    for v in bm.verts:
        v.co = Vector((v.co.x, 0.0, v.co.y))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = _link(bpy.data.objects.new(name, me))
    o.location = W(x, y, d)
    rc.finish(o, material)
    o.visible_shadow = False
    return tag(o, group)


def star(name, x, y, points, r_out, r_in, material, group, d=0.0, deg=90.0):
    """A flat star facing the camera (`points` spikes, first one at `deg`)."""
    if r_out <= 0.5:
        return None
    pts = []
    for k in range(points * 2):
        a = math.radians(deg) + math.pi * k / points
        rr = r_out if k % 2 == 0 else r_in
        pts.append((x + math.cos(a) * rr, y + math.sin(a) * rr))
    o = prism(name, pts, 1.0, material, front=d + 0.5, bevel=0.0, group=group)
    o.visible_shadow = False
    return o


def bolt(name, pts, r, material, group):
    """A jagged arc through (x, y) or (x, y, d) points, `r` px thick, flat shaded."""
    pts = [p if len(p) == 3 else (p[0], p[1], 0.0) for p in pts]
    o = tube(name, pts, r, material, group=group, smooth=False, resolution=1)
    o.visible_shadow = False
    return o


def zigzag(rng, a, b, segments, jitter):
    """Points from a to b with every inner point knocked sideways by up to `jitter` px."""
    (ax, ay), (bx, by) = a, b
    dx, dy = bx - ax, by - ay
    length = math.hypot(dx, dy) or 1.0
    nx, ny = -dy / length, dx / length
    out = []
    for k in range(segments + 1):
        f = k / segments
        j = 0.0 if k in (0, segments) else (rng.random() * 2 - 1) * jitter
        out.append((ax + dx * f + nx * j, ay + dy * f + ny * j))
    return out
