/**
 * `weave` — mage S2 — Weave.
 *
 * Two projectiles that share one path and slide ±`params.amplitudePx` sideways from it
 * as `sin(phase)` (DESIGN §3). The pair is fired as one `count: 2` shot with no spread,
 * so both bodies carry exactly the same velocity and the same ballistic path: the braid
 * is a *position* offset perpendicular to travel, re-applied as a delta every sub-step,
 * which leaves the shared centre line untouched (the two offsets are equal and
 * opposite) and leaves the integration in `projectile.ts` alone.
 *
 * Which half of the braid a body is comes from the parity of its projectile id — the
 * two are created back to back from `state.nextProjectileId`, so their ids are
 * consecutive and the assignment is deterministic on every engine without any module
 * state (DESIGN §2.1).
 *
 * The braid *opens*: the amplitude ramps from 0 to `params.amplitudePx` over the first
 * `params.rampSubSteps` sub-steps. The muzzle of a mage is already inside its own hull
 * box at some angles (barrel 13 px on a 24×22 footprint), so applying the full offset on
 * the first sub-step put one half of the pair back in the shooter's chest and detonated
 * it there at low power. Both halves now leave along the centre line and part once they
 * are clear.
 *
 * Every number lives in the mobile's `data/mobiles/<id>.ts` under
 * `ProjectileDef.params`; the fallbacks here are the neutral "no weave at all" values.
 */
import type { Behaviour } from './registry.js';
import { basicBehaviour } from './registry.js';
import { sinDeg } from '../../math/trig.js';

export const weaveBehaviour: Behaviour = {
  ...basicBehaviour,

  onSpawn(p) {
    const params = p.def.params ?? {};
    // Odd ids braid one way, even ids the other.
    p.data.side = p.id % 2 === 0 ? 1 : -1;
    p.data.phase = params.phaseDeg ?? 0;
    p.data.offset = 0;
    p.data.subSteps = 0;
  },

  onTick(p) {
    const params = p.def.params ?? {};
    const amplitude = params.amplitudePx ?? 0;
    const sub = (p.data.subSteps ?? 0) + 1;
    p.data.subSteps = sub;
    if (amplitude === 0) return;

    const phase = (p.data.phase ?? 0) + (params.degPerSubStep ?? 0);
    p.data.phase = phase;

    const ramp = params.rampSubSteps ?? 0;
    const open = ramp > 0 && sub < ramp ? (amplitude * sub) / ramp : amplitude;
    const target = open * sinDeg(phase) * (p.data.side ?? 1);
    const delta = target - (p.data.offset ?? 0);
    if (delta === 0) return;

    // Perpendicular to travel, so the braid stays a braid however the shot arcs.
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (speed === 0) return;
    p.x += (-p.vy / speed) * delta;
    p.y += (p.vx / speed) * delta;
    p.data.offset = target;
  },
};
