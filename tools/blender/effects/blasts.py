"""
Blasts, one per damage type in three size tiers (`blast_<type>_<tier>`). The client picks
the tier nearest the explosion's carve radius; the shapes differ by type, not just the
colour:

- `explosive`: white flash and a star, a boiling fireball with a hot heart per lobe that
  cools to a rising, breaking cloud of smoke. The Metal Slug fireball.
- `fire`: tongues of flame lick up out of a burst, flicker, tear off as rising blobs
  and embers, and die down to a few licks and a wisp of dark smoke.
- `energy`: a plasma ball with lightning arcs crawling round it and a ring, that
  collapses to a point and pops into twinkling sparkles. No smoke.
- `impact`: a pale pow, faceted rocks thrown on arcs and a wide, low billow of dust
  rolling out along the ground.
- `ice`: a crystal flower of shards bursting from the point, breaking off and flying
  out spinning, a frost mist, twinkles.
- `water`: a splash crown of tapered columns with drops on their tips, a jet up the
  middle, drops raining out and a ring of foam.

Every blast is built around R, its tier's radius in px (roughly the carve radius it
stands for), so the tiers are one design at three sizes rather than three designs.
"""
import math

import random

from effects_kit import (GLOW, ball, blob, bolt, chunk, disc, ease_in, ease_out, effect, flat, heat, lerp,
                         ring, shard, span, star, toon, tube, zigzag)

TIERS = {'s': 16, 'm': 26, 'l': 40}


