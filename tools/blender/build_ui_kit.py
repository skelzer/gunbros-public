"""
The UI kit: panel frames, buttons, gauges, banners, card and slot frames, item and
status icons, modelled and rendered through the same toon pipeline as the mobiles.

    blender --background --python build_ui_kit.py -- --out work/ui --scale 4

Every piece is a tiny scene of its own: a flat-on orthographic camera (no tilt, the UI
is seen square), the palette's toon ramps, and one key light from the top left and in
front, so a bevel's top and left facets land on the light step, the face on mid and the
bottom and right facets in shadow. `pack_ui_kit.py` then reduces the renders exactly as
`postprocess.py` reduces a mobile (majority vote, palette, part lines, outline) and packs
the atlas.

Coordinates in this file are canvas pixels of the piece at 1x: x to the right, y down,
the origin in the top-left corner, and pixel *edges* on whole numbers. A piece's
silhouette stops 1 px short of the canvas so the outline fits. Depth `d` is in pixels
towards the camera. Nine-slice pieces keep everything that varies inside their corner
slices: the edges and the centre must be the same along their length, and the packer
makes them exactly so.
"""
import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_common as rc  # noqa: E402
from render_common import px  # noqa: E402

# Towards the key light: left, up and in front. Flat faces read N.L = 0.55 (mid), a
# 45 degree top or left bevel 0.7 to 0.88 (light), the top-left corner facet of a
# rounded bevel reaches the highlight, bottom and right bevels fall into shadow.
UI_LIGHT = Vector((-0.45, -0.55, 0.70)).normalized()
# Ramp thresholds for the three looks of one material: hover lifts the face to the light
# step, pressed pushes the bevels down a step. Same colours, so no palette growth.
STEPS_HI = (0.0, 0.05, 0.50, 0.84)
STEPS_LO = (0.0, 0.30, 0.80, 0.97)
# Part groups at or above this number glow: no outline, no part lines (flash, fills).
GLOW = 20

MATERIALS = ('steel', 'plate', 'well', 'blue', 'ice', 'amber', 'crimson', 'paint', 'violet',
             'white', 'bone', 'smoke', 'rubber', 'orange',
             'flash', 'eye', 'ink', 'cyan', 'lamp', 'flame', 'pink', 'rune')

CW, CH = 16, 16      # the current piece's canvas
MATS = {}
PALETTE = {}


# --------------------------------------------------------------------------
# Canvas space
# --------------------------------------------------------------------------

def W(x, y, d=0.0):
    """Canvas pixel (x right, y down) and depth towards the camera to a world point."""
    return Vector((px(x - CW / 2), -px(d), px(CH / 2 - y)))


def mat(name, look=''):
    """A palette material, or its brighter (`hi`) or darker (`lo`) look."""
    if not look:
        return MATS[name]
    key = f'{name}_{look}'
    if key not in MATS:
        steps = STEPS_HI if look == 'hi' else STEPS_LO
        if name in PALETTE['ramps']:
            MATS[key] = rc.toon_material(key, PALETTE['ramps'][name], steps)
        else:
            MATS[key] = MATS[name]
    return MATS[key]


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


def _face_camera(bm):
    """Every face of a heightfield looks at the camera (-y)."""
    bm.normal_update()
    flip = [f for f in bm.faces if f.normal.y > 1e-6]
    if flip:
        bmesh.ops.reverse_faces(bm, faces=flip)


