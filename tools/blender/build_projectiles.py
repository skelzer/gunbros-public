"""
Render every projectile piece at 4x (see projectile_kit.py for the rules).

    blender --background --factory-startup --python build_projectiles.py -- \
        --out work/projectiles [--modules armor,raon] [--only shell,missile] [--scale 4]

Every module in `projectiles/` is imported and registers its pieces. Each module
renders into its own folder, work/projectiles/<module>/, with its own meta.json, so two
modules can be rendered at the same time without touching each other's files and the
packer picks up whatever each one last rendered.
"""
import argparse
import importlib
import json
import math
import os
import pkgutil
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import projectile_kit as kit  # noqa: E402
import render_common as rc  # noqa: E402


# Sprite pixels per modelling pixel. Pieces are modelled in the kit's px, then rendered
# this much bigger, so every projectile grows without touching a module: more pixels,
# the same 1 px outline, never a scaled blit on the canvas.
ZOOM = 1.3


def canvas_size(size):
    return [round(n * ZOOM) for n in size]


def frame_camera(scene, cam, size, scale):
    w, h = canvas_size(size)
    cam.data.ortho_scale = max(w, h) / (rc.PX_PER_UNIT * ZOOM)
    cam.location = kit.W(0, 0, 50)
    cam.rotation_euler = (math.radians(90), 0, 0)
    # An odd canvas puts the origin in the middle of a pixel, an even one on a pixel
    # corner. Either way the client centres the frame on the projectile.
    scene.render.resolution_x = w * scale
    scene.render.resolution_y = h * scale


def clear_objects(keep):
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.curves):
        for data in list(block):
            if data.users == 0:
                block.remove(data)


def load_modules(names):
    pkg_dir = os.path.join(HERE, 'projectiles')
    found = sorted(m.name for m in pkgutil.iter_modules([pkg_dir]))
    if names:
        missing = [n for n in names if n not in found]
        if missing:
            raise SystemExit(f'no such projectile module: {missing} (have {found})')
        found = [n for n in found if n in names]
    for name in found:
        importlib.import_module(f'projectiles.{name}')
    return found


def ensure_materials(names):
    for name in names:
        if name in kit.MATS:
            continue
        if name in kit.EXTRA_RAMPS:
            kit.MATS[name] = rc.toon_material(name, kit.EXTRA_RAMPS[name])
        else:
            kit.MATS.update(rc.build_materials(kit.PALETTE, [name]))


def render_piece(scene, cam, keep, p, out_dir, scale):
    frame_camera(scene, cam, p['size'], scale)
    ensure_materials(p['materials'])
    frames, groups = [], set()
    for d in range(p['dirs']):
        for a in range(p['anim']):
            clear_objects(keep)
            objs = [o for o in p['build'](a) if o is not None]
            # Turn every root in the scene, not only what the build returned: boolean
            # cutters must turn with their target, and a child follows its parent (turning
            # it as well would turn it twice).
            roots = [o for o in bpy.data.objects if o not in keep and o.parent is None]
            if p['mode'] == 'aim':
                kit.turn_all(roots, 360.0 * d / p['dirs'])
            elif p['mode'] == 'spin':
                kit.turn_all(roots, -p['spinDeg'] * a / p['anim'])
            bpy.context.view_layer.update()
            for o in objs:
                used = o.data.materials[0].name
                if used not in p['materials']:
                    raise SystemExit(f'{p["key"]}: {o.name} uses {used}, not declared in materials=')
                groups.add(o['group'])
            name = f'{p["key"]}_{d}_{a}'
            rc.render_layers(scene, {'img': objs}, out_dir, name, groups=lambda o: o['group'])
            frames.append(name)
    return {
        'key': p['key'], 'mode': p['mode'], 'size': canvas_size(p['size']), 'dirs': p['dirs'],
        'anim': p['anim'], 'spinDeg': p['spinDeg'], 'frameTicks': p['frameTicks'], 'frames': frames,
        'materials': list(p['materials']), 'glowGroups': sorted(g for g in groups if g >= kit.GLOW),
    }


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='work/projectiles; each module renders into a folder in it')
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--modules', default='', help='comma separated module names (default: all)')
    ap.add_argument('--only', default='', help='comma separated sprite keys, for quick looks')
    args = ap.parse_args(argv)
    out_root = os.path.abspath(args.out)

    rc.configure((16, 16), (8, 8))
    scene = rc.reset_scene()
    kit.PALETTE.update(rc.load_palette())
    modules = load_modules([m for m in args.modules.split(',') if m])
    cam = rc.setup_scene(scene, near_y=0.0, scale=args.scale)
    sun = scene.objects['Key']
    sun.rotation_euler = (-kit.LIGHT_DIR).to_track_quat('-Z', 'Y').to_euler()
    # Projectiles are small and turn: cast shadows would jump around between directions.
    sun.data.use_shadow = False
    keep = {cam, sun}

    only = [s for s in args.only.split(',') if s]
    keys = [p['key'] for p in kit.PIECES]
    dupes = {k for k in keys if keys.count(k) > 1}
    if dupes:
        raise SystemExit(f'sprite keys registered twice: {sorted(dupes)}')
    for module in modules:
        pieces = [p for p in kit.PIECES if p['module'] == f'projectiles.{module}']
        out_dir = os.path.join(out_root, module)
        meta_path = os.path.join(out_dir, 'meta.json')
        before = {}
        if only and os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as fh:
                before = {e['key']: e for e in json.load(fh)['pieces']}
        entries = []
        for p in pieces:
            if only and p['key'] not in only:
                if p['key'] in before:
                    entries.append(before[p['key']])
                continue
            entries.append(render_piece(scene, cam, keep, p, out_dir, args.scale))
            print('piece', module, p['key'], len(entries[-1]['frames']), 'frame(s)', flush=True)
        extra = {n: kit.EXTRA_RAMPS[n] for e in entries for n in e['materials'] if n in kit.EXTRA_RAMPS}
        rc.write_meta(meta_path, {'module': module, 'scale': args.scale, 'glowFrom': kit.GLOW,
                                  'extraRamps': extra, 'pieces': entries})
    print('RENDER DONE projectiles', ','.join(modules), out_root)


if __name__ == '__main__':
    main()
