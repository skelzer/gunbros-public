/**
 * `satellite` — asate S1/S2/SS — Orbital Strike.
 *
 * The designator shell bursts where it lands and paints a mark; the satellite overhead
 * then fires `params.beams` beams straight down onto it, `params.intervalTicks` apart,
 * fanned across `params.spreadPx` and `params.beamWidth` px wide (DESIGN §3: S2 fans
 * three, SS drops one wide lance).
 *
 * The beams are `ctx.beamStrike` calls — the context primitive written for exactly this
 * (DESIGN §7 item 68): it carves the column from the top of the map down to the mark,
 * emits one `beam` event and damages every mobile by its distance to the column, so a
 * mobile standing in the beam takes the middle of it and one beside it takes the edge.
 *
 * The wait is the projectile staying alive rather than a scheduled `TurnEffect`: an
 * effect carries numbers only (DESIGN §7 item 67) and the beam's damage type comes from
 * the shot's own def in `data/mobiles/asate.ts`. A live projectile holds `isSettled`
 * false just as a pending effect would, so the turn still waits for the strike.
 *
 * Nothing here draws from `ctx.rng`.
 */
import type { Behaviour, BehaviourContext, ImpactInfo } from './registry.js';
import { basicBehaviour } from './registry.js';
import type { ProjectileDef, ProjectileState } from '../projectile.js';
import { clamp } from '../../math/fixed.js';

/** Render tag of the strike: the `beam` event's `kind` and the mark's. */
const BEAM_KIND = 'satelliteBeam';

function param(p: ProjectileState, key: string, fallback: number): number {
  const value = p.def.params?.[key];
  return value === undefined ? fallback : value;
}

/**
 * The beam's own def: the designator's damage type, the satellite's numbers.
 *
 * The beam carries the whole shot, so a designator that crossed the Force band scales
 * it the way `ctx.explode` scales an ordinary blast (DESIGN §7 item 130).
 */
function beamDef(p: ProjectileState, ctx: BehaviourContext): ProjectileDef {
  const width = param(p, 'beamWidth', 16);
  return {
    ...p.def,
    speed: 0,
    gravity: 0,
    windFactor: 0,
    radius: 1,
    carveRadius: Math.max(1, width / 2),
    damage: param(p, 'beamDamage', p.def.damage) * ctx.forceMultiplier(p),
    damageRadius: param(p, 'beamDamageRadius', p.def.damageRadius),
    behaviour: 'basic',
    sprite: BEAM_KIND,
  };
}

/** Park the designator on the point it painted and start the countdown. */
function beginMark(p: ProjectileState, ctx: BehaviourContext, x: number, y: number): void {
  const delay = Math.max(0, Math.floor(param(p, 'delayTicks', 26)));
  p.data.marked = 1;
  p.data.markX = x;
  p.data.markY = y;
  p.data.fireAtAge = p.age + delay;
  p.data.beamsFired = 0;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  ctx.emit({
    t: 'mark',
    x,
    y,
    kind: BEAM_KIND,
    ownerSeat: p.ownerSeat,
    ticksUntil: delay,
  });
}

export const satelliteBehaviour: Behaviour = {
  ...basicBehaviour,

  onImpact(p: ProjectileState, ctx: BehaviourContext, hit: ImpactInfo): boolean {
    if (p.data.marked === 1) return true;
    ctx.explode(p, hit.x, hit.y);
    beginMark(p, ctx, hit.x, hit.y);
    return true;
  },

  onTimer(p: ProjectileState, ctx: BehaviourContext): void {
    if (p.data.marked === 1) return;
    ctx.explode(p, p.x, p.y);
    beginMark(p, ctx, p.x, p.y);
  },

  onTick(p: ProjectileState, ctx: BehaviourContext): void {
    if (p.data.marked !== 1) return;
    const markX = p.data.markX ?? p.x;
    const markY = p.data.markY ?? p.y;
    p.x = markX;
    p.y = markY;
    p.vx = 0;
    p.vy = 0;

    const beams = Math.max(1, Math.floor(param(p, 'beams', 1)));
    const interval = Math.max(0, Math.floor(param(p, 'intervalTicks', 0)));
    const spread = param(p, 'spreadPx', 0);
    const width = param(p, 'beamWidth', 16);
    const fireAt = p.data.fireAtAge ?? 0;
    const def = beamDef(p, ctx);

    let fired = p.data.beamsFired ?? 0;
    while (fired < beams && p.age >= fireAt + fired * interval) {
      // Symmetric fan around the mark, left to right, so the order is fixed.
      const offset = beams === 1 ? 0 : (fired / (beams - 1) - 0.5) * spread;
      const x = clamp(markX + offset, 0, ctx.bounds.width - 1);
      // Straight down from the top of the map onto the painted row.
      ctx.beamStrike(x, markY, 0, width, def, p.ownerSeat);
      fired++;
    }
    p.data.beamsFired = fired;

    if (fired >= beams) {
      p.alive = false;
      ctx.emit({
        t: 'projectileExpire',
        id: p.id,
        ownerSeat: p.ownerSeat,
        x: p.x,
        y: p.y,
        reason: 'lifetime',
      });
    }
  },
};
