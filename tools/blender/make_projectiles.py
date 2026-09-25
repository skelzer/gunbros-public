#!/usr/bin/env python3
"""
The projectile atlas from nothing to the committed assets, on any platform:

    uv run tools/blender/make_projectiles.py                 (all modules)
    uv run tools/blender/make_projectiles.py armor raon      (only those modules re-render)
    uv run tools/blender/make_projectiles.py armor --only shell,missile
    uv run tools/blender/make_projectiles.py armor --assets /tmp/x --preview /tmp/x/armor.png

1. Blender, headless, renders the pieces at 4x into work/projectiles/<module>/.
2. pack_projectiles.py reduces every module's last render and writes
   packages/client/public/sprites/blender/projectiles.png and .json, plus
   work/projectiles_preview.png (only the modules just rendered, when some were named).
   `--assets DIR` and `--preview FILE` send both somewhere else, so several people (or
   agents) can iterate on different modules at once without racing on the atlas; such
   a private atlas packs only the modules named.

Uses `uv` for the packer when it is installed, else the Python running this script
(which then needs numpy and Pillow).
"""
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sprites import ASSETS, HERE, find_blender, run  # noqa: E402


def main():
    start = time.time()
    blender = find_blender()
    argv = sys.argv[1:]

    def option(name, default):
        if name not in argv:
            return default
        i = argv.index(name)
        value = argv[i + 1]
        del argv[i:i + 2]
        return value

    only = option('--only', '')
    assets = os.path.abspath(option('--assets', ASSETS))
    preview = os.path.abspath(option('--preview', os.path.join(HERE, 'work', 'projectiles_preview.png')))
    modules = argv
    work = os.path.join(HERE, 'work', 'projectiles')
    cmd = [blender, '--background', '--factory-startup', '--python', 'build_projectiles.py', '--',
           '--out', work, '--scale', '4']
    if modules:
        cmd += ['--modules', ','.join(modules)]
    if only:
        cmd += ['--only', only]
    run(cmd)
    py = ['uv', 'run', '--python', '3.12'] if shutil.which('uv') else [sys.executable]
    post = py + ['pack_projectiles.py', '--work', work, '--assets', assets, '--preview', preview]
    if modules:
        post += ['--preview-modules', ','.join(modules)]
        if assets != os.path.abspath(ASSETS):
            # A private atlas holds only the named modules: never read another module's
            # renders while someone else may be writing them.
            post += ['--modules', ','.join(modules)]
    run(post)
    print(f'total {time.time() - start:.1f}s')


if __name__ == '__main__':
    main()
