"""
Render every effect flipbook at 4x (see effects_kit.py for the rules).

    blender --background --factory-startup --python-exit-code 1 --python build_effects.py -- \
        --out work/effects [--modules blasts,smoke] [--only blast_ice_m,hit_ice] [--scale 4]

Every module in `effects/` is imported and registers its effects. Each module renders
into its own folder, work/effects/<module>/, with its own meta.json, so modules can be
rendered in parallel (make_effects.py does) and the packer picks up whatever each one
last rendered.
"""
import argparse
import fnmatch
import importlib
import json
import math
import os
import pkgutil
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import effects_kit as kit  # noqa: E402
import render_common as rc  # noqa: E402


def frame_camera(scene, cam, size, anchor, scale):
    w, h = size
    ax, ay = anchor
    cam.data.ortho_scale = max(w, h) / rc.PX_PER_UNIT
    # The canvas centre, in effect space (y up) relative to the anchor.
    cam.location = kit.W(w / 2 - ax, ay - h / 2, 60)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.resolution_x = w * scale
    scene.render.resolution_y = h * scale


def clear_objects(keep):
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.metaballs):
        for data in list(block):
            if data.users == 0:
                block.remove(data)


def load_modules(names):
    pkg_dir = os.path.join(HERE, 'effects')
    found = sorted(m.name for m in pkgutil.iter_modules([pkg_dir]) if not m.name.startswith('_'))
    if names:
        missing = [n for n in names if n not in found]
        if missing:
            raise SystemExit(f'no such effects module: {missing} (have {found})')
        found = [n for n in found if n in names]
    for name in found:
        importlib.import_module(f'effects.{name}')
    return found


def off_canvas(o, e):
    """
    True for a small piece (a spark, a drop, a sliver: under SMALL_PX across) that
    reaches outside the canvas: it has flown off, so it is dropped rather than drawn
    cut in half against the edge. Big pieces stay, and the packer warns about them.
    """
    from mathutils import Vector
    w, h = e['size']
    ax, ay = e['anchor']
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    xs = [p.x * rc.PX_PER_UNIT + ax for p in pts]
    ys = [ay - p.z * rc.PX_PER_UNIT for p in pts]
    if max(max(xs) - min(xs), max(ys) - min(ys)) >= SMALL_PX:
        return False
    return min(xs) < 1.5 or min(ys) < 1.5 or max(xs) > w - 1.5 or max(ys) > h - 1.5


SMALL_PX = 12


def render_effect(scene, cam, keep, e, out_dir, scale):
    frame_camera(scene, cam, e['size'], e['anchor'], scale)
    frames, groups = [], set()
    n = e['frames']
    for i in range(n):
        clear_objects(keep)
        t = i / (n - 1) if n > 1 else 0.0
        objs = [o for o in e['build'](i, t, kit.rng_for(e['key'])) if o is not None]
        bpy.context.view_layer.update()
        if not e['tile']:
            for o in [o for o in objs if off_canvas(o, e)]:
                objs.remove(o)
                o.hide_render = True
        stray = kit.used_palette(objs) - set(e['materials'])
        if stray:
            raise SystemExit(f'{e["key"]}: frame {i} uses {sorted(stray)}, not declared in materials=')
        for o in objs:
            groups.add(o['group'])
        name = f'{e["key"]}_{i}'
        if objs:
            rc.render_layers(scene, {'img': objs}, out_dir, name, groups=lambda o: o['group'])
        else:
            # An empty frame (a pause): render nothing, the packer writes a blank.
            for layer in ('img', 'img_id'):
                path = os.path.join(out_dir, layer, name + '.png')
                if os.path.exists(path):
                    os.remove(path)
        frames.append(name)
    return {
        'key': e['key'], 'size': list(e['size']), 'anchor': list(e['anchor']), 'ticks': e['ticks'],
        'loop': e['loop'], 'tile': e['tile'], 'outline': e['outline'], 'frames': frames,
        'materials': list(e['materials']),
        'palette': {m: kit.palette_entry(m) for m in e['materials']},
        'glowGroups': sorted(g for g in groups if g >= kit.GLOW),
    }


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='work/effects; each module renders into a folder in it')
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--modules', default='', help='comma separated module names (default: all)')
    ap.add_argument('--only', default='', help='comma separated effect keys (or key prefixes ending in *)')
    args = ap.parse_args(argv)
    out_root = os.path.abspath(args.out)

    rc.configure((16, 16), (8, 8))
    scene = rc.reset_scene()
    kit.PALETTE.update(rc.load_palette())
    modules = load_modules([m for m in args.modules.split(',') if m])
    cam = rc.setup_scene(scene, near_y=0.0, scale=args.scale)
    sun = scene.objects['Key']
    sun.rotation_euler = (-kit.LIGHT_DIR).to_track_quat('-Z', 'Y').to_euler()
    # Puffs and shards move every frame: cast shadows would crawl across them.
    sun.data.use_shadow = False
    keep = {cam, sun}

    only = [s for s in args.only.split(',') if s]

    def wanted(key):
        if not only:
            return True
        return any(fnmatch.fnmatchcase(key, o) for o in only)

    keys = [e['key'] for e in kit.EFFECTS]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        raise SystemExit(f'effect keys registered twice: {sorted(dupes)}')
    for module in modules:
        effects = [e for e in kit.EFFECTS if e['module'] == f'effects.{module}']
        out_dir = os.path.join(out_root, module)
        meta_path = os.path.join(out_dir, 'meta.json')
        before = {}
        if only and os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as fh:
                before = {e['key']: e for e in json.load(fh)['effects']}
        entries = []
        for e in effects:
            if not wanted(e['key']):
                if e['key'] in before:
                    entries.append(before[e['key']])
                continue
            entries.append(render_effect(scene, cam, keep, e, out_dir, args.scale))
            print('effect', module, e['key'], len(entries[-1]['frames']), 'frame(s)', flush=True)
        rc.write_meta(meta_path, {'module': module, 'scale': args.scale, 'glowFrom': kit.GLOW,
                                  'outlineDefault': kit.PALETTE['outline'], 'effects': entries})
    print('RENDER DONE effects', ','.join(modules), out_root)


if __name__ == '__main__':
    main()
