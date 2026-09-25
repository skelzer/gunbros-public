#!/usr/bin/env python3
"""
The UI kit from nothing to the committed atlas, on any platform:

    uv run tools/blender/make_ui_kit.py            (or: pnpm ui:kit)

1. Blender, headless, builds and renders every piece at 4x (work/ui).
   Pass piece names or prefixes to render only some for a quick look
   (make_ui_kit.py button status/); the others keep their earlier renders in work/ui.
2. pack_ui_kit.py reduces the renders and writes packages/client/public/ui/blender/
   ui_kit.png and ui_kit.json, plus work/ui_kit_preview.png to look at.

Blender is found the same way as for the mobiles (make_sprites.py). Standard library
only, so any Python 3.8+ runs it.
"""
import os
import shutil
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sprites import HERE, find_blender, run  # noqa: E402

ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', 'packages', 'client', 'public', 'ui', 'blender'))


def main():
    start = time.time()
    blender = find_blender()
    only = sys.argv[1:]
    work = os.path.join(HERE, 'work', 'ui')
    cmd = [blender, '--background', '--factory-startup', '--python', 'build_ui_kit.py', '--',
           '--out', work, '--scale', '4']
    if only:
        cmd += ['--only', ','.join(only)]
    else:
        shutil.rmtree(work, ignore_errors=True)
    run(cmd)
    run(['uv', 'run', '--python', '3.12', 'pack_ui_kit.py', '--work', work, '--assets', ASSETS,
         '--preview', os.path.join(HERE, 'work', 'ui_kit_preview.png')])
    print(f'total {time.time() - start:.1f}s')
    print('assets in', ASSETS)


if __name__ == '__main__':
    main()
