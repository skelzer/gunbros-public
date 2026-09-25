"""
Light from the sky and other jumps of energy:

- `beam_<w>` (n, m, w: core 10, 20 and 40 px): one 32 px tall segment of a column of
  light, tiled from the beam's top to where it lands. A plasma cylinder (white core,
  cyan, blue rim) with an electric helix crawling round it. Everything in it repeats
  every 32 px (the helix pitch is the tile), so the tiles meet without a seam. Its nine
  frames play once over the beam's life: a fat first strike, a flicker, then it thins
  to a thread.
- `beam_hit`: where the column meets the ground, a splash of plasma, a flat ring and
  sparks thrown up.
- `teleport`: a violet column that snaps open and pinches shut, rings climbing it,
  sparkles rising. Played at both ends of the jump, anchored at the feet.
- `vortex`: three violet arms spiralling into a dark eye that pops (jd's pull); the
  code ring still runs in from the full pull radius around it.
"""
import math
import random

from effects_kit import (GLOW, ball, blob, bolt, disc, ease_in, ease_out, effect, flat, heat, lerp, ring, span, star,
                         tube)

TILE = 32
BEAMS = {'n': 10, 'm': 20, 'w': 40}
WIDTH_BY_FRAME = [1.35, 1.15, 1.0, 0.92, 1.0, 0.85, 0.72, 0.5, 0.28]


def column(name, W, top, bottom, material, group, sides=24):
    """A vertical cylinder `W` px across from y = bottom to y = top, as a tube."""
    return tube(name, [(0, bottom, 0), (0, top, 0)], W / 2, material, group=group, smooth=True, resolution=6)


