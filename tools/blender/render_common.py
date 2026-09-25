"""
Shared look for every pre-rendered mobile: camera, light, toon shader, render settings.

Anything that decides how a sprite *looks* lives here, so a second mobile only has to
build geometry and pose it. Units: 1 Blender unit is PX_PER_UNIT sprite pixels at 1x.
The mobile faces +X, the camera looks along +Y and is tilted down so top surfaces read.

Run inside Blender (4.2 or newer, including 5.x): this module is imported by the
build scripts, it is not an entry point.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------
# Frame geometry (sprite pixels at 1x)
# --------------------------------------------------------------------------

PX_PER_UNIT = 10.0
CANVAS_W = 64
CANVAS_H = 56
# Where the mobile touches the ground, in canvas pixels. Bottom rows stay free for the
# outline that post-processing adds.
ANCHOR = (32, 53)
CAMERA_TILT_DEG = 15.0
# Direction *towards* the key light: top, left, in front of the mobile.
LIGHT_DIR = Vector((-0.42, -0.50, 0.76)).normalized()



def configure(canvas, anchor):
    """Per mobile frame size and ground contact point. Call before anything else."""
    global CANVAS_W, CANVAS_H, ANCHOR
    CANVAS_W, CANVAS_H = canvas
    ANCHOR = tuple(anchor)


HERE = os.path.dirname(os.path.abspath(__file__))
PALETTE_FILE = os.path.join(HERE, 'palette.json')


def px(value):
    """Sprite pixels to Blender units."""
    return value / PX_PER_UNIT


# --------------------------------------------------------------------------
# Palette and toon materials
# --------------------------------------------------------------------------

def load_palette():
    with open(PALETTE_FILE, 'r', encoding='utf-8') as fh:
        return json.load(fh)


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_to_linear(hex_colour):
    h = hex_colour.lstrip('#')
    rgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    return [_srgb_to_linear(c) for c in rgb] + [1.0]


# Light value at which each step of a ramp starts. Four hard steps: shadow, mid,
# light, highlight. Flat faces: top lands in light, the camera side in mid, faces
# turned from the light in shadow. Only curved surfaces reach the highlight.
RAMP_STEPS = (0.0, 0.10, 0.62, 0.93)


def toon_material(name, ramp_hex, steps=RAMP_STEPS):
    """Diffuse -> Shader to RGB -> constant colour ramp. No gradients, ever."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    diffuse = nt.nodes.new('ShaderNodeBsdfDiffuse')
    diffuse.inputs['Color'].default_value = (1, 1, 1, 1)
    to_rgb = nt.nodes.new('ShaderNodeShaderToRGB')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    elements = ramp.color_ramp.elements
    while len(elements) > 1:
        elements.remove(elements[-1])
    for i, hex_colour in enumerate(ramp_hex):
        el = elements[0] if i == 0 else elements.new(steps[i])
        el.position = steps[i]
        el.color = hex_to_linear(hex_colour)
    nt.links.new(diffuse.outputs['BSDF'], to_rgb.inputs['Shader'])
    nt.links.new(to_rgb.outputs['Color'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], out.inputs['Surface'])
    return mat


def flat_material(name, hex_colour):
    """One unlit colour: flames, flashes, lamps."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    emit = nt.nodes.new('ShaderNodeEmission')
    emit.inputs['Color'].default_value = hex_to_linear(hex_colour)
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    return mat


def set_ramp(mat, ramp_hex):
    """Swap a toon material's colours in place (damage states, charring)."""
    for node in mat.node_tree.nodes:
        if node.type == 'VALTORGB':
            for el, hex_colour in zip(node.color_ramp.elements, ramp_hex):
                el.color = hex_to_linear(hex_colour)


def build_materials(palette, names):
    """
    The named ramps and flats from palette.json as materials. Only what the mobile
    declares is built, so reaching for an undeclared colour fails loudly here instead
    of being snapped to something else in post-processing.
    """
    mats = {}
    for name in names:
        if name in palette['ramps']:
            mats[name] = toon_material(name, palette['ramps'][name])
        elif name in palette['flats']:
            mats[name] = flat_material(name, palette['flats'][name])
        else:
            raise KeyError(f'{name} is not in palette.json')
    return mats


# --------------------------------------------------------------------------
# Scene
# --------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def _camera_axes():
    t = math.radians(CAMERA_TILT_DEG)
    forward = Vector((0.0, math.cos(t), -math.sin(t)))
    up = Vector((0.0, math.sin(t), math.cos(t)))
    right = Vector((1.0, 0.0, 0.0))
    return forward, up, right


