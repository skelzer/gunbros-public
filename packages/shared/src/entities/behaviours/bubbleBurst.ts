/**
 * `bubbleBurst` — turtle SS — Bubble Burst.
 *
 * A pressurised water shell on a fuse. When `lifetimeTicks` runs out it bursts into
 * `params.bubbles` bubbles thrown evenly around the full circle (DESIGN §3), each one
 * a slow, nearly weightless, very wind-sensitive drop that pops on its own timer.
 * The cloud drifts downwind onto whatever is standing under it, which is the whole
 * point of the shot: it is an area denial burst, not a sniper round.
 *
 * Data (`ProjectileDef.params` in `data/mobiles/turtle.ts`):
 *   bubbles             how many (0 = the shell simply dies)
 *   burstSpeed          px/tick each bubble is thrown at
 *   startDeg            angle of the first bubble, 0 = right, 90 = up
 *   offsetPx            radial offset the bubbles are born at, so they do not overlap
 *   inheritVelocity     fraction of the shell's own velocity the cloud keeps
 *   bubbleGravityScale  gravity and wind as fractions of the shell's
 *   bubbleWindScale
 *   bubbleLifeTicks     ticks a bubble lives before it pops on its own
 *   bubbleDamageScale   bubble damage / radius as fractions of the shell's
 *   bubbleRadiusScale
 *   burstDamageScale    the burst itself, as a fraction of shell damage (0 = silent)
 *   burstCarveScale
 */
import type { Behaviour } from './registry.js';
import type { ProjectileDef } from '../projectile.js';
import { cosDeg, sinDeg } from '../../math/trig.js';

/** Render tag for the bubbles; the client keys its sprite off this string. */
const BUBBLE_SPRITE = 'bubble';

/** One full turn in degrees — the bubbles are spread evenly over it. */
const FULL_CIRCLE_DEG = 360;

export const bubbleBurstBehaviour: Behaviour = {
  onTimer(p, ctx) {
    const params = p.def.params ?? {};
    const burstScale = params.burstDamageScale ?? 0;
    if (burstScale > 0) {
      ctx.explode(p, p.x, p.y, {
        damage: p.def.damage * burstScale,
        carveRadius: p.def.carveRadius * (params.burstCarveScale ?? 1),
      });
    }

    const bubbles = Math.floor(params.bubbles ?? 0);
    if (bubbles > 0) {
      const radiusScale = params.bubbleRadiusScale ?? 1;
      const lifeTicks = Math.floor(params.bubbleLifeTicks ?? 0);
      const bubbleDef: ProjectileDef = {
        ...p.def,
        gravity: p.def.gravity * (params.bubbleGravityScale ?? 1),
        windFactor: p.def.windFactor * (params.bubbleWindScale ?? 1),
        damage: p.def.damage * (params.bubbleDamageScale ?? 1),
        damageRadius: p.def.damageRadius * radiusScale,
        carveRadius: p.def.carveRadius * radiusScale,
        radius: Math.max(1, p.def.radius * radiusScale),
        // A bubble pops by itself; with `basic` that is the default explode.
        lifetimeTicks: lifeTicks > 0 ? lifeTicks : undefined,
        bounces: 0,
        behaviour: 'basic',
        params: undefined,
        sprite: BUBBLE_SPRITE,
        trail: 'bubble',
      };

      const speed = params.burstSpeed ?? 0;
      const offsetPx = params.offsetPx ?? 0;
      const inherit = params.inheritVelocity ?? 0;
      const startDeg = params.startDeg ?? 0;
      const stepDeg = FULL_CIRCLE_DEG / bubbles;
      for (let i = 0; i < bubbles; i++) {
        const deg = startDeg + stepDeg * i;
        const dx = cosDeg(deg);
        const dy = -sinDeg(deg);
        ctx.spawn(
          bubbleDef,
          p.x + dx * offsetPx,
          p.y + dy * offsetPx,
          dx * speed + p.vx * inherit,
          dy * speed + p.vy * inherit,
          p.ownerSeat,
        );
      }
    }

    p.alive = false;
  },
};
