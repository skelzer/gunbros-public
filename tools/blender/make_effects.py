#!/usr/bin/env python3
"""
The effects atlas from nothing to the committed assets, on any platform:

    uv run tools/blender/make_effects.py                    (every module, in parallel)
    uv run tools/blender/make_effects.py blasts smoke       (only those modules re-render)
    uv run tools/blender/make_effects.py blasts --only 'blast_ice_*,blast_fire_m'
    uv run tools/blender/make_effects.py blasts --dry       (render and preview, write no assets)
    uv run tools/blender/make_effects.py --pack             (re-pack the last renders only)

1. Blender, headless, renders every frame at 4x into work/effects/<module>/, one Blender
   per module, `-j` of them at a time (default 4).
2. pack_effects.py reduces every module's last render and writes
   packages/client/public/sprites/blender/effects.png and .json, plus
   work/effects_preview.png (only the effects just rendered, when some were named).

Uses `uv` for the packer when it is installed, else the Python running this script
(which then needs numpy, Pillow and SciPy).
"""
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_sprites import ASSETS, HERE, find_blender, run  # noqa: E402


def all_modules():
    d = os.path.join(HERE, 'effects')
    return sorted(f[:-3] for f in os.listdir(d) if f.endswith('.py') and not f.startswith('_'))


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
    jobs = int(option('-j', '4'))
    preview = os.path.abspath(option('--preview', os.path.join(HERE, 'work', 'effects_preview.png')))
    dry = flag('--dry')
    pack_only = flag('--pack')
    modules = argv or all_modules()
    for m in modules:
        if m not in all_modules():
            sys.exit(f'no effects module tools/blender/effects/{m}.py (have {", ".join(all_modules())})')
    work = os.path.join(HERE, 'work', 'effects')
    if not pack_only:
        blender = find_blender()
        pending = list(modules)
        running = []
        failed = []
        while pending or running:
            while pending and len(running) < jobs:
                m = pending.pop(0)
                cmd = [blender, '--background', '--factory-startup', '--python-exit-code', '1',
                       '--python', 'build_effects.py', '--', '--out', work, '--scale', '4', '--modules', m]
                if only:
                    cmd += ['--only', only]
                log = open(os.path.join(HERE, 'work', f'effects_{m}.log'), 'w')
                print('> render', m, flush=True)
                running.append((m, subprocess.Popen(cmd, cwd=HERE, stdout=log, stderr=subprocess.STDOUT,
                                                    stdin=subprocess.DEVNULL), log))
            time.sleep(0.2)
            for entry in list(running):
                m, proc, log = entry
                if proc.poll() is None:
                    continue
                log.close()
                running.remove(entry)
                if proc.returncode != 0:
                    failed.append(m)
                print(f'  {m}: exit {proc.returncode} ({time.time() - start:.0f}s)', flush=True)
        if failed:
            sys.exit(f'Blender failed rendering {", ".join(failed)}; see work/effects_<module>.log. '
                     'Nothing was packed.')
    py = ['uv', 'run', '--python', '3.12'] if shutil.which('uv') else [sys.executable]
    post = py + ['pack_effects.py', '--work', work, '--assets', ASSETS, '--preview', preview]
    if only:
        post += ['--preview-only', only]
    if dry:
        post += ['--dry']
    run(post)
    print(f'total {time.time() - start:.1f}s')


if __name__ == '__main__':
    main()
