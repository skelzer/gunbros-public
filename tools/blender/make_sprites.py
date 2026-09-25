#!/usr/bin/env python3
"""
One command from nothing to final assets, on any platform:

    uv run tools/blender/make_sprites.py            (or ./tools/blender/make_sprites.sh)

1. Blender, headless, builds each model and renders every frame at 4x (work/<name>).
   Pass atlas names to do only some: make_sprites.py walker
2. postprocess.py turns the renders into sprite sheets and the atlas in the client.
3. A preview and comparison.png are refreshed so the result can be looked at.

Blender is taken from $BLENDER, then PATH, then the usual install folders. Needs
Blender 4.2 or newer and `uv`. Standard library only, so any Python 3.8+ runs it.
"""
import glob
import os
import shutil
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', '..', 'packages', 'client', 'public', 'sprites', 'blender'))
# (build script, atlas name, hand-drawn sprite it replaces, that sprite's canvas)
MOBILES = [
    ('build_mobile_tank.py', 'tank', 'armor', (56, 48)),
    ('build_mobile_walker.py', 'walker', 'bigfoot', (64, 56)),
    ('build_mobile_sapper.py', 'sapper', 'raon', (56, 48)),
    ('build_mobile_turtle.py', 'turtle', 'turtle', (56, 48)),
    ('build_mobile_shrike.py', 'shrike', 'kalsiddon', (64, 56)),
    ('build_mobile_frog.py', 'frog', 'jfrog', (56, 48)),
    ('build_mobile_vortex.py', 'vortex', 'jd', (56, 48)),
    ('build_mobile_tempest.py', 'tempest', 'lightning', (56, 48)),
    ('build_mobile_zephyr.py', 'zephyr', 'boomer', (56, 48)),
    ('build_mobile_sorcerer.py', 'sorcerer', 'mage', (56, 48)),
    ('build_mobile_herald.py', 'herald', 'aduka', (56, 48)),
    ('build_mobile_paladin.py', 'paladin', 'knight', (56, 48)),
    ('build_mobile_skipper.py', 'skipper', 'grub', (56, 48)),
    ('build_mobile_delver.py', 'delver', 'nak', (56, 48)),
    ('build_mobile_frostbite.py', 'frostbite', 'ice', (56, 48)),
    ('build_mobile_triclops.py', 'triclops', 'trico', (64, 56)),
    ('build_mobile_orbital.py', 'orbital', 'asate', (64, 56)),
    ('build_mobile_wyvern.py', 'wyvern', 'dragon', (64, 56)),
]


def find_blender():
    candidates = [os.environ.get('BLENDER'), shutil.which('blender')]
    candidates += sorted(glob.glob(r'C:\Program Files\Blender Foundation\Blender *\blender.exe'), reverse=True)
    candidates += sorted(glob.glob('/Applications/Blender*.app/Contents/MacOS/Blender'), reverse=True)
    for c in candidates:
        if c and os.path.exists(c):
            return c
    sys.exit('Blender not found. Set BLENDER to the executable path.')


def run(cmd):
    print('>', ' '.join(cmd), flush=True)
    subprocess.run(cmd, cwd=HERE, check=True, stdin=subprocess.DEVNULL)


def main():
    start = time.time()
    blender = find_blender()
    only = sys.argv[1:]
    post = ['uv', 'run', '--python', '3.12', 'postprocess.py']
    for script, name, old, (ow, oh) in MOBILES:
        if only and name not in only:
            continue
        work = os.path.join(HERE, 'work', name)
        shutil.rmtree(work, ignore_errors=True)
        run([blender, '--background', '--factory-startup', '--python', script, '--', '--out', work, '--scale', '4'])
        run(post + ['sprites', '--work', work, '--assets', ASSETS])
        run(post + ['preview', '--work', work, '--out', os.path.join(HERE, 'work', name + '_preview.png')])
        run(post + ['compare', '--assets', ASSETS, '--name', name, '--old', old, '--old-size', str(ow), str(oh),
                    '--out', os.path.join(HERE, f'comparison_{name}.png')])
    end = time.time()
    print(f'total {end - start:.1f}s')
    print('assets in', ASSETS)


if __name__ == '__main__':
    main()
