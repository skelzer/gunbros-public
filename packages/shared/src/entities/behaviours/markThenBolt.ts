/**
 * `markThenBolt` — lightning S1/S2/SS — Mark then Bolt.
 *
 * The seed shell bursts where it lands, paints a mark there, and hangs on the point as
 * a beacon for `params.delayTicks`; then the sky answers with `params.bolts` bolts,
 * `params.intervalTicks` apart, fanned across `params.spreadPx` and arriving at
 * `params.angleDeg` off the vertical (DESIGN §3: S2 tilts the bolt, SS drops three).
 *
 * Two notes on how it is built:
 *
 * - The wait is the *projectile itself* staying alive rather than a scheduled
 *   `TurnEffect`, because a `TurnEffect` carries numbers only (DESIGN §7 item 67) and
 *   the bolt's damage type and sprite are data in `data/mobiles/lightning.ts`. A live
 *   projectile keeps `isSettled` false exactly as a pending effect would, so the turn
 *   still waits for the strike, and it gives the camera something to sit on. The `mark`
 *   event is emitted directly so the client blinks its crosshair all the same.
 * - The strike is drawn and carved here instead of through `ctx.beamStrike`, which can
 *   only express a *vertical* column: a bolt that comes in at an angle is the whole
 *   point of S2. The damage is the ordinary `ctx.damageArea` falloff around the point
 *   the bolt lands on, so the damage table, shields, debuffs and the SS gauge all
 *   behave exactly as they do for an explosion.
 *
 * Nothing here draws from `ctx.rng`: the fan is symmetric and the timing is integer.
 */
import type { Behaviour, BehaviourContext, ImpactInfo } from './registry.js';
import { basicBehaviour } from './registry.js';
import type { ProjectileDef, ProjectileState } from '../projectile.js';
import { clamp } from '../../math/fixed.js';
import { cosDeg, sinDeg } from '../../math/trig.js';

/** Render tag of the strike, for the `beam` event and the `mark` the client blinks. */
const BOLT_KIND = 'bolt';

/** Steepest slant a bolt may take, in degrees off the vertical. */
const MAX_SLANT_DEG = 80;

function param(p: ProjectileState, key: string, fallback: number): number {
  const value = p.def.params?.[key];
  return value === undefined ? fallback : value;
}

/**
 * The bolt's own def: the shell's damage type and wind/gravity immunity, its numbers.
 *
 * The bolt is the shot — the seed shell's own burst is a fraction of it — so the Force
 * band has to reach it too (DESIGN §7 item 130). `ctx.explode` scales its own blast;
 * this scales the payload that follows it.
 */
function boltDef(p: ProjectileState, ctx: BehaviourContext): ProjectileDef {
  const width = param(p, 'boltWidth', 12);
  return {
    ...p.def,
    speed: 0,
    gravity: 0,
    windFactor: 0,
    radius: 1,
    carveRadius: Math.max(1, width / 2),
    damage: param(p, 'boltDamage', p.def.damage) * ctx.forceMultiplier(p),
    damageRadius: param(p, 'boltDamageRadius', p.def.damageRadius),
    behaviour: 'basic',
    sprite: BOLT_KIND,
  };
}

/** Horizontal drift per px of fall for a bolt tilted `angleDeg` off the vertical. */
function slantOf(angleDeg: number): number {
  const a = clamp(angleDeg, -MAX_SLANT_DEG, MAX_SLANT_DEG);
  const c = cosDeg(a);
  if (c === 0) return 0;
  return sinDeg(a) / c;
}

/**
 * One bolt: carve the channel it burns from the sky down to the target, emit the `beam`
 * the renderer draws, and damage everything around the point it lands on.
 *
 * The channel is carved as overlapping circles along the segment, the same way
 * `ctx.beamStrike` carves its column, but only where there is something to carve — a
 * bolt crosses hundreds of px of empty sky and each carve is an event the client turns
 * into a dirty rect.
 */