def beam(tier, W):
    cw = int(W * 1.35 + 18) // 2 * 2
    frames = len(WIDTH_BY_FRAME)

    @effect(f'beam_{tier}', (cw, TILE), (cw // 2, 0), frames, 2, materials=('plasma', 'bright', 'cyanlite'), tile=True)
    def build(i, t, rng):
        objs = []
        f = WIDTH_BY_FRAME[i]
        w = max(2.4, W * f)
        # y runs up; the tile is y in [-TILE, 0] under the anchor at its top edge. Build
        # well past both ends so the tile is cut from the middle of an endless column.
        objs.append(column('core', w, TILE, -2 * TILE, heat('plasma', 0.42, top='bright', facing=1.0, light=0.1),
                           GLOW + 1))
        if i < frames - 2:
            # The helix: a jagged spiral round the column, pitch = one tile, a new phase
            # every frame so it crawls. Only its near half shows in front of the core.
            for h in range(2):
                pts = []
                steps = 16
                phase = i * 1.9 + h * math.pi
                for k in range(-steps, 2 * steps + 1):
                    y = -TILE * k / steps
                    a = phase + math.tau * k / steps
                    rr = w / 2 + 2.0 + (1.2 if k % 2 else 0.0)
                    pts.append((math.cos(a) * rr, y, math.sin(a) * rr))
                objs.append(bolt(f'helix{h}', pts, 0.9, flat('bright' if h else 'cyanlite'), GLOW + 2))
        return objs
    return build


for _t, _w in BEAMS.items():
    beam(_t, _w)


@effect('beam_hit', (100, 80), (50, 58), 9, 2, materials=('plasma', 'bright', 'cyanlite'))
def beam_hit(i, t, rng):
    sparks = [(math.pi * (0.1 + 0.8 * rng.random()), 0.6 + rng.random() * 0.8) for _ in range(9)]
    objs = []
    k = ease_out(span(t, 0.0, 0.4))
    fade = 1.0 - ease_in(span(t, 0.5, 1.0))
    r = lerp(8, 16, k) * fade
    if r > 1:
        objs.append(blob('splash', [(0, 0, 0, r), (-r * 0.8, -1, 0, r * 0.6), (r * 0.8, -1, 0, r * 0.6),
                                    (0, r * 0.6, 0, r * 0.55)],
                         heat('plasma', lerp(0.75, 0.4, t), top='bright', facing=1.0, light=0.15), GLOW + 1))
    rr = lerp(10, 32, ease_out(span(t, 0.0, 0.7)))
    if t < 0.8:
        objs.append(ring('ring', 0, 0, rr, lerp(1.6, 0.8, t), flat('cyanlite'), GLOW + 2, d=6, tilt=78))
    for n, (a, v) in enumerate(sparks):
        f = t * 1.3
        x = math.cos(a) * v * 30 * f
        y = math.sin(a) * v * 34 * f - 30 * f * f
        if y > -8:
            objs.append(disc(f's{n}', x, y, 1.4, flat('bright' if n % 2 else 'cyanlite'), GLOW + 3, d=8))
    return objs


@effect('teleport', (48, 72), (24, 66), 13, 2, materials=('warp', 'bright', 'lilac'))
def teleport(i, t, rng):
    motes = [((rng.random() * 2 - 1) * 14, rng.random() * 40, rng.random() * 0.5) for _ in range(9)]
    objs = []
    open_ = ease_out(span(t, 0.0, 0.2)) * (1.0 - ease_in(span(t, 0.45, 0.8)))
    w = 22 * open_
    if w > 1.5:
        objs.append(tube('col', [(0, -2, 0), (0, 60, 0)], [w / 2, w / 2 * 0.8], heat('warp', 0.6, top='bright', facing=1.0,
                                                                                    light=0.1),
                         group=GLOW + 1, smooth=True, resolution=6))
    # Rings climb the column.
    for n in range(3):
        k = span(t, n * 0.12, 0.5 + n * 0.12)
        if 0 < k < 1:
            objs.append(ring(f'ring{n}', 0, lerp(2, 50, ease_in(k, 1.3)), lerp(15, 7, k), 1.3,
                             flat('lilac' if n % 2 else 'bright'), GLOW + 2, d=0, tilt=75))
    if t < 0.12:
        objs.append(star('flash', 0, 18, 4, 22, 4, flat('bright'), GLOW + 3, d=12))
    for n, (x, y, delay) in enumerate(motes):
        m = span(t, 0.1 + delay * 0.6, 0.6 + delay * 0.8)
        if 0 < m < 1:
            s = 3.2 * math.sin(m * math.pi) + 1.2
            objs.append(star(f'mote{n}', x * (1 - m * 0.3), y + m * 18, 4, s, s * 0.3,
                             flat('bright' if n % 3 else 'lilac'), GLOW + 3, d=14))
    return objs


@effect('vortex', (76, 60), (38, 30), 13, 2, outline='#1c1233', materials=('warp', 'bright', 'lilac'))
def vortex(i, t, rng):
    objs = []
    # The arms wind in and tighten as the pull closes; the whole disc is seen from a
    # little above, so it is squashed in y.
    scale = lerp(1.0, 0.25, ease_in(span(t, 0.1, 0.8), 1.4))
    spin = t * 5.5
    if t < 0.82:
        for arm in range(3):
            pts, radii = [], []
            for k in range(14):
                f = k / 13
                a = arm * math.tau / 3 + spin + f * 3.4
                r = lerp(34, 4, f) * scale
                pts.append((math.cos(a) * r, math.sin(a) * r * 0.55, math.sin(a) * r * 0.3))
                radii.append(lerp(1.0, 2.6, f) * lerp(1.0, 0.7, t))
            objs.append(tube(f'arm{arm}', pts, radii, heat('warp', 0.45, top='bright', facing=0.8, light=0.3),
                             group=GLOW + 1, smooth=True, resolution=3))
        eye = lerp(3, 7, ease_out(span(t, 0.0, 0.5))) * (1.0 - span(t, 0.6, 0.82))
        if eye > 0.8:
            objs.append(ball('eye', 0, 0, eye, heat('warp', 0.15, top='bright', facing=1.0, light=0.0), GLOW + 2,
                             d=2, squash=(1, 0.75, 1)))
    else:
        k = span(t, 0.82, 1.0)
        r = lerp(12, 4, k)
        objs.append(star('pop', 0, 0, 4, r, r * 0.25, flat('bright' if k < 0.5 else 'lilac'), GLOW + 3, d=4,
                         deg=45 * i))
    return objs
