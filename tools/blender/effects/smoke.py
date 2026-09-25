"""
Smoke that lingers: `smoke_s_<v>` and `smoke_l_<v>`, three variants each of one small
cloud (a knot of puffs) that swells, rolls over and breaks up into shrinking bits.

The client moves them (they rise and drift with the wind while they play) and lays
several down over time: a lingering column over a big crater or a wreck is these puffs
emitted one after another, not a sprite of its own, so it can be any height and lean
with the wind.
"""
import math

from effects_kit import ball, ease_in, ease_out, effect, lerp, span, toon


def smoke(size_name, R, variant, n):
    frames = 10
    ticks = [6, 6, 7, 7, 8, 8, 8, 9, 9, 10]
    w = int(R * 3.2) // 2 * 2 + 4
    h = int(R * 3.2) + 4
    anchor = (w // 2, h // 2 + int(R * 0.3))

    @effect(f'smoke_{size_name}_{variant}', (w, h), anchor, frames, ticks, outline='#2e323d',
            materials=('soot',))
    def build(i, t, rng):
        objs = []
        puffs = []
        for k in range(n):
            a = rng.random() * math.tau
            dist = R * (0.15 + 0.45 * rng.random())
            puffs.append((math.cos(a) * dist, math.sin(a) * dist * 0.8, R * (0.38 + 0.2 * rng.random()),
                          (rng.random() * 2 - 1) * R * 0.3, rng.random() * 0.25))
        swell = ease_out(span(t, 0.0, 0.35))
        for k, (x, y, r0, d, late) in enumerate(puffs):
            # Out from the middle as it swells; each puff breaks off and shrinks on its own.
            spread = lerp(0.5, 1.2, swell) + 0.4 * span(t, 0.5, 1.0)
            r = r0 * lerp(0.45, 1.0, swell) * (1.0 - ease_in(span(t, 0.45 + late, 1.0), 1.3))
            if r > 0.8:
                objs.append(ball(f'puff{k}', x * spread, y * spread + R * 0.3 * t, r, toon('soot'), 3 + k % 5,
                                 d=d, squash=(1, 0.92, 0.7)))
        return objs
    return build


for _v, _seed in enumerate('abc'):
    smoke('s', 9, _seed, 3 + _v % 2)
    smoke('l', 12, _seed, 4 + _v)