function strike(
  ctx: BehaviourContext,
  def: ProjectileDef,
  ownerSeat: number,
  targetX: number,
  targetY: number,
  angleDeg: number,
  width: number,
): void {
  const radius = Math.max(1, width / 2);
  const skyY = 0;
  const fall = targetY - skyY;
  const startX = targetX - slantOf(angleDeg) * fall;

  const steps = Math.max(1, Math.ceil(fall / radius));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = startX + (targetX - startX) * t;
    const cy = skyY + fall * t;
    if (
      ctx.terrain.isSolid(cx, cy) ||
      ctx.terrain.isSolid(cx - radius, cy) ||
      ctx.terrain.isSolid(cx + radius, cy)
    ) {
      ctx.carve(cx, cy, radius);
    }
  }
  ctx.carve(targetX, targetY, radius);

  ctx.emit({
    t: 'beam',
    x1: startX,
    y1: skyY,
    x2: targetX,
    y2: targetY,
    width,
    kind: BOLT_KIND,
    ownerSeat,
  });
  ctx.damageArea(targetX, targetY, def, ownerSeat);
}

/** Park the shell on the point it marked and start the countdown. */
function beginMark(p: ProjectileState, ctx: BehaviourContext, x: number, y: number): void {
  const delay = Math.max(0, Math.floor(param(p, 'delayTicks', 24)));
  p.data.marked = 1;
  p.data.markX = x;
  p.data.markY = y;
  p.data.fireAtAge = p.age + delay;
  p.data.boltsFired = 0;
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
  ctx.emit({
    t: 'mark',
    x,
    y,
    kind: BOLT_KIND,
    ownerSeat: p.ownerSeat,
    ticksUntil: delay,
  });
}

export const markThenBoltBehaviour: Behaviour = {
  ...basicBehaviour,

  onImpact(p: ProjectileState, ctx: BehaviourContext, hit: ImpactInfo): boolean {
    // Once it is waiting, the beacon sits inside whatever it struck and would report an
    // impact on every sub-step; ignore those.
    if (p.data.marked === 1) return true;
    ctx.explode(p, hit.x, hit.y);
    beginMark(p, ctx, hit.x, hit.y);
    return true;
  },

  onTimer(p: ProjectileState, ctx: BehaviourContext): void {
    // A shell that reached its lifetime in mid-air still calls the sky down on itself.
    if (p.data.marked === 1) return;
    ctx.explode(p, p.x, p.y);
    beginMark(p, ctx, p.x, p.y);
  },

  onTick(p: ProjectileState, ctx: BehaviourContext): void {
    if (p.data.marked !== 1) return;
    const markX = p.data.markX ?? p.x;
    const markY = p.data.markY ?? p.y;
    // Hold the beacon still: it is parked inside terrain, so gravity and wind must not
    // walk it out of the hole it is waiting in.
    p.x = markX;
    p.y = markY;
    p.vx = 0;
    p.vy = 0;

    const bolts = Math.max(1, Math.floor(param(p, 'bolts', 1)));
    const interval = Math.max(0, Math.floor(param(p, 'intervalTicks', 0)));
    const spread = param(p, 'spreadPx', 0);
    const angle = param(p, 'angleDeg', 0);
    const width = param(p, 'boltWidth', 12);
    const fireAt = p.data.fireAtAge ?? 0;
    const def = boltDef(p, ctx);

    let fired = p.data.boltsFired ?? 0;
    while (fired < bolts && p.age >= fireAt + fired * interval) {
      // Symmetric fan around the mark, left to right, so the order is fixed.
      const offset = bolts === 1 ? 0 : (fired / (bolts - 1) - 0.5) * spread;
      const targetX = clamp(markX + offset, 0, ctx.bounds.width - 1);
      strike(ctx, def, p.ownerSeat, targetX, markY, angle, width);
      fired++;
    }
    p.data.boltsFired = fired;

    if (fired >= bolts) {
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
