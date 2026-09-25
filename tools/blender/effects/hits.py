"""
Hit pops, `hit_<type>`: the small burst on a hull a shot actually damaged, one per
damage type, over in about a fifth of a second. Separates "it hit the mobile" from "it
hit the ground beside it"; the code sparks still fly off on top.

- `explosive`: a hot eight-point star that snaps open and shrinks.
- `fire`: a flare with licks of flame and embers.
- `energy`: a white cross with a cyan one behind and a crackle of arcs.
- `impact`: a pale pow star and two puffs of dust.
- `ice`: a ring of small shards bursting out, a twinkle.
- `water`: a fan of drops thrown up and out.
"""
import math
import random

from effects_kit import (GLOW, ball, bolt, disc, ease_out, effect, flat, heat, lerp, shard, span, star, toon,
                         zigzag)

SIZE = (42, 42)
ANCHOR = (21, 21)
FRAMES = 6
TICKS = [2, 2, 2, 2, 3, 3]


@effect('hit_explosive', SIZE, ANCHOR, FRAMES, TICKS, materials=('hot', 'yolk', 'ember', 'blast'))
def hit_explosive(i, t, rng):
    k = ease_out(span(t, 0.0, 0.4))
    r = lerp(6, 13, k) * (1.0 - span(t, 0.6, 1.0) * 0.7)
    objs = [star('star', 0, 0, 8, r, r * 0.45, flat('ember' if t > 0.5 else 'yolk'), GLOW + 1, d=2, deg=90 + 22 * i),
            star('core', 0, 0, 8, r * 0.6, r * 0.3, flat('hot'), GLOW + 2, d=3, deg=90 + 22 * i)]
    if t < 0.5:
        objs.append(disc('ring', 0, 0, r * 0.35, flat('hot'), GLOW + 3, d=4))
    return objs


@effect('hit_fire', SIZE, ANCHOR, FRAMES, TICKS, materials=('flame', 'hot', 'yolk', 'ember'))
def hit_fire(i, t, rng):
    embers = [(rng.random() * math.tau, 0.6 + rng.random() * 0.6) for _ in range(6)]
    objs = []
    r = lerp(4, 8, ease_out(span(t, 0.0, 0.35))) * (1.0 - span(t, 0.55, 1.0) * 0.8)
    balls = [(0, 0, 0, r)]
    for k in range(4):
        a = math.pi / 2 + (k - 1.5) * 0.6
        balls += [(math.cos(a) * r * f, math.sin(a) * r * f * 1.3, 0, r * (1 - f * 0.6)) for f in (0.5, 1.0, 1.4)]
    objs.append(disc('flare', 0, 0, r * 1.05, flat('yolk'), GLOW + 1, d=-2) if t < 0.3 else None)
    from effects_kit import blob
    objs.append(blob('flame', balls, heat('flame', lerp(0.6, 0.2, t), top='hot', facing=0.6, light=0.45), GLOW + 2))
    for k, (a, v) in enumerate(embers):
        dist = v * lerp(4, 15, ease_out(t))
        objs.append(disc(f'e{k}', math.cos(a) * dist, math.sin(a) * dist + t * 4, 1.3, flat('yolk' if k % 2 else 'ember'),
                         GLOW + 3, d=4))
    return objs


@effect('hit_energy', SIZE, ANCHOR, FRAMES, TICKS, materials=('bright', 'cyanlite', 'plasma'))
def hit_energy(i, t, rng):
    flick = random.Random(77 + i)
    r = lerp(8, 15, ease_out(span(t, 0.0, 0.3))) * (1.0 - span(t, 0.5, 1.0) * 0.75)
    objs = [star('cross', 0, 0, 4, r, r * 0.16, flat('bright'), GLOW + 3, d=3, deg=90),
            star('cross2', 0, 0, 4, r * 0.65, r * 0.16, flat('cyanlite'), GLOW + 2, d=2, deg=45)]
    if t < 0.75:
        for k in range(3):
            a = flick.random() * math.tau
            pts = zigzag(flick, (math.cos(a) * 3, math.sin(a) * 3), (math.cos(a) * r * 0.95, math.sin(a) * r * 0.95), 3, 2)
            objs.append(bolt(f'arc{k}', [(x, y, 4) for x, y in pts], 1.1, flat('cyanlite'), GLOW + 1))
    return objs


@effect('hit_impact', SIZE, ANCHOR, FRAMES, TICKS, outline='#231a14', materials=('hot', 'yolk', 'dust'))
def hit_impact(i, t, rng):
    objs = []
    if t < 0.55:
        r = lerp(7, 13, ease_out(span(t, 0.0, 0.3)))
        objs.append(star('pow', 0, 0, 6, r, r * 0.5, flat('hot'), GLOW + 1, d=2, deg=100))
        objs.append(star('pow2', 0, 0, 6, r * 0.55, r * 0.3, flat('yolk'), GLOW + 2, d=3, deg=100))
    for k, side in enumerate((-1, 1)):
        g = span(t, 0.15, 1.0)
        r = 4.5 * math.sin(g * math.pi)
        if r > 0.8:
            objs.append(ball(f'dust{k}', side * lerp(4, 11, g), -2 + g * 3, r, toon('dust'), 3 + k, d=-3,
                             squash=(1.2, 0.85, 0.8)))
    return objs


@effect('hit_ice', SIZE, ANCHOR, FRAMES, TICKS, outline='#15304a', materials=('frost', 'white', 'bright'))
def hit_ice(i, t, rng):
    objs = []
    n = 6
    out = ease_out(span(t, 0.0, 0.6))
    L = lerp(3.5, 6.5, out) * (1.0 - span(t, 0.65, 1.0) * 0.6)
    for k in range(n):
        a = math.tau * (k + 0.25) / n
        r0 = lerp(2, 8, out)
        base = (math.cos(a) * r0, math.sin(a) * r0)
        tip = (math.cos(a) * (r0 + L), math.sin(a) * (r0 + L))
        objs.append(shard(f's{k}', base, tip, 1.5, toon('frost' if k % 2 else 'white'), 3 + k, sides=4, d=2))
    if t < 0.7:
        sz = lerp(8, 3, t)
        objs.append(star('tw', 0, 0, 4, sz, sz * 0.25, flat('bright'), GLOW + 1, d=4))
    return objs


@effect('hit_water', SIZE, ANCHOR, FRAMES, TICKS, outline='#13304c', materials=('water', 'white', 'bright'))
def hit_water(i, t, rng):
    objs = []
    drops = [(math.pi * (0.15 + 0.7 * k / 6) + (rng.random() - 0.5) * 0.2, 0.7 + rng.random() * 0.5) for k in range(7)]
    if t < 0.3:
        objs.append(star('splash', 0, 0, 8, 8, 4, flat('bright'), GLOW + 1, d=3))
    for k, (a, v) in enumerate(drops):
        f = t * 1.2
        x = math.cos(a) * v * 16 * f
        y = math.sin(a) * v * 16 * f - 14 * f * f
        r = 2.1 * (1.0 - span(t, 0.7, 1.0) * 0.4)
        objs.append(ball(f'd{k}', x, y, r, toon('water' if k % 3 else 'white'), 3 + k % 4, d=2,
                         squash=(0.85, 1.2, 0.85)))
    return objs