def canvas(R, wide=3.9, up=3.0, down=1.3):
    """Canvas and anchor for a blast of radius R: room to rise above, a little below."""
    w = int(round(R * wide)) // 2 * 2 + 4
    h = int(round(R * (up + down))) + 4
    return (w, h), (w // 2, h - int(round(R * down)) - 2)


# --------------------------------------------------------------------------
# Explosive
# --------------------------------------------------------------------------

def puffs(rng, R, n, k_size=1.0):
    """Fixed per-puff parameters, drawn in the same order every frame."""
    out = []
    for k in range(n):
        a = rng.random() * math.tau
        dist = 0.3 + 0.75 * rng.random()
        out.append({
            'dx': math.cos(a), 'dy': math.sin(a) * 0.8 + 0.25,
            'dist': R * dist,
            'size': R * k_size * (0.3 + 0.2 * rng.random()),
            # The rim cools first and the heart last, so the smoke closes round a core
            # that is still burning.
            'cool': 0.24 * (dist - 0.3) / 0.75 + rng.random() * 0.08,
            'rise': R * (0.9 + 0.8 * rng.random()),
            'd': (rng.random() * 2 - 1) * R * 0.3,
            'drift': (rng.random() * 2 - 1) * R * 0.25,
        })
    return out


def explosive(tier, R, key=None, frames=16, ticks=(2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6),
              n_puffs=None, k_size=None, up=3.2, rise=1.0, debris=0, burn=1.0):
    """The explosive blast; the death blast is the same fireball, bigger, taller, with wreckage."""
    size, anchor = canvas(R, wide=4.8, up=up, down=1.6)
    key = key or f'blast_explosive_{tier}'
    n_puffs = n_puffs or {'s': 9, 'm': 14, 'l': 24}[tier]
    k_size = k_size or {'s': 1.0, 'm': 0.9, 'l': 0.72}[tier]
    ticks = list(ticks)

    @effect(key, size, anchor, frames, ticks, outline='#2e323d',
            materials=('blast', 'hot', 'bright', 'yolk', 'soot') + (('steel',) if debris else ()))
    def build(i, t, rng):
        objs = []
        ps = puffs(rng, R, n_puffs, k_size)
        for p in ps:
            p['rise'] *= rise
        bits = [((rng.random() * 2 - 1) * 1.2, 0.8 + rng.random() * 1.2, 3.0 + rng.random() * 2.2, rng.random())
                for _ in range(debris)]
        sparks = [(rng.random() * math.tau, 0.8 + rng.random() * 0.7) for _ in range(6)]
        # 0: the flash, a white star over a hot ball.
        if i == 0:
            objs.append(star('flash_star', 0, 0, 8, R * 1.05, R * 0.42, flat('bright'), GLOW + 2, d=6))
            objs.append(disc('flash_core', 0, 0, R * 0.5, flat('yolk'), GLOW + 1, d=3))
            return objs
        # The fireball: puffs fly out and up, grow, and cool one by one.
        grow = ease_out(span(t, 0.0, 0.3))
        fire_hot, fire, ember, smoke = [], [], [], []
        for p in ps:
            out = ease_out(span(t, 0.0, 0.4), 2.2)
            x = p['dx'] * p['dist'] * lerp(0.35, 1.0, out) + p['drift'] * ease_in(t)
            y = p['dy'] * p['dist'] * lerp(0.35, 1.0, out) + p['rise'] * ease_in(span(t, 0.15, 1.0), 1.4)
            age = t / burn + p['cool']
            r = p['size'] * lerp(0.75, 1.15, grow)
            if age > 0.52:
                # Smoke gathers into a column, swells as it climbs, then breaks up and
                # shrinks to nothing.
                s = span(age, 0.52, 1.15)
                x *= lerp(1.0, 0.55, s)
                y += R * 0.5 * s
                r *= lerp(1.0, 1.15, s) * (1.0 - ease_in(span(t + p['cool'], 0.72, 1.18), 1.6))
                smoke.append((x, y, p['d'], r))
            elif age > 0.38:
                ember.append((x, y, p['d'], r))
            elif age > 0.2:
                fire.append((x, y, p['d'], r))
            else:
                fire_hot.append((x, y, p['d'], r))
        # A hot heart for the first frames, so the ball reads white-hot inside.
        core = 1.0 - span(t, 0.0, 0.3)
        if core > 0:
            fire_hot.append((0, R * 0.1, R * 0.25, R * lerp(0.3, 0.55, core)))
        # Two interleaved smoke masses in two part groups, so the cloud gets dark lines
        # between its lobes instead of melting into one lump.
        for k, (x, y, d, r) in enumerate(smoke):
            if r >= 0.8:
                objs.append(ball(f'smoke{k}', x, y, r, toon('soot'), 3 + k % 6, d=d, squash=(1, 0.92, 0.7)))
        objs.append(blob('ember', ember, heat('blast', 0.18, top='hot'), GLOW + 1))
        objs.append(blob('fire', fire, heat('blast', 0.45, top='hot'), GLOW + 2))
        objs.append(blob('firehot', fire_hot, heat('blast', 0.62, top='hot'), GLOW + 3))
        # A shock ring runs out in the first frames.
        if i <= 4:
            k = span(t, 0.0, 0.27)
            objs.append(ring('shock', 0, 0, R * lerp(0.9, 1.7, ease_out(k)), max(0.8, R * 0.06 * (1 - k) + 0.7),
                             flat('yolk'), GLOW + 4, d=R * 0.5, tilt=0.0, squash=0.55))
        # Wreckage: dark plates thrown high, tumbling, falling back.
        for k, (vx, vy, r, spin) in enumerate(bits):
            f = t * 1.4
            x = vx * R * 1.2 * f
            y = R * 0.2 + vy * R * 2.0 * f - R * 2.2 * f * f
            if 0 < f and y > -R * 0.2:
                objs.append(chunk(f'bit{k}', x, y, r, toon('steel'), 10 + k % 4, k * 17 + 3, d=R, spin=spin * 6 + f * 7))
        # Sparks thrown out along the first half.
        if t < 0.45:
            for k, (a, v) in enumerate(sparks):
                dist = R * v * lerp(0.6, 1.8, ease_out(span(t, 0.0, 0.45)))
                x, y = math.cos(a) * dist, math.sin(a) * dist * 0.8 + R * 0.2
                objs.append(disc(f'spark{k}', x, y, 1.6, flat('yolk'), GLOW + 4, d=R))
        return objs
    return build




# --------------------------------------------------------------------------
# Fire
# --------------------------------------------------------------------------

def fire(tier, R):
    frames = 16
    ticks = [2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5]
    size, anchor = canvas(R, wide=4.4, up=3.4, down=1.1)
    n_tongues = {'s': 6, 'm': 8, 'l': 11}[tier]
    n_billows = {'s': 4, 'm': 6, 'l': 8}[tier]

    @effect(f'blast_fire_{tier}', size, anchor, frames, ticks, outline='#2a1a1c',
            materials=('flame', 'hot', 'yolk', 'ember', 'soot'))
    def build(i, t, rng):
        objs = []
        # A wide bonfire: tongues across one and a half radii, leaning in to the middle,
        # the middle ones tallest.
        tongues = []
        for k in range(n_tongues):
            u = (k + 0.5) / n_tongues * 2 - 1
            tongues.append({'x': u * R * 1.3 + (rng.random() - 0.5) * R * 0.15,
                            'h': R * (0.9 + 1.2 * (1 - abs(u)) + 0.5 * rng.random()),
                            'w': R * (0.22 + 0.1 * rng.random()), 'ph': rng.random() * math.tau,
                            'd': (rng.random() * 2 - 1) * R * 0.3, 'late': rng.random() * 0.25,
                            'root': 0.12 + 0.3 * rng.random()})
        billows = [((rng.random() * 2 - 1) * R * 0.8, rng.random() * 0.3, R * (0.3 + 0.15 * rng.random()),
                    (rng.random() * 2 - 1) * R * 0.3) for _ in range(n_billows)]
        embers = [(rng.random() * 2 - 1, 0.6 + rng.random(), rng.random() * math.tau) for _ in range(8)]
        wisps = [((rng.random() * 2 - 1) * R * 0.5, rng.random() * 0.2) for _ in range(4)]
        if i == 0:
            objs.append(star('flash_star', 0, R * 0.1, 6, R * 0.95, R * 0.38, flat('yolk'), GLOW + 2, d=6))
            objs.append(disc('flash_core', 0, R * 0.1, R * 0.42, flat('hot'), GLOW + 3, d=7))
            return objs
        early = t < 0.3
        core, low, body, cool = [], [], [], []
        # The bed: a low wide burn along the ground that swells and sinks away.
        bed = R * 0.24 * ease_out(span(t, 0.0, 0.15)) * (1.0 - ease_in(span(t, 0.6, 1.0), 1.5))
        for k in range(9):
            x = (k - 4) * R * 0.3
            low.append((x, R * 0.12, 0.0, bed * (1.0 if 1 <= k <= 7 else 0.7)))
        if early:
            core.append((0, R * 0.35, R * 0.3, R * 0.55 * (1.0 - span(t, 0.0, 0.3))))
        for n, tg in enumerate(tongues):
            life = span(t, tg['late'] * 0.3, 1.0)
            # Shoots up fast, then dies down from the top.
            h = tg['h'] * ease_out(span(life, 0.0, 0.3), 2.5) * (1.0 - ease_in(span(life, 0.45, 1.0), 1.4) * 0.85)
            if h < 1.5:
                continue
            # Balls closer than a third of their radius, or the tongue breaks into beads.
            steps = max(6, int(h / (tg['w'] * 0.3)))
            for k in range(steps):
                f = k / (steps - 1)
                sway = math.sin(tg['ph'] + f * 2.6 + i * 1.3) * R * 0.16 * f
                x = tg['x'] * lerp(1.0, 0.85, f) + sway
                y = h * f + R * 0.1
                r = tg['w'] * lerp(1.0, 0.42, f) * lerp(1.0, 0.7, span(life, 0.5, 1.0))
                # Yellow at the root, orange up the body, red at the tips.
                (low if f < tg['root'] else body if f < 0.72 else cool).append((x, y, tg['d'], r))
        # Billows: balls of flame that roll up off the fire, darken and go out.
        for k, (x, late, r0, d) in enumerate(billows):
            b = span(t, 0.1 + late, 0.75 + late)
            if 0 < b < 1:
                r = r0 * math.sin(b * math.pi) ** 0.7
                cool.append((x * (1 - b * 0.4), R * (0.9 + b * 1.6), d, r))
        objs.append(blob('cool', cool, heat('flame', 0.14, facing=0.6, light=0.45), GLOW + 1))
        objs.append(blob('body', body, heat('flame', 0.3 if early else 0.22, facing=0.6, light=0.45), GLOW + 2))
        objs.append(blob('low', low, heat('flame', 0.6 if early else 0.48, facing=0.6, light=0.45), GLOW + 4))
        objs.append(blob('core', core, heat('flame', 0.7, top='hot', facing=0.7, light=0.35), GLOW + 5))
        for k, (dx, v, ph) in enumerate(embers):
            e = span(t, 0.1, 0.95)
            if 0 < e < 1:
                x = dx * R * (0.5 + e * 0.9) + math.sin(ph + e * 6) * R * 0.1
                y = R * (0.3 + v * 2.0 * e)
                r = 1.7 * (1.0 - e * 0.5)
                objs.append(disc(f'ember{k}', x, y, r, flat('yolk' if k % 2 else 'ember'), GLOW + 6, d=R))
        # A wisp of dark smoke at the very end, above what is left.
        for k, (x, delay) in enumerate(wisps):
            w = span(t, 0.55 + delay, 1.0)
            if 0 < w < 1:
                r = R * 0.22 * math.sin(w * math.pi) + 0.5
                objs.append(ball(f'wisp{k}', x * (1 - w * 0.4), R * (1.1 + w * 1.3), r, toon('soot'), 3 + k % 3,
                                 d=-R, squash=(1, 0.9, 0.7)))
        return objs
    return build


# --------------------------------------------------------------------------
# Energy
# --------------------------------------------------------------------------

def energy(tier, R):
    frames = 14
    ticks = [2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 5]
    size, anchor = canvas(R, wide=3.8, up=2.2, down=1.6)
    n_arcs = {'s': 4, 'm': 6, 'l': 8}[tier]

    @effect(f'blast_energy_{tier}', size, anchor, frames, ticks, outline='#10213a',
            materials=('plasma', 'bright', 'cyanlite'))
    def build(i, t, rng):
        objs = []
        sparkles = [(rng.random() * math.tau, R * (0.5 + rng.random() * 0.9), rng.random() * 0.3)
                    for _ in range(9)]
        flick = random.Random(1000 * i + int(R))
        cy = R * 0.2
        if i == 0:
            objs.append(star('flash', 0, cy, 4, R * 1.3, R * 0.2, flat('bright'), GLOW + 3, d=6, deg=90))
            objs.append(star('flash2', 0, cy, 4, R * 0.7, R * 0.16, flat('cyanlite'), GLOW + 2, d=5, deg=45))
            objs.append(disc('core', 0, cy, R * 0.35, flat('bright'), GLOW + 4, d=7))
            return objs
        # The ball: swells, holds, then collapses to a point.
        grow = ease_out(span(t, 0.0, 0.25))
        fall = ease_in(span(t, 0.4, 0.62))
        r = R * lerp(0.5, 0.92, grow) * (1.0 - fall)
        if r > 1.0:
            lobes = [(0, cy, 0, r)]
            for k in range(5):
                a = k * math.tau / 5 + i * 0.7
                lobes.append((math.cos(a) * r * 0.35, cy + math.sin(a) * r * 0.35, 0, r * 0.62))
            objs.append(blob('ball', lobes, heat('plasma', lerp(0.7, 0.45, span(t, 0.0, 0.4)), top='bright',
                                                facing=0.9, light=0.25), GLOW + 1))
            # Arcs crawl from the ball's skin out into the air, new ones every frame.
            for k in range(n_arcs):
                a = flick.random() * math.tau
                reach = r * (1.25 + flick.random() * 0.55)
                a0 = (math.cos(a) * r * 0.8, cy + math.sin(a) * r * 0.8)
                a1 = (math.cos(a + 0.35) * reach, cy + math.sin(a + 0.35) * reach)
                pts = zigzag(flick, a0, a1, 4, R * 0.1)
                objs.append(bolt(f'arc{k}', [(x, y, R * 0.6) for x, y in pts], 1.3,
                                 flat('bright' if k % 2 else 'cyanlite'), GLOW + 3))
        # The ring: out fast with the swell, again as the ball pops.
        for n, (a, b) in enumerate(((0.0, 0.3), (0.55, 0.85))):
            k = span(t, a, b)
            if 0 < k < 1:
                objs.append(ring(f'ring{n}', 0, cy, R * lerp(0.6, 1.6, ease_out(k)), lerp(1.4, 0.8, k),
                                 flat('cyanlite' if n == 0 else 'bright'), GLOW + 2, d=R, squash=0.9))
        # The pop: a white flash where the ball was, then sparkles that twinkle out.
        if 0.55 <= t < 0.7:
            objs.append(star('pop', 0, cy, 4, R * 0.8, R * 0.14, flat('bright'), GLOW + 4, d=6, deg=45 * i))
        for k, (a, dist, delay) in enumerate(sparkles):
            s = span(t, 0.55 + delay * 0.5, 1.0)
            if 0 < s < 1:
                x, y = math.cos(a) * dist * (0.6 + 0.5 * s), cy + math.sin(a) * dist * (0.6 + 0.5 * s) + s * R * 0.3
                size = R * 0.16 * math.sin(s * math.pi) + 1.5
                objs.append(star(f'twinkle{k}', x, y, 4, size, size * 0.3, flat('bright' if (k + i) % 3 else 'cyanlite'),
                                 GLOW + 4, d=5))
        return objs
    return build


# --------------------------------------------------------------------------
# Impact
# --------------------------------------------------------------------------

def impact(tier, R):
    frames = 15
    ticks = [2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6]
    size, anchor = canvas(R, wide=4.6, up=2.4, down=1.0)
    n_rocks = {'s': 5, 'm': 7, 'l': 10}[tier]
    n_dust = {'s': 8, 'm': 11, 'l': 16}[tier]

    @effect(f'blast_impact_{tier}', size, anchor, frames, ticks, outline='#231a14',
            materials=('dust', 'rock', 'hot', 'yolk'))
    def build(i, t, rng):
        objs = []
        rocks = [((rng.random() * 2 - 1) * 1.1, 0.9 + rng.random() * 0.9, R * (0.1 + rng.random() * 0.08),
                  rng.random()) for _ in range(n_rocks)]
        dust = [((1 if k % 2 else -1) * (0.1 + rng.random()), rng.random(), R * (0.28 + rng.random() * 0.18),
                 (rng.random() * 2 - 1) * R * 0.3) for k in range(n_dust)]
        if i == 0:
            objs.append(star('pow', 0, R * 0.25, 7, R * 1.0, R * 0.45, flat('hot'), GLOW + 2, d=6, deg=100))
            objs.append(star('pow2', 0, R * 0.25, 7, R * 0.6, R * 0.3, flat('yolk'), GLOW + 3, d=7, deg=100))
            return objs
        if i == 1:
            objs.append(star('pow', 0, R * 0.25, 7, R * 0.7, R * 0.35, flat('yolk'), GLOW + 2, d=6, deg=80))
        # Dust rolls out low and wide, swells, climbs a little, then settles away.
        for k, (side, v, r0, d) in enumerate(dust):
            roll = ease_out(span(t, 0.0, 0.7), 2.0)
            x = side * R * (0.3 + 1.1 * roll) * (0.7 + 0.3 * v)
            y = R * (0.15 + 0.5 * v * roll + 0.3 * t)
            r = r0 * lerp(0.6, 1.25, ease_out(span(t, 0.0, 0.4))) * (1.0 - ease_in(span(t, 0.55 + v * 0.1, 1.0), 1.4))
            if r > 0.8:
                objs.append(ball(f'dust{k}', x, y, r, toon('dust'), 3 + k % 5, d=d, squash=(1.25, 0.8, 0.7)))
        # Rocks on ballistic arcs, tumbling.
        for k, (vx, vy, r, spin) in enumerate(rocks):
            f = t * 1.5
            x = vx * R * 1.4 * f
            y = R * 0.2 + vy * R * 2.2 * f - R * 2.6 * f * f
            if y > -R * 0.9 and f < 1.2:
                objs.append(chunk(f'rock{k}', x, y, max(1.6, r), toon('rock'), 10 + k % 4, k * 31 + 7,
                                  d=R * 0.5, spin=spin * 6 + f * 5))
        return objs
    return build


# --------------------------------------------------------------------------
# Ice
# --------------------------------------------------------------------------

def ice(tier, R):
    frames = 15
    ticks = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6]
    size, anchor = canvas(R, wide=4.8, up=2.4, down=2.0)
    n_shards = {'s': 9, 'm': 12, 'l': 16}[tier]
    n_crust = {'s': 5, 'm': 7, 'l': 9}[tier]

    @effect(f'blast_ice_{tier}', size, anchor, frames, ticks, outline='#15304a',
            materials=('frost', 'white', 'bright'))
    def build(i, t, rng):
        objs = []
        cy = R * 0.15
        # A radial burst, wider than it is tall: directions all round the point, squashed
        # in y, the flatter ones longer. The lower ones sink into the crater.
        shards = []
        for k in range(n_shards):
            a = math.tau * (k + 0.3 + rng.random() * 0.4) / n_shards
            dx, dy = math.cos(a), math.sin(a) * 0.8
            flat_k = 1.0 - abs(math.sin(a)) * 0.3
            shards.append((dx, dy, R * (0.9 + rng.random() * 0.5) * flat_k, R * (0.14 + rng.random() * 0.05),
                           rng.random()))
        crust = [((k + 0.5) / n_crust * 2 - 1, R * (0.2 + 0.12 * rng.random()), rng.random()) for k in range(n_crust)]
        glitter = [((rng.random() * 2 - 1) * R * 1.5, rng.random() * R * 1.1 - R * 0.1, rng.random() * 0.45)
                   for _ in range(9)]
        if i == 0:
            objs.append(star('flash', 0, cy, 6, R * 1.1, R * 0.3, flat('bright'), GLOW + 3, d=6, deg=90))
            objs.append(disc('core', 0, cy, R * 0.3, flat('bright'), GLOW + 4, d=7))
            return objs
        grow = ease_out(span(t, 0.0, 0.2), 2.5)
        # The burst holds, then the shards shatter: they break off and fall, shrinking.
        brk = span(t, 0.35, 1.0)
        for k, (dx, dy, length, width, spin) in enumerate(shards):
            L = length * lerp(0.3, 1.0, grow) * (1.0 - ease_in(brk, 1.5) * 0.9)
            if L < 2.0:
                continue
            push = R * 0.9 * ease_out(brk, 1.6)
            fall = R * 1.3 * brk * brk
            bx = dx * (push + R * 0.08)
            by = cy + dy * (push + R * 0.08) - fall
            if by < -R * 0.9:
                continue
            a = math.atan2(dy, dx) + brk * (spin * 2 - 1) * 2.2
            tip = (bx + math.cos(a) * L, by + math.sin(a) * L)
            objs.append(shard(f'shard{k}', (bx, by), tip, width * lerp(0.7, 1.0, grow),
                              toon('frost' if k % 2 else 'white'), 3 + k % 6, sides=4, d=R * 0.3,
                              roll=30 + 40 * spin))
        # A crust of frost along the ground, left behind when the shards have gone.
        c = ease_out(span(t, 0.1, 0.4))
        melt = ease_in(span(t, 0.7, 1.0), 1.5)
        for k, (u, r0, j) in enumerate(crust):
            r = r0 * c * (1.0 - melt)
            if r > 0.9:
                objs.append(ball(f'crust{k}', u * R * 1.2 * lerp(0.6, 1.0, c), R * 0.05 + j * 2, r,
                                 toon('white' if k % 2 else 'frost'), 12 + k % 3, d=-R * 0.2, squash=(1.5, 0.6, 0.9)))
        for k, (x, y, delay) in enumerate(glitter):
            w = span(t, 0.2 + delay, 0.62 + delay)
            if 0 < w < 1:
                sz = R * 0.13 * math.sin(w * math.pi) + 1.4
                objs.append(star(f'tw{k}', x, cy + y, 4, sz, sz * 0.3, flat('bright'), GLOW + 4, d=R))
        return objs
    return build


