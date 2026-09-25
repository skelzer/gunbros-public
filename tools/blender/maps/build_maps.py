"""
Render painted maps at 4x (see map_kit.py for the rules).

    blender --background --factory-startup --python maps/build_maps.py -- \
        --out work/maps --maps hills [--only terrain,far] [--scale 4]

For each map module named, `maps/<id>.py` is imported and registers its terrain and its
plates. Each canvas is built into an empty scene and rendered twice: `img` in its toon
colours and `img_id` with every object in the flat code colour of its part group, which
the packer turns into the dark lines between parts. Everything a map renders goes into
work/maps/<id>/, with a meta.json the packer reads; two maps never share a folder, so
they can be rendered side by side.
"""
import argparse
import importlib
import json
import math
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import map_kit as kit  # noqa: E402
import render_common as rc  # noqa: E402


def frame_camera(scene, cam, w, h, scale):
    """Square-on orthographic camera over a w x h canvas, canvas (0, 0) at the top left."""
    cam.data.ortho_scale = max(w, h) / rc.PX_PER_UNIT
    cam.data.clip_start = 0.1
    cam.data.clip_end = 400.0
    cam.location = kit.W(w / 2, h / 2, 1500)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.render.resolution_x = w * scale
    scene.render.resolution_y = h * scale
    scene['canvas_h'] = h


def clear_objects(keep):
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.curves):
        for data in list(block):
            if data.users == 0:
                block.remove(data)


def render_canvas(scene, cam, keep, spec, layer, size, build, arg, out_dir, scale):
    """Build one canvas from nothing, render it and its id pass, return its meta entry."""
    clear_objects(keep)
    w, h = size
    frame_camera(scene, cam, w, h, scale)
    t0 = time.time()
    build(arg)
    objs = [o for o in bpy.data.objects if o not in keep and o.type == 'MESH' and not o.hide_render]
    for o in objs:
        if 'group' not in o:
            raise SystemExit(f'{spec.id}/{layer}: {o.name} has no part group (use kit.tag or a kit helper)')
    bpy.context.view_layer.update()
    if layer == 'terrain':
        # Plates render without shadows at all; on the terrain, only what stands in the
        # air casts one (map_kit.settle_shadows).
        t1 = time.time()
        buried = kit.settle_shadows(objs, bpy.context.evaluated_depsgraph_get())
        print(f'{spec.id}/{layer}: {len(buried)} of {len(objs)} objects buried, no cast shadow '
              f'({time.time() - t1:.1f}s)', flush=True)
    built = time.time() - t0
    rc.render_layers(scene, {layer: objs}, out_dir, 'img', groups=lambda o: o['group'])
    print(f'{spec.id}/{layer}: {len(objs)} objects, built in {built:.1f}s, rendered in {time.time() - t0 - built:.1f}s',
          flush=True)
    return {'size': [w, h], 'materials': spec.used_materials(objs)}


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True, help='work/maps; each map renders into a folder in it')
    ap.add_argument('--maps', required=True, help='comma separated map ids')
    ap.add_argument('--scale', type=int, default=4)
    ap.add_argument('--only', default='', help='comma separated canvases (terrain, plate names), for quick looks')
    args = ap.parse_args(argv)
    only = [s for s in args.only.split(',') if s]

    scene = rc.reset_scene()
    rc.configure((16, 16), (8, 8))
    cam = rc.setup_scene(scene, near_y=0.0, scale=args.scale)
    sun = scene.objects['Key']
    sun.rotation_euler = (-kit.LIGHT_DIR).to_track_quat('-Z', 'Y').to_euler()
    keep = {cam, sun}

    for map_id in [m for m in args.maps.split(',') if m]:
        path = os.path.join(HERE, f'{map_id}.py')
        if not os.path.exists(path):
            raise SystemExit(f'no map module {path}')
        importlib.import_module(map_id)
        spec = kit.MAPS.get(map_id)
        if spec is None:
            raise SystemExit(f'{path} did not call map_kit.define("{map_id}", ...)')
        if spec.terrain_build is None:
            raise SystemExit(f'{map_id}: no @spec.terrain builder')
        if not 3 <= len(spec.plates) <= 5:
            print(f'WARNING {map_id}: {len(spec.plates)} plates; DESIGN §8.1 asks for 3 to 5')
        out_dir = os.path.join(os.path.abspath(args.out), map_id)
        os.makedirs(out_dir, exist_ok=True)
        meta_path = os.path.join(out_dir, 'meta.json')
        before = {}
        if only and os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as fh:
                before = json.load(fh)
        spec.reset_materials()

        canvases = {}
        if not only or 'terrain' in only:
            canvases['terrain'] = render_canvas(scene, cam, keep, spec, 'terrain', spec.size, spec.terrain_build, spec,
                                                out_dir, args.scale)
        elif 'terrain' in before.get('canvases', {}):
            canvases['terrain'] = before['canvases']['terrain']
        for plate in spec.plates:
            layer = f'plate_{plate.name}'
            if only and plate.name not in only:
                if layer in before.get('canvases', {}):
                    canvases[layer] = before['canvases'][layer]
                continue
            # Plates are far away: cast shadows would only put dark smears on them.
            sun.data.use_shadow = False
            canvases[layer] = render_canvas(scene, cam, keep, spec, layer, plate.size, plate.build, plate,
                                            out_dir, args.scale)
            sun.data.use_shadow = True
            canvases[layer].update({'name': plate.name, 'parallax': plate.parallax, 'outline': plate.outline,
                                    'drift': plate.drift, 'fillAbove': plate.fill_above})
        # Render order is registration order; the packer keeps it.
        rc.write_meta(meta_path, {
            'map': map_id,
            'scale': args.scale,
            'size': list(spec.size),
            'sky': spec.sky,
            'outline': spec.outline,
            'ramps': spec.ramps,
            'flats': spec.flats,
            'plates': [p.name for p in spec.plates],
            'canvases': canvases,
        })
    print('RENDER DONE maps', args.maps, flush=True)


if __name__ == '__main__':
    main()