def ground_point(near_y):
    """The world point drawn at ANCHOR: ground level under the near edge of the mobile."""
    return Vector((0.0, near_y, 0.0))


class Projection:
    """World point to 1x canvas pixel, matching the camera exactly."""

    def __init__(self, near_y):
        self.origin = ground_point(near_y)
        _, self.up, self.right = _camera_axes()

    def to_px(self, world):
        d = Vector(world) - self.origin
        x = ANCHOR[0] + d.dot(self.right) * PX_PER_UNIT
        y = ANCHOR[1] - d.dot(self.up) * PX_PER_UNIT
        return (round(x, 2), round(y, 2))

    def z_for_height(self, height_px, world_y=0.0):
        """World z that lands `height_px` above the anchor row, at depth `world_y`."""
        dy = world_y - self.origin.y
        t = math.radians(CAMERA_TILT_DEG)
        return (height_px / PX_PER_UNIT - dy * math.sin(t)) / math.cos(t)


def setup_scene(scene, near_y, scale=4):
    """Camera, light and render settings. `scale` is the supersampling factor."""
    forward, up, right = _camera_axes()

    cam_data = bpy.data.cameras.new('SpriteCam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(CANVAS_W, CANVAS_H) / PX_PER_UNIT
    cam_data.clip_start = 0.1
    cam_data.clip_end = 200
    cam = bpy.data.objects.new('SpriteCam', cam_data)
    scene.collection.objects.link(cam)
    # Centre of the frame in world space, derived from where the anchor has to land.
    dx = (CANVAS_W / 2 - ANCHOR[0]) / PX_PER_UNIT
    dy = (ANCHOR[1] - CANVAS_H / 2) / PX_PER_UNIT
    centre = ground_point(near_y) + right * dx + up * dy
    cam.location = centre - forward * 50
    cam.rotation_euler = (math.radians(90 - CAMERA_TILT_DEG), 0, 0)
    scene.camera = cam

    sun_data = bpy.data.lights.new('Key', 'SUN')
    sun_data.energy = math.pi  # white diffuse then reads exactly N.L
    sun_data.angle = 0.0
    if hasattr(sun_data, 'use_shadow'):
        sun_data.use_shadow = True
    sun = bpy.data.objects.new('Key', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (-LIGHT_DIR).to_track_quat('-Z', 'Y').to_euler()

    world = bpy.data.worlds.new('Black')
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0, 0, 0, 1)
        bg.inputs['Strength'].default_value = 0.0
    scene.world = world

    r = scene.render
    engines = [e.identifier for e in type(r).bl_rna.properties['engine'].enum_items]
    r.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    r.resolution_x = CANVAS_W * scale
    r.resolution_y = CANVAS_H * scale
    r.resolution_percentage = 100
    r.film_transparent = True
    r.filter_size = 0.01
    r.image_settings.file_format = 'PNG'
    r.image_settings.color_mode = 'RGBA'
    r.image_settings.color_depth = '8'
    r.image_settings.compression = 15
    r.use_file_extension = True
    if hasattr(r, 'dither_intensity'):
        r.dither_intensity = 0.0

    ee = scene.eevee
    for attr, value in (
        ('taa_render_samples', 1),
        ('taa_samples', 1),
        ('use_gtao', False),
        ('use_bloom', False),
        ('use_ssr', False),
        ('use_raytracing', False),
        ('use_shadows', True),
        ('shadow_ray_count', 1),
        ('shadow_step_count', 1),
        ('use_volumetric_shadows', False),
        ('fast_gi_method', 'AMBIENT_OCCLUSION_ONLY'),
    ):
        if hasattr(ee, attr):
            try:
                setattr(ee, attr, value)
            except (TypeError, ValueError):
                pass

    vs = scene.view_settings
    vs.view_transform = 'Standard'
    vs.look = 'None'
    vs.exposure = 0.0
    vs.gamma = 1.0
    scene.display_settings.display_device = 'sRGB'
    return cam


# --------------------------------------------------------------------------
# Mesh helpers
# --------------------------------------------------------------------------

def finish(obj, material, smooth=False):
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        # Caps and other big n-gons stay flat so cylinders keep a crisp rim.
        poly.use_smooth = smooth and len(poly.vertices) <= 4
    return obj


def add_box(name, size, location, material, bevel=0.0, segments=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new('Bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    return finish(obj, material)


def add_cylinder(name, radius, depth, location, material, axis='Y', vertices=24, smooth=True):
    rot = {'X': (0, math.pi / 2, 0), 'Y': (math.pi / 2, 0, 0), 'Z': (0, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return finish(obj, material, smooth=smooth)


def add_sphere(name, radius, location, material, scale=(1, 1, 1), segments=24, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=radius, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, material, smooth=True)


def add_empty(name, location):
    obj = bpy.data.objects.new(name, None)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)
    return obj


def set_origin(obj, world_point):
    """Move an object's origin without moving its mesh."""
    offset = Vector(world_point) - obj.location
    obj.data.transform(Matrix.Translation(-offset))
    obj.location = Vector(world_point)


def parent_keep(child, parent):
    # New objects have a stale matrix_world until the depsgraph has run once.
    bpy.context.view_layer.update()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()


def boolean_cut(target, cutter):
    mod = target.modifiers.new('Cut', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    cutter.hide_render = True
    cutter.hide_viewport = True
    cutter.display_type = 'WIRE'


# --------------------------------------------------------------------------
# Death kit: fire, burnt paint. Shared so every wreck burns the same way.
# --------------------------------------------------------------------------

# (material, size factor, offset towards the camera in pixels): orange, yellow, white.
FIRE_LAYERS = (('flame', 1.0, 0.0), ('lamp', 0.64, -2.5), ('flash', 0.34, -5.0))


def add_fire(name, mats, base, size, parent, tall=1.7):
    """
    Three nested unlit blobs. `tall` > 1 is a flame tongue that grows up from `base`;
    `tall` = 1 is a fireball centred on it. Scale and lean it with pose_fire.
    Needs the `flame`, `lamp` and `flash` flats.
    """
    parts = []
    for mat, k, dy in FIRE_LAYERS:
        r = size * k
        root = Vector((base[0], base[1] + px(dy), base[2]))
        centre = root + Vector((0, 0, px(r * tall) if tall > 1 else 0))
        o = add_sphere(f'{name}_{mat}', px(1), centre, mats[mat], scale=(r, 2, r * tall), segments=16, rings=8)
        set_origin(o, root)
        parent_keep(o, parent)
        o.visible_shadow = False      # light does not cast a shadow
        parts.append(o)
    return parts


def pose_fire(parts, k, lean_deg=0.0, at=None):
    """Size `k` (0 hides it), lean in degrees, and optionally a new base (x, z) in pixels."""
    hide(parts, k <= 0)
    for o in parts:
        o.scale = (max(k, 0.01),) * 3
        o.rotation_euler = (0, math.radians(lean_deg), 0)
        if at is not None:
            o.location.x, o.location.z = px(at[0]), px(at[1])


def set_burnt(mats, palette, on, hues):
    """
    Wreck colours without new palette entries: every ramp slides one step darker and
    bottoms out in soot, so a burnt tank is still green and a burnt walker still amber.
    """
    r = palette['ramps']
    # Soot is the darkest neutral the mobile has declared, so burning adds no colours.
    soot = next(r[name][0] for name in ('char', 'rubber', 'steel', 'smoke') if name in mats)

    def put(name, ramp):
        if name in mats:
            set_ramp(mats[name], ramp if on else r[name])

    for hue in hues:
        put(hue, [soot, r[hue][0], r[hue][1], r[hue][1]])
    put('steel', [soot, r['steel'][0], r['steel'][1], r['steel'][1]])
    put('accent', [soot, r['accent'][0], r['accent'][1], r['accent'][1]])
    put('glass', [soot, r['steel'][0], r['glass'][0], r['glass'][0]])


# --------------------------------------------------------------------------
# Layered rendering
# --------------------------------------------------------------------------

ID_LEVELS = (0.0, 0.2158605, 1.0)   # linear values that land on sRGB 0, 128, 255


def id_material(group):
    """Unlit colour that encodes a part group: base-3 digits of the group, one per channel."""
    name = f'id_{group}'
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = flat_material(name, '#000000')
        digits = (group % 3, (group // 3) % 3, (group // 9) % 3)
        colour = [ID_LEVELS[d] for d in digits] + [1.0]
        mat.node_tree.nodes['Emission'].inputs['Color'].default_value = colour
    return mat


def render_layers(scene, layers, out_dir, frame_name, groups=None):
    """
    Render each layer on its own with the others hidden. `layers` maps a layer name to
    the objects in it. Same camera and canvas for all, so the layers stay registered.

    With `groups` (object -> part group, 1 to 26) every layer is rendered a second time
    into `<layer>_id` with each part in a flat code colour. Post-processing uses that
    to draw the dark lines between parts, which shading alone cannot give.
    """
    everything = [o for objs in layers.values() for o in objs]
    hidden_before = {o.name: o.hide_render for o in everything}
    for layer_name, objs in layers.items():
        visible = set(o.name for o in objs)
        for o in everything:
            o.hide_render = hidden_before[o.name] or o.name not in visible
        path = os.path.join(out_dir, layer_name, frame_name + '.png')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if groups:
            real = {o.name: o.data.materials[0] for o in objs}
            for o in objs:
                o.data.materials[0] = id_material(groups(o))
            path = os.path.join(out_dir, layer_name + '_id', frame_name + '.png')
            os.makedirs(os.path.dirname(path), exist_ok=True)
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            for o in objs:
                o.data.materials[0] = real[o.name]
    for o in everything:
        o.hide_render = hidden_before[o.name]


def write_meta(path, meta):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(meta, fh, indent=2)


# --------------------------------------------------------------------------
# Shared driver: every build_mobile_*.py ends in run_mobile(...)
# --------------------------------------------------------------------------

def hide(objs, hidden):
    """Hide or show objects and their children for rendering; cutters stay hidden."""
    for o in objs:
        o.hide_render = hidden
        for child in o.children_recursive:
            if not child.name.startswith('cut_'):
                child.hide_render = hidden


def group_lookup(part_groups):
    """(prefix, group) pairs to the function render_layers wants. First match wins."""
    def lookup(obj):
        for prefix, group in part_groups:
            if obj.name.startswith(prefix):
                return group
        raise ValueError(f'no part group for {obj.name}')
    return lookup


def run_mobile(name, canvas, anchor, near_y, barrel_length, states, part_groups, build, pose,
               materials, glow_prefixes=('flash', 'boom', 'fire')):
    """
    Build, pose and render one mobile. `build(mats, proj)` returns a rig dict with at
    least `layers` ({'body': [...], 'barrel': [...]}) and `pivot` (the barrel hinge);
    `pose(rig, mats, palette, state, i)` sets up frame `i` of `state` from scratch.
    `states` maps a name to (frames, ticks per frame at 60 a second, loops).
    `materials` names the palette.json ramps and flats this mobile uses; that list is
    its whole palette, in Blender and in post-processing.
    """
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='directory for the raw renders and meta.json')
    ap.add_argument('--scale', type=int, default=4, help='supersampling factor (1 renders at sprite size)')
    ap.add_argument('--only', default='', help='comma separated states, for quick looks')
    args = ap.parse_args(argv)
    out_dir = os.path.abspath(args.out)

    configure(canvas, anchor)
    scene = reset_scene()
    palette = load_palette()
    mats = build_materials(palette, materials)
    proj = Projection(near_y=near_y)
    rig = build(mats, proj)
    setup_scene(scene, near_y=near_y, scale=args.scale)

    os.makedirs(out_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, name + '.blend'), check_existing=False)

    meta = {
        'mobile': name,
        'scale': args.scale,
        'canvas': [CANVAS_W, CANVAS_H],
        'anchor': list(ANCHOR),
        'barrelLength': barrel_length,
        'materials': list(materials),
        # Part groups that glow (flashes, fireballs): they get no outline and no part lines.
        'glowGroups': sorted({g for prefix, g in part_groups if prefix.startswith(tuple(glow_prefixes))}),
        'states': {},
    }
    lookup = group_lookup(part_groups)
    only = [s for s in args.only.split(',') if s]
    for state, (count, ticks, loops) in states.items():
        if only and state not in only:
            continue
        frames = []
        for i in range(count):
            pose(rig, mats, palette, state, i)
            bpy.context.view_layer.update()
            render_layers(scene, rig['layers'], out_dir, f'{state}_{i}', groups=lookup)
            frames.append({
                'pivot': list(proj.to_px(rig['pivot'].matrix_world.translation)),
                'barrelVisible': not rig['layers']['barrel'][0].hide_render,
            })
        meta['states'][state] = {'frameTicks': ticks, 'loop': loops, 'frames': frames}
    write_meta(os.path.join(out_dir, 'meta.json'), meta)
    print('RENDER DONE', name, out_dir)
