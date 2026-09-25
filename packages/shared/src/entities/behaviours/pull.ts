/**
 * `pull` — jd S2/SS — Vortex.
 *
 * The shell explodes normally and then drags everything the blast caught toward the
 * centre: every living mobile within `params.pullRadius` is thrown off the ground
 * (`ctx.applyImpulse`) with an impulse pointing at the impact point, scaled by a linear
 * falloff, and flies there under ordinary gravity before landing (DESIGN §3, §7 item
 * 70: an impulse is a velocity, not a teleport).
 *
 * `params.pullLift` is what takes the mobile off the ground and is therefore not
 * optional: `stepMobile` only integrates `vx` while airborne, so a purely horizontal
 * impulse would be thrown away on the next tick. The lift also decides how far the pull
 * carries — the flight lasts `2 * lift / gravity` ticks — which is why a stronger SS
 * raises both numbers.
 *
 * That flight time is also why the horizontal impulse is capped. `pullStrength / dist`
 * grows without bound as a target gets closer to the blast, so a mobile standing 20 px
 * away used to be flung clean over the crater and land further out than it started —
 * a vortex that pushes. The cap is the horizontal speed that covers exactly the
 * remaining distance in the flight the lift buys, times `params.overshootFactor` (1 =
 * land on the centre), which makes "toward the centre" mean toward it at every
 * distance instead of only outside ~120 px.
 *
 * Deterministic: the mobile list is walked in seat order, the arithmetic is plain, and
 * nothing draws from `ctx.rng`.
 */
import { constants } from '../../data/constants.js';
import type { Behaviour, BehaviourContext, ImpactInfo } from './registry.js';
import { basicBehaviour } from './registry.js';
import type { ProjectileState } from '../projectile.js';

function param(p: ProjectileState, key: string, fallback: number): number {
  const value = p.def.params?.[key];
  return value === undefined ? fallback : value;
}

/**
 * Drag every mobile inside `pullRadius` toward (x, y).
 *
 * The vertical part of the pull direction is scaled down by `params.verticalScale` and
 * the lift is subtracted from it, so a blast under a mobile's feet still throws it up
 * and inwards instead of pressing it into the ground.
 */
function pullMobiles(p: ProjectileState, ctx: BehaviourContext, x: number, y: number): void {
  const radius = param(p, 'pullRadius', 0);
  if (radius <= 0) return;
  const strength = param(p, 'pullStrength', 0);
  const lift = param(p, 'pullLift', 0);
  const verticalScale = param(p, 'verticalScale', 0);
  const centreEpsilon = param(p, 'centreEpsilonPx', 1);
  /** 1 = land on the centre; above 1 = allowed to overshoot by that fraction. */
  const overshoot = param(p, 'overshootFactor', 1);

  ctx.emit({ t: 'pull', x, y, radius, ownerSeat: p.ownerSeat });

  for (let i = 0; i < ctx.mobiles.length; i++) {
    const m = ctx.mobiles[i];
    if (!m || !m.alive) continue;
    const def = ctx.defOf(m.seat);
    const centreY = def ? m.y - def.footprint.h / 2 : m.y;
    const dx = x - m.x;
    const dy = y - centreY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > radius) continue;
    const falloff = 1 - dist / radius;
    if (falloff <= 0) continue;
    if (dist <= centreEpsilon) {
      // Standing on the blast: nothing to pull toward, so it is just thrown up.
      ctx.applyImpulse(m.seat, 0, -lift * falloff);
      continue;
    }
    const scale = (strength * falloff) / dist;
    // Never further than the centre: the flight lasts `2 * liftHere / gravity` ticks,
    // so anything faster than `|dx| / flightTicks` sideways lands on the far side of it.
    // The cap is horizontal because that is what "past the crater" means on the ground.
    const liftHere = lift * falloff;
    const flightTicks = (2 * liftHere) / constants.gravity;
    let vx = dx * scale;
    if (flightTicks > 0) {
      const cap = ((dx < 0 ? -dx : dx) / flightTicks) * overshoot;
      if (vx > cap) vx = cap;
      else if (vx < -cap) vx = -cap;
    }
    ctx.applyImpulse(m.seat, vx, dy * scale * verticalScale - liftHere);
  }
}

export const pullBehaviour: Behaviour = {
  ...basicBehaviour,
  onImpact(p: ProjectileState, ctx: BehaviourContext, hit: ImpactInfo): boolean {
    // Damage first, then the pull: a mobile the blast killed is not dragged (DESIGN §3
    // says "after the explosion"), and `applyImpulse` ignores a dead seat anyway.
    ctx.explode(p, hit.x, hit.y);
    pullMobiles(p, ctx, hit.x, hit.y);
    p.alive = false;
    return true;
  },
  onTimer(p: ProjectileState, ctx: BehaviourContext): void {
    ctx.explode(p, p.x, p.y);
    pullMobiles(p, ctx, p.x, p.y);
    p.alive = false;
  },
};