def rounded_rect(x0, y0, x1, y1, r, seg=4):
    """Outline of a rounded rectangle, a fixed number of points whatever `r` is."""
    r = max(0.0, min(r, (x1 - x0) / 2, (y1 - y0) / 2))
    pts = []
    corners = ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180))
    for cx, cy, start in corners:
        for k in range(seg + 1):
            a = math.radians(start + 90 * k / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def plate(name, rect, radius, steps, material, base=0.0, hole=False, seg=4, group=1):
    """
    A slab seen from the front: the outer outline at depth `base`, then one ring per
    step of `steps` (inset px, rise px), ending in a flat face. A positive rise is a
    raised bevel, a negative one a recess. `hole` leaves the face out (a frame).
    """
    x0, y0, x1, y1 = rect
    bm = bmesh.new()
    loops = []
    inset, depth = 0.0, base
    rings = [(0.0, base)]
    for step_in, rise in steps:
        inset += step_in
        depth += rise
        rings.append((inset, depth))
    for inset, depth in rings:
        pts = rounded_rect(x0 + inset, y0 + inset, x1 - inset, y1 - inset, radius - inset, seg)
        loops.append([bm.verts.new(W(x, y, depth)) for x, y in pts])
    for a, b in zip(loops, loops[1:]):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            quad = [a[i], a[j], b[j], b[i]]
            if len({v.co.to_tuple(5) for v in quad}) >= 3:
                bm.faces.new(quad)
    if not hole:
        bm.faces.new(loops[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    _face_camera(bm)
    return tag(_mesh_object(name, bm, material), group)


def lathe(name, centre, profile, material, seg=48, hole=False, group=1):
    """Turned about the view axis: `profile` is (radius px, depth px) from the rim in."""
    cx, cy = centre
    bm = bmesh.new()
    loops = []
    for r, d in profile:
        if r <= 1e-6:
            loops.append([bm.verts.new(W(cx, cy, d))])
            continue
        loops.append([bm.verts.new(W(cx + r * math.cos(2 * math.pi * k / seg),
                                     cy + r * math.sin(2 * math.pi * k / seg), d)) for k in range(seg)])
    for a, b in zip(loops, loops[1:]):
        if len(b) == 1:
            for i in range(seg):
                bm.faces.new([a[i], a[(i + 1) % seg], b[0]])
            continue
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new([a[i], a[j], b[j], b[i]])
    if not hole and len(loops[-1]) > 1:
        bm.faces.new(loops[-1])
    _face_camera(bm)
    return tag(_mesh_object(name, bm, material), group)


def prism(name, pts, depth, material, front=0.0, bevel=0.8, group=1, smooth=False):
    """A 2D outline in canvas pixels pushed `depth` px towards the camera, chamfered."""
    bm = bmesh.new()
    verts = [bm.verts.new(W(x, y, front + depth)) for x, y in pts]
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


def ball(name, centre, r, material, d=None, squash=(1, 1, 1), group=2):
    """A sphere of radius `r` px at canvas `centre`, `squash` scales x, depth, y."""
    cx, cy = centre
    loc = W(cx, cy, r if d is None else d)
    o = rc.add_sphere(name, px(r), loc, material, scale=(squash[0], squash[1], squash[2]), segments=24, rings=12)
    return tag(o, group)


def rod(name, a, b, r, material, d=None, group=1, vertices=16):
    """A cylinder from canvas point `a` to `b`, radius `r` px, axis in the view plane."""
    (ax, ay), (bx, by) = a, b
    length = math.hypot(bx - ax, by - ay)
    mid = W((ax + bx) / 2, (ay + by) / 2, r if d is None else d)
    o = rc.add_cylinder(name, px(r), px(length), mid, material, axis='X', vertices=vertices)
    turn(o, (ax + bx) / 2, (ay + by) / 2, math.degrees(math.atan2(by - ay, bx - ax)))
    return tag(o, group)


def torus(name, centre, R, r, material, d=None, tilt=0.0, group=1):
    """A ring facing the camera, tipped back `tilt` degrees about the x axis."""
    cx, cy = centre
    bpy.ops.mesh.primitive_torus_add(major_radius=px(R), minor_radius=px(r), major_segments=40,
                                     minor_segments=12, location=W(cx, cy, r if d is None else d),
                                     rotation=(math.radians(90 - tilt), 0, 0))
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    return tag(rc.finish(o, material, smooth=True), group)


def curve_tube(name, pts, r, material, group=1, closed=False):
    """A round tube along canvas points (x, y, d), converted to a mesh."""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = px(r)
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(pts) - 1)
    for p, (x, y, d) in zip(sp.points, pts):
        p.co = tuple(W(x, y, d)) + (1.0,)
    sp.use_cyclic_u = closed
    obj = bpy.data.objects.new(name, cu)
    bpy.context.scene.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.active_object
    obj.name = name
    return tag(rc.finish(obj, material, smooth=True), group)


def turn(obj, cx, cy, deg):
    """Rotate in the picture plane about canvas point (cx, cy), clockwise on screen."""
    pivot = W(cx, cy, 0)
    m = Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(deg), 4, 'Y') @ Matrix.Translation(-pivot)
    bpy.context.view_layer.update()
    obj.matrix_world = m @ obj.matrix_world
    return obj


def turn_all(objs, cx, cy, deg):
    for o in objs:
        turn(o, cx, cy, deg)
    return objs


# --------------------------------------------------------------------------
# Shared shapes
# --------------------------------------------------------------------------

def rivet(name, x, y, d, material, r=1.3):
    return ball(name, (x, y), r, material, d=d, squash=(1, 0.7, 1), group=3)


def framed_window(prefix, w, h, radius, rim_mat, floor_mat, rim=4.0, lip=None, floor_look=''):
    """A raised frame with a recessed window: the body of cards and slots."""
    objs = [plate(f'{prefix}_rim', (1, 1, w - 1, h - 1), radius,
                  [(1.5, 1.5), (rim - 4.0, 0), (1.5, -2.5)], rim_mat, group=1)]
    inner = rim
    objs.append(plate(f'{prefix}_floor', (inner, inner, w - inner, h - inner), 0, [], floor_mat,
                      base=-0.9, group=2))
    if lip:
        objs.append(plate(f'{prefix}_lip', (inner, inner, w - inner, h - inner), 0, [(1, 0.6)], lip,
                          base=-0.8, hole=True, group=4))
    return objs


def gem_button(prefix, w, h, material, look='', pressed=False, disabled=False):
    """A cut-gem key: steep facets around a flat table, a glint in the top-left corner."""
    top = 2 if pressed else 1
    if disabled:
        steps = [(3, 1.2), (0.5, 0.2)]
    elif pressed:
        steps = [(2.5, 1.2), (0.5, 0.2)]
    else:
        steps = [(3, 2.6), (0.5, 0.3)]
    objs = [plate(f'{prefix}_gem', (1, top, w - 1, h - 1), 4, steps, material, seg=4, group=1)]
    if not disabled and not pressed:
        objs.append(prism(f'{prefix}_glint', [(4.5, 4.5), (7.5, 4.5), (7.5, 5.5), (5.5, 5.5), (5.5, 7.5),
                                               (4.5, 7.5)], 0.2, mat('flash'), front=3.0, bevel=0,
                          group=GLOW))
    return objs


def shell(prefix, cx, cy, length, r, angle, body='steel', nose='crimson', band='amber', fins=True):
    """A shell pointing right, turned `angle` degrees (negative is up) about its middle."""
    x0 = cx - length / 2
    x1 = cx + length / 2
    objs = [rod(f'{prefix}_body', (x0 + r * 0.6, cy), (x1 - r * 1.2, cy), r, mat(body), group=2),
            ball(f'{prefix}_nose', (x1 - r * 1.2, cy), r, mat(nose), squash=(1.7, 1, 1), group=3),
            rod(f'{prefix}_band', (x1 - r * 1.9, cy), (x1 - r * 1.3, cy), r + 0.35, mat(band), group=4)]
    if fins:
        objs.append(prism(f'{prefix}_fin', [(x0, cy - r - 1.2), (x0 + r * 1.6, cy - r * 0.4),
                                            (x0 + r * 1.6, cy + r * 0.4), (x0, cy + r + 1.2)],
                          1.2, mat(band), front=r * 0.4, bevel=0.3, group=1))
    return turn_all(objs, cx, cy, angle)


def arrow_pts(x0, x1, cy, shaft, head_len, head):
    """A right-pointing arrow outline from x0 to x1."""
    hx = x1 - head_len
    return [(x0, cy - shaft), (hx, cy - shaft), (hx, cy - head), (x1, cy), (hx, cy + head),
            (hx, cy + shaft), (x0, cy + shaft)]


def star_pts(cx, cy, r_out, r_in, n=5, rot=-90):
    pts = []
    for k in range(n * 2):
        r = r_out if k % 2 == 0 else r_in
        a = math.radians(rot + 180 * k / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def coil(prefix, cx, cy, width, height, turns, r, front, back):
    """
    An upright spring: a helix along y, each half turn its own tube so the near strands
    (lit, `front`) are outlined against the far ones (dark, `back`).
    """
    objs = []
    halves = int(turns * 2)
    for h in range(halves):
        pts = []
        for k in range(9):
            a = math.pi * (h + k / 8)
            t = (h + k / 8) / halves
            pts.append((cx + math.cos(a) * width / 2, cy + height / 2 - height * t, 3 + math.sin(a) * 2.5))
        near = h % 2 == 0
        objs.append(curve_tube(f'{prefix}_coil{h}', pts, r, front if near else back, group=2 if near else 1))
    return objs


# --------------------------------------------------------------------------
# The pieces
# --------------------------------------------------------------------------

PIECES = []


def piece(name, size, kind='icon', slices=None, frames=1, pivot=None, step_deg=None):
    """Register a builder. `kind`: nine (9-slice), hbar (tiles along x), sprite, icon, strip."""
    def wrap(fn):
        PIECES.append({'name': name, 'size': size, 'kind': kind, 'slices': slices, 'frames': frames,
                       'pivot': pivot, 'stepDeg': step_deg, 'build': fn})
        return fn
    return wrap


# ---- panels ----------------------------------------------------------------

@piece('panel', (32, 32), 'nine', slices=(9, 9, 9, 9))
def _panel(i):
    return [plate('panel_rim', (1, 1, 31, 31), 3, [(2, 2), (1, 0), (1, -1.4)], mat('steel')),
            plate('panel_face', (5, 5, 27, 27), 0, [], mat('plate'), base=0.7, group=2),
            rivet('panel_r1', 7, 7, 1.6, mat('steel', 'hi'), r=1.6), rivet('panel_r2', 25, 7, 1.6, mat('steel', 'hi'), r=1.6),
            rivet('panel_r3', 7, 25, 1.6, mat('steel', 'hi'), r=1.6), rivet('panel_r4', 25, 25, 1.6, mat('steel', 'hi'), r=1.6)]


@piece('panel-dark', (16, 16), 'nine', slices=(5, 5, 5, 5))
def _panel_dark(i):
    return [plate('dark_rim', (1, 1, 15, 15), 2, [(1, 1)], mat('plate')),
            plate('dark_face', (3, 3, 13, 13), 0, [], mat('well'), base=0.8, group=2)]


@piece('panel-bar', (32, 32), 'nine', slices=(11, 9, 8, 9))
def _panel_bar(i):
    objs = [plate('bar_rim', (1, 1, 31, 31), 3, [(2, 2), (1, 0), (1, -1.4)], mat('steel')),
            plate('bar_face', (5, 10, 27, 27), 0, [], mat('plate'), base=0.7, group=2),
            plate('bar_rail', (3, 3, 29, 8), 1, [(1, 1)], mat('steel', 'hi'), base=0.6, group=4),
            rivet('bar_r3', 7, 25, 1.6, mat('steel', 'hi'), r=1.6), rivet('bar_r4', 25, 25, 1.6, mat('steel', 'hi'), r=1.6)]
    return objs


@piece('recess', (16, 16), 'nine', slices=(5, 5, 5, 5))
def _recess(i):
    return [plate('recess_rim', (1, 1, 15, 15), 2, [(1, 0.6)], mat('plate'), hole=True),
            plate('recess_pit', (2, 2, 14, 14), 1, [(2, -2)], mat('well', 'hi'), base=0.6, group=2)]


@piece('frame-gold', (24, 24), 'nine', slices=(7, 7, 7, 7))
def _frame_gold(i):
    return [plate('gold_ring', (1, 1, 23, 23), 3, [(1.5, 1.5), (1.0, 0), (1.5, -1.5)], mat('amber'), hole=True),
            rivet('gold_r1', 3.5, 3.5, 1.5, mat('bone'), r=1.0), rivet('gold_r2', 20.5, 3.5, 1.5, mat('bone'), r=1.0),
            rivet('gold_r3', 3.5, 20.5, 1.5, mat('bone'), r=1.0), rivet('gold_r4', 20.5, 20.5, 1.5, mat('bone'), r=1.0)]


# ---- buttons: four states, two colours ------------------------------------

for _colour, _prefix in (('blue', 'button'), ('amber', 'button-gold')):
    for _state in ('normal', 'hover', 'pressed', 'disabled'):
        def _make(i, colour=_colour, state=_state, prefix=_prefix):
            if state == 'disabled':
                return gem_button(prefix, 24, 24, mat('smoke', 'lo'), disabled=True)
            look = {'normal': '', 'hover': 'hi', 'pressed': 'lo'}[state]
            return gem_button(prefix, 24, 24, mat(colour, look), pressed=state == 'pressed')
        piece(f'{_prefix}/{_state}', (24, 24), 'nine', slices=(7, 7, 7, 7))(_make)


# ---- gauges ----------------------------------------------------------------

@piece('trough', (32, 16), 'nine', slices=(4, 7, 4, 7))
def _trough(i):
    # The rim is a frame (no face), or its face would hide the channel behind it.
    return [plate('trough_rim', (1, 1, 31, 15), 3, [(1.5, 1.2), (0.5, 0)], mat('steel'), hole=True),
            plate('trough_pit', (3, 3, 29, 13), 1, [(1, -1)], mat('well'), base=1.2, group=2),
            rivet('trough_r1', 3.5, 8, 1.4, mat('steel', 'hi'), r=0.9),
            rivet('trough_r2', 28.5, 8, 1.4, mat('steel', 'hi'), r=0.9)]


@piece('trough-small', (16, 8), 'nine', slices=(2, 3, 2, 3))
def _trough_small(i):
    return [plate('tsmall_rim', (1, 1, 15, 7), 1.5, [(1, 0.8)], mat('steel')),
            plate('tsmall_pit', (2, 2, 14, 6), 0, [], mat('well'), base=0.9, group=2)]


for _name, _mat in (('amber', 'amber'), ('cyan', 'ice'), ('green', 'paint'), ('red', 'crimson'),
                    ('violet', 'violet')):
    def _fill(i, m=_mat):
        return [tag(rod('fill_tube', (-3, 4), (7, 4), 4, mat(m), vertices=32), GLOW)]
    piece(f'fill/{_name}', (4, 8), 'hbar')(_fill)

    def _fill_small(i, m=_mat):
        return [tag(rod('fills_tube', (-3, 2), (5, 2), 2, mat(m), vertices=32), GLOW)]
    piece(f'fill-small/{_name}', (2, 4), 'hbar')(_fill_small)


@piece('power-marker', (9, 12), 'sprite', pivot=(4.5, 11))
def _power_marker(i):
    return [prism('marker_pin', [(1, 1), (8, 1), (8, 5), (4.5, 10), (1, 5)], 2.5, mat('amber'), bevel=0.9),
            ball('marker_glint', (3, 3), 0.7, mat('flash'), d=3.5, group=GLOW)]


def dial(prefix, size, ticks, major):
    c = size / 2
    rim = c - 1
    face = rim - 4.5
    objs = [lathe(f'{prefix}_bezel', (c, c), [(rim, 0), (rim - 1.5, 1.8), (rim - 2.8, 1.8), (rim - 4.5, 0.2)],
                  mat('steel'), seg=64, hole=True),
            lathe(f'{prefix}_face', (c, c), [(face + 0.6, 0.3), (face - 1.2, -0.8), (0, -0.8)], mat('well'),
                  seg=64, group=2)]
    for k in range(0, 360, ticks):
        big = k % major == 0
        r0, r1 = face - (6 if big else 4), face - 1
        half = 0.75 if big else 0.6
        tick = prism(f'{prefix}_tick{k}', [(c + r0, c - half), (c + r1, c - half), (c + r1, c + half),
                                           (c + r0, c + half)], 0.4, mat('steel', 'hi' if big else ''),
                     front=-0.6, bevel=0, group=3)
        objs.append(turn(tick, c, c, -k))
    return objs


@piece('dial', (60, 60), 'sprite', pivot=(30, 30))
def _dial(i):
    return dial('dial', 60, 15, 45)


@piece('dial-small', (52, 52), 'sprite', pivot=(26, 26))
def _dial_small(i):
    return dial('dials', 52, 15, 45)


@piece('dial-hub', (8, 8), 'sprite', pivot=(4, 4))
def _dial_hub(i):
    return [ball('hub_cap', (4, 4), 2.9, mat('amber'), squash=(1, 0.6, 1), group=1)]


@piece('wind-plate', (44, 44), 'sprite', pivot=(22, 22))
def _wind_plate(i):
    return dial('wind', 44, 30, 90)


WIND_STEP = 15


@piece('wind-arrow', (32, 32), 'strip', frames=360 // WIND_STEP, pivot=(16, 16), step_deg=WIND_STEP)
def _wind_arrow(i):
    c = 16
    body = prism('arrow_body', arrow_pts(c - 12, c + 13, c, 2.5, 8, 6.5), 2.4, mat('amber'), bevel=1.0)
    tail = prism('arrow_tail', [(c - 13, c - 5), (c - 9, c - 5), (c - 6, c), (c - 9, c + 5), (c - 13, c + 5),
                                (c - 10, c)], 1.8, mat('crimson'), bevel=0.6, group=2)
    return turn_all([body, tail], c, c, i * WIND_STEP)


# ---- banner, cards, slots ---------------------------------------------------

def banner(prefix, rim, ribbon):
    w, h = 48, 24
    tails = []
    for side in (-1, 1):
        x_out = 1 if side < 0 else w - 1
        x_in = 12 if side < 0 else w - 12
        notch = 4.5 if side < 0 else w - 4.5
        pts = [(x_out, 6), (x_in, 6), (x_in, 18), (x_out, 18), (notch, 12)]
        tails.append(prism(f'{prefix}_tail{side}', pts if side < 0 else pts[::-1], 1.5, mat(ribbon),
                           bevel=0.6, group=1))
    return tails + [
        plate(f'{prefix}_plaque', (8, 1, w - 8, 22), 3, [(2, 2), (1, 0), (1, -1)], mat(rim),
              base=2.0, group=2),
        plate(f'{prefix}_face', (12, 5, w - 12, 18), 0, [], mat('plate'), base=3.2, group=3),
    ]


@piece('banner/gold', (48, 24), 'nine', slices=(7, 14, 7, 14))
def _banner_gold(i):
    return banner('bgold', 'amber', 'crimson')


@piece('banner/steel', (48, 24), 'nine', slices=(7, 14, 7, 14))
def _banner_steel(i):
    return banner('bsteel', 'steel', 'blue')


CARD_LOOKS = {
    'normal': ('steel', '', None),
    'hover': ('ice', '', None),
    'selected': ('amber', '', 'amber'),
    'locked': ('rubber', '', None),
}
for _state, (_rim, _look, _lip) in CARD_LOOKS.items():
    def _card(i, rim=_rim, look=_look, lip=_lip, state=_state):
        objs = framed_window('card', 28, 36, 3, mat(rim, look), mat('well', 'lo' if state == 'locked' else ''),
                             rim=6, lip=mat(lip) if lip else None)
        for k, (x, y) in enumerate(((3.5, 3.5), (24.5, 3.5), (3.5, 32.5), (24.5, 32.5))):
            objs.append(rivet(f'card_r{k}', x, y, 1.6, mat('bone' if state == 'selected' else 'steel', 'hi'), r=1.1))
        return objs
    piece(f'card/{_state}', (28, 36), 'nine', slices=(9, 9, 9, 9))(_card)


SLOT_LOOKS = {
    'empty': ('steel', '', None),
    'filled': ('steel', '', 'paint'),
    'used': ('rubber', '', None),
    'active': ('amber', '', 'amber'),
}
for _state, (_rim, _look, _lip) in SLOT_LOOKS.items():
    def _slot(i, rim=_rim, look=_look, lip=_lip, state=_state):
        return framed_window('slot', 24, 24, 1.5, mat(rim, look), mat('well', 'lo' if state == 'used' else ''),
                             rim=5, lip=mat(lip, 'hi') if lip else None)
    piece(f'slot/{_state}', (24, 24), 'nine', slices=(7, 7, 7, 7))(_slot)


# ---- shot and item icons (16 x 16) -------------------------------------------

@piece('shot/s1', (16, 16))
def _s1(i):
    return shell('s1', 8, 8, 11, 2.2, -35)


@piece('shot/s2', (16, 16))
def _s2(i):
    return shell('s2', 8, 8, 14, 3.2, -35, nose='amber', band='crimson')


@piece('shot/ss', (16, 16))
def _ss(i):
    return [prism('ss_star', star_pts(8, 8, 7.3, 3.4, n=8, rot=-90), 1.2, mat('amber'), bevel=0.4, group=1),
            ball('ss_core', (8, 8), 3.6, mat('violet'), d=3.5, group=2),
            ball('ss_glint', (6.8, 6.8), 0.9, mat('flash'), d=7, group=GLOW)]


@piece('item/dual', (16, 16))
def _dual(i):
    return shell('d1', 6.2, 5.8, 10, 2.0, -35) + shell('d2', 9.8, 10.8, 10, 2.0, -35)


@piece('item/dualPlus', (16, 16))
def _dual_plus(i):
    plus = [(3, 1), (5, 1), (5, 3), (7, 3), (7, 5), (5, 5), (5, 7), (3, 7), (3, 5), (1, 5), (1, 3), (3, 3)]
    return (shell('p1', 8.4, 4.8, 10, 2.0, -35) + shell('p2', 11.4, 9.4, 9, 2.0, -35, fins=False)
            + [prism('plus', [(x + 0.2, y + 8.2) for x, y in plus], 1.6, mat('paint'), front=3, bevel=0.5,
                     group=6)])


@piece('item/teleport', (16, 16))
def _teleport(i):
    return [torus('tp_ring', (8, 8), 5.2, 1.8, mat('violet'), tilt=20, group=1),
            ball('tp_core', (8, 8), 3.4, mat('cyan'), squash=(1, 0.3, 1.2), d=0.5, group=GLOW),
            ball('tp_spark', (8, 8), 1.4, mat('flash'), d=1.5, group=GLOW + 1)]


@piece('item/healSmall', (16, 16))
def _heal_small(i):
    band = plate('bandage', (2, 5.5, 14, 10.5), 2.5, [(1.2, 1.2)], mat('white'), group=1)
    pad = plate('bandage_pad', (5.5, 6.2, 10.5, 9.8), 0.5, [(0.6, 0.4)], mat('bone'), base=1.2, group=2)
    return turn_all([band, pad], 8, 8, -35)


@piece('item/healLarge', (16, 16))
def _heal_large(i):
    return [torus('kit_handle', (8, 4.2), 2.4, 0.8, mat('steel'), group=1),
            plate('kit_box', (1.5, 4.5, 14.5, 14.5), 2, [(1.2, 1.4)], mat('white'), group=2),
            prism('kit_cross', [(7, 6), (9, 6), (9, 8.5), (11.5, 8.5), (11.5, 10.5), (9, 10.5), (9, 13), (7, 13),
                                (7, 10.5), (4.5, 10.5), (4.5, 8.5), (7, 8.5)], 0.8, mat('crimson'), front=1.4,
                   bevel=0.3, group=3)]


@piece('item/bunge', (16, 16))
def _bunge(i):
    objs = coil('bunge', 8, 8.5, 10, 9, 3, 1.1, mat('steel', 'hi'), mat('steel', 'lo'))
    objs.append(plate('bunge_top', (2, 1.2, 14, 3.4), 0.8, [(0.6, 0.6)], mat('crimson'), base=3.0, group=3))
    objs.append(plate('bunge_base', (2, 13.2, 14, 15.2), 0.8, [(0.6, 0.6)], mat('crimson'), base=3.0, group=4))
    return objs


@piece('item/powerUp', (16, 16))
def _power_up(i):
    up = prism('pu_arrow', [(8, 1), (14.5, 7.5), (10.5, 7.5), (10.5, 14.5), (5.5, 14.5), (5.5, 7.5),
                            (1.5, 7.5)], 2.5, mat('amber'), bevel=0.9, group=1)
    return [up, ball('pu_glint', (6.6, 7.4), 0.8, mat('flash'), d=3.2, group=GLOW)]


@piece('item/windChange', (16, 16))
def _wind_change(i):
    objs = []
    for k, start in enumerate((200, 20)):
        pts = []
        for s in range(9):
            a = math.radians(start + 125 * s / 8)
            pts.append((8 + 5 * math.cos(a), 8 - 5 * math.sin(a), 1.5))
        objs.append(curve_tube(f'wc_arc{k}', pts, 1.1, mat('ice'), group=1 + k))
        a = math.radians(start + 125)
        tip = (8 + 5 * math.cos(a), 8 - 5 * math.sin(a))
        heading = math.degrees(math.atan2(-math.cos(a), -math.sin(a)))
        head = prism(f'wc_head{k}', [(tip[0] - 1, tip[1] - 3), (tip[0] + 2.8, tip[1]), (tip[0] - 1, tip[1] + 3)],
                     1.8, mat('ice'), front=0.6, bevel=0.4, group=3 + k)
        objs.append(turn(head, tip[0], tip[1], heading))
    return objs


# ---- status icons (12 x 12) -------------------------------------------------

@piece('status/shield', (12, 12))
def _shield(i):
    pts = [(1.5, 1.5), (10.5, 1.5), (10.5, 5.5), (9, 8.5), (6, 10.8), (3, 8.5), (1.5, 5.5)]
    return [prism('sh_body', pts, 2.2, mat('blue'), bevel=1.0, group=1),
            prism('sh_stripe', [(5.2, 2.6), (6.8, 2.6), (6.8, 9.2), (5.2, 9.2)], 0.5, mat('white'), front=2.2,
                  bevel=0.2, group=2)]


@piece('status/frozen', (12, 12))
def _frozen(i):
    objs = []
    for k, (x, y, s, rot) in enumerate(((6, 6.5, 4.8, 0), (2.8, 8, 2.8, -25), (9.4, 7.8, 2.6, 25))):
        pts = [(x, y - s), (x + s * 0.55, y), (x, y + s * 0.8), (x - s * 0.55, y)]
        objs.append(turn(prism(f'ice{k}', pts, 1.6 + s * 0.3, mat('ice'), bevel=0.7, group=1 + k,
                               front=1.0 if k == 0 else 0), x, y, rot))
    return objs


@piece('status/boost', (12, 12))
def _boost(i):
    objs = []
    for k, y in enumerate((1.5, 5.5)):
        objs.append(prism(f'boost{k}', [(6, y), (10.5, y + 4.5), (8, y + 4.5), (6, y + 2.5), (4, y + 4.5),
                                        (1.5, y + 4.5)], 2.0, mat('amber' if k == 0 else 'crimson'), bevel=0.6,
                          group=1 + k))
    return objs


@piece('status/dig', (12, 12))
def _dig(i):
    blade = prism('spade_blade', [(3, 6), (9, 6), (9, 8.5), (6, 11), (3, 8.5)], 1.6, mat('steel', 'hi'), bevel=0.6,
                  group=2)
    shaft = rod('spade_shaft', (6, 1.5), (6, 6.5), 0.9, mat('orange'), group=1)
    grip = rod('spade_grip', (4.2, 1.6), (7.8, 1.6), 0.8, mat('orange'), group=3)
    return turn_all([shaft, grip, blade], 6, 6, 30)


@piece('status/dual', (12, 12))
def _status_dual(i):
    return shell('sd1', 6, 3.3, 10, 1.6, 0, fins=False) + shell('sd2', 6, 8.5, 10, 1.6, 0, fins=False)


@piece('status/ssReady', (12, 12))
def _ss_ready(i):
    return [prism('ssr_star', star_pts(6, 6.3, 5.4, 2.4), 2.0, mat('violet', 'hi'), bevel=0.8, group=1),
            ball('ssr_glint', (4.8, 4.8), 0.7, mat('flash'), d=2.6, group=GLOW)]


@piece('status/dead', (12, 12))
def _dead(i):
    return [ball('skull_dome', (6, 5.2), 4.1, mat('bone'), squash=(1.05, 0.8, 1), group=1),
            plate('skull_jaw', (3.5, 7, 8.5, 10.5), 1, [(0.6, 0.6)], mat('bone'), base=1.5, group=2),
            ball('skull_eye1', (4.3, 5.8), 1.3, mat('ink'), d=7.3, squash=(1, 0.4, 1.1), group=GLOW),
            ball('skull_eye2', (7.7, 5.8), 1.3, mat('ink'), d=7.3, squash=(1, 0.4, 1.1), group=GLOW)]


@piece('status/offline', (12, 12))
def _offline(i):
    a = prism('off_a', [(1.5, 3), (3, 1.5), (10.5, 9), (9, 10.5)], 2.0, mat('crimson'), bevel=0.6, group=1)
    b = prism('off_b', [(9, 1.5), (10.5, 3), (3, 10.5), (1.5, 9)], 2.0, mat('crimson'), front=0.5, bevel=0.6,
              group=2)
    return [a, b]


@piece('status/delay', (12, 12))
def _delay(i):
    return [plate('hg_top', (2, 1, 10, 2.8), 0.6, [(0.5, 0.5)], mat('steel'), base=2.5, group=3),
            plate('hg_bot', (2, 9.2, 10, 11), 0.6, [(0.5, 0.5)], mat('steel'), base=2.5, group=4),
            prism('hg_glass', [(3, 2.5), (9, 2.5), (6.6, 6), (9, 9.5), (3, 9.5), (5.4, 6)], 1.8, mat('ice'),
                  bevel=0.5, group=1),
            prism('hg_sand', [(4.2, 7.8), (7.8, 7.8), (8.3, 9.4), (3.7, 9.4)], 0.5, mat('amber'), front=1.9,
                  bevel=0, group=2)]


@piece('status/heart', (12, 12))
def _heart(i):
    pts = []
    for k in range(25):
        t = 2 * math.pi * k / 24
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((6 + x * 0.31, 5.6 - y * 0.31))
    return [prism('heart', pts[:-1], 2.2, mat('crimson'), bevel=1.0, group=1),
            ball('heart_glint', (3.9, 3.8), 0.8, mat('flash'), d=2.6, group=GLOW)]


@piece('status/thor', (12, 12))
def _thor(i):
    pts = [(7.5, 0.8), (2.2, 6.8), (5.6, 6.8), (4, 11.2), (9.8, 4.8), (6.4, 4.8), (8.6, 0.8)]
    return [prism('bolt', pts, 1.8, mat('amber'), bevel=0.5, group=1)]


@piece('status/tornado', (12, 12))
def _tornado(i):
    objs = []
    for k, (y, R, x) in enumerate(((2.4, 4.2, 6.2), (4.9, 3.3, 5.6), (7.2, 2.3, 6.2), (9.4, 1.3, 6.8))):
        objs.append(torus(f'tw{k}', (x, y), R, 0.85, mat('white'), tilt=70, group=1 + k))
    return objs


@piece('status/force', (12, 12))
def _force(i):
    objs = []
    for k, y in enumerate((1.5, 5.5)):
        objs.append(prism(f'force{k}', [(1.5, y), (4, y), (6, y + 2), (8, y), (10.5, y), (6, y + 4.5)], 2.0,
                          mat('violet'), bevel=0.6, group=1 + k))
    return objs


@piece('status/mine', (12, 12))
def _mine(i):
    objs = [ball('mine_body', (6, 6.5), 3.6, mat('rubber'), group=1)]
    for k in range(8):
        a = math.radians(22.5 + 45 * k)
        objs.append(rod(f'mine_spike{k}', (6 + 3 * math.cos(a), 6.5 + 3 * math.sin(a)),
                        (6 + 5.2 * math.cos(a), 6.5 + 5.2 * math.sin(a)), 0.55, mat('steel'), vertices=8))
    objs.append(ball('mine_lamp', (5.2, 5.6), 1.3, mat('crimson', 'hi'), d=7.4, squash=(1, 0.4, 1), group=GLOW))
    return objs


# --------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------

def frame_camera(scene, cam, size, scale):
    global CW, CH
    CW, CH = size
    cam.data.ortho_scale = max(CW, CH) / rc.PX_PER_UNIT
    cam.location = Vector((0, -50, 0))
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.resolution_x = CW * scale
    scene.render.resolution_y = CH * scale


def clear_objects(keep):
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.curves):
        for data in list(block):
            if data.users == 0:
                block.remove(data)


def main():
    global PALETTE
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--only', default='', help='comma separated piece names or prefixes, for quick looks')
    args = ap.parse_args(argv)
    out_dir = os.path.abspath(args.out)

    rc.configure((32, 32), (16, 16))
    scene = rc.reset_scene()
    PALETTE = rc.load_palette()
    MATS.update(rc.build_materials(PALETTE, MATERIALS))
    cam = rc.setup_scene(scene, near_y=0.0, scale=args.scale)
    sun = scene.objects['Key']
    sun.rotation_euler = (-UI_LIGHT).to_track_quat('-Z', 'Y').to_euler()
    sun.data.use_shadow = False
    keep = {cam, sun}

    only = [s for s in args.only.split(',') if s]
    meta = {'scale': args.scale, 'glowFrom': GLOW, 'pieces': []}
    for p in PIECES:
        if only and not any(p['name'] == s or p['name'].startswith(s) for s in only):
            continue
        frame_camera(scene, cam, p['size'], args.scale)
        frames = []
        used = set()
        groups = set()
        for i in range(p['frames']):
            clear_objects(keep)
            objs = [o for o in p['build'](i) if o is not None]
            bpy.context.view_layer.update()
            for o in objs:
                used.add(o.data.materials[0].name.split('_')[0])
                groups.add(o['group'])
            frame = p['name'].replace('/', '__') + (f'_{i}' if p['frames'] > 1 else '')
            rc.render_layers(scene, {'ui': objs}, out_dir, frame, groups=lambda o: o['group'])
            frames.append(frame)
        meta['pieces'].append({
            'name': p['name'], 'kind': p['kind'], 'size': list(p['size']), 'slices': p['slices'],
            'pivot': p['pivot'], 'stepDeg': p['stepDeg'], 'frames': frames,
            'materials': sorted(used), 'glowGroups': sorted(g for g in groups if g >= GLOW),
        })
        print('piece', p['name'], len(frames), 'frame(s)', flush=True)
    # A partial run (--only) keeps the other pieces' earlier renders in the meta, so the
    # packer still sees the whole kit.
    meta_path = os.path.join(out_dir, 'meta.json')
    if only and os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as fh:
            before = {p['name']: p for p in json.load(fh)['pieces']}
        fresh = {p['name']: p for p in meta['pieces']}
        meta['pieces'] = [fresh.get(p['name']) or before[p['name']] for p in PIECES
                          if p['name'] in fresh or p['name'] in before]
    rc.write_meta(meta_path, meta)
    print('RENDER DONE ui kit', out_dir)


if __name__ == '__main__':
    main()
