/**
 * `orbit` — trico S2 — Orbit.
 *
 * `params.count` projectiles orbiting a shared centre of mass that follows the original
 * trajectory: each body sits `params.radiusPx` from the centre, evenly spaced around
 * it, and the ring turns `params.spinDegPerSubStep` per sub-step (DESIGN §3).
 *
 * The shot is fired as one `count: n` volley with no spread, so every body carries the
 * same velocity and therefore the same ballistic path. The ring is a *position* offset
 * re-applied as a delta each sub-step; because the offsets of a full ring sum to zero,
 * the centre of mass is exactly that shared ballistic path and nothing here has to
 * integrate it. Which spoke a body is comes from its projectile id — the bodies of one
 * shot get consecutive ids, so `id % count` is a different spoke for each of them and
 * needs no module state (DESIGN §2.1).
 *
 * The ring *opens*: the radius ramps from 0 to `params.radiusPx` over the first
 * `params.rampSubSteps` sub-steps. Without it the trailing spoke is a full radius behind
 * the muzzle on the very first sub-step, and the muzzle is already inside the shooter's
 * own hull box — so the ring would spin that spoke through its owner's chest and blow
 * the shot up in trico's face on most angles. Ramping keeps every body on the centre
 * line until the centre has left the hull, which is also what it looks like: a ball that
 * splits open rather than three that appear spread out.
 *
 * A body that hits something explodes on its own; the others keep turning around the
 * centre they would have shared.
 */
import type { Behaviour } from './registry.js';
import { basicBehaviour } from './registry.js';
import { cosDeg, sinDeg } from '../../math/trig.js';

export const orbitBehaviour: Behaviour = {
  ...basicBehaviour,

  onSpawn(p) {
    const params = p.def.params ?? {};
    const count = Math.max(1, Math.floor(params.count ?? 1));
    const spoke = p.id % count;
    p.data.angle = (params.startDeg ?? 0) + (360 * spoke) / count;
    p.data.offsetX = 0;
    p.data.offsetY = 0;
    p.data.subSteps = 0;
  },

  onTick(p) {
    const params = p.def.params ?? {};
    const radius = params.radiusPx ?? 0;
    const sub = (p.data.subSteps ?? 0) + 1;
    p.data.subSteps = sub;
    if (radius === 0) return;

    const angle = (p.data.angle ?? 0) + (params.spinDegPerSubStep ?? 0);
    p.data.angle = angle;

    const ramp = params.rampSubSteps ?? 0;
    const open = ramp > 0 && sub < ramp ? (radius * sub) / ramp : radius;
    const targetX = open * cosDeg(angle);
    const targetY = open * sinDeg(angle);
    p.x += targetX - (p.data.offsetX ?? 0);
    p.y += targetY - (p.data.offsetY ?? 0);
    p.data.offsetX = targetX;
    p.data.offsetY = targetY;
  },
};
