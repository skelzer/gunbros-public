#!/usr/bin/env python3
"""
Painted maps from nothing to the committed assets (DESIGN §8.1), on any platform:

    uv run tools/blender/make_maps.py hills                    (or: pnpm maps hills)
    uv run tools/blender/make_maps.py hills --keep 04_windmill (also file the previews)
    uv run tools/blender/make_maps.py hills --only terrain     (re-render one canvas)
    uv run tools/blender/make_maps.py hills --dry              (look, write nothing)
    uv run tools/blender/make_maps.py                          (every map module)

1. Blender, headless, renders the map's terrain and plates at 4x into work/maps/<id>/
   (maps/build_maps.py). Only the maps named are rendered.
2. maps/pack_maps.py reduces them to pixel art, checks the budgets and writes
   packages/client/public/maps/<id>/ (terrain.png, one PNG per plate, thumb.png) and
   packages/shared/src/data/maps/masks/<id>.ts (the mask RLE and plate placements),
   plus work/maps/<id>/preview.png and preview_views.png to look at.

Uses `uv` for the packer when it is installed, else the Python running this script
(which then needs numpy, Pillow and SciPy).
"""
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sprites import HERE, find_blender, run  # noqa: E402

MAPS_DIR = os.path.join(HERE, 'maps')
KIT_FILES = {'map_kit.py', 'build_maps.py', 'pack_maps.py'}


def all_maps():
    return sorted(f[:-3] for f in os.listdir(MAPS_DIR)
                  if f.endswith('.py') and f not in KIT_FILES and not f.startswith('_'))


def main():
    start = time.time()
    argv = sys.argv[1:]

    def option(name, default):
        if name not in argv:
            return default
        i = argv.index(name)
        value = argv[i + 1]
        del argv[i:i + 2]
        return value

    def flag(name):
        if name in argv:
            argv.remove(name)
            return True
        return False

    only = option('--only', '')
    keep = option('--keep', '')
    dry = flag('--dry')
    maps = argv or all_maps()
    for m in maps:
        if not os.path.exists(os.path.join(MAPS_DIR, f'{m}.py')):
            sys.exit(f'no map module tools/blender/maps/{m}.py (have {", ".join(all_maps())})')

    work = os.path.join(HERE, 'work', 'maps')
    blender = find_blender()
    # --python-exit-code: without it Blender exits 0 after a Python error in the script,
    # and the packer would silently re-pack whatever stale renders are in work/.
    cmd = [blender, '--background', '--factory-startup', '--python-exit-code', '1',
           '--python', os.path.join('maps', 'build_maps.py'), '--',
           '--out', work, '--maps', ','.join(maps), '--scale', '4']
    if only:
        cmd += ['--only', only]
    rendered = time.time()
    try:
        run(cmd)
    except subprocess.CalledProcessError as e:
        sys.exit(f'\nBlender failed (exit {e.returncode}) rendering {", ".join(maps)}; nothing was packed. '
                 'The error is in the Blender output above.')
    # Belt and braces: every map rendered must have a fresh meta.json, or the packer
    # would pack an older render.
    stale = [m for m in maps
             if not os.path.exists(os.path.join(work, m, 'meta.json'))
             or os.path.getmtime(os.path.join(work, m, 'meta.json')) < rendered - 1]
    if stale:
        sys.exit(f'\nBlender exited without rendering {", ".join(stale)} (no fresh work/maps/<id>/meta.json); '
                 'nothing was packed.')
    rendered = time.time() - rendered
    py = ['uv', 'run', '--python', '3.12'] if shutil.which('uv') else [sys.executable]
    post = py + [os.path.join('maps', 'pack_maps.py'), '--work', work, '--maps', ','.join(maps)]
    if keep:
        post += ['--keep', keep]
    if dry:
        post += ['--dry']
    run(post)
    print(f'render {rendered:.1f}s, total {time.time() - start:.1f}s')


if __name__ == '__main__':
    main()