# --------------------------------------------------------------------------
# Water
# --------------------------------------------------------------------------

def water(tier, R):
    frames = 15
    ticks = [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6]
    size, anchor = canvas(R, wide=4.8, up=2.9, down=1.6)
    n_drops = {'s': 12, 'm': 16, 'l': 22}[tier]

    @effect(f'blast_water_{tier}', size, anchor, frames, ticks, outline='#13304c',
            materials=('water', 'white', 'bright'))
    def build(i, t, rng):
        objs = []
        # Drops leave the rim of the crown all round (a ring seen a little from above, so
        # the far side sits higher), thrown up and out, and fall back past the rim.
        drops = []
        for k in range(n_drops):
            a = math.tau * (k + rng.random() * 0.6) / n_drops
            drops.append((a, 0.8 + rng.random() * 0.6, 0.9 + rng.random() * 0.7, R * (0.09 + rng.random() * 0.05),
                          rng.random() * 0.12))
        spray = [((rng.random() * 2 - 1) * 0.4, 1.4 + rng.random() * 0.8, R * (0.07 + rng.random() * 0.04))
                 for _ in range(5)]
        if i == 0:
            objs.append(star('flash', 0, R * 0.2, 8, R * 0.9, R * 0.45, flat('bright'), GLOW + 3, d=6))
            return objs
        # 1-3: a low dome bulges up, wide.
        dome = ease_out(span(t, 0.0, 0.18)) * (1.0 - ease_in(span(t, 0.18, 0.4)))
        if dome > 0.05:
            balls = [(0, R * 0.1, 0, R * 0.6 * dome)]
            for k in range(6):
                u = (k - 2.5) / 2.5
                balls.append((u * R * 0.9 * dome + u * R * 0.2, R * 0.05, 0, R * 0.38 * dome))
            objs.append(blob('dome', balls, toon('water'), 3))
        # The crown: a low wide sheet round the ring, its rim ruffled up, that rises and
        # sinks back.
        crown = ease_out(span(t, 0.1, 0.35)) * (1.0 - ease_in(span(t, 0.45, 0.8), 1.4))
        ring_r = R * lerp(0.5, 1.15, ease_out(span(t, 0.1, 0.7)))
        if crown > 0.05:
            sheet = []
            w = R * 0.14
            # Samples closer than half their radius, or the sheet breaks into beads.
            n = max(18, int(math.tau * ring_r / (w * 0.45)))
            for k in range(n):
                a = math.tau * k / n
                x, d = math.cos(a) * ring_r, math.sin(a) * ring_r
                y0 = -d * 0.3
                lip = R * 0.45 * crown * (1.0 + 0.35 * math.sin(a * 7.0))
                for f in (0.0, 0.33, 0.66, 1.0):
                    sheet.append((x * (1 + 0.15 * f), y0 + lip * f + w * 0.5, d * (1 + 0.15 * f), w * lerp(1.1, 0.8, f) * lerp(0.35, 1.0, min(1.0, crown * 2))))
            objs.append(blob('crown', sheet, toon('water'), 4))
        # Drops thrown from the rim.
        for k, (a, up, out, r, late) in enumerate(drops):
            f = span(t, 0.15 + late, 1.0) * 1.5
            if f <= 0:
                continue
            x0, d0 = math.cos(a) * R * 0.7, math.sin(a) * R * 0.7
            x = x0 + math.cos(a) * out * R * 0.9 * f
            d = d0 + math.sin(a) * out * R * 0.9 * f
            y = -d * 0.3 + R * 0.4 + up * R * 1.5 * f - R * 1.9 * f * f
            if y > -R * 1.1:
                objs.append(ball(f'drop{k}', x, y, max(1.4, r), toon('water' if k % 3 else 'white'), 6 + k % 4,
                                 d=d, squash=(0.9, 1.2, 0.9)))
        # A few drops shot straight up from the middle.
        for k, (vx, vy, r) in enumerate(spray):
            f = span(t, 0.25, 1.0) * 1.4
            if f <= 0:
                continue
            y = R * 0.3 + vy * R * 1.6 * f - R * 2.0 * f * f
            if y > -R * 0.6:
                objs.append(ball(f'spray{k}', vx * R * f, y, max(1.4, r), toon('water'), 10 + k % 2, d=R * 0.5,
                                 squash=(0.85, 1.25, 0.85)))
        # Foam left on the ground as the crown falls.
        foam = span(t, 0.4, 1.0)
        for k in range(7):
            u = (k - 3) / 3
            r = R * 0.16 * math.sin(foam * math.pi) * (1 - abs(u) * 0.3)
            if r > 0.9:
                objs.append(ball(f'foam{k}', u * ring_r * 1.05, 0, r, toon('white'), 13 + k % 2, d=R * 0.3,
                                 squash=(1.5, 0.7, 1.0)))
        return objs
    return build


# The death blast (the `death` event): a big fireball that climbs into a mushroom, with
# the wreck's plates thrown out of it. The lingering smoke column after it is smoke
# puffs the client keeps emitting (effects/smoke.py).
explosive('l', 44, key='death_blast', frames=20,
          ticks=(2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 6, 6),
          n_puffs=30, k_size=0.78, up=3.8, rise=1.3, debris=8, burn=1.35)

for _tier, _R in TIERS.items():
    explosive(_tier, _R)
    fire(_tier, _R)
    energy(_tier, _R)
    impact(_tier, _R)
    ice(_tier, _R)
    water(_tier, _R)
